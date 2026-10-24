import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const types = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.html': 'text/html', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
export async function browserGenerationServer({ directory, scope = '/release/', unavailable = () => false }) {
  const absolute = path.resolve(directory);
  const server = http.createServer((request, response) => {
    const respond = async () => {
      const url = new URL(request.url, 'http://fixture.invalid');
      const relative = url.pathname.slice(scope.length) || 'index.html';
      if (!url.pathname.startsWith(scope) || !/^[A-Za-z0-9_./@-]+$/.test(relative) || relative.split('/').some(part => !part || part === '..' || part === '.') || unavailable(relative)) {
        response.writeHead(404); response.end(); return;
      }
      const file = path.resolve(absolute, relative);
      if (!file.startsWith(absolute + path.sep)) { response.writeHead(404); response.end(); return; }
      try {
        const bytes = await fs.readFile(file);
        response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'content-length': bytes.byteLength });
        response.end(bytes);
      } catch { response.writeHead(404); response.end(); }
    };
    respond().catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}${scope}`, async close() {
    server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}
