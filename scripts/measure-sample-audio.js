import { MIN_DESKTOP_VIEWPORT } from '../e2e/helpers/desktopViewports.js';
import { admitPcmMetrics } from '../js/app/midi-ui/PcmEvidence.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LOCAL_AUDIO_SOURCES, launchAudioEvidenceBrowser, startAudioEvidenceServer } from './audio-evidence-runtime.js';

const option = (name, fallback) => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3) || fallback;
const rates = option('sample-rates', '44100,48000,96000').split(',').map(Number);
if (!rates.length || rates.length > 8 || rates.some(rate => !Number.isInteger(rate) || rate < 8000 || rate > 192000)) throw new Error('Invalid audio fixture rates.');
const root = process.cwd(), directory = path.resolve(root, option('out-dir', 'temp/sample-audio-evidence'));
const { browser, environment } = await launchAudioEvidenceBrowser();
const browserContext = await browser.newContext({ viewport: MIN_DESKTOP_VIEWPORT, permissions: [] }).catch(async error => { await browser.close(); throw error; });
const page = await browserContext.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
let server = null;
try {
  server = await startAudioEvidenceServer(root); await page.goto(server.origin);
  const evidence = await page.evaluate(async rates => {
    const { BrowserNotePreview } = await import('/js/app/midi-ui/browserNotePreview.js');
    const { admitPcmBuffer, measurePcmWindow, comparePcmChannels, requireFiniteMetric } = await import('/js/app/midi-ui/PcmEvidence.js');
    const { createAudioAssetLoader } = await import('/js/app/midi-ui/AudioAssetLoader.js');
    const { DECODER_VERSION } = await import('/js/app/midi-ui/AudioAssetRef.js');
    const sourceRate = 44100, sourceFrames = sourceRate, bytes = new Uint8Array(44 + sourceFrames * 2), view = new DataView(bytes.buffer);
    const four = (at, text) => { for (let n = 0; n < 4; n++) bytes[at + n] = text.charCodeAt(n); };
    four(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); four(8, 'WAVE'); four(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sourceRate, true); view.setUint32(28, sourceRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); four(36, 'data'); view.setUint32(40, sourceFrames * 2, true);
    for (let n = 0; n < sourceFrames; n++) view.setInt16(44 + n * 2, Math.round(26000 * Math.sin(2 * Math.PI * 200 * n / sourceRate)), true);
    const hash = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('');
    const ref = { contentHash: hash, bytes: bytes.length, mime: 'audio/wav', channels: 1, sourceSampleRate: sourceRate,
      frames: sourceFrames, decodeVersion: DECODER_VERSION, licenseId: 'CC0-1.0', attribution: 'Original generated test sine', path: 'fixtures/sine.wav' };
    const measure = (values, sampleRate, from, to) => measurePcmWindow([values], sampleRate, from, to);
    const pitchError = (data, sampleRate, expected) => {
      let first = null, last = null, crossings = 0;
      for (let n = Math.ceil(0.2 * sampleRate); n < Math.floor(0.29 * sampleRate); n++) if (data[n - 1] <= 0 && data[n] > 0) {
        const crossing = n - 1 - data[n - 1] / (data[n] - data[n - 1]); if (first == null) first = crossing; last = crossing; crossings++;
      }
      if (crossings < 3) throw new Error('Required pitch metric has insufficient crossings.');
      return requireFiniteMetric(1200 * Math.log2((crossings - 1) * sampleRate / (last - first) / expected), 'pitch error');
    };
    const run = async (sampleRate, reversed, crowd = 2, chokeCancellation = false) => {
      const raw = new globalThis.OfflineAudioContext(6, sampleRate, sampleRate);
      const adapter = { state: 'running', sampleRate, get currentTime() { return raw.currentTime; }, destination: raw.destination,
        createGain: () => raw.createGain(), createBufferSource: () => raw.createBufferSource(), createStereoPanner: () => raw.createStereoPanner(),
        createWaveShaper: () => raw.createWaveShaper(), createDynamicsCompressor: () => raw.createDynamicsCompressor(),
        decodeAudioData: input => raw.decodeAudioData(input), close: async () => {} };
      const preview = new BrowserNotePreview({ createAudioContext: () => adapter, nowMs: () => raw.currentTime * 1000, maxVoices: 64 });
      const live = preview.createSession('live'), cue = preview.createSession('cue'); await live.enable(); await cue.enable();
      const loader = createAudioAssetLoader({ getContext: () => adapter, fetchAsset: () => bytes }), pin = await loader.acquire(ref);
      const selected = { domain: 'source-frames', assetHash: hash, rootCents: 6000, onsetFrame: 4410, endFrame: 30870,
        loop: { mode: 'sustain', startFrame: 8820, endFrame: 17640, crossfadeFrames: 0 }, selectionSeed: 123,
        pitchRange: { minCents: 5400, maxCents: 6600 },
        releaseRegion: { domain: 'source-frames', assetHash: hash, rootCents: 6000, onsetFrame: 30870, endFrame: 39690, gain01: 0.3 } };
      if (chokeCancellation) selected.chokeGroup = 'fixture-hat';
      let selections = 0;
      const resolveRegion = () => { selections++; return selected; };
      const A = await live.createSampleInstrumentBackend({ resolveRegion }), B = await cue.createSampleInstrumentBackend({ resolveRegion });
      const patch = { status: 'ready', patch: { id: 'sample-fixture', revision: 1, engineId: 'native-sample', engineVersion: 1,
        parameters: { gain01: 0.7, attackSeconds: 0.005 }, sampleRefs: [{ sha256: hash, bytes: bytes.length, required: true }],
        mix: { gain01: 0.8, pan01: 0 }, voicePolicy: { maxVoices: 64 } }, receipt: { patchId: 'sample-fixture', revision: 1 } };
      for (const backend of [A, B]) if ((await backend.prepare(patch, [pin])).status !== 'ready') throw new Error('Sample prepare failed.');
      const frame = time => Math.round(time * sampleRate), receipts = [], intent = voiceId => ({ version: 1, kind: 'begin', voiceId,
        generation: 1, pitch: { cents: 6000, referenceHz: 440 }, velocity01: 0.8, expression: {}, onsetId: voiceId, actorId: voiceId });
      for (const backend of [A, B]) receipts.push(backend.renewExecutionLease(1, 'fixture', frame(2)));
      if (chokeCancellation) receipts.push(A.renewExecutionLease(2, 'fixture', frame(2)));
      receipts.push(A.begin(intent('A'), frame(0.02), 'fixture')); receipts.push(B.begin(intent('B'), frame(0.02), 'fixture'));
      const [voiceA, voiceB] = [...preview._voices], merger = raw.createChannelMerger(6); merger.connect(raw.destination); preview._limiter.disconnect();
      for (let n = 2; n < crowd; n++) receipts.push(A.begin(intent('crowd:' + n), frame(0.02), 'fixture'));
      const maximumReservedSources = preview._renderVoiceCount();
      const overflow = crowd === 32 ? A.begin(intent('overflow'), frame(0.02), 'fixture') : null;
      const split = raw.createChannelSplitter(2); preview._limiter.connect(split); split.connect(merger, 0, 0); split.connect(merger, 1, 1);
      voiceA.pressureGain.connect(merger, 0, 2); voiceB.pressureGain.connect(merger, 0, 3);
      voiceA.main.gain.connect(merger, 0, 4); voiceB.child.gain.connect(merger, 0, 5);
      const updates = [[A, 'A', { pitchOffsetCents: 600 }, 0.12], [B, 'B', { pitchOffsetCents: -600 }, 0.12],
        [A, 'A', { pressure01: 0.5 }, 0.15], [B, 'B', { pressure01: 0.3 }, 0.17]];
      if (reversed) {
        receipts.push(B.end('B', { seconds: 0.04, velocity01: 0.25 }, frame(0.3), 'fixture'));
        receipts.push(A.end('A', { seconds: 0.04, velocity01: 0.75 }, frame(0.5), 'fixture'));
      }
      for (const [backend, id, expression, time] of reversed ? updates.reverse() : updates) receipts.push(backend.update(id, expression, frame(time), 'fixture'));
      if (!reversed) {
        receipts.push(B.end('B', { seconds: 0.04, velocity01: 0.25 }, frame(0.3), 'fixture'));
        receipts.push(A.end('A', { seconds: 0.04, velocity01: 0.75 }, frame(0.5), 'fixture'));
      }
      if (crowd === 2) {
        receipts.push(A.begin(intent('future'), frame(0.85), 'fixture'));
        receipts.push(A.begin({ ...intent('canceled'), generation: chokeCancellation ? 2 : 1 }, frame(chokeCancellation ? 0.3 : 0.05), 'fixture'));
        if (!chokeCancellation) receipts.push(A.end('canceled', { seconds: 0.04 }, frame(0.04), 'fixture'));
      } else for (let n = 2; n < crowd; n++) receipts.push(A.end('crowd:' + n, { seconds: 0.04 }, frame(0.5), 'fixture'));
      pin.release(); loader.dispose();
      const cancelChoke = chokeCancellation ? raw.suspend(0.1) : null;
      const cueStop = raw.suspend(0.4), panic = raw.suspend(0.7), rendering = raw.startRendering();
      let cancelledFutureChokes = 0;
      if (cancelChoke) { await cancelChoke; cancelledFutureChokes = A.cancelGeneration(2, 'fixture'); await raw.resume(); }
      await cueStop; cue.stop(); await raw.resume(); await panic; preview.panic(); await raw.resume();
      const rendered = await rendering, data = admitPcmBuffer(rendered, 6);
      const report = { comparisonStatus: { permutation: 'not-applicable', choke: 'not-applicable' }, requiredPcm: { channels: 6, frames: rendered.length, scope: 'all-retained-channels' }, requestedSampleRate: sampleRate, actualSampleRate: raw.sampleRate, decodedFrames: pin.variant.frames, crowd, chokeCancellation, cancelledFutureChokes,
        accepted: receipts.filter(receipt => receipt.status === 'accepted').length, expectedReceipts: receipts.length, selections,
        expectedSelections: crowd === 2 ? 4 : crowd + (overflow ? 1 : 0), maximumReservedSources, overflowDecision: overflow?.reason ?? null,
        sourceHash: hash, sourceSampleRate: sourceRate, targetSampleRate: sampleRate,
        AAfterCueStop: measure(data[2], sampleRate, 0.42, 0.48), BAfterCueStop: measure(data[3], sampleRate, 0.41, 0.48),
        releaseChild: measure(data[5], sampleRate, 0.35, 0.38), pitchErrorCentsA: pitchError(data[2], sampleRate, 200 * 2 ** 0.5),
        pitchErrorCentsB: pitchError(data[3], sampleRate, 200 * 2 ** -0.5), mainContinuity: measure(data[4], sampleRate, 0.03, 0.49),
        afterRelease: measure(data[2], sampleRate, 0.66, 0.69), afterPanic: measure(data[0], sampleRate, 0.72, 1),
        all: measure(data[0], sampleRate, 0, 1), afterCleanup: loader.diagnostics(), activeVoices: preview.getState().activeVoices,
        evidenceClass: 'digital-offline', appliedFrameAcknowledgment: 'unavailable-native-nodes' };
      A.dispose(); B.dispose(); await preview.dispose(); report.finalAssetResources = loader.diagnostics().resources.reservations;
      return { report, data };
    };
    const reports = [];
    for (const rate of rates) {
      const a = await run(rate, false), b = await run(rate, true), maxPermutationError = comparePcmChannels(a.data, b.data);
      reports.push({ ...a.report, comparisonStatus: { permutation: 'measured', choke: 'not-applicable' }, maxPermutationError, permutationTolerance: 1e-6 });
      const choke = await run(rate, false, 2, true), chokeRestorationError = comparePcmChannels(a.data, choke.data);
      reports.push({ ...choke.report, comparisonStatus: { permutation: 'not-applicable', choke: 'measured' }, chokeRestorationError });
      for (const crowd of [16, 32]) reports.push((await run(rate, false, crowd)).report);
    }
    return { engine: 'native-sample@1', reports, evidence: { digitalOffline: 'executed', digitalRealtime: 'not-run', listened: 'not-run', physicalLoopback: 'not-run' } };
  }, rates);
  for (const report of evidence.reports) {
    admitPcmMetrics(report, ['all.rms', 'all.peak', 'all.frames', 'AAfterCueStop.rms', 'BAfterCueStop.peak', 'releaseChild.rms', 'pitchErrorCentsA', 'pitchErrorCentsB', 'mainContinuity.maximumDelta', 'afterRelease.peak', 'afterPanic.peak']);
    if (report.comparisonStatus.permutation === 'measured') admitPcmMetrics(report, ['maxPermutationError', 'permutationTolerance']);
    if (report.comparisonStatus.choke === 'measured') admitPcmMetrics(report, ['chokeRestorationError']);
  }
  evidence.environment = environment; evidence.errors = errors;
  evidence.sourceHashes = Object.fromEntries(await Promise.all(LOCAL_AUDIO_SOURCES.map(async file => [file, createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')])));
  const failed = evidence.reports.filter(report => report.accepted !== report.expectedReceipts || report.selections !== report.expectedSelections || report.all.nonfinite || report.all.peak >= 0.9 ||
    report.AAfterCueStop.rms < 1e-5 || report.BAfterCueStop.peak > 1e-7 || report.releaseChild.rms < 1e-5 ||
    report.pitchErrorCentsA == null || report.pitchErrorCentsB == null || Math.abs(report.pitchErrorCentsA) > 5 || Math.abs(report.pitchErrorCentsB) > 5 ||
    report.mainContinuity.maximumDelta > 0.08 || report.afterRelease.peak > 1e-7 || report.afterPanic.peak > 1e-7 || report.activeVoices ||
    report.finalAssetResources || report.maxPermutationError > report.permutationTolerance ||
    report.chokeCancellation && (report.cancelledFutureChokes !== 1 || report.chokeRestorationError > 1e-6) ||
    report.crowd === 32 && (report.maximumReservedSources !== 64 || report.overflowDecision !== 'shared-sample-source-budget'));
  evidence.passed = !errors.length && !failed.length;
  await fs.mkdir(directory, { recursive: true }); const output = path.join(directory, 'sample-audio.json');
  await fs.writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ passed: evidence.passed, environment, cases: evidence.reports.length, rates,
    failed: failed.map(report => ({ rate: report.actualSampleRate, accepted: report.accepted, expected: report.expectedReceipts })), output }, null, 2));
  if (!evidence.passed) throw new Error('Owned sample PCM fixture failed.');
} finally { await server?.close(); await browserContext.close(); await browser.close(); }
