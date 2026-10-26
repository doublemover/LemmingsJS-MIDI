import { inspectResonatorMorphMap, prepareResonatorMorphMap, isInspectedResonatorMorph } from './ResonatorMorph.js';
import { canonicalDataText, cloneData, freezeData, hashData } from '../../core/CanonicalData.js';

export const RESONATOR_MORPH_KERNEL_REVISION = 'paired-unit-complex-positive-loss-modal-body-v1';
const bodies = new WeakSet(), MAX_MODES = 8, MAX_ENERGY = 1048576, FORCE_SCALE = 1280;
const fail = message => { throw Object.assign(new Error('Paired modal body: ' + message), { code: 'invalid-paired-modal-body' }); };
export function resonatorMorphKernelProfileData(prepared, sampleRate) {
  if (!isInspectedResonatorMorph(prepared) || ![44100, 48000, 96000].includes(sampleRate)) fail('Unsupported output rate.');
  const resolvedMap = prepared.map;
  if (resolvedMap.transitionPolicy === 'prepared-dual-body-blend' || prepared.slots.length > MAX_MODES) fail('This paired renderer admits at most eight named slots; a dual-body blend needs its own overlap owner.');
  const slots = prepared.slots.map(slot => {
    const from = slot.a || slot.b, to = slot.b || slot.a;
    if (Math.max(from.frequencyHz, to.frequencyHz) >= sampleRate * 0.4) fail('An endpoint mode exceeds the output guard band.');
    return { id: slot.id, sourceAId: slot.a?.id ?? null, sourceBId: slot.b?.id ?? null, hasA: !!slot.a, hasB: !!slot.b, frequencyA: from.frequencyHz, frequencyB: to.frequencyHz, logFrequencyA: Math.log(from.frequencyHz), logFrequencyDelta: Math.log(to.frequencyHz) - Math.log(from.frequencyHz), t60A: from.t60Seconds, t60B: to.t60Seconds, logT60A: Math.log(from.t60Seconds), logT60Delta: Math.log(to.t60Seconds) - Math.log(from.t60Seconds), excitationA: slot.a?.excitation ?? 0, excitationB: slot.b?.excitation ?? 0, leftA: slot.a?.pickupLeft ?? 0, leftB: slot.b?.pickupLeft ?? 0, rightA: slot.a?.pickupRight ?? 0, rightB: slot.b?.pickupRight ?? 0 };
  });
  const body = { schema: 'lemmings-paired-modal-body-profile/v1', revision: RESONATOR_MORPH_KERNEL_REVISION, mapHash: resolvedMap.hash, endpointAHash: resolvedMap.endpointAHash, endpointBHash: resolvedMap.endpointBHash, transitionPolicy: resolvedMap.transitionPolicy, sampleRate, slots, forceScale: FORCE_SCALE, readoutScale: 0.05, maximumEnergy: MAX_ENERGY,
    statePolicy: 'retained-unit-complex-synthetic-coordinates;frequency-changes-rotate-without-reseeding-or-mechanical-energy-projection', unmatchedPolicy: 'prepared-private-mode-state;independent-excitation-and-observation-windows;no-semantic-onset', costPolicy: 'at-most-eight-modes;coefficient-cache-at-unchanged-morph;moving-control-cost-unmeasured', qualification: 'runtime-PCM-stability-alias-device-and-listening-pending' };
  freezeData(body); bodies.add(body); return body;
}
export const isResonatorMorphProfileData = value => bodies.has(value);
export function preparePairedModalBodyProfile(raw, sampleRate = 48000) {
  const parameters = cloneData(raw, { maxBytes: 49152, maxNodes: 6000 });
  if (!parameters || Object.keys(parameters).some(key => !['map', 'a', 'b', 'profileIdentity', 'morph01', 'inputGain01'].includes(key)) || !/^[a-f0-9]{64}$/.test(parameters.profileIdentity || '') || !Number.isFinite(parameters.morph01) || parameters.morph01 < 0 || parameters.morph01 > 1 || !Number.isFinite(parameters.inputGain01) || parameters.inputGain01 < 0 || parameters.inputGain01 > 1) fail('Use complete immutable paired-body parameters and bounded MORPH/input gain.');
  const inspected = inspectResonatorMorphMap(parameters.map, parameters.a, parameters.b);
  if (inspected.map.transitionPolicy !== 'paired-synthetic-held') fail('A shared continuously driven graph needs explicit paired-held review; use an onset source for next-onset-only or separately owned endpoints for blend.');
  const body = resonatorMorphKernelProfileData(inspected, sampleRate), storageBytes = canonicalDataText(parameters).bytes.length * 8 + canonicalDataText(body).bytes.length * 8;
  return freezeData({ revision: RESONATOR_MORPH_KERNEL_REVISION, parameters, body, sampleRate, stateBytes: (16 + body.slots.length * 7) * 8 + storageBytes, maximumTailFrames: Math.ceil(1.5 * Math.max(...body.slots.map(slot => Math.max(slot.t60A, slot.t60B))) * sampleRate), processingLatencyFrames: 0, maximumOutputAmplitude: 8,
    gainBoundDomain: 'absolute-eight-after-fixed-quarter-readout;nonlinear-fault-containment-not-LTI-gain', cost: { modeUpdatesPerStereoFrame: body.slots.length, coefficientRebuildsPerChangedFrame: body.slots.length }, qualification: 'implementation-awaiting-live-route-PCM-device-and-listening' });
}
export async function verifyPairedModalBodyProfile(profile) {
  const p = profile.parameters, prepared = await prepareResonatorMorphMap(p.map, p.a, p.b), body = resonatorMorphKernelProfileData(prepared, profile.sampleRate);
  if (await hashData(body) !== p.profileIdentity || canonicalDataText(body).text !== canonicalDataText(profile.body).text) fail('The paired body profile differs from its exact reviewed endpoint/map realization.');
  return profile;
}
export async function createPairedModalBodyParameters({ map, a, b, morph01 = 0, inputGain01 = 1 } = {}, sampleRate = 48000) {
  const prepared = await prepareResonatorMorphMap(map, a, b), body = resonatorMorphKernelProfileData(prepared, sampleRate);
  return preparePairedModalBodyProfile({ map: prepared.map, a: prepared.a, b: prepared.b, profileIdentity: await hashData(body), morph01, inputGain01 }, sampleRate).parameters;
}
export const pairedModalBodyIdentity = profile => canonicalDataText({ revision: profile.revision, parameters: profile.parameters, sampleRate: profile.sampleRate }).text;
