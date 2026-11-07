import { validateMaterialPalette } from '../../../midi/content/MaterialPalette.js';
import { WORLD_ACOUSTIC_RENDERER_REQUIREMENT } from '../../../midi/content/AcousticMap.js';
import { validateTimbreTuningBinding, physicalTuningForTimbreSet } from '../../../midi/content/TimbreTuningSet.js';
import { cloneData, freezeData, hashData, canonicalDataText } from '../../../core/CanonicalData.js';
import { validateSoundContentReference } from '../../../midi/content/SoundContentReference.js';
import { validateCausalInstrumentGraph } from './CausalMusicEngine.js';

export const PERFORMANCE_SCENE_SCHEMA = 'lemmings-performance-scene/v1';
const admittedScenes = new WeakSet();
export const isAdmittedPerformanceScene = value => !!value && typeof value === 'object' && admittedScenes.has(value);
const limits = { maxBytes: 1048576, maxNodes: 65536, domain: 'Performance scene' };
const fail = message => { throw Object.assign(new Error(message), { name: 'PerformanceSceneError', code: 'invalid-performance-scene' }); };
const text = (value, max = 128) => typeof value === 'string' && value.length > 0 && value.length <= max;
const id = value => text(value) && /^[A-Za-z][A-Za-z0-9._:-]*$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keys = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => allowed.includes(key));
const reference = value => keys(value, ['id', 'revision', 'hash']) && id(value.id) && integer(value.revision, 1, 2147483647) && hash(value.hash);
const requirementKinds = ['world-source', 'asset', 'engine', 'physical-observation', 'harmonic-field', 'quality-profile', 'renderer', 'held-source'];
const requirement = value => keys(value, ['id', 'kind', 'revision', 'hash', 'description']) && id(value.id) && requirementKinds.includes(value.kind) && integer(value.revision, 1, 2147483647) && hash(value.hash) && text(value.description, 512);
export const sceneDependencyKey = value => [value.kind, value.id, value.revision, value.hash].join(':');

