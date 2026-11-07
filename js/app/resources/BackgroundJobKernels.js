import { inspectValue, shared } from './BackgroundValueInspector.js';
import { runCanonicalSnapshotKernel } from './CanonicalSnapshotKernel.js';
import { OWNED_STRETCH_CORE } from '../../midi/content/OwnedStretchCoreIdentity.js';
import { getActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { canonicalDataText } from '../../core/CanonicalData.js';
import { yieldBackgroundTask } from './BackgroundTaskYield.js';

export { BACKGROUND_JOB_PROTOCOL, BACKGROUND_JOB_KINDS } from './BackgroundJobKinds.js';
import { BACKGROUND_JOB_KINDS, CAUSAL_SOURCE_JOB_KINDS } from './BackgroundJobKinds.js';
import { backgroundJobError as problem, checkBackgroundJob as guard, encodedLength, inspectText } from './BackgroundJsonInspector.js';
const MAX_BYTES = 64 * 1048576, MAX_NODES = 4000000;
const yieldTask = () => yieldBackgroundTask();

export async function runBackgroundJobKernel(kind, input, { signal, current, maxBytes = MAX_BYTES, estimatedPeakBytes,
  maxNodes = MAX_NODES, maxStringBytes = MAX_BYTES, maxDecodedBytes, crypto = globalThis.crypto, onProgress = () => {}, yieldControl = yieldTask, expectedInputHash = null } = {}) {
  if (!BACKGROUND_JOB_KINDS.includes(kind) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES ||
      !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 4096 || estimatedPeakBytes > 512 * 1048576 ||
      !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_NODES ||
      !Number.isSafeInteger(maxStringBytes) || maxStringBytes < 1 || maxStringBytes > MAX_BYTES ||
      expectedInputHash != null && !/^[a-f0-9]{64}$/.test(expectedInputHash)) throw problem('invalid-contract', 'Unsupported background job kernel contract.');
  guard(signal, current);
  if (kind === 'query-gesture-sounds' || kind === 'import-gesture-sound-descriptors') {
    const { queryGestureSounds } = await import('../../midi/content/GestureSoundQuery.js'); guard(signal, current); let value;
    if (kind === 'query-gesture-sounds') value = await queryGestureSounds(input, { signal, current, yieldControl });
    else {
      if (typeof input !== 'string' || input.length > 16 * 1048576) throw problem('gesture-receipt-capacity', 'Import a bounded local gesture descriptor JSON file.');
      const parsed = JSON.parse(input);
      if (parsed.schema !== 'lemmings-gesture-sound-descriptor-set/v1' || !Array.isArray(parsed.descriptors)) throw problem('gesture-receipt-schema', 'Choose a generated gesture descriptor set.');
      await queryGestureSounds({ candidates: [], descriptors: parsed.descriptors, query: { schema: 'lemmings-sound-query/v1', gesture: 'any' } }, { signal, current, yieldControl });
      value = parsed;
    }
    guard(signal, current); const encoded = canonicalDataText(value, { maxBytes, maxNodes }), retainedBytes = encoded.bytes.length * 6;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'The gesture query/descriptor result exceeds its admitted storage.');
    return { value, inputBytes: typeof input === 'string' ? new TextEncoder().encode(input).length : canonicalDataText(input, { maxBytes, maxNodes }).bytes.length, nodes: encoded.nodes, retainedBytes };
  }
  if (kind === 'analyze-timbre-tuning-set' || kind === 'compile-timbre-tuning-set') {
    const { stampTimbreTuningSet } = await import('../../midi/content/TimbreTuningSet.js'); guard(signal, current);
    const set = await stampTimbreTuningSet(input.set); guard(signal, current); let value;
    if (kind === 'analyze-timbre-tuning-set') {
      const { analyzeTimbreTuningSet } = await import('./TimbreTuningAnalysis.js');
      value = await analyzeTimbreTuningSet({ ...input, set }, { signal, current, onProgress, yieldControl });
    } else {
      const { getNativeInstrumentCatalog } = await import('../midi-ui/NativeInstrumentSchema.js'), { compileTimbreTuningSet } = await import('../../midi/content/TimbreTuningCompiler.js');
      const catalog = await getNativeInstrumentCatalog(); guard(signal, current);
      if (catalog.state !== 'bound-application-engines') throw problem('engine-identity-unbound', 'Pair preparation requires the executing immutable spectrum renderer.');
      value = await compileTimbreTuningSet(set, { descriptor: catalog.descriptors.find(entry => entry.engineId === set.renderer.engineId), sampleRate: input.sampleRate, signal });
    }
    guard(signal, current); const encoded = canonicalDataText(value, { maxBytes, maxNodes }), retainedBytes = encoded.bytes.length * 6;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'The spectrum/tuning result exceeds its admitted storage.');
    return { value, inputBytes: canonicalDataText(input, { maxBytes, maxNodes }).bytes.length, nodes: encoded.nodes, retainedBytes };
  }
  if (kind === 'physical-music-study') {
    const { runPhysicalMusicStudy } = await import('../procgen/workstation/PhysicalMusicStudy.js'); guard(signal, current);
    const study = await runPhysicalMusicStudy(input, { signal, current, estimatedPeakBytes, onProgress, yieldControl }); guard(signal, current);
    let sensitivity = null; if (study.mode === 'sensitivity') { const { summarizePhysicalMusicSensitivity } = await import('../procgen/workstation/PhysicalMusicSensitivity.js'); sensitivity = summarizePhysicalMusicSensitivity(study); }
    let comparison = null; if (study.mode === 'comparison') { const { summarizePhysicalCounterfactual } = await import('../procgen/workstation/PhysicalCounterfactual.js'); comparison = summarizePhysicalCounterfactual(study, input.comparisonPolicy || {}); }
    const value = { study, sensitivity, comparison }, size = canonicalDataText(value, { maxBytes, maxNodes }).bytes.length;
    return { value, inputBytes: canonicalDataText(input, { maxBytes, maxNodes }).bytes.length, nodes: 64, retainedBytes: size * 6 + 1048576 };
  }
  if (kind === 'encode-physical-take-midi') {
    const { encodePhysicalTakeMidi } = await import('../procgen/workstation/PhysicalTakeMidiProjection.js'); guard(signal, current);
    const value = await encodePhysicalTakeMidi(input, { signal, current, estimatedPeakBytes, onProgress, yieldControl }); guard(signal, current);
    return { value, inputBytes: new TextEncoder().encode(JSON.stringify(input)).byteLength, nodes: 64, retainedBytes: value.bytes.byteLength * 2 + 65536 };
  }
  if (kind === 'encode-recorded-ump-clip') {
    const { encodeRecordedUmpClip } = await import('../procgen/workstation/RecordedUmpClipExport.js'); guard(signal, current);
    const value = await encodeRecordedUmpClip(input, { signal, current, estimatedPeakBytes, maxBytes, crypto, onProgress, yieldControl }); guard(signal, current);
    const snapshot = input.snapshot;
    return { value, inputBytes: snapshot.beats.byteLength + snapshot.offsets.byteLength + snapshot.words.byteLength + snapshot.routes.byteLength + snapshot.sourceIndices.byteLength +
      snapshot.tempoBeats.byteLength + snapshot.tempoBpms.byteLength + snapshot.tempoIndices.byteLength + snapshot.outputEpochs.byteLength + snapshot.routeCounts.byteLength +
      new TextEncoder().encode(JSON.stringify({ attribution: snapshot.attribution, outputIds: snapshot.outputIds, window: input.window, options: input.options })).byteLength,
    nodes: 64, retainedBytes: (value.bytes.byteLength + value.manifestBytes.byteLength) * 2 + 65536 };
  }
  if (kind === 'inspect-midi-clip') {
    const { decodeMidiClipFile } = await import('../../midi/protocol/MidiClipFile.js'); guard(signal, current);
    const value = await decodeMidiClipFile(input?.bytes, { signal, current, maxBytes, estimatedPeakBytes, onProgress, yieldControl }); guard(signal, current);
    return { value: { report: value.report, ppq: value.ppq, endTick: value.endTick }, inputBytes: input.bytes.byteLength, nodes: 32, retainedBytes: 65536 };
  }
  if (kind === 'encode-midi-clip' || kind === 'decode-midi-clip') {
    const controls = { signal, current, maxBytes, estimatedPeakBytes, onProgress, yieldControl };
    const { encodeMidiClipFile, decodeMidiClipFile } = await import('../../midi/protocol/MidiClipFile.js'); guard(signal, current);
    const value = kind === 'encode-midi-clip' ? await encodeMidiClipFile(input, controls) : await decodeMidiClipFile(input?.bytes, controls); guard(signal, current);
    const columnsBytes = columns => columns.ticks.byteLength + columns.offsets.byteLength + columns.words.byteLength;
    const outputBytes = kind === 'encode-midi-clip' ? value.bytes.byteLength : columnsBytes(value.configuration) + columnsBytes(value.sequence);
    return { value, inputBytes: kind === 'encode-midi-clip' ? value.report.inputBytes : input.bytes.byteLength,
      nodes: 32, retainedBytes: outputBytes * 2 + 65536 };
  }
  if (kind === 'encode-recorded-midi') {
    const { encodeRecordedMidi } = await import('../procgen/workstation/RecordedMidiEncoding.js'); guard(signal, current);
    const value = await encodeRecordedMidi(input, { signal, current, estimatedPeakBytes, onProgress, yieldControl }); guard(signal, current);
    return { value, inputBytes: input.snapshot.count * 25 + (input.snapshot.outputEpochs?.byteLength ?? 0) + new TextEncoder().encode(JSON.stringify({ outputIds: input.snapshot.outputIds, window: input.window, options: input.options })).byteLength, nodes: 32 + input.snapshot.outputIds.length,
      retainedBytes: value.bytes.byteLength * 2 + 65536 };
  }
  if (kind === 'prepare-stretch-core-image') {
    const execution = getActiveExecutionIdentity('browser-background-jobs');
    if (execution.activeExecution !== 'bound' || input?.applicationBuildId !== execution.buildId || !input || Object.keys(input).some(key => !['wasmBytes', 'applicationBuildId', 'sampleRate', 'blockFrames', 'intervalFrames', 'randomSeed', 'maximumHeapBytes'].includes(key)) || !(input.wasmBytes instanceof Uint8Array) || input.wasmBytes.byteLength !== OWNED_STRETCH_CORE.wasmBytes || maxBytes < OWNED_STRETCH_CORE.wasmBytes + 4096 || estimatedPeakBytes < 192 * 1048576) throw problem('invalid-stretch-image-contract', 'Initial stretch images require their actual worker build, pinned bytes and complete preparation/transfer workspace.');
    let core;
    try {
      onProgress({ phase: 'preparing-empty-stretch-image' });
      const { prepareOwnedStretchCore } = await import('./OwnedStretchCore.js'); guard(signal, current);
      core = await prepareOwnedStretchCore(input.wasmBytes, { sampleRate: input.sampleRate, blockFrames: input.blockFrames, intervalFrames: input.intervalFrames, randomSeed: input.randomSeed, maximumHeapBytes: input.maximumHeapBytes, captureInitialImage: true, estimatedPeakBytes, signal, current, yieldControl }); guard(signal, current);
      const image = core.getInitialImage(), metadataBytes = canonicalDataText(image.metadata, { maxBytes: 65536, maxNodes: 4096 }).bytes.length;
      const value = Object.freeze({ ...image, applicationBuildId: execution.buildId });
      return { value, inputBytes: input.wasmBytes.byteLength + 4096, nodes: 16, retainedBytes: image.heapBytes.byteLength + image.moduleBytes.byteLength + image.metadata.compiledModuleEstimateBytes + metadataBytes * 8 + 65536 };
    } finally { core?.dispose(); }
  }
  if (kind === 'prepare-streaming-warp-material') {
    const execution = getActiveExecutionIdentity('browser-background-jobs');
    if (execution.activeExecution !== 'bound' || input?.applicationBuildId !== execution.buildId || estimatedPeakBytes < 256 * 1048576) throw problem('invalid-streaming-material-contract', 'Streaming warp preparation needs its immutable producing worker and complete admitted overlap.');
    const { prepareStreamingWarpMaterial } = await import('./StreamingWarpMaterial.js'); guard(signal, current);
    const value = await prepareStreamingWarpMaterial(input, { applicationBuildId: execution.buildId, estimatedPeakBytes, signal, current, yieldControl, onProgress }); guard(signal, current);
    const retainedBytes = value.image.heapBytes.byteLength + value.image.moduleBytes.byteLength + value.image.metadata.compiledModuleEstimateBytes + value.pcm.planes.reduce((sum, plane) => sum + plane.byteLength, 0) + 1048576;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'The shared streaming material exceeds its retained image/PCM reservation.');
    return { value, inputBytes: (input.mode === 'instrument-patch' ? input.pcm.descriptor.bytes : input.pcm.byteLength + input.originBytes.byteLength) + input.wasmBytes.byteLength + 16384, nodes: 256, retainedBytes };
  }
  if (kind === 'qualify-original-shape-refinement') {
    const execution = getActiveExecutionIdentity('browser-background-jobs');
    if (execution.activeExecution !== 'bound' || input?.comparisonBuildHash !== execution.buildId || Object.keys(input).some(key => !['shapeId', 'profileId', 'comparisonBuildHash', 'expectedCoarseAssetHash'].includes(key)) || estimatedPeakBytes < 128 * 1048576) throw problem('engine-identity-unbound', 'Refinement comparison requires its actual bound worker and two complete admitted solves.');
    const metadata = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 4096), maxNodes: 128 });
    const { solveOriginalShapeRefinement } = await import('./ShapeBodyRefinement.js'); guard(signal, current);
    const result = await solveOriginalShapeRefinement({ ...input, solverBuildHash: execution.buildId }, { signal, current, yieldControl, onProgress, estimatedPeakBytes }); guard(signal, current);
    const retainedBytes = canonicalDataText(result.receipt, { maxBytes: 262144, maxNodes: 16384 }).bytes.length * 8;
    return { value: result.receipt, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'build-shape-body-content') {
    const execution = getActiveExecutionIdentity('browser-background-jobs');
    if (execution.activeExecution !== 'bound' || input?.solverBuildHash !== execution.buildId || estimatedPeakBytes < 128 * 1048576 || Object.keys(input).some(key => !['source', 'solverBuildHash', 'modeCount', 'sampleRate', 'seconds', 'fieldKind', 'lossKind'].includes(key))) throw problem('engine-identity-unbound', 'Foundry content requires the actual worker build and its complete solve/calibration/compilation reservation.');
    if (!['edge', 'surface'].includes(input.fieldKind ?? 'edge') || !['diagonal', 'point'].includes(input.lossKind ?? 'diagonal')) throw problem('invalid-shape-preparation', 'Choose an explicit supported bar observation and loss model before solving.');
    const metadata = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 262144), maxNodes: 16384 }), options = { signal, current, estimatedPeakBytes, yieldControl, onProgress };
    const { solveShapeBody } = await import('./ShapeBodySolver.js'); guard(signal, current);
    const { renderShapeBodyCalibration } = await import('./ShapeBodyCalibration.js'); guard(signal, current);
    const asset = await solveShapeBody({ source: input.source, solverBuildHash: execution.buildId }, options), calibration = await renderShapeBodyCalibration({ asset, modeCount: input.modeCount, sampleRate: input.sampleRate, seconds: input.seconds }, options); guard(signal, current);
    const { createShapeBodyEdgeField } = await import('./ShapeBodyEdgeField.js'); guard(signal, current);
    const sharedBody = await createShapeBodyEdgeField(asset, { ...options, sampleRate: input.sampleRate, fieldKind: input.fieldKind ?? 'edge', lossKind: input.lossKind ?? 'diagonal' }); guard(signal, current);
    const { createShapeBodyRecipe } = await import('../../midi/content/ShapeBodyRecipe.js'); guard(signal, current);
    const { getNativeInstrumentCatalog } = await import('../midi-ui/NativeInstrumentSchema.js'); guard(signal, current);
    const recipe = await createShapeBodyRecipe({ asset, calibration, edgeField: sharedBody }), catalog = await getNativeInstrumentCatalog(); guard(signal, current);
    if (catalog.state !== 'bound-application-engines' || catalog.executionIdentity.buildId !== execution.buildId) throw problem('engine-identity-unbound', 'The foundry compiler differs from its executing worker.');
    const { compileSoundContent } = await import('../../midi/content/SoundContentCompiler.js'); guard(signal, current);
    const compiled = await compileSoundContent(recipe.source, { targets: catalog.descriptors.map(descriptor => ({ descriptor })), signal }); guard(signal, current);
    const value = { prepared: compiled.prepared, contents: recipe.contents, receipt: recipe.receipt, sharedBody, overview: { id: asset.id, assetHash: asset.assetHash, meshHash: asset.meshHash, sourceHash: asset.sourceHash, solver: asset.solver, validation: asset.validation, modeCount: input.modeCount, sampleRate: input.sampleRate, seconds: input.seconds,
      sites: asset.source.excitationSites, pickupSites: asset.source.pickupSites, tier: { modeIndices: calibration.files[0].manifest.modeIndices, retainedSalience01: calibration.files[0].manifest.tier.retainedSalience01 } } };
    const retainedBytes = recipe.contents.reduce((sum, file) => sum + file.bytes.byteLength * 3 + 65536, 8 * 1048576) + canonicalDataText(sharedBody, { maxBytes: 524288, maxNodes: 32768 }).bytes.length * 8;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Foundry generated material exceeds its complete result reservation.');
    return { value, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes };
  }
  if (['solve-shape-body', 'render-shape-body-calibration'].includes(kind)) {
    const execution = getActiveExecutionIdentity('browser-background-jobs');
    if (execution.activeExecution !== 'bound' || kind === 'solve-shape-body' && input?.solverBuildHash !== execution.buildId) throw problem('engine-identity-unbound', 'Foundry jobs require their actual immutable worker build; a requested solver hash cannot attest execution.');
    const metadata = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 3 * 1048576), maxNodes: 150000 });
    const { solveShapeBody } = await import('./ShapeBodySolver.js'); guard(signal, current);
    const { renderShapeBodyCalibration } = await import('./ShapeBodyCalibration.js'); guard(signal, current);
    const value = await (kind === 'solve-shape-body' ? solveShapeBody : renderShapeBodyCalibration)(input, { signal, current, estimatedPeakBytes, yieldControl, onProgress }); guard(signal, current);
    const retainedBytes = kind === 'solve-shape-body' ? canonicalDataText(value, { maxBytes: 2 * 1048576, maxNodes: 131072 }).bytes.length * 4 + 65536 : value.files.reduce((sum, file) => sum + file.bytes.byteLength * 2 + 262144, 1048576);
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Foundry output exceeds its complete retained reservation.');
    return { value, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'analyze-native-impulse') {
    const { analyzeImpulseResponse } = await import('./ImpulseResponseAnalysis.js'); guard(signal, current);
    const value = await analyzeImpulseResponse(input, { signal, current, yieldControl, crypto, estimatedPeakBytes }); guard(signal, current);
    const metadata = canonicalDataText({ ...input, planes: undefined }, { maxBytes: 65536, maxNodes: 4096, domain: 'Impulse analysis source metadata' });
    const inputBytes = value.bytes + metadata.bytes.byteLength; if (inputBytes > maxBytes) throw problem('input-capacity', 'Impulse source exceeds its job byte bound.');
    return { value, inputBytes, nodes: metadata.nodes + input.planes.length, retainedBytes: 65536 };
  }
  if (kind === 'derive-resonator-endpoint') {
    const metadata = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 4 * 1048576 + 65536), maxNodes: Math.min(maxNodes, 131072), domain: 'Derived resonator endpoint source' });
    if (estimatedPeakBytes < metadata.bytes.length * 32 + 32 * 1048576) throw problem('workspace-capacity', 'Complete endpoint/source verification workspace is not admitted.');
    const { deriveResonatorEndpoint } = await import('../../midi/content/ResonatorEndpointAdapters.js'); guard(signal, current);
    const value = await deriveResonatorEndpoint(input, { signal, current, yieldControl }); guard(signal, current); const encoded = canonicalDataText(value, { maxBytes: 131072, maxNodes: 16384 });
    return { value, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes: encoded.bytes.length * 32 + 131072 };
  }
  if (kind === 'render-resonator-morph-reference') {
    const metadata = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 262144), maxNodes: Math.min(maxNodes, 32768), domain: 'Paired modal body reference' });
    const { renderResonatorMorphReference } = await import('./ResonatorMorphReference.js'); guard(signal, current);
    const value = await renderResonatorMorphReference(input, { signal, current, yieldControl, onProgress, estimatedPeakBytes }); guard(signal, current);
    return { value, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes: value.bytes.byteLength + canonicalDataText(value.manifest).bytes.length * 32 + 131072 };
  }
  if (kind === 'analyze-resonator-morph') {
    const metadata = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 262144), maxNodes: Math.min(maxNodes, 32768), domain: 'Resonator correspondence source' });
    if (estimatedPeakBytes < metadata.bytes.length * 32 + 262144) throw problem('workspace-capacity', 'The modal correspondence workspace is not admitted.');
    const { analyzeResonatorMorph } = await import('../../midi/content/ResonatorMorph.js'); guard(signal, current);
    const value = await analyzeResonatorMorph(input, { signal, current, yieldControl, onProgress }); guard(signal, current);
    const encoded = canonicalDataText(value, { maxBytes: 262144, maxNodes: 32768 });
    return { value, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes: encoded.bytes.length * 32 + 131072 };
  }
  if (kind === 'compile-scene-terrain') {
    const metadata = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 131072), maxNodes: Math.min(maxNodes, 16384), domain: 'Authored scene terrain' });
    const { compileSceneTerrainLayout } = await import('../procgen/SceneTerrainLayout.js'); guard(signal, current);
    const value = await compileSceneTerrainLayout(input, { signal, current, crypto, estimatedPeakBytes, yieldControl, onProgress }); guard(signal, current);
    return { value, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes: value.bytes + metadata.bytes.length * 32 + 131072 };
  }
  if (kind === 'compose-sound-seed-components') {
    const metadata = canonicalDataText({ ...input, pcm: null, originBytes: null, componentInputs: input?.componentInputs?.map(value => ({ ...value, pcm: null, originBytes: null })) }, { maxBytes: 65536, maxNodes: 8192 });
    const bytes = (input?.pcm?.byteLength || 0) + (input?.originBytes?.byteLength || 0) + metadata.bytes.length + (input?.componentInputs || []).reduce((sum, value) => sum + (value?.pcm?.byteLength || 0) + (value?.originBytes?.byteLength || 0), 0);
    if (bytes > maxBytes) throw problem('input-capacity', 'The component windows exceed their admitted composition workspace.');
    const { composeSeedComponents } = await import('./SeedComponentComposition.js'); guard(signal, current);
    const result = await composeSeedComponents(input, { signal, current, estimatedPeakBytes, yieldControl, onProgress }); return { ...result, inputBytes: bytes };
  }
  if (kind === 'warp-sound-seed') {
    const metadata = canonicalDataText({ ...input, pcm: null, originBytes: null, wasmBytes: null }, { maxBytes: 65536, maxNodes: 8192 }), inputBytes = metadata.bytes.length + (input?.pcm?.byteLength || 0) + (input?.originBytes?.byteLength || 0) + (input?.wasmBytes?.byteLength || 0);
    if (inputBytes > maxBytes || estimatedPeakBytes < 128 * 1048576) throw problem('input-capacity', 'A finite seed warp needs its complete source/core and 128 MiB workspace.');
    const { bakeSeedWarp } = await import('./SeedWarpBake.js'); guard(signal, current);
    const baked = await bakeSeedWarp(input, { estimatedPeakBytes, signal, current, yieldControl, onProgress }); guard(signal, current);
    const value = { schema: 'lemmings-seed-warp-result/v1', generation: input.generation, recipe: baked.recipe, recipeHash: baked.recipeHash, components: [{ kind: 'warped-seed', bytes: baked.bytes, assetHash: baked.assetHash, manifest: baked.manifest, waveform: baked.waveform }] };
    return { value, inputBytes, nodes: metadata.nodes, retainedBytes: baked.bytes.byteLength + baked.waveform.minMax.byteLength + canonicalDataText({ manifest: baked.manifest, recipe: baked.recipe }, { maxBytes: 524288, maxNodes: 65536 }).bytes.length * 32 + 131072 };
  }
  if (['analyze-sound-seed-window', 'decompose-sound-seed', 'fit-sound-seed-modes'].includes(kind)) {
    const metadata = canonicalDataText({ ...input, pcm: null, originBytes: null }, { maxBytes: 65536, maxNodes: 8192 });
    const bytes = (input?.pcm?.byteLength || 0) + (input?.originBytes?.byteLength || 0) + metadata.bytes.length;
    if (bytes > maxBytes) throw problem('input-capacity', 'The selected seed window exceeds its admitted source workspace.');
    const { fitSoundSeedModes } = await import('./SeedModalFit.js'); guard(signal, current);
    const { decomposeSoundSeed } = await import('./SeedDecomposition.js'); guard(signal, current);
    const { analyzeSoundSeedWindow } = await import('./SoundSeedWindowAnalysis.js'); guard(signal, current);
    return (kind === 'fit-sound-seed-modes' ? fitSoundSeedModes : kind === 'decompose-sound-seed' ? decomposeSoundSeed : analyzeSoundSeedWindow)(input, { signal, current, estimatedPeakBytes, yieldControl, onProgress });
  }
  if (kind === 'bake-finite-fm-exciter') {
    const metadata = canonicalDataText(input, { maxBytes: 262144, maxNodes: 32768 });
    if (metadata.bytes.length > maxBytes) throw problem('input-capacity', 'Finite FM ancestry exceeds its admitted input.');
    const { bakeFiniteFmExcitation } = await import('./FiniteFmExcitation.js'); guard(signal, current);
    const value = await bakeFiniteFmExcitation(input, { signal, current, yieldControl, estimatedPeakBytes }); guard(signal, current);
    return { value, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes: value.bytes.byteLength + value.waveform.minMax.byteLength + canonicalDataText(value.manifest, { maxBytes: 262144, maxNodes: 32768 }).bytes.length * 16 + 131072 };
  }
  if (kind === 'decode-wave-source') {
    const { decodeWaveSource } = await import('./WaveSourceDecode.js'); guard(signal, current);
    return decodeWaveSource(input, { signal, current, maxBytes, estimatedPeakBytes, crypto, yieldControl });
  }
  if (kind === 'generate-procedural-sound' || kind === 'load-bundled-sound') {
    if (!input || Object.keys(input).length !== 1 || typeof input.id !== 'string') throw problem('invalid-contract', 'Invalid bundled sound request.');
    const { getBundledSoundById } = await import('../../midi/content/BundledSoundMaterial.js'); guard(signal, current);
    const expected = getBundledSoundById(input.id);
    if (kind === 'generate-procedural-sound' && expected.materialType === 'recording') throw problem('invalid-contract', 'A recording is not a procedural generator.');
    if (estimatedPeakBytes < 16 * 1048576 || maxBytes < expected.bytes) throw problem('memory-capacity', 'Bundled material needs its worker startup and copy reservation.');
    const { loadBundledSoundSource } = await import('../../midi/content/BundledSoundSources.js'); guard(signal, current);
    const { inspectWaveContainer } = await import('../midi-ui/AudioAssetRef.js'); guard(signal, current);
    const bytes = await loadBundledSoundSource(expected, { signal }); guard(signal, current);
    const format = inspectWaveContainer(bytes, { maxChannels: expected.kind === 'impulse-response' ? 4 : 2 });
    const digest = await crypto.subtle.digest('SHA-256', bytes); guard(signal, current);
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== expected.sha256 || bytes.byteLength !== expected.bytes || format.frames !== expected.frames || format.channels !== expected.channels || format.sampleRate !== expected.sampleRate)
      throw problem('content-mismatch', 'Bundled material differs from its immutable source identity.');
    return { value: { id: expected.id, hash, bytes }, inputBytes: 128, nodes: 16, retainedBytes: expected.bytes + 16384 };
  }
  if (kind === 'inspect-wave-asset') {
    if (!input || Object.keys(input).some(key => !['bytes', 'contentHash', 'assetKind'].includes(key)) || !/^[a-f0-9]{64}$/.test(input.contentHash) ||
        !(input.bytes instanceof Uint8Array) || shared(input.bytes) || input.bytes.byteLength > maxBytes || input.bytes.byteLength * 8 + 1048576 > estimatedPeakBytes)
      throw problem('invalid-contract', 'WAV inspection requires immutable bytes and their expected hash.');
    if (input.assetKind != null && !['sample', 'impulse-response'].includes(input.assetKind)) throw problem('invalid-contract', 'Unknown native WAV asset kind.');
    const { inspectWaveContainer } = await import('../midi-ui/AudioAssetRef.js'); guard(signal, current);
    const format = inspectWaveContainer(input.bytes, { contentHash: input.contentHash, maxBytes, maxChannels: input.assetKind === 'impulse-response' ? 4 : 2 });
    const digest = await crypto.subtle.digest('SHA-256', input.bytes); guard(signal, current);
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== input.contentHash) throw problem('content-mismatch', 'WAV bytes differ from their immutable reference.');
    if (format.encoding === 3) {
      const view = new DataView(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
      for (let index = 0; index < format.dataBytes; index += 4) {
        const value = view.getFloat32(format.dataOffset + index, true);
        if (!Number.isFinite(value) || Math.abs(value) > 16) throw problem('invalid-data', 'Float WAV has nonfinite or excessive source samples.');
        if ((index & 65535) === 65532) { guard(signal, current); await yieldControl(); }
      }
    }
    return { value: { contentHash: hash, bytes: input.bytes.byteLength, channels: format.channels, sourceSampleRate: format.sampleRate, frames: format.frames,
      encoding: format.encoding, bits: format.bits, verifiedContainer: format.verifiedContainer }, inputBytes: input.bytes.byteLength, nodes: 16, retainedBytes: 4096 };
  }
  if (kind === 'prepare-owned-source-bank') {
    if (!input || Object.keys(input).length !== 1 || typeof input.id !== 'string') throw problem('invalid-contract', 'Invalid fixed source bank request.');
    const { getOwnedSourceBankIdentity } = await import('../midi-ui/OwnedSourceBank.js'); guard(signal, current);
    const expected = getOwnedSourceBankIdentity(input.id);
    if (estimatedPeakBytes < (input.id === 'sample-read-v1' ? 24 : 16) * 1048576 || maxBytes < expected.bytes) throw problem('memory-capacity', 'Fixed bank preparation needs its worker startup and copy reservation.');
    const { computeOwnedSourceBank } = await import('./OwnedSourceBankComputation.js'); guard(signal, current);
    const value = await computeOwnedSourceBank(input.id, { signal, current, crypto, yieldControl });
    return { value, inputBytes: 128, nodes: 16, retainedBytes: expected.bytes + 16384 };
  }
  if (kind === 'asset-decode') {
    const { decodeGroundAssetSnapshot } = await import('./GroundAssetDecode.js'); guard(signal, current);
    return decodeGroundAssetSnapshot(input, { signal, current, maxBytes, estimatedPeakBytes, maxDecodedBytes, crypto, onProgress, yieldControl });
  }
  if (expectedInputHash != null || kind === 'asset-hash') {
    if (shared(input)) throw problem('shared-live-input', 'Background hash input cannot refer to shared live memory.');
    if (typeof input !== 'string' && !(input instanceof ArrayBuffer) && !ArrayBuffer.isView(input)) throw problem('invalid-data', 'Hash jobs require immutable byte or text input.');
    const count = typeof input === 'string' ? encodedLength(input) : input.byteLength;
    if (count > maxBytes || count * 6 > estimatedPeakBytes) throw problem('memory-capacity', 'Hash input exceeds the admitted byte bound.');
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    const result = await crypto.subtle.digest('SHA-256', bytes); guard(signal, current);
    const hash = [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (expectedInputHash != null && expectedInputHash !== hash) throw problem('content-mismatch', 'Background job input differs from its content reference.');
    if (kind === 'asset-hash') return { value: hash, inputBytes: count, nodes: 1 };
  }
  const options = { maxBytes, maxNodes, maxStringBytes, estimatedPeakBytes, signal, current, onProgress, yieldControl };
  if (CAUSAL_SOURCE_JOB_KINDS.includes(kind)) {
    const { runCausalSourceKernel } = await import('./CausalSourceKernels.js'); guard(signal, current);
    return runCausalSourceKernel(kind, input, { ...options, crypto, expectedInputHash });
  }
  if (kind === 'parse-json' || kind === 'inspect-causal-archive-entry') {
    const metadata = await inspectText(input, options); guard(signal, current);
    let value = JSON.parse(input); guard(signal, current);
    if (kind === 'inspect-causal-archive-entry') {
      const { inspectCausalArchiveEntry } = await import('../procgen/workstation/CausalArchiveEntry.js'); guard(signal, current);
      value = await inspectCausalArchiveEntry(value, { signal, parse: async text => {
        await inspectText(text, options); guard(signal, current); const parsed = JSON.parse(text); guard(signal, current); return parsed;
      }, hash: async text => {
        const counted = encodedLength(text); if (counted > maxBytes) throw problem('input-capacity', 'Causal archive source exceeds its admitted byte bound.');
        const encoded = new TextEncoder().encode(text), digest = await crypto.subtle.digest('SHA-256', encoded); guard(signal, current);
        return { hash: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''), bytes: counted };
      } });
      const retainedBytes = canonicalDataText(value, { maxBytes: Math.min(maxBytes, 8 * 1048576), maxNodes }).bytes.byteLength * 4;
      if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Causal archive inspection result exceeds its admitted representation bound.');
      return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
    }
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes };
  }
  if (kind === 'snapshot-canonical-data') return runCanonicalSnapshotKernel(kind, input, options);
  const metadata = await inspectValue(input, options, { allowBinary: ['finalize-causal-realtime-print', 'render-causal-owned-image', 'owned-audio-image', 'prepare-owned-effect-cut', 'prepare-owned-source-cut', 'decode-recovery-page', 'recovery-checksum', 'render-sound-controls', 'render-causal-sine-take', 'render-causal-source-pcm', 'encode-native-render', 'render-scene-rehearsal'].includes(kind) });
  if (kind === 'encode-causal-checkpoint') {
    const encoded = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 32 * 1048576), maxNodes }); guard(signal, current);
    if (encoded.bytes.length * 4 + encoded.nodes * 96 + metadata.bytes * 2 > estimatedPeakBytes) throw problem('checkpoint-capacity', 'The canonical checkpoint exceeds its admitted encoding/hash overlap.');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoded.bytes))].map(byte => byte.toString(16).padStart(2, '0')).join(''); guard(signal, current);
    const value = { schema: 'lemmings-canonical-checkpoint-encoding/v1', canonical: encoded.text, hash, bytes: encoded.bytes.length, nodes: encoded.nodes, method: 'dedicated-worker-canonical-encoding' };
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes: encoded.text.length * 2 + 4096 };
  }
  if (kind === 'encode-preference-pages') {
    if (!Array.isArray(input) || input.length < 1 || input.length > 8) throw problem('invalid-data', 'Preference encoding needs one to eight owned pages.');
    const value = []; let retainedBytes = 4096;
    for (const page of input) {
      if (!page || Object.keys(page).some(key => !['value', 'maxBytes'].includes(key)) || !Number.isSafeInteger(page.maxBytes) || page.maxBytes < 1 || page.maxBytes > 16 * 1048576) throw problem('invalid-data', 'Invalid preference page boundary.');
      const text = JSON.stringify(page.value); if (typeof text !== 'string' || encodedLength(text) > page.maxBytes) throw problem('output-capacity', 'Preference page exceeds its byte bound.');
      retainedBytes += text.length * 2 + 64; if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Preference encoding exceeds its retained capacity.');
      value.push(text); guard(signal, current);
    }
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'build-circuit-workshop') {
    if (!input || Object.keys(input).some(key => !['variant', 'applicationBuildId'].includes(key)) || typeof input.variant !== 'string' || !/^[a-f0-9]{64}$/.test(input.applicationBuildId || '') || estimatedPeakBytes < 128 * 1048576) throw problem('invalid-contract', 'Original kit preparation needs its exact application, named variant and complete worker overlap.');
    const { getNativeInstrumentCatalog } = await import('../midi-ui/NativeInstrumentSchema.js'); guard(signal, current);
    const catalog = await getNativeInstrumentCatalog(); guard(signal, current);
    if (catalog.state !== 'bound-application-engines' || catalog.executionIdentity?.buildId !== input.applicationBuildId) throw problem('engine-identity-unbound', 'The original kit producer differs from the requested application build.');
    const { buildCircuitWorkshop } = await import('./CircuitWorkshopBuilder.js'); guard(signal, current);
    const value = await buildCircuitWorkshop({ variant: input.variant }, { descriptors: catalog.descriptors, applicationBuildId: catalog.executionIdentity.buildId, estimatedPeakBytes, signal, current, yieldControl, onProgress }); guard(signal, current);
    const representation = canonicalDataText({ pack: value.pack, kit: value.kit, contentHash: value.contentHash, kitHash: value.kitHash, contractHash: value.contractHash, qualification: value.qualification }, { maxBytes: 4 * 1048576, maxNodes: 131072 }).bytes.length,
      retainedBytes = value.assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0) * 2 + representation * 8 + 1048576;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'The prepared original kit exceeds its admitted output representation.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'encode-recovery-page' || kind === 'decode-recovery-page') {
    let value;
    try {
      const { encodeProcgenRecoveryPage, decodeProcgenRecoveryPage } = await import('../procgen/workstation/ProcgenRecoveryPageCodec.js'); guard(signal, current);
      value = kind === 'encode-recovery-page' ? await encodeProcgenRecoveryPage(input, { maxBytes, signal }) : await decodeProcgenRecoveryPage(input, { maxBytes, signal }); }
    catch (error) { signal?.throwIfAborted(); throw problem('invalid-data', error.message); }
    guard(signal, current);
    const output = kind === 'decode-recovery-page' ? await inspectValue(value, options) : null;
    const retainedBytes = kind === 'encode-recovery-page' ? value.bytes.byteLength * 2 + 4096 : output.bytes * 2 + output.nodes * 64;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Recovery output exceeds its admitted peak.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'encode-native-render') {
    if (!input || Object.keys(input).some(key => !['mode', 'manifest', 'planes', 'firstFrame', 'endFrame', 'stemLaneIds'].includes(key)) ||
        metadata.bytes * 4 + 16 * 1048576 > estimatedPeakBytes) throw problem('invalid-contract', 'Native encoding requires its admitted PCM and representation overlap.');
    const { getNativeInstrumentCatalog } = await import('../midi-ui/NativeInstrumentSchema.js'); guard(signal, current);
    const catalog = await getNativeInstrumentCatalog(), requirement = input.manifest?.engineRequirement;
    const descriptor = catalog.descriptors.find(engine => engine.engineId === requirement?.engineId); guard(signal, current);
    if (catalog.state !== 'bound-application-engines' || !descriptor || !(['native-oscillator', 'native-fm', 'native-modal', 'native-sample'].includes(descriptor.engineId) || ['causal-take', 'scene-native-rack'].includes(input.mode) && ['worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-sample', 'worklet-seed-layers'].includes(descriptor.engineId)) ||
        !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => requirement?.[key] === descriptor[key]) || input.manifest.applicationBuildId !== catalog.executionIdentity.buildId)
      throw problem('engine-identity-unbound', 'Native encoding requires the same immutable application and source artifact.');
    if (input.manifest.nativeScheduling?.effectGraph || input.manifest.effectGraph?.definition?.nodes?.some(node => node.kind === 'convolution-native')) {
      const host = input.manifest.nativeScheduling?.effectGraph?.realization?.runtime;
      if (host?.activeExecution !== 'bound' || host.applicationBuildId !== catalog.executionIdentity.buildId || host.hostRevision !== 'owned-native-effect-host-v2')
        throw problem('engine-identity-unbound', 'Native effect preparation must execute the same immutable application as its encoding worker.');
    }
    const { encodeNativeOfflineRender } = await import('./NativeOfflineEncoding.js'); guard(signal, current);
    const value = await encodeNativeOfflineRender(input, { signal, yieldControl, onProgress, maxWorkingBytes: estimatedPeakBytes }); guard(signal, current);
    const retainedBytes = value.files ? value.files.reduce((sum, file) => sum + file.bytes.byteLength * 2 + 262144, 262144) : value.bytes.byteLength * 2 + 262144;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Native encoded files exceed their admitted retained storage.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'finalize-causal-realtime-print') {
    if (!input || Object.keys(input).some(key => !['bytes', 'manifest'].includes(key)) || !(input.bytes instanceof Uint8Array) || estimatedPeakBytes < metadata.bytes * 5 + 16 * 1048576) throw problem('invalid-contract', 'Real-time print finalization needs its actual captured WAV and admitted PCM/encoding overlap.');
    const { getNativeInstrumentCatalog } = await import('../midi-ui/NativeInstrumentSchema.js'); const catalog = await getNativeInstrumentCatalog(); guard(signal,current);
    const { finalizeCausalRealtimePrint } = await import('../midi-ui/CausalRealtimePrintFinalize.js');
    const value = await finalizeCausalRealtimePrint(input, { signal, current, yieldControl, applicationBuildId: catalog.executionIdentity.buildId }); guard(signal,current);
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes: value.files[0].bytes.byteLength + 262144 };
  }
  if (kind === 'render-causal-owned-image') {
    if (!input || Object.keys(input).some(key => !['checkpoint', 'source', 'materials', 'startSeconds', 'endSeconds', 'includeRack', 'includeStems', 'stemLaneIds', 'includeAllLaneStems'].includes(key))) throw problem('invalid-contract', 'Captured owned image rendering requires its complete checkpoint, source commands and immutable materials.');
    const footprint = metadata.bytes * 4 + metadata.nodes * 128;
    if (estimatedPeakBytes < footprint + 64 * 1048576) throw problem('memory-capacity', 'The image/command input and actual restoration workspace exceed their admitted profile.');
    const { getNativeInstrumentCatalog } = await import('../midi-ui/NativeInstrumentSchema.js'); const catalog = await getNativeInstrumentCatalog(); guard(signal, current);
    if (catalog.state !== 'bound-application-engines') throw problem('engine-identity-unbound', 'Captured image rendering requires its exact executing application build.');
    const { renderCausalOwnedImage } = await import('../midi-ui/CausalOwnedImageRender.js');
    const value = await renderCausalOwnedImage(input, { signal, current, yieldControl, onProgress, applicationBuildId: catalog.executionIdentity.buildId, descriptors: catalog.descriptors, maxWorkingBytes: estimatedPeakBytes - footprint }); guard(signal, current);
    const retainedBytes = value.files.reduce((sum, file) => sum + file.bytes.byteLength * 2 + 262144, 262144);
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'The captured image render exceeds its retained artifact profile.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'owned-audio-image') {
    const { getNativeInstrumentCatalog } = await import('../midi-ui/NativeInstrumentSchema.js'); guard(signal, current); const catalog = await getNativeInstrumentCatalog(); guard(signal, current);
    const footprint = metadata.bytes * 3 + metadata.nodes * 128;
    if (catalog.state !== 'bound-application-engines' || estimatedPeakBytes < footprint + 96 * 1048576 || !['encode', 'decode', 'decode-checkpoint', 'inspect', 'inspect-checkpoint'].includes(input?.mode)) throw problem('invalid-audio-image-contract', 'A portable audio image needs the complete admitted input and exact executing engine inventory.');
    const { encodeOwnedAudioImage, decodeOwnedAudioImage } = await import('./OwnedAudioImageCodec.js'); guard(signal, current);
    const codecOptions = { applicationBuildId: catalog.executionIdentity.buildId, descriptors: catalog.descriptors, signal, current, yieldControl, maxWorkingBytes: estimatedPeakBytes - footprint };
    const value = await (input.mode === 'encode' ? encodeOwnedAudioImage : decodeOwnedAudioImage)(input, codecOptions); guard(signal, current);
    const output = await inspectValue(value, options, { allowBinary: true }), retainedBytes = output.bytes * 2 + output.nodes * 128 + 262144;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'The audio image exceeds its admitted retained storage.'); return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'prepare-owned-effect-cut') {
    if (!input || Object.keys(input).some(key => !['definition', 'metadata', 'components'].includes(key)) || estimatedPeakBytes < metadata.bytes * 5 + 32 * 1048576) throw problem('invalid-contract', 'Effect continuation requires its complete admitted graph image.');
    const identity = getActiveExecutionIdentity('browser-background-jobs');
    if (identity.activeExecution !== 'bound') throw problem('engine-identity-unbound', 'Effect continuation requires its exact executing worker artifact.');
    const { prepareOwnedEffectCut } = await import('./OwnedEffectCutPreparation.js'); guard(signal, current);
    const value = await prepareOwnedEffectCut(input, { signal, yieldControl, maxWorkingBytes: estimatedPeakBytes - metadata.bytes }); guard(signal, current);
    value.applicationBuildId = identity.buildId;
    const retainedBytes = value.components.reduce((sum, row) => sum + row.bytes.length, 0) + canonicalDataText(value.metadata, { maxBytes: 2 * 1048576, maxNodes: 131072 }).bytes.length * 4 + 262144;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Prepared effect continuation exceeds its retained storage.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'prepare-owned-source-cut') {
    if (!input || Object.keys(input).some(key => !['definition', 'engineRequirement', 'metadata', 'bytes', 'pcm'].includes(key)) || estimatedPeakBytes < metadata.bytes * 2 + 64 * 1048576) throw problem('invalid-contract', 'Source continuation requires its admitted bounded preparation contract.');
    const { getNativeInstrumentCatalog } = await import('../midi-ui/NativeInstrumentSchema.js'); guard(signal, current);
    const catalog = await getNativeInstrumentCatalog(), descriptor = catalog.descriptors.find(engine => engine.engineId === input.engineRequirement?.engineId); guard(signal, current);
    if (catalog.state !== 'bound-application-engines' || !descriptor || !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => input.engineRequirement?.[key] === descriptor[key])) throw problem('engine-identity-unbound', 'Source continuation requires its exact executing artifact.');
    const { prepareOwnedSourceCut } = await import('./OwnedSourceCutPreparation.js'); guard(signal, current);
    const value = await prepareOwnedSourceCut({ ...input, descriptor }, { signal, yieldControl, maxWorkingBytes: estimatedPeakBytes - metadata.bytes }); guard(signal, current);
    value.applicationBuildId = catalog.executionIdentity.buildId;
    const retainedBytes = value.bytes.length + canonicalDataText(value.metadata, { maxBytes: 4 * 1048576, maxNodes: 200000 }).bytes.length * 4 + 65536;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Prepared continuation exceeds its admitted result.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'render-sound-controls') {
    if (!input || Object.keys(input).some(key => !['definition', 'engineRequirement', 'sampleRate', 'source', 'pcm', 'sampleGesture'].includes(key)) || estimatedPeakBytes < 32 * 1048576)
      throw problem('invalid-contract', 'Sound control rendering requires its bounded fixed-job contract.');
    const { getNativeInstrumentCatalog } = await import('../midi-ui/NativeInstrumentSchema.js'); guard(signal, current);
    const catalog = await getNativeInstrumentCatalog(), descriptor = catalog.descriptors.find(engine => engine.engineId === input.engineRequirement?.engineId); guard(signal, current);
    if (catalog.state !== 'bound-application-engines' || !descriptor || !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => input.engineRequirement?.[key] === descriptor[key]))
      throw problem('engine-identity-unbound', 'Sound control rendering requires its exact executing source artifact.');
    const { renderOwnedSourceControls } = await import('../midi-ui/OwnedSourceControlRender.js'); guard(signal, current);
    const value = await renderOwnedSourceControls({ definition: input.definition, descriptor, sampleRate: input.sampleRate, source: input.source, pcm: input.pcm, sampleGesture: input.sampleGesture,
      applicationBuildId: catalog.executionIdentity.buildId }, { signal, yieldControl, onProgress }); guard(signal, current);
    const retainedBytes = value.bytes.byteLength * 2 + 65536;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Rendered control reference exceeds admitted output storage.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'render-scene-rehearsal') {
    const { getNativeInstrumentCatalog } = await import('../midi-ui/NativeInstrumentSchema.js'); guard(signal, current);
    const catalog = await getNativeInstrumentCatalog(); guard(signal, current);
    if (catalog.state !== 'bound-application-engines') throw problem('engine-identity-unbound', 'Scene rehearsal requires the exact executing audio and world artifacts.');
    const footprint = (metadata.bytes - metadata.binaryBytes) * 12 + metadata.nodes * 192 + metadata.binaryBytes * 2;
    if (estimatedPeakBytes < footprint + 64 * 1048576) throw problem('memory-capacity', 'Scene rehearsal source exceeds its admitted representation.');
    const { renderPerformanceSceneRehearsal } = await import('../procgen/workstation/PerformanceSceneRehearsalRender.js'); guard(signal, current);
    const value = await renderPerformanceSceneRehearsal(input, { descriptors: catalog.descriptors, buildId: catalog.executionIdentity.buildId, signal, isCurrent: current, yieldControl, maxWorkingBytes: estimatedPeakBytes - footprint }); guard(signal, current);
    const retainedBytes = (value.bytes?.byteLength || value.planes?.reduce((sum, plane) => sum + plane.byteLength, 0) || 0) * 2 + 262144;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Scene rehearsal PCM exceeds its admitted result.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (['render-causal-sine-take', 'render-causal-source-pcm'].includes(kind)) {
    if (!input || Object.keys(input).some(key => !['revoice', 'definition', 'engineRequirement', 'sampleRate', 'startSeconds', 'endSeconds', 'tail', 'stemLaneIds', 'pcm', 'restorationMode', 'effectGraph', 'effectReturnNodeIds', 'capturedEffects', 'effectReplayHash', 'capturedSpatial', 'capturedMaterials', 'timeTransformMode', 'requestedEndSeconds', 'timbreTuningReadout'].includes(key)) || estimatedPeakBytes < 8 * 1048576)
      throw problem('invalid-contract', 'Causal audio rendering requires a bounded semantic-source request.');
    const { getNativeInstrumentCatalog } = await import('../midi-ui/NativeInstrumentSchema.js'); guard(signal, current);
    const catalog = await getNativeInstrumentCatalog(), descriptor = catalog.descriptors.find(engine => engine.engineId === input.engineRequirement?.engineId); guard(signal, current);
    if (catalog.state !== 'bound-application-engines' || !descriptor || !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => input.engineRequirement?.[key] === descriptor[key]))
      throw problem('engine-identity-unbound', 'Causal audio rendering requires its exact executing source artifact.');
    const sourceFootprint = (metadata.bytes - metadata.binaryBytes) * 12 + metadata.nodes * 192 + metadata.binaryBytes * 2;
    if (sourceFootprint + 8 * 1048576 > estimatedPeakBytes) throw problem('memory-capacity', 'Causal render source exceeds its admitted object and clone footprint.');
    const { renderCausalOwnedTake } = await import('../midi-ui/CausalOwnedRender.js'); guard(signal, current);
    const value = await renderCausalOwnedTake({ ...input, ...(kind === 'render-causal-source-pcm' ? { outputMode: 'source-pcm' } : {}), descriptor, applicationBuildId: catalog.executionIdentity.buildId },
      { signal, yieldControl, onProgress, maxWorkingBytes: estimatedPeakBytes - sourceFootprint }); guard(signal, current);
    const retainedBytes = kind === 'render-causal-source-pcm' ? value.planes.reduce((sum, plane) => sum + plane.byteLength * 2, 262144) : value.files.reduce((sum, file) => sum + file.bytes.byteLength * 2 + 262144, 262144);
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Causal audio artifacts exceed admitted result storage.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'compile-sound-content') {
    const { getNativeInstrumentCatalog } = await import('../midi-ui/NativeInstrumentSchema.js'); guard(signal, current);
    const catalog = await getNativeInstrumentCatalog(); guard(signal, current);
    if (catalog.state !== 'bound-application-engines' || !catalog.descriptors.length) throw problem('engine-identity-unbound', 'Sound compilation requires the executing immutable renderer catalog.');
    if (input?.schema === 'lemmings-physical-mapping-revision-request/v1') {
      if (Object.keys(input).some(key => !['schema', 'pack', 'reference', 'bindings'].includes(key))) throw problem('mapping-request-invalid', 'A mapping revision request contains unsupported fields.');
      const { prepareSoundContentPack } = await import('../../midi/content/SoundContentPack.js');
      const { preparePhysicalMappingRevision } = await import('../../midi/content/PhysicalMappingRevision.js'); guard(signal, current);
      const prepared = await prepareSoundContentPack(input.pack, { engineDescriptors: catalog.descriptors, signal }); guard(signal, current);
      const descriptor = catalog.descriptors.find(engine => engine.engineId === input.reference?.engineRequirement?.engineId);
      if (!descriptor) throw problem('mapping-engine-unavailable', 'The mapping target engine is unavailable in this executing worker.');
      const revised = await preparePhysicalMappingRevision({ prepared, reference: input.reference, descriptor, bindings: input.bindings, signal }); guard(signal, current);
      const value = revised.state === 'unchanged' ? { state: revised.state, reference: revised.reference } :
        { state: revised.state, pack: revised.prepared.pack, contentHash: revised.prepared.contentHash, reference: revised.reference,
          parentReference: revised.parentReference, mappingOrder: revised.mappingOrder, qualification: revised.qualification };
      const encoded = canonicalDataText(value, { maxBytes, maxNodes }); guard(signal, current);
      const retainedBytes = encoded.bytes.byteLength * 4;
      if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'The revised mapping exceeds its admitted representation bound.');
      return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
    }
    const { compileSoundContent } = await import('../../midi/content/SoundContentCompiler.js'); guard(signal, current);
    const compiled = await compileSoundContent(input, { targets: catalog.descriptors.map(descriptor => ({ descriptor })), signal }); guard(signal, current);
    const value = { pack: compiled.prepared.pack, contentHash: compiled.prepared.contentHash, sourceHash: compiled.sourceHash, qualification: compiled.qualification };
    const encoded = canonicalDataText(value, { maxBytes, maxNodes }); guard(signal, current);
    const retainedBytes = encoded.bytes.byteLength * 4;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Compiled sound data exceeds its admitted representation bound.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'recovery-checksum') {
    const { checksumProcgenRecovery } = await import('../procgen/workstation/ProcgenRecoveryChecksum.js'); guard(signal, current);
    return { value: await checksumProcgenRecovery(input, { signal, yieldTask: yieldControl }), inputBytes: metadata.bytes, nodes: metadata.nodes };
  }
  const value = kind === 'encode-canonical-json' ? canonicalDataText(input, { maxBytes, maxNodes }).text : JSON.stringify(input); guard(signal, current);
  if (typeof value !== 'string' || encodedLength(value) > maxBytes) throw problem('output-capacity', 'Encoded background result exceeds its byte bound.');
  return { value, inputBytes: metadata.bytes, nodes: metadata.nodes };
}
