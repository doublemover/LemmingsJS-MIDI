import { hashData, freezeData } from '../../../core/CanonicalData.js';
import { createQuarryEcho } from '../../../midi/content/DubQuarryRack.js';
import { validateSceneTerrainLayout } from '../SceneTerrainLayout.js';
import { validateReleaseGesture } from '../ReleaseGesture.js';
import { normalizeWorkerLimits } from '../ProcgenWorkerLimits.js';
import { normalizePopulationPolicy } from '../ProcgenPopulationPolicy.js';
import { validatePerformanceSceneRecipe } from './PerformanceSceneRecipe.js';
import { validatePerformanceScene } from './PerformanceScene.js';
import { createEmbeddedScenePatch } from './EmbeddedScenePatch.js';
import { createScoreStepJunction } from './ScoreRouteJunction.js';

export const SWITCHYARD_ARRANGEMENTS = freezeData([
  { id: 'dry-pocket', title: 'Straight dry pocket', width: 512, lanes: 2, gap: 54, blockedReturn: false, echo: false },
  { id: 'broken-switch', title: 'Lopsided blocker switch', width: 768, lanes: 3, gap: 42, blockedReturn: false, echo: true },
  { id: 'sparse-broken', title: 'Sparse blocked return', width: 640, lanes: 3, gap: 72, blockedReturn: true, echo: true }
]);
const roles = ['landing-kick', 'builder-hat', 'blocker-reply'];
const pitches = [3600, 6000, 4800];
const station = (id, pickupId, command) => ({ id, revision: 1, enabled: true, source: { kind: 'PickupCrossing', pickupId, direction: 'positive' }, target: { version: 1, kind: 'source-actor' }, command,
  fuel: 1, refractoryTicks: 1, eligibilityTicks: 0 });

