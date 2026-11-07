import { createSoundSeedRecipe } from './SoundSeedRecipe.js';
import { SEED_LAYER_SCHEMA, SEED_LAYER_REVISION, SEED_LAYER_ROLES, validateSeedLayerProfile } from './SeedLayerProfile.js';
import { canonicalDataText, cloneData, freezeData, hashData, hashDataText } from '../../core/CanonicalData.js';

const fail = message => { throw new TypeError('Layered seed recipe: ' + message); };
const component = (id, values) => ({ id, role: id, parameters: Object.fromEntries(Object.entries(values).map(([key, [value, unit]]) => [key, { value, unit }])) });

export async function createSoundSeedLayerRecipe({ manifest, assetHash, byteLength, transform = 'hammer-cloud', pitch, decomposition, layerMaterials, modalFit = null, traversalBinding = null } = {}) {
  if (!['hammer-cloud', 'bowed-scrap', 'hollow-tool'].includes(transform) || pitch?.mode !== 'pitched' || decomposition?.schema !== 'lemmings-seed-decomposition/v1' || decomposition.parentAssetHash !== assetHash || decomposition.recipe?.parentAssetHash !== assetHash || decomposition.recipeHash !== await hashData(decomposition.recipe) || !Array.isArray(layerMaterials) || layerMaterials.length !== 3) fail('Choose the exact ready linked-stereo decomposition, three immutable children and an explicit grain/body root.');
  if (transform !== 'hollow-tool' && modalFit != null) fail('A fitted replacement must be explicitly named Hollow Tool.');
  const base = await createSoundSeedRecipe({ manifest, assetHash, byteLength, pitch, transform: 'hammer-seed' });
  const rootHz = 440 * 2 ** ((pitch.rootCents - 6900) / 1200);
  if (rootHz < 20 || rootHz > 2000) fail('The declared grain/body root exceeds the owned source register.');
  const sampleRefs = layerMaterials.map((material, index) => {
    const declared = decomposition.components[index], derived = material?.manifest?.derivedTransform;
    if (declared?.kind !== SEED_LAYER_ROLES[index] || declared.assetHash !== material?.assetHash || derived?.component !== declared.kind || derived.recipeHash !== decomposition.recipeHash || derived.parentAssetHash !== assetHash || material.manifest.frames !== manifest.frames || material.manifest.sampleRate !== manifest.sampleRate || !Number.isSafeInteger(material.byteLength) || material.byteLength < 64 || material.byteLength > 5 * 1048576) fail('A component has a different mask revision, parent, role, clock or exact artifact inventory.');
    return { id: 'seed-' + SEED_LAYER_ROLES[index], sha256: material.assetHash, bytes: material.byteLength, required: true };
  });
  let bodyFit = null;
  if (transform === 'hollow-tool') {
    if (modalFit?.parentAssetHash !== sampleRefs[1].sha256 || modalFit.recipe?.parentAssetHash !== sampleRefs[1].sha256 || modalFit.recipeHash !== await hashData(modalFit.recipe) || modalFit.estimate?.schema !== 'lemmings-modal-estimate/v1' || !Array.isArray(modalFit.estimate.modes)) fail('Fit the exact sustained component before preparing the explicitly labeled creative hybrid.');
    bodyFit = { parentAssetHash: sampleRefs[1].sha256, recipeHash: modalFit.recipeHash, algorithmRevision: modalFit.recipe.algorithmRevision, referenceHz: rootHz,
      modes: modalFit.estimate.modes.map(({ frequencyHz, t60Seconds, amplitude }) => ({ frequencyHz, t60Seconds, amplitude })) };
  }
  const seedLayers = validateSeedLayerProfile({ schema: SEED_LAYER_SCHEMA, revision: SEED_LAYER_REVISION, family: transform, parentAssetHash: assetHash, decompositionRevision: decomposition.recipe.algorithmRevision,
    decompositionRecipeHash: decomposition.recipeHash, parentRegionFrames: decomposition.recipe.regionFrames,
    components: layerMaterials.map((material, index) => ({ role: SEED_LAYER_ROLES[index], assetHash: material.assetHash, sourceFrames: material.manifest.frames, sourceRate: material.manifest.sampleRate, channels: 2 })),
    reconstruction: decomposition.reconstruction, motionBinding: transform === 'bowed-scrap' ? traversalBinding : null, bodyFit }, sampleRefs);
  const contract = freezeData({ ...base.contract, transform, algorithmRevision: SEED_LAYER_REVISION, seedLayers, decomposition: decomposition.recipe,
    ...(modalFit ? { modalFit: { recipe: modalFit.recipe, estimate: modalFit.estimate } } : {}),
    childOwnership: 'one-semantic-onset;one-source-slot;three-private-children;coherent-end-and-forced-retirement', fixedBankSet: ['sample-read-v1', 'grain-window-v1'],
    parentBackingLayers: 0, sourceCost: { worstCasePerSourceUnits: 96, fixedReads: 64, cloud: 16, maximumBody: 16, evidence: 'sum-of-owned-primitive-declared-units;not-measured-device-cpu' },
    quality: transform === 'hollow-tool' ? 'creative-modal-replacement-of-sustained-component;not-accurate-reconstruction' : 'granular-revoice;not-transparent-time-warp-or-perceptual-source-isolation' });
  const encoded = canonicalDataText(contract, { maxBytes: 262144, maxNodes: 32768 }), contractHash = await hashDataText(encoded.text), source = structuredClone(cloneData(base.source)), recipe = source.recipes[0];
  const recipeId = 'seed.layers.' + contractHash.slice(0, 24), sampleTemplate = source.files[0], dataTemplate = source.files[1];
  source.pack.id = recipe.id = recipeId; source.pack.name = recipe.name = transform === 'hammer-cloud' ? 'Hammer / Cloud · three owned seed layers' : transform === 'bowed-scrap' ? 'Bowed Scrap · one real contact with observed-motion grains' : 'Hollow Tool · creative fitted sustained-body hybrid';
  recipe.tags = ['sound-seed', transform, 'three-owned-children', 'creative-revoice']; recipe.engine = { id: 'worklet-seed-layers', version: 1 }; recipe.seedLayers = seedLayers; delete recipe.sampleMap;
  recipe.sampleRefs = sampleRefs; recipe.dependencies = [...sampleRefs.map(ref => ref.sha256), contractHash];
  recipe.components = [component('exciter', { pitchRatio: [1, 'ratio'], rootHz: [rootHz, 'Hz'], reverse: [0, 'enum'], transientGain01: [1, 'amplitude-linear'], residualGain01: [1, 'amplitude-linear'], residualT60Seconds: [0.3, 's'] }),
    component('resonator', { sustainedGain01: [1, 'amplitude-linear'], position01: [transform === 'bowed-scrap' ? 0 : 0.5, 'normalized'], densityHz: [16, 'Hz'], grainMilliseconds: [65, 'ms'], spread01: [0.15, 'normalized'], activity01: [transform === 'bowed-scrap' ? 0 : 1, 'normalized'], tone01: [0.65, 'normalized'], freezePosition: [0, 'enum'] }),
    component('envelope', { attackSeconds: [0, 's'], decaySeconds: [0, 's'], sustain01: [1, 'ratio'], releaseSeconds: [bodyFit ? Math.min(4, Math.max(...bodyFit.modes.map(mode => mode.t60Seconds)) * 1.5) : 0.15, 's'] }),
    component('output', { gain01: [0.6, 'amplitude-linear'], pan01: [0, 'normalized'] })];
  recipe.macros = [];
  source.files = layerMaterials.map((material, index) => ({ ...cloneData(sampleTemplate), path: 'seed/' + SEED_LAYER_ROLES[index] + '.wav', sha256: material.assetHash, bytes: material.byteLength,
    rights: { ...cloneData(sampleTemplate.rights), modifications: [SEED_LAYER_REVISION + '; ' + SEED_LAYER_ROLES[index]] } }));
  source.files.push({ ...dataTemplate, path: 'seed/layer-recipe.json', sha256: contractHash, bytes: encoded.bytes.length });
  return freezeData({ source, contract, contractHash, contractText: encoded.text });
}
