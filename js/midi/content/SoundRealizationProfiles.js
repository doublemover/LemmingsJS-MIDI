import { sampleMapRenderIdentity } from './SampleInstrumentMap.js';
import { canonicalDataText, cloneData, freezeData, hashData } from '../../core/CanonicalData.js';

export const SOUND_REALIZATION_SCHEMA = 'lemmings-authored-sound-realizations/v1';
const bounds = { maxBytes: 524288, maxNodes: 32768 };
const id = value => typeof value === 'string' && /^[a-z][a-z0-9._:-]{0,127}$/i.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const keys = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => allowed.includes(key));
const fail = message => { throw new TypeError('Sound realizations: ' + message); };
const list = (value, maximum, predicate) => Array.isArray(value) && value.length <= maximum && value.every(predicate) && new Set(value).size === value.length;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function soundRealizationSemanticInterface(patch) {
  if (!patch || !Array.isArray(patch.macros) || !Array.isArray(patch.causalBindings) || !patch.voicePolicy) fail('Every profile needs its actual validated patch.');
  return freezeData({ gateOwnership: 'existing-instrument-owned-end', stealingPolicy: patch.voicePolicy.steal,
    macroInputs: patch.macros.map(macro => ({ id: macro.id, mode: macro.mode, bipolar: macro.bipolar ?? false, momentary: macro.momentary ?? false, targetUnits: [...new Set(macro.targets.map(target => target.unit))].sort() })).sort((a, b) => order(a.id, b.id)),
    causalBindings: patch.causalBindings, pitchExpression: { maximumBendCents: patch.parameters.maxBendCents ?? null, variation: patch.variation ?? null },
    sampleArticulations: patch.sampleMap?.articulations.map(entry => entry.id).sort() ?? [],
    sourcePolicies: patch.sampleMap ? [...new Set(patch.sampleMap.zones.map(zone => canonicalDataText({ articulationId: zone.articulationId, pitchTracking: zone.pitchTracking ?? 'varispeed', playbackMode: zone.playbackMode ?? 'forward',
      pitchRange: zone.pitchRange, positionPolicy: zone.positionPolicy ?? null, rootCents: zone.rootCents, tuningCents: zone.tuningCents, onsetFrame: zone.onsetFrame, endFrame: zone.endFrame, loop: zone.loop, releaseRegion: zone.releaseRegion }).text))].sort() : [],
    ...(patch.engineId === 'worklet-wind' ? { sealedWindGesture: { pressureFloor: 0, acousticSize: 'onset-Hz/lengthRatio;not-route-length', maximumRegisterChangesPerGesture: patch.parameters.windKind === 2 ? 1 : 0, livePitchUpdates: false, feedback: 'private-owned-nonlinear-modal-port' } } : {}),
    ...(patch.engineId === 'worklet-friction' ? { sealedFrictionTravel: { scope: patch.parameters.frictionScope, axis: patch.parameters.frictionAxis, requiredSegments: patch.parameters.frictionRequireSegments, pitchPolicy: 'onset-tuned-independent-body;no-live-bend', feedbackPolicy: 'private-relative-velocity-friction-port;no-external-loop' } } : {}),
    ...(patch.engineId === 'worklet-texture' ? { proceduralTravel: { scope: patch.parameters.textureScope, axis: patch.parameters.textureAxis, requiredSegments: patch.parameters.textureRequireSegments, pitchPolicy: patch.parameters.graftModeCount ? 'unpitched-spatial-exciter;note-tunes-body-at-onset;no-live-bend' : 'unpitched-source;note-selects-owner-only' } } : {}),
    sourceTiming: 'physical-semantic-source-unchanged;profile-prepares-only-sound', proofScope: 'structural-input-and-articulation-compatibility;not-perceptual-equivalence' });
}

