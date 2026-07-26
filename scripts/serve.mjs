import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml' };

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep) && target !== path.join(root, 'index.html')) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (error, body) => {
    if (error) {
      response.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type':types[path.extname(target)] || 'application/octet-stream', 'Cache-Control':'no-store' }).end(body);
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`TeleMLEBench preview: http://127.0.0.1:${port}/`);
});
