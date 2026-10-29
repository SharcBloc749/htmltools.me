import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.zip': 'application/zip', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
export function createDevServer() {
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    try {
      const url = new URL(request.url, 'http://preview.invalid');
      if (url.pathname === '/') { response.writeHead(302, { Location: '/Advanced/' }).end(); return; }
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.split('/').some(part => part.startsWith('.') || part === 'node_modules')) { response.writeHead(404).end(); return; }
      let file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root)) { response.writeHead(404).end(); return; }
      if ((await stat(file)).isDirectory()) {
        if (!pathname.endsWith('/')) { response.writeHead(301, { Location: pathname + '/' + url.search }).end(); return; }
        file = path.join(file, 'index.html');
      }
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8000);
  createDevServer().listen(port, '0.0.0.0', () => console.log(`Advanced workspace listening on 0.0.0.0:${port} (open /Advanced/).`));
}
