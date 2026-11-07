import { MIN_DESKTOP_VIEWPORT } from '../e2e/helpers/desktopViewports.js';
import { admitPcmMetrics } from '../js/app/midi-ui/PcmEvidence.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LOCAL_AUDIO_SOURCES, launchAudioEvidenceBrowser, startAudioEvidenceServer } from './audio-evidence-runtime.js';

const option = (name, fallback) => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3) || fallback;
const rates = option('sample-rates', '44100,48000,96000').split(',').map(Number);
if (!rates.length || rates.length > 8 || rates.some(rate => !Number.isInteger(rate) || rate < 8000 || rate > 192000)) throw new Error('Invalid audio fixture rates.');
const root = process.cwd(), directory = path.resolve(root, option('out-dir', 'temp/worklet-audio-evidence'));
const { browser, environment } = await launchAudioEvidenceBrowser();
const context = await browser.newContext({ viewport: MIN_DESKTOP_VIEWPORT, permissions: [] }).catch(async error => { await browser.close(); throw error; });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
let server = null;
try {
  server = await startAudioEvidenceServer(root); await page.goto(server.origin);
  const evidence = await page.evaluate(async rates => {
    const { BrowserNotePreview } = await import('/js/app/midi-ui/browserNotePreview.js');
    const { admitPcmBuffer, measurePcmWindow, comparePcmChannels } = await import('/js/app/midi-ui/PcmEvidence.js');
    const reports = [];
    const run = async (sampleRate, reverse = false, crowd = 2, telemetry = false) => {
      const raw = new globalThis.OfflineAudioContext(6, Math.ceil(sampleRate * 0.7), sampleRate);
      if (!raw.audioWorklet) throw new Error('Required offline AudioWorklet capability unavailable.');
      const adapter = { state: 'running', get currentTime() { return raw.currentTime; }, sampleRate: raw.sampleRate, destination: raw.destination,
        audioWorklet: raw.audioWorklet, createGain: () => raw.createGain(), createStereoPanner: () => raw.createStereoPanner(),
        createDynamicsCompressor: () => raw.createDynamicsCompressor(), createWaveShaper: () => raw.createWaveShaper(), close: () => Promise.resolve() };
      const preview = new BrowserNotePreview({ createAudioContext: () => adapter, nowMs: () => raw.currentTime * 1000, maxVoices: 64 });
      const live = preview.createSession('live'), cue = preview.createSession('cue'); await live.enable(); await cue.enable();
      const options = { createWorkletNode: (_context, name, settings) => new globalThis.AudioWorkletNode(raw, name, settings), traceLimit: 1024 };
      const A = await live.createWorkletInstrumentBackend(options), B = await cue.createWorkletInstrumentBackend(options);
      const patch = { status: 'ready', patch: { id: 'worklet-fixture', revision: 1, engineId: 'worklet-sine', engineVersion: 1,
        parameters: { gain01: 0.8, sustain01: 0.7 }, sampleRefs: [], voicePolicy: { maxVoices: 64 }, mix: { gain01: 0.8, pan01: 0 } },
      receipt: { patchId: 'worklet-fixture', revision: 1 } };
      const prepared = await Promise.all([A.prepare(patch), B.prepare(patch)]);
      if (prepared.some(receipt => receipt.status !== 'ready')) throw new Error('Worklet prepare failed: ' + JSON.stringify(prepared));
      const displaySamples = [], displayErrors = [];
      if (telemetry) for (const [backend, session, executionEpoch] of [[A, live, 'live'], [B, cue, 'cue']]) {
        backend.setDisplayContext({ worldId: 'fixture', graphRevision: 1, routeRevision: 1 });
        backend.observeDisplaySamples(sample => {
          if (displaySamples.length < 256) displaySamples.push(sample);
          if (sample.owner !== session.getState().ownerId || sample.contextEpoch !== preview.getState().contextEpoch ||
              sample.appliedFrame >= sample.windowEndFrame || sample.windowStartFrame < Math.round(0.02 * sampleRate) ||
              sample.quantities.some(quantity => !Number.isFinite(quantity.value)) || sample.routeState.muted !== null) displayErrors.push('invalid-display-evidence');
        }, { identity: { worldId: 'fixture', generation: 1, executionEpoch, contextEpoch: preview.getState().contextEpoch, graphRevision: 1, routeRevision: 1 }, maxVoices: 32 });
      }
      const frame = time => Math.round(time * sampleRate), intent = id => ({ version: 1, kind: 'begin', voiceId: id,
        generation: 1, actorId: id === 'same' ? 1 : 2, onsetId: 'onset:' + id,
        velocity01: 0.7501, pitch: { cents: 6000.125, referenceHz: 440 }, expression: {}, sourceEventIds: ['physical:' + id] });
      const receipts = [];
      for (let index = 0; index < crowd; index++) receipts.push((index % 2 ? B : A).begin(intent(index < 2 ? 'same' : 'crowd:' + index), frame(0.02), index % 2 ? 'cue' : 'live'));
      const controls = [[A, { pitchOffsetCents: 200.001, pressure01: 0.5001, pan01: -0.8 }, 0.1, 'live'],
        [A, { pressure01: 0.9001 }, 0.102, 'live'], [B, { pitchOffsetCents: -200.001, pressure01: 0.2501, pan01: 0.8 }, 0.12, 'cue']];
      for (const [backend, expression, time, epoch] of reverse ? controls.reverse() : controls) receipts.push(backend.update('same', expression, frame(time), epoch));
      receipts.push(B.end('same', { seconds: 0.04 }, frame(0.2), 'cue'));
      // This start is beyond the host lead window and tests the single queue pump.
      receipts.push(B.begin(intent('cue-second'), frame(0.28), 'cue'));
      const merger = raw.createChannelMerger(6); merger.channelInterpretation = 'discrete'; merger.connect(raw.destination); preview._limiter.disconnect();
      const tap = (node, first) => { const split = raw.createChannelSplitter(2); node.connect(split); split.connect(merger, 0, first); split.connect(merger, 1, first + 1); };
      tap(preview._limiter, 0); tap(preview._channels.get(live.getState().ownerId + ':0').gain, 2); tap(preview._channels.get(cue.getState().ownerId + ':0').gain, 4);
      const waitForAdmission = async () => {
        await Promise.resolve();
        for (let attempt = 0; attempt < 100; attempt++) {
          const states = [A.renderDiagnostics({ includeTraces: true }), B.renderDiagnostics({ includeTraces: true })];
          if (states.every(state => state.awaitingKernelAdmission === 0)) return;
          await new Promise(resolve => setTimeout(resolve, 1));
        }
        throw new Error('Kernel did not acknowledge the offline fixture queue.');
      };
      const waitForStopQueued = async backends => {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (backends.every(backend => { const state = backend.renderDiagnostics(); return state.counters.stopQueued >= state.counters.stopRequests; })) return;
          await new Promise(resolve => setTimeout(resolve, 1));
        }
        throw new Error('Kernel did not queue the offline fixture Stop request.');
      };
      await waitForAdmission();
      const pumpBoundary = raw.suspend(0.04), cueStop = raw.suspend(0.3), panic = raw.suspend(0.5), rendering = raw.startRendering();
      await pumpBoundary;
      // Renewing causes the one bounded pump to submit the now-known queued start.
      B.renewExecutionLease(1, 'cue', frame(1)); await waitForAdmission(); await raw.resume();
      await cueStop; cue.stop(); await waitForStopQueued([B]); await raw.resume();
      await panic; preview.panic(); await waitForStopQueued([A, B]); await raw.resume();
      const buffer = await rendering;
      // Drain already queued port messages before collecting render receipts.
      await new Promise(resolve => setTimeout(resolve, 0));
      const samples = admitPcmBuffer(buffer, 6);
      const measure = (channel, from, to) => measurePcmWindow([samples[channel]], sampleRate, from, to);
      const diagnostics = [A.renderDiagnostics({ includeTraces: true }), B.renderDiagnostics({ includeTraces: true })];
      const report = { comparisonStatus: { permutation: 'not-applicable', telemetry: 'not-applicable' }, requiredPcm: { channels: 6, frames: buffer.length, scope: 'all-retained-channels' }, sampleRate: raw.sampleRate, crowd, telemetry, displaySamples: displaySamples.length, displayErrors,
        displayOwners: [...new Set(displaySamples.map(sample => sample.owner))],
        accepted: receipts.filter(receipt => receipt.status === 'accepted').length, expected: receipts.length,
        final: measure(0, 0, 0.7), liveAfterCueStop: measure(2, 0.35, 0.45), cueAfterStop: measure(4, 0.35, 0.45),
        postPanic: measure(0, 0.52, 0.7), applied: diagnostics.flatMap(item => item.traces).filter(trace => trace.stage === 'render-kernel-applied').length,
        kernelFaults: diagnostics.reduce((sum, item) => sum + item.counters.faults, 0), activeAfterPanic: preview.getState().activeVoices,
        rejections: diagnostics.flatMap(item => item.traces).filter(trace => trace.status === 'rejected'),
        diagnostics: diagnostics.map(item => ({ counters: item.counters, inFlight: item.inFlight, traceCount: item.traceCount, truncated: item.truncatedTraces, display: item.display })) };
      A.dispose(); B.dispose(); await preview.dispose(); return { report, samples };
    };
    for (const rate of rates) {
      const chronological = await run(rate), shuffled = await run(rate, true);
      const permutationError = comparePcmChannels(chronological.samples, shuffled.samples);
      reports.push({ ...chronological.report, comparisonStatus: { permutation: 'measured', telemetry: 'not-applicable' }, permutationError });
      const observed = await run(rate, false, 2, true), telemetryPcmError = comparePcmChannels(chronological.samples, observed.samples);
      reports.push({ ...observed.report, comparisonStatus: { permutation: 'not-applicable', telemetry: 'measured' }, telemetryPcmError });
      for (const crowd of [16, 32, 64]) reports.push((await run(rate, false, crowd)).report);
      reports.push((await run(rate, false, 64, true)).report);
    }
    return { engine: 'worklet-sine@1', scope: 'digital-offline', reports,
      evidence: { renderKernelReceipts: true, realtimeDeadline: 'not-run', listened: 'not-run', physicalLoopback: 'not-run' } };
  }, rates);
  for (const report of evidence.reports) {
    admitPcmMetrics(report, ['final.rms', 'final.peak', 'final.frames', 'liveAfterCueStop.rms', 'cueAfterStop.peak', 'postPanic.peak']);
    if (report.comparisonStatus.permutation === 'measured') admitPcmMetrics(report, ['permutationError']);
    if (report.comparisonStatus.telemetry === 'measured') admitPcmMetrics(report, ['telemetryPcmError']);
  }
  evidence.environment = environment; evidence.errors = errors;
  evidence.sourceHashes = Object.fromEntries(await Promise.all(LOCAL_AUDIO_SOURCES.map(async file =>
    [file, createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')])));
  const failed = evidence.reports.filter(report => report.accepted !== report.expected || report.final.nonfinite || report.final.peak >= 0.9 ||
    report.liveAfterCueStop.rms < 1e-5 || report.cueAfterStop.peak > 1e-7 || report.postPanic.peak > 1e-7 ||
    report.kernelFaults || report.rejections.length || report.activeAfterPanic || !report.applied || report.permutationError > 1e-6 ||
    report.telemetry && (!report.displaySamples || report.displayOwners.length !== 2 || report.displayErrors.length || report.telemetryPcmError > 0));
  evidence.passed = !errors.length && !failed.length;
  await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, 'worklet.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ passed: evidence.passed, environment, cases: evidence.reports.length, failed, output: path.join(directory, 'worklet.json') }, null, 2));
  if (!evidence.passed) throw new Error('Worklet PCM evidence failed.');
} finally { await context.close(); await browser.close(); await server?.close(); }
