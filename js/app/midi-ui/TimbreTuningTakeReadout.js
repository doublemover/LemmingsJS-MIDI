import { verifyTimbreTuningSet, physicalTuningForTimbreSet, timbreTuningIdentity, validateTimbreTuningBinding } from '../../midi/content/TimbreTuningSet.js';
import { tuningDegree } from '../procgen/workstation/physical/Tuning.js';
import { hashData } from '../../core/CanonicalData.js';

export async function prepareTimbreTuningReadout(input, { signal, yieldControl = () => Promise.resolve() } = {}) {
  const request = input.timbreTuningReadout;
  if (!request || Object.keys(request).some(key => !['sourceSet', 'targetSet'].includes(key)) || input.descriptor?.engineId !== 'worklet-spectrum' || input.effectGraph || input.capturedEffects) throw new Error('Paired tuning readouts require exact source/target sets and one dry owned spectrum renderer.');
  const source = await verifyTimbreTuningSet(request.sourceSet), target = await verifyTimbreTuningSet(request.targetSet), original = input.revoice?.intents;
  validateTimbreTuningBinding(target, { patchId: input.definition?.id, revision: input.definition?.revision, definition: input.definition });
  if (source.heldPolicy !== 'onset-only' || target.heldPolicy !== 'onset-only' || !Array.isArray(original) || original.length > 32768) throw new Error('Use a bounded captured onset-only pair; no held retune is inferred.');
  const sourceTuning = physicalTuningForTimbreSet(source), targetTuning = physicalTuningForTimbreSet(target), intents = [], nonPitch = []; let onsets = 0;
  for (let index = 0; index < original.length; index++) {
    signal?.throwIfAborted(); const intent = original[index], { pitch, ...unchanged } = intent; nonPitch.push(unchanged);
    if (intent.expression?.pitchOffsetCents) throw new Error('This onset-only paired readout needs captured fixed-pitch gates. A held pitch gesture requires an explicitly admitted transition policy.');
    if (intent.kind === 'begin') {
      if (pitch?.tuningId !== source.tuningRef.id || !Number.isSafeInteger(pitch.degree)) throw new Error('Capture the source paired field first; the readout requires its exact canonical tuning degree.');
      const expected = tuningDegree(sourceTuning, pitch.degree);
      if (Math.abs(expected.cents - pitch.cents) > 1e-7 || pitch.referenceHz !== expected.referenceHz) throw new Error('The captured degree differs from the exact source tuning revision.');
      const next = tuningDegree(targetTuning, pitch.degree); intents.push({ ...intent, pitch: next }); onsets++;
    } else intents.push(intent);
    if (index % 256 === 0) await yieldControl();
  }
  const limits = { maxBytes: 8 * 1048576, maxNodes: 1000000 }, sourceIntentHash = await hashData(original, limits), readoutIntentHash = await hashData(intents, limits), onsetIdentityHash = await hashData(nonPitch, limits);
  signal?.throwIfAborted();
  return { ...input, revoice: { ...input.revoice, intents }, timbreTuningReadoutReceipt: {
    schema: 'lemmings-timbre-tuning-take-readout/v1', sourceSetHash: await hashData(timbreTuningIdentity(source)), targetSetHash: await hashData(timbreTuningIdentity(target)),
    sourceSpectrumHash: source.spectrumRef.hash, targetSpectrumHash: target.spectrumRef.hash, sourceTuningHash: source.tuningRef.hash, targetTuningHash: target.tuningRef.hash,
    sourceIntentHash, readoutIntentHash, onsetIdentityHash, onsets, heldPolicy: 'onset-only', correspondence: 'exact-captured-degree;all-non-pitch-intent-fields-and-order-unchanged',
    originalRecordMutated: false, physicalReplay: false, acousticReceipt: false } };
}
