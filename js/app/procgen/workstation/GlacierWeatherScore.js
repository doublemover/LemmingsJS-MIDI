import { hashData, freezeData } from '../../../core/CanonicalData.js';
import { validateSoundContentReference, resolveSoundContentReference } from '../../../midi/content/SoundContentReference.js';
import { createGlacierChoirScores } from './GlacierChoirScore.js';
import { createEmbeddedScenePatch } from './EmbeddedScenePatch.js';
import { validatePerformanceSceneRecipe } from './PerformanceSceneRecipe.js';
import { validatePerformanceScene } from './PerformanceScene.js';

const control = (id, name, parameter, minimum, maximum, value, discrete = false) => ({ id, name, mode: 'continuous', default01: (value - minimum) / (maximum - minimum), smoothingMs: discrete ? 0 : 10,
  perceptualDirection: name + ' changes the active observed-flight grain source; it creates no new onset or actor motion.', targets: [{ parameter, minimum, maximum, unit: discrete ? 'enum' : parameter === 'densityHz' ? 'Hz' : parameter === 'grainMilliseconds' ? 'ms' : 'normalized', curve: discrete ? 'step' : 'linear', composition: 'replace', clamp: true }] });
export async function createGlacierWeatherScores({ sourceHash, choirDescriptor, granularDescriptor, prepared, signal } = {}) {
  const parent = validateSoundContentReference(prepared.reference), contract = prepared.contract;
  if (contract?.transform !== 'ice-dust' || contract.pitchDeclaration?.mode !== 'pitched' || parent.definition.engineId !== 'worklet-granular' || !parent.assetHashes.includes(contract.assetHash) || parent.definition.sampleRefs.length !== 1 || parent.definition.sampleRefs[0].sha256 !== contract.assetHash || granularDescriptor?.engineId !== 'worklet-granular' || granularDescriptor.maximumVoices < 4) throw new TypeError('Prepare an exact frozen Ice Dust source with declared root and one verified PCM asset.');
  const resolved = await resolveSoundContentReference(parent, { engineDescriptors: [granularDescriptor], availableHashes: parent.assetHashes, signal }); if (resolved.status !== 'ready') throw new TypeError('The captured weather source is unavailable: ' + resolved.status);
  const base = (await createGlacierChoirScores({ sourceHash, descriptor: choirDescriptor, signal })).find(item => item.scene.id === 'glacier-choir.small-glacier-choir.dry-choir'), suffix = (await hashData({ definition: parent.definitionHash, assetHash: contract.assetHash })).slice(0, 24), rawRecipe = structuredClone(base.recipe);
  rawRecipe.id = 'score.glacier-captured.' + suffix;
  rawRecipe.initialTerrainLayout.id = 'terrain.glacier-captured';
  rawRecipe.initialTerrainLayout.lanes.forEach((lane, index) => { const edge = [64, 88, 112][index]; lane.regions[1].x2 = edge; lane.regions[2].x1 = edge; lane.regions[2].x2 = edge + 112; });
  const recipe = validatePerformanceSceneRecipe(rawRecipe), recipeHash = await hashData(recipe), results = [];
  for (const variant of ['ice-dust', 'frozen-air', 'dry-lite']) {
    signal?.throwIfAborted(); const frozen = variant === 'frozen-air', dry = variant === 'dry-lite'; let reference = base.scene.patchRefs[2].reference;
    if (!dry) {
      const definition = structuredClone(parent.definition), p = definition.parameters;
      definition.id = 'glacier.' + variant + '.' + suffix; definition.name = frozen ? 'Frozen Air · captured grain position' : 'Ice Dust · captured flight weather'; definition.tags = ['sound-seed', 'captured-weather', variant, 'flight-owned']; definition.voicePolicy = { maxVoices: 4, steal: 'reject' };
      Object.assign(p, { motionRequired: 0, position01: 0.5, densityHz: 16, grainMilliseconds: 65, spread01: 0.15, activity01: 1, tone01: 0.65, freezePosition: frozen ? 1 : 0 });
      definition.causalBindings = [{ id: 'actual-flight-world-height', sourceKind: 'MotionCommitted', payloadField: 'positionYWorldPixels', target: 'position01', unit: 'world-pixel', inputMin: 316, inputMax: 368, outputMin: 0.05, outputMax: 0.95, outputUnit: 'normalized', curve: 'linear', composition: 'replace', mode: 'continuous', smoothingMs: 10 }];
      definition.macros = [control('weather-density', 'WEATHER', 'densityHz', 8, 24, 16), control('grain-edge', 'GRAIN / EDGE', 'grainMilliseconds', 40, 90, 65), control('damp', 'DAMP', 'tone01', 0.9, 0.2, 0.65), control('position-hold', 'POSITION HOLD', 'freezePosition', 0, 1, frozen ? 1 : 0, true)];
      reference = freezeData({ ...await createEmbeddedScenePatch({ sourceHash, descriptor: granularDescriptor, definition }), assetHashes: parent.assetHashes });
    }
    const instruments = base.scene.causalMappings.instruments.filter(instrument => instrument.id !== 'glacier-support-2').map(instrument => instrument.id === 'glacier-flight-2' ? { ...instrument, role: dry ? 'dry-weather-alternative' : 'captured-flight-weather', pitchCents: dry ? instrument.pitchCents : contract.pitchDeclaration.rootCents,
        response: { ...instrument.response, landingStrike: false, terminalStrike: false, centsPerPixel: 0, maximumBendCents: 0 } } : instrument), dependencies = [...base.dependencies,
        ...(!dry ? parent.assetHashes.map(hash => ({ kind: 'asset', id: 'sha256:' + hash, revision: 1, hash, description: 'Exact captured seed PCM and source annotations; required source-rate verification and pins precede playback' })) : [])];
    const scene = validatePerformanceScene({ ...base.scene, id: 'glacier-captured.' + suffix + '.' + variant, title: 'Glacier Choir · ' + (dry ? 'Dry Lite · material-free alternative' : frozen ? 'Frozen Air · captured seed' : 'Ice Dust · captured weather'),
      description: 'The same three short descent routes and finite entrants own flight choir and intentional supported choir drones. ' + (dry ? 'The third flight uses the named material-free choir alternative. It needs no grain asset and makes no measured CPU or timbral-equivalence claim.' : frozen ? 'The third flight owns the exact prepared frozen seed. Its grain position starts held; POSITION HOLD releases or holds scanning without another onset. This is captured-seed position hold, separate from live spectral capture.' : 'The third flight scans the exact prepared captured seed using actual world-height observations. WEATHER, GRAIN / EDGE and DAMP control the active grain body; POSITION HOLD deliberately freezes its read position.') + ' The weather gate ends at landing, interruption or actor removal; grounded weather has no replenishing pad. Camera movement changes no source coordinates. For a live captured spectral hold, explicitly prepare Glass Hold on the desired lane and capture a completed actual window; that performed effect is recorded separately from the seed and note causes.',
      worldRecipeRef: { id: recipe.id, revision: recipe.revision, hash: recipeHash }, causalMappings: { ...base.scene.causalMappings, instruments }, patchRefs: base.scene.patchRefs.map((patch, index) => index === 2 ? { ...patch, reference } : patch), physicalControls: base.scene.physicalControls.filter(control => control.id !== 'color'),
      requirements: { required: dependencies, optional: [], substitutableWithNamedApproximation: [] }, expectedLandmarks: [...base.scene.expectedLandmarks.map(landmark => landmark.id === 'real-flight' ? { ...landmark, sourceObjectId: recipe.initialTerrainLayout.id } : landmark), { id: 'captured-weather', observationKind: 'FlightArcStarted', sourceObjectId: 'glacier-flight-2', consequence: dry ? 'The same real flight owns the named dry alternative.' : 'One real flight owns captured grains until that arc ends; a position hold adds zero onsets.', help: 'Select the third lane for its four source controls. Compare Dry Lite on the same route/seed, and use the saved immutable take for sound-only comparisons. POSITION HOLD never records a new live spectral window.' }] });
    results.push(freezeData({ scene, recipe, recipeHash, dependencies }));
  }
  return freezeData(results);
}
