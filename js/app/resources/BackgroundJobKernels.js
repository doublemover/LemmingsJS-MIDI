import { buildCircuitWorkshop } from './CircuitWorkshopBuilder.js';
import { OWNED_STRETCH_CORE } from '../../midi/content/OwnedStretchCoreIdentity.js';
import { bakeFiniteFmExcitation } from './FiniteFmExcitation.js';
import { deriveResonatorEndpoint } from '../../midi/content/ResonatorEndpointAdapters.js';
import { renderResonatorMorphReference } from './ResonatorMorphReference.js';
import { analyzeResonatorMorph } from '../../midi/content/ResonatorMorph.js';
import { compileSceneTerrainLayout } from '../procgen/SceneTerrainLayout.js';
import { createShapeBodyEdgeField } from './ShapeBodyEdgeField.js';
import { composeSeedComponents } from './SeedComponentComposition.js';
import { fitSoundSeedModes } from './SeedModalFit.js';
import { solveShapeBody } from './ShapeBodySolver.js';
import { solveOriginalShapeRefinement } from './ShapeBodyRefinement.js';
import { renderShapeBodyCalibration } from './ShapeBodyCalibration.js';
import { getActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { createShapeBodyRecipe } from '../../midi/content/ShapeBodyRecipe.js';
import { decomposeSoundSeed } from './SeedDecomposition.js';
import { analyzeSoundSeedWindow } from './SoundSeedWindowAnalysis.js';
import { encodeProcgenRecoveryPage, decodeProcgenRecoveryPage } from '../procgen/workstation/ProcgenRecoveryPageCodec.js';
import { analyzeImpulseResponse } from './ImpulseResponseAnalysis.js';
import { decodeWaveSource } from './WaveSourceDecode.js';
import { checksumProcgenRecovery } from '../procgen/workstation/ProcgenRecoveryChecksum.js';
import { decodeGroundAssetSnapshot } from './GroundAssetDecode.js';
import { canonicalDataText } from '../../core/CanonicalData.js';
import { compileSoundContent } from '../../midi/content/SoundContentCompiler.js';
import { getNativeInstrumentCatalog } from '../midi-ui/NativeInstrumentSchema.js';
import { inspectCausalArchiveEntry } from '../procgen/workstation/CausalArchiveEntry.js';
import { getProceduralSoundById } from '../../midi/content/ProceduralSoundMaterial.js';
import { inspectWaveContainer } from '../midi-ui/AudioAssetRef.js';
import { getOwnedSourceBankIdentity } from '../midi-ui/OwnedSourceBank.js';
import { encodeRecordedMidi } from '../procgen/workstation/RecordedMidiEncoding.js';
import { encodeRecordedUmpClip } from '../procgen/workstation/RecordedUmpClipExport.js';
import { encodePhysicalTakeMidi } from '../procgen/workstation/PhysicalTakeMidiProjection.js';
import { encodeMidiClipFile, decodeMidiClipFile } from '../../midi/protocol/MidiClipFile.js';
import { yieldBackgroundTask } from './BackgroundTaskYield.js';

export { BACKGROUND_JOB_PROTOCOL, BACKGROUND_JOB_KINDS } from './BackgroundJobKinds.js';
import { BACKGROUND_JOB_KINDS, CAUSAL_SOURCE_JOB_KINDS } from './BackgroundJobKinds.js';
import { backgroundJobError as problem, checkBackgroundJob as guard, encodedLength, inspectText } from './BackgroundJsonInspector.js';
const MAX_BYTES = 64 * 1048576, MAX_NODES = 4000000;
const shared = value => typeof globalThis.SharedArrayBuffer === 'function' && (value instanceof globalThis.SharedArrayBuffer || value?.buffer instanceof globalThis.SharedArrayBuffer);
const jsonStringBytes = text => {
  let bytes = 2;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index), next = text.charCodeAt(index + 1);
    if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) bytes += 2;
    else if (code < 32 || code >= 0xdc00 && code <= 0xdfff || code >= 0xd800 && code <= 0xdbff && !(next >= 0xdc00 && next <= 0xdfff)) bytes += 6;
    else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; index++; }
    else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
  }
  return bytes;
};
const yieldTask = () => yieldBackgroundTask();
const inspectValue = async (value, { maxBytes, maxNodes, maxStringBytes, estimatedPeakBytes, signal, current, onProgress, yieldControl }, { allowBinary = false } = {}) => {
  const stack = [{ value, depth: 0 }], active = new WeakSet(); let units = 0, bytes = 0, nodes = 0, binaryBytes = 0;
  while (stack.length) {
    const item = stack.pop();
    if (item.leave) { active.delete(item.value); continue; }
    if (item.array) {
      if (item.index < item.value.length) {
        const index = item.index++; stack.push(item);
        const descriptor = Object.getOwnPropertyDescriptor(item.value, index);
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !allowBinary && descriptor.value === undefined) throw problem('invalid-data', 'Background arrays require explicit snapshot values.');
        stack.push({ value: descriptor.value, depth: item.depth + 1 });
      }
      continue;
    }
    if (++nodes > maxNodes || item.depth > 48) throw problem('structure-capacity', 'Background input exceeds its structural bound.');
    const input = item.value, type = typeof input;
    if (input === null || type === 'boolean' || type === 'number') { if (type === 'number' && !Number.isFinite(input)) throw problem('invalid-data', 'JSON numbers must be finite.'); bytes += Object.is(input, -0) ? 2 : String(input).length; }
    else if (type === 'string') { if (input.length > Math.min(maxBytes, maxStringBytes)) throw problem('input-capacity', 'Background string exceeds its byte bound.'); bytes += jsonStringBytes(input); }
    else if (type === 'undefined') bytes += 4;
    else if (type !== 'object' || active.has(input)) throw problem('invalid-data', 'Background input must contain only acyclic snapshot data.');
    else if (shared(input)) throw problem('shared-live-input', 'Background jobs require owned snapshot buffers, not shared live memory.');
    else if (allowBinary && (input instanceof ArrayBuffer || ArrayBuffer.isView(input))) { bytes += input.byteLength; binaryBytes += input.byteLength; }
    else {
      if (!Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw problem('invalid-data', 'Unsupported background snapshot object.');
      active.add(input); stack.push({ value: input, leave: true });
      if (Array.isArray(input)) {
        if (Object.getPrototypeOf(input) !== Array.prototype || Object.hasOwn(input, 'toJSON')) throw problem('invalid-data', 'Background arrays cannot define serialization behavior.');
        if (input.length + nodes > maxNodes) throw problem('structure-capacity', 'Background array exceeds its element bound.');
        bytes += Math.max(0, input.length - 1) + 2;
        if (bytes > maxBytes || bytes * 6 + nodes * 32 > estimatedPeakBytes) throw problem('memory-capacity', 'Background array exceeds its admitted representation bound.');
        stack.push({ value: input, depth: item.depth, index: 0, array: true });
        if (++units % 2048 === 0) { guard(signal, current); onProgress({ phase: 'validating-snapshot', completedUnits: units, totalUnits: null }); await yieldControl(); }
        continue;
      }
      const keys = []; for (const key in input) if (Object.hasOwn(input, key)) {
        if (keys.length + nodes >= maxNodes || bytes * 6 + (keys.length + nodes) * 64 > estimatedPeakBytes) throw problem('structure-capacity', 'Background snapshot exceeds its property staging bound.'); keys.push(key);
        if (keys.length % 2048 === 0) { guard(signal, current); await yieldControl(); }
      }
      bytes += Math.max(0, keys.length * 2 - 1) + 2;
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index], descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw problem('invalid-data', 'Background snapshots cannot contain getters.');
        if (key.length > maxStringBytes) throw problem('input-capacity', 'Background property exceeds its byte bound.');
        bytes += jsonStringBytes(key); stack.push({ value: descriptor.value, depth: item.depth + 1 });
      }
    }
    if (bytes > maxBytes || bytes * 6 + nodes * 32 > estimatedPeakBytes) throw problem('memory-capacity', 'Background input exceeds its admitted representation bound.');
    if (++units % 2048 === 0) { guard(signal, current); onProgress({ phase: 'validating-snapshot', completedUnits: units, totalUnits: null }); await yieldControl(); }
  }
  guard(signal, current); return { bytes, nodes, binaryBytes };
};

