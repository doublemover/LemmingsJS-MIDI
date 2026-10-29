import { freezeData } from '../../../core/CanonicalData.js';
import { createMidiProject } from '../../../midi/project/MidiProject.js';
import { createProcgenWorkstationProject } from './ProcgenWorkstationProject.js';
import { validatePerformanceSceneOrigin } from './PerformanceSceneRecipe.js';

export function materializePerformanceSceneProject(raw) {
  const origin = validatePerformanceSceneOrigin(raw), scene = origin.manifest, source = origin.recipe;
  const mix = new Map(scene.mix.map(value => [value.laneId, value]));
  const project = createProcgenWorkstationProject(createMidiProject(), { seed: scene.seed,
    ...(source.initialReleaseGesture ? { releaseGesture: source.initialReleaseGesture } : {}), ...(source.initialJunctions ? { junctions: source.initialJunctions } : {}),
    ...(source.initialEffectRack ? { effectRack: source.initialEffectRack } : {}), physicalGraph: scene.causalMappings, sceneOrigin: origin,
    lanes: scene.patchRefs.map((patch, index) => ({ id: patch.laneId, name: 'Corridor ' + (index + 1), mode: 'physical', family: source.terrainFamilies[index], worldThemeId: source.terrainFamilies[index],
      instrumentPatchId: patch.reference.patchId, instrumentRef: patch.reference, linkedThemePresetId: null,
      gain: mix.get(patch.laneId).gain, pan: mix.get(patch.laneId).pan, mute: mix.get(patch.laneId).mute, solo: mix.get(patch.laneId).solo })) });
  return freezeData({ project, settings: { ...source.settings, seed: scene.seed }, transport: { ...scene.initialTransport, playing: false }, name: scene.title, origin,
    ...(source.actorBirthAbilities ? { actorBirthAbilities: source.actorBirthAbilities } : {}), ...(source.assistPolicy ? { assistPolicy: source.assistPolicy } : {}),
    ...(source.initialReleaseGesture ? { initialReleaseGesture: source.initialReleaseGesture } : {}), ...(source.initialTerrainLayout ? { initialTerrainLayout: source.initialTerrainLayout } : {}) });
}
