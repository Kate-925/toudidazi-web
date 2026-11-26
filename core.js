const fs = require('fs');

const CONFIG = {
  apiBaseUrl: (process.env.API_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, ''),
  apiKey: process.env.DASHSCOPE_API_KEY || '',
  textModel: process.env.TEXT_MODEL || 'qwen-plus',
  visionModel: process.env.VISION_MODEL || 'qwen-vl-ocr',
  enableSearch: process.env.ENABLE_SEARCH !== 'false',
  freeTrialCount: Math.max(0, parseInt(process.env.FREE_TRIAL_COUNT || '3', 10) || 3),
  maxDailyOcrPerUser: Math.max(5, parseInt(process.env.MAX_DAILY_OCR || '20', 10) || 20),
  allowOrigin: process.env.ALLOW_ORIGIN || '*',
  dataFile: process.env.DATA_FILE || '/tmp/toudidazi_usage_store.json'
};

function parseRedeemCodes() {
  const raw = process.env.REDEEM_CODES || '';
  const map = {};
  raw.split(',').forEach(entry => {
    const trimmed = entry.trim();
    if (!trimmed) return;
    const [code, countStr] = trimmed.split(':');
    if (code && code.trim()) {
      map[code.trim().toUpperCase()] = Math.max(1, parseInt(countStr || '10', 10) || 10);
    }
  });
  return map;
}

let store = {
  devices: {},
  ips: {},
  codes: {}
};

function loadStore() {
  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        store = {
          devices: parsed.devices || {},
          ips: parsed.ips || {},
          codes: parsed.codes || {}
        };
      }
    }
  } catch (_) {}
}

function saveStore() {
  try {
    fs.writeFileSync(CONFIG.dataFile, JSON.stringify(store), 'utf-8');
  } catch (_) {}
}

loadStore();

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '';
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function getDeviceId(req) {
  const dev = req.headers['x-device-id'];
  return (typeof dev === 'string' && dev.trim()) ? dev.trim().slice(0, 64) : 'anon';
}

function getRedeemCode(req) {
  const code = req.headers['x-redeem-code'];
  return (typeof code === 'string' && code.trim()) ? code.trim().toUpperCase() : '';
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', CONFIG.allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Device-Id, X-Redeem-Code');
}

