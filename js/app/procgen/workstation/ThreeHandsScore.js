import { hashData, freezeData } from '../../../core/CanonicalData.js';
import { createRectangularMembraneRecipe } from '../../../midi/content/RectangularMembraneRecipe.js';
import { createSympatheticMapRecipe } from '../../../midi/content/SympatheticMapRecipes.js';
import { validateSceneTerrainLayout } from '../SceneTerrainLayout.js';
import { validateReleaseGesture } from '../ReleaseGesture.js';
import { normalizeWorkerLimits } from '../ProcgenWorkerLimits.js';
import { normalizePopulationPolicy } from '../ProcgenPopulationPolicy.js';
import { validatePerformanceSceneRecipe } from './PerformanceSceneRecipe.js';
import { validatePerformanceScene } from './PerformanceScene.js';
import { validateScenePreparedSurface, SCENE_PREPARED_SURFACE_REQUIREMENT } from './ScenePreparedSurface.js';

export async function createThreeHandsScores({ sourceHash, descriptor, signal } = {}) {
  const definition = { schemaVersion: 2, id: 'scene.three-hands-exciter', revision: 1, name: 'Three Hands · short exciter', author: 'LemmingsJS-MIDI', tags: ['original', 'contact', 'exciter'], engineId: 'worklet-sine', engineVersion: 1,
      parameters: { attackSeconds: 0.002, decaySeconds: 0.012, sustain01: 0, releaseSeconds: 0.004, gain01: 0.4, pan01: 0 }, modulations: [], sampleRefs: [], macros: [], causalBindings: [], voicePolicy: { maxVoices: 4, steal: 'reject' }, mix: { gain01: 0.4, pan01: 0 } },
    definitionHash = await hashData(definition), reference = { schema: 'lemmings-sound-reference/v1', packHash: await hashData({ schema: 'lemmings-original-scene-patches/v1', sourceHash, definitionHash }), patchId: definition.id, revision: 1, definitionHash, definition, assetHashes: [],
      engineRequirement: { engineId: descriptor.engineId, engineVersion: descriptor.engineVersion, artifactHash: descriptor.artifactHash, parameterSchemaHash: descriptor.parameterSchemaHash } }, results = [];
  for (const variant of [{ id: 'skin-8', gridSize: 8 }, { id: 'skin-16', gridSize: 16 }, { id: 'felt-bridge', bar: true }]) {
    signal?.throwIfAborted(); const bar = variant.bar === true, surfaceId = 'three-hands-surface';
    const layout = validateSceneTerrainLayout({ schema: 'lemmings-scene-terrain/v1', id: 'terrain.three-hands', revision: 1, width: 512, laneHeight: 96,
      lanes: Array.from({ length: 3 }, (_, laneId) => ({ laneId, regions: [{ kind: 'solid', x1: 8, x2: 512, y1: 80, y2: 96, color: 0xff6c8294 },
        { kind: 'solid', x1: 8, x2: 21, y1: 65, y2: 80, color: 0xff6c8294 }, { kind: 'solid', x1: 490, x2: 512, y1: 65, y2: 80, color: 0xff6c8294 },
        ...(laneId === 0 ? [{ kind: 'solid', x1: 32, x2: 112, y1: 62, y2: 80, color: 0xff8ca6bd }, { kind: 'solid', x1: 208, x2: 256, y1: 68, y2: 80, color: 0xff8ca6bd }] : [])] })) });
    const body = bar ? createSympatheticMapRecipe({ recipe: 'felt-bridge', damp01: 0, couple01: 0, wet01: 0.3 }) : createRectangularMembraneRecipe({ gridSize: variant.gridSize, fundamentalHz: 180, decaySeconds: 1.8, damp01: 0, wet01: 0.5 });
    const initialPreparedSurface = validateScenePreparedSurface({ schema: 'lemmings-scene-prepared-surface/v1', surfaceId, nodeId: bar ? 'bodies' : 'skin', graph: { ...body.graph,
      nodes: body.graph.nodes.map(node => node.id === 'dry' ? { ...node, parameters: { ...node.parameters, gain01: 0 } } : node) } });
    const recipe = validatePerformanceSceneRecipe({ schema: 'lemmings-physical-score-recipe/v1', id: 'score.three-hands.' + variant.id, revision: 1, sourceHash, seedPolicy: 'scene-seed', assistPolicy: 'manual-only', initialTerrainLayout: layout, initialPreparedSurface,
      actorBirthAbilities: Array.from({ length: 3 }, (_, laneId) => ({ laneId, climb: false, parachute: false })),
      initialReleaseGesture: validateReleaseGesture({ version: 1, id: 'three-hands.entry', revision: 1, nominalGapTicks: 54, spreadTicks: 0, lanePhase: [0, 1, 2].map(laneId => ({ laneId, offsetTicks: laneId * 8 })), grouping: 'free', clockMode: 'locked', finiteBurstCount: 3, phaseStepTicks: 0, liveChangeBoundary: 'next-cohort', paused: false, seed: 30303 }, 3),
      settings: { laneCount: 3, laneHeight: 96, pack: 1, speed: 3, hazardSpacing: 1024, decoration: 'none', workerLimits: normalizeWorkerLimits(), populationPolicy: normalizePopulationPolicy({ scoutsEvery: 0, spawnSpreadTicks: 0 }) }, terrainFamilies: ['crystal', 'crystal', 'crystal'] });
    const recipeHash = await hashData(recipe), preparationObservationHash = await hashData({ sourceHash, observations: ['ContactSpanUpdated', 'ContactSpanEnded'], policy: 'completed-support-cell-and-explicit-closure' }), dependencies = [
      { kind: 'physical-observation', id: 'ContactSpanBegan', revision: 1, hash: await hashData({ sourceHash, observation: 'ContactSpanBegan', policy: 'completed-support-cell-only' }), description: 'An actual supported arrival owns one exciter; continued preparation adds no notes' },
      ...['ContactSpanUpdated', 'ContactSpanEnded'].map(observation => ({ kind: 'physical-observation', id: observation, revision: 1, hash: preparationObservationHash, description: 'Current completed support observations own and release preparation controls' })),
      { kind: 'renderer', id: SCENE_PREPARED_SURFACE_REQUIREMENT, revision: 1, hash: await hashData({ sourceHash, mechanism: initialPreparedSurface, policy: 'one-shared-body;contact-owned-preparation;keep-old-tail;no-catch-up' }), description: 'One persistent body with separately owned observed damping and stereo pickup controls' }];
    const scene = validatePerformanceScene({ schema: 'lemmings-performance-scene/v1', id: 'three-hands.' + variant.id, version: 1,
      title: bar ? 'Felt Bridge · Listening Wire' : 'Three Hands, One Skin · ' + variant.gridSize + ' × ' + variant.gridSize,
      description: 'Three finite entrants play one shared ' + (bar ? 'six-mode bar. The held felt uses an authored mode-loss mask, not geometric point damping.' : 'rectangular skin. The first lane strikes it; the middle lane can damp a small normalized area.') + ' Pause and assign Blocker to the supported middle actor. The bottom actor moves the stereo observation along the same 504-pixel map without striking. Redirect the top actor to change real arrivals. Release the damper to let subsequent energy ring longer; already lost energy does not return. The body keeps ringing after its striker leaves. No backing pattern is present.',
      sourceVersion: { id: 'procgen-workstation-source', revision: 2, hash: sourceHash }, worldRecipeRef: { id: recipe.id, revision: 1, hash: recipeHash }, seed: 30303, physicalControls: [],
      causalMappings: { version: 1, revision: 1, preparedSurfaces: [{ schema: 'lemmings-prepared-surface/v1', id: surfaceId, revision: 1,
        surfaceMap: { id: 'three-hands-map', revision: 1, regionInstanceId: 'three-hands-authored-world-surface', sourceEditRevision: 0, boundTopologyRevision: 0, bounds: { x1: 8, x2: 512, y1: 0, y2: 288 } }, heldContactPolicy: 'keep-old-tail', unknownPolicy: 'release',
        preparations: [{ id: 'supported-damper', kind: bar ? 'mode-loss' : 'touch', sourceLanes: [1], actions: ['blocking'], beginPolicy: 'current-observed-contact', amount01: 0.8, ...(bar ? { lossMaskId: 'felt-alternating' } : { radius01: 0.16 }) },
          ...['pickup-left'].map(kind => ({ id: 'listening-' + kind, kind, sourceLanes: [2], actions: ['walk', 'blocking'], beginPolicy: 'current-observed-contact' }))] }],
      instruments: [{ id: 'three-hands-striker', sourceKind: 'ContactSpanBegan', sourceLanes: [0], causeKind: 'support', pitchCents: 6000, velocity01: 0.65, role: 'finite-contact', route: bar ? 'local' : 'prepared-body',
        ...(!bar ? { preparedBodyStrike: { surfaceId, surfaceRevision: 1, pulseMilliseconds: 8, amplitudeScale01: 0.8, pitchPolicy: 'fixed-prepared-body' } } : {}) }] },
      patchRefs: [0, 1, 2].map(index => ({ laneId: 'three-hands-lane-' + index, reference })), mix: [0, 1, 2].map(index => ({ laneId: 'three-hands-lane-' + index, gain: 0.5, pan: 0, mute: false, solo: false })),
      initialTransport: { playing: false, bpm: 120, gameSpeed: 3, speedMode: 'game' }, tutorialRef: null,
      expectedLandmarks: [{ id: 'strike', observationKind: 'ContactSpanBegan', sourceObjectId: 'three-hands-striker', consequence: 'A real top-lane support arrival excites the shared body once.', help: 'Enable local audio before Play. Redirect the striker using ordinary physical tools; no notes are scheduled for it.' },
        { id: 'touch', observationKind: 'ContactSpanUpdated', sourceObjectId: 'supported-damper', consequence: bar ? 'A currently supported blocker owns one loss-only mode mask.' : 'A currently supported blocker owns a localized positive-loss patch.', help: 'Pause, select the middle actor and assign Blocker. Ending that supported contact releases only its contribution. Physical authoring can revise the explicit map after a terrain edit.' },
        { id: 'pickup', observationKind: 'ContactSpanUpdated', sourceObjectId: 'listening-pickup-left', consequence: 'Bottom-lane travel changes observation weights with zero new onsets.', help: 'Let the bottom actor walk, or block it to hold a position. Inspect the shared body and contact bindings through the existing skin/bar panel.' }],
      requirements: { required: dependencies, optional: [], substitutableWithNamedApproximation: [] }, credits: [{ name: 'LemmingsJS-MIDI', role: 'Original shared skin, felt bar and three-hand physical lesson', source: null }],
      cost: { lanes: 3, maximumVoices: 4, sharedBodies: 1, estimateClass: 'authored-upper-bound-not-measured-realtime-capacity' }, mechanisms: ['contact', 'travel', 'cooperation'], density: 'sparse', lessonLevel: 2 });
    results.push(freezeData({ scene, recipe, recipeHash, dependencies }));
  }
  return freezeData(results);
}
