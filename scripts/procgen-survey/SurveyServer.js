import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const surveyRoot = fileURLToPath(new URL('../../', import.meta.url));
const COMMANDS = new Set(['pause', 'resume', 'step', 'cancel']);
const STATIC_FOLDERS = new Set(['js', 'css', 'assets', 'img', 'lemmings', 'lemmings_ohno', 'holiday93', 'holiday94', 'xmas91', 'xmas92']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.dat': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };
const send = (response, status, value) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
};
const readCommand = request => new Promise((resolve, reject) => {
  let bytes = 0, chunks = [], settled = false;
  const fail = error => { if (!settled) { settled = true; reject(error); } };
  request.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 512) { chunks = []; fail(new Error('Control body exceeds 512 bytes')); } else if (!settled) chunks.push(chunk);
  });
  request.on('end', () => { if (!settled) { settled = true; try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Invalid control JSON')); } } });
  request.on('error', fail); request.on('aborted', () => fail(new Error('Control request aborted')));
});

const createSurveyServer = async ({ getState, onControl } = {}) => {
  if (typeof getState !== 'function' || typeof onControl !== 'function') throw new Error('Survey server requires cached state and control callbacks');
  const token = randomBytes(32).toString('hex'), tokenBytes = Buffer.from(token), rootReal = await fs.realpath(surveyRoot);
  let origin, closing = null;
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host) { send(response, 403, { error: 'Invalid local survey host' }); return; }
      const rawPath = decodeURIComponent(request.url.split('?')[0]);
      if (rawPath.includes('\\') || rawPath.split('/').some(segment => segment.startsWith('.'))) { send(response, 404, { error: 'Invalid survey path' }); return; }
      const target = new URL(request.url, origin), pathname = decodeURIComponent(target.pathname);
      if (pathname === '/survey-api/report') {
        if (request.method !== 'GET') { send(response, 405, { error: 'Use GET for cached report' }); return; }
        const data = JSON.stringify(await getState());
        if (Buffer.byteLength(data) > 8 * 1048576) { send(response, 413, { error: 'Cached survey report exceeds 8 MiB' }); return; }
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(data); return;
      }
      if (pathname === '/survey-api/control') {
        if (request.method !== 'POST') { send(response, 405, { error: 'Use POST for survey controls' }); return; }
        const provided = Buffer.from(String(request.headers['x-survey-token'] || ''));
        if (provided.length !== tokenBytes.length || !timingSafeEqual(provided, tokenBytes) || request.headers.origin && request.headers.origin !== origin || request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) { send(response, 403, { error: 'Survey control requires its local token and origin' }); return; }
        const declaredBytes = Number(request.headers['content-length'] || 0);
        if (!Number.isFinite(declaredBytes) || declaredBytes > 512) { send(response, 413, { error: 'Control body exceeds 512 bytes' }); return; }
        let input;
        try { input = await readCommand(request); } catch (error) { send(response, error.message.includes('exceeds') ? 413 : 400, { error: error.message }); return; }
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !COMMANDS.has(input.command)) { send(response, 400, { error: 'Declare exactly one fixed survey command' }); return; }
        const state = await onControl(input.command); send(response, 200, { accepted: input.command, state: state ?? null }); return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') { send(response, 405, { error: 'Static survey files are read-only' }); return; }
      const segments = pathname.split('/').filter(Boolean), lower = segments.map(segment => segment.toLowerCase());
      const denied = pathname.includes('\\') || segments.some(segment => segment.startsWith('.')) || lower.some(segment => ['index-code', 'index-prose', 'vendor', 'node_modules'].includes(segment));
      const extension = path.extname(pathname).toLowerCase(), allowed = segments.length === 1 ? extension === '.html' && ['procgen-survey.html', 'procgen.html'].includes(lower[0]) : STATIC_FOLDERS.has(lower[0]) || ['scripts', 'tools'].includes(lower[0]) && ['.js', '.mjs'].includes(extension);
      if (denied || !allowed || !MIME[extension]) { send(response, 404, { error: 'File is outside survey static scope' }); return; }
      const file = path.resolve(surveyRoot, '.' + pathname);
      if (!file.startsWith(path.resolve(surveyRoot) + path.sep)) { send(response, 404, { error: 'Invalid survey path' }); return; }
      let resolved, bytes;
      try { resolved = await fs.realpath(file); if (!resolved.toLowerCase().startsWith(rootReal.toLowerCase() + path.sep)) { send(response, 404, { error: 'External static target denied' }); return; } bytes = await fs.readFile(resolved); }
      catch (error) { if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) { send(response, 404, { error: 'Survey file missing' }); return; } throw error; }
      response.writeHead(200, { 'Content-Type': MIME[extension], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) { if (!response.headersSent) send(response, 500, { error: 'Survey request failed: ' + error.message }); else response.end(); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + server.address().port;
  const close = () => {
    closing ||= new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); }); return closing;
  };
  return { url: origin + '/procgen-survey.html', origin, token, close };
};
export { createSurveyServer };
