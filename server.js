const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleChat, handleQuota } = require('./core');

const PORT = parseInt(process.env.PORT || '9000', 10);
const INDEX_FILE = path.join(__dirname, 'index.html');

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/api/chat') return handleChat(req, res);
  if (urlPath === '/api/quota') return handleQuota(req, res);
  if (urlPath === '/health') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('OK');
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  fs.createReadStream(INDEX_FILE).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`offer · 投递搭子已启动: http://0.0.0.0:${PORT}`);
});
