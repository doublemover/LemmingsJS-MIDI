import { hashData, freezeData } from '../../../core/CanonicalData.js';
import { validateSceneTerrainLayout } from '../SceneTerrainLayout.js';
import { validateReleaseGesture } from '../ReleaseGesture.js';
import { normalizeWorkerLimits } from '../ProcgenWorkerLimits.js';
import { normalizePopulationPolicy } from '../ProcgenPopulationPolicy.js';
import { validatePerformanceSceneRecipe } from './PerformanceSceneRecipe.js';
import { validatePerformanceScene } from './PerformanceScene.js';
import { validatePhysicalMusicGoal } from './PhysicalMusicGoal.js';

export const PHYSICAL_MUSIC_STARTER_ID = 'physical-composition.two-walls';
export function createPhysicalMusicStarterGoal({ unreachable = false } = {}) {
  return validatePhysicalMusicGoal({ schema: 'lemmings-physical-music-goal/v1', id: 'two-wall-goal', revision: 1, timeDomain: 'ticks', targetOnsets: [],
    periodGoals: [{ selector: { mappingId: 'voice0' }, period: unreachable ? 121 : 120, tolerance: 0 }, { selector: { mappingId: 'voice1' }, period: 160, tolerance: 0 }],
    periodRatios: unreachable ? [] : [{ left: { mappingId: 'voice0' }, right: { mappingId: 'voice1' }, numerator: 3, denominator: 4, toleranceTicks: 0 }],
    requiredCauseKinds: ['PickupCrossing'], forbiddenCauses: ['ActorTerminated'],
    allowedEdits: [{ id: 'right-wall-0', kind: 'right-wall-x', laneId: 0, bounds: { x1: 78, x2: 85, y1: 65, y2: 80 }, values: unreachable ? [78, 79, 80, 81, 82, 83, 84] : [80, 81, 82] }],
    crewConstraints: { requireAllSurvive: true, maximumActors: 2, containment: { x1: 8, x2: 128, y1: 0, y2: 192 },
      protectedRegions: [0, 1].flatMap(lane => [{ x1: 8, x2: 128, y1: lane * 96 + 80, y2: lane * 96 + 96 }, { x1: 8, x2: 21, y1: lane * 96 + 65, y2: lane * 96 + 80 }]) },
    skillInventory: { builder: 0, basher: 0, digger: 0, miner: 0 }, horizon: 480,
    budgets: { maximumCandidates: 64, logicalTicks: 30720, maximumOnsets: 64, maximumFacts: 8192, finalists: 1 } });
}
export async function createPhysicalMusicStarter({ sourceHash, reference } = {}) {
  const walls = [81, 101], layout = validateSceneTerrainLayout({ schema: 'lemmings-scene-terrain/v1', id: 'terrain.physical-composition.two-walls', revision: 1, width: 512, laneHeight: 96,
    lanes: walls.map((right, laneId) => ({ laneId, regions: [{ kind: 'solid', x1: 8, x2: 512, y1: 80, y2: 96, color: 0xff6c8294 },
      { kind: 'solid', x1: 8, x2: 21, y1: 65, y2: 80, color: 0xff6c8294 }, { kind: 'solid', x1: right, x2: 512, y1: 65, y2: 80, color: 0xff6c8294 }] })) });
  const release = validateReleaseGesture({ version: 1, id: 'physical-composition.two-walls.entry', revision: 1, nominalGapTicks: 54, spreadTicks: 0,
    lanePhase: [{ laneId: 0, offsetTicks: 0 }, { laneId: 1, offsetTicks: 0 }], grouping: 'free', clockMode: 'locked', finiteBurstCount: 2, phaseStepTicks: 0,
    liveChangeBoundary: 'next-cohort', paused: false, seed: 30301 }, 2);
  const recipe = validatePerformanceSceneRecipe({ schema: 'lemmings-physical-score-recipe/v1', id: 'score.' + PHYSICAL_MUSIC_STARTER_ID, revision: 1, sourceHash, seedPolicy: 'scene-seed', assistPolicy: 'manual-only',
    initialTerrainLayout: layout, initialReleaseGesture: release, actorBirthAbilities: [0, 1].map(laneId => ({ laneId, climb: false, parachute: false })),
    settings: { laneCount: 2, laneHeight: 96, pack: 1, speed: 3, hazardSpacing: 1024, decoration: 'none', workerLimits: normalizeWorkerLimits(), populationPolicy: normalizePopulationPolicy({ scoutsEvery: 0, spawnSpreadTicks: 0 }) }, terrainFamilies: ['crystal', 'crystal'] });
  const recipeHash = await hashData(recipe), dependencies = await Promise.all(['MotionCommitted', 'PickupCrossing'].map(async id => ({ kind: 'physical-observation', id, revision: 1,
    hash: await hashData({ buildId: sourceHash, observation: id, physicalBatch: 1, policy: 'ordinary-finite-crew;authored-two-wall-geometry' }), description: 'Actual walking/falling motion and swept spatial pickup crossings; no note schedule' })));
  const scene = validatePerformanceScene({ schema: 'lemmings-performance-scene/v1', id: PHYSICAL_MUSIC_STARTER_ID, version: 1, title: 'Compose with Physics · Two Walls',
    description: 'Two ordinary finite entrants fall and walk in authored corridors. No actor is posed onto a target, and assistance stays off. Run until both have landed, pause, then use Compose: a wall at81 is expected to yield120 ticks while the other lane yields160. Sample80/81/82 or search the declared seven-value domain for121, which may have no exact match. These are authored expectations awaiting current-build qualification. Preparing or selecting this scene creates no notes; only real crossings can sound.',
    sourceVersion: { id: 'procgen-workstation-source', revision: 2, hash: sourceHash }, worldRecipeRef: { id: recipe.id, revision: 1, hash: recipeHash }, seed: 30301,
    causalMappings: { version: 1, revision: 1, pickups: [0, 1].map(laneId => ({ id: 'entry' + laneId, revision: 1, laneScope: [laneId], directionPolicy: 'positive',
      geometry: { kind: 'segment', points: [{ x: 40, y: laneId * 96 + 70 }, { x: 40, y: laneId * 96 + 84 }] } })),
    instruments: [0, 1].map(laneId => ({ id: 'voice' + laneId, sourceKind: 'PickupCrossing', pickupId: 'entry' + laneId, sourceLanes: [laneId], pitchCents: 6000 + laneId * 700, velocity01: .55, role: 'actual-route', route: 'local' })) },
    patchRefs: [0, 1].map(laneId => ({ laneId: 'compose-lane-' + laneId, reference })), mix: [0, 1].map(laneId => ({ laneId: 'compose-lane-' + laneId, gain: .45, pan: laneId ? 40 : -40, mute: false, solo: false })),
    physicalControls: [], initialTransport: { playing: false, bpm: 120, gameSpeed: 3, speedMode: 'game' }, tutorialRef: null,
    expectedLandmarks: [{ id: 'physical-wall-periods', observationKind: 'PickupCrossing', sourceObjectId: 'entry0', consequence: 'Only actual repeated crossings determine the observed period.', help: 'Load the120/160 goal in Compose after both entrants land. Search or Sample explicitly; selecting a result leaves the world unchanged. Apply is gated by fresh independent replay.' }],
    requirements: { required: dependencies, optional: [], substitutableWithNamedApproximation: [] }, credits: [{ name: 'LemmingsJS-MIDI', role: 'Original two-wall physical composition study', source: null }],
    cost: { lanes: 2, maximumVoices: 16, sharedBodies: 0, estimateClass: 'authored-upper-bound-not-measured-realtime-capacity' }, mechanisms: ['crossing', 'terrain'], density: 'sparse', lessonLevel: 1 });
  return freezeData({ scene, recipe, recipeHash, dependencies });
}
