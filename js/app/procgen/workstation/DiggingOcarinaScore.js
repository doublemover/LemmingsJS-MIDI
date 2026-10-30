import { hashData } from '../../../core/CanonicalData.js';
import { validateSceneTerrainLayout } from '../SceneTerrainLayout.js';
import { validateReleaseGesture } from '../ReleaseGesture.js';
import { normalizeWorkerLimits } from '../ProcgenWorkerLimits.js';
import { normalizePopulationPolicy } from '../ProcgenPopulationPolicy.js';
import { createCavitySoundMap, CAVITY_SOUND_RECIPES, CAVITY_SOUND_REVISION } from './physical/CavitySoundMap.js';
import { validateTopologyRegion } from './physical/TopologyInstrumentRegion.js';
import { SCENE_CAVITY_REQUIREMENT } from './SceneCavityBody.js';
import { createEmbeddedScenePatch } from './EmbeddedScenePatch.js';
import { validatePerformanceSceneRecipe } from './PerformanceSceneRecipe.js';
import { validatePerformanceScene } from './PerformanceScene.js';

export function diggingOcarinaTerrainLayout() {
  return validateSceneTerrainLayout({ schema: 'lemmings-scene-terrain/v1', id: 'terrain.digging-ocarina', revision: 1, width: 512, laneHeight: 96, lanes: [{ laneId: 0, regions: [
    { kind: 'solid', x1: 8, x2: 512, y1: 80, y2: 96, color: 0xff987d68 }, { kind: 'solid', x1: 87, x2: 106, y1: 71, y2: 81, color: 0xffbb997c },
    ...[88, 97].map(x1 => ({ kind: 'air', x1, x2: x1 + 8, y1: 72, y2: 80, color: 0 }))
  ] }] });
}
export async function createDiggingOcarinaScores({ sourceHash, descriptor, signal } = {}) {
  if (descriptor?.engineId !== 'worklet-sine' || descriptor.maximumVoices < 4) throw new TypeError('Digging Ocarina needs the pinned bounded sine exciter.');
  const reference = await createEmbeddedScenePatch({ sourceHash, descriptor, definition: { schemaVersion: 2, id: 'scene.digging-ocarina.exciter', revision: 1, name: 'Chamber contact exciter', author: 'LemmingsJS-MIDI', tags: ['original', 'scene', 'physical-contact'], engineId: 'worklet-sine', engineVersion: 1,
    parameters: { attackSeconds: 0.001, decaySeconds: 0.025, sustain01: 0.15, releaseSeconds: 0.04, gain01: 0.2, pan01: 0 }, modulations: [], sampleRefs: [], macros: [], causalBindings: [], voicePolicy: { maxVoices: 4, steal: 'reject' }, mix: { gain01: 0.2, pan01: 0 } } });
  const dependencies = await Promise.all(['TerrainWorkCommitted', 'ContactResolved', 'ContactSpanBegan'].map(async id => ({ kind: 'physical-observation', id, revision: 1, hash: await hashData({ buildId: sourceHash, observation: id, physicalBatch: 1 }), description: 'Committed real work/contact excitation with selected source/topology revision' })));
  dependencies.push({ kind: 'renderer', id: SCENE_CAVITY_REQUIREMENT, revision: 1, hash: await hashData({ buildId: sourceHash, revision: CAVITY_SOUND_REVISION }), description: 'Existing owned modal network, explicit geometry proxies and prepared replacement with retained tails' });
  const out = [], titles = ['Clay chamber', 'Throat duet', 'Crumbled chimes'];
  for (const [index, bodyRecipe] of CAVITY_SOUND_RECIPES.entries()) {
    signal?.throwIfAborted(); const mapId = 'original.ocarina.' + bodyRecipe, map = createCavitySoundMap({ id: mapId, topologyRegionRef: { id: 'ocarina-chambers', revision: 1 }, bodyRecipe, anchorIds: bodyRecipe === 'throat-duet' ? ['left', 'right'] : ['left'], ...(bodyRecipe === 'throat-duet' ? { throat: { x: 96, y1: 72, y2: 80, referenceWidthPixels: 8 } } : {}) });
    const region = validateTopologyRegion({ id: 'ocarina-chambers', revision: 1, bounds: { x1: 78, x2: 107, y1: 62, y2: 82 }, anchors: [{ id: 'left', x: 92, y: 76 }, { id: 'right', x: 101, y: 76 }], mapping: { revision: 1, bodyId: map.id, basePitchCents: 5700, referenceAreaPixels2: 64, areaCentsPerOctave: bodyRecipe === 'throat-duet' ? 0 : -600 } });
    const recipe = validatePerformanceSceneRecipe({ schema: 'lemmings-physical-score-recipe/v1', id: 'score.digging-ocarina.' + bodyRecipe, revision: 1, sourceHash, seedPolicy: 'scene-seed', assistPolicy: 'manual-only', initialTerrainLayout: diggingOcarinaTerrainLayout(), initialCavityBody: { schema: 'lemmings-scene-cavity-route/v1', map },
      initialReleaseGesture: validateReleaseGesture({ version: 1, id: 'ocarina-entry', revision: 1, nominalGapTicks: 64, spreadTicks: 0, grouping: 'free', clockMode: 'locked', finiteBurstCount: 1, liveChangeBoundary: 'next-cohort', paused: false, seed: 27183 }, 1),
      settings: { laneCount: 1, laneHeight: 96, pack: 1, speed: 3, hazardSpacing: 1024, decoration: 'none', workerLimits: normalizeWorkerLimits(), populationPolicy: normalizePopulationPolicy({ scoutsEvery: 0, spawnSpreadTicks: 0 }) }, terrainFamilies: ['crystal'] });
    const recipeHash = await hashData(recipe), laneId = 'ocarina-contact-lane';
    const scene = validatePerformanceScene({ schema: 'lemmings-performance-scene/v1', id: 'digging-ocarina.' + bodyRecipe, version: 1, title: 'Digging Ocarina · ' + titles[index], description: 'Two finite chambers and a one-pixel connecting wall. The left-selected chamber receives actual worker/contact excitation; geometry changes alone never strike it. Clay area64/256 targets220/110Hz by an authored square-pixel proxy. Throat duet excites the left anchor and couples the right body only through its measured connecting cross-section. Prepare audio while paused; unavailable geometry/body preparation omits current strikes without catch-up. This metaphor does not claim a wind instrument or measured cavity acoustics.', sourceVersion: { id: 'procgen-workstation-source', revision: 2, hash: sourceHash }, worldRecipeRef: { id: recipe.id, revision: 1, hash: recipeHash }, seed: 27183,
      physicalControls: [{ id: 'chamber-size', label: 'Left chamber side', scope: 'geometry', unit: 'world-pixels', minimum: 8, maximum: 16, initial: 8, step: 8, target: 'cavity-square:96:80:8:16' }, { id: 'chamber-throat', label: 'Connecting throat', scope: 'geometry', unit: 'count', minimum: 0, maximum: 1, initial: 0, step: 1, target: 'cavity-throat:96:76' }],
      causalMappings: { version: 1, revision: 1, topologyRegions: [region], instruments: ['TerrainWorkCommitted', 'ContactResolved', 'ContactSpanBegan'].map((sourceKind, index) => ({ id: 'ocarina-source-' + index, sourceKind, topologyRegionId: region.id, topologyAnchorId: 'left', sourceLanes: [0], pitchCents: 5700, velocity01: 0.6, route: 'local', role: 'chamber-excitation' })) }, patchRefs: [{ laneId, reference }], mix: [{ laneId, gain: 0.6, pan: 0, mute: false, solo: false }], initialTransport: { playing: false, bpm: 120, gameSpeed: 3, speedMode: 'bpm' }, tutorialRef: null,
      expectedLandmarks: [{ id: 'ocarina-contact', observationKind: 'ContactResolved', sourceObjectId: region.id, consequence: 'An actual contact excites the selected chamber; static masks make no new attack.', help: 'Enable local audio while paused, start the world and inspect a real contact or worker stroke beside the selected cavity.' }, { id: 'ocarina-resize', observationKind: 'TerrainWorkCommitted', sourceObjectId: region.id, consequence: 'An accepted8-to16pixel chamber edit changes the authored target220-to110Hz. Occupied edits can refuse atomically.', help: 'Request a chamber edit before the actor reaches it; the next physical tick reports application. The size edit restores the enclosing wall and closes the throat.' }], requirements: { required: dependencies, optional: [], substitutableWithNamedApproximation: [] }, credits: [{ name: 'LemmingsJS-MIDI', role: 'Original square-pixel chamber composition and explicit modal proxies', source: null }], cost: { lanes: 1, maximumVoices: 4, sharedBodies: bodyRecipe === 'throat-duet' ? 4 : 2, estimateClass: 'authored-upper-bound-not-measured-realtime-capacity' }, mechanisms: ['terrain', 'contact'], density: 'sparse', lessonLevel: 1 });
    out.push({ scene, recipe, recipeHash, dependencies });
  }
  return out;
}
