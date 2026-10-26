import { createGlacierChoirScores } from './GlacierChoirScore.js';
import { createRescueOrchestraScores } from './RescueOrchestraScore.js';
import { createSwitchyardScores } from './SwitchyardScore.js';
import { createDubQuarryScores } from './DubQuarryScore.js';
import { createGlassOrbitScores } from './GlassOrbitScore.js';
import { createBuilderMinerScores } from './BuilderMinerScore.js';
import { createMetamorphicBridgeScore } from './MetamorphicBridgeScore.js';
import { createWindPerformanceScore } from './WindPerformanceScore.js';
import { createFrictionPerformanceScore } from './FrictionPerformanceScore.js';
import { createAdditionalPracticeScores } from './PerformancePracticeScores.js';
import { validateReleaseGesture } from '../ReleaseGesture.js';
import { hashData, freezeData } from '../../../core/CanonicalData.js';
import { getNativeInstrumentCatalog } from '../../midi-ui/NativeInstrumentSchema.js';
import { normalizeWorkerLimits } from '../ProcgenWorkerLimits.js';
import { normalizePopulationPolicy } from '../ProcgenPopulationPolicy.js';
import { validatePerformanceScene, performanceSceneHash, sceneDependencyKey } from './PerformanceScene.js';
import { createPerformanceSceneRegistry } from './PerformanceSceneRegistry.js';
import { validatePerformanceSceneRecipe } from './PerformanceSceneRecipe.js';

