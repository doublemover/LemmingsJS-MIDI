import { hashData, freezeData } from '../../../core/CanonicalData.js';
import { validateActorBirthAbilities } from '../ActorBirthAbilities.js';
import { validateSceneTerrainLayout } from '../SceneTerrainLayout.js';
import { validateReleaseGesture } from '../ReleaseGesture.js';
import { normalizeWorkerLimits } from '../ProcgenWorkerLimits.js';
import { normalizePopulationPolicy } from '../ProcgenPopulationPolicy.js';
import { validatePerformanceSceneRecipe } from './PerformanceSceneRecipe.js';
import { validatePerformanceScene } from './PerformanceScene.js';
import { createEmbeddedScenePatch } from './EmbeddedScenePatch.js';

export const GLACIER_CHOIR_ARRANGEMENTS = freezeData([
  { id: 'one-falling-voice', title: 'One falling voice', lanes: 1, spread: 0, drone: false },
  { id: 'two-crossing-winds', title: 'Two staggered winds', lanes: 2, spread: 18, drone: false },
  { id: 'small-glacier-choir', title: 'Small glacier choir', lanes: 3, spread: 12, drone: true }
]);
const macro = (id, name, parameter, minimum, maximum, unit, initial) => ({ id, name, mode: 'onset-only', default01: (initial - minimum) / (maximum - minimum), smoothingMs: 0,
  perceptualDirection: 'Changes ' + name + ' on the next physical source; actor height, contact, flight and timing remain unchanged.', targets: [{ parameter, unit, minimum, maximum, curve: 'linear', composition: 'replace', clamp: true }] });

