import { createResonatorMorphGraph } from '../../../midi/content/ResonatorMorphGraph.js';
import { SPECTRAL_CAPTURE_POLICY } from '../../../midi/content/SpectralCaptureReceipt.js';
import { createPreparedSurfaceBodyOwner } from './PreparedSurfaceBodyOwner.js';
import { createPreparedBodyStrikeBackend } from './PreparedBodyStrikeBackend.js';
import { createEffectPerformanceCapture } from './EffectPerformanceCapture.js';
import { createTravelColorationRecipe } from '../../../midi/content/TravelColorationRecipes.js';
import { createTravelEffectMotion } from './TravelEffectMotion.js';
import { getNativeInstrumentCatalog } from '../../midi-ui/NativeInstrumentSchema.js';
import { createLaneMixState } from './LaneMixState.js';
import { createAudioClockBridge } from './AudioClockBridge.js';
import { createCausalMusicEngine } from './CausalMusicEngine.js';
import { captureCausalPerformanceState } from './CausalPerformanceState.js';
import { createCausalIntentDispatcher, createStrictLiveFramePolicy } from './CausalIntentDispatcher.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { createRoutedInstrumentBackend } from '../../midi-ui/RoutedInstrumentBackend.js';
import { createLaneInstrumentPreparation } from '../../midi-ui/LaneInstrumentPreparation.js';
import { connectProcgenActorEffectSource } from '../ProcgenActorEffectSource.js';

let nextEffectStream = 0;
const nativeResolution = Object.freeze({
  status: 'ready',
  patch: Object.freeze({ id: 'procgen-physical-default', revision: 1, engineId: 'native-oscillator', engineVersion: 1,
    parameters: Object.freeze({ waveform: 1, gain01: 0.8, attackSeconds: 0.004, decaySeconds: 0.06,
      sustain01: 0.55, releaseSeconds: 0.08 }), sampleRefs: Object.freeze([]),
    voicePolicy: Object.freeze({ maxVoices: 64, steal: 'reject' }), mix: Object.freeze({ gain01: 0.6, pan01: 0 }) }),
  receipt: Object.freeze({ patchId: 'procgen-physical-default', revision: 1 })
});

