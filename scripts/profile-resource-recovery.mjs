import { MIN_DESKTOP_VIEWPORT } from '../e2e/helpers/desktopViewports.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildBrowserRuntime } from './BrowserRuntimeBuild.js';
import { launchAudioEvidenceBrowser } from './audio-evidence-runtime.js';
import { RESOURCE_RECOVERY_CASES, summarizeResourceSamples, evaluateResourceRecoveryEvidence } from './ResourceRecoveryEvidence.js';
import { runResourceRecoveryBrowserScenario } from './ResourceRecoveryBrowserScenario.js';
const root = fileURLToPath(new URL('../', import.meta.url)), options = {};
for (const argument of process.argv.slice(2)) { const match = /^--(out-dir|browser|channel|executable)=(.+)$/.exec(argument); if (!match || options[match[1]]) throw new Error('Unknown/repeated resource qualification option.'); options[match[1]] = match[2]; }
if (!options['out-dir']) throw new Error('Explicit new --out-dir=temp/... required. This command runs deferred browser/resource qualification.');
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const output = path.resolve(root, options['out-dir']); if (!inside(path.join(root, 'temp'), output)) throw new Error('Qualification reports must be inside project temp/.');
await fs.mkdir(path.dirname(output), { recursive: true }); if (!inside(path.join(await fs.realpath(root), 'temp'), path.join(await fs.realpath(path.dirname(output)), path.basename(output)))) throw new Error('Output ancestor escapes temp/.'); await fs.mkdir(output);
const sha256 = value => createHash('sha256').update(value).digest('hex'), outputDir = path.join(root, 'dist', 'resource-qualification-' + randomUUID());
const build = await buildBrowserRuntime({ rootDir: root, outputDir });
const files = new Map(build.manifest.files.map(file => ['/' + build.buildId + '/' + file.path, file]));
files.set('/' + build.buildId + '/runtime-build.json', { path: 'runtime-build.json', sha256: sha256(await fs.readFile(path.join(build.path, 'runtime-build.json'))) });
const sourceSnapshot = { ...build.manifest, harness: await Promise.all(['scripts/profile-resource-recovery.mjs', 'scripts/ResourceRecoveryBrowserScenario.js', 'scripts/ResourceRecoveryEvidence.js'].map(async name => ({ path: name, sha256: sha256(await fs.readFile(path.join(root, name))) }))) };
const fixtures = [], fixtureBytes = new Map();
for (let index = 0; index < 8; index++) {
  const frames = 480000, channels = 2, rate = 48000, bytes = Buffer.alloc(44 + frames * channels * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28); bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  // Original deterministic nonmusical memory fixture, not a recording or content-quality reference.
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) bytes.writeInt16LE(((frame * (index + 1) * 31 + channel * 113) % 32768) - 16384, 44 + (frame * channels + channel) * 2);
  const contentHash = sha256(bytes); fixtureBytes.set('/fixtures/' + contentHash + '.wav', bytes);
  fixtures.push({ contentHash, bytes: bytes.length, path: 'fixtures/' + contentHash + '.wav', mime: 'audio/wav', channels, sourceSampleRate: rate, frames, decodeVersion: 'web-audio-wav-v1', licenseId: 'CC0-1.0', attribution: 'Original deterministic qualification memory fixture; not a field recording.' });
}
await fs.writeFile(path.join(output, 'source-snapshot.json'), JSON.stringify({ ...sourceSnapshot, fixtures }, null, 2), { flag: 'wx' });
const mime = name => name.endsWith('.html') ? 'text/html' : /\.[cm]?js$/.test(name) ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.png') ? 'image/png' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1'); if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    const fixture = fixtureBytes.get(url.pathname); if (fixture) { response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': fixture.length }).end(fixture); return; }
    const file = files.get(url.pathname); if (!file) { response.writeHead(404).end(); return; }
    const bytes = await fs.readFile(path.join(build.path, file.path)); if (sha256(bytes) !== file.sha256) throw new Error('Immutable qualification source changed.');
    response.writeHead(200, { 'Content-Type': mime(file.path), 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(bytes);
  } catch { if (!response.headersSent) response.writeHead(500); response.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + server.address().port;
const report = { schema: 'resource-recovery-profile/v1', applicationBuildId: build.buildId, sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceSnapshotHash: sha256(JSON.stringify(sourceSnapshot)),
  scope: 'actual immutable application, native offline decode, real renderer/CCTV, real worker recovery and candidate replacement; no audio/hardware qualification', cases: [] };
let browser;
try {
  const launched = await launchAudioEvidenceBrowser(); browser = launched.browser; report.environment = { ...launched.environment, measurementScope: 'resource-and-recovery-browser-workload', realtime: 'simulation-and-interaction-measured; audio-not-qualified' };
  for (const required of RESOURCE_RECOVERY_CASES) {
    const context = await browser.newContext({ viewport: MIN_DESKTOP_VIEWPORT, deviceScaleFactor: required.dpr, permissions: [], serviceWorkers: 'block' });
    const page = await context.newPage(), browserErrors = [], driverClicks = []; page.on('pageerror', error => browserErrors.push(String(error.message).slice(0, 1024)));
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    let row = { ...required }, expired = false; const caseTimer = setTimeout(() => { expired = true; void context.close().catch(() => {}); }, 600000);
    try {
      await page.goto(`${origin}/${build.buildId}/procgen.html?e2e=1&startup=fresh&seed=42&lanes=${required.laneCount}`);
      await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled, null, { timeout: 180000 });
      let done = false; const work = page.evaluate(runResourceRecoveryBrowserScenario, { ...required, buildId: build.buildId, fixtures, origin }).finally(() => { done = true; });
      work.catch(() => {}); const deadline = Date.now() + 600000;
      while (!done && Date.now() < deadline) {
        if (await page.evaluate(() => !!window.__RESOURCE_QUALIFICATION_ACTIVE__).catch(() => false)) {
          const started = performance.now(); try { await page.locator('#resource-qualification-pulse').click({ timeout: 5000 }); driverClicks.push({ elapsedMs: performance.now() - started, outcome: 'delivered' }); }
          catch (error) { driverClicks.push({ elapsedMs: performance.now() - started, outcome: 'failed', reason: error.name }); }
        }
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      if (!done) { row.error = 'Scenario deadline exceeded; browser owner terminated without a fabricated cleanup receipt.'; await page.close(); await work.catch(() => {}); }
      else row = await work;
      if (row.samples) row.timing = Object.fromEntries(Object.entries(row.samples).map(([key, values]) => [key, summarizeResourceSamples(values)]));
    } catch (error) { row.error = String(error.message).slice(0, 4096); }
    finally { clearTimeout(caseTimer); if (expired) row.error = 'Scenario deadline exceeded; context retirement requested, no workload completion inferred.'; row.browserErrors = browserErrors; row.driverClicks = driverClicks; report.cases.push(row); await fs.writeFile(path.join(output, `case-${required.laneCount}-${required.dpr}.json`), JSON.stringify(row, null, 2), { flag: 'wx' }); await context.close(); }
  }
  report.evaluation = evaluateResourceRecoveryEvidence(report);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  process.stdout.write(JSON.stringify({ applicationBuildId: build.buildId, evaluation: report.evaluation, directory: path.relative(root, output) }, null, 2) + '\n');
  if (report.evaluation.status !== 'measured-profile-passed') process.exitCode = 1;
} finally { await browser?.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); }); }
