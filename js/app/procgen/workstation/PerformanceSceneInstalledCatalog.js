import { hashData, freezeData } from '../../../core/CanonicalData.js';
import { getNativeInstrumentCatalog } from '../../midi-ui/NativeInstrumentSchema.js';
import { normalizeWorkerLimits } from '../ProcgenWorkerLimits.js';
import { normalizePopulationPolicy } from '../ProcgenPopulationPolicy.js';
import { validatePerformanceScene, performanceSceneHash, sceneDependencyKey } from './PerformanceScene.js';
import { createPerformanceSceneRegistry } from './PerformanceSceneRegistry.js';
import { validatePerformanceSceneRecipe } from './PerformanceSceneRecipe.js';

// Small original crossing scores exercise the real world and gate mapper. More
// elaborate named scenes require their own authored geometry and qualifications.
export async function createInstalledPerformanceSceneCatalog({ getCatalog = getNativeInstrumentCatalog, signal } = {}) {
  signal?.throwIfAborted(); const catalog = await getCatalog(); signal?.throwIfAborted();
  const registry = createPerformanceSceneRegistry(), recipes = new Map(), available = new Map();
  if (catalog.state !== 'bound-application-engines' || !/^[a-f0-9]{64}$/.test(catalog.executionIdentity?.buildId) || !catalog.descriptors.some(value => value.engineId === 'worklet-sine')) return Object.freeze({ registry, available: false, reason: 'Scene scores require an immutable application build with pinned world and audio artifacts.', resolveDependency: async () => ({ status: 'unavailable', reason: 'Executing source is unbound.' }), getRecipe() { throw new Error('Scene source is unbound.'); } });
  const sourceHash = catalog.executionIdentity.buildId, descriptor = catalog.descriptors.find(value => value.engineId === 'worklet-sine');
  const put = (kind, id, revision, hash, storage = 'installed-runtime') => { const value = { kind, id, revision, hash, status: 'available', storage }; available.set(sceneDependencyKey(value), freezeData(value)); };
  put('world-source', 'procgen-workstation-source', 2, sourceHash);
  put('engine', descriptor.engineId, descriptor.engineVersion, descriptor.artifactHash); put('parameter-schema', descriptor.engineId, descriptor.engineVersion, descriptor.parameterSchemaHash);
  const observationHash = await hashData({ buildId: sourceHash, observation: 'MotionCommitted', physicalBatch: 1 }); put('physical-observation', 'MotionCommitted', 1, observationHash);
  const definition = { schemaVersion: 2, id: 'scene.crossing-tone', revision: 1, name: 'Crossing tone', author: 'LemmingsJS-MIDI', tags: ['original', 'scene', 'crossing'], engineId: 'worklet-sine', engineVersion: 1,
    parameters: { attackSeconds: 0.008, decaySeconds: 0.05, sustain01: 0.65, releaseSeconds: 0.06, gain01: 0.4, pan01: 0 }, modulations: [], sampleRefs: [], macros: [], causalBindings: [], voicePolicy: { maxVoices: 8, steal: 'reject' }, mix: { gain01: 0.4, pan01: 0 } };
  const definitionHash = await hashData(definition), packHash = await hashData({ schema: 'lemmings-original-scene-patches/v1', sourceHash, definitionHash });
  put('patch', definition.id, 1, definitionHash, 'embedded');
  const reference = { schema: 'lemmings-sound-reference/v1', packHash, patchId: definition.id, revision: 1, definitionHash, definition, assetHashes: [], engineRequirement: { engineId: descriptor.engineId, engineVersion: descriptor.engineVersion, artifactHash: descriptor.artifactHash, parameterSchemaHash: descriptor.parameterSchemaHash } };
  for (const laneCount of [4, 8]) {
    const recipe = validatePerformanceSceneRecipe({ schema: 'lemmings-physical-score-recipe/v1', id: 'score.crossing-corridors.' + laneCount, revision: 1, sourceHash, seedPolicy: 'scene-seed',
      settings: { laneCount, laneHeight: 96, pack: 1, speed: 3, hazardSpacing: 320, decoration: 'none', workerLimits: normalizeWorkerLimits(), populationPolicy: normalizePopulationPolicy({ scoutsEvery: 0, spawnSpreadTicks: laneCount === 4 ? 12 : 36 }) }, terrainFamilies: Array(laneCount).fill('crystal') });
    const recipeHash = await hashData(recipe), instruments = Array.from({ length: laneCount }, (_, laneId) => ({ id: 'corridor-' + laneId + '-gate', sourceLanes: [laneId], sourceKind: 'MotionCommitted', gateX: 160 + laneId * 16, crossingDirection: 'either', pitchCents: 4800 + [0, 700, 1200, 1900, 400, 1100, 1600, 2300][laneId], velocity01: 0.55, role: 'crossing', route: 'local' }));
    recipes.set(recipeHash, recipe); put('score-recipe', recipe.id, 1, recipeHash, 'embedded');
    const scene = validatePerformanceScene({ schema: 'lemmings-performance-scene/v1', id: 'crossing-corridors.' + laneCount, version: 1, title: 'Crossing Corridors · ' + laneCount + ' lanes', description: 'Real actors cross one spatial gate in each corridor; redirect their routes to change the timing. The world remains the clock.', sourceVersion: { id: 'procgen-workstation-source', revision: 2, hash: sourceHash }, worldRecipeRef: { id: recipe.id, revision: 1, hash: recipeHash }, seed: 24001 + laneCount,
      physicalControls: [], causalMappings: { version: 1, revision: 1, instruments }, patchRefs: Array.from({ length: laneCount }, (_, i) => ({ laneId: 'scene-lane-' + i, reference })),
      mix: Array.from({ length: laneCount }, (_, i) => ({ laneId: 'scene-lane-' + i, gain: 0.5, pan: (i / (laneCount - 1) * 2 - 1) * 64, mute: false, solo: false })), initialTransport: { playing: false, bpm: 120, gameSpeed: 3, speedMode: 'bpm' }, tutorialRef: null,
      expectedLandmarks: instruments.slice(0, 4).map(instrument => ({ id: instrument.id, observationKind: 'MotionCommitted', sourceObjectId: instrument.id, consequence: 'An actual crossing at X=' + instrument.gateX + ' excites the local tone.', help: 'Enable local audio, start the world, then redirect an actor across this gate. Stopping traffic stops new attacks.' })),
      requirements: { required: [{ kind: 'physical-observation', id: 'MotionCommitted', revision: 1, hash: observationHash, description: 'Committed actor crossing facts' }], optional: [], substitutableWithNamedApproximation: [] }, credits: [{ name: 'LemmingsJS-MIDI', role: 'Original crossing score and tone', source: null }],
      cost: { lanes: laneCount, maximumVoices: laneCount * 8, sharedBodies: 0, estimateClass: 'authored-upper-bound-not-measured-realtime-capacity' }, mechanisms: ['crossing'], density: laneCount === 4 ? 'sparse' : 'medium', lessonLevel: 1 });
    await registry.register(scene); signal?.throwIfAborted();
  }
  return Object.freeze({ registry, available: true, reason: null, sourceHash,
    resolveDependency: async dependency => available.get(sceneDependencyKey(dependency)) || { status: 'unavailable', reason: 'The exact dependency is not installed in this scene catalog.' },
    getRecipe(scene) { const recipe = recipes.get(scene.worldRecipeRef.hash); if (!recipe || recipe.id !== scene.worldRecipeRef.id || recipe.revision !== scene.worldRecipeRef.revision) throw new Error('The exact physical score recipe is unavailable.'); return recipe; },
    async origin(scene, variants = []) { return freezeData({ schema: 'lemmings-performance-scene-origin/v1', manifest: scene, sceneHash: await performanceSceneHash(scene), recipe: recipes.get(scene.worldRecipeRef.hash), variants }); } });
}