// Imported content describes alternatives. Only the runtime admission/qualification
// owners can make a measured alternative effective; content cannot certify itself.
export async function compileSoundRealizationGroups(raw = [], inventory = []) {
  if (!Array.isArray(raw) || raw.length > 32 || !Array.isArray(inventory) || inventory.length > 256) fail('Profile groups exceed their bounded inventory.');
  const authored = cloneData(raw, bounds), patches = new Map(inventory.map(entry => [entry.definition.id, entry]));
  if (authored.length && patches.size !== inventory.length) fail('Grouped alternatives require unique recipe identities; merged versions need an explicit separately authored group.');
  const usedGroups = new Set(), usedRecipes = new Set(), groups = [];
  for (const group of authored) {
    if (!keys(group, ['schema', 'id', 'defaultProfileId', 'requiredInvariants', 'profiles', 'transitions', 'singleProfileLimit']) || group.schema !== SOUND_REALIZATION_SCHEMA || !id(group.id) || usedGroups.has(group.id) || !id(group.defaultProfileId) ||
        !list(group.requiredInvariants, 16, id) || !group.requiredInvariants.length || !Array.isArray(group.profiles) || !group.profiles.length || group.profiles.length > 8 || !Array.isArray(group.transitions) || group.transitions.length > 32 ||
        (group.profiles.length === 1 ? !text(group.singleProfileLimit) : group.singleProfileLimit !== null)) fail('Declare unique groups, musical invariants and an honest single-profile limit.');
    usedGroups.add(group.id); const profiles = [], profileIds = new Set(); let interfaceText = null, semanticInterface = null;
    for (const profile of group.profiles) {
      if (!keys(profile, ['id', 'recipeId', 'algorithmRevision', 'preservedInvariants', 'changedAudibleProperties', 'fallbackProfileId']) || !id(profile.id) || profileIds.has(profile.id) || !id(profile.recipeId) || usedRecipes.has(profile.recipeId) || !id(profile.algorithmRevision) ||
          !list(profile.preservedInvariants, 16, id) || group.requiredInvariants.some(invariant => !profile.preservedInvariants.includes(invariant)) || !list(profile.changedAudibleProperties, 16, text) ||
          !(profile.fallbackProfileId === null || id(profile.fallbackProfileId))) fail('Each profile needs a unique concrete recipe, complete invariant claims, explicit audible differences and named fallback.');
      const entry = patches.get(profile.recipeId);
      if (!entry?.artifact || entry.artifact.id !== entry.definition.id || !entry.engineRequirement) fail('An alternative is missing its actual compiled patch and renderer receipt.');
      const contract = soundRealizationSemanticInterface(entry.definition), currentText = canonicalDataText(contract, bounds).text;
      if (interfaceText !== null && currentText !== interfaceText) fail('Alternatives change the required semantic input, macro or sample articulation interface.');
      interfaceText = currentText; semanticInterface = contract; profileIds.add(profile.id); usedRecipes.add(profile.recipeId);
      const structuralDimensions = Object.fromEntries(Object.entries(entry.definition.parameters).filter(([key]) => /(?:Count$|densityHz$|grainMilliseconds$|graftExcitationMode$|sourceMode$|circularMode$|sampleInterpolation$)/.test(key)).sort(([a], [b]) => order(a, b)));
      if (entry.definition.engineId === 'native-fm') structuralDimensions.operatorSources = entry.definition.parameters.dualPair ? 4 : 2;
      const definition = entry.definition, effectiveInputsHash = await hashData({ engineRequirement: entry.engineRequirement, parameters: definition.parameters, modulations: definition.modulations, causalBindings: definition.causalBindings, sampleRefs: definition.sampleRefs, sampleMap: sampleMapRenderIdentity(definition.sampleMap), dependencies: [...(entry.dependencies || [])].sort(), macros: definition.macros.map(({ name, perceptualDirection, ...macro }) => macro), variation: definition.variation ?? null, voicePolicy: definition.voicePolicy, mix: definition.mix }, { maxBytes: 2 * 1048576, maxNodes: 131072 });
      profiles.push({ id: profile.id, effectiveInputsHash, patchIdentity: entry.definition.id + '@' + entry.definition.revision, definitionHash: await hashData(entry.definition, { maxBytes: 262144, maxNodes: 32768 }), renderKey: entry.artifact.renderKey,
        engineRequirement: entry.engineRequirement, algorithmRevision: profile.algorithmRevision, structuralDimensions, declaredCost: entry.artifact.cost,
        preservedInvariants: profile.preservedInvariants, changedAudibleProperties: profile.changedAudibleProperties, fallbackProfileId: profile.fallbackProfileId,
        qualification: { state: 'authored-unqualified', measuredDeviceCost: false, listening: false, numericalEquivalence: false, automaticAdmission: false } });
    }
    if (!profileIds.has(group.defaultProfileId)) fail('The default must name one actual compiled alternative.');
    const baseline = profiles.find(profile => profile.id === group.defaultProfileId);
    if (profiles.some(profile => profile.renderKey !== baseline.renderKey && profile.changedAudibleProperties.length === 0)) fail('A different effective sound requires explicit changed audible properties; a smaller dimension alone does not establish equivalence.');
    const transitions = new Set();
    for (const transition of group.transitions) {
      if (!keys(transition, ['from', 'to', 'boundary', 'overlapPolicy']) || !profileIds.has(transition.from) || !profileIds.has(transition.to) || transition.from === transition.to ||
          !['next-onset-only', 'stopped-replacement'].includes(transition.boundary) || !['old-tail-plus-new-charged-separately', 'stop-and-retire-before-prepare'].includes(transition.overlapPolicy) ||
          transition.boundary === 'next-onset-only' && transition.overlapPolicy !== 'old-tail-plus-new-charged-separately' || transitions.has(transition.from + ':' + transition.to)) fail('Transitions need unique existing endpoints, a supported boundary and explicit overlap ownership.');
      transitions.add(transition.from + ':' + transition.to);
    }
    const byId = new Map(profiles.map(profile => [profile.id, profile]));
    for (const profile of profiles) {
      const seen = new Set([profile.id]); let next = profile.fallbackProfileId;
      while (next !== null) {
        if (!byId.has(next) || seen.has(next)) fail('Fallback chains must terminate without missing profiles or cycles.'); seen.add(next); next = byId.get(next).fallbackProfileId;
      }
      if (profile.fallbackProfileId !== null && !transitions.has(profile.id + ':' + profile.fallbackProfileId)) fail('A named fallback needs an explicitly owned transition.');
    }
    groups.push({ schema: SOUND_REALIZATION_SCHEMA, id: group.id, authored: group, defaultProfileId: group.defaultProfileId, semanticInterface, semanticInterfaceHash: await hashData(semanticInterface, bounds),
      profiles: profiles.sort((a, b) => order(a.id, b.id)), transitions: [...group.transitions].sort((a, b) => order(a.from + ':' + a.to, b.from + ':' + b.to)), singleProfileLimit: group.singleProfileLimit,
      selection: { requestedProfileId: group.defaultProfileId, preparedProfileId: null, effectiveAdmittedProfileId: null, policy: 'explicit-ordinary-patch-preparation;no-content-authorized-automatic-downgrade' } });
  }
  return freezeData(groups.sort((a, b) => order(a.id, b.id)));
}

export function planAuthoredSoundRealization(group, requestedProfileId) {
  const selected = group?.profiles?.find(profile => profile.id === requestedProfileId);
  if (group?.schema !== SOUND_REALIZATION_SCHEMA || !selected || selected.qualification?.automaticAdmission !== false) fail('Choose an actual authored profile and prepare it through the ordinary patch owner.');
  return freezeData({ requestedProfileId, preparedProfileId: null, effectiveAdmittedProfileId: null, status: 'requires-explicit-patch-preparation',
    patchIdentity: selected.patchIdentity, definitionHash: selected.definitionHash, renderKey: selected.renderKey, effectiveInputsHash: selected.effectiveInputsHash, engineRequirement: selected.engineRequirement,
    changedAudibleProperties: selected.changedAudibleProperties, preservedInvariants: selected.preservedInvariants, qualification: selected.qualification,
    transition: 'use-declared-group-boundary;admit-source-and-old-tail-overlap-before-commit', modifiesPhysicalScore: false });
}
