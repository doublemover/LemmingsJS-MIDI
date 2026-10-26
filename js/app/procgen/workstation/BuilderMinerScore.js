import { hashData, freezeData } from '../../../core/CanonicalData.js';
import { validateSceneTerrainLayout } from '../SceneTerrainLayout.js';
import { validateReleaseGesture } from '../ReleaseGesture.js';
import { normalizeWorkerLimits } from '../ProcgenWorkerLimits.js';
import { normalizePopulationPolicy } from '../ProcgenPopulationPolicy.js';
import { validatePerformanceSceneRecipe } from './PerformanceSceneRecipe.js';
import { validatePerformanceScene } from './PerformanceScene.js';
import { createEmbeddedScenePatch } from './EmbeddedScenePatch.js';

export const BUILDER_MINER_ARRANGEMENTS = freezeData([
  { id: 'dialogue', title: 'Two-worker dialogue', workers: ['builders', 'miners'], spread: 0, stations: [80, 80] },
  { id: 'staggered', title: 'Staggered crew', workers: ['builders', 'miners'], spread: 18, stations: [80, 80] },
  { id: 'converging', title: 'Converging ensemble', workers: ['builders', 'miners', 'bashers'], spread: 6, stations: [96, 80, 120] }
]);
const operations = { builders: 'build', miners: 'mine', bashers: 'bash' };
const palettes = {
  builders: { name: 'Soft FM mallet', pitch: 5700, ratio: 2, index: 0.3, decay: 0.14 },
  miners: { name: 'Gravel FM spring', pitch: 4500, ratio: 3.17, index: 1.7, decay: 0.09 },
  bashers: { name: 'Short FM tool', pitch: 6900, ratio: 1.41, index: 1.2, decay: 0.04 }
};

