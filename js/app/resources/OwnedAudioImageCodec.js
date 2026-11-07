import { canonicalDataText, cloneData, hashData } from '../../core/CanonicalData.js';
import { validateSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { prepareOwnedSourceCut } from './OwnedSourceCutPreparation.js';
import { prepareOwnedEffectCut } from './OwnedEffectCutPreparation.js';

export const OWNED_AUDIO_IMAGE_SCHEMA = 'lemmings-owned-audio-image/v1';
export const OWNED_AUDIO_IMAGE_MAX_BYTES = 20 * 1048576;
const MAX_METADATA = 4 * 1048576, MAX_STATE = 16 * 1048576, PREFIX = 16, magic = [76, 77, 65, 85, 68, 73, 79, 49];
const fail = message => { throw Object.assign(new Error(message), { code: 'owned-audio-image-incompatible' }); };
const natural = value => Number.isSafeInteger(value) && value >= 0;
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key));
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
async function toBase64(bytes, options) {
  const parts = []; for (let first = 0; first < bytes.length; first += 49152) { check(options); const end = Math.min(bytes.length, first + 49152); let text = '';
    for (let index = first; index < end; index += 3) { const a = bytes[index], b = index + 1 < end ? bytes[index + 1] : 0, c = index + 2 < end ? bytes[index + 2] : 0;
      text += base64Alphabet[a >>> 2] + base64Alphabet[(a & 3) << 4 | b >>> 4] + (index + 1 < end ? base64Alphabet[(b & 15) << 2 | c >>> 6] : '=') + (index + 2 < end ? base64Alphabet[c & 63] : '='); } parts.push(text); await options.yieldControl(); }
  return parts.join('');
}
async function fromBase64(text, length, options) {
  if (typeof text !== 'string' || !natural(length) || length > OWNED_AUDIO_IMAGE_MAX_BYTES || text.length !== Math.ceil(length / 3) * 4) fail('The checkpoint image base64 inventory is invalid.');
  const bytes = new Uint8Array(length); let offset = 0;
  for (let first = 0; first < text.length; first += 65536) { check(options); const end = Math.min(text.length, first + 65536);
    for (let index = first; index < end; index += 4) { const a = base64Alphabet.indexOf(text[index]), b = base64Alphabet.indexOf(text[index + 1]), c = text[index + 2] === '=' ? -2 : base64Alphabet.indexOf(text[index + 2]), d = text[index + 3] === '=' ? -2 : base64Alphabet.indexOf(text[index + 3]);
      if (a < 0 || b < 0 || c === -1 || d === -1 || (c === -2 || d === -2) && index + 4 !== text.length || c === -2 && (d !== -2 || (b & 15)) || d === -2 && c >= 0 && (c & 3)) fail('The checkpoint image uses invalid or noncanonical base64.');
      if (offset < length) bytes[offset++] = a << 2 | b >>> 4; if (c >= 0 && offset < length) bytes[offset++] = b << 4 | c >>> 2; if (d >= 0 && offset < length) bytes[offset++] = c << 6 | d;
    } await options.yieldControl(); }
  if (offset !== length || text.endsWith('==') !== (length % 3 === 1) || !text.endsWith('==') && text.endsWith('=') !== (length % 3 === 2)) fail('The checkpoint image padding differs from its byte count.'); return bytes;
}
const same = (a, b) => canonicalDataText(a, { maxBytes: MAX_METADATA, maxNodes: 262144 }).text === canonicalDataText(b, { maxBytes: MAX_METADATA, maxNodes: 262144 }).text;
const check = options => { options.signal?.throwIfAborted(); if (options.current?.() === false) fail('The audio image request changed.'); };

