import { NATIVE_OFFLINE_SOURCE_IDS } from './NativeOfflineProfile.js';
export { NATIVE_OFFLINE_SOURCE_IDS } from './NativeOfflineProfile.js';
import { createSampleInstrumentBackend } from './sampleInstrumentBackend.js';
import { retainSampleSelectionReceipt } from '../../midi/content/SampleInstrumentMap.js';
import { createNativeOscillatorBackend } from './nativeOscillatorBackend.js';
import { nativeVoiceFinished, nativeRenderVoiceCount, releaseNativeVoice, destroyNativeVoice } from './NativeVoiceLifetime.js';
import { workloadVoiceCount, inspectVoiceInterval, inspectVoiceExtensions } from './AudioVoiceAdmission.js';
import { createAudioIntervalAdmission, audioIntervalStorageBytes } from './AudioIntervalAdmission.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { prepareNativeEffectGraph } from './NativeEffectGraph.js';
import { prepareEffectRenderPlan, validateNativeConvolutionRenderReceipt } from './EffectRenderPlan.js';
import { backgroundWorkerAdmission } from '../resources/BackgroundWorkerAdmission.js';

const failure = (code, message, detail = {}) => Object.assign(new Error(message), { name: 'NativeOfflineRenderError', code, ...detail });
const natural = value => Number.isSafeInteger(value) && value >= 0;
let nextOwner = 0;

