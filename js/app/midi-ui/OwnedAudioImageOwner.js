import { canonicalDataText, cloneData, freezeData } from '../../core/CanonicalData.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { prepareExportArtifact } from '../export/ExportArtifact.js';

const SCHEMA = 'lemmings-owned-audio-image/v1', MAX_IMAGE = 20 * 1048576, MAX_INPUT = 64 * 1048576, MAX_PEAK = 496 * 1048576;
const fail = message => { throw Object.assign(new Error(message), { name: 'AudioRestoreError', code: 'owned-audio-image-ownership' }); };
let sequence = 0;
const current = options => { options.signal?.throwIfAborted(); if (options.isCurrent?.() === false) fail('The audio image source owner changed.'); };
const pcmSize = pcm => {
  if (pcm == null) return 0;
  const rows = Array.isArray(pcm.banks) ? pcm.banks : [pcm];
  let bytes = 0;
  for (const row of rows) { if (!Array.isArray(row?.planes) || row.planes.length < 1 || row.planes.length > 2 || row.planes.some(plane => !(plane instanceof Float32Array))) fail('Source materials need owned immutable PCM planes.');
    bytes += row.planes.reduce((sum, plane) => sum + plane.byteLength, 0); }
  if (!Number.isSafeInteger(bytes) || bytes > MAX_INPUT) fail('Source PCM exceeds the portable image profile.'); return bytes;
};
const releaseJob = job => { job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) fail('The audio image worker result has unresolved retirement.'); };
async function computeImage(input, inputBytes, options) {
  current(options);
  if (!Number.isSafeInteger(inputBytes) || inputBytes < 1 || inputBytes > MAX_INPUT) fail('The audio image and immutable materials exceed the input bound.');
  const peak = Math.max(192 * 1048576, inputBytes * 8 + 128 * 1048576);
  if (peak > MAX_PEAK) fail('The complete image representation and restoration workspace exceed the admitted profile.');
  const owner = 'owned-audio-image:' + (++sequence), inputLease = createOwnedResourceReservation({ budget: options.resourceBudget, owner, kind: 'portable-audio-image-input', category: 'audio', bytes: Math.max(4096, inputBytes * 2), maxBytes: 128 * 1048576 });
  const retirement = createProcgenRetirementScope(); let job = null;
  try {
    const catalog = await (options.getCatalog || getNativeInstrumentCatalog)(); current(options);
    if (catalog?.state !== 'bound-application-engines' || !/^[a-f0-9]{64}$/.test(catalog.executionIdentity?.buildId || '')) fail('The audio image requires the current immutable application build.');
    if (input.mode === 'encode') input.value.applicationBuildId = catalog.executionIdentity.buildId;
    const sourceRevision = input.mode === 'encode' ? 'capture:' + input.value.metadata.audioFrame + ':' + input.value.metadata.graphRevision : input.sha256 || input.image?.sha256;
    job = await (options.jobs || backgroundJobService).compute({ kind: 'owned-audio-image', ownerId: owner, ownerEpoch: 1, sourceRevision,
      inputBytes, maxBytes: MAX_INPUT, estimatedPeakBytes: peak, deadlineMs: 90000, budgetAdapter: options.resourceBudget, signal: options.signal, isCurrent: options.isCurrent,
      prepareInput: () => { current(options); return input; } });
    current(options);
    if (job.receipt?.method !== 'dedicated-worker' || job.receipt.executionIdentity?.activeExecution !== 'bound' || job.receipt.executionIdentity.buildId !== catalog.executionIdentity.buildId || job.value?.schema !== SCHEMA ||
        (job.value.applicationBuildId || job.value.manifest?.applicationBuildId) !== catalog.executionIdentity.buildId) fail('The audio image was not prepared by its exact executing application worker.');
    inputLease.release();
    return { job, retirement, catalog };
  } catch (error) { const receipt = retirement.retire([...(job ? [{ name: 'failed-audio-image-worker', run: () => releaseJob(job) }] : []), { name: 'audio-image-input', run: () => { if (inputLease.isActive()) inputLease.release(); } }]);
    await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}

export async function encodeOwnedAudioImage({ cut, sources, includeCheckpointEnvelope = false, suggestedFilename = 'audio-state.lmaudio', ...options } = {}) {
  current(options);
  const metadata = cut?.metadata?.(), captured = cut?.sources?.(), rack = cut?.rack?.();
  if (metadata?.schema !== 'lemmings-owned-audio-cut/v1' || !Array.isArray(captured) || !Array.isArray(sources) || sources.length !== captured.length || sources.length > 16 ||
      new Set(sources.map(row => row?.sourceId)).size !== sources.length || captured.some(row => !sources.some(input => input.sourceId === row.sourceId)) || typeof includeCheckpointEnvelope !== 'boolean') fail('Encode the complete captured source and rack inventory with its immutable patch references.');
  const sourceRows = captured.map(row => { const input = sources.find(input => input.sourceId === row.sourceId); return { sourceId: row.sourceId, reference: input.reference, metadata: row.cut.metadata(), bytes: row.cut.bytes(), pcm: input.pcm ?? null }; });
  const graph = rack?.graphCut?.(), rackRow = rack ? { metadata: rack.metadata(), definition: rack.definition(), graphMetadata: graph?.metadata?.(), components: graph?.components?.() } : null;
  if (sourceRows.some(row => !(row.bytes instanceof Uint8Array)) || rackRow && !Array.isArray(rackRow.components)) fail('The source cut was released or omitted a graph component.');
  const stateBytes = sourceRows.reduce((sum, row) => sum + row.bytes.byteLength, 0) + (rackRow?.components.reduce((sum, row) => sum + (row.bytes?.byteLength || 0), 0) || 0);
  const headerBytes = canonicalDataText({ metadata, sources: sourceRows.map(({ bytes, pcm, ...row }) => row), rack: rackRow && { ...rackRow, components: rackRow.components.map(({ bytes, ...row }) => row) } }, { maxBytes: 4 * 1048576, maxNodes: 262144 }).bytes.length;
  const expectedImageBytes = stateBytes + headerBytes + 262144;
  if (stateBytes > 16 * 1048576 || expectedImageBytes > MAX_IMAGE) fail('The complete source/effect cut exceeds the portable image profile.');
  const inputBytes = stateBytes + headerBytes + sourceRows.reduce((sum, row) => sum + pcmSize(row.pcm), 0) + 262144;
  const { job, retirement } = await computeImage({ mode: 'encode', includeCheckpointEnvelope, value: { schema: SCHEMA, applicationBuildId: '', metadata, sources: sourceRows, rack: rackRow } }, Math.max(inputBytes, includeCheckpointEnvelope ? Math.ceil(expectedImageBytes * 2.5) : expectedImageBytes), options);
  let artifact = null, value = job.value, released = false;
  try {
    if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength > MAX_IMAGE || !/^[a-f0-9]{64}$/.test(value.sha256 || '') || value.manifest?.sha256 !== value.sha256 || value.manifest.bytes !== value.bytes.length || includeCheckpointEnvelope !== !!value.checkpoint) fail('The encoded audio image inventory differs from its worker receipt.');
    let manifest = cloneData(value.manifest, { maxBytes: 262144, maxNodes: 16384 });
    if (value.checkpoint) freezeData(value.checkpoint);
    artifact = prepareExportArtifact({ bytes: value.bytes, immutableSourceRef: value.sha256, formatVersion: SCHEMA, mediaType: 'application/vnd.lemmings.owned-audio-image', suggestedFilename, maxBytes: MAX_IMAGE, budgetAdapter: options.resourceBudget });
    return Object.freeze({ schema: SCHEMA, metadata: () => released ? null : manifest, artifact: () => { if (released) fail('The audio image has retired.'); return artifact; },
      checkpoint: () => { if (released || !value.checkpoint) fail('Request a retained checkpoint envelope when encoding this image.'); return value.checkpoint; },
      open: openOptions => { if (released) fail('The audio image has retired.'); return openOwnedAudioImage({ ...options, ...openOptions, bytes: value.bytes, sha256: value.sha256 }); },
      release() { if (released) return retirement.getReceipt(); released = true; value = null; manifest = null;
        return retirement.retire([{ name: 'audio-image-export', run: () => { artifact.discard(); } }, { name: 'audio-image-worker-result', run: () => releaseJob(job) }]); } });
  } catch (error) { artifact?.discard(); const receipt = retirement.retire([{ name: 'failed-image-publication', run: () => releaseJob(job) }]); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}

export async function openOwnedAudioImage({ bytes = null, sha256 = null, checkpoint = null, materials = [], ...options } = {}) {
  current(options);
  if (!Array.isArray(materials) || materials.length > 16 || new Set(materials.map(row => row?.sourceId)).size !== materials.length || materials.some(row => typeof row?.sourceId !== 'string') ||
      checkpoint !== null && bytes !== null || checkpoint === null && (!(bytes instanceof Uint8Array) || !/^[a-f0-9]{64}$/.test(sha256 || '') || bytes.byteLength > MAX_IMAGE)) fail('Open one digest-bound image or checkpoint and its explicit immutable materials.');
  const materialBytes = materials.reduce((sum, row) => sum + pcmSize(row.pcm), 0), imageBytes = checkpoint ? canonicalDataText(checkpoint, { maxBytes: 28 * 1048576, maxNodes: 128 }).bytes.length : bytes.byteLength;
  const input = checkpoint ? { mode: 'decode-checkpoint', image: checkpoint, materials } : { mode: 'decode', bytes, sha256, materials };
  const { job, retirement } = await computeImage(input, imageBytes + materialBytes + 262144, options);
  let value = job.value, released = false;
  try {
    let metadata = cloneData(value.metadata, { maxBytes: 2 * 1048576, maxNodes: 131072 }), references = cloneData(value.sources.map(row => ({ sourceId: row.sourceId, reference: row.reference })), { maxBytes: 2 * 1048576, maxNodes: 131072 });
    const assertOpen = () => { if (released) fail('The restored audio image has retired.'); };
    const sourceCuts = value.sources.map((row, index) => { const metadata = cloneData(row.metadata, { maxBytes: 2 * 1048576, maxNodes: 131072 }); return Object.freeze({ sourceId: row.sourceId, cut: Object.freeze({ metadata: () => { assertOpen(); return metadata; }, bytes: () => { assertOpen(); return value.sources[index].bytes; } }) }); });
    if (value.rack) { freezeData(value.rack.metadata); freezeData(value.rack.definition); freezeData(value.rack.graphMetadata); value.rack.components = Object.freeze(value.rack.components.map(row => Object.freeze(row))); }
    const rack = value.rack ? Object.freeze({ metadata: () => { assertOpen(); return value.rack.metadata; }, definition: () => { assertOpen(); return value.rack.definition; }, graphCut: () => { assertOpen(); return Object.freeze({ metadata: () => { assertOpen(); return value.rack.graphMetadata; }, components: () => { assertOpen(); return value.rack.components; } }); } }) : null;
    return Object.freeze({ schema: 'lemmings-owned-audio-cut/v1', metadata: () => released ? null : metadata, sources: () => { assertOpen(); return sourceCuts.slice(); }, rack: () => { assertOpen(); return rack; }, references: () => { assertOpen(); return references; },
      release() { if (released) return retirement.getReceipt(); released = true; value = null; metadata = null; references = null; sourceCuts.length = 0; return retirement.retire([{ name: 'opened-audio-image', run: () => releaseJob(job) }]); } });
  } catch (error) { value = null; const receipt = retirement.retire([{ name: 'failed-opened-image', run: () => releaseJob(job) }]); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}

export async function inspectOwnedAudioImage({ bytes = null, sha256 = null, checkpoint = null, ...options } = {}) {
  current(options);
  if (checkpoint !== null && bytes !== null || checkpoint === null && (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_IMAGE || !/^[a-f0-9]{64}$/.test(sha256 || ''))) fail('Inspect one digest-bound image or retained canonical checkpoint.');
  const inputBytes = checkpoint ? canonicalDataText(checkpoint, { maxBytes: 28 * 1048576, maxNodes: 128 }).bytes.length : bytes.byteLength;
  const { job, retirement } = await computeImage(checkpoint ? { mode: 'inspect-checkpoint', image: checkpoint, materials: [] } : { mode: 'inspect', bytes, sha256, materials: [] }, inputBytes + 262144, options);
  let value = job.value, released = false;
  try {
    if (!value.inspection || !Array.isArray(value.sources) || value.sources.length > 16) fail('The image inspection omitted its source reference inventory.');
    freezeData(value);
    return Object.freeze({ metadata: () => released ? null : value.inspection, references: () => { if (released) fail('The audio image inspection retired.'); return value.sources; },
      release() { if (released) return retirement.getReceipt(); released = true; value = null; return retirement.retire([{ name: 'audio-image-inspection', run: () => releaseJob(job) }]); } });
  } catch (error) { const receipt = retirement.retire([{ name: 'failed-image-inspection', run: () => releaseJob(job) }]); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
