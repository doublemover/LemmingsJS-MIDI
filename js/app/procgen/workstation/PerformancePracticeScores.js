import { hashData } from '../../../core/CanonicalData.js';
import { validateReleaseGesture } from '../ReleaseGesture.js';
import { normalizeWorkerLimits } from '../ProcgenWorkerLimits.js';
import { normalizePopulationPolicy } from '../ProcgenPopulationPolicy.js';
import { validateSceneTerrainLayout } from '../SceneTerrainLayout.js';
import { validateProjectJunctions } from './PhysicalJunctionProject.js';
import { validatePerformanceSceneRecipe } from './PerformanceSceneRecipe.js';
import { validatePerformanceScene } from './PerformanceScene.js';

const scope = count => Array.from({ length: count }, (_, index) => index);
const tuning = { version: 1, id: 'practice.just-pentatonic', kind: 'ratios', values: [[1, 1], [9, 8], [5, 4], [3, 2], [5, 3]], periodCents: 1200, referenceCents: 6900, referenceHz: 220 };
export async function createAdditionalPracticeScores({ sourceHash, reference }) {
  const output = [];
  for (const spec of [
    { id: 'work-becomes-percussion', title: 'Work Becomes Percussion', lanes: 2, spread: 0, level: 3, mechanisms: ['work', 'terrain'], description: 'Two finite entrants land on a visible work bench. Assign a builder or miner explicitly: only actual changed-material contacts excite the tool voice. Waiting and unsuccessful tool use stay silent.' },
    { id: 'path-becomes-delay', title: 'Path Becomes Delay', lanes: 1, spread: 0, level: 4, mechanisms: ['terrain', 'travel', 'crossing'], description: 'A finite entrant crosses the arrival pickup after the direct route. Request the stepped route in Junctions, wait for its actual safe application, then release a fresh entrant. The extra travel changes arrival; the pickup stays fixed.' },
    { id: 'crowd-becomes-harmony', title: 'Crowd Becomes Harmony', lanes: 3, spread: 6, level: 5, mechanisms: ['cooperation', 'crossing'], description: 'Three finite entrants enter one tuned field. Real horizontal formation chooses the voicing in a 220 Hz just pentatonic field. Change finite entry spacing, observe the changed formation, then try BRIGHTNESS on later attacks.' }
  ]) {
    const laneCount = spec.lanes, laneIds = scope(laneCount), work = spec.level === 3, path = spec.level === 4;
    const layout = validateSceneTerrainLayout({ schema: 'lemmings-scene-terrain/v1', id: 'terrain.practice.' + spec.id, revision: 1, width: 512, laneHeight: 96,
      lanes: laneIds.map(laneId => ({ laneId, regions: [{ kind: 'solid', x1: 0, x2: 512, y1: 72, y2: 96, color: work ? 0xff667a91 : path ? 0xff698478 : 0xff967c9b }] })) });
    const layoutHash = await hashData(layout);
    const junctions = path ? validateProjectJunctions([{ id: 'practice-path', revision: 1, safetyVersion: 1,
      control: { x1: 144, x2: 192, y1: 72, y2: 88 }, influence: { x1: 128, x2: 208, y1: 48, y2: 96 },
      ports: [{ id: 'path-entry', role: 'inlet', position: { x: 130, y: 72 }, direction: 'right', support: [{ dx: 0, dy: 1, solid: true }] }, { id: 'path-exit', role: 'outlet', position: { x: 206, y: 72 }, direction: 'right', support: [{ dx: 0, dy: 1, solid: true }] }],
      configurations: [
        { id: 'direct', outletIds: ['path-exit'], spans: scope(16).map(row => ({ y: 72 + row, x1: 144, x2: 192, solid: true })) },
        { id: 'stepped', outletIds: ['path-exit'], spans: scope(16).flatMap(row => { const y = 72 + row, step = 160 + (Math.ceil((88 - y) / 2) - 1) * 4; return [{ y, x1: 144, x2: step, solid: false }, { y, x1: step, x2: 192, solid: true }]; }) }
      ], requiredAssets: [layoutHash] }]) : [];
    const release = validateReleaseGesture({ version: 1, id: 'practice.' + spec.id, revision: 1, nominalGapTicks: 54, spreadTicks: spec.spread, lanePhase: laneIds.map(laneId => ({ laneId, offsetTicks: laneId * spec.spread })), grouping: 'free', clockMode: 'locked', finiteBurstCount: laneCount, phaseStepTicks: 0, liveChangeBoundary: 'next-cohort', paused: false, seed: 28001 }, laneCount);
    const recipe = validatePerformanceSceneRecipe({ schema: 'lemmings-physical-score-recipe/v1', id: 'score.practice.' + spec.id, revision: 1, sourceHash, seedPolicy: 'scene-seed', assistPolicy: 'manual-only', initialReleaseGesture: release, initialTerrainLayout: layout, ...(path ? { initialJunctions: junctions } : {}),
      settings: { laneCount, laneHeight: 96, pack: 1, speed: 3, hazardSpacing: 1024, decoration: 'none', workerLimits: normalizeWorkerLimits(), populationPolicy: normalizePopulationPolicy({ scoutsEvery: 0, spawnSpreadTicks: spec.spread }) }, terrainFamilies: Array(laneCount).fill('crystal') });
    const recipeHash = await hashData(recipe), graph = { version: 1, revision: 1, instruments: [] };
    if (work) graph.instruments = laneIds.flatMap(laneId => ['build', 'mine'].map((operationKind, index) => ({ id: 'practice-' + operationKind + '-' + laneId, sourceLanes: [laneId], sourceKind: 'TerrainWorkCommitted', operationKind, workChangePolicy: 'solid', changedOnly: true, pitchCents: 4800 + index * 700, velocity01: 0.6, role: 'tool-contact', route: 'local' })));
    else {
      const pickupId = path ? 'practice-arrival' : 'practice-field', geometry = path ? { kind: 'segment', points: [{ x: 224, y: 0 }, { x: 224, y: 96 }] } : { kind: 'band', bounds: { x1: 96, x2: 208, y1: 0, y2: laneCount * 96 } };
      graph.pickups = [{ id: pickupId, revision: 1, worldAnchor: 'world', geometry, laneScope: laneIds, trigger: path ? 'cross' : 'occupancy', directionPolicy: path ? 'positive' : 'either', hysteresis: 0, pitchMap: { mode: 'fixed', baseCents: 5700 } }];
      graph.instruments = laneIds.map(laneId => ({ id: 'practice-' + (path ? 'arrival' : 'harmony') + '-' + laneId, pickupId, sourceLanes: [laneId], sourceKind: 'PickupCrossing', pitchCents: 5700, velocity01: 0.55, role: path ? 'arrival' : 'formation', route: 'local', ...(path ? {} : { formationId: 'practice-formation', harmonicFields: true }) }));
      if (!path) {
        graph.ensembles = [{ id: 'practice-flock', selector: { kind: 'region', bounds: { x1: 0, x2: 224, y1: 0, y2: 288 } }, membershipMode: 'dynamic', maximumMembers: 6, overlapPolicy: 'allow' }];
        graph.harmonicFields = [{ id: 'practice-tuning', revision: 1, priority: 0, geometry: { kind: 'band', bounds: { x1: 0, x2: 224, y1: 0, y2: 288 } }, laneScope: laneIds, tuning, heldPolicy: 'retune-held', deletionPolicy: 'release', boundary: 'step', width: 0, coordinateMap: { mode: 'nearest' }, slewSeconds: 0.03 }];
        graph.formations = [{ id: 'practice-formation', revision: 1, ensembleId: 'practice-flock', metric: 'laneX', mapping: 'ordered-spacing', policy: 'follow-formation', maximumVoices: 3, spacingPixels: 4, degreeStep: 1, hysteresisPixels: 1, slewSeconds: 0.03, rootPolicy: 'field', register: { minCents: 5700, maxCents: 9300 }, tuning }];
      }
    }
    const observations = work ? ['TerrainWorkCommitted'] : ['MotionCommitted', 'PickupCrossing'];
    const dependencies = await Promise.all(observations.map(async id => ({ kind: 'physical-observation', id, revision: 1, hash: await hashData({ buildId: sourceHash, observation: id, physicalBatch: 1, ...(id === 'TerrainWorkCommitted' ? { workVersion: 2, policy: 'successful-changed-material-operations' } : {}) }), description: work ? 'Actual changed-material tool contacts, not animation or SFX' : 'Source-linked motion and pickup observations' })));
    const scene = validatePerformanceScene({ schema: 'lemmings-performance-scene/v1', id: 'practice.' + spec.id, version: 1, title: spec.title, description: spec.description,
      sourceVersion: { id: 'procgen-workstation-source', revision: 2, hash: sourceHash }, worldRecipeRef: { id: recipe.id, revision: 1, hash: recipeHash }, seed: 28001, physicalControls: [], causalMappings: graph,
      patchRefs: laneIds.map(index => ({ laneId: 'practice-lane-' + index, reference })), mix: laneIds.map(index => ({ laneId: 'practice-lane-' + index, gain: 0.45, pan: laneCount === 1 ? 0 : (index / (laneCount - 1) * 2 - 1) * 48, mute: false, solo: false })),
      initialTransport: { playing: false, bpm: 120, gameSpeed: 3, speedMode: 'bpm' }, tutorialRef: null,
      expectedLandmarks: [{ id: 'practice-cause', observationKind: work ? 'TerrainWorkCommitted' : 'PickupCrossing', sourceObjectId: work ? 'finite-work-bench' : path ? 'practice-arrival' : 'practice-field', consequence: work ? 'A changed-material build or mining operation excites the mapped tool voice. Unproductive attempts stay silent.' : path ? 'The actual entrant reaches the unchanged arrival pickup after its real route.' : 'Real field occupancy starts actor-owned voices; current formation chooses their pitches.', help: spec.description }],
      requirements: { required: dependencies, optional: [], substitutableWithNamedApproximation: [] }, credits: [{ name: 'LemmingsJS-MIDI', role: 'Original finite physical practice geometry and mapping', source: null }], cost: { lanes: laneCount, maximumVoices: laneCount * reference.definition.voicePolicy.maxVoices, sharedBodies: 0, estimateClass: 'authored-upper-bound-not-measured-realtime-capacity' }, mechanisms: spec.mechanisms, density: 'sparse', lessonLevel: spec.level });
    output.push({ scene, recipe, recipeHash, dependencies });
  }
  return output;
}