// These bounded crossing/practice scores use actual actor and cohort owners.
// Larger named performances still need their authored geometry and qualification.
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
  const pluck = catalog.descriptors.find(value => value.engineId === 'worklet-pluck');
  if (pluck && pluck.maximumVoices >= 8) {
    put('engine', pluck.engineId, pluck.engineVersion, pluck.artifactHash); put('parameter-schema', pluck.engineId, pluck.engineVersion, pluck.parameterSchemaHash);
    const pickupHash = await hashData({ buildId: sourceHash, observation: 'PickupCrossing', source: 'MotionCommitted', physicalBatch: 1 }); put('physical-observation', 'PickupCrossing', 1, pickupHash);
    const pluckDefinition = { ...definition, id: 'scene.practice-pluck', name: 'Practice pickup pluck', engineId: 'worklet-pluck', parameters: { attackSeconds: 0.002, decaySeconds: 0, sustain01: 1, releaseSeconds: 0.08, gain01: 0.4, pan01: 0,
      stringT60Seconds: 0.4, bodyMix01: 0.15, bodyT60Seconds: 0.2, pluckPosition01: 0.3, excitationBrightness01: 0.5, damping01: 0.15 }, voicePolicy: { maxVoices: 4, steal: 'reject' } };
    const pluckDefinitionHash = await hashData(pluckDefinition), pluckPackHash = await hashData({ schema: 'lemmings-original-scene-patches/v1', sourceHash, definitionHash: pluckDefinitionHash }); put('patch', pluckDefinition.id, 1, pluckDefinitionHash, 'embedded');
    const pluckReference = { schema: 'lemmings-sound-reference/v1', packHash: pluckPackHash, patchId: pluckDefinition.id, revision: 1, definitionHash: pluckDefinitionHash, definition: pluckDefinition, assetHashes: [], engineRequirement: { engineId: pluck.engineId, engineVersion: pluck.engineVersion, artifactHash: pluck.artifactHash, parameterSchemaHash: pluck.parameterSchemaHash } };
    for (const practice of [
      { id: 'one-foot-one-sound', title: 'One Foot, One Sound', lanes: 1, spread: 0, paused: false, description: 'One finite entrant approaches a visible world-space pickup. Load a fresh attempt, move the pickup through Physical authoring while paused, then predict the crossing before Play. An actual crossing owns the pluck; the display and transport create no attacks.' },
      { id: 'space-becomes-rhythm', title: 'Space Becomes Rhythm', lanes: 2, spread: 12, paused: false, description: 'Two finite entrants share one world-space pickup with explicit birth phases. Their actual paths determine the arrival interval. Use Release gestures to perform a new finite phrase with changed entry spacing; no note schedule moves the actors.' },
      { id: 'quiet-control', title: 'Quiet Control · no entrants', lanes: 1, spread: 0, paused: true, description: 'Birth admission starts paused and the world contains no actors. Running transport produces no physical crossing or pluck. This is the zero-note control for the practice scores; explicitly perform a release gesture to introduce a real cause.' }
    ]) {
      const laneCount = practice.lanes, initialReleaseGesture = validateReleaseGesture({ version: 1, id: 'practice.' + practice.id, revision: 1, nominalGapTicks: 54, spreadTicks: practice.spread, lanePhase: Array.from({ length: laneCount }, (_, laneId) => ({ laneId, offsetTicks: laneId * practice.spread })),
        grouping: 'free', clockMode: 'locked', finiteBurstCount: laneCount, phaseStepTicks: 0, liveChangeBoundary: 'next-cohort', paused: practice.paused, seed: 28001 }, laneCount);
      const recipe = validatePerformanceSceneRecipe({ schema: 'lemmings-physical-score-recipe/v1', id: 'score.practice.' + practice.id, revision: 1, sourceHash, seedPolicy: 'scene-seed', initialReleaseGesture,
        settings: { laneCount, laneHeight: 96, pack: 1, speed: 3, hazardSpacing: 1024, decoration: 'none', workerLimits: normalizeWorkerLimits(), populationPolicy: normalizePopulationPolicy({ scoutsEvery: 0, spawnSpreadTicks: practice.spread }) }, terrainFamilies: Array(laneCount).fill('crystal') });
      const recipeHash = await hashData(recipe); recipes.set(recipeHash, recipe); put('score-recipe', recipe.id, 1, recipeHash, 'embedded');
      const pickupId = 'practice-pickup', causalMappings = { version: 1, revision: 1,
        pickups: [{ id: pickupId, revision: 1, worldAnchor: 'world', geometry: { kind: 'segment', points: [{ x: 96, y: 0 }, { x: 96, y: laneCount * 96 }] }, laneScope: Array.from({ length: laneCount }, (_, laneId) => laneId), trigger: 'cross', directionPolicy: 'either', hysteresis: 0, pitchMap: { mode: 'fixed', baseCents: 6000 } }],
        instruments: Array.from({ length: laneCount }, (_, laneId) => ({ id: 'practice-pluck-' + laneId, pickupId, sourceLanes: [laneId], sourceKind: 'PickupCrossing', pitchCents: 6000, velocity01: 0.55, role: 'harp', route: 'local' })) };
      const scene = validatePerformanceScene({ schema: 'lemmings-performance-scene/v1', id: 'practice.' + practice.id, version: 1, title: practice.title, description: practice.description,
        sourceVersion: { id: 'procgen-workstation-source', revision: 2, hash: sourceHash }, worldRecipeRef: { id: recipe.id, revision: 1, hash: recipeHash }, seed: 28001,
        physicalControls: [], causalMappings, patchRefs: Array.from({ length: laneCount }, (_, index) => ({ laneId: 'practice-lane-' + index, reference: pluckReference })),
        mix: Array.from({ length: laneCount }, (_, index) => ({ laneId: 'practice-lane-' + index, gain: 0.5, pan: laneCount === 1 ? 0 : index ? 48 : -48, mute: false, solo: false })),
        initialTransport: { playing: false, bpm: 120, gameSpeed: 3, speedMode: 'bpm' }, tutorialRef: null,
        expectedLandmarks: [{ id: 'pickup-crossing', observationKind: 'PickupCrossing', sourceObjectId: pickupId, consequence: practice.paused ? 'Without an entrant, no crossing or new attack exists.' : 'Each actual pickup crossing begins one owned pluck. Source end and the bounded decay retain their existing ownership.', help: 'Load starts paused. Enable local audio explicitly. Predict the next crossing; use Physical authoring to move the pickup or Release gestures to introduce new finite entrants. Rejected physical requests are not corrected automatically.' }],
        requirements: { required: [{ kind: 'physical-observation', id: 'PickupCrossing', revision: 1, hash: pickupHash, description: 'Swept world-space pickup observations derived from complete actual motion' }, { kind: 'physical-observation', id: 'MotionCommitted', revision: 1, hash: observationHash, description: 'Complete committed actor motion' }], optional: [], substitutableWithNamedApproximation: [] },
        credits: [{ name: 'LemmingsJS-MIDI', role: 'Original finite-cohort practice score and pluck', source: null }], cost: { lanes: laneCount, maximumVoices: laneCount * 4, sharedBodies: 0, estimateClass: 'authored-upper-bound-not-measured-realtime-capacity' }, mechanisms: ['crossing'], density: 'sparse', lessonLevel: practice.paused ? 0 : 1 });
      await registry.register(scene); signal?.throwIfAborted();
    }
    const lessonDefinition = { ...pluckDefinition, id: 'scene.lesson-pluck', name: 'Physical lesson pluck', macros: [{ id: 'brightness', name: 'BRIGHTNESS', mode: 'onset-only', default01: 0.5, smoothingMs: 0, perceptualDirection: 'Brighter excitation on later actual attacks.', targets: [{ parameter: 'excitationBrightness01', unit: 'normalized', minimum: 0.15, maximum: 0.85, curve: 'linear', composition: 'replace', clamp: true }] }] };
    const lessonHash = await hashData(lessonDefinition), lessonPackHash = await hashData({ schema: 'lemmings-original-scene-patches/v1', sourceHash, definitionHash: lessonHash }); put('patch', lessonDefinition.id, 1, lessonHash, 'embedded');
    const lessonReference = { ...pluckReference, patchId: lessonDefinition.id, definitionHash: lessonHash, definition: lessonDefinition, packHash: lessonPackHash };
    for (const item of await createAdditionalPracticeScores({ sourceHash, reference: lessonReference })) {
      recipes.set(item.recipeHash, item.recipe); put('score-recipe', item.recipe.id, 1, item.recipeHash, 'embedded');
      for (const dependency of item.dependencies) put(dependency.kind, dependency.id, dependency.revision, dependency.hash);
      await registry.register(item.scene); signal?.throwIfAborted();
    }
  }
  if (pluck?.maximumVoices >= 12) {
    for (const item of await createDubQuarryScores({ sourceHash, descriptor: pluck, signal })) {
      recipes.set(item.recipeHash, item.recipe); put('score-recipe', item.recipe.id, 1, item.recipeHash, 'embedded');
      for (const dependency of item.dependencies) put(dependency.kind, dependency.id, dependency.revision, dependency.hash);
      for (const patch of item.scene.patchRefs) put('patch', patch.reference.patchId, patch.reference.revision, patch.reference.definitionHash, 'embedded');
      await registry.register(item.scene); signal?.throwIfAborted();
    }
  }
  const friction = catalog.descriptors.find(value => value.engineId === 'worklet-friction');
  if (friction?.capabilities.sealedFrictionModel && friction.capabilities.canonicalFrictionTravel && friction.maximumVoices >= 2) {
    const item = await createFrictionPerformanceScore({ sourceHash, descriptor: friction }); signal?.throwIfAborted();
    recipes.set(item.recipeHash, item.recipe); put('score-recipe', item.recipe.id, 1, item.recipeHash, 'embedded');
    put('engine', friction.engineId, friction.engineVersion, friction.artifactHash); put('parameter-schema', friction.engineId, friction.engineVersion, friction.parameterSchemaHash);
    for (const dependency of item.dependencies) put(dependency.kind, dependency.id, dependency.revision, dependency.hash);
    for (const patch of item.scene.patchRefs) put('patch', patch.reference.patchId, patch.reference.revision, patch.reference.definitionHash, 'embedded');
    await registry.register(item.scene); signal?.throwIfAborted();
    for (const strategy of ['paired', 'blend']) {
      const bridge = await createMetamorphicBridgeScore({ sourceHash, descriptor: friction, strategy }); signal?.throwIfAborted(); recipes.set(bridge.recipeHash, bridge.recipe); put('score-recipe', bridge.recipe.id, 1, bridge.recipeHash, 'embedded');
      for (const dependency of bridge.dependencies) put(dependency.kind, dependency.id, dependency.revision, dependency.hash);
      for (const patch of bridge.scene.patchRefs) put('patch', patch.reference.patchId, patch.reference.revision, patch.reference.definitionHash, 'embedded');
      await registry.register(bridge.scene); signal?.throwIfAborted();
    }
  }
  const wind = catalog.descriptors.find(value => value.engineId === 'worklet-wind');
  if (wind?.capabilities.sealedWindModel && wind.capabilities.pressureDrivenWind && wind.maximumVoices >= 2) {
    const item = await createWindPerformanceScore({ sourceHash, descriptor: wind }); signal?.throwIfAborted();
    recipes.set(item.recipeHash, item.recipe); put('score-recipe', item.recipe.id, 1, item.recipeHash, 'embedded');
    put('engine', wind.engineId, wind.engineVersion, wind.artifactHash); put('parameter-schema', wind.engineId, wind.engineVersion, wind.parameterSchemaHash);
    for (const dependency of item.dependencies) put(dependency.kind, dependency.id, dependency.revision, dependency.hash);
    for (const patch of item.scene.patchRefs) put('patch', patch.reference.patchId, patch.reference.revision, patch.reference.definitionHash, 'embedded');
    await registry.register(item.scene); signal?.throwIfAborted();
  }
  const fm = catalog.descriptors.find(value => value.engineId === 'native-fm');
  if (fm?.capabilities.perVoicePitch && fm.maximumVoices >= 8) {
    put('engine', fm.engineId, fm.engineVersion, fm.artifactHash); put('parameter-schema', fm.engineId, fm.engineVersion, fm.parameterSchemaHash);
    for (const item of [...await createSwitchyardScores({ sourceHash, descriptor: fm, signal }), ...await createGlassOrbitScores({ sourceHash, descriptor: fm, signal }), ...await createBuilderMinerScores({ sourceHash, descriptor: fm, signal })]) {
      recipes.set(item.recipeHash, item.recipe); put('score-recipe', item.recipe.id, 1, item.recipeHash, 'embedded');
      for (const dependency of item.dependencies) put(dependency.kind, dependency.id, dependency.revision, dependency.hash);
      for (const patch of item.scene.patchRefs) put('patch', patch.reference.patchId, patch.reference.revision, patch.reference.definitionHash, 'embedded');
      await registry.register(item.scene); signal?.throwIfAborted();
    }
  }
  const modal = catalog.descriptors.find(value => value.engineId === 'native-modal');
  if (modal?.maximumVoices >= 8) {
    put('engine', modal.engineId, modal.engineVersion, modal.artifactHash); put('parameter-schema', modal.engineId, modal.engineVersion, modal.parameterSchemaHash);
    for (const item of await createBuilderMinerScores({ sourceHash, descriptor: modal, signal })) {
      recipes.set(item.recipeHash, item.recipe); put('score-recipe', item.recipe.id, 1, item.recipeHash, 'embedded');
      for (const dependency of item.dependencies) put(dependency.kind, dependency.id, dependency.revision, dependency.hash);
      for (const patch of item.scene.patchRefs) put('patch', patch.reference.patchId, patch.reference.revision, patch.reference.definitionHash, 'embedded');
      await registry.register(item.scene); signal?.throwIfAborted();
    }
  }
  const registerAuthoredScores = async items => {
    for (const item of items) {
      signal?.throwIfAborted(); recipes.set(item.recipeHash, item.recipe); put('score-recipe', item.recipe.id, item.recipe.revision, item.recipeHash, 'embedded');
      for (const dependency of item.dependencies) put(dependency.kind, dependency.id, dependency.revision, dependency.hash);
      for (const { reference } of item.scene.patchRefs) {
        const engine = reference.engineRequirement; put('engine', engine.engineId, engine.engineVersion, engine.artifactHash); put('parameter-schema', engine.engineId, engine.engineVersion, engine.parameterSchemaHash);
        put('patch', reference.patchId, reference.revision, reference.definitionHash, 'embedded');
      }
      await registry.register(item.scene);
    }
  };
  const choir = catalog.descriptors.find(value => value.engineId === 'worklet-choir'), spectrum = catalog.descriptors.find(value => value.engineId === 'worklet-spectrum');
  if (choir?.maximumVoices >= 4) await registerAuthoredScores(await createGlacierChoirScores({ sourceHash, descriptor: choir, spectrumDescriptor: spectrum?.maximumVoices >= 4 ? spectrum : null, signal }));
  for (const crewDescriptor of [pluck, choir, modal]) if (crewDescriptor?.maximumVoices >= (crewDescriptor.engineId === 'worklet-choir' ? 8 : 16)) await registerAuthoredScores(await createRescueOrchestraScores({ sourceHash, descriptor: crewDescriptor, signal }));
  return Object.freeze({ registry, available: true, reason: null, sourceHash,
    resolveDependency: async dependency => available.get(sceneDependencyKey(dependency)) || { status: 'unavailable', reason: 'The exact dependency is not installed in this scene catalog.' },
    getRecipe(scene) { const recipe = recipes.get(scene.worldRecipeRef.hash); if (!recipe || recipe.id !== scene.worldRecipeRef.id || recipe.revision !== scene.worldRecipeRef.revision) throw new Error('The exact physical score recipe is unavailable.'); return recipe; },
    async origin(scene, variants = []) { return freezeData({ schema: 'lemmings-performance-scene-origin/v1', manifest: scene, sceneHash: await performanceSceneHash(scene), recipe: recipes.get(scene.worldRecipeRef.hash), variants }); } });
}
