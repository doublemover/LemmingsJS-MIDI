import { chromium, firefox, webkit } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRuntimeSourceClosure } from './RuntimeSourceClosure.js';

const LOCAL_AUDIO_ENTRIES = Object.freeze([
  'js/app/midi-ui/browserNotePreview.js', 'js/app/midi-ui/nativeOscillatorBackend.js',
  'js/app/midi-ui/TimedControlTimeline.js', 'js/app/midi-ui/SmoothedAudioParameter.js',
  'js/app/midi-ui/AudioObservationLeases.js', 'js/midi/scheduler/LocalAudioVoiceBudget.js',
  'js/app/midi-ui/AudioResourceLeases.js', 'js/app/midi-ui/PcmEvidence.js',
  'js/app/midi-ui/AudioDisplayTelemetry.js',
  'js/app/midi-ui/AudioAssetRef.js', 'js/app/midi-ui/AudioAssetLoader.js',
  'js/app/midi-ui/sampleInstrumentBackend.js',
  'js/app/midi-ui/AudioCommandQueue.js', 'js/app/midi-ui/workletInstrumentBackend.js',
  'js/app/midi-ui/worklet/OwnedSineProcessor.js'
]);
const sourceClosure = await collectRuntimeSourceClosure({ rootDir: fileURLToPath(new URL('../', import.meta.url)), entries: LOCAL_AUDIO_ENTRIES, maxFiles: 256, maxBytes: 16 * 1048576 });
if (sourceClosure.dependencies.length) throw new Error('Audio evidence requires a complete local module closure.');
const LOCAL_AUDIO_SOURCES = Object.freeze(sourceClosure.files.map(file => file.path));
const readAudioEvidenceOptions = (args = process.argv.slice(2)) => {
  const value = name => args.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
  const browserName = value('browser') || 'chromium', channel = value('channel') || null, executablePath = value('executable') || null;
  if (!['chromium', 'firefox', 'webkit'].includes(browserName)) throw new Error('Audio evidence browser must be chromium, firefox or webkit.');
  if (channel && browserName !== 'chromium') throw new Error('--channel is supported only for Chromium browsers.');
  if (channel && executablePath) throw new Error('Select either --channel or --executable.');
  return Object.freeze({ browserName, channel, executablePath });
};
const launchAudioEvidenceBrowser = async (options = readAudioEvidenceOptions()) => {
  const type = { chromium, firefox, webkit }[options.browserName];
  if (!type) throw new Error('Unknown audio evidence browser.');
  const browser = await type.launch({ headless: true,
    ...(options.browserName === 'chromium' ? { chromiumSandbox: true, args: ['--mute-audio'] } : {}),
    ...(options.channel ? { channel: options.channel } : {}),
    ...(options.executablePath ? { executablePath: options.executablePath } : {}) });
  return { browser, environment: Object.freeze({ browserName: options.browserName, browserVersion: browser.version(),
    channel: options.channel, customExecutable: !!options.executablePath, measurementScope: 'digital-offline',
    chromiumSandbox: options.browserName === 'chromium' ? true : null,
    realtime: 'not-run', listened: 'not-run', physicalLoopback: 'not-run' }) };
};

const startAudioEvidenceServer = async (root = process.cwd()) => {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname, relative = pathname.slice(1);
    if (request.method !== 'GET' || pathname !== '/' && !LOCAL_AUDIO_SOURCES.includes(relative)) { response.writeHead(404); response.end(); return; }
    try {
      const body = pathname === '/' ? '<!doctype html><title>First-party audio fixtures</title>' : await fs.readFile(path.join(root, relative));
      response.writeHead(200, { 'Content-Type': pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(body);
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { origin: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
};

export { LOCAL_AUDIO_SOURCES, readAudioEvidenceOptions, launchAudioEvidenceBrowser, startAudioEvidenceServer };
