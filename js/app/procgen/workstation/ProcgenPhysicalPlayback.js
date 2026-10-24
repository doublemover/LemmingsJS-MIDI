import { createAudioClockBridge } from './AudioClockBridge.js';
import { createCausalMusicEngine } from './CausalMusicEngine.js';
import { createCausalIntentDispatcher, createStrictLiveFramePolicy } from './CausalIntentDispatcher.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { createRoutedInstrumentBackend } from '../../midi-ui/RoutedInstrumentBackend.js';
import { createLaneInstrumentPreparation } from '../../midi-ui/LaneInstrumentPreparation.js';

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
export function createProcgenPhysicalPlayback({ audio, getGraph, scoreTimeline, now, getLanes = () => [], isPlaybackEnabled = () => !!audio?.getState?.().enabled,
  onInstrumentState = () => {}, onReceipt = () => {} } = {}) {
  const permitted = () => { try { return isPlaybackEnabled() === true; } catch { return false; } };
  const session = audio?.createSession?.('procgen-physical') || null;
  const nativeBackend = session?.createInstrumentBackend?.({ gateMode: 'owned' }) || null;
  const routed = nativeBackend?.inspectExecution ? createRoutedInstrumentBackend({ defaultBackend: nativeBackend, getContext: () => audio.getAudioContext(),
    getGeneration: () => nativeBackend.executionIncarnation?.() ?? 0, defaultReleaseSeconds: nativeResolution.patch.parameters.releaseSeconds, defaultOneShotTailSeconds: 0.08,
    resolveLane: laneId => typeof laneId === 'number' ? getLanes()[laneId]?.id || String(laneId) : String(laneId) }) : null;
  const backend = routed?.backend || nativeBackend;
  const laneInstruments = routed ? createLaneInstrumentPreparation({ session, routed, onState: onInstrumentState }) : null;
  const clock = createAudioClockBridge({ getContext: () => audio?.getAudioContext?.(), nowMs: now,
    presentationDelayMs: 24, maxHorizonMs: 5000 });
  let disposed = false, prepared = false, armEnabled = true, enableLease = null, executionEpoch = null, previousGeneration = null, executionSerial = 0;
  let anchoredEpoch = null, anchoredBpm = null, rejected = 0, accepted = 0, leaseFailures = 0;
  let leaseUntil = null, leaseEpoch = null, leaseContext = null;
  let lastAudioEnabled = false, lastAudioContext = null;
  const retirement = createProcgenRetirementScope();
  const arm = () => {
    if (disposed || !armEnabled || !prepared || !session || !permitted() || !audio?.getState?.().enabled || session.getState().enabled || enableLease) return;
    const lease = {}; enableLease = lease;
    try {
      Promise.resolve(session.enable()).catch(() => false).finally(() => { if (enableLease === lease) enableLease = null; });
    } catch { if (enableLease === lease) enableLease = null; }
  };
  const preparedPromise = nativeBackend ? Promise.resolve(nativeBackend.prepare(nativeResolution)).then(receipt => {
    prepared = receipt?.status === 'ready';
    arm();
    return prepared;
  }).catch(() => false) : Promise.resolve(false);
  const unsubscribe = audio?.subscribe?.(state => {
    const context = audio?.getAudioContext?.();
    if (state.enabled) { arm(); if (!lastAudioEnabled || context !== lastAudioContext) laneInstruments?.retry(getLanes()).catch(() => {}); }
    else clock.invalidate(); lastAudioEnabled = !!state.enabled; lastAudioContext = context;
  }) || null;
  const dispatcher = createCausalIntentDispatcher({
    sinks: backend ? [{ id: 'physical-browser-audio', route: 'local', backend }] : [],
    executionEpoch: () => executionEpoch,
    toTargetFrame: scoreTime => permitted() ? clock.toTargetFrame(scoreTime, executionEpoch) : null,
    latePolicy: createStrictLiveFramePolicy({ nowFrame: () => clock.currentFrame() }),
    onReceipt: receipt => { if (receipt.status === 'accepted') accepted++; else rejected++; onReceipt(receipt); }
  });
  const engine = createCausalMusicEngine({ getGraph, scoreTimeline, deliver: (intents, batch) => dispatcher.dispatch(intents, batch) });
  const processBatch = (batch, { bpm, playing = true, position = null } = {}) => {
    if (disposed || !playing) return Object.freeze([]);
    if (!permitted() && session?.getState().enabled) stop();
    armEnabled = true;
    const nextEpoch = `${batch.worldId}:${batch.generation}:${executionSerial}`;
    if (previousGeneration !== null && previousGeneration !== batch.generation) {
      dispatcher.cancelGeneration(previousGeneration, executionEpoch);
      clock.invalidate(); anchoredEpoch = null;
    }
    previousGeneration = batch.generation;
    executionEpoch = nextEpoch;
    arm();
    const score = position || scoreTimeline.map({ simTick: batch.tick });
    if (prepared && permitted() && session?.getState().enabled &&
        (anchoredEpoch !== score.epoch || anchoredBpm !== bpm)) {
      try {
        clock.rebase({ executionEpoch, scoreEpoch: score.epoch, beat: score.beat, hostMs: now(), bpm,
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
    return engine.processBatch(batch);
  };
  const stop = () => {
    armEnabled = false; enableLease = null;
    const generation = previousGeneration, epoch = executionEpoch;
    executionSerial++; previousGeneration = null; executionEpoch = null;
    leaseUntil = null; leaseEpoch = null; leaseContext = null;
    return createProcgenRetirementScope().retire([
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
      { name: 'playback-stop', run: stop }, { name: 'dispatcher', run: () => dispatcher.dispose() },
      { name: 'lane-instrument-preparation', run: () => laneInstruments?.dispose() },
      { name: 'instrument-backend', run: () => backend?.dispose?.() }, { name: 'audio-session', run: () => session?.dispose?.() }
    ]);
  };
  return { engine, processBatch, stop, dispose, ready: () => preparedPromise,
    prepareLaneInstrument: (laneId, reference, options) => laneInstruments ? laneInstruments.prepare(laneId, reference, options) : Promise.reject(new Error('Lane instrument routing is unavailable.')),
    synchronizeLaneInstruments: lanes => laneInstruments?.synchronize(lanes) || Promise.resolve([]),
    retryLaneInstruments: () => laneInstruments?.retry(getLanes()) || Promise.resolve([]),
    diagnostics: () => Object.freeze({ prepared, enabled: !!session?.getState().enabled, accepted, rejected,
      clock: clock.diagnostics(), causal: engine.diagnostics(), dispatch: dispatcher.diagnostics(), leaseFailures,
      instruments: laneInstruments?.diagnostics() || null, renderers: routed?.backend.renderDiagnostics() || null }) };
}