export async function createGlacierChoirScores({ sourceHash, descriptor, spectrumDescriptor = null, signal } = {}) {
  if (descriptor?.engineId !== 'worklet-choir' || descriptor.maximumVoices < 4) throw new TypeError('Dry Glacier Choir needs the pinned four-voice choir interface.');
  if (spectrumDescriptor && (spectrumDescriptor.engineId !== 'worklet-spectrum' || spectrumDescriptor.maximumVoices < 4)) throw new TypeError('The separately named Prism descent needs the pinned four-voice spectrum interface.');
  const choirPatches = [];
  for (let lane = 0; lane < 3; lane++) {
    signal?.throwIfAborted(); choirPatches.push(await createEmbeddedScenePatch({ sourceHash, descriptor, definition: { schemaVersion: 2, id: 'scene.glacier.hollow-ooh.' + lane, revision: 1, name: 'Hollow Ooh · glacier voice ' + (lane + 1), author: 'LemmingsJS-MIDI', tags: ['original', 'scene', 'physical-flight', 'dry-choir'], engineId: 'worklet-choir', engineVersion: 1,
      parameters: { vowel01: [0.15, 0.3, 0.45][lane], breath01: 0.16, sizeRatio: [1.2, 1, 0.9][lane], chorusCents: 2, vibratoCents: 1, vowelStep: 0, bandwidthScale: 1.1, attackSeconds: 0.02, decaySeconds: 0.08, sustain01: 0.7, releaseSeconds: 0.16, gain01: 0.35, pan01: 0 },
      sampleRefs: [], modulations: [], causalBindings: [], voicePolicy: { maxVoices: 4, steal: 'reject' }, mix: { gain01: 0.35, pan01: 0 }, macros: [macro('air', 'AIR', 'breath01', 0.02, 0.35, 'normalized', 0.16)] } }));
  }
  let prism = null;
  if (spectrumDescriptor) {
    const ratios = [1, 1.5, 2, 2.5, 3, 4, 5, 6], gains = [1, 0.45, 0.25, 0.2, 0.15, 0.1, 0.08, 0.05], parameters = { sourceMode: 1, partialCount: 8, partialDecaySeconds: 0, scan01: 0.3, body01: 0.4, edge01: 0.12, attackSeconds: 0.04, decaySeconds: 0.1, sustain01: 0.65, releaseSeconds: 0.22, gain01: 0.3, pan01: 0 };
    ratios.forEach((ratio, index) => { parameters['partial' + index + 'Ratio'] = ratio; parameters['partial' + index + 'Gain'] = gains[index]; parameters['partial' + index + 'T60Scale'] = 1; });
    prism = await createEmbeddedScenePatch({ sourceHash, descriptor: spectrumDescriptor, definition: { schemaVersion: 2, id: 'scene.glacier.prism-pad', revision: 1, name: 'Prism Pad · original eight-partial flight body', author: 'LemmingsJS-MIDI', tags: ['original', 'scene', 'physical-flight', 'additive'], engineId: 'worklet-spectrum', engineVersion: 1, parameters,
      sampleRefs: [], modulations: [], causalBindings: [], voicePolicy: { maxVoices: 4, steal: 'reject' }, mix: { gain01: 0.3, pan01: 0 }, macros: [macro('color', 'COLOR', 'body01', 0.1, 0.8, 'normalized', 0.4)] } });
  }
  const dependencies = await Promise.all(['FlightArc', 'FlightArcStarted', 'FlightArcUpdated', 'FlightArcEnded', 'ContactSpanBegan', 'ContactSpanEnded', 'ActorTerminated'].map(async id => ({ kind: 'physical-observation', id, revision: 1, hash: await hashData({ buildId: sourceHash, observation: id, policy: 'glacier-finite-flight-and-explicit-support-gates-v1' }), description: 'Complete actual flight/contact lifecycles; no viewport coordinate, audio-clock simulation or autonomous pad onset' })));
  const output = [];
  for (const arrangement of GLACIER_CHOIR_ARRANGEMENTS) for (const palette of prism && arrangement.lanes === 3 ? ['dry-choir', 'prism-descent'] : ['dry-choir']) {
    signal?.throwIfAborted(); const lanes = Array.from({ length: arrangement.lanes }, (_, lane) => lane), pitches = [5700, 6400, 6900], ledges = [144, 192, 240];
    const layout = validateSceneTerrainLayout({ schema: 'lemmings-scene-terrain/v1', id: 'terrain.glacier.' + arrangement.id, revision: 1, width: 640, laneHeight: 128, lanes: lanes.map(laneId => ({ laneId, regions: [
        { kind: 'solid', x1: 0, x2: 640, y1: 112, y2: 128, color: 0xffa9b8c3 }, { kind: 'solid', x1: 0, x2: ledges[laneId], y1: 80, y2: 112, color: 0xffc3d7df }, { kind: 'solid', x1: ledges[laneId], x2: ledges[laneId] + 112, y1: 100, y2: 112, color: 0xffb5ccd5 },
        { kind: 'steel', x1: 576, x2: 580, y1: 64, y2: 112, color: 0xff8cabbc }
      ] })) }), birth = validateActorBirthAbilities(lanes.map(laneId => ({ laneId, climb: false, parachute: laneId === 1 })), lanes.length);
    const release = validateReleaseGesture({ version: 1, id: 'glacier.' + arrangement.id + '.entry', revision: 1, nominalGapTicks: 60, spreadTicks: 0, lanePhase: lanes.map(laneId => ({ laneId, offsetTicks: laneId * arrangement.spread })), grouping: 'free', clockMode: 'locked', finiteBurstCount: lanes.length, phaseStepTicks: 0, liveChangeBoundary: 'next-cohort', paused: false, seed: 29921 }, lanes.length);
    const recipe = validatePerformanceSceneRecipe({ schema: 'lemmings-physical-score-recipe/v1', id: 'score.glacier.' + arrangement.id, revision: 1, sourceHash, seedPolicy: 'scene-seed', assistPolicy: 'manual-only', initialTerrainLayout: layout, initialReleaseGesture: release, actorBirthAbilities: birth,
        settings: { laneCount: lanes.length, laneHeight: 128, pack: 1, speed: 2, hazardSpacing: 1024, decoration: 'none', workerLimits: normalizeWorkerLimits(), populationPolicy: normalizePopulationPolicy({ scoutsEvery: 0, spawnSpreadTicks: 0 }) }, terrainFamilies: lanes.map(() => 'holiday-snow') }), recipeHash = await hashData(recipe);
    const instruments = lanes.flatMap(laneId => [{ id: 'glacier-flight-' + laneId, sourceKind: 'FlightArc', sourceLanes: [laneId], pitchCents: pitches[laneId], velocity01: 0.5, role: laneId === 1 && palette === 'prism-descent' ? 'prism-flight' : 'hollow-flight', route: 'local',
      response: { type: 'flightArc', spawnPolicy: 'exclude-spawn', mode: 'vertical-contour', sustain: true, landingStrike: true, terminalStrike: false, centsPerPixel: -0.8, maximumBendCents: 120, fullAccentPixels: 40, updateEveryTicks: 1, deadbandCents: 1 } },
    ...(arrangement.drone ? [{ id: 'glacier-support-' + laneId, sourceKind: 'ContactSpanBegan', sourceLanes: [laneId], causeKind: 'support', pitchCents: pitches[laneId] - 1200, velocity01: 0.12, role: 'explicit-held-support-drone', route: 'local' }] : [])]);
    const controls = [{ id: 'spacing', label: 'RELEASE SPACING · later finite entrants', scope: 'physical', unit: 'count', minimum: 1, maximum: 192, initial: 60, step: 1, target: 'release-gesture:nominalGapTicks;next-cohort' },
      { id: 'air', label: 'AIR · later Hollow Ooh bodies', scope: 'sound', unit: 'normalized', minimum: 0, maximum: 1, initial: (0.16 - 0.02) / 0.33, step: 0.01, target: 'patch-macro:air;choir-lanes;next-onset-only' },
      ...(palette === 'prism-descent' ? [{ id: 'color', label: 'COLOR · later Prism bodies', scope: 'sound', unit: 'normalized', minimum: 0, maximum: 1, initial: 3 / 7, step: 0.01, target: 'patch-macro:color;prism-lane;next-onset-only' }] : [])];
    const scene = validatePerformanceScene({ schema: 'lemmings-performance-scene/v1', id: 'glacier-choir.' + arrangement.id + '.' + palette, version: 1, title: 'Glacier Choir · ' + arrangement.title + ' · ' + (palette === 'prism-descent' ? 'Prism descent' : 'dry choir'),
      description: 'Finite actors traverse short authored two-step descents. The second corridor has a birth-owned parachute. Actual arcs own breath/height controls and a separate safe-landing contact cue; terminal falls never become ice strikes. ' + (arrangement.drone ? 'The quiet grounded layer is explicitly an intentional held support drone and ends with that contact; it is not evidence of continued actor motion. ' : 'Grounded actors have no sustained pad mapping. ') + 'This named dry realization has no PCM grain or captured freeze layer. Ice dust and Frozen air require separately prepared material and capture ownership. Geometry, camera equivalence and listening qualification remain pending.',
      sourceVersion: { id: 'procgen-workstation-source', revision: 2, hash: sourceHash }, worldRecipeRef: { id: recipe.id, revision: 1, hash: recipeHash }, seed: 29921, physicalControls: controls, causalMappings: { version: 1, revision: 1, instruments },
      patchRefs: lanes.map(laneId => ({ laneId: 'glacier-lane-' + laneId, reference: laneId === 1 && palette === 'prism-descent' ? prism : choirPatches[laneId] })), mix: lanes.map(laneId => ({ laneId: 'glacier-lane-' + laneId, gain: 0.4, pan: lanes.length === 1 ? 0 : (laneId / (lanes.length - 1) * 2 - 1) * 48, mute: false, solo: false })), initialTransport: { playing: false, bpm: 80, gameSpeed: 2, speedMode: 'bpm' }, tutorialRef: null,
      expectedLandmarks: [{ id: 'real-flight', observationKind: 'FlightArcStarted', sourceObjectId: 'terrain.glacier.' + arrangement.id, consequence: 'The actor leaving a ledge starts one held flight source; falling-to-floating stays in its actual arc.', help: 'Follow one actor, then solo its lane without changing the physical world. Height uses displacement from its arc origin, never the camera.' },
        { id: 'safe-grounding', observationKind: 'FlightArcEnded', sourceObjectId: 'glacier-low-shelves', consequence: 'Actual safe landing closes the flight body and permits one bounded landing cue. Removal, interruption and unsafe fall close the source without a success cue.', help: 'Pause/step, remove an airborne actor and Panic separately. A deliberate capture freeze is a different mechanism and is absent from this dry score.' }],
      requirements: { required: dependencies, optional: [], substitutableWithNamedApproximation: [] }, credits: [{ name: 'LemmingsJS-MIDI', role: 'Original finite descent geometry, Hollow Ooh formants and eight-partial Prism palette', source: null }], cost: { lanes: lanes.length, maximumVoices: lanes.length * 4, sharedBodies: 0, estimateClass: 'authored-upper-bound-not-measured-realtime-capacity' }, mechanisms: ['flight', 'travel', 'terrain'], density: 'sparse', lessonLevel: 0 });
    output.push({ scene, recipe, recipeHash, dependencies });
  }
  return output;
}