export async function runBackgroundJobKernel(kind, input, { signal, current, maxBytes = MAX_BYTES, estimatedPeakBytes,
  maxNodes = MAX_NODES, maxStringBytes = MAX_BYTES, maxDecodedBytes, crypto = globalThis.crypto, onProgress = () => {}, yieldControl = yieldTask, expectedInputHash = null } = {}) {
  if (!BACKGROUND_JOB_KINDS.includes(kind) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES ||
      !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 4096 || estimatedPeakBytes > 512 * 1048576 ||
      !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_NODES ||
      !Number.isSafeInteger(maxStringBytes) || maxStringBytes < 1 || maxStringBytes > MAX_BYTES ||
      expectedInputHash != null && !/^[a-f0-9]{64}$/.test(expectedInputHash)) throw problem('invalid-contract', 'Unsupported background job kernel contract.');
  guard(signal, current);
  if (kind === 'encode-physical-take-midi') {
    const value = await encodePhysicalTakeMidi(input, { signal, current, estimatedPeakBytes, onProgress, yieldControl }); guard(signal, current);
    return { value, inputBytes: new TextEncoder().encode(JSON.stringify(input)).byteLength, nodes: 64, retainedBytes: value.bytes.byteLength * 2 + 65536 };
  }
  if (kind === 'encode-recorded-ump-clip') {
    const value = await encodeRecordedUmpClip(input, { signal, current, estimatedPeakBytes, maxBytes, crypto, onProgress, yieldControl }); guard(signal, current);
    const snapshot = input.snapshot;
    return { value, inputBytes: snapshot.beats.byteLength + snapshot.offsets.byteLength + snapshot.words.byteLength + snapshot.routes.byteLength + snapshot.sourceIndices.byteLength +
      snapshot.tempoBeats.byteLength + snapshot.tempoBpms.byteLength + snapshot.tempoIndices.byteLength + snapshot.outputEpochs.byteLength + snapshot.routeCounts.byteLength +
      new TextEncoder().encode(JSON.stringify({ attribution: snapshot.attribution, outputIds: snapshot.outputIds, window: input.window, options: input.options })).byteLength,
    nodes: 64, retainedBytes: (value.bytes.byteLength + value.manifestBytes.byteLength) * 2 + 65536 };
  }
  if (kind === 'inspect-midi-clip') {
    const value = await decodeMidiClipFile(input?.bytes, { signal, current, maxBytes, estimatedPeakBytes, onProgress, yieldControl }); guard(signal, current);
    return { value: { report: value.report, ppq: value.ppq, endTick: value.endTick }, inputBytes: input.bytes.byteLength, nodes: 32, retainedBytes: 65536 };
  }
  if (kind === 'encode-midi-clip' || kind === 'decode-midi-clip') {
    const controls = { signal, current, maxBytes, estimatedPeakBytes, onProgress, yieldControl };
    const value = kind === 'encode-midi-clip' ? await encodeMidiClipFile(input, controls) : await decodeMidiClipFile(input?.bytes, controls); guard(signal, current);
    const columnsBytes = columns => columns.ticks.byteLength + columns.offsets.byteLength + columns.words.byteLength;
    const outputBytes = kind === 'encode-midi-clip' ? value.bytes.byteLength : columnsBytes(value.configuration) + columnsBytes(value.sequence);
    return { value, inputBytes: kind === 'encode-midi-clip' ? value.report.inputBytes : input.bytes.byteLength,
      nodes: 32, retainedBytes: outputBytes * 2 + 65536 };
  }
  if (kind === 'encode-recorded-midi') {
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
  if (kind === 'qualify-original-shape-refinement') {
    const execution = getActiveExecutionIdentity('browser-background-jobs');
    if (execution.activeExecution !== 'bound' || input?.comparisonBuildHash !== execution.buildId || Object.keys(input).some(key => !['shapeId', 'profileId', 'comparisonBuildHash', 'expectedCoarseAssetHash'].includes(key)) || estimatedPeakBytes < 128 * 1048576) throw problem('engine-identity-unbound', 'Refinement comparison requires its actual bound worker and two complete admitted solves.');
    const metadata = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 4096), maxNodes: 128 });
    const result = await solveOriginalShapeRefinement({ ...input, solverBuildHash: execution.buildId }, { signal, current, yieldControl, onProgress, estimatedPeakBytes }); guard(signal, current);
    const retainedBytes = canonicalDataText(result.receipt, { maxBytes: 262144, maxNodes: 16384 }).bytes.length * 8;
    return { value: result.receipt, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'build-shape-body-content') {
    const execution = getActiveExecutionIdentity('browser-background-jobs');
    if (execution.activeExecution !== 'bound' || input?.solverBuildHash !== execution.buildId || estimatedPeakBytes < 128 * 1048576 || Object.keys(input).some(key => !['source', 'solverBuildHash', 'modeCount', 'sampleRate', 'seconds', 'fieldKind', 'lossKind'].includes(key))) throw problem('engine-identity-unbound', 'Foundry content requires the actual worker build and its complete solve/calibration/compilation reservation.');
    if (!['edge', 'surface'].includes(input.fieldKind ?? 'edge') || !['diagonal', 'point'].includes(input.lossKind ?? 'diagonal')) throw problem('invalid-shape-preparation', 'Choose an explicit supported bar observation and loss model before solving.');
    const metadata = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 262144), maxNodes: 16384 }), options = { signal, current, estimatedPeakBytes, yieldControl, onProgress };
    const asset = await solveShapeBody({ source: input.source, solverBuildHash: execution.buildId }, options), calibration = await renderShapeBodyCalibration({ asset, modeCount: input.modeCount, sampleRate: input.sampleRate, seconds: input.seconds }, options); guard(signal, current);
    const sharedBody = await createShapeBodyEdgeField(asset, { ...options, sampleRate: input.sampleRate, fieldKind: input.fieldKind ?? 'edge', lossKind: input.lossKind ?? 'diagonal' }); guard(signal, current);
    const recipe = await createShapeBodyRecipe({ asset, calibration, edgeField: sharedBody }), catalog = await getNativeInstrumentCatalog(); guard(signal, current);
    if (catalog.state !== 'bound-application-engines' || catalog.executionIdentity.buildId !== execution.buildId) throw problem('engine-identity-unbound', 'The foundry compiler differs from its executing worker.');
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
    const value = await (kind === 'solve-shape-body' ? solveShapeBody : renderShapeBodyCalibration)(input, { signal, current, estimatedPeakBytes, yieldControl, onProgress }); guard(signal, current);
    const retainedBytes = kind === 'solve-shape-body' ? canonicalDataText(value, { maxBytes: 2 * 1048576, maxNodes: 131072 }).bytes.length * 4 + 65536 : value.files.reduce((sum, file) => sum + file.bytes.byteLength * 2 + 262144, 1048576);
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Foundry output exceeds its complete retained reservation.');
    return { value, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'analyze-native-impulse') {
    const value = await analyzeImpulseResponse(input, { signal, current, yieldControl, crypto, estimatedPeakBytes }); guard(signal, current);
    const metadata = canonicalDataText({ ...input, planes: undefined }, { maxBytes: 65536, maxNodes: 4096, domain: 'Impulse analysis source metadata' });
    const inputBytes = value.bytes + metadata.bytes.byteLength; if (inputBytes > maxBytes) throw problem('input-capacity', 'Impulse source exceeds its job byte bound.');
    return { value, inputBytes, nodes: metadata.nodes + input.planes.length, retainedBytes: 65536 };
  }
  if (kind === 'derive-resonator-endpoint') {
    const metadata = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 4 * 1048576 + 65536), maxNodes: Math.min(maxNodes, 131072), domain: 'Derived resonator endpoint source' });
    if (estimatedPeakBytes < metadata.bytes.length * 32 + 32 * 1048576) throw problem('workspace-capacity', 'Complete endpoint/source verification workspace is not admitted.');
    const value = await deriveResonatorEndpoint(input, { signal, current, yieldControl }); guard(signal, current); const encoded = canonicalDataText(value, { maxBytes: 131072, maxNodes: 16384 });
    return { value, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes: encoded.bytes.length * 32 + 131072 };
  }
  if (kind === 'render-resonator-morph-reference') {
    const metadata = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 262144), maxNodes: Math.min(maxNodes, 32768), domain: 'Paired modal body reference' });
    const value = await renderResonatorMorphReference(input, { signal, current, yieldControl, onProgress, estimatedPeakBytes }); guard(signal, current);
    return { value, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes: value.bytes.byteLength + canonicalDataText(value.manifest).bytes.length * 32 + 131072 };
  }
  if (kind === 'analyze-resonator-morph') {
    const metadata = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 262144), maxNodes: Math.min(maxNodes, 32768), domain: 'Resonator correspondence source' });
    if (estimatedPeakBytes < metadata.bytes.length * 32 + 262144) throw problem('workspace-capacity', 'The modal correspondence workspace is not admitted.');
    const value = await analyzeResonatorMorph(input, { signal, current, yieldControl, onProgress }); guard(signal, current);
    const encoded = canonicalDataText(value, { maxBytes: 262144, maxNodes: 32768 });
    return { value, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes: encoded.bytes.length * 32 + 131072 };
  }
  if (kind === 'compile-scene-terrain') {
    const metadata = canonicalDataText(input, { maxBytes: Math.min(maxBytes, 131072), maxNodes: Math.min(maxNodes, 16384), domain: 'Authored scene terrain' });
    const value = await compileSceneTerrainLayout(input, { signal, current, crypto, estimatedPeakBytes, yieldControl, onProgress }); guard(signal, current);
    return { value, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes: value.bytes + metadata.bytes.length * 32 + 131072 };
  }
  if (kind === 'compose-sound-seed-components') {
    const metadata = canonicalDataText({ ...input, pcm: null, originBytes: null, componentInputs: input?.componentInputs?.map(value => ({ ...value, pcm: null, originBytes: null })) }, { maxBytes: 65536, maxNodes: 8192 });
    const bytes = (input?.pcm?.byteLength || 0) + (input?.originBytes?.byteLength || 0) + metadata.bytes.length + (input?.componentInputs || []).reduce((sum, value) => sum + (value?.pcm?.byteLength || 0) + (value?.originBytes?.byteLength || 0), 0);
    if (bytes > maxBytes) throw problem('input-capacity', 'The component windows exceed their admitted composition workspace.');
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
    return (kind === 'fit-sound-seed-modes' ? fitSoundSeedModes : kind === 'decompose-sound-seed' ? decomposeSoundSeed : analyzeSoundSeedWindow)(input, { signal, current, estimatedPeakBytes, yieldControl, onProgress });
  }
  if (kind === 'bake-finite-fm-exciter') {
    const metadata = canonicalDataText(input, { maxBytes: 262144, maxNodes: 32768 });
    if (metadata.bytes.length > maxBytes) throw problem('input-capacity', 'Finite FM ancestry exceeds its admitted input.');
    const value = await bakeFiniteFmExcitation(input, { signal, current, yieldControl, estimatedPeakBytes }); guard(signal, current);
    return { value, inputBytes: metadata.bytes.length, nodes: metadata.nodes, retainedBytes: value.bytes.byteLength + value.waveform.minMax.byteLength + canonicalDataText(value.manifest, { maxBytes: 262144, maxNodes: 32768 }).bytes.length * 16 + 131072 };
  }
  if (kind === 'decode-wave-source') return decodeWaveSource(input, { signal, current, maxBytes, estimatedPeakBytes, crypto, yieldControl });
  if (kind === 'generate-procedural-sound') {
    if (!input || Object.keys(input).length !== 1 || typeof input.id !== 'string') throw problem('invalid-contract', 'Invalid original procedural sound request.');
    const expected = getProceduralSoundById(input.id);
    if (estimatedPeakBytes < 16 * 1048576 || maxBytes < expected.bytes) throw problem('memory-capacity', 'Procedural source needs its worker startup and copy reservation.');
    const { generateProceduralSoundSource } = await import('../../midi/content/ProceduralSoundSources.js'); guard(signal, current);
    const bytes = generateProceduralSoundSource(expected), format = inspectWaveContainer(bytes, { maxChannels: expected.kind === 'impulse-response' ? 4 : 2 });
    const digest = await crypto.subtle.digest('SHA-256', bytes); guard(signal, current);
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== expected.sha256 || bytes.byteLength !== expected.bytes || format.frames !== expected.frames || format.channels !== expected.channels || format.sampleRate !== expected.sampleRate)
      throw problem('content-mismatch', 'Procedural source differs from its original immutable identity.');
    return { value: { id: expected.id, hash, bytes }, inputBytes: 128, nodes: 16, retainedBytes: expected.bytes + 16384 };
  }
  if (kind === 'inspect-wave-asset') {
    if (!input || Object.keys(input).some(key => !['bytes', 'contentHash', 'assetKind'].includes(key)) || !/^[a-f0-9]{64}$/.test(input.contentHash) ||
        !(input.bytes instanceof Uint8Array) || shared(input.bytes) || input.bytes.byteLength > maxBytes || input.bytes.byteLength * 8 + 1048576 > estimatedPeakBytes)
      throw problem('invalid-contract', 'WAV inspection requires immutable bytes and their expected hash.');
    if (input.assetKind != null && !['sample', 'impulse-response'].includes(input.assetKind)) throw problem('invalid-contract', 'Unknown native WAV asset kind.');
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
    const expected = getOwnedSourceBankIdentity(input.id);
    if (estimatedPeakBytes < (input.id === 'sample-read-v1' ? 24 : 16) * 1048576 || maxBytes < expected.bytes) throw problem('memory-capacity', 'Fixed bank preparation needs its worker startup and copy reservation.');
    const { computeOwnedSourceBank } = await import('./OwnedSourceBankComputation.js'); guard(signal, current);
    const value = await computeOwnedSourceBank(input.id, { signal, current, crypto, yieldControl });
    return { value, inputBytes: 128, nodes: 16, retainedBytes: expected.bytes + 16384 };
  }
  if (kind === 'asset-decode') return decodeGroundAssetSnapshot(input, { signal, current, maxBytes, estimatedPeakBytes, maxDecodedBytes, crypto, onProgress, yieldControl });
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
  const metadata = await inspectValue(input, options, { allowBinary: ['decode-recovery-page', 'recovery-checksum', 'render-sound-controls', 'render-causal-sine-take', 'render-causal-source-pcm', 'encode-native-render', 'render-scene-rehearsal'].includes(kind) });
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
    const catalog = await getNativeInstrumentCatalog(); guard(signal, current);
    if (catalog.state !== 'bound-application-engines' || catalog.executionIdentity?.buildId !== input.applicationBuildId) throw problem('engine-identity-unbound', 'The original kit producer differs from the requested application build.');
    const value = await buildCircuitWorkshop({ variant: input.variant }, { descriptors: catalog.descriptors, applicationBuildId: catalog.executionIdentity.buildId, estimatedPeakBytes, signal, current, yieldControl, onProgress }); guard(signal, current);
    const representation = canonicalDataText({ pack: value.pack, kit: value.kit, contentHash: value.contentHash, kitHash: value.kitHash, contractHash: value.contractHash, qualification: value.qualification }, { maxBytes: 4 * 1048576, maxNodes: 131072 }).bytes.length,
      retainedBytes = value.assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0) * 2 + representation * 8 + 1048576;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'The prepared original kit exceeds its admitted output representation.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'encode-recovery-page' || kind === 'decode-recovery-page') {
    let value;
    try { value = kind === 'encode-recovery-page' ? await encodeProcgenRecoveryPage(input, { maxBytes, signal }) : await decodeProcgenRecoveryPage(input, { maxBytes, signal }); }
    catch (error) { signal?.throwIfAborted(); throw problem('invalid-data', error.message); }
    guard(signal, current);
    const output = kind === 'decode-recovery-page' ? await inspectValue(value, options) : null;
    const retainedBytes = kind === 'encode-recovery-page' ? value.bytes.byteLength * 2 + 4096 : output.bytes * 2 + output.nodes * 64;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Recovery output exceeds its admitted peak.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'snapshot-canonical-data') {
    const encoded = canonicalDataText(input, { maxBytes, maxNodes }); guard(signal, current);
    if (encoded.bytes.byteLength * 8 + encoded.nodes * 192 > estimatedPeakBytes) throw problem('memory-capacity', 'Snapshot source exceeds its declared clone overlap.');
    const value = JSON.parse(encoded.text); guard(signal, current);
    return { value, inputBytes: metadata.bytes, nodes: encoded.nodes, retainedBytes: encoded.bytes.byteLength * 2 + encoded.nodes * 64 + 4096 };
  }
  if (kind === 'encode-native-render') {
    if (!input || Object.keys(input).some(key => !['mode', 'manifest', 'planes', 'firstFrame', 'endFrame', 'stemLaneIds'].includes(key)) ||
        metadata.bytes * 4 + 16 * 1048576 > estimatedPeakBytes) throw problem('invalid-contract', 'Native encoding requires its admitted PCM and representation overlap.');
    const catalog = await getNativeInstrumentCatalog(), requirement = input.manifest?.engineRequirement;
    const descriptor = catalog.descriptors.find(engine => engine.engineId === requirement?.engineId); guard(signal, current);
    if (catalog.state !== 'bound-application-engines' || !descriptor || !(['native-oscillator', 'native-fm', 'native-modal', 'native-sample'].includes(descriptor.engineId) || input.mode === 'causal-take' && ['worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-sample', 'worklet-seed-layers'].includes(descriptor.engineId)) ||
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
  if (kind === 'render-sound-controls') {
    if (!input || Object.keys(input).some(key => !['definition', 'engineRequirement', 'sampleRate', 'source', 'pcm', 'sampleGesture'].includes(key)) || estimatedPeakBytes < 32 * 1048576)
      throw problem('invalid-contract', 'Sound control rendering requires its bounded fixed-job contract.');
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
    const catalog = await getNativeInstrumentCatalog(); guard(signal, current);
    if (catalog.state !== 'bound-application-engines') throw problem('engine-identity-unbound', 'Scene rehearsal requires the exact executing audio and world artifacts.');
    const footprint = (metadata.bytes - metadata.binaryBytes) * 12 + metadata.nodes * 192 + metadata.binaryBytes * 2;
    if (estimatedPeakBytes < footprint + 64 * 1048576) throw problem('memory-capacity', 'Scene rehearsal source exceeds its admitted representation.');
    const { renderPerformanceSceneRehearsal } = await import('../procgen/workstation/PerformanceSceneRehearsalRender.js'); guard(signal, current);
    const value = await renderPerformanceSceneRehearsal(input, { descriptors: catalog.descriptors, buildId: catalog.executionIdentity.buildId, signal, isCurrent: current, yieldControl, maxWorkingBytes: estimatedPeakBytes - footprint }); guard(signal, current);
    const retainedBytes = value.bytes.byteLength * 2 + 262144;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Scene rehearsal PCM exceeds its admitted result.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (['render-causal-sine-take', 'render-causal-source-pcm'].includes(kind)) {
    if (!input || Object.keys(input).some(key => !['revoice', 'definition', 'engineRequirement', 'sampleRate', 'startSeconds', 'endSeconds', 'tail', 'stemLaneIds', 'pcm', 'restorationMode', 'effectGraph', 'effectReturnNodeIds', 'capturedEffects', 'effectReplayHash'].includes(key)) || estimatedPeakBytes < 8 * 1048576)
      throw problem('invalid-contract', 'Causal audio rendering requires a bounded semantic-source request.');
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
    const catalog = await getNativeInstrumentCatalog(); guard(signal, current);
    if (catalog.state !== 'bound-application-engines' || !catalog.descriptors.length) throw problem('engine-identity-unbound', 'Sound compilation requires the executing immutable renderer catalog.');
    const compiled = await compileSoundContent(input, { targets: catalog.descriptors.map(descriptor => ({ descriptor })), signal }); guard(signal, current);
    const value = { pack: compiled.prepared.pack, contentHash: compiled.prepared.contentHash, sourceHash: compiled.sourceHash, qualification: compiled.qualification };
    const encoded = canonicalDataText(value, { maxBytes, maxNodes }); guard(signal, current);
    const retainedBytes = encoded.bytes.byteLength * 4;
    if (retainedBytes > estimatedPeakBytes) throw problem('output-capacity', 'Compiled sound data exceeds its admitted representation bound.');
    return { value, inputBytes: metadata.bytes, nodes: metadata.nodes, retainedBytes };
  }
  if (kind === 'recovery-checksum') return { value: await checksumProcgenRecovery(input, { signal, yieldTask: yieldControl }), inputBytes: metadata.bytes, nodes: metadata.nodes };
  const value = kind === 'encode-canonical-json' ? canonicalDataText(input, { maxBytes, maxNodes }).text : JSON.stringify(input); guard(signal, current);
  if (typeof value !== 'string' || encodedLength(value) > maxBytes) throw problem('output-capacity', 'Encoded background result exceeds its byte bound.');
  return { value, inputBytes: metadata.bytes, nodes: metadata.nodes };
}
