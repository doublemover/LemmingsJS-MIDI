import { prepareSceneRehearsalLane } from './SceneRehearsalLane.js';
import { NATIVE_OFFLINE_SOURCE_IDS } from '../../midi-ui/NativeOfflineProfile.js';
import { encodeNativeOfflineRender } from '../../resources/NativeOfflineEncoding.js';
import { prepareSceneEffectRack, SCENE_EFFECT_RACK_REQUIREMENT } from './SceneEffectRack.js';
import { prepareEffectGraphRevision } from '../../../midi/content/EffectGraphRevision.js';
import { createResonatorMorphGraph } from '../../../midi/content/ResonatorMorphGraph.js';
import { travelColorationValue } from '../../../midi/content/TravelColorationRecipes.js';
import { createOwnedEffectGraphKernel } from '../../midi-ui/OwnedEffectGraphKernel.js';
import { validatePerformanceSceneRecipe } from './PerformanceSceneRecipe.js';
import { verifySceneMorphMechanism, sceneMorphMechanismCost } from './SceneMorphMechanism.js';
import { canonicalDataText, hashData, freezeData, cloneData } from '../../../core/CanonicalData.js';
import { renderCausalOwnedTake, planCausalSourceRender, encodeCausalRenderWave } from '../../midi-ui/CausalOwnedRender.js';
import { createLaneMixState } from './LaneMixState.js';

