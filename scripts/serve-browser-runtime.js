import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createBrowserDeploymentHeaders } from '../js/runtime/BrowserDeploymentPolicy.js';

let root = path.resolve('dist/browser'), host = '127.0.0.1', port = 8443, isolated = true, cert = null, key = null, nativeBridgeUrl = null, name = 'server';
for (const argument of process.argv.slice(2)) {
  const split = argument.indexOf('='), option = argument.slice(0, split), value = argument.slice(split + 1);
  if (split < 0) throw new Error('Use named deployment options.');
  if (option === '--root') root = path.resolve(value);
  else if (option === '--host') host = value;
  else if (option === '--port') port = Number(value);
  else if (option === '--isolation' && ['same-origin', 'none'].includes(value)) isolated = value === 'same-origin';
  else if (option === '--cert') cert = value;
  else if (option === '--key') key = value;
  else if (option === '--native-bridge') nativeBridgeUrl = value;
  else if (option === '--name') name = value;
  else throw new Error('Unknown deployment option: ' + option);
}
if (!Number.isInteger(port) || port < 1 || port > 65535 || !host || Boolean(cert) !== Boolean(key)) throw new Error('Choose a valid port/host and both TLS certificate files.');
root = await fs.realpath(root);
if (!(await fs.stat(root)).isDirectory()) throw new Error('Serve an existing built application directory.');
const common = await createBrowserDeploymentHeaders({ isolated, nativeBridgeUrl }), documents = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const within = target => { const relative = path.relative(root, target); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const handle = async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { ...common, Allow: 'GET, HEAD' }); response.end(); return; }
    const url = new URL(request.url, 'http://deployment.invalid'), relative = decodeURIComponent(url.pathname);
    if (relative.includes('\0') || relative.includes('\\') || relative.split('/').some(part => part === '..' || part === '.')) throw new Error('Invalid application path.');
    const target = path.resolve(root, '.' + relative + (relative.endsWith('/') ? 'index.html' : ''));
    if (!within(target)) throw new Error('Application path escapes the selected directory.');
    const real = await fs.realpath(target), stat = await fs.stat(real);
    if (!within(real) || !stat.isFile() || stat.size > 256 * 1048576) throw new Error('Application file is unavailable.');
    const type = mime[path.extname(real)] || 'application/octet-stream';
    let headers = common;
    if (path.extname(real) === '.html') {
      if (stat.size > 2 * 1048576) throw new Error('Application document exceeds its bound.');
      const version = stat.mtimeMs + ':' + stat.size, previous = documents.get(real);
      if (!previous || previous.version !== version) {
        if (documents.size >= 64) documents.delete(documents.keys().next().value);
        documents.set(real, { version, headers: await createBrowserDeploymentHeaders({ html: await fs.readFile(real, 'utf8'), isolated, nativeBridgeUrl }) });
      }
      headers = documents.get(real).headers;
    }
    let start = 0, end = stat.size - 1, status = 200;
    if (request.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (!match || (!match[1] && !match[2])) { response.writeHead(416, { ...common, 'Content-Range': 'bytes */' + stat.size }); response.end(); return; }
      start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end; status = 206;
      if (![start, end].every(Number.isSafeInteger) || start < 0 || start > end || end >= stat.size) { response.writeHead(416, { ...common, 'Content-Range': 'bytes */' + stat.size }); response.end(); return; }
    }
    response.writeHead(status, { ...headers, 'Content-Type': type, 'Content-Length': stat.size ? end - start + 1 : 0, 'Accept-Ranges': 'bytes',
      ...(status === 206 ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size } : {}),
      'Cache-Control': /(?:^|[\\/])[a-f0-9]{64}[\\/]/.test(real) ? 'public, max-age=31536000, immutable' : 'no-cache' });
    if (request.method === 'HEAD' || !stat.size) response.end(); else await pipeline(createReadStream(real, { start, end }), response);
  } catch (error) {
    if (response.headersSent) response.destroy(error);
    else { response.writeHead(error.code === 'ENOENT' ? 404 : 400, common); response.end('Application resource unavailable.'); }
  }
};
const server = cert ? https.createServer({ cert: await fs.readFile(cert), key: await fs.readFile(key) }, handle) : http.createServer(handle);
server.maxHeadersCount = 64; server.headersTimeout = 15000; server.requestTimeout = 30000;
server.listen(port, host, () => process.stdout.write(JSON.stringify({ name, root, url: (cert ? 'https' : 'http') + '://' + host + ':' + port,
  isolation: isolated ? 'same-origin;verify-crossOriginIsolated-in-client' : 'none;bounded-message-port-fallback', policy: 'self-script-and-exact-bootstrap-hashes;no-eval-or-inline-event-handlers' }) + '\n'));