// Owns only the physical voice session. The ordinary game preview and MIDI
// router keep their independent leases on the shared output graph.
export function createProcgenPhysicalPlayback({ audio, getGraph, scoreTimeline, now, renderer = null, resourceBudget = null, world = null, getLanes = () => [], isPlaybackEnabled = () => !!audio?.getState?.().enabled,
  documentEpoch = 'physical-document-' + (nextEffectStream + 1), onInstrumentState = () => {}, onReceipt = () => {}, isEffectCaptureEnabled = () => true, getInstrumentCatalog = getNativeInstrumentCatalog } = {}) {
  const laneMix = createLaneMixState(); laneMix.synchronize(getLanes());
  const permitted = () => { try { return isPlaybackEnabled() === true; } catch { return false; } };
  const session = audio?.createSession?.('procgen-physical') || null;
  session?.configureLaneSources?.(getLanes().map(lane => lane.id));
  const nativeBackend = session?.createInstrumentBackend?.({ gateMode: 'owned' }) || null;
  let routed = null, routingUnavailable = null;
  try { if (nativeBackend?.inspectExecution) routed = createRoutedInstrumentBackend({ defaultBackend: nativeBackend, resourceBudget, getContext: () => audio.getAudioContext(),
    getGeneration: () => nativeBackend.executionIncarnation?.() ?? 0, defaultReleaseSeconds: nativeResolution.patch.parameters.releaseSeconds, defaultOneShotTailSeconds: 0.08,
    getLaneMix: laneId => laneMix.mix(laneId),
    resolveLane: laneId => typeof laneId === 'number' ? getLanes()[laneId]?.id || String(laneId) : String(laneId),
    requiredInstrumentKey: (laneId, sourceId) => { const lane = typeof sourceId === 'number' ? getLanes()[sourceId] : getLanes().find(entry => entry.id === laneId), reference = lane?.instrumentRef;
      return reference ? reference.packHash + ':' + reference.definitionHash : null; } }); }
  catch { routingUnavailable = 'audio-routing-resource-unavailable'; try { onInstrumentState({ laneId: 'all', state: 'unavailable', code: routingUnavailable }); } catch { /* Audio admission cannot stop the world. */ } }
  const backend = routingUnavailable ? null : routed?.backend || nativeBackend;
  let laneInstruments = null;
  try { if (routed) laneInstruments = createLaneInstrumentPreparation({ session, routed, getCatalog: getInstrumentCatalog, onState: onInstrumentState, resourceBudget, getMaterialProvider: () => audio.getSoundMaterialProvider() }); }
  catch { routingUnavailable = 'audio-preparation-resource-unavailable'; try { onInstrumentState({ laneId: 'all', state: 'unavailable', code: routingUnavailable }); } catch { /* Preparation cannot stop physics. */ } }
  const clock = createAudioClockBridge({ getContext: () => audio?.getAudioContext?.(), nowMs: now,
    presentationDelayMs: 24, maxHorizonMs: 5000 });
  let disposed = false, prepared = false, armEnabled = true, enableLease = null, executionEpoch = null, previousGeneration = null, previousWorldId = null, previousTerrainRevision = null, executionSerial = 0;
  let anchoredEpoch = null, anchoredBpm = null, rejected = 0, accepted = 0, leaseFailures = 0;
  let surfaceBodies = null;
  const effectStreamId = 'physical-effects-' + (++nextEffectStream); let effectClockAnchor = null;
  const effectCapture = createEffectPerformanceCapture({ owner: documentEpoch + ':effect-capture', streamId: effectStreamId, resourceBudget, getContext: () => audio?.getAudioContext?.(), getExecutionEpoch: () => executionEpoch, getAnchor: () => effectClockAnchor, isEnabled: isEffectCaptureEnabled, onReceipt });
  let latestSinkOutcome = null, lastMixPublication = null, declaredSourceLanes = null;
  let leaseUntil = null, leaseEpoch = null, leaseContext = null;
  let lastAudioEnabled = false, lastAudioContext = null;
  let displayKey = null, releaseDisplay = null, displayErrors = 0, displayBlocked = false;
  const retirement = createProcgenRetirementScope();
  const stopDisplay = () => {
    const release = releaseDisplay; releaseDisplay = null; displayKey = null;
    const receipt = createProcgenRetirementScope().retire([
      { name: 'display-source', run: () => release?.() },
      { name: 'display-view', run: () => { const manager = renderer?.actorEffects; if (manager) { manager.subscription?.(); manager.subscription = null; manager.clear({ profiles: false }); } } }
    ]);
    if (receipt.outcome !== 'complete') { displayErrors++; displayBlocked = true; } return receipt;
  };
  const arm = () => {
    if (disposed || !armEnabled || !prepared || !session || !permitted() || !audio?.getState?.().enabled || session.getState().enabled || enableLease) return;
    const lease = {}; enableLease = lease;
    try {
      Promise.resolve(session.enable()).catch(() => false).finally(() => { if (enableLease === lease) enableLease = null; });
    } catch { if (enableLease === lease) enableLease = null; }
  };
  const preparedPromise = nativeBackend ? Promise.resolve(nativeBackend.prepare(nativeResolution)).then(receipt => {
    prepared = receipt?.status === 'ready' && !routingUnavailable;
    arm();
    return prepared;
  }).catch(() => false) : Promise.resolve(false);
  const unsubscribe = audio?.subscribe?.(state => {
    const context = audio?.getAudioContext?.();
    if (state.enabled) { arm(); if (!lastAudioEnabled || context !== lastAudioContext) laneInstruments?.retry(getLanes()).catch(() => {}); }
    else { clock.invalidate(); anchoredEpoch = null; anchoredBpm = null; } lastAudioEnabled = !!state.enabled; lastAudioContext = context;
  }) || null;
  let bodyBackend = null;
  try { bodyBackend = session?.observeBodyReceipts ? createPreparedBodyStrikeBackend({ owner: documentEpoch + ':finite-strikes', resourceBudget,
    resolveBody: id => surfaceBodies?.resolveActiveBody(id) || null, inventory: () => session.preparedBodyInventory(), enqueue: (id, command, expected) => session.enqueueBodyStrike(id, command, expected), panicBody: (id, expected) => session.panicPreparedBody(id, expected), observe: listener => session.observeBodyReceipts(listener),
    onReceipt: receipt => {
      try { onReceipt(receipt); } catch {}
      if (receipt.stage === 'body-strike-applied' && receipt.executionEpoch === executionEpoch) captureEffect('body-strike', { ownerRouteRevision: receipt.ownerRouteRevision, graphDefinitionHash: receipt.graphDefinitionHash, sampleRate: receipt.sampleRate, targetFrame: receipt.appliedFrame }, {
        nodeId: receipt.nodeId, sourceEventIds: receipt.source.sourceEventIds, executionEpoch: receipt.executionEpoch,
        clockAnchor: { intentId: receipt.source.intentId, sourceTargetFrame: receipt.targetFrame, executionEpoch: receipt.executionEpoch },
        strike: { ...receipt.source, x01: receipt.command.x01, y01: receipt.command.y01, amplitude01: receipt.command.amplitude01, pulseMilliseconds: [4, 8, 12][receipt.command.pulseIndex], applicationEvidence: receipt.applicationEvidence } });
      else if (receipt.status === 'rejected' || receipt.stage === 'body-strike-applied' || receipt.stage === 'body-strike-ended' && receipt.reasonCode !== 0 || receipt.stage === 'body-source-owner-retired') onReceipt({ status: 'rejected', stage: 'effect-performance-capture', reason: 'finite-body-source-not-completely-observed', acousticReceipt: false });
    } }) : null; } catch (error) { try { onInstrumentState({ laneId: 'prepared-body', state: 'unavailable', code: error.code || error.message }); } catch {} }
  const dispatcher = createCausalIntentDispatcher({
    sinks: [...(backend ? [{ id: 'physical-browser-audio', route: 'local', backend }] : []), ...(bodyBackend ? [{ id: 'physical-shared-body', route: 'prepared-body', backend: bodyBackend }] : [])],
    executionEpoch: () => executionEpoch,
    toTargetFrame: scoreTime => permitted() ? clock.toTargetFrame(scoreTime, executionEpoch) : null,
    latePolicy: createStrictLiveFramePolicy({ nowFrame: () => clock.currentFrame() }),
    onReceipt: receipt => { if (Number.isSafeInteger(receipt.sourceTargetFrame) && receipt.sourceTargetFrame >= 0 && receipt.executionEpoch === executionEpoch) { effectClockAnchor = Object.freeze({ intentId: receipt.intentId, sourceTargetFrame: receipt.sourceTargetFrame, executionEpoch }); effectCapture.flush(); } latestSinkOutcome = { status: receipt.status, reason: receipt.reason || null }; if (receipt.status === 'accepted') accepted++; else rejected++; onReceipt(receipt); }
  });
  const captureEffect = effectCapture.capture;
  let unsubscribeEffectReceipts = null;
  const observeEffectReceipt = receipt => {
    if (!disposed && receipt.status === 'accepted' && receipt.stage === 'spectral-capture-applied') captureEffect('spectral-capture', receipt, { nodeId: receipt.nodeId, spectralCapture: receipt.spectralCapture });
  };
  const prepareEffectGraph = async (definition, options) => { if (!session?.prepareEffectGraph) throw new Error('Physical owner effects are unavailable.');
    const result = await session.prepareEffectGraph(definition, options), state = session.getEffectPerformanceState?.();
    captureEffect('graph', state, { definition: state?.definition, ...(unsubscribeEffectReceipts && state?.definition?.nodes.some(node => node.kind === 'spectral-freeze') ? { spectralCapturePolicy: SPECTRAL_CAPTURE_POLICY } : {}) }); return result;
  };
  const updateEffectGraph = (nodeId, values, frame, expected, cause = null) => {
    if (!session?.updateEffectGraph) throw new Error('Physical effect controls are unavailable.');
    const receipt = session.updateEffectGraph(nodeId, values, frame, expected), state = session.getEffectPerformanceState?.();
    if (state && receipt.status === 'accepted') captureEffect('control', { ...state, targetFrame: receipt.targetFrame }, { nodeId, values, sourceEventIds: cause?.sourceEventIds || [] }); return receipt;
  };
  const preparedBodies = () => surfaceBodies ||= createPreparedSurfaceBodyOwner({ documentEpoch, inventory: () => session?.preparedBodyInventory?.() || [], resourceBudget, onReceipt,
    apply: (nodeId, values, frame, expected, cause) => {
      if (!session?.updatePreparedBody) throw new Error('Prepared body routing is unavailable.');
      const receipt = session.updatePreparedBody(nodeId, values, frame, expected), current = session.getEffectPerformanceState?.();
      captureEffect('control', { ...current, ownerRouteRevision: receipt.ownerRouteRevision, graphDefinitionHash: receipt.graphDefinitionHash, sampleRate: audio.getAudioContext().sampleRate, targetFrame: receipt.targetFrame }, { nodeId, values, sourceEventIds: cause?.sourceEventIds || [] }); return receipt;
    },
    panicBody: (nodeId, expected) => { const receipt = session?.panicPreparedBody?.(nodeId, expected);
      if (receipt?.status === 'accepted') captureEffect('body-panic', { ...expected, sampleRate: audio.getAudioContext().sampleRate, targetFrame: Math.ceil(audio.getAudioContext().currentTime * audio.getAudioContext().sampleRate) }, { nodeId }); return receipt; },
    toFrame: (scoreTime, epoch, release) => { const frame = permitted() ? clock.toTargetFrame(scoreTime, epoch) : null; return release && Number.isSafeInteger(frame) ? Math.max(frame, clock.currentFrame()) : frame; } });
  const bindPreparedSurface = options => {
    if (!executionEpoch || !Number.isSafeInteger(previousGeneration)) throw new Error('Observe the current physical execution before binding its prepared surface.');
    const surface = getGraph().preparedSurfaces?.find(surface => surface.id === options.surfaceId);
    if (!surface || surface.surfaceMap.boundTopologyRevision !== previousTerrainRevision) throw new Error('The named surface map is missing or differs from the observed terrain revision.');
    return preparedBodies().bind({ ...options, preparationKinds: [...new Set(surface.preparations.map(preparation => preparation.kind))], lossMaskIds: surface.preparations.filter(preparation => preparation.kind === 'mode-loss').map(preparation => preparation.lossMaskId), surfaceRevision: surface.revision, surfaceMap: surface.surfaceMap, executionEpoch, worldId: previousWorldId, generation: previousGeneration });
  };
  const setEffectBypass = (mode, expected) => { const state = session?.getEffectPerformanceState?.(), result = session?.setEffectBypass?.(mode, expected); if (result) captureEffect('bypass', state, { mode }); return result; };
  const travelEffects = createTravelEffectMotion({ resourceBudget, update: updateEffectGraph,
    bypass: setEffectBypass, toFrame: clock.toTargetFrame, onReceipt });
  const travelEffectSources = () => {
    const instruments = new Map(getGraph().instruments.filter(instrument => instrument.articulation?.sustain && ['signedX', 'signedY'].includes(instrument.articulation.orientation)).map(instrument => [instrument.id, instrument]));
    return engine ? engine.activeVoiceView({ limit: 64, instrumentIds: [...instruments.keys()] }) : [];
  };
  const prepareTravelEffect = async ({ voiceId, generation, ...parameters }, options = {}) => {
    if (disposed || !session?.prepareEffectGraph || !travelEffectSources().some(voice => voice.voiceId === voiceId && voice.generation === generation)) throw new Error('Choose an active sustained signed-distance voice before preparing travel color.');
    const model = createTravelColorationRecipe(parameters), state = await prepareEffectGraph(model.graph, { ...options, isCurrent: () => !disposed && (!options.isCurrent || options.isCurrent()) });
    const expected = { graphDefinitionHash: state.activeGraph.hash, ownerRouteRevision: state.revision };
    try {
      const source = travelEffectSources().find(voice => voice.voiceId === voiceId && voice.generation === generation);
      if (!source || disposed) throw new Error('The selected physical travel voice ended during preparation.');
      travelEffects.bind({ voiceId, generation, instrumentId: source.instrumentId, control: model.control, expected }); return Object.freeze({ model, state });
    } catch (error) { try { setEffectBypass('tail', expected); } catch {} throw error; }
  };
  const prepareMorphEffect = async ({ voiceId = null, generation = null, ...parameters }, options = {}) => {
    const context = audio.getAudioContext?.();
    if (disposed || !session?.prepareEffectGraph || context?.state !== 'running') throw new Error('Enable the canonical physical audio owner before preparing a live morph body.');
    const check = () => { options.signal?.throwIfAborted(); if (disposed || audio.getAudioContext() !== context || context.state !== 'running' || options.isCurrent && !options.isCurrent()) throw new Error('The physical owner, clock or reviewed morph source changed.'); if (voiceId !== null && !travelEffectSources().some(voice => voice.voiceId === voiceId && voice.generation === generation)) throw new Error('The selected observed travel voice ended before morph publication.'); };
    check(); const model = await createResonatorMorphGraph(parameters, context.sampleRate); check();
    const state = await prepareEffectGraph(model.graph, { ...options, isCurrent: () => { try { check(); return true; } catch { return false; } } }), expected = { graphDefinitionHash: state.activeGraph.hash, ownerRouteRevision: state.revision };
    try { check(); if (voiceId !== null) { const source = travelEffectSources().find(voice => voice.voiceId === voiceId && voice.generation === generation); travelEffects.bind({ voiceId, generation, instrumentId: source.instrumentId, control: model.control, expected }); } else travelEffects.clear('manual-morph-prepared'); return Object.freeze({ model, state }); }
    catch (error) { try { setEffectBypass('tail', expected); } catch {} throw error; }
  };
  let engine;
  try { unsubscribeEffectReceipts = session?.observeEffectReceipts?.(observeEffectReceipt); engine = createCausalMusicEngine({ getGraph, scoreTimeline, resourceBudget, world, getActivityOutputState: () => ({ status: !prepared || routingUnavailable ? 'unavailable' : !session?.getState().enabled ? 'disabled' : 'available', lastSinkOutcome: latestSinkOutcome }),
    getLaneState: laneId => { const id = typeof laneId === 'number' ? getLanes()[laneId]?.id : laneId, mix = laneMix.mix(id); return { available: !!mix && !mix.muted && !mix.soloSuppressed }; },
    getPerformanceState: () => captureCausalPerformanceState(getLanes()),
    getOnsetControls: laneId => (typeof laneId === 'number' ? getLanes()[laneId] : getLanes().find(lane => lane.id === laneId))?.instrumentControls,
    getPhysicalControlKinds: laneId => [...new Set(((typeof laneId === 'number' ? getLanes()[laneId] : getLanes().find(lane => lane.id === laneId))?.instrumentRef?.definition?.causalBindings || [])
      .filter(binding => binding.mode === 'continuous').map(binding => binding.sourceKind))],
    deliver: (intents, batch, bodyCommands = []) => { const receipts = dispatcher.dispatch(intents, batch), admissions = new Map(receipts.map(receipt => [receipt.intentId, receipt.status]));
      travelEffects.consume(intents, executionEpoch);
      for (const command of bodyCommands) { if (surfaceBodies) surfaceBodies.consume(command, executionEpoch); else onReceipt({ status: 'rejected', stage: 'prepared-body-control', commandId: command.commandId, sourceEventIds: command.sourceEventIds, reason: 'prepared-surface-not-bound', acousticReceipt: false }); }
      for (const intent of intents) if (intent.kind === 'begin') { const lane = typeof intent.laneId === 'number' ? getLanes()[intent.laneId] : getLanes().find(lane => lane.id === intent.laneId); if (lane) laneMix.record(lane.id, now(), admissions.get(intent.intentId) || 'unavailable'); } return receipts; } });
  engine.prepareGraph(getGraph()).commit();
  } catch (error) { disposed = true; error.retirement = retirement.retire([
    { name: 'causal-observer-storage', run: () => engine?.dispose() }, { name: 'audio-state-subscription', run: () => unsubscribe?.() }, { name: 'dispatcher', run: () => dispatcher.dispose() },
    { name: 'lane-instruments', run: () => laneInstruments?.dispose() }, { name: 'effect-receipt-subscription', run: () => unsubscribeEffectReceipts?.() }, { name: 'effect-capture', run: () => effectCapture.dispose() }, { name: 'body-source-backend', run: () => bodyBackend?.dispose() }, { name: 'backend', run: () => (backend || nativeBackend)?.dispose?.() }, { name: 'session', run: () => session?.dispose?.() }
  ]); throw error; }
  const refreshDisplay = batch => {
    const manager = renderer?.actorEffects, state = audio?.getState?.(), owner = session?.getState?.().ownerId;
    if (!backend || !manager || manager.retired || !manager.visible || !permitted() || !state?.enabled || !session?.getState().enabled) { if (displayKey) stopDisplay(); return; }
    if (displayBlocked) return;
    const graphRevision = getGraph()?.revision, routeRevision = routed?.routeRevision() ?? 0, contextEpoch = state.contextEpoch;
    if (!Number.isSafeInteger(contextEpoch) || !Number.isSafeInteger(graphRevision) || typeof owner !== 'string') return;
    backend.setDisplayContext?.({ worldId: batch.worldId, graphRevision, routeRevision });
    const actorIds = [];
    if (Number.isSafeInteger(manager.inspectedActorId)) actorIds.push(manager.inspectedActorId);
    for (const actorId of renderer.effectTelemetryActors || []) { if (actorIds.length >= 16) break; if (!actorIds.includes(actorId)) actorIds.push(actorId); }
    if (!actorIds.length) { if (displayKey) stopDisplay(); return; }
    const identity = { worldId: batch.worldId, generation: batch.generation, executionEpoch, contextEpoch, graphRevision, routeRevision };
    const key = JSON.stringify([batch.worldId, batch.generation, executionEpoch, contextEpoch, graphRevision, routeRevision, actorIds]);
    if (key === displayKey && manager.subscription) return;
    if (releaseDisplay) { const receipt = stopDisplay(); if (receipt.outcome !== 'complete') return; }
    const release = connectProcgenActorEffectSource({ renderer, owner, identity, actorIds,
      backend: { observeDisplaySamples: (listener, options) => dispatcher.observeDisplaySamples('physical-browser-audio', listener, options) },
      getCorrelation: sample => clock.correlateDisplay({ executionEpoch: sample.executionEpoch, contextEpoch: sample.contextEpoch }), maxVoices: 16, rateHz: 20 });
    if (release) { releaseDisplay = release; displayKey = key; }
  };
  const synchronizeLaneMix = () => {
    const lanes = getLanes();
    if (lanes !== declaredSourceLanes) { session?.configureLaneSources?.(lanes.map(lane => lane.id)); declaredSourceLanes = lanes; }
    laneMix.synchronize(lanes); const revision = laneMix.revision(), context = audio?.getAudioContext?.();
    if (lastMixPublication?.revision === revision && lastMixPublication.context === context && lastMixPublication.executionEpoch === executionEpoch) return { status: 'accepted', stage: 'unchanged' };
    const receipt = routed?.synchronizeLaneMix(clock.currentFrame()) || { status: 'rejected', reason: 'lane-mix-renderer-unavailable' };
    if (receipt.status === 'accepted') lastMixPublication = { revision, context, executionEpoch }; return receipt;
  };
  const processBatch = (batch, { bpm, playing = true, position = null } = {}) => {
    if (disposed || !playing) return Object.freeze([]);
    if (!permitted() && session?.getState().enabled) stop();
    armEnabled = true;
    const nextEpoch = `${batch.worldId}:${batch.generation}:${executionSerial}`;
    if (previousGeneration !== null && previousGeneration !== batch.generation) {
      dispatcher.cancelGeneration(previousGeneration, executionEpoch);
      clock.invalidate(); anchoredEpoch = null;
    }
    previousGeneration = batch.generation; previousWorldId = batch.worldId; previousTerrainRevision = batch.terrainRevisionAfter ?? batch.snapshot?.terrainRevision ?? null;
    if (executionEpoch !== nextEpoch) { effectClockAnchor = null; if (executionEpoch !== null) { effectCapture.invalidate('physical-execution-changed-before-effect-clock-anchor'); surfaceBodies?.clear('physical-execution-changed'); } }
    executionEpoch = nextEpoch;
    arm();
    const score = position || scoreTimeline.map({ simTick: batch.tick });
    if (prepared && permitted() && session?.getState().enabled &&
        (!clock.isAnchored(executionEpoch, score.epoch, bpm) || anchoredEpoch !== score.epoch || anchoredBpm !== bpm)) {
      try {
        effectClockAnchor = null; clock.rebase({ executionEpoch, scoreEpoch: score.epoch, beat: score.beat, hostMs: now(), bpm,
          reason: anchoredEpoch === null ? 'start' : 'source-change' });
        anchoredEpoch = score.epoch; anchoredBpm = bpm;
      } catch { clock.invalidate(); anchoredEpoch = null; }
    }
    if (routed && prepared && permitted() && session?.getState().enabled) {
      const frame = clock.currentFrame(), context = audio.getAudioContext(), rate = context?.sampleRate;
      if (Number.isSafeInteger(frame) && Number.isFinite(rate) && (leaseEpoch !== executionEpoch || leaseContext !== context || leaseUntil == null || frame + rate * 4 >= leaseUntil)) {
        const until = frame + Math.ceil(rate * 10);
        if (dispatcher.renewExecutionLease(batch.generation, executionEpoch, until).status === 'accepted') { leaseUntil = until; leaseEpoch = executionEpoch; leaseContext = context; }
        else leaseFailures++;
      }
    }
    synchronizeLaneMix();
    try { refreshDisplay(batch); } catch { displayErrors++; }
    try { return engine.processBatch(batch); } catch (error) { error.playbackRetirement = stop(); throw error; }
  };
  const stop = () => {
    captureEffect('bypass', session?.getEffectPerformanceState?.(), { mode: 'owner-stop' }); effectCapture.invalidate(); effectClockAnchor = null;
    armEnabled = false; enableLease = null;
    const generation = previousGeneration, epoch = executionEpoch;
    executionSerial++; previousGeneration = null; previousWorldId = null; previousTerrainRevision = null; executionEpoch = null;
    leaseUntil = null; leaseEpoch = null; leaseContext = null;
    return createProcgenRetirementScope().retire([
      { name: 'surface-contact-bindings', run: () => surfaceBodies?.clear('playback-stopped') },
      { name: 'travel-effect-control', run: () => travelEffects.clear('playback-stopped', true) },
      { name: 'display-observation', run: stopDisplay },
      { name: 'dispatch-generation', run: () => { if (generation !== null) return dispatcher.cancelGeneration(generation, epoch); } },
      { name: 'audio-session', run: () => session?.stop?.() },
      { name: 'clock', run: () => { clock.invalidate(); anchoredEpoch = null; anchoredBpm = null; } }
    ]);
  };
  const dispose = () => {
    if (retirement.getReceipt()) return retirement.getReceipt();
    disposed = true;
    return retirement.retire([
      { name: 'audio-state-subscription', run: () => unsubscribe?.() },
      { name: 'playback-stop', run: stop }, { name: 'surface-body-binding-storage', run: () => surfaceBodies?.dispose() }, { name: 'motion-effect-owner', run: () => travelEffects.dispose() }, { name: 'dispatcher', run: () => dispatcher.dispose() },
      { name: 'causal-observer-storage', run: () => engine.dispose() }, { name: 'effect-receipt-subscription', run: () => unsubscribeEffectReceipts?.() }, { name: 'effect-capture', run: () => effectCapture.dispose() }, { name: 'body-source-backend', run: () => bodyBackend?.dispose() },
      { name: 'lane-instrument-preparation', run: () => laneInstruments?.dispose() },
      { name: 'instrument-backend', run: () => (backend || nativeBackend)?.dispose?.() }, { name: 'audio-session', run: () => session?.dispose?.() }
    ]);
  };
  return { engine, processBatch, stop, dispose,
    effectSourceVoices: () => engine.activeVoiceView({ limit: 4096 }).filter(voice => session?.isSourceVoiceAvailable?.({ voiceId: voice.voiceId, generation: voice.generation })).slice(0, 64),
    isEffectSourceVoiceAvailable: member => session?.isSourceVoiceAvailable?.(member) || false, synchronizeLaneMix, travelEffectSources, prepareTravelEffect, prepareMorphEffect, clearTravelEffect: () => travelEffects.clear('performer-disarmed'), laneMixView: laneId => laneMix.view(laneId, { nowMs: now(), connected: permitted() && !!session?.getState().enabled }),
    bindPreparedSurface, preparedSurfaceDefinitions: () => getGraph().preparedSurfaces || [], preparedSurfaceBodies: () => { surfaceBodies?.prune(); return surfaceBodies?.state() || null; }, prepareEffectGraph, updateEffectGraph, setEffectBypass, inspectEffectGraph: options => session?.inspectEffectGraph?.(options) || null, ready: () => preparedPromise,
    instrumentTransitionCapabilities: () => Object.freeze({ defaultPolicy: 'new-notes-only', policies: Object.freeze(['new-notes-only']), unsupported: Object.freeze({ 'crossfade-held': 'No realized cross-renderer held-state transfer adapter is installed.' }) }),
    prepareLaneInstrument: (laneId, reference, options) => laneInstruments ? laneInstruments.prepare(laneId, reference, options) : Promise.reject(new Error('Lane instrument routing is unavailable.')),
    synchronizeLaneInstruments: lanes => laneInstruments?.synchronize(lanes) || Promise.resolve([]),
    retryLaneInstruments: () => laneInstruments?.retry(getLanes()) || Promise.resolve([]),
    diagnostics: () => Object.freeze({ prepared, routingUnavailable, enabled: !!session?.getState().enabled, accepted, rejected,
      preparedSurfaces: surfaceBodies?.state() || null, bodySources: bodyBackend?.diagnostics() || null, motionEffects: travelEffects.state(), clock: clock.diagnostics(), causal: engine.diagnostics(), dispatch: dispatcher.diagnostics(), leaseFailures, display: Object.freeze({ connected: !!releaseDisplay, errors: displayErrors, retirementBlocked: displayBlocked }),
      instruments: laneInstruments?.diagnostics() || null, renderers: routed?.backend.renderDiagnostics() || null }) };
}
