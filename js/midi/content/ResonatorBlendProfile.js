import { createResonatorMorphMap, inspectResonatorMorphMap, prepareResonatorMorphMap } from './ResonatorMorph.js';
import { resonatorMorphKernelProfileData } from './PairedModalBodyProfile.js';
import { cloneData, canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';

export const RESONATOR_BLEND_REVISION = 'prepared-independent-two-body-convex-audio-blend-v1';
const admitted = new WeakMap(), hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = message => { throw Object.assign(new Error('Resonator blend: ' + message), { code: 'invalid-resonator-blend' }); };
const endpointMap = (body, id) => createResonatorMorphMap({ a: body, b: body, pairs: body.modes.map(mode => ({ aId: mode.id, bId: mode.id })), siteCorrespondence: Object.fromEntries(Object.entries(body.sites).map(([role, value]) => [role, { a: value, b: value }])), reviewed: true, transitionPolicy: 'paired-synthetic-held', id });
const bodyData = (prepared, mapA, mapB, identityA, identityB, sampleRate) => {
  if (prepared.map.transitionPolicy !== 'prepared-dual-body-blend' || prepared.a.modes.length > 8 || prepared.b.modes.length > 8) fail('Choose an explicitly reviewed blend and at most eight modes per independently admitted endpoint.');
  const endpoints = [prepared.a, prepared.b], maps = [mapA, mapB], identities = [identityA, identityB], bodies = endpoints.map((endpoint, index) => {
    const inspected = inspectResonatorMorphMap(maps[index], endpoint, endpoint), pairs = endpoint.modes.map(mode => ({ aId: mode.id, bId: mode.id }));
    if (inspected.map.transitionPolicy !== 'paired-synthetic-held' || canonicalDataText(inspected.map.pairs).text !== canonicalDataText(pairs).text || inspected.map.unmatchedAIds.length || inspected.map.unmatchedBIds.length || !hash(identities[index])) fail('Each blend side needs its complete fixed self-correspondence and exact prepared identity.');
    return resonatorMorphKernelProfileData(inspected, sampleRate);
  });
  const body = { schema: 'lemmings-prepared-resonator-blend-profile/v1', revision: RESONATOR_BLEND_REVISION, sampleRate, map: prepared.map, a: prepared.a, b: prepared.b, mapHash: prepared.map.hash, endpointAHash: prepared.map.endpointAHash, endpointBHash: prepared.map.endpointBHash, selfMapA: mapA, selfMapB: mapB, bodyA: { ...bodies[0], identity: identityA }, bodyB: { ...bodies[1], identity: identityB },
    slots: bodies.flatMap((profile, index) => profile.slots.map(slot => ({ ...slot, id: (index ? 'body-b:' : 'body-a:') + slot.id }))), transitionPolicy: 'prepared-dual-body-blend', bodyCount: 2, forceScale: 1280, maximumEnergy: 2097152,
    statePolicy: 'two-independent-retained-endpoint-states;both-excited-and-owned-through-the-blend;no-mechanical-projection', unmatchedPolicy: 'no-intermediate-topology;endpoint-modes-remain-separately-owned', amplitudeConvention: 'raised-cosine-convex-unit-sum-audio-readout;common-endpoint-input-reference', costPolicy: 'both-complete-endpoints-and-their-tails;moving-readout-cost-unmeasured', qualification: 'synthetic-blend-only;PCM-cost-device-and-listening-pending' };
  return { body, bodies };
};
export function inspectResonatorBlendKernelProfile(raw) {
  const value = cloneData(raw, { maxBytes: 65536, maxNodes: 8192 }); if (!hash(value?.identity)) fail('Choose the complete prepared blend profile.');
  const prepared = inspectResonatorMorphMap(value.map, value.a, value.b), built = bodyData(prepared, value.selfMapA, value.selfMapB, value.bodyA?.identity, value.bodyB?.identity, value.sampleRate), profile = freezeData({ ...built.body, identity: value.identity });
  if (canonicalDataText(value, { maxBytes: 65536, maxNodes: 8192 }).text !== canonicalDataText(profile, { maxBytes: 65536, maxNodes: 8192 }).text) fail('The supplied blend differs from its exact bounded endpoint realization.'); admitted.set(profile, Object.freeze(built.bodies)); return profile;
}
export function resonatorBlendEndpointData(profile) { const value = admitted.get(profile); if (!value) fail('Admit the complete blend profile in this execution first.'); return value; }
export async function prepareResonatorBlendKernelProfile(map, a, b, sampleRate = 48000) {
  const prepared = await prepareResonatorMorphMap(map, a, b); if (prepared.map.transitionPolicy !== 'prepared-dual-body-blend') fail('Review an explicit prepared blend instead of upgrading another policy.');
  const mapA = await endpointMap(prepared.a, 'blend-endpoint-a'), mapB = await endpointMap(prepared.b, 'blend-endpoint-b'), dataA = resonatorMorphKernelProfileData(await prepareResonatorMorphMap(mapA, prepared.a, prepared.a), sampleRate), dataB = resonatorMorphKernelProfileData(await prepareResonatorMorphMap(mapB, prepared.b, prepared.b), sampleRate), built = bodyData(prepared, mapA, mapB, await hashData(dataA), await hashData(dataB), sampleRate);
  return inspectResonatorBlendKernelProfile({ ...built.body, identity: await hashData(built.body, { maxBytes: 65536, maxNodes: 8192 }) });
}
export async function verifyResonatorBlendKernelProfile(profile) {
  const expected = await prepareResonatorBlendKernelProfile(profile.map, profile.a, profile.b, profile.sampleRate);
  if (canonicalDataText(expected, { maxBytes: 65536, maxNodes: 8192 }).text !== canonicalDataText(profile, { maxBytes: 65536, maxNodes: 8192 }).text) fail('The endpoint/map/profile hash changed before publication.'); return profile;
}

export function prepareResonatorBlendBodyProfile(raw, sampleRate = 48000) {
  const parameters = cloneData(raw, { maxBytes: 65536, maxNodes: 8192 });
  if (!parameters || Object.keys(parameters).some(key => !['profile', 'morph01', 'inputGain01'].includes(key)) || !Number.isFinite(parameters.morph01) || parameters.morph01 < 0 || parameters.morph01 > 1 || !Number.isFinite(parameters.inputGain01) || parameters.inputGain01 < 0 || parameters.inputGain01 > 1) fail('The live blend needs complete profiles and bounded MORPH/input gain.');
  const body = inspectResonatorBlendKernelProfile(parameters.profile); if (body.sampleRate !== sampleRate) fail('Prepare both blend sides at the actual owner rate.');
  return freezeData({ revision: RESONATOR_BLEND_REVISION, parameters, body, sampleRate, stateBytes: (48 + body.slots.length * 7) * 8 + canonicalDataText(parameters, { maxBytes: 65536, maxNodes: 8192 }).bytes.length * 8 + canonicalDataText(body, { maxBytes: 65536, maxNodes: 8192 }).bytes.length * 8,
    bodyCount: 2, maximumTailFrames: Math.ceil(1.5 * Math.max(...body.slots.map(slot => Math.max(slot.t60A, slot.t60B))) * sampleRate), processingLatencyFrames: 0, maximumOutputAmplitude: 8, gainBoundDomain: 'absolute-eight-after-convex-two-body-quarter-readout;not-LTI-gain', qualification: 'prepared-blend;live-route-PCM-cost-and-listening-pending' });
}
export async function createResonatorBlendBodyParameters({ map, a, b, morph01 = 0, inputGain01 = 1 } = {}, sampleRate = 48000) { return prepareResonatorBlendBodyProfile({ profile: await prepareResonatorBlendKernelProfile(map, a, b, sampleRate), morph01, inputGain01 }, sampleRate).parameters; }
export const resonatorBlendBodyIdentity = profile => canonicalDataText({ revision: profile.revision, parameters: profile.parameters, sampleRate: profile.sampleRate }, { maxBytes: 65536, maxNodes: 8192 }).text;