const failure = message => Object.assign(new Error(message), { name: 'PerformanceSceneError', code: 'scene-rehearsal-render-unavailable' });
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
export async function renderPerformanceSceneRehearsal(input, { descriptors, buildId, signal, isCurrent = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), maxWorkingBytes = 128 * 1048576 } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!isCurrent()) throw failure('The rehearsal execution changed.'); };
  check(); const scene = cloneData(input?.scene, { maxBytes: 1048576, maxNodes: 65536 }), source = cloneData(input?.source, { maxBytes: 8 * 1048576, maxNodes: 524288 }), rate = input?.sampleRate;
  if (!scene || scene.schema !== 'lemmings-performance-scene/v1' || !Number.isSafeInteger(scene.cost?.lanes) || scene.cost.lanes < 1 || scene.cost.lanes > 8 || ![0, 1, 2].includes(scene.cost.sharedBodies) ||
      !Array.isArray(scene.patchRefs) || scene.patchRefs.length !== scene.cost.lanes || !Array.isArray(scene.mix) || scene.mix.length !== scene.cost.lanes || !Number.isSafeInteger(scene.cost.maximumVoices) || scene.cost.maximumVoices < 1 || scene.cost.maximumVoices > 64 ||
      new Set(scene.patchRefs.map(row => row?.laneId)).size !== scene.cost.lanes || scene.patchRefs.some(row => typeof row?.laneId !== 'string' || !row.laneId.length || row.laneId.length > 128) ||
      scene.mix.some(row => !scene.patchRefs.some(patch => patch.laneId === row?.laneId) || typeof row.mute !== 'boolean' || typeof row.solo !== 'boolean') ||
      Object.keys(input).some(key => !['scene', 'sceneHash', 'source', 'sampleRate', 'recipe', 'nativeLanes'].includes(key)) || ![44100, 48000, 96000].includes(rate) ||
      scene.sourceVersion?.hash !== buildId || await hashData(scene, { maxBytes: 1048576, maxNodes: 65536 }) !== input.sceneHash || source?.schema !== 'lemmings-scene-rehearsal-source/v1' || source.sceneHash !== input.sceneHash || source.initialTick !== 0 ||
      source.seed !== scene.seed || !Number.isFinite(source.sourceTimeMs) || source.sourceTimeMs < 0 || typeof source.worldId !== 'string' || !source.worldId.length || source.worldId.length > 256 || !Number.isSafeInteger(source.generation) || source.generation < 0 ||
      !Array.isArray(source.intents) || source.intents.length > 8192 || !Number.isSafeInteger(source.ticks) || source.ticks < 1 || source.ticks > 512 || !Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0 || source.durationSeconds > 6.1 ||
      source.intents.some(intent => !Number.isSafeInteger(intent.laneId) || intent.laneId < 0 || intent.laneId >= scene.cost.lanes || intent.route !== 'local') ||
      !Number.isSafeInteger(maxWorkingBytes) || maxWorkingBytes < 64 * 1048576) throw failure('This rehearsal needs an exact installed scene, a bounded complete private source and at most eight assetless lanes.');
  const nativeLanes = input.nativeLanes ?? [];
  if (!Array.isArray(nativeLanes) || nativeLanes.length > 4 || new Set(nativeLanes.map(row => row?.sourceIndex)).size !== nativeLanes.length || nativeLanes.some(row => !row || Object.keys(row).some(key => !['sourceIndex', 'input'].includes(key)) || !Number.isSafeInteger(row.sourceIndex) || row.sourceIndex < 0 || row.sourceIndex >= scene.cost.lanes || !NATIVE_OFFLINE_SOURCE_IDS.includes(scene.patchRefs[row.sourceIndex].reference.engineRequirement.engineId) || !Array.isArray(row.input?.planes) || row.input.planes.length !== 2 || row.input.planes.some(plane => !(plane instanceof Float32Array))) || nativeLanes.reduce((bytes, row) => bytes + row.input.planes.reduce((sum, plane) => sum + plane.byteLength, 0), 0) > 32 * 1048576) throw failure('Native rehearsal PCM has an invalid or oversized complete lane inventory.');
  let bodyModel = null, bodyPlan = null, recipeHash = null, bodyRecipe = null, effects = null;
  if (scene.cost.sharedBodies) {
    if (maxWorkingBytes < 96 * 1048576) throw failure('The complete shared-body rehearsal needs at least 96 MiB of admitted workspace.');
    const recipe = bodyRecipe = validatePerformanceSceneRecipe(input.recipe); recipeHash = await hashData(recipe, { maxBytes: 131072, maxNodes: 8192 });
    if (recipeHash !== scene.worldRecipeRef.hash || recipe.id !== scene.worldRecipeRef.id || recipe.sourceHash !== buildId || recipe.settings.laneCount !== scene.cost.lanes || !recipe.initialMorphMechanism) throw failure('The shared rehearsal body needs the exact authored recipe and executing source.');
    const mechanism = await verifySceneMorphMechanism(recipe.initialMorphMechanism, scene.causalMappings.instruments); check(); if (sceneMorphMechanismCost(mechanism).bodyCount !== scene.cost.sharedBodies) throw failure('The shared body count differs from the exact prepared strategy.'); bodyModel = await createResonatorMorphGraph(mechanism, rate); bodyPlan = prepareEffectGraphRevision(bodyModel.graph, { sampleRate: rate }); check();
  } else if (input.recipe != null) {
    const recipe = validatePerformanceSceneRecipe(input.recipe); recipeHash = await hashData(recipe, { maxBytes: 131072, maxNodes: 8192 });
    if (recipeHash !== scene.worldRecipeRef.hash || recipe.id !== scene.worldRecipeRef.id || recipe.sourceHash !== buildId || recipe.settings.laneCount !== scene.cost.lanes || !recipe.initialEffectRack) throw failure('The rehearsal rack needs its exact authored recipe and executing source.');
    effects = prepareSceneEffectRack(recipe.initialEffectRack, rate); check();
  }
  if (!!effects !== scene.requirements?.required?.some(entry => entry.kind === 'renderer' && entry.id === SCENE_EFFECT_RACK_REQUIREMENT)) throw failure('The declared scene rack cannot be omitted or inserted as an unlisted mechanism.');
  const sourceHash = await hashData(source, { maxBytes: 8 * 1048576, maxNodes: 524288 }), mix = createLaneMixState(); check(); mix.synchronize(scene.mix.map(row => ({ ...row, id: row.laneId })));
  const frames = Math.ceil((source.durationSeconds + 0.5) * rate) + (bodyPlan?.maximumTailFrames || effects?.previewTailFrames || 0), left = new Float64Array(frames), right = new Float64Array(frames), lanes = []; let outputFrames = 0;
  for (let index = 0; index < scene.patchRefs.length; index++) {
    const lane = await prepareSceneRehearsalLane({ scene, source, sourceHash, buildId, sampleRate: rate, index, descriptors }), { row, reference, descriptor, intents, laneHash } = lane, state = mix.mix(row.laneId); check();
    const native = NATIVE_OFFLINE_SOURCE_IDS.includes(descriptor.engineId), preparedNative = nativeLanes.find(entry => entry.sourceIndex === index); let result;
    if (native) {
      if (!preparedNative) throw failure('This native scene lane needs its actual separately prepared OfflineAudioContext result.');
      const payload = preparedNative.input, manifest = payload.manifest, plan = await planCausalSourceRender({ ...lane.input, signal, maxPlanningBytes: maxWorkingBytes }); check();
      if (Object.keys(payload).some(key => !['mode', 'manifest', 'planes', 'firstFrame', 'endFrame', 'stemLaneIds'].includes(key)) || payload.mode !== 'causal-take' || payload.firstFrame !== 0 || payload.endFrame !== plan.outputEnd || payload.stemLaneIds?.length !== 0 || manifest?.schema !== 'lemmings-causal-audio-render/v1' || manifest.applicationBuildId !== buildId || manifest.sourceCanonicalHash !== laneHash || manifest.takeId !== plan.source.takeId || manifest.takeRevision !== plan.source.takeRevision || manifest.definitionHash !== reference.definitionHash || manifest.intentHash !== plan.intentHash || manifest.frames !== plan.outputFrames || manifest.sampleRate !== rate || manifest.timelineZeroSourceFrame !== 0 || manifest.exactEndSourceFrame !== plan.endFrame || manifest.tail?.mode !== 'boundary-release' || manifest.tail.maxSeconds !== 0.5 || manifest.effectGraph != null || manifest.nativeScheduling?.method !== 'native-offline-audio-context' || manifest.nativeScheduling.nativeSourceBackend !== descriptor.engineId || manifest.nativeScheduling.frames !== plan.outputEnd || !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => manifest.engineRequirement?.[key] === reference.engineRequirement[key])) throw failure('The native lane differs from its exact private source, engine, intent plan or completed frame interval.');
      result = await encodeNativeOfflineRender(payload, { signal, yieldControl, maxWorkingBytes: maxWorkingBytes - frames * 16 - 4 * 1048576 }); check();
    } else {
      if (preparedNative) throw failure('An owned lane cannot be replaced by unrelated native PCM.');
      result = await renderCausalOwnedTake(lane.input, { signal, yieldControl, maxWorkingBytes: maxWorkingBytes - frames * 16 - 4 * 1048576 }); check();
    }
    const file = result.files[0], count = file?.manifest.frames;
    if (result.files.length !== 1 || !Number.isSafeInteger(count) || count < 1 || count > frames || file.manifest.sampleRate !== rate || file.bytes.byteLength < 64 + count * 8) throw failure('A lane render exceeded its declared cue layout.');
    const view = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
    if (view.getUint32(52, true) !== count * 8) throw failure('The owned lane WAV layout changed.');
    const pan = state.pan, angle = (pan <= 0 ? pan + 1 : pan) * Math.PI / 2, c = Math.cos(angle), s = Math.sin(angle);
    for (let first = 0; first < count; first += 16384) {
      check(); const end = Math.min(count, first + 16384);
      for (let frame = first; frame < end; frame++) { const l = view.getFloat32(56 + frame * 8, true), r = view.getFloat32(60 + frame * 8, true);
        left[frame] += state.gain * (pan <= 0 ? l + r * c : l * c); right[frame] += state.gain * (pan <= 0 ? r * s : r + l * s); }
      await yieldControl();
    }
    outputFrames = Math.max(outputFrames, count); lanes.push({ laneId: row.laneId, sourceIndex: index, patchDefinitionHash: reference.definitionHash, sourceCanonicalHash: laneHash, intentHash: file.manifest.intentHash,
      begins: intents.filter(intent => intent.kind === 'begin').length, mix: state, frames: count, sourcePcmHash: file.manifest.pcmHash, tail: file.manifest.tail, realization: native ? { method: 'native-offline-audio-context;worker-encoded-and-mixed', nativeScheduling: file.manifest.nativeScheduling, crossBrowserBitIdentity: false } : { method: 'owned-worker-source' } });
  }
  let bodyReceipt = null;
  if (bodyModel) {
    const mechanism = bodyRecipe.initialMorphMechanism, begin = source.intents.find(intent => intent.kind === 'begin' && intent.mappingId === mechanism.instrumentId);
    if (!begin) throw failure('A shared-body rehearsal needs its actual complete matching journey source; no synthetic onset is inserted.');
    const controls = []; let lastFrame = -1, lastValue = null, ended = false;
    for (const intent of source.intents) {
      if (intent.voiceId !== begin.voiceId || intent.generation !== begin.generation || intent.mappingId !== begin.mappingId) continue;
      if (ended) throw failure('The bound journey contains a control after its source end.');
      if (!Number.isFinite(intent.scoreTime) || intent.scoreTime < source.sourceTimeMs || intent.scoreTime > source.sourceTimeMs + source.durationSeconds * 1000) throw failure('A body control lies outside the captured source clock.');
      const frame = Math.round((intent.scoreTime - source.sourceTimeMs) * rate / 1000); if (frame < lastFrame) throw failure('The body route is not in canonical source order.'); lastFrame = frame;
      if (intent.kind === 'end') { ended = true; continue; }
      const distance = intent.articulationState?.signedDistancePixels; if (!Number.isFinite(distance)) continue;
      const value = Math.fround(travelColorationValue(bodyModel.control, distance)); if (value === lastValue) continue; lastValue = value;
      controls.push({ frame, value, intentId: intent.intentId, sourceEventIds: intent.sourceEventIds, signedDistancePixels: distance });
    }
    const graph = await createOwnedEffectGraphKernel({ definition: bodyModel.graph, sampleRate: rate }), sourceFrames = outputFrames; outputFrames += bodyPlan.maximumTailFrames;
    if (outputFrames > frames) throw failure('The shared body exceeded its admitted source and tail window.'); let cursor = 0;
    for (let first = 0; first < outputFrames; first += 4096) {
      check(); const end = Math.min(outputFrames, first + 4096);
      for (let frame = first; frame < end; frame++) { while (cursor < controls.length && controls[cursor].frame <= frame) { const control = controls[cursor++]; graph.update(bodyModel.control.nodeId, { morph01: control.value }); }
        graph.sample(frame < sourceFrames ? Math.fround(left[frame]) : 0, frame < sourceFrames ? Math.fround(right[frame]) : 0); left[frame] = graph.leftSample; right[frame] = graph.rightSample; }
      await yieldControl();
    }
    const diagnostics = graph.diagnostics(), states = bodyModel.bodyCount === 2 ? diagnostics.blendBodyStates : diagnostics.pairedBodyStates, health = states[0]; if (states.length !== 1 || !health || health.faults || bodyModel.bodyCount === 2 && health.bodyCount !== 2 || cursor !== controls.length) throw failure('The shared rehearsal body faulted or omitted a physical control.');
    bodyReceipt = { ...sceneMorphMechanismCost(mechanism), graphHash: graph.hash, mapHash: bodyModel.mapHash, profileIdentity: bodyModel.profileIdentity, recipeHash, sourceVoiceId: begin.voiceId, sourceGeneration: begin.generation, instrumentId: begin.mappingId, controlCount: controls.length, controlScheduleHash: await hashData(controls, { maxBytes: 4 * 1048576, maxNodes: 262144 }), firstControlFrame: controls[0]?.frame ?? null, lastControlFrame: controls.at(-1)?.frame ?? null,
      finalMorph01: health.morph01, sourceFrames, tailFrames: bodyPlan.maximumTailFrames, tailPolicy: 'declared-maximum-body-tail-after-last-source-output;hard-owned-deadline', semanticOnsetsAdded: 0, faults: health.faults, energy: health.energy, inputWork: health.inputWork, positiveLoss: health.positiveLoss, physicalTakeEvidence: false, acousticReceipt: false };
    graph.panic(); check();
  }
  let effectReceipt = null;
  if (effects) {
    const graph = await createOwnedEffectGraphKernel({ definition: effects.rack.graph, sampleRate: rate }), sourceFrames = outputFrames; outputFrames += effects.previewTailFrames;
    if (outputFrames > frames) throw failure('The scene rack exceeded its admitted source and tail window.');
    for (let first = 0; first < outputFrames; first += 4096) {
      check(); const end = Math.min(outputFrames, first + 4096);
      for (let frame = first; frame < end; frame++) { graph.sample(frame < sourceFrames ? Math.fround(left[frame]) : 0, frame < sourceFrames ? Math.fround(right[frame]) : 0); left[frame] = graph.leftSample; right[frame] = graph.rightSample; }
      await yieldControl();
    }
    effectReceipt = { definitionHash: await hashData(effects.rack.graph, { maxBytes: 65536, maxNodes: 8192 }), graphHash: graph.hash, sourceFrames, tailFrames: effects.previewTailFrames, declaredMaximumTailFrames: effects.plan.maximumTailFrames, tailTruncatedByPreviewBound: effects.previewTailFrames < effects.plan.maximumTailFrames, tailPolicy: 'four-second-preview-bound-after-source-output;full-rack-tail-remains-explicit', controls: 'authored-static-defaults;no-replayed-throw-gestures', semanticOnsetsAdded: 0, acousticReceipt: false };
    graph.panic(); check();
  }
  const pcm = new Uint8Array(outputFrames * 8), view = new DataView(pcm.buffer); let peak = 0, squares = 0;
  for (let first = 0; first < outputFrames; first += 16384) { check(); const end = Math.min(outputFrames, first + 16384);
    for (let frame = first; frame < end; frame++) { const l = Math.fround(left[frame]), r = Math.fround(right[frame]); if (!Number.isFinite(l) || !Number.isFinite(r)) throw failure('Scene mix produced non-finite PCM.');
      view.setFloat32(frame * 8, l, true); view.setFloat32(frame * 8 + 4, r, true); peak = Math.max(peak, Math.abs(l), Math.abs(r)); squares += l * l + r * r; } await yieldControl(); }
  const manifest = freezeData({ schema: 'lemmings-scene-rehearsal-render/v1', sceneHash: input.sceneHash, sourceHash, applicationBuildId: buildId, initialTick: 0, ticks: source.ticks, sourceDurationSeconds: source.durationSeconds,
    sampleRate: rate, frames: outputFrames, channels: 2, sampleFormat: 'ieee-float32-le', pcmHash: await digest(pcm), lanes, ...(bodyReceipt ? { recipeHash, body: bodyReceipt } : {}), ...(effectReceipt ? { recipeHash, effects: effectReceipt } : {}), statistics: { peak, rms: Math.sqrt(squares / (outputFrames * 2)) },
    scope: effectReceipt ? 'new-private-world-source;authored-static-lane-mix-and-saved-delay-rack;declared-stopped-source-tail;no-replayed-live-gestures' : bodyReceipt ? (bodyReceipt.bodyCount === 2 ? 'new-private-world-source;authored-static-lane-mix;two-independent-endpoint-bodies;actual-journey-readout-MORPH;both-declared-body-tails' : 'new-private-world-source;authored-static-lane-mix;one-reviewed-shared-body;actual-journey-MORPH;declared-source-and-body-tail') : 'new-private-world-source-render;authored-static-lane-gain-and-stereo-pan;half-second-boundary-release', currentWorldAdvanced: false, nextWorldAdvanced: false, externalOutput: false,
    historicalPerformanceEvidence: false, acousticReceipt: false, renderQualification: 'not-independently-qualified' }); check();
  canonicalDataText(manifest, { maxBytes: 262144 }); return { bytes: encodeCausalRenderWave(pcm, outputFrames, rate, manifest), manifest };
}
