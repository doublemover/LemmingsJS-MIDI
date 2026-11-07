export { readAudioEvidenceOptions, launchAudioEvidenceBrowser } from './audio-evidence-browser.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRuntimeSourceClosure } from './RuntimeSourceClosure.js';

const LOCAL_AUDIO_ENTRIES = Object.freeze([
  'e2e/helpers/nativeAudioFixture.js', 'js/app/midi-ui/browserNotePreview.js', 'js/app/midi-ui/nativeOscillatorBackend.js',
  'js/app/midi-ui/TimedControlTimeline.js', 'js/app/midi-ui/SmoothedAudioParameter.js',
  'js/app/midi-ui/AudioObservationLeases.js', 'js/midi/scheduler/LocalAudioVoiceBudget.js',
  'js/app/midi-ui/AudioResourceLeases.js', 'js/app/midi-ui/PcmEvidence.js',
  'js/app/midi-ui/AudioDisplayTelemetry.js',
  'js/app/midi-ui/AudioAssetRef.js', 'js/app/midi-ui/AudioAssetLoader.js',
  'js/app/midi-ui/sampleInstrumentBackend.js',
  'js/app/midi-ui/AudioCommandQueue.js', 'js/app/midi-ui/workletInstrumentBackend.js',
  'js/app/midi-ui/worklet/OwnedSineProcessor.js'
]);
export const AUDIO_EVIDENCE_SOURCE_LIMITS = Object.freeze({ maxFiles: 1024, maxBytes: 16 * 1048576, maxFileBytes: 4 * 1048576 });
const sourceClosure = await collectRuntimeSourceClosure({ rootDir: fileURLToPath(new URL('../', import.meta.url)), entries: LOCAL_AUDIO_ENTRIES, ...AUDIO_EVIDENCE_SOURCE_LIMITS });
if (sourceClosure.dependencies.length) throw new Error('Audio evidence requires a complete local module closure.');
const LOCAL_AUDIO_SOURCES = Object.freeze(sourceClosure.files.map(file => file.path));

const startAudioEvidenceServer = async (root = process.cwd()) => {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname, relative = pathname.slice(1);
    if (request.method !== 'GET' || pathname !== '/' && !LOCAL_AUDIO_SOURCES.includes(relative)) { response.writeHead(404); response.end(); return; }
    try {
      const body = pathname === '/' ? '<!doctype html><title>First-party audio fixtures</title>' : await fs.readFile(path.join(root, relative));
      const contentType = pathname === '/' ? 'text/html; charset=utf-8' : relative.endsWith('.json') ? 'application/json; charset=utf-8' : relative.endsWith('.wasm') ? 'application/wasm' : relative.endsWith('.wav') ? 'audio/wav' : 'text/javascript; charset=utf-8';
      response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }); response.end(body);
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { origin: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
};

export { LOCAL_AUDIO_SOURCES, startAudioEvidenceServer };
