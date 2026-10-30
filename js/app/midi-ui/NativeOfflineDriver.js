import { prepareEffectSourceBindings } from './EffectSourceBindings.js';
import { createLiveLaneSourceBuses } from './LiveLaneSourceBuses.js';
import { OWNED_SOURCE_IDS } from './OwnedSourceProfiles.js';
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
import { prepareEffectRenderPlan, validateNativeEffectRenderReceipt } from './EffectRenderPlan.js';
import { backgroundWorkerAdmission } from '../resources/BackgroundWorkerAdmission.js';

const failure = (code, message, detail = {}) => Object.assign(new Error(message), { name: 'NativeOfflineRenderError', code, ...detail });
const natural = value => Number.isSafeInteger(value) && value >= 0;
let nextOwner = 0;

// The destination belongs exclusively to an OfflineAudioContext. Every lane tap
// and the master are rendered together; no live output or solo bounce is used.
export async function renderNativeOfflineGraph({ patch, events, frames, sampleRate, stemLaneIds = [], assets = [], effectGraph = null, effectReturnNodeIds = [], sourcePcm = null, panicFrame = null },
  { resources, signal: externalSignal, admission = backgroundWorkerAdmission, resourceBudget = null,
    OfflineAudioContext = globalThis.OfflineAudioContext, getMaterialProvider = null, jobs, createWorkletNode, effectInitializationTimeoutMs = 5000, onProgress = () => {}, isCurrent = () => true } = {}) {
  externalSignal?.throwIfAborted();
  if (!Array.isArray(effectReturnNodeIds)) throw failure('native-effect-profile', 'Native effect taps must be an explicit bounded array.');
  const effectPlan = effectGraph ? prepareEffectRenderPlan(effectGraph, sampleRate, effectReturnNodeIds, { nativeConvolution: true, nativeOwnedProcessors: true }) : null;
  if (!effectPlan && effectReturnNodeIds.length) throw failure('native-effect-profile', 'Native effect return taps require an explicit effect graph.');
  const sourcePcmLaneIds = sourcePcm?.laneIds ?? stemLaneIds;
  const sourceBytes = Array.isArray(sourcePcm?.planes) && sourcePcm.planes.length <= 32 ? sourcePcm.planes.reduce((sum, plane) => sum + (plane?.byteLength || 0), 0) : 0;
  if (sourcePcm != null) {
    if (!OWNED_SOURCE_IDS.includes(patch?.engineId) || !effectPlan?.impulseCount || !sourcePcm || Object.getPrototypeOf(sourcePcm) !== Object.prototype ||
        Object.keys(sourcePcm).some(key => !['planes', 'frames', 'channels', 'sampleRate', 'planeByteHashes', 'planeHashByteOrder', 'laneIds', 'sourceLaneIds'].includes(key)) ||
        sourcePcm.frames !== frames || sourcePcm.sampleRate !== sampleRate || !Array.isArray(sourcePcmLaneIds) || sourcePcmLaneIds.length > 15 || new Set(sourcePcmLaneIds).size !== sourcePcmLaneIds.length || sourcePcmLaneIds.some(id => typeof id !== 'string' || !id || id.length > 128) ||
        stemLaneIds.some(id => !sourcePcmLaneIds.includes(id)) || sourcePcm.channels !== 2 + sourcePcmLaneIds.length * 2 ||
        !Array.isArray(sourcePcm.planes) || sourcePcm.planes.length > 32 || sourcePcm.planes.length !== sourcePcm.channels || sourcePcm.planes.some(plane => !(plane instanceof Float32Array) || !(plane.buffer instanceof ArrayBuffer) || plane.length !== frames || plane.byteOffset || plane.buffer.byteLength !== plane.byteLength) ||
        new Set(sourcePcm.planes.map(plane => plane.buffer)).size !== sourcePcm.channels || !natural(sourceBytes) || sourceBytes < 1 || sourceBytes > 56 * 1048576 ||
        !Array.isArray(sourcePcm.planeByteHashes) || sourcePcm.planeByteHashes.length !== sourcePcm.channels || sourcePcm.planeByteHashes.some(hash => !/^[a-f0-9]{64}$/.test(hash)) ||
        !['little-endian', 'big-endian'].includes(sourcePcm.planeHashByteOrder) || typeof globalThis.crypto?.subtle?.digest !== 'function' || events?.length || assets?.length)
      throw failure('native-source-pcm-preflight', 'Native body input requires exclusive bounded complete dry source planes and coefficient hashes.');
  }
  const channels = 2 + (stemLaneIds.length + effectReturnNodeIds.length) * 2, nativeBytes = frames * channels * 4;
  if (!(sourcePcm ? OWNED_SOURCE_IDS : NATIVE_OFFLINE_SOURCE_IDS).includes(patch?.engineId) || ![44100, 48000, 96000].includes(sampleRate) ||
      panicFrame != null && (!natural(panicFrame) || panicFrame >= frames || panicFrame % 128 || sourcePcm || effectGraph) || !natural(frames) || frames < 1 || frames > sampleRate * 150 || !natural(nativeBytes) || nativeBytes > 256 * 1048576 ||
      !Array.isArray(assets) || assets.length > 32 || patch.engineId !== 'native-sample' && assets.length || !Array.isArray(events) || events.length > 32768 || !Array.isArray(stemLaneIds) || stemLaneIds.length + effectReturnNodeIds.length > 15 ||
      new Set(stemLaneIds).size !== stemLaneIds.length || stemLaneIds.some(id => typeof id !== 'string' || !id || id.length > 128) ||
      typeof OfflineAudioContext !== 'function' || typeof resources?.reserve !== 'function' || typeof admission?.acquire !== 'function' || typeof onProgress !== 'function' || typeof isCurrent !== 'function')
    throw failure('native-render-preflight', 'Native offline rendering requires a bounded native source, available OfflineAudioContext and at most fifteen stereo lane taps.');
  let prior = -1;
  for (const event of events) {
    if (!natural(event?.frame) || event.frame < prior || event.frame >= frames || !['begin', 'update', 'end', 'lane'].includes(event.kind) ||
        typeof event.voiceId !== 'string' || !event.voiceId || event.voiceId.length > 512 ||
        event.executionEpoch != null && (typeof event.executionEpoch !== 'string' || !event.executionEpoch || event.executionEpoch.length > 256) ||
        event.releaseVelocity01 != null && (!Number.isFinite(event.releaseVelocity01) || event.releaseVelocity01 < 0 || event.releaseVelocity01 > 1) ||
        event.kind === 'end' && (!Number.isFinite(event.releaseSeconds) || event.releaseSeconds < 0 || event.releaseSeconds > 4 || event.force != null && typeof event.force !== 'boolean') ||
        event.kind === 'lane' && (typeof event.laneId !== 'string' || !event.laneId || event.laneId.length > 128) ||
        event.kind === 'begin' && (!natural(event.releaseFrame) || event.releaseFrame < event.frame ||
          !Number.isFinite(event.releaseSeconds) || event.releaseSeconds < 0.002 || event.releaseSeconds > 4))
      throw failure('native-event-preflight', 'Native scheduling needs ordered explicit frame targets and the complete release interval for every onset.');
    prior = event.frame;
  }
  const sourceLaneIds = sourcePcm ? sourcePcm.sourceLaneIds ?? sourcePcmLaneIds : [...new Set(events.filter(event => event.kind === 'begin' || event.kind === 'lane').map(event => String(event.laneId ?? 'unassigned')))];
  const effectSourceBindings = prepareEffectSourceBindings(effectPlan, sourceLaneIds);
  const sourceSelections = [], selectionLimit = 64; let selectedOnsets = 0;
  const owner = 'native-offline-' + (++nextOwner), nodes = [], scope = createProcgenRetirementScope();
  const controller = new AbortController(), signal = controller.signal;
  const forwardAbort = () => controller.abort(externalSignal.reason);
  externalSignal?.addEventListener('abort', forwardAbort, { once: true }); if (externalSignal?.aborted) forwardAbort();
  let context = null, host = null, backend = null, rendered = null, nativeWork = null, suspension = null;
  let execution = null, effects = null, effectReceipt = null, inputLease = null, sourceNode = null, sourceBuffer = null, sourceStarted = false, retirementExecution = null, readiness = null;
  let panicReceipt = null;
  let sources = null; const stemPins = [];
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
  const startNativeWork = () => {
    if (nativeWork) return nativeWork;
    nativeWork = Promise.resolve().then(() => context.startRendering()).then(buffer => { nativeSettled = true; return buffer; }, error => { nativeSettled = true; nativeFailed = true; throw error; });
    nativeWork.catch(() => {}); return nativeWork;
  };
  const retireOfflineContext = async () => {
    if (context.state === 'closed') return;
    if (!nativeWork && !execution) retirementExecution = await admission.acquire({ kind: 'render-native-source', ownerId: owner + ':retirement', ownerEpoch: 0,
      sourceRevision: patch.id + '@' + patch.revision, inputBytes: 4096, estimatedPeakBytes: 4096, priority: 'background', budgetAdapter: resourceBudget,
      deadlineMs: 180000, onCancel: reason => retirementExecution?.retainUnknown(reason) });
    startNativeWork();
    try { if (context.state === 'suspended' && suspension) { await suspension; suspension = null; await context.resume(); } await nativeWork; }
    catch (error) { if (context.state !== 'closed') throw error; }
    if (context.state !== 'closed') throw failure('offline-context-retirement-unknown', 'Offline effect context did not acknowledge closure.');
  };
  const cancel = () => {
    try { backend?.dispose(); if (sourceStarted) sourceNode?.stop(); effects?.panic(); } catch (error) { originalError ||= error; }
  };
  try {
    if (!effectPlan) await acquireExecution();
    if (sourcePcm) {
      inputLease = resources.reserve({ kind: 'native-offline-source-copy', owner, bytes: sourceBytes, estimateBytes: sourceBytes + 65536, consumerOwned: true });
      const endian = new Uint32Array([0x01020304]), byteOrder = new Uint8Array(endian.buffer)[0] === 4 ? 'little-endian' : 'big-endian';
      if (sourcePcm.planeHashByteOrder !== byteOrder) throw failure('source-pcm-byte-order', 'Source PCM hash byte order differs from this native consumer.');
      for (const [index, plane] of sourcePcm.planes.entries()) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', plane.buffer))].map(byte => byte.toString(16).padStart(2, '0')).join(''); guard();
        if (hash !== sourcePcm.planeByteHashes[index]) throw failure('source-pcm-hash-mismatch', 'Source PCM changed before native body preparation.');
      }
    }
    pcmLease = resources.reserve({ kind: 'native-offline-pcm', owner, bytes: nativeBytes, consumerOwned: true });
    graphLease = resources.reserve({ kind: 'native-offline-graph', owner, bytes: audioIntervalStorageBytes(513), estimateBytes: 16 * 1048576, consumerOwned: true });
    context = new OfflineAudioContext({ numberOfChannels: channels, length: frames, sampleRate });
    if (context.sampleRate !== sampleRate || typeof context.suspend !== 'function' || typeof context.resume !== 'function' ||
        typeof context.createStereoPanner !== 'function') throw failure('native-api-unavailable', 'This browser lacks the required native offline scheduling or stereo panning API.');
    const quantum = context.renderQuantumSize ?? 128;
    if (!Number.isSafeInteger(quantum) || quantum < 1 || quantum > 2048) throw failure('native-quantum-unavailable', 'The offline render quantum is outside the supported bounded profile.');
    const merger = node(context.createChannelMerger(channels)), master = node(context.createGain()), splitter = node(context.createChannelSplitter(2));
    merger.channelInterpretation = 'discrete'; merger.connect(context.destination);
    const laneNodes = new Map();
    const channelFor = lane => {
      const id = String(lane ?? 'unassigned'); if (laneNodes.has(id)) return laneNodes.get(id);
      if (laneNodes.size >= 128) throw failure('native-lane-capacity', 'The native graph exceeds 128 captured lane owners.');
      const gain = node(context.createGain());
      const index = stemLaneIds.indexOf(id);
      if (index >= 0) { const tap = node(context.createChannelSplitter(2)); gain.connect(tap); tap.connect(merger, 0, 2 + index * 2); tap.connect(merger, 1, 3 + index * 2); }
      const channel = { gain }; laneNodes.set(id, channel); return channel;
    };
    if (!sourcePcm) {
      sources = createLiveLaneSourceBuses({ context, resources, owner, generation: 0, maximumBuses: 32, isCurrent: () => !signal.aborted && isCurrent() }); sources.declare(sourceLaneIds);
      for (const id of stemLaneIds) if (sourceLaneIds.includes(id)) {
        const pin = sources.pin({ sourceBusId: 'lane:' + id, tap: 'post-fader', inputLayout: 'audioStereo' });
        if (!pin) throw failure('native-lane-source-unavailable', 'A captured native stem could not retain its source bus.');
        stemPins.push(pin); pin.node.connect(channelFor(id).gain);
      }
    }
    if (effectPlan) {
      effects = await prepareNativeEffectGraph(effectPlan.definition, { resolveSidechainSource: request => {
        const route = effectSourceBindings.routes.find(route => route.sourceBusId === request.sourceBusId && route.tap === request.tap);
        if (!route?.available) return null;
        if (route.laneId !== null && sources) return sources.pin(request);
        return { node: route.laneId === null ? master : channelFor(route.laneId).gain, context, owner, generation: request.generation, sourceBusId: request.sourceBusId, tap: request.tap, layout: request.inputLayout, stage: 'upstream-owner-effects',
          isActive: () => context.state !== 'closed' && !signal.aborted, release() {} };
      }, context, resources, owner, signal, isCurrent, getMaterialProvider, jobs, offlineEndFrame: frames, offlineReturnNodeIds: effectReturnNodeIds, offlineSourceBindings: effectSourceBindings, retireOfflineContext, createWorkletNode, initializationTimeoutMs: effectInitializationTimeoutMs }); guard();
      master.connect(effects.getInput(effectPlan.inputs[0])); effects.getOutput(effectPlan.outputs[0]).connect(splitter);
      for (const [index, id] of effectReturnNodeIds.entries()) {
        const tap = node(context.createChannelSplitter(2)), output = effects.getNodeOutput(id);
        if (!output) throw failure('native-effect-tap-unavailable', 'The native graph omitted a requested shared node output.');
        output.connect(tap); const offset = 2 + (stemLaneIds.length + index) * 2; tap.connect(merger, 0, offset); tap.connect(merger, 1, offset + 1);
      }
    } else master.connect(splitter);
    splitter.connect(merger, 0, 0); splitter.connect(merger, 1, 1);
    if (!sourcePcm) {
      host = { _context: context, _generation: 1, _sessions: new Map([[owner, { generation: 1 }]]), _voices: new Set(),
        _semanticVoiceOwners: new Map(), _voicesByToken: new Map(), _retiredVoices: new Map(), _retirementFaults: new Set(),
        _maxNoteSeconds: 150, _maxScheduledVoices: 512, _maxLiveScheduledVoices: 512, _maxVoices: 256, _voiceSequence: 0,
        _audioResources: resources, _intervalAdmission: createAudioIntervalAdmission({ maxIntervals: 513 }),
        _ownerReady: () => context.state !== 'closed' && !signal?.aborted, getAudioContext: () => context,
        _channel: () => ({ gain: master }), _laneSourcesFor: () => sources, _workloadClass: () => 'live', _nowMs: () => context.currentTime * 1000,
        _captureMetadata: fields => fields, _observe() {}, _emitPlayback() {}, _setStatus() {},
        _voiceFinished: nativeVoiceFinished, _renderVoiceCount: nativeRenderVoiceCount, _release: releaseNativeVoice,
        _destroyVoice: destroyNativeVoice, _workloadVoiceCount: workloadVoiceCount,
        _inspectVoiceInterval: inspectVoiceInterval, _inspectVoiceExtensions: inspectVoiceExtensions };
      backend = patch.engineId === 'native-sample' ? createSampleInstrumentBackend(host, owner, { gateMode: 'bounded', clockMode: 'offline', traceLimit: 0 }) :
        createNativeOscillatorBackend(host, owner, { engineId: patch.engineId, gateMode: 'bounded', traceLimit: 0 });
      const preparation = await backend.prepare({ status: 'ready', patch, receipt: { patchId: patch.id, revision: patch.revision } }, assets);
      if (preparation.status !== 'ready') throw failure('native-patch-unavailable', 'The live native source backend rejected this exact offline definition.');
    } else {
      if (typeof context.createBuffer !== 'function' || typeof context.createBufferSource !== 'function') throw failure('native-pcm-api-unavailable', 'Native body rendering requires an explicit owned PCM source buffer.');
      sourceBuffer = context.createBuffer(sourcePcm.channels, frames, sampleRate);
      if (sourceBuffer.length !== frames || sourceBuffer.numberOfChannels !== sourcePcm.channels || sourceBuffer.sampleRate !== sampleRate) throw failure('native-source-buffer-mismatch', 'The native source copy differs from its admitted PCM dimensions.');
      const targets = sourcePcm.planes.map((_, channel) => sourceBuffer.getChannelData(channel));
      if (targets.some(plane => !(plane instanceof Float32Array) || plane.length !== frames)) throw failure('native-source-buffer-mismatch', 'Native source buffer channels differ from the admitted frame count.');
      for (let first = 0; first < frames; first += 16384) {
        guard(); const end = Math.min(frames, first + 16384);
        for (const [channel, plane] of sourcePcm.planes.entries()) {
          for (let index = first; index < end; index++) if (!Number.isFinite(plane[index])) throw failure('source-pcm-nonfinite', 'Source PCM contains a nonfinite sample.');
          targets[channel].set(plane.subarray(first, end), first);
        }
        try { onProgress({ phase: 'preparing-native-source-pcm', completedUnits: end, totalUnits: frames }); } catch {}
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      sourceNode = node(context.createBufferSource()); sourceNode.buffer = sourceBuffer;
      const split = node(context.createChannelSplitter(sourcePcm.channels)), stereo = node(context.createChannelMerger(2));
      sourceNode.channelInterpretation = 'discrete'; split.channelInterpretation = 'discrete'; stereo.channelInterpretation = 'discrete';
      sourceNode.connect(split); split.connect(stereo, 0, 0); split.connect(stereo, 1, 1); stereo.connect(master);
      for (let tap = 0; tap < sourcePcmLaneIds.length; tap++) {
        const lane = node(context.createChannelMerger(2)); lane.channelInterpretation = 'discrete'; split.connect(lane, 2 + tap * 2, 0); split.connect(lane, 3 + tap * 2, 1); lane.connect(channelFor(sourcePcmLaneIds[tap]).gain);
      }
      sourceNode.start(0); sourceStarted = true;
    }
    // IR analysis is a separate admitted worker operation. Acquire native
    // execution only after preparation so two native renders cannot occupy
    // every shared worker slot while waiting for their own analysis jobs.
    await effects?.activateSidechains(); guard();
    if (!execution) await acquireExecution();
    signal?.addEventListener('abort', cancel, { once: true }); guard();
    const schedule = until => {
      for (const voice of host?._voices || []) if (host._voiceFinished(voice)) host._destroyVoice(voice, 'offline-finished-voice');
      while (cursor < events.length && events[cursor].frame < until) {
        guard(); const event = events[cursor++];
        if (event.kind === 'begin') {
          const onset = accept(backend.begin({ ...event.intent, audioLaneId: String(event.laneId ?? 'unassigned'), voiceId: event.voiceId, performanceControls: event.intent?.performanceControls || {} }, event.frame, event.executionEpoch || 'offline-render'), event);
          const selection = retainSampleSelectionReceipt(onset);
          if (selection) { selectedOnsets++; if (sourceSelections.length < selectionLimit) sourceSelections.push(Object.freeze({ intentId: event.intent.intentId, voiceId: event.voiceId, frame: event.frame, ...selection })); }
          accept(backend.end(event.voiceId, { seconds: event.releaseSeconds, ...(event.releaseVelocity01 != null ? { velocity01: event.releaseVelocity01 } : {}) }, event.releaseFrame, event.executionEpoch || 'offline-render'), event);
        } else if (event.kind === 'end') {
          accept(backend.end(event.voiceId, { seconds: event.releaseSeconds, ...(event.releaseVelocity01 != null ? { velocity01: event.releaseVelocity01 } : {}),
            ...(event.force != null ? { force: event.force } : {}) }, event.frame, event.executionEpoch || 'offline-render'), event);
        } else if (event.kind === 'lane') accept(backend.updateLaneMix(event.voiceId, { gain: 1, pan: 0 }, event.frame, event.executionEpoch || 'offline-render', event.laneId), event);
        else if (event.kind === 'update' && Object.keys(event.expression || {}).length)
          accept(backend.update(event.voiceId, event.expression, event.frame, event.executionEpoch || 'offline-render'), event);
      }
      if (host?._retirementFaults?.size) throw failure('native-voice-retirement', 'A native voice failed to retire completely.');
    };
    let frontier = 0;
    while (frontier < frames) {
      guard();
      if (panicFrame === frontier && !panicReceipt) {
        const retirement = backend.dispose(); if (retirement?.completion) await retirement.completion;
        if (retirement?.outcome !== 'complete') throw failure('native-panic-rejected', 'Shared native source teardown did not acknowledge its qualification stop.');
        cursor = events.length; panicReceipt = { frame: frontier, retirement: { state: retirement.state, outcome: retirement.outcome },
          source: 'shared-native-source-hard-teardown', futureFixtureEvents: 'explicitly-suppressed-after-panic', livePanicControlDelivery: 'separate-conformance-required' };
      }
      const horizon = Math.min(frames, panicFrame != null && frontier < panicFrame ? panicFrame : Infinity, frontier + Math.max(quantum, Math.floor(sampleRate / 2 / quantum) * quantum));
      const dense = events[cursor + 31];
      const next = dense ? Math.min(horizon, Math.max(frontier + quantum, Math.ceil((dense.frame + 1) / quantum) * quantum)) : horizon;
      schedule(Math.min(next, frames)); batches++;
      if (next < frames) {
        // suspend() rounds UP to a render quantum. Stay inside the preceding
        // sample to avoid a floating point quotient moving one quantum later.
        suspension = context.suspend((next - 0.25) / sampleRate); suspension.catch(() => {});
      }
      if (!nativeWork) { startNativeWork(); readiness = effects?.confirmReady() || Promise.resolve(); readiness.catch(() => {}); }
      else await context.resume();
      if (next < frames) {
        await Promise.all([suspension, readiness]); suspension = null;
        if (Math.round(context.currentTime * sampleRate) !== next) throw failure('native-suspend-frame', 'The browser suspended at a different native frame frontier.');
      } else { rendered = await nativeWork; await readiness; }
      frontier = Math.min(next, frames); guard();
      try { onProgress({ phase: 'rendering-native-offline', completedUnits: frontier, totalUnits: frames }); } catch { /* Progress observers do not own native processing. */ }
    }
    if (rendered?.length !== frames || rendered.sampleRate !== sampleRate || rendered.numberOfChannels !== channels)
      throw failure('native-output-mismatch', 'The browser returned a different offline PCM layout.');
    if (effects) {
      await effects.confirmOfflineCompletion(); guard();
      effectReceipt = Object.freeze({ hash: effects.hash, controls: 'explicit-authored-defaults-not-replayed-live-gestures',
        scope: 'one-full-shared-owner-sum', sourceBindings: effectSourceBindings, returnNodeIds: Object.freeze(effectReturnNodeIds.slice()), realization: effects.diagnostics() });
      validateNativeEffectRenderReceipt(effectPlan, { method: 'native-offline-audio-context', frames, effectGraph: effectReceipt }, effects.hash, effectReturnNodeIds);
    }
  } catch (error) { originalError = error; }
  finally {
    externalSignal?.removeEventListener('abort', forwardAbort);
    signal?.removeEventListener('abort', cancel);
    if (originalError) cancel();
    // Older OfflineAudioContext implementations have no close(). Cancellation
    // drains the bounded disconnected graph and keeps all PCM storage charged.
    if (nativeWork && !nativeSettled && !(originalError?.retirement && originalError.retirement.outcome !== 'complete')) {
      try { if (suspension) await suspension; } catch (error) { originalError ||= error; }
      try { if (context.state === 'suspended') await context.resume(); await nativeWork; } catch (error) { originalError ||= error; }
    }
    const receipt = scope.retire([
      { name: 'native-producer', run: () => { if (originalError?.retirement && originalError.retirement.outcome !== 'complete') throw failure('native-preparation-retirement-unknown', 'Prepared IR producer custody remains unresolved.'); if (nativeWork && (!nativeSettled || nativeFailed && context.state !== 'closed')) throw failure('native-producer-unknown', 'Offline producer retirement could not be confirmed.'); } },
      { name: 'native-voices', run: () => backend?.dispose() },
      { name: 'native-effects', run: async () => { if (effects) { const retired = effects.dispose(); await retired.completion; if (retired.outcome !== 'complete') throw failure('native-effect-retirement-unknown', 'Native convolution and its IR pins remain owned.'); } } },
      { name: 'native-lane-sources', run: () => { for (const pin of stemPins) pin.release(); return sources?.dispose(); } },
      { name: 'native-graph', run: () => { for (const value of nodes) value.disconnect(); } },
      { name: 'native-source-buffer', run: () => { if (sourceStarted) sourceNode.stop(); if (sourceNode) sourceNode.buffer = null; sourceBuffer = null; } }
    ]); await receipt.completion;
    if (receipt.outcome !== 'complete') {
      const error = failure('native-retirement-unknown', 'Native offline resources remain reserved: ' + receipt.resources.filter(resource => resource.status !== 'completed').map(resource => resource.name + ': ' + (resource.error || resource.status)).join('; '), { cause: originalError, retirement: receipt });
      error.retainedNative = { context, host, backend, sources, stemPins, effects, sourceNode, sourceBuffer, sourcePcm, nodes: nodes.slice(), rendered, nativeWork };
      pcmLease?.retainUnknown(error); graphLease?.retainUnknown(error); inputLease?.retainUnknown(error); execution?.retainUnknown(error); retirementExecution?.retainUnknown(error); originalError = error;
    } else {
      const storage = createProcgenRetirementScope().retire([
        { name: 'native-graph-storage', run: () => graphLease?.release() },
        { name: 'native-source-copy', run: () => inputLease?.release() },
        { name: 'failed-native-pcm', run: () => { if (originalError) pcmLease?.release(); } },
        { name: 'native-execution', run: () => { for (const lease of [execution, retirementExecution]) if (lease) { lease.confirmRetirement(); if (lease.getState().phase !== 'released') throw failure('native-admission-retirement', 'Native execution admission release is unresolved.'); } } }
      ]); await storage.completion;
      if (storage.outcome !== 'complete') { originalError = failure('native-retirement-unknown', 'Native resource bookkeeping remains unresolved.', { cause: originalError, retirement: storage }); pcmLease?.retainUnknown(originalError); }
    }
    nodes.length = 0; context = host = backend = sources = effects = sourceNode = sourceBuffer = nativeWork = suspension = null;
  }
  if (originalError) throw originalError;
  const inputReceipt = sourcePcm ? Object.freeze({ frames, channels: sourcePcm.channels, bytes: sourceBytes, laneIds: Object.freeze(sourcePcmLaneIds.slice()), sourceLaneIds: Object.freeze(sourceLaneIds.slice()), planeByteHashes: Object.freeze(sourcePcm.planeByteHashes.slice()), planeHashByteOrder: sourcePcm.planeHashByteOrder, scope: 'whole-dry-source-history-before-crop' }) : null;
  sourcePcm = null;
  let released = false;
  return Object.freeze({ get buffer() { return rendered; }, frames, sampleRate, channels, stemLaneIds: Object.freeze(stemLaneIds.slice()),
    receipt: Object.freeze({ method: 'native-offline-audio-context', frames, nativeSourceBackend: patch.engineId, effectGraph: effectReceipt, sourcePcm: inputReceipt, batches, submitted, executionAdmission: execution.getState(),
      panic: panicReceipt, scheduling: 'explicit-native-frames-with-quantum-suspension', gates: 'bounded-offline-with-preflighted-terminal-intervals',
      renderTap: 'simultaneous-native-source-graph-before-live-master', crossBrowserBitIdentity: false,
      sourceSelections: Object.freeze(sourceSelections), sourceSelectionCoverage: Object.freeze({ selectedOnsets, retained: sourceSelections.length, limit: selectionLimit, omitted: selectedOnsets - sourceSelections.length, evidenceClass: 'native-source-selection-api', acousticReceipt: false }) }),
    release() { if (released) return false; pcmLease.release(); released = true; rendered = null; return true; } });
}
