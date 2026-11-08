import { MIN_DESKTOP_VIEWPORT } from '../e2e/helpers/desktopViewports.js';
import { admitPcmMetrics } from '../js/app/midi-ui/PcmEvidence.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LOCAL_AUDIO_SOURCES, launchAudioEvidenceBrowser } from './audio-evidence-runtime.js';

const option = (name, fallback) => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3) || fallback;
const sampleRates = option('sample-rates', '44100,48000,96000').split(',').map(Number);
if (!sampleRates.length || sampleRates.length > 8 || sampleRates.some(rate => !Number.isInteger(rate) || rate < 8000 || rate > 192000)) throw new Error('Invalid sample rate fixture list.');
const root = process.cwd(), directory = path.resolve(root, option('out-dir', 'temp/native-semantic-audio-evidence'));
const { browser, environment } = await launchAudioEvidenceBrowser();
const context = await browser.newContext({ viewport: MIN_DESKTOP_VIEWPORT, permissions: [] }).catch(async error => { await browser.close(); throw error; });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== 'http://127.0.0.1:8138') return route.abort();
  if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Native audio PCM fixtures</title>' });
  const relative = url.pathname.slice(1);
  if (!LOCAL_AUDIO_SOURCES.includes(relative)) return route.abort();
  return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(root, relative), 'utf8') });
});
try {
  await page.goto('http://127.0.0.1:8138/');
  const evidence = await page.evaluate(async rates => {
    const { BrowserNotePreview } = await import('/js/app/midi-ui/browserNotePreview.js');
    const { admitPcmBuffer, measurePcmWindow, comparePcmChannels } = await import('/js/app/midi-ui/PcmEvidence.js');
    const capabilities = { offlineAudioContext: typeof globalThis.OfflineAudioContext === 'function',
      audioWorklet: typeof globalThis.AudioWorkletNode === 'function', sharedArrayBuffer: typeof globalThis.SharedArrayBuffer === 'function',
      crossOriginIsolated: globalThis.crossOriginIsolated === true };
    if (!capabilities.offlineAudioContext) throw new Error('Required OfflineAudioContext capability is unavailable.');
    const patch = { status: 'ready', patch: { id: 'native-fixture', revision: 1, engineId: 'native-oscillator', engineVersion: 1,
      parameters: { waveform: 0, attackSeconds: 0.01, decaySeconds: 0.04, sustain01: 0.6, gain01: 0.8 },
      sampleRefs: [], voicePolicy: { maxVoices: 64 }, mix: { gain01: 0.8, pan01: 0 } }, receipt: { patchId: 'native-fixture', revision: 1 } };
    const intent = (voiceId, pressure01) => ({ version: 1, kind: 'begin', voiceId, generation: 1,
      pitch: { cents: 6000.125, referenceHz: 440 }, velocity01: 0.7501, expression: { pressure01 },
      sourceEventIds: ['physical:' + voiceId], onsetId: 'onset:' + voiceId, actorId: voiceId });
    const measure = (values, sampleRate, from, to) => measurePcmWindow([values], sampleRate, from, to);
    const render = async (sampleRate, reversed = false, crowd = 2, held = false) => {
      const seconds = held ? 61 : 0.6, raw = new globalThis.OfflineAudioContext(8, Math.ceil(sampleRate * seconds), sampleRate);
      const adapter = { state: 'running', get currentTime() { return raw.currentTime; }, sampleRate: raw.sampleRate, destination: raw.destination,
        createGain: () => raw.createGain(), createStereoPanner: () => raw.createStereoPanner(),
        createDynamicsCompressor: () => raw.createDynamicsCompressor(), createWaveShaper: () => raw.createWaveShaper(),
        createOscillator: () => raw.createOscillator(), close: () => Promise.resolve() };
      const preview = new BrowserNotePreview({ createAudioContext: () => adapter, nowMs: () => raw.currentTime * 1000, maxVoices: 64 });
      const session = preview.createSession('fixture'), backend = session.createInstrumentBackend({ gateMode: held ? 'owned' : 'bounded' });
      await backend.prepare(patch); await session.enable();
      const frame = time => Math.round(time * raw.sampleRate);
      if (held) backend.renewExecutionLease(1, 'fixture', frame(90));
      const receipts = [];
      for (let index = 0; index < crowd; index++) receipts.push(backend.begin(intent(index === 0 ? 'A' : index === 1 ? 'B' : 'crowd:' + index, index ? 0.3001 : 0.8001), frame(0.02), 'fixture'));
      const voices = [...preview._voices], merger = raw.createChannelMerger(8);
      merger.channelInterpretation = 'discrete'; merger.connect(raw.destination); preview._limiter.disconnect();
      const tapStereo = (node, first) => { const split = raw.createChannelSplitter(2); node.connect(split); split.connect(merger, 0, first); split.connect(merger, 1, first + 1); };
      tapStereo(preview._limiter, 0); voices[0].gain.connect(merger, 0, 2); voices[1]?.gain.connect(merger, 0, 3);
      voices[0].pressureGain.connect(merger, 0, 4); voices[1]?.pressureGain.connect(merger, 0, 5);
      const bus = preview._channels.get(session.getState().ownerId + ':0'); tapStereo(bus.pan || bus.gain, 6);
      if (!held) {
        const updates = [['A', { pitchOffsetCents: 200.001, pressure01: 0.5001 }, 0.1],
          ['A', { pressure01: 0.9001, pan01: -0.8 }, 0.102], ['B', { pitchOffsetCents: -200.001, pressure01: 0.2501 }, 0.12]];
        for (const [id, expression, time] of reversed ? updates.reverse() : updates) receipts.push(backend.update(id, expression, frame(time), 'fixture'));
        receipts.push(backend.end('B', { seconds: 0.04 }, frame(0.2), 'fixture'));
        receipts.push(backend.end('A', { seconds: 0.04 }, frame(0.3), 'fixture'));
      } else receipts.push(backend.end('A', { seconds: 0.04 }, frame(60.2), 'fixture'));
      const panicAt = held ? 60.5 : 0.45, suspension = raw.suspend(panicAt), rendering = raw.startRendering();
      await suspension; preview.panic(); await raw.resume();
      const buffer = await rendering;
      const data = admitPcmBuffer(buffer, 8);
      const report = { comparisonStatus: { permutation: 'not-applicable' }, metricStatus: { BAfterRelease: held ? 'not-applicable' : 'measured' }, requiredPcm: { channels: 8, frames: buffer.length, scope: 'all-retained-channels' }, requestedSampleRate: sampleRate, actualSampleRate: raw.sampleRate, crowd, ownedHeld: held,
        accepted: receipts.filter(receipt => receipt.status === 'accepted').length, expectedReceipts: receipts.length,
        full: measure(data[0], raw.sampleRate, 0, seconds),
        AAfterBRelease: measure(data[4], raw.sampleRate, held ? 60 : 0.25, held ? 60.15 : 0.29),
        BAfterRelease: held ? null : measure(data[5], raw.sampleRate, 0.25, 0.29),
        envelopeAfterPressure: measure(data[2], raw.sampleRate, 0.15, 0.19),
        postRelease: measure(data[4], raw.sampleRate, held ? 60.25 : 0.35, held ? 60.45 : 0.44),
        postPanic: measure(data[0], raw.sampleRate, panicAt + 0.01, seconds),
        afterPanic: preview.getState(), scope: 'digital-offline', smoothingSeconds: 0.008,
        sourcePrecision: 'explicit-frame-fixture', appliedFrameAcknowledgment: 'unavailable-native-nodes' };
      backend.dispose(); await preview.dispose(); return { report, data };
    };
    const reports = [];
    for (const sampleRate of rates) {
      const chronological = await render(sampleRate), shuffled = await render(sampleRate, true);
      const maxPermutationError = comparePcmChannels(chronological.data, shuffled.data);
      reports.push({ ...chronological.report, comparisonStatus: { permutation: 'measured' }, maxPermutationError, permutationTolerance: 1e-6 });
      for (const crowd of [16, 32, 64]) reports.push((await render(sampleRate, false, crowd)).report);
    }
    const held = await render(48000, false, 1, true); reports.push(held.report);
    return { engine: 'native-oscillator@1', capabilities, reports,
      evidence: { unit: 'separate-mocha-command', digitalOffline: 'executed', digitalRealtime: 'not-run', listened: 'not-run', physicalLoopback: 'not-run' } };
  }, sampleRates);
  for (const report of evidence.reports) {
    admitPcmMetrics(report, ['full.rms', 'full.peak', 'full.dc', 'full.frames', 'AAfterBRelease.rms', 'postRelease.peak', 'postPanic.peak']);
    if (report.comparisonStatus.permutation === 'measured') admitPcmMetrics(report, ['maxPermutationError', 'permutationTolerance']);
    if (report.metricStatus.BAfterRelease === 'measured') admitPcmMetrics(report, ['BAfterRelease.peak']);
  }
  evidence.environment = environment; evidence.errors = errors;
  evidence.sourceHashes = Object.fromEntries(await Promise.all(LOCAL_AUDIO_SOURCES.map(async file =>
    [file, createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')])));
  const failed = evidence.reports.filter(report => report.accepted !== report.expectedReceipts || report.full.nonfinite || report.full.peak >= 0.9 ||
    report.AAfterBRelease.rms <= 1e-5 || report.BAfterRelease?.peak > 1e-7 || report.postRelease.peak > 1e-7 ||
    report.postPanic.peak > 1e-7 || report.afterPanic.activeVoices || report.afterPanic.pendingNotes ||
    (report.maxPermutationError != null && report.maxPermutationError > report.permutationTolerance));
  evidence.passed = !errors.length && !failed.length;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'native-semantic.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ passed: evidence.passed, environment, cases: evidence.reports.length,
    sampleRates, failed: failed.map(report => ({ sampleRate: report.actualSampleRate, crowd: report.crowd, held: report.ownedHeld })),
    output: path.join(directory, 'native-semantic.json') }, null, 2));
  if (!evidence.passed) throw new Error('Native semantic PCM fixture failed.');
} finally { await context.close(); await browser.close(); }
