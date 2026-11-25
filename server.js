const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleChat, handleQuota } = require('./lib/core');

const PORT = parseInt(process.env.PORT || '9000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/api/chat') {
    return handleChat(req, res);
  }
  if (urlPath === '/api/quota') {
    return handleQuota(req, res);
  }
  if (urlPath === '/health') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('OK');
  }

  // Static files from /public
  const safePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const fullPath = path.join(PUBLIC_DIR, safePath);
  if (!fullPath.startsWith(PUBLIC_DIR) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    // Fallback to index.html
    const indexFile = path.join(PUBLIC_DIR, 'index.html');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return fs.createReadStream(indexFile).pipe(res);
  }

  const ext = path.extname(fullPath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  fs.createReadStream(fullPath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`offer · 投递搭子已启动: http://0.0.0.0:${PORT}`);
});