export async function createSwitchyardScores({ sourceHash, descriptor, signal } = {}) {
  if (descriptor?.engineId !== 'native-fm' || descriptor.maximumVoices < 8) throw new TypeError('The dry FM Switchyard needs its exact eight-voice native FM descriptor.');
  const patches = [];
  for (let lane = 0; lane < roles.length; lane++) {
    signal?.throwIfAborted(); const decay = [0.14, 0.035, 0.09][lane], index = [1.4, 4.5, 3.2][lane];
    patches.push(await createEmbeddedScenePatch({ sourceHash, descriptor, definition: { schemaVersion: 2, id: 'scene.switchyard.fm.' + roles[lane], revision: 1, name: ['Dry FM landing kick', 'Dry FM builder contact hat', 'Dry FM blocker reply'][lane], author: 'LemmingsJS-MIDI', tags: ['original', 'scene', 'dry-fm-contact-study'], engineId: 'native-fm', engineVersion: 1,
      parameters: { attackSeconds: 0.001, decaySeconds: decay, sustain01: 0, releaseSeconds: 0.025, gain01: 0.4, pan01: 0, carrierRatio: [1, 5, 3][lane], modulatorRatio: [0.5, 7.17, 5.17][lane], indexStart: index, indexEnd: [0.03, 0.3, 0.15][lane], indexSeconds: decay * 0.7, pitchSettleCents: lane ? 0 : 900, pitchSettleSeconds: 0.045, maxBendCents: 0 },
      sampleRefs: [], modulations: [], causalBindings: [], voicePolicy: { maxVoices: 8, steal: 'reject' }, mix: { gain01: 0.4, pan01: 0 }, macros: [{ id: 'snap', name: 'SNAP', mode: 'onset-only', default01: (index - 0.5) / 5.5, smoothingMs: 0, perceptualDirection: 'Higher SNAP increases the inharmonic FM index on later real contacts; physical traffic and missed contacts are unchanged.', targets: [{ parameter: 'indexStart', unit: 'dimensionless', minimum: 0.5, maximum: 6, curve: 'linear', composition: 'replace', clamp: true }] }] } }));
  }
  const observations = ['FlightArc', 'RicochetResponse', 'FlightArcEnded', 'TerrainWorkCommitted', 'ContactResolved', 'PickupCrossing', 'MotionCommitted'];
  const dependencies = await Promise.all(observations.map(async id => ({ kind: 'physical-observation', id, revision: 1, hash: await hashData({ buildId: sourceHash, observation: id, policy: 'switchyard-real-safe-landing-changed-build-and-blocker-contact-v1' }), description: 'Actual finite-cohort facts; no periodic filler, requested-switch accent or death-dependent strike' })));
  const rackDependency = { kind: 'renderer', id: 'owned-static-scene-delay-rack', revision: 1, hash: await hashData({ buildId: sourceHash, profile: 'gain-delay-only;explicit-static-prefix;four-second-preview-tail' }), description: 'Explicit saved echo defaults and momentary THROW; the direct pocket remains dry' }, result = [];
  for (const arrangement of SWITCHYARD_ARRANGEMENTS) {
    signal?.throwIfAborted(); const lanes = Array.from({ length: arrangement.lanes }, (_, lane) => lane), builderStation = 'switchyard-builder-station', blockerStation = 'switchyard-blocker-station';
    const layout = validateSceneTerrainLayout({ schema: 'lemmings-scene-terrain/v1', id: 'terrain.switchyard.' + arrangement.id, revision: 1, width: arrangement.width, laneHeight: 128, lanes: lanes.map(laneId => ({ laneId, regions: [
        { kind: 'solid', x1: 0, x2: arrangement.width, y1: laneId === 0 ? 112 : 96, y2: 128, color: 0xff707e76 },
        ...(laneId === 0 ? [{ kind: 'solid', x1: 0, x2: 144, y1: 80, y2: 112, color: 0xff81948b }] : []),
        { kind: 'steel', x1: arrangement.width - 64, x2: arrangement.width - 60, y1: 48, y2: laneId === 0 ? 112 : 96, color: 0xffa0b0b9 },
        ...(laneId === 2 && arrangement.blockedReturn ? [{ kind: 'steel', x1: 304, x2: 308, y1: 48, y2: 96, color: 0xffb3a18e }] : [])
      ] })) }), layoutHash = await hashData(layout);
    const release = validateReleaseGesture({ version: 1, id: 'switchyard.' + arrangement.id + '.entry', revision: 1, nominalGapTicks: arrangement.gap, spreadTicks: 0, lanePhase: lanes.map(laneId => ({ laneId, offsetTicks: 0 })), grouping: 'free', clockMode: 'locked', finiteBurstCount: lanes.length * 3, phaseStepTicks: 0, liveChangeBoundary: 'next-cohort', paused: false, seed: 29873 }, lanes.length);
    const recipe = validatePerformanceSceneRecipe({ schema: 'lemmings-physical-score-recipe/v1', id: 'score.switchyard.' + arrangement.id + '.dry-fm', revision: 1, sourceHash, seedPolicy: 'scene-seed', assistPolicy: 'manual-only', initialTerrainLayout: layout, initialReleaseGesture: release,
        ...(lanes.length === 3 ? { initialJunctions: createScoreStepJunction({ id: 'switchyard-return', layoutHash, floorY: 2 * 128 + 96 }) } : {}),
        ...(arrangement.echo ? { initialEffectRack: { schema: 'lemmings-owner-effect-rack/v1', bypass: 'active', graph: createQuarryEcho({ delaySeconds: 0.18, feedback: 0.25, send01: 0, return01: 0.2, mode: 'glide' }) } } : {}),
        settings: { laneCount: lanes.length, laneHeight: 128, pack: 1, speed: 3, hazardSpacing: 1024, decoration: 'none', workerLimits: normalizeWorkerLimits(), populationPolicy: normalizePopulationPolicy({ scoutsEvery: 0, spawnSpreadTicks: 0 }) }, terrainFamilies: lanes.map(() => 'crystal') }), recipeHash = await hashData(recipe);
    const pickups = [{ id: builderStation, revision: 1, worldAnchor: 'world', geometry: { kind: 'segment', points: [{ x: 80, y: 128 }, { x: 80, y: 256 }] }, laneScope: [1], trigger: 'cross', directionPolicy: 'positive', hysteresis: 0, retriggerOnEdit: false }];
    if (lanes.length === 3) pickups.push({ id: blockerStation, revision: 1, worldAnchor: 'world', geometry: { kind: 'segment', points: [{ x: arrangement.width - 160, y: 256 }, { x: arrangement.width - 160, y: 384 }] }, laneScope: [2], trigger: 'cross', directionPolicy: 'positive', hysteresis: 0, retriggerOnEdit: false });
    const graph = { version: 1, revision: 1, pickups, instruments: [
      { id: 'switchyard-kick', sourceKind: 'FlightArc', sourceLanes: [0], pitchCents: pitches[0], velocity01: 0.65, role: 'landing-kick', route: 'local', response: { type: 'flightArc', spawnPolicy: 'exclude-spawn', sustain: false, landingStrike: true, terminalStrike: false, maximumBendCents: 0, centsPerPixel: 0, fullAccentPixels: 32 } },
      { id: 'switchyard-hat', sourceKind: 'TerrainWorkCommitted', sourceLanes: [1], operationKind: 'build', workChangePolicy: 'solid', changedOnly: true, pitchCents: pitches[1], velocity01: 0.45, role: 'builder-hat', route: 'local' },
      ...(lanes.length === 3 ? [{ id: 'switchyard-snare', sourceKind: 'RicochetResponse', sourceLanes: [2], pitchCents: pitches[2], velocity01: 0.55, role: 'blocker-reply', route: 'local', response: { type: 'ricochet', mode: 'alternating', roles: 'walker', intervals: [0], blockerMuted: true } }] : [])
    ], feedback: { version: 1, conductors: [station('switchyard-builder', builderStation, { kind: 'assign-worker', parameters: { workerKind: 'builders' } }), ...(lanes.length === 3 ? [station('switchyard-blocker', blockerStation, { kind: 'place-blocker', parameters: {} })] : [])], layers: [] } };
    const required = [...dependencies, ...(arrangement.echo ? [rackDependency] : [])], controls = [
      { id: 'spacing', label: 'SPACING · next finite entrants', scope: 'physical', unit: 'count', minimum: 12, maximum: 192, initial: arrangement.gap, step: 6, target: 'release-gesture:nominalGapTicks;next-cohort' },
      { id: 'return', label: 'RETURN · direct / stepped safe junction', scope: 'physical', unit: 'count', minimum: 0, maximum: 1, initial: 0, step: 1, target: lanes.length === 3 ? 'junction:switchyard-return;explicit-request;qualified-empty-boundary' : 'scene-browser:broken-switch;explicit-prepare' },
      { id: 'snap', label: 'SNAP · later contact timbre', scope: 'sound', unit: 'normalized', minimum: 0, maximum: 1, initial: 0.5, step: 0.01, target: 'patch-macro:snap;next-onset-only' },
      ...(arrangement.echo ? [{ id: 'throw', label: 'THROW · explicit momentary echo', scope: 'sound', unit: 'normalized', minimum: 0, maximum: 1, initial: 0, step: 0.01, target: 'effect-macro:THROW;explicit-prepare;momentary' }] : [])
    ];
    const scene = validatePerformanceScene({ schema: 'lemmings-performance-scene/v1', id: 'switchyard-breakbeat.' + arrangement.id + '.dry-fm', version: 1, title: 'Switchyard Breakbeat · ' + arrangement.title + ' · dry FM contact study',
      description: 'A finite physical score with safe landing kicks, real changed-material builder contacts' + (lanes.length === 3 ? ' and actual blocker-return replies.' : '.') + ' Arm the one-shot Physical feedback stations explicitly before Play. No hidden loop fills a missing actor or blocked return. This is the named dry FM realization; sampled kit, open-hat choke, speech carrier and shared membrane editions are separate dependencies. Geometry and listening qualification remain pending.',
      sourceVersion: { id: 'procgen-workstation-source', revision: 2, hash: sourceHash }, worldRecipeRef: { id: recipe.id, revision: 1, hash: recipeHash }, seed: 29873, physicalControls: controls, causalMappings: graph,
      patchRefs: lanes.map(laneId => ({ laneId: 'switchyard-lane-' + laneId, reference: patches[laneId] })), mix: lanes.map(laneId => ({ laneId: 'switchyard-lane-' + laneId, gain: 0.45, pan: (laneId / (lanes.length - 1) * 2 - 1) * 40, mute: false, solo: false })), initialTransport: { playing: false, bpm: 110, gameSpeed: 3, speedMode: 'bpm' }, tutorialRef: null,
      expectedLandmarks: [{ id: 'safe-kick', observationKind: 'FlightArcEnded', sourceObjectId: 'switchyard-low-ledge', consequence: 'Only an actual non-spawn safe landing can start the kick. A terminal fall creates no substitute hit.', help: 'Watch one actor leave the low ledge and name its landing event before changing release spacing.' },
        { id: 'actual-hat', observationKind: 'TerrainWorkCommitted', sourceObjectId: builderStation, consequence: 'Only successful changed-solid builder operations start hats; a station request or empty tool frame stays silent.', help: 'Arm the one-shot station explicitly, inspect CommandApplied and follow the worker. Muting hats leaves its terrain edits unchanged.' },
        ...(lanes.length === 3 ? [{ id: 'actual-return', observationKind: 'ContactResolved', sourceObjectId: blockerStation, consequence: arrangement.blockedReturn ? 'The visible wall prevents this station from receiving its first actor. No blocker or reply is fabricated.' : 'A real blocker collision starts one reply after the physical route. A requested or rejected junction switch has no success accent.', help: 'Use Junctions to request direct or stepped geometry. Observe pending/applied/expired outcomes, then compare later actual contact IDs.' }] : [])],
      requirements: { required, optional: [], substitutableWithNamedApproximation: [] }, credits: [{ name: 'LemmingsJS-MIDI', role: 'Original finite switchyard geometry, explicit stations and dry FM drum studies', source: null }], cost: { lanes: lanes.length, maximumVoices: lanes.length * 8, sharedBodies: 0, estimateClass: 'authored-upper-bound-not-measured-realtime-capacity' }, mechanisms: ['crossing', 'work', 'travel', 'terrain'], density: 'sparse', lessonLevel: 0 });
    result.push({ scene, recipe, recipeHash, dependencies: required });
  }
  return result;
}
