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
    save