async function validateImage(value, options, restoreComponents = true) {
  check(options); const metadata = value?.metadata, sources = value?.sources, rack = value?.rack;
  if (!keys(value, ['schema', 'applicationBuildId', 'metadata', 'sources', 'rack']) || value.schema !== OWNED_AUDIO_IMAGE_SCHEMA || value.applicationBuildId !== options.applicationBuildId ||
      metadata?.schema !== 'lemmings-owned-audio-cut/v1' || !natural(metadata.audioFrame) || ![44100, 48000, 96000].includes(metadata.sampleRate) || !natural(metadata.graphRevision) || metadata.graphRevision > 0xffffffff ||
      metadata.scope !== 'owned-source-and-creative-rack;shared-master-protection-excluded' || !Array.isArray(sources) || sources.length > 16 || !Array.isArray(metadata.sources) || metadata.sources.length !== sources.length ||
      !sources.length && !rack || new Set(sources.map(row => row?.sourceId)).size !== sources.length || !Array.isArray(options.descriptors) || !natural(options.maxWorkingBytes) || options.maxWorkingBytes < 96 * 1048576)
    fail('An image requires its exact build, complete source inventory and common source/rack frame.');
  let stateBytes = 0; const validatedSources = [];
  for (const source of sources) {
    if (!keys(source, ['sourceId', 'reference', 'metadata', 'bytes', 'pcm']) || typeof source.sourceId !== 'string' || !source.sourceId || source.sourceId.length > 160 || !(source.bytes instanceof Uint8Array) || source.bytes.byteOffset || source.bytes.byteLength !== source.bytes.buffer.byteLength) fail('A source image omitted its exclusive bytes or stable owner.');
    stateBytes += source.bytes.length; if (stateBytes > MAX_STATE) fail('The aggregate owned state exceeds sixteen MiB.');
    const reference = validateSoundContentReference(source.reference), descriptor = options.descriptors.find(row => ['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => row[key] === reference?.engineRequirement?.[key]));
    if (!reference || !descriptor || await hashData(reference.definition, { maxBytes: 65536, maxNodes: 8192 }) !== reference.definitionHash) fail('The image needs the exact immutable patch and executing engine artifact.');
    const declared = metadata.sources.find(row => row.sourceId === source.sourceId);
    if (!declared || source.metadata?.audioFrame !== metadata.audioFrame || source.metadata.cut?.sampleRate !== metadata.sampleRate || source.metadata.cut.graphRevision !== metadata.graphRevision || declared.sourceFrame !== source.metadata.cut.frame || !same(declared.runtime, source.metadata.runtime)) fail('A source image differs from the aggregate completed boundary.');
    const prepared = restoreComponents ? await prepareOwnedSourceCut({ definition: reference.definition, descriptor, metadata: source.metadata, bytes: source.bytes, pcm: source.pcm ?? null }, options) : { metadata: source.metadata, bytes: source.bytes }; check(options);
    validatedSources.push({ sourceId: source.sourceId, reference, metadata: prepared.metadata, bytes: prepared.bytes }); await options.yieldControl();
  }
  let validatedRack = null;
  if (rack !== null) {
    if (!keys(rack, ['metadata', 'definition', 'graphMetadata', 'components']) || !same(metadata.rack, rack.metadata) || rack.metadata?.audioFrame !== metadata.audioFrame || rack.graphMetadata?.audioFrame !== metadata.audioFrame || rack.graphMetadata.sampleRate !== metadata.sampleRate || !Array.isArray(rack.components) || rack.components.length > 512) fail('The complete rack and its processors must share the source cut.');
    for (const row of rack.components) { stateBytes += row?.bytes?.byteLength || 0; if (stateBytes > MAX_STATE) fail('Source and effect state together exceed sixteen MiB.'); }
    const prepared = restoreComponents ? await prepareOwnedEffectCut({ definition: rack.definition, metadata: rack.graphMetadata, components: rack.components }, options) : { definition: rack.definition, metadata: rack.graphMetadata, components: rack.components }; check(options);
    validatedRack = { metadata: rack.metadata, definition: prepared.definition, graphMetadata: prepared.metadata, components: prepared.components };
  } else if (metadata.rack !== null) fail('A declared rack cannot be omitted from the image.');
  return { schema: OWNED_AUDIO_IMAGE_SCHEMA, applicationBuildId: value.applicationBuildId, metadata, sources: validatedSources, rack: validatedRack };
}

export async function encodeOwnedAudioImage(input, options) {
  check(options);
  if (!keys(input, ['mode', 'value', 'includeCheckpointEnvelope']) || input.includeCheckpointEnvelope != null && typeof input.includeCheckpointEnvelope !== 'boolean' || input.mode !== 'encode') fail('Choose one explicit complete audio image.');
  const value = await validateImage(input.value, options), components = [], payloads = [];
  const add = async bytes => { const component = { id: components.length, bytes: bytes.length, sha256: await digest(bytes) }; components.push(component); payloads.push(bytes); check(options); return component.id; };
  const sources = []; for (const row of value.sources) sources.push({ sourceId: row.sourceId, reference: row.reference, metadata: row.metadata, componentId: await add(row.bytes) });
  let rack = null;
  if (value.rack) { const rows = []; for (const row of value.rack.components) { const { bytes, ...metadata } = row; rows.push({ ...metadata, componentId: await add(bytes) }); } rack = { ...value.rack, components: rows }; }
  const header = { ...value, sources, rack, components, stateRestoreCapability: 'exactSnapshot', qualification: 'component-state-restored;PCM-equivalence-not-established', acousticReceipt: false }, encoded = canonicalDataText(header, { maxBytes: MAX_METADATA, maxNodes: 262144 }).bytes,
    length = PREFIX + encoded.length + payloads.reduce((sum, bytes) => sum + bytes.length, 0);
  if (length > OWNED_AUDIO_IMAGE_MAX_BYTES || length * 6 + 64 * 1048576 > options.maxWorkingBytes) fail('The image/validation/encoding overlap exceeds the declared bound.');
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer); bytes.set(magic); view.setUint32(8, encoded.length, true); view.setUint32(12, components.length, true); bytes.set(encoded, PREFIX);
  let offset = PREFIX + encoded.length;
  for (const payload of payloads) for (let first = 0; first < payload.length; first += 65536) { check(options); const end = Math.min(payload.length, first + 65536); bytes.set(payload.subarray(first, end), offset + first); await options.yieldControl(); if (end === payload.length) offset += payload.length; }
  const sha256 = await digest(bytes); check(options);
  const checkpoint = input.includeCheckpointEnvelope ? { schema: 'lemmings-owned-audio-checkpoint-image/v1', applicationBuildId: value.applicationBuildId, sha256, bytes: bytes.length, encoding: 'base64', data: await toBase64(bytes, options), audioFrame: value.metadata.audioFrame, sampleRate: value.metadata.sampleRate, graphRevision: value.metadata.graphRevision } : null; check(options);
  return { schema: OWNED_AUDIO_IMAGE_SCHEMA, bytes, sha256, ...(checkpoint ? { checkpoint } : {}), manifest: { schema: OWNED_AUDIO_IMAGE_SCHEMA, applicationBuildId: value.applicationBuildId, audioFrame: value.metadata.audioFrame, sampleRate: value.metadata.sampleRate,
    graphRevision: value.metadata.graphRevision, bytes: bytes.length, sha256, sourceLaneIds: [...new Set(value.sources.flatMap(row => row.metadata.host.laneIdentities.map(pair => pair[0])))].sort(), sources: sources.map(row => ({ sourceId: row.sourceId, definitionHash: row.reference.definitionHash, engineRequirement: row.reference.engineRequirement })), rackGraphHash: value.rack?.graphMetadata.graphHash || null,
    semanticBoundary: value.metadata.semanticBoundary, stateRestoreCapability: 'exactSnapshot', scope: value.metadata.scope, qualification: header.qualification, acousticReceipt: false } };
}

export async function decodeOwnedAudioImage(input, options) {
  check(options);
  if (['decode-checkpoint', 'inspect-checkpoint'].includes(input?.mode)) {
    const image = input.image; if (!keys(input, ['mode', 'image', 'materials']) || !keys(image, ['schema', 'applicationBuildId', 'sha256', 'bytes', 'encoding', 'data', 'audioFrame', 'sampleRate', 'graphRevision']) || image.schema !== 'lemmings-owned-audio-checkpoint-image/v1' || image.applicationBuildId !== options.applicationBuildId || image.encoding !== 'base64') fail('The retained checkpoint image schema or build differs.');
    const bytes = await fromBase64(image.data, image.bytes, options), decoded = await decodeOwnedAudioImage({ mode: input.mode === 'inspect-checkpoint' ? 'inspect' : 'decode', bytes, sha256: image.sha256, materials: input.materials }, options);
    const boundary = decoded.metadata || decoded.inspection;
    if (boundary.audioFrame !== image.audioFrame || boundary.sampleRate !== image.sampleRate || boundary.graphRevision !== image.graphRevision) fail('The checkpoint envelope differs from its decoded state boundary.'); return decoded;
  }
  if (!keys(input, ['mode', 'bytes', 'sha256', 'materials']) || !['decode', 'inspect'].includes(input.mode) || input.mode === 'inspect' && input.materials?.length !== 0 || !(input.bytes instanceof Uint8Array) || input.bytes.length < PREFIX || input.bytes.length > OWNED_AUDIO_IMAGE_MAX_BYTES || !/^[a-f0-9]{64}$/.test(input.sha256 || '') || !Array.isArray(input.materials) || input.materials.length > 16 || new Set(input.materials.map(row => row?.sourceId)).size !== input.materials.length || input.materials.some(row => !keys(row, ['sourceId', 'pcm']) || typeof row.sourceId !== 'string')) fail('Open one bounded digest-bound image with its explicit material inventory.');
  const bytes = input.bytes, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (magic.some((value, index) => bytes[index] !== value) || await digest(bytes) !== input.sha256) fail('The audio image magic or immutable digest differs.'); check(options);
  const length = view.getUint32(8, true), count = view.getUint32(12, true); if (length > MAX_METADATA || PREFIX + length > bytes.length || count > 528) fail('The audio image component/header inventory is oversized.');
  let header; try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(PREFIX, PREFIX + length)); header = cloneData(JSON.parse(text), { maxBytes: MAX_METADATA, maxNodes: 262144 }); if (canonicalDataText(header, { maxBytes: MAX_METADATA, maxNodes: 262144 }).text !== text) fail('The image header is not canonical.'); } catch (error) { fail('Invalid canonical audio image header: ' + error.message); }
  if (!keys(header, ['schema', 'applicationBuildId', 'metadata', 'sources', 'rack', 'components', 'stateRestoreCapability', 'qualification', 'acousticReceipt']) || !Array.isArray(header.components) || header.components.length !== count || header.stateRestoreCapability !== 'exactSnapshot' || header.acousticReceipt !== false || header.qualification !== 'component-state-restored;PCM-equivalence-not-established') fail('The image capability and component ledger changed.');
  let offset = PREFIX + length; const buffers = [], used = new Set();
  for (let index = 0; index < count; index++) { const row = header.components[index]; if (!keys(row, ['id', 'bytes', 'sha256']) || row.id !== index || !natural(row.bytes) || row.bytes > MAX_STATE || offset + row.bytes > bytes.length || !/^[a-f0-9]{64}$/.test(row.sha256)) fail('Invalid audio image component bounds.');
    const component = bytes.slice(offset, offset + row.bytes); if (await digest(component) !== row.sha256) fail('An audio state component changed.'); check(options); buffers.push(component); offset += row.bytes; await options.yieldControl(); }
  if (offset !== bytes.length || offset - PREFIX - length > MAX_STATE) fail('The audio image has trailing bytes or excessive state.');
  const take = id => { if (!natural(id) || id >= buffers.length || used.has(id)) fail('An audio component is missing, shared or duplicated.'); used.add(id); return buffers[id]; };
  if (!Array.isArray(header.sources) || header.sources.length > 16 || input.materials.some(row => !header.sources.some(source => source.sourceId === row.sourceId))) fail('The image material inventory differs from its source list.');
  const sources = header.sources.map(row => { if (!keys(row, ['sourceId', 'reference', 'metadata', 'componentId'])) fail('Unknown source image fields.'); return { sourceId: row.sourceId, reference: row.reference, metadata: row.metadata, bytes: take(row.componentId), pcm: input.materials.find(material => material.sourceId === row.sourceId)?.pcm ?? null }; });
  let rack = null; if (header.rack !== null) { if (!keys(header.rack, ['metadata', 'definition', 'graphMetadata', 'components']) || !Array.isArray(header.rack.components) || header.rack.components.length > 512) fail('Invalid rack component inventory.'); rack = { ...header.rack, components: header.rack.components.map(row => { const { componentId, ...metadata } = row; return { ...metadata, bytes: take(componentId) }; }) }; }
  if (used.size !== buffers.length) fail('The image contains an unowned state component.');
  const value = await validateImage({ schema: header.schema, applicationBuildId: header.applicationBuildId, metadata: header.metadata, sources, rack }, options, input.mode !== 'inspect');
  if (input.mode === 'inspect') return { schema: OWNED_AUDIO_IMAGE_SCHEMA, applicationBuildId: value.applicationBuildId, inspection: { sha256: input.sha256, bytes: bytes.length, audioFrame: value.metadata.audioFrame, sampleRate: value.metadata.sampleRate, graphRevision: value.metadata.graphRevision, scope: value.metadata.scope, stage: 'component-integrity-and-pinned-reference-check;material-and-kernel-restoration-pending', acousticReceipt: false }, sources: value.sources.map(row => ({ sourceId: row.sourceId, reference: row.reference })) };
  return value;
}
