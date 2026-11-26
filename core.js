const fs = require('fs');

const CONFIG = {
  apiBaseUrl: (process.env.API_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, ''),
  apiKey: process.env.DASHSCOPE_API_KEY || '',
  textModel: process.env.TEXT_MODEL || 'qwen-plus',
  // 识图默认走百炼通用兼容地址，避免与 qwen4-max 专属 ws-xxx 接入点冲突
  visionBaseUrl: (process.env.VISION_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, ''),
  visionModel: process.env.VISION_MODEL || 'qwen-vl-plus',
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

let store = { devices: {}, ips: {}, codes: {} };

function loadStore() {
  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        store = { devices: parsed.devices || {}, ips: parsed.ips || {}, codes: parsed.codes || {} };
      }
    }
  } catch (_) {}
}
function saveStore() {
  try { fs.writeFileSync(CONFIG.dataFile, JSON.stringify(store), 'utf-8'); } catch (_) {}
}
loadStore();

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '';
  return (typeof xff === 'string' && xff.trim()) ? xff.split(',')[0].trim() : ((req.socket && req.socket.remoteAddress) || 'unknown');
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
  if (res.destroyed || res.writableEnded) return;
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
    return { remaining: Math.max(0, total - used), freeTotal: CONFIG.freeTrialCount, codeActive: true, codeTotal: total };
  }
  const devUsed = (store.devices[deviceId] && store.devices[deviceId].used) || 0;
  const ipUsed = (store.ips[ip] && store.ips[ip].used) || 0;
  return { remaining: Math.max(0, CONFIG.freeTrialCount - Math.max(devUsed, ipUsed)), freeTotal: CONFIG.freeTrialCount, codeActive: false };
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
      if (raw.length > 15 * 1024 * 1024) reject(new Error('请求体过大（请减少截图数量）'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('无效的 JSON 请求体')); }
    });
    req.on('error', reject);
  });
}

function extractModelContent(data) {
  if (!data || typeof data !== 'object') return '';
  const choice = data.choices && data.choices[0];
  if (choice) {
    const c = choice.message && choice.message.content;
    if (typeof c === 'string' && c.trim()) return c;
    if (Array.isArray(c)) {
      const joined = c.map(p => (typeof p === 'string' ? p : (p && p.text) || '')).filter(Boolean).join('\n');
      if (joined.trim()) return joined;
    }
    if (typeof choice.text === 'string' && choice.text.trim()) return choice.text;
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
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  const ip = getClientIp(req);
  const deviceId = getDeviceId(req);
  if (req.method === 'GET') return sendJson(res, 200, getQuotaInfo(ip, deviceId, getRedeemCode(req)));
  if (req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const code = String(body.code || '').trim().toUpperCase();
      const codeMap = parseRedeemCodes();
      if (!code || !Object.prototype.hasOwnProperty.call(codeMap, code)) {
        return sendJson(res, 400, { error: '兑换码不存在或格式有误' });
      }
      const info = getQuotaInfo(ip, deviceId, code);
      if (info.remaining <= 0) return sendJson(res, 400, { error: '该兑换码可用次数已用完' });
      return sendJson(res, 200, info);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }
  return sendJson(res, 405, { error: 'Method Not Allowed' });
}

async function handleChat(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
  if (!CONFIG.apiKey) return sendJson(res, 500, { error: '服务端尚未配置 DASHSCOPE_API_KEY' });

  // 监听客户端断连（如手机端 Load failed / 切后台），断开时中止上游请求且不扣次数
  let clientDisconnected = false;
  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      abortController.abort();
    }
  });

  const ip = getClientIp(req);
  const deviceId = getDeviceId(req);
  const redeemCode = getRedeemCode(req);

  let body;
  try { body = await readJsonBody(req); } catch (err) { return sendJson(res, 400, { error: err.message }); }

  const { messages, useVision = false, enableSearch = false, temperature = 0.4 } = body || {};
  if (!Array.isArray(messages) || !messages.length) return sendJson(res, 400, { error: '缺少 messages 参数' });

  const quotaBefore = getQuotaInfo(ip, deviceId, redeemCode);
  if (quotaBefore.remaining <= 0) {
    return sendJson(res, 402, { code: 'QUOTA_EXCEEDED', error: '免费体验次数已用完，请输入兑换码继续使用', quota: quotaBefore });
  }

  const targetBaseUrl = useVision ? CONFIG.visionBaseUrl : CONFIG.apiBaseUrl;
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
    const upstreamRes = await fetch(targetBaseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CONFIG.apiKey
      },
      body: JSON.stringify(upstreamPayload),
      signal: abortController.signal
    });

    const rawText = await upstreamRes.text();
    let data = {};
    try { data = JSON.parse(rawText); } catch (_) {}

    if (clientDisconnected || res.destroyed || res.writableEnded) {
      return;
    }

    if (!upstreamRes.ok) {
      const errMsg = (data.error && data.error.message) || `上游接口报错 (${upstreamRes.status}): ${rawText.slice(0, 120)}`;
      return sendJson(res, 502, { error: errMsg });
    }

    const content = extractModelContent(data);
    if (!content) {
      return sendJson(res, 502, { error: `模型[${model}]返回空内容，原始响应: ${rawText.slice(0, 160)}` });
    }

    // 最终确认客户端仍在线，再扣减次数
    if (clientDisconnected || res.destroyed || res.writableEnded) {
      return;
    }

    const quotaAfter = consumeQuota(ip, deviceId, redeemCode, useVision);
    return sendJson(res, 200, { content, quota: quotaAfter });
  } catch (err) {
    if (clientDisconnected || err.name === 'AbortError') {
      return;
    }
    return sendJson(res, 500, { error: '调用 AI 服务失败：' + err.message });
  }
}

module.exports = { handleChat, handleQuota, CONFIG };