function sendJson(res, statusCode, payload) {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function getQuotaInfo(ip, deviceId, redeemCode) {
  const codeMap = parseRedeemCodes();
  if (redeemCode && Object.prototype.hasOwnProperty.call(codeMap, redeemCode)) {
    const total = codeMap[redeemCode];
    const used = (store.codes[redeemCode] && store.codes[redeemCode].used) || 0;
    const remaining = Math.max(0, total - used);
    return {
      remaining,
      freeTotal: CONFIG.freeTrialCount,
      codeActive: true,
      codeTotal: total
    };
  }

  const devUsed = (store.devices[deviceId] && store.devices[deviceId].used) || 0;
  const ipUsed = (store.ips[ip] && store.ips[ip].used) || 0;
  const effectiveUsed = Math.max(devUsed, ipUsed);
  const remaining = Math.max(0, CONFIG.freeTrialCount - effectiveUsed);
  return {
    remaining,
    freeTotal: CONFIG.freeTrialCount,
    codeActive: false
  };
}

function consumeQuota(ip, deviceId, redeemCode, isVisionOcr) {
  const codeMap = parseRedeemCodes();
  if (isVisionOcr) {
    if (!store.devices[deviceId]) store.devices[deviceId] = { used: 0, ocrUsed: 0 };
    if (!store.ips[ip]) store.ips[ip] = { used: 0, ocrUsed: 0 };
    store.devices[deviceId].ocrUsed = (store.devices[deviceId].ocrUsed || 0) + 1;
    store.ips[ip].ocrUsed = (store.ips[ip].ocrUsed || 0) + 1;
    saveStore();
    return getQuotaInfo(ip, deviceId, redeemCode);
  }

  if (redeemCode && Object.prototype.hasOwnProperty.call(codeMap, redeemCode)) {
    if (!store.codes[redeemCode]) store.codes[redeemCode] = { used: 0 };
    store.codes[redeemCode].used += 1;
    saveStore();
    return getQuotaInfo(ip, deviceId, redeemCode);
  }

  if (!store.devices[deviceId]) store.devices[deviceId] = { used: 0, ocrUsed: 0 };
  if (!store.ips[ip]) store.ips[ip] = { used: 0, ocrUsed: 0 };
  store.devices[deviceId].used = (store.devices[deviceId].used || 0) + 1;
  store.ips[ip].used = (store.ips[ip].used || 0) + 1;
  saveStore();
  return getQuotaInfo(ip, deviceId, redeemCode);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 15 * 1024 * 1024) {
        reject(new Error('请求体过大（请压缩图片或减少截图数量）'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('无效的 JSON 请求体'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeContent(rawVal) {
  if (!rawVal) return '';
  if (typeof rawVal === 'string') return rawVal;
  if (Array.isArray(rawVal)) {
    return rawVal
      .map(part => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        if (part.image_url && typeof part.image_url.url === 'string') return part.image_url.url;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof rawVal === 'object') {
    if (typeof rawVal.text === 'string') return rawVal.text;
    if (typeof rawVal.content === 'string') return rawVal.content;
  }
  return '';
}

function extractModelContent(data) {
  if (!data || typeof data !== 'object') return '';
  const choice = data.choices && data.choices[0];
  if (choice) {
    const msgContent = normalizeContent(choice.message && choice.message.content);
    if (msgContent && msgContent.trim()) return msgContent;
    if (typeof choice.text === 'string' && choice.text.trim()) return choice.text;
    const deltaContent = normalizeContent(choice.delta && choice.delta.content);
    if (deltaContent && deltaContent.trim()) return deltaContent;
    if (choice.message && typeof choice.message.reasoning_content === 'string' && choice.message.reasoning_content.trim()) {
      return choice.message.reasoning_content;
    }
  }
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  if (data.output && typeof data.output.text === 'string' && data.output.text.trim()) return data.output.text;
  return '';
}

async function handleQuota(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const ip = getClientIp(req);
  const deviceId = getDeviceId(req);

  if (req.method === 'GET') {
    const code = getRedeemCode(req);
    const info = getQuotaInfo(ip, deviceId, code);
    return sendJson(res, 200, info);
  }

  if (req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const code = String(body.code || '').trim().toUpperCase();
      const codeMap = parseRedeemCodes();
      if (!code || !Object.prototype.hasOwnProperty.call(codeMap, code)) {
        return sendJson(res, 400, { error: '兑换码不存在或格式有误，请核对后重试' });
      }
      const info = getQuotaInfo(ip, deviceId, code);
      if (info.remaining <= 0) {
        return sendJson(res, 400, { error: '该兑换码的可用次数已用完' });
      }
      return sendJson(res, 200, info);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  return sendJson(res, 405, { error: 'Method Not Allowed' });
}

async function handleChat(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  if (!CONFIG.apiKey) {
    return sendJson(res, 500, { error: '服务端尚未配置 DASHSCOPE_API_KEY 环境变量' });
  }

  const ip = getClientIp(req);
  const deviceId = getDeviceId(req);
  const redeemCode = getRedeemCode(req);

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  const { messages, useVision = false, enableSearch = false, temperature = 0.4 } = body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return sendJson(res, 400, { error: '缺少有效的 messages 参数' });
  }

  const quotaBefore = getQuotaInfo(ip, deviceId, redeemCode);
  if (quotaBefore.remaining <= 0) {
    return sendJson(res, 402, {
      code: 'QUOTA_EXCEEDED',
      error: '免费体验次数已用完，请输入兑换码继续使用',
      quota: quotaBefore
    });
  }

  if (useVision) {
    const ipOcr = (store.ips[ip] && store.ips[ip].ocrUsed) || 0;
    if (!quotaBefore.codeActive && ipOcr >= CONFIG.maxDailyOcrPerUser) {
      return sendJson(res, 429, { error: '图片识别请求过于频繁，请稍后再试或使用兑换码' });
    }
  }

  const model = useVision ? CONFIG.visionModel : CONFIG.textModel;
  const upstreamPayload = {
    model,
    messages,
    temperature: typeof temperature === 'number' ? temperature : 0.4
  };
  if (enableSearch && CONFIG.enableSearch && !useVision) {
    upstreamPayload.enable_search = true;
  }

  try {
    const upstreamRes = await fetch(CONFIG.apiBaseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CONFIG.apiKey
      },
      body: JSON.stringify(upstreamPayload)
    });

    const data = await upstreamRes.json().catch(() => ({}));
    if (!upstreamRes.ok) {
      const errMsg = (data.error && data.error.message) || `上游 AI 服务异常 (${upstreamRes.status})`;
      return sendJson(res, 502, { error: errMsg });
    }

    const content = extractModelContent(data);
    if (!content) {
      console.error('Empty model response structure:', JSON.stringify({
        model,
        useVision,
        keys: Object.keys(data || {}),
        choiceKeys: data && data.choices && data.choices[0] ? Object.keys(data.choices[0]) : []
      }));
      return sendJson(res, 502, { error: `模型（${model}）返回空内容，请检查模型名称或稍后重试` });
    }

    const quotaAfter = consumeQuota(ip, deviceId, redeemCode, useVision);
    return sendJson(res, 200, {
      content,
      quota: quotaAfter
    });
  } catch (err) {
    return sendJson(res, 500, { error: '调用 AI 服务失败：' + err.message });
  }
}

module.exports = {
  handleChat,
  handleQuota,
  CONFIG
};