export function validatePerformanceScene(raw) {
  if (admittedScenes.has(raw)) return raw;
  const scene = JSON.parse(canonicalDataText(raw, limits).text);
  if (!keys(scene, ['schema', 'id', 'version', 'title', 'description', 'sourceVersion', 'worldRecipeRef', 'seed', 'physicalControls', 'causalMappings', 'patchRefs', 'mix', 'initialTransport', 'tutorialRef', 'expectedLandmarks', 'requirements', 'credits', 'cost', 'mechanisms', 'lessonLevel', 'density', 'parent']) || scene.schema !== PERFORMANCE_SCENE_SCHEMA || !id(scene.id) || !integer(scene.version, 1, 2147483647) || !text(scene.title, 160) || !text(scene.description, 2048) || !reference(scene.sourceVersion) || !reference(scene.worldRecipeRef) || !integer(scene.seed, 0, 0xffffffff)) fail('Scene identity, source or physical score recipe is invalid.');
  if (!Array.isArray(scene.physicalControls) || scene.physicalControls.length > 4) fail('A scene exposes at most four authored controls.');
  const controls = new Set();
  for (const control of scene.physicalControls) {
    if (!keys(control, ['id', 'label', 'scope', 'unit', 'minimum', 'maximum', 'initial', 'step', 'target']) || !id(control.id) || controls.has(control.id) || !text(control.label, 128) || !['geometry', 'physical', 'sound'].includes(control.scope) || !['world-pixels', 'world-pixels-per-second', 'count', 'ratio', 'Hz', 'seconds', 'cents', 'normalized'].includes(control.unit) || !Number.isFinite(control.minimum) || !Number.isFinite(control.maximum) || control.minimum >= control.maximum || !finite(control.initial, control.minimum, control.maximum) || !finite(control.step, Number.MIN_VALUE, control.maximum - control.minimum) || !text(control.target, 256)) fail('Scene control units, ranges or ownership are invalid.');
    controls.add(control.id);
  }
  scene.causalMappings = validateCausalInstrumentGraph(scene.causalMappings);
  if (!Array.isArray(scene.patchRefs) || !scene.patchRefs.length || scene.patchRefs.length > 1024 || !Array.isArray(scene.mix) || scene.mix.length !== scene.patchRefs.length) fail('Scene lanes require pinned patches and a complete mix.');
  const lanes = new Set();
  for (const patch of scene.patchRefs) { if (!keys(patch, ['laneId', 'reference', 'materialPalette', 'timbreTuningSet', 'timbreTuningFieldId']) || !id(patch.laneId) || lanes.has(patch.laneId) || !patch.reference) fail('Invalid or duplicate scene patch lane.'); patch.reference = validateSoundContentReference(patch.reference); lanes.add(patch.laneId); }
  for (const [index, patch] of scene.patchRefs.entries()) {
    if (patch.materialPalette) { patch.materialPalette = validateMaterialPalette(patch.materialPalette); if (patch.timbreTuningSet || canonicalDataText(patch.reference).text !== canonicalDataText(patch.materialPalette.references.find(reference => reference.patchId === 'material.unclassified')).text) fail('A scene material palette requires its exact unclassified default and independent onset bodies.'); }
    if (!patch.timbreTuningSet) { if (patch.timbreTuningFieldId != null) fail('A paired field reference requires the spectrum/tuning artifact.'); continue; }
    patch.timbreTuningSet = validateTimbreTuningBinding(patch.timbreTuningSet, patch.reference);
    const field = scene.causalMappings.harmonicFields?.find(value => value.id === patch.timbreTuningFieldId), tuning = physicalTuningForTimbreSet(patch.timbreTuningSet);
    if (!field || field.heldPolicy !== 'retain-onset' || JSON.stringify(field.laneScope) !== JSON.stringify([index]) || canonicalDataText(field.tuning).text !== canonicalDataText(tuning).text) fail('The paired scene field differs from its exact tuning artifact.');
  }
  const mixed = new Set();
  for (const lane of scene.mix) { if (!keys(lane, ['laneId', 'gain', 'pan', 'mute', 'solo']) || !lanes.has(lane.laneId) || mixed.has(lane.laneId) || !finite(lane.gain, 0, 2) || !finite(lane.pan, -127, 127) || typeof lane.mute !== 'boolean' || typeof lane.solo !== 'boolean') fail('Invalid scene lane mix.'); mixed.add(lane.laneId); }
  if (!keys(scene.initialTransport, ['playing', 'bpm', 'gameSpeed', 'speedMode', 'clockSource', 'linked']) || scene.initialTransport.playing !== false || scene.initialTransport.clockSource !== undefined && scene.initialTransport.clockSource !== 'internal' || scene.initialTransport.linked !== undefined && scene.initialTransport.linked !== true || !finite(scene.initialTransport.bpm, 20, 400) || !finite(scene.initialTransport.gameSpeed, 0.1, 12) || !['bpm', 'game'].includes(scene.initialTransport.speedMode)) fail('Scenes start paused with an explicit transport configuration.');
  scene.initialTransport = { ...scene.initialTransport, clockSource: 'internal', linked: true };
  if (scene.tutorialRef !== null && !reference(scene.tutorialRef) || !Array.isArray(scene.expectedLandmarks) || scene.expectedLandmarks.length > 32) fail('Scene tutorial or physical landmarks are invalid.');
  const landmarks = new Set();
  for (const landmark of scene.expectedLandmarks) { if (!keys(landmark, ['id', 'observationKind', 'sourceObjectId', 'consequence', 'help']) || !id(landmark.id) || landmarks.has(landmark.id) || !id(landmark.observationKind) || !text(landmark.sourceObjectId, 256) || !text(landmark.consequence, 1024) || !text(landmark.help, 1024)) fail('Scene landmarks require exact physical observations and audible consequences.'); landmarks.add(landmark.id); }
  if (!keys(scene.requirements, ['required', 'optional', 'substitutableWithNamedApproximation'])) fail('Scene requirements must distinguish required, optional and named substitutions.');
  const required = scene.requirements.required, optional = scene.requirements.optional, substitutions = scene.requirements.substitutableWithNamedApproximation;
  if (![required, optional, substitutions].every(value => Array.isArray(value) && value.length <= 256)) fail('Scene requirements exceed their bounded inventory.');
  const dependencies = new Set();
  const accept = value => { if (!requirement(value) || dependencies.has(value.kind + ':' + value.id)) fail('Invalid or repeated scene dependency.'); dependencies.add(value.kind + ':' + value.id); };
  for (const value of [...required, ...optional]) accept(value);
  const variants = new Set();
  for (const substitution of substitutions) {
    if (!keys(substitution, ['requirement', 'variantId', 'label', 'approximation', 'changedBehavior']) || !id(substitution.variantId) || variants.has(substitution.variantId) || !text(substitution.label, 160) || !requirement(substitution.approximation) || !text(substitution.changedBehavior, 1024)) fail('Every substitution needs a named variant and explicit changed behavior.');
    accept(substitution.requirement); variants.add(substitution.variantId);
  }
  for (const instrument of scene.causalMappings.instruments) if (!required.some(value => value.kind === 'physical-observation' && value.id === instrument.sourceKind) && !substitutions.some(value => value.requirement.kind === 'physical-observation' && value.requirement.id === instrument.sourceKind)) fail('Every enabled physical observation must have an explicit versioned requirement.');
  if (!!scene.causalMappings.acousticMap !== required.some(value => value.kind === 'renderer' && value.id === WORLD_ACOUSTIC_RENDERER_REQUIREMENT)) fail('An acoustic scene must declare its owned spatial controls and shared return renderer.');
  if (!keys(scene.cost, ['lanes', 'maximumVoices', 'sharedBodies', 'estimateClass']) || scene.cost.lanes !== lanes.size || !integer(scene.cost.maximumVoices, 1, 65536) || !integer(scene.cost.sharedBodies, 0, 64) || scene.cost.estimateClass !== 'authored-upper-bound-not-measured-realtime-capacity') fail('Scene costs need explicit authored bounds.');
  if (!Array.isArray(scene.mechanisms) || !scene.mechanisms.length || scene.mechanisms.length > 8 || new Set(scene.mechanisms).size !== scene.mechanisms.length || scene.mechanisms.some(value => !['crossing', 'work', 'flight', 'encounter', 'travel', 'contact', 'terrain', 'cooperation'].includes(value)) || !['sparse', 'medium', 'dense'].includes(scene.density) || !integer(scene.lessonLevel, 0, 5)) fail('Scene browsing metadata is invalid.');
  if (!Array.isArray(scene.credits) || scene.credits.length > 64 || scene.credits.some(value => !keys(value, ['name', 'role', 'source']) || !text(value.name, 256) || !text(value.role, 256) || value.source !== null && !text(value.source, 2048))) fail('Scene credits are invalid.');
  if (scene.parent !== undefined && (!keys(scene.parent, ['id', 'version', 'hash', 'overridesHash']) || !id(scene.parent.id) || !integer(scene.parent.version, 1, 2147483647) || !hash(scene.parent.hash) || !hash(scene.parent.overridesHash))) fail('Derived scenes require an immutable parent and override identity.');
  const prepared = freezeData(scene); admittedScenes.add(prepared); return prepared;
}
export async function performanceSceneHash(raw) { return hashData(validatePerformanceScene(raw), limits); }
export async function derivePerformanceScene(raw, { id: nextId, version, title, overrides }) {
  const parent = validatePerformanceScene(raw), allowed = ['seed', 'physicalControls', 'causalMappings', 'patchRefs', 'mix', 'initialTransport', 'worldRecipeRef', 'requirements', 'cost', 'expectedLandmarks', 'description'];
  if (!keys(overrides, allowed) || !Object.keys(overrides).length) fail('Derived scene overrides must name their changed score or sound fields.');
  const value = cloneData(overrides, limits);
  return validatePerformanceScene({ ...parent, ...value, id: nextId, version, title, parent: { id: parent.id, version: parent.version, hash: await performanceSceneHash(parent), overridesHash: await hashData(value, limits) } });
}
export function inspectPerformanceScene(raw) {
  const value = admittedScenes.has(raw) ? raw : cloneData(raw, limits);
  if (!id(value?.id) || !text(value.title, 160) || !integer(value.version, 1, 2147483647)) fail('Scene metadata is not inspectable.');
  if (value.schema !== PERFORMANCE_SCENE_SCHEMA) return freezeData({ id: value.id, version: value.version, title: value.title, supported: false, reason: 'unsupported-scene-schema', schema: typeof value.schema === 'string' ? value.schema.slice(0, 128) : null });
  const scene = validatePerformanceScene(value);
  return freezeData({ id: scene.id, version: scene.version, title: scene.title, description: scene.description, supported: true, mechanisms: scene.mechanisms, density: scene.density, lessonLevel: scene.lessonLevel, cost: scene.cost });
}
