import { createSmoothedAudioParameter } from './SmoothedAudioParameter.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';

export const validVoiceLaneMix = value => value == null || value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).every(key => ['gain', 'pan', 'revision', 'muted', 'soloSuppressed'].includes(key)) && Number.isFinite(value.gain) && value.gain >= 0 && value.gain <= 2 &&
  Number.isFinite(value.pan) && value.pan >= -1 && value.pan <= 1 && (value.revision == null || Number.isSafeInteger(value.revision) && value.revision >= 0);
export function createVoiceLaneMix({ preview, context, owner, generation, destination, start, laneId = null, voiceId = null, value = { gain: 1, pan: 0 } }) {
  value ||= { gain: 1, pan: 0 };
  if (!validVoiceLaneMix(value)) throw new Error('Invalid lane mix.');
  const lease = preview._audioResources?.reserve({ kind: 'voice-lane-mix', owner, generation, estimateBytes: laneId && preview._laneSourcesFor ? 24576 : 16384, consumerOwned: true });
  let source = null, unregister = null, gain = null, pan = null, disposed = false, disposal, disposalError; const retirement = createProcgenRetirementScope();
  const dispose = () => { if (disposed) { if (disposalError) throw disposalError; return disposal; } disposed = true;
    try { return disposal = releaseAudioResourceAfterRetirement(lease, retirement.retire([
      { name: 'lane-source-registration', run: () => unregister?.() }, { name: 'lane-source', run: () => source?.disconnect() },
      { name: 'lane-gain', run: () => gain?.disconnect() }, { name: 'lane-pan', run: () => pan?.disconnect() }
    ])); } catch (error) { disposalError = error; throw error; } };
  try {
    gain = context.createGain(); pan = context.createStereoPanner?.() || null;
    if (!pan && value.pan !== 0) throw new Error('Independent lane pan is unavailable.');
    gain.connect(pan || destination); pan?.connect(destination);
    if (laneId && preview._laneSourcesFor) {
      source = context.createGain(); source.connect(gain);
      unregister = preview._laneSourcesFor(owner, context).registerVoice({ laneId, voiceId, sourceGeneration: generation, pre: source, post: pan || gain, start });
    }
    const gainCurve = createSmoothedAudioParameter({ param: gain.gain, initialValue: value.gain, startTime: start });
    const panCurve = pan ? createSmoothedAudioParameter({ param: pan.pan, initialValue: value.pan, startTime: start }) : null;
    return { input: source || gain, dispose, update(next, frame, nextLaneId = laneId) {
      const now = context.currentTime, time = Math.max(start, frame / context.sampleRate, now);
      if (disposed || !next || !validVoiceLaneMix(next) || !Number.isSafeInteger(frame) || frame < 0 || !panCurve && next.pan !== 0 || !gainCurve.canInsert(now) || panCurve && !panCurve.canInsert(now)) return { status: 'rejected', reason: 'lane-mix-admission' };
      try {
        if (nextLaneId !== laneId && (typeof unregister?.scheduleLane !== 'function' || !unregister.scheduleLane(nextLaneId, frame))) return { status: 'rejected', reason: 'lane-source-transfer-admission' };
        if (!gainCurve.insert(next.gain, time, now) || panCurve && !panCurve.insert(next.pan, time, now)) throw new Error('Lane mix curve refused admission.');
        laneId = nextLaneId;
      }
      catch { return { status: 'rejected', reason: 'lane-mix-scheduling-failed' }; }
      return { status: 'accepted', stage: 'scheduled', targetFrame: frame, appliedFrame: null };
    } };
  } catch (error) { dispose(); throw error; }
}