export async function createBuilderMinerScores({ sourceHash, descriptor, signal } = {}) {
  if (!['native-fm', 'native-modal'].includes(descriptor?.engineId) || descriptor.maximumVoices < 8) throw new TypeError('Builder-Miner contact scores require their pinned eight-voice FM or modal engine.');
  const modal = descriptor.engineId === 'native-modal', variant = modal ? 'dry-modal' : 'dry-fm', variantTitle = modal ? 'dry modal' : 'dry FM';
  const references = new Map();
  for (const [worker, palette] of Object.entries(palettes)) {
    signal?.throwIfAborted(); const modeRatios = worker === 'builders' ? [1, 2.76, 5.4, 8.93] : worker === 'miners' ? [1, 1.43, 3.17, 6.28] : [1, 2.09, 4.83, 10.1], modalParameters = { attackSeconds: 0.001, decaySeconds: 0, sustain01: 1, releaseSeconds: 0.12, gain01: 0.3, pan01: 0, modeCount: 4, bodyT60Seconds: worker === 'builders' ? 0.24 : worker === 'miners' ? 0.4 : 0.09, bodySizeRatio: 1, strikePosition01: 0.25, maxBendCents: 0 };
    for (let index = 0; index < 4; index++) Object.assign(modalParameters, { ['mode' + index + 'Ratio']: modeRatios[index], ['mode' + index + 'T60Scale']: [1, 0.7, 0.4, 0.22][index], ['mode' + index + 'GainA']: [0.55, 0.22, 0.14, 0.07][index], ['mode' + index + 'GainB']: [0.2, 0.42, 0.1, 0.18][index] });
    references.set(worker, await createEmbeddedScenePatch({ sourceHash, descriptor, definition: {
      schemaVersion: 2, id: 'scene.builder-miner.' + variant + '.' + worker, revision: 1, name: modal ? palette.name.replace('FM', 'modal') : palette.name, author: 'LemmingsJS-MIDI', tags: ['original', 'scene', variant + '-contact-study', 'unqualified-content'], engineId: descriptor.engineId, engineVersion: 1,
      parameters: modal ? modalParameters : { attackSeconds: 0.001, decaySeconds: palette.decay, sustain01: 0, releaseSeconds: 0.06, gain01: 0.3, pan01: 0, carrierRatio: 1, modulatorRatio: palette.ratio, indexStart: palette.index, indexEnd: 0.05, indexSeconds: palette.decay / 2, dualPair: 0, secondaryMix01: 0, maxBendCents: 0, pitchSettleCents: 0 },
      modulations: [], sampleRefs: [], causalBindings: [], voicePolicy: { maxVoices: 8, steal: 'reject' }, mix: { gain01: 0.3, pan01: 0 },
      macros: [{ id: 'hardness', name: 'HARDNESS', mode: 'onset-only', default01: modal ? 0.25 : (palette.index - 0.1) / 1.9, smoothingMs: 0, perceptualDirection: modal ? 'Moves the modal strike-site interpolation on later actual work attacks; it does not move the worker.' : 'Changes the initial FM index of later real work attacks.', targets: [{ parameter: modal ? 'strikePosition01' : 'indexStart', unit: modal ? 'normalized' : 'dimensionless', minimum: modal ? 0 : 0.1, maximum: modal ? 1 : 2, curve: 'linear', composition: 'replace', clamp: true }] }]
    } }));
  }
  const dependencies = await Promise.all(['TerrainWorkCommitted', 'PickupCrossing', 'CommandApplied'].map(async id => ({ kind: 'physical-observation', id, revision: 1, hash: await hashData({ buildId: sourceHash, observation: id, physicalBatch: 1, policy: 'finite-station-command;successful-solid-work-v2' }), description: 'Actual station crossings, accepted future interventions and operation-accurate changed-solid work; no animation or replacement beats' })));
  const output = [];
  for (const arrangement of BUILDER_MINER_ARRANGEMENTS) {
    signal?.throwIfAborted(); const lanes = arrangement.workers.map((worker, laneId) => laneId), laneCount = lanes.length;
    const layout = validateSceneTerrainLayout({ schema: 'lemmings-scene-terrain/v1', id: 'terrain.builder-miner.' + arrangement.id, revision: 1, width: 512, laneHeight: 128, lanes: lanes.map(laneId => ({ laneId, regions: [
      { kind: 'solid', x1: 0, x2: 512, y1: 96, y2: 128, color: 0xff8e7860 },
      { kind: 'steel', x1: 0, x2: 512, y1: 120, y2: 128, color: 0xff9aa8b4 },
      ...(arrangement.workers[laneId] === 'bashers' ? [{ kind: 'solid', x1: 128, x2: 176, y1: 72, y2: 96, color: 0xff817269 }] : []),
      { kind: 'steel', x1: 448, x2: 452, y1: 64, y2: 120, color: 0xff9aa8b4 }
    ] })) });
    const release = validateReleaseGesture({ version: 1, id: 'builder-miner.' + arrangement.id + '.entry', revision: 1, nominalGapTicks: 54, spreadTicks: arrangement.spread, lanePhase: lanes.map(laneId => ({ laneId, offsetTicks: laneId * arrangement.spread })), grouping: 'free', clockMode: 'locked', finiteBurstCount: laneCount, phaseStepTicks: 0, liveChangeBoundary: 'next-cohort', paused: false, seed: 29219 }, laneCount);
    const recipe = validatePerformanceSceneRecipe({ schema: 'lemmings-physical-score-recipe/v1', id: 'score.builder-miner.' + arrangement.id, revision: 1, sourceHash, seedPolicy: 'scene-seed', assistPolicy: 'manual-only', initialTerrainLayout: layout, initialReleaseGesture: release,
      settings: { laneCount, laneHeight: 128, pack: 1, speed: 3, hazardSpacing: 1024, decoration: 'none', workerLimits: normalizeWorkerLimits(), populationPolicy: normalizePopulationPolicy({ scoutsEvery: 0, spawnSpreadTicks: arrangement.spread }) }, terrainFamilies: lanes.map(() => 'crystal') });
    const recipeHash = await hashData(recipe), pickups = lanes.map(laneId => ({ id: 'builder-miner-station-' + laneId, revision: 1, worldAnchor: 'world', geometry: { kind: 'segment', points: [{ x: arrangement.stations[laneId], y: laneId * 128 }, { x: arrangement.stations[laneId], y: (laneId + 1) * 128 }] }, laneScope: [laneId], trigger: 'cross', directionPolicy: 'positive', hysteresis: 0, retriggerOnEdit: false, pitchMap: { mode: 'fixed', baseCents: palettes[arrangement.workers[laneId]].pitch } }));
    const graph = { version: 1, revision: 1, pickups,
      instruments: lanes.map(laneId => ({ id: 'builder-miner-work-' + laneId, sourceLanes: [laneId], sourceKind: 'TerrainWorkCommitted', operationKind: operations[arrangement.workers[laneId]], workChangePolicy: 'solid', changedOnly: true, pitchCents: palettes[arrangement.workers[laneId]].pitch, velocity01: 0.6, role: 'successful-tool-contact', route: 'local' })),
      feedback: { version: 1, conductors: lanes.map(laneId => ({ id: 'builder-miner-assign-' + laneId, revision: 1, source: { kind: 'PickupCrossing', pickupId: pickups[laneId].id, direction: 'positive' }, target: { version: 1, kind: 'source-actor' }, command: { kind: 'assign-worker', parameters: { workerKind: arrangement.workers[laneId] } }, fuel: 1, refractoryTicks: 1, eligibilityTicks: 0 })), layers: [] }
    };
    const scene = validatePerformanceScene({ schema: 'lemmings-performance-scene/v1', id: 'builder-miner.' + arrangement.id + '.' + variant, version: 1, title: 'Builder-Miner Workshop · ' + arrangement.title + ' · ' + variantTitle,
      description: 'Finite adjacent work benches, one entrant per lane and no automatic replacement crew. Explicitly arm Physical feedback before Play to request each named skill once at its visible station; otherwise assign the skill manually. The accepted next-tick intervention owns the work. Builder bricks and miner substrokes sound only after actual solid changes; waiting, rejected assignments, protected steel and exhausted material add no substitute notes. Steel below the finite bench bounds excavation. Mute/solo changes sound alone. ' + (modal ? 'Four-mode original positive-loss bodies with two distinct strike responses. These are authored approximations, not measured physical materials.' : 'Dry FM contact study.') + ' Prepared multisamples, friction, talking tools, cargo, grafts and shared bodies are separate unavailable variants. Runtime geometry, action-phase, device and listening qualification pending.',
      sourceVersion: { id: 'procgen-workstation-source', revision: 2, hash: sourceHash }, worldRecipeRef: { id: recipe.id, revision: 1, hash: recipeHash }, seed: 29219,
      physicalControls: [{ id: 'stagger', label: 'STAGGER · actual next crew spacing', scope: 'physical', unit: 'count', minimum: 0, maximum: 53, initial: arrangement.spread, step: 1, target: 'release-gesture:spreadTicks;next-cohort' }, { id: 'crew', label: 'CREW · choose named two/three-worker score', scope: 'physical', unit: 'count', minimum: 2, maximum: 3, initial: laneCount, step: 1, target: 'scene-browser:named-arrangement;explicit-prepare' }, { id: 'hardness', label: 'HARDNESS · later work attacks', scope: 'sound', unit: 'normalized', minimum: 0, maximum: 1, initial: 0.5, step: 0.01, target: 'patch-macro:hardness;next-onset-only' }], causalMappings: graph,
      patchRefs: lanes.map(laneId => ({ laneId: 'builder-miner-lane-' + laneId, reference: references.get(arrangement.workers[laneId]) })), mix: lanes.map(laneId => ({ laneId: 'builder-miner-lane-' + laneId, gain: 0.45, pan: laneCount === 2 ? laneId * 80 - 40 : laneId * 40 - 40, mute: false, solo: false })), initialTransport: { playing: false, bpm: 120, gameSpeed: 3, speedMode: 'bpm' }, tutorialRef: null,
      expectedLandmarks: [{ id: 'accepted-station-work', observationKind: 'TerrainWorkCommitted', sourceObjectId: 'builder-miner-station-0', consequence: 'Successful solid-edit operations cite the accepted intervention, action instance, cycle, phase and operation ordinal. A station crossing or requested assignment creates no attack.', help: 'Arm Physical feedback explicitly, then Play. Inspect the accepted command and each actual work operation. Compare dialogue/staggered scores before adding the third crew.' }, { id: 'finite-material', observationKind: 'TerrainWorkCommitted', sourceObjectId: 'finite-work-benches', consequence: 'Protected, canceled and zero-change work remains silent. Finite crew and material are never replenished to complete a bar.', help: 'Mute one lane while it works, then restore it. Only later successful contacts can sound; missed strikes are not replayed.' }],
      requirements: { required: dependencies, optional: [], substitutableWithNamedApproximation: [] }, credits: [{ name: 'LemmingsJS-MIDI', role: 'Original finite work geometry, explicit intervention stations and original ' + variantTitle + ' recipes', source: null }], cost: { lanes: laneCount, maximumVoices: laneCount * 8, sharedBodies: 0, estimateClass: 'authored-upper-bound-not-measured-realtime-capacity' }, mechanisms: ['work', 'terrain', 'crossing'], density: 'sparse', lessonLevel: 0 });
    output.push({ scene, recipe, recipeHash, dependencies });
  }
  return output;
}
