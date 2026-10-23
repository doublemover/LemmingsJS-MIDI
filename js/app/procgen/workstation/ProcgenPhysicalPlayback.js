import { createAudioClockBridge } from './AudioClockBridge.js';
import { createCausalMusicEngine } from './CausalMusicEngine.js';
import { createCausalIntentDispatcher, createStrictLiveFramePolicy } from './CausalIntentDispatcher.js';

const nativeResolution = Object.freeze({
  status: 'ready',
  patch: Object.freeze({ id: 'procgen-physical-default', revision: 1, engineId: 'native-oscillator', engineVersion: 1,
    parameters: Object.freeze({ waveform: 1, gain01: 0.8, attackSeconds: 0.004, decaySeconds: 0.06,
      sustain01: 0.55, releaseSeconds: 0.08 }), sampleRefs: Object.freeze([]),
    voicePolicy: Object.freeze({ maxVoices: 64 }), mix: Object.freeze({ gain01: 0.6, pan01: 0 }) }),
  receipt: Object.freeze({ patchId: 'procgen-physical-default', revision: 1 })
});

// Owns only the physical voice session. The ordinary game preview and MIDI
// router keep their independent leases on the shared output graph.
export function createProcgenPhysicalPlayback({ audio, getGraph, scoreTimeline, now, onReceipt = () => {} } = {}) {
  const session = audio?.createSession?.('procgen-physical') || null;
  const backend = session?.createInstrumentBackend?.({ gateMode: 'bounded' }) || null;
  const clock = createAudioClockBridge({ getContext: () => audio?.getAudioContext?.(), nowMs: now,
    presentationDelayMs: 24, maxHorizonMs: 5000 });
  let disposed = false, prepared = false, armEnabled = true, enableLease = null, executionEpoch = null, previousGeneration = null, executionSerial = 0;
  let anchoredEpoch = null, anchoredBpm = null, rejected = 0, accepted = 0;
  const arm = () => {
    if (disposed || !armEnabled || !prepared || !session || !audio?.getState?.().enabled || session.getState().enabled || enableLease) return;
    const lease = {}; enableLease = lease;
    try {
      Promise.resolve(session.enable()).catch(() => false).finally(() => { if (enableLease === lease) enableLease = null; });
    } catch { if (enableLease === lease) enableLease = null; }
  };
  const preparedPromise = backend ? Promise.resolve(backend.prepare(nativeResolution)).then(receipt => {
    prepared = receipt?.status === 'ready';
    arm();
    return prepared;
  }).catch(() => false) : Promise.resolve(false);
  const unsubscribe = audio?.subscribe?.(state => { if (state.enabled) arm(); else clock.invalidate(); }) || null;
  const dispatcher = createCausalIntentDispatcher({
    sinks: backend ? [{ id: 'physical-browser-audio', route: 'local', backend }] : [],
    executionEpoch: () => executionEpoch,
    toTargetFrame: scoreTime => clock.toTargetFrame(scoreTime, executionEpoch),
    latePolicy: createStrictLiveFramePolicy({ nowFrame: () => clock.currentFrame() }),
    onReceipt: receipt => { if (receipt.status === 'accepted') accepted++; else rejected++; onReceipt(receipt); }
  });
  const engine = createCausalMusicEngine({ getGraph, scoreTimeline, deliver: (intents, batch) => dispatcher.dispatch(intents, batch) });
  const processBatch = (batch, { bpm, playing = true, position = null } = {}) => {
    if (disposed || !playing) return Object.freeze([]);
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
    if (prepared && session?.getState().enabled &&
        (anchoredEpoch !== score.epoch || anchoredBpm !== bpm)) {
      try {
        clock.rebase({ executionEpoch, scoreEpoch: score.epoch, beat: score.beat, hostMs: now(), bpm,
          reason: anchoredEpoch === null ? 'start' : 'source-change' });
        anchoredEpoch = score.epoch; anchoredBpm = bpm;
      } catch { clock.invalidate(); anchoredEpoch = null; }
    }
    return engine.processBatch(batch);
  };
  const stop = () => {
    armEnabled = false; enableLease = null;
    if (previousGeneration !== null) dispatcher.cancelGeneration(previousGeneration, executionEpoch);
    executionSerial++; previousGeneration = null; executionEpoch = null;
    session?.stop?.(); clock.invalidate(); anchoredEpoch = null; anchoredBpm = null;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; unsubscribe?.(); stop(); dispatcher.dispose(); backend?.dispose?.();
    return session?.dispose?.();
  };
  return { engine, processBatch, stop, dispose, ready: () => preparedPromise,
    diagnostics: () => Object.freeze({ prepared, enabled: !!session?.getState().enabled, accepted, rejected,
      clock: clock.diagnostics(), causal: engine.diagnostics(), dispatch: dispatcher.diagnostics() }) };
}