// The destination belongs exclusively to an OfflineAudioContext. Every lane tap
// and the master are rendered together; no live output or solo bounce is used.
export async function renderNativeOfflineGraph({ patch, events, frames, sampleRate, stemLaneIds = [], assets = [], effectGraph = null, effectReturnNodeIds = [] },
  { resources, signal: externalSignal, admission = backgroundWorkerAdmission, resourceBudget = null,
    OfflineAudioContext = globalThis.OfflineAudioContext, getMaterialProvider = null, jobs, onProgress = () => {}, isCurrent = () => true } = {}) {
  externalSignal?.throwIfAborted();
  if (!Array.isArray(effectReturnNodeIds)) throw failure('native-effect-profile', 'Native effect taps must be an explicit bounded array.');
  const effectPlan = effectGraph ? prepareEffectRenderPlan(effectGraph, sampleRate, effectReturnNodeIds, { nativeConvolution: true }) : null;
  if (effectPlan && !effectPlan.impulseCount || !effectPlan && effectReturnNodeIds.length) throw failure('native-effect-profile', 'This native source adapter expects an explicit convolution graph or no native effects.');
  const channels = 2 + (stemLaneIds.length + effectReturnNodeIds.length) * 2, nativeBytes = frames * channels * 4;
  if (!NATIVE_OFFLINE_SOURCE_IDS.includes(patch?.engineId) || ![44100, 48000, 96000].includes(sampleRate) ||
      !natural(frames) || frames < 1 || frames > sampleRate * 150 || !natural(nativeBytes) || nativeBytes > 256 * 1048576 ||
      !Array.isArray(assets) || assets.length > 32 || patch.engineId !== 'native-sample' && assets.length || !Array.isArray(events) || events.length > 32768 || !Array.isArray(stemLaneIds) || stemLaneIds.length + effectReturnNodeIds.length > 15 ||
      new Set(stemLaneIds).size !== stemLaneIds.length || stemLaneIds.some(id => typeof id !== 'string' || !id || id.length > 128) ||
      typeof OfflineAudioContext !== 'function' || typeof resources?.reserve !== 'function' || typeof admission?.acquire !== 'function' || typeof onProgress !== 'function' || typeof isCurrent !== 'function')
    throw failure('native-render-preflight', 'Native offline rendering requires a bounded native source, available OfflineAudioContext and at most fifteen stereo lane taps.');
  let prior = -1;
  for (const event of events) {
    if (!natural(event?.frame) || event.frame < prior || event.frame >= frames || !['begin', 'update', 'end'].includes(event.kind) ||
        typeof event.voiceId !== 'string' || !event.voiceId || event.voiceId.length > 512 ||
        event.executionEpoch != null && (typeof event.executionEpoch !== 'string' || !event.executionEpoch || event.executionEpoch.length > 256) ||
        event.releaseVelocity01 != null && (!Number.isFinite(event.releaseVelocity01) || event.releaseVelocity01 < 0 || event.releaseVelocity01 > 1) ||
        event.kind === 'begin' && (!natural(event.releaseFrame) || event.releaseFrame < event.frame ||
          !Number.isFinite(event.releaseSeconds) || event.releaseSeconds < 0.002 || event.releaseSeconds > 4))
      throw failure('native-event-preflight', 'Native scheduling needs ordered explicit frame targets and the complete release interval for every onset.');
    prior = event.frame;
  }
  const sourceSelections = [], selectionLimit = 64; let selectedOnsets = 0;
  const owner = 'native-offline-' + (++nextOwner), nodes = [], scope = createProcgenRetirementScope();
  const controller = new AbortController(), signal = controller.signal;
  const forwardAbort = () => controller.abort(externalSignal.reason);
  externalSignal?.addEventListener('abort', forwardAbort, { once: true }); if (externalSignal?.aborted) forwardAbort();
  let context = null, host = null, backend = null, rendered = null, nativeWork = null, suspension = null;
  let execution = null, effects = null, effectReceipt = null;
  let nativeSettled = false, nativeFailed = false, originalError = null, cursor = 0, batches = 0, submitted = 0, pcmLease = null, graphLease = null;
  const guard = () => { signal.throwIfAborted(); if (!isCurrent()) throw failure('stale-native-render', 'The native offline render no longer belongs to the selected request.'); };
  const node = value => { nodes.push(value); return value; };
  const accept = (receipt, event) => {
    if (receipt?.status !== 'accepted') throw failure('native-command-rejected', 'The native engine could not realize every captured command.',
      { reason: receipt?.reason || 'missing-receipt', intentId: event?.intent?.intentId || null, frame: event?.frame ?? null });
    submitted++; return receipt;
  };
  const acquireExecution = async () => {
    execution = await admission.acquire({ kind: 'render-native-source', ownerId: owner, ownerEpoch: 0, sourceRevision: patch.id + '@' + patch.revision + (effects ? ':' + effects.hash : ''),
      inputBytes: 4096 + events.length * 512, estimatedPeakBytes: 4096, priority: 'background', signal, budgetAdapter: resourceBudget,
      onCancel: reason => controller.abort(reason), deadlineMs: 180000 }); guard();
  };
  const cancel = () => {
    try { backend?.dispose(); effects?.panic(); } catch (error) { originalError ||= error; }
  };
  try {
    if (!effectPlan) await acquireExecution();
    pcmLease = resources.reserve({ kind: 'native-offline-pcm', owner, bytes: nativeBytes, consumerOwned: true });
    graphLease = resources.reserve({ kind: 'native-offline-graph', owner, bytes: audioIntervalStorageBytes(513), estimateBytes: 16 * 1048576, consumerOwned: true });
    context = new OfflineAudioContext({ numberOfChannels: channels, length: frames, sampleRate });
    if (context.sampleRate !== sampleRate || typeof context.suspend !== 'function' || typeof context.resume !== 'function' ||
        typeof context.createStereoPanner !== 'function') throw failure('native-api-unavailable', 'This browser lacks the required native offline scheduling or stereo panning API.');
    const quantum = context.renderQuantumSize ?? 128;
    if (!Number.isSafeInteger(quantum) || quantum < 1 || quantum > 2048) throw failure('native-quantum-unavailable', 'The offline render quantum is outside the supported bounded profile.');
    const merger = node(context.createChannelMerger(channels)), master = node(context.createGain()), splitter = node(context.createChannelSplitter(2));
    merger.channelInterpretation = 'discrete'; merger.connect(context.destination);
    if (effectPlan) {
      effects = await prepareNativeEffectGraph(effectPlan.definition, { context, resources, owner, signal, isCurrent, getMaterialProvider, jobs }); guard();
      master.connect(effects.getInput(effectPlan.inputs[0])); effects.getOutput(effectPlan.outputs[0]).connect(splitter);
      for (const [index, id] of effectReturnNodeIds.entries()) {
        const tap = node(context.createChannelSplitter(2)), output = effects.getNodeOutput(id);
        if (!output) throw failure('native-effect-tap-unavailable', 'The native graph omitted a requested shared node output.');
        output.connect(tap); const offset = 2 + (stemLaneIds.length + index) * 2; tap.connect(merger, 0, offset); tap.connect(merger, 1, offset + 1);
      }
    } else master.connect(splitter);
    splitter.connect(merger, 0, 0); splitter.connect(merger, 1, 1);
    const laneNodes = new Map();
    const channelFor = lane => {
      const id = String(lane ?? 'unassigned'); if (laneNodes.has(id)) return laneNodes.get(id);
      if (laneNodes.size >= 128) throw failure('native-lane-capacity', 'The native graph exceeds 128 captured lane owners.');
      const gain = node(context.createGain()); gain.connect(master);
      const index = stemLaneIds.indexOf(id);
      if (index >= 0) { const tap = node(context.createChannelSplitter(2)); gain.connect(tap); tap.connect(merger, 0, 2 + index * 2); tap.connect(merger, 1, 3 + index * 2); }
      const channel = { gain }; laneNodes.set(id, channel); return channel;
    };
    let currentLane = null;
    host = { _context: context, _generation: 1, _sessions: new Map([[owner, { generation: 1 }]]), _voices: new Set(),
      _semanticVoiceOwners: new Map(), _voicesByToken: new Map(), _retiredVoices: new Map(), _retirementFaults: new Set(),
      _maxNoteSeconds: 150, _maxScheduledVoices: 512, _maxLiveScheduledVoices: 512, _maxVoices: 256, _voiceSequence: 0,
      _audioResources: resources, _intervalAdmission: createAudioIntervalAdmission({ maxIntervals: 513 }),
      _ownerReady: () => context.state !== 'closed' && !signal?.aborted, getAudioContext: () => context,
      _channel: () => channelFor(currentLane), _workloadClass: () => 'live', _nowMs: () => context.currentTime * 1000,
      _captureMetadata: fields => fields, _observe() {}, _emitPlayback() {}, _setStatus() {},
      _voiceFinished: nativeVoiceFinished, _renderVoiceCount: nativeRenderVoiceCount, _release: releaseNativeVoice,
      _destroyVoice: destroyNativeVoice, _workloadVoiceCount: workloadVoiceCount,
      _inspectVoiceInterval: inspectVoiceInterval, _inspectVoiceExtensions: inspectVoiceExtensions };
    backend = patch.engineId === 'native-sample' ? createSampleInstrumentBackend(host, owner, { gateMode: 'bounded', clockMode: 'offline', traceLimit: 0 }) :
      createNativeOscillatorBackend(host, owner, { engineId: patch.engineId, gateMode: 'bounded', traceLimit: 0 });
    const preparation = await backend.prepare({ status: 'ready', patch, receipt: { patchId: patch.id, revision: patch.revision } }, assets);
    if (preparation.status !== 'ready') throw failure('native-patch-unavailable', 'The live native source backend rejected this exact offline definition.');
    // IR analysis is a separate admitted worker operation. Acquire native
    // execution only after preparation so two native renders cannot occupy
    // every shared worker slot while waiting for their own analysis jobs.
    if (!execution) await acquireExecution();
    signal?.addEventListener('abort', cancel, { once: true }); guard();
    const schedule = until => {
      for (const voice of host._voices) if (host._voiceFinished(voice)) host._destroyVoice(voice, 'offline-finished-voice');
      while (cursor < events.length && events[cursor].frame < until) {
        guard(); const event = events[cursor++];
        if (event.kind === 'begin') {
          currentLane = event.laneId;
          const onset = accept(backend.begin({ ...event.intent, voiceId: event.voiceId, performanceControls: {} }, event.frame, event.executionEpoch || 'offline-render'), event);
          const selection = retainSampleSelectionReceipt(onset);
          if (selection) { selectedOnsets++; if (sourceSelections.length < selectionLimit) sourceSelections.push(Object.freeze({ intentId: event.intent.intentId, voiceId: event.voiceId, frame: event.frame, ...selection })); }
          accept(backend.end(event.voiceId, { seconds: event.releaseSeconds, ...(event.releaseVelocity01 != null ? { velocity01: event.releaseVelocity01 } : {}) }, event.releaseFrame, event.executionEpoch || 'offline-render'), event);
        } else if (event.kind === 'update' && Object.keys(event.expression || {}).length)
          accept(backend.update(event.voiceId, event.expression, event.frame, event.executionEpoch || 'offline-render'), event);
      }
      if (host._retirementFaults.size) throw failure('native-voice-retirement', 'A native voice failed to retire completely.');
    };
    let frontier = 0;
    while (frontier < frames) {
      guard();
      const horizon = Math.min(frames, frontier + Math.max(quantum, Math.floor(sampleRate / 2 / quantum) * quantum));
      const dense = events[Math.min(events.length - 1, cursor + 31)];
      const next = dense ? Math.min(horizon, Math.max(frontier + quantum, Math.ceil((dense.frame + 1) / quantum) * quantum)) : horizon;
      schedule(Math.min(next, frames)); batches++;
      if (next < frames) {
        // suspend() rounds UP to a render quantum. Stay inside the preceding
        // sample to avoid a floating point quotient moving one quantum later.
        suspension = context.suspend((next - 0.25) / sampleRate); suspension.catch(() => {});
      }
      if (!nativeWork) { nativeWork = Promise.resolve(context.startRendering()).then(buffer => { nativeSettled = true; return buffer; }, error => { nativeSettled = true; nativeFailed = true; throw error; }); nativeWork.catch(() => {}); }
      else await context.resume();
      if (next < frames) {
        await suspension; suspension = null;
        if (Math.round(context.currentTime * sampleRate) !== next) throw failure('native-suspend-frame', 'The browser suspended at a different native frame frontier.');
      } else rendered = await nativeWork;
      frontier = Math.min(next, frames); guard();
      try { onProgress({ phase: 'rendering-native-offline', completedUnits: frontier, totalUnits: frames }); } catch { /* Progress observers do not own native processing. */ }
    }
    if (rendered?.length !== frames || rendered.sampleRate !== sampleRate || rendered.numberOfChannels !== channels)
      throw failure('native-output-mismatch', 'The browser returned a different offline PCM layout.');
    if (effects) {
      effectReceipt = Object.freeze({ hash: effects.hash, controls: 'explicit-authored-defaults-not-replayed-live-gestures',
        scope: 'one-full-shared-owner-sum', returnNodeIds: Object.freeze(effectReturnNodeIds.slice()), realization: effects.diagnostics() });
      validateNativeConvolutionRenderReceipt(effectPlan, { method: 'native-offline-audio-context', effectGraph: effectReceipt }, effects.hash, effectReturnNodeIds);
    }
  } catch (error) { originalError = error; }
  finally {
    externalSignal?.removeEventListener('abort', forwardAbort);
    signal?.removeEventListener('abort', cancel);
    if (originalError) cancel();
    // Older OfflineAudioContext implementations have no close(). Cancellation
    // drains the bounded disconnected graph and keeps all PCM storage charged.
    if (nativeWork && !nativeSettled) {
      try { if (suspension) await suspension; } catch (error) { originalError ||= error; }
      try { if (context.state === 'suspended') await context.resume(); await nativeWork; } catch (error) { originalError ||= error; }
    }
    const receipt = scope.retire([
      { name: 'native-producer', run: () => { if (originalError?.retirement && originalError.retirement.outcome !== 'complete') throw failure('native-preparation-retirement-unknown', 'Prepared IR producer custody remains unresolved.'); if (nativeWork && (!nativeSettled || nativeFailed && context.state !== 'closed')) throw failure('native-producer-unknown', 'Offline producer retirement could not be confirmed.'); } },
      { name: 'native-voices', run: () => backend?.dispose() },
      { name: 'native-effects', run: async () => { if (effects) { const retired = effects.dispose(); await retired.completion; if (retired.outcome !== 'complete') throw failure('native-effect-retirement-unknown', 'Native convolution and its IR pins remain owned.'); } } },
      { name: 'native-graph', run: () => { for (const value of nodes) value.disconnect(); } }
    ]); await receipt.completion;
    if (receipt.outcome !== 'complete') {
      const error = failure('native-retirement-unknown', 'Native offline resources remain reserved.', { cause: originalError, retirement: receipt });
      error.retainedNative = { context, host, backend, effects, nodes: nodes.slice(), rendered, nativeWork };
      pcmLease?.retainUnknown(error); graphLease?.retainUnknown(error); execution?.retainUnknown(error); originalError = error;
    } else {
      const storage = createProcgenRetirementScope().retire([
        { name: 'native-graph-storage', run: () => graphLease?.release() },
        { name: 'failed-native-pcm', run: () => { if (originalError) pcmLease?.release(); } },
        { name: 'native-execution', run: () => { if (execution) { execution.confirmRetirement(); if (execution.getState().phase !== 'released') throw failure('native-admission-retirement', 'Native execution admission release is unresolved.'); } } }
      ]); await storage.completion;
      if (storage.outcome !== 'complete') { originalError = failure('native-retirement-unknown', 'Native resource bookkeeping remains unresolved.', { cause: originalError, retirement: storage }); pcmLease?.retainUnknown(originalError); }
    }
    nodes.length = 0; context = host = backend = effects = nativeWork = suspension = null;
  }
  if (originalError) throw originalError;
  let released = false;
  return Object.freeze({ get buffer() { return rendered; }, frames, sampleRate, channels, stemLaneIds: Object.freeze(stemLaneIds.slice()),
    receipt: Object.freeze({ method: 'native-offline-audio-context', nativeSourceBackend: patch.engineId, effectGraph: effectReceipt, batches, submitted, executionAdmission: execution.getState(),
      scheduling: 'explicit-native-frames-with-quantum-suspension', gates: 'bounded-offline-with-preflighted-terminal-intervals',
      renderTap: 'simultaneous-native-source-graph-before-live-master', crossBrowserBitIdentity: false,
      sourceSelections: Object.freeze(sourceSelections), sourceSelectionCoverage: Object.freeze({ selectedOnsets, retained: sourceSelections.length, limit: selectionLimit, omitted: selectedOnsets - sourceSelections.length, evidenceClass: 'native-source-selection-api', acousticReceipt: false }) }),
    release() { if (released) return false; pcmLease.release(); released = true; rendered = null; return true; } });
}
