import { cloneData, freezeData, hashData, hashDataText } from '../../core/CanonicalData.js';
import { validateEngineDescriptor, validateInstrumentPatchV2 } from './InstrumentPatchV2.js';

export const SOUND_CONTENT_SCHEMA = 'lemmings-sound-content/v1';
const LIMITS = Object.freeze({ maxBytes: 4 * 1048576, maxNodes: 100000, domain: 'Sound content' });
const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value, limit, empty = false) => typeof value === 'string' && value.length <= limit && (empty || value.length > 0);
const natural = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const localPath = value => text(value, 512) && /^[A-Za-z0-9_./@-]+$/.test(value) && !value.startsWith('/') && !value.split('/').some(part => !part || part === '.' || part === '..');
const sourceUrl = value => value == null || text(value, 2048) && /^(?:https:\/\/[^\s]+|urn:[A-Za-z0-9][^\s]*)$/.test(value);
const fail = (code, message, detail = {}) => Object.assign(new Error(message), { name: 'SoundContentError', code, ...detail });
const assertContent = (condition, path, message) => { if (!condition) throw fail('invalid-content', path + ': ' + message, { path }); };
const kinds = ['engine-code', 'patch-recipe', 'sample-recording', 'demo-composition', 'derived-data'];
const fileKinds = ['sample', 'impulse-response', 'wavetable', 'body-table', 'tuning', 'spectrum', 'generated-data'];
const before = (a, b) => a < b ? -1 : a > b ? 1 : 0;

const rights = (value, path, licenses) => {
  assertContent(value && kinds.includes(value.kind) && (value.creator == null || text(value.creator, 160)) && sourceUrl(value.sourceUrl) &&
    text(value.licenseId, 128) && sourceUrl(value.licenseUrl) && text(value.attribution, 4096, true) &&
    Array.isArray(value.modifications) && value.modifications.length <= 32 && value.modifications.every(item => text(item, 1024)) &&
    ['redistributable', 'private', 'unknown'].includes(value.declaredUse) && (value.licenseTextHash == null || hash(value.licenseTextHash) && licenses.has(value.licenseTextHash)), path, 'invalid rights reference');
  return value;
};

export async function prepareSoundContentPack(raw, { engineDescriptors = [], signal } = {}) {
  signal?.throwIfAborted();
  const pack = cloneData(raw, LIMITS);
  assertContent(pack?.schema === SOUND_CONTENT_SCHEMA && id(pack.id) && text(pack.version, 64) && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pack.version) &&
    text(pack.name, 160) && text(pack.author, 160) && sourceUrl(pack.sourceUrl) && text(pack.licenseId, 128) && sourceUrl(pack.licenseUrl) &&
    text(pack.attribution, 4096, true) && Array.isArray(pack.modifications) && pack.modifications.length <= 32 && pack.modifications.every(item => text(item, 1024)) &&
    ['portable', 'project-only', 'reference-only', 'unknown'].includes(pack.redistributionPolicy), 'pack', 'unsupported pack header');
  assertContent(Array.isArray(pack.files) && pack.files.length <= 512 && Array.isArray(pack.patches) && pack.patches.length > 0 && pack.patches.length <= 256 &&
    Array.isArray(pack.licenses) && pack.licenses.length <= 128 && Array.isArray(engineDescriptors) && engineDescriptors.length <= 256, 'pack', 'inventory exceeds its bounds');
  const licenses = new Map();
  for (const license of pack.licenses) {
    signal?.throwIfAborted();
    assertContent(license && text(license.id, 128) && hash(license.sha256) && text(license.text, 32768) && sourceUrl(license.url) && !licenses.has(license.sha256), 'licenses', 'invalid license snapshot');
    assertContent(await hashDataText(license.text) === license.sha256, 'licenses.' + license.id, 'license snapshot hash mismatch'); licenses.set(license.sha256, license);
  }
  const files = new Map(), paths = new Set(); let totalBytes = 0;
  for (const file of pack.files) {
    assertContent(file && localPath(file.path) && !paths.has(file.path) && hash(file.sha256) && !files.has(file.sha256) && natural(file.bytes, 16 * 1048576) &&
      fileKinds.includes(file.kind) && !/\.(?:[cm]?js|wasm|html|svg)$/i.test(file.path) &&
      (['sample', 'impulse-response'].includes(file.kind) ? ['audio/wav', 'audio/x-wav'].includes(file.mediaType) : ['application/json', 'application/octet-stream'].includes(file.mediaType)) &&
      Array.isArray(file.parents) && file.parents.length <= 32 && new Set(file.parents).size === file.parents.length && file.parents.every(hash), 'files', 'invalid asset inventory');
    assertContent(rights(file.rights, 'files.' + file.path + '.rights', licenses), 'files', 'invalid asset rights');
    assertContent(['sample-recording', 'derived-data'].includes(file.rights.kind), 'files.' + file.path, 'engine or recipe rights cannot stand in for recorded/derived asset rights');
    totalBytes += file.bytes; assertContent(totalBytes <= 256 * 1048576, 'files', 'declared source bytes exceed the pack limit');
    paths.add(file.path); files.set(file.sha256, file);
  }
  const states = new Map();
  const visit = (value, depth = 0) => {
    assertContent(depth <= 32 && states.get(value) !== 'visiting', 'files', 'asset ancestry is cyclic or too deep');
    if (states.get(value) === 'complete') return;
    states.set(value, 'visiting');
    for (const parent of files.get(value).parents) if (files.has(parent)) visit(parent, depth + 1);
    states.set(value, 'complete');
  };
  for (const value of files.keys()) visit(value);
  const engines = new Map(engineDescriptors.map(input => { const engine = validateEngineDescriptor(input); return [engine.engineId + '@' + engine.engineVersion, engine]; }));
  const patches = [], identities = new Set();
  for (const entry of pack.patches) {
    signal?.throwIfAborted();
    const patch = entry?.definition, requirement = entry?.engineRequirement, identity = patch?.id + '@' + patch?.revision;
    assertContent(patch && id(patch.id) && natural(patch.revision, 2147483647) && patch.revision > 0 && !identities.has(identity) &&
      requirement && id(requirement.engineId) && natural(requirement.engineVersion, 65535) && requirement.engineVersion > 0 &&
      hash(requirement.artifactHash) && hash(requirement.parameterSchemaHash) && patch.engineId === requirement.engineId && patch.engineVersion === requirement.engineVersion &&
      Array.isArray(entry.dependencies) && entry.dependencies.length <= 128 && new Set(entry.dependencies).size === entry.dependencies.length && entry.dependencies.every(hash), 'patches', 'invalid pinned patch identity or dependency list');
    rights(entry.rights, 'patches.' + identity + '.rights', licenses); identities.add(identity);
    assertContent(entry.rights.kind === 'patch-recipe', 'patches.' + identity, 'patch recipe rights must be recorded separately');
    const engine = engines.get(requirement.engineId + '@' + requirement.engineVersion);
    let definition = null, state = 'engine-unavailable', reason = null;
    if (engine) {
      if (engine.artifactHash !== requirement.artifactHash || engine.parameterSchemaHash !== requirement.parameterSchemaHash) state = 'engine-revision-mismatch';
      else try { definition = validateInstrumentPatchV2(patch, engine); state = 'definition-admitted'; } catch (error) { state = 'definition-rejected'; reason = error.message; }
    }
    const samples = Array.isArray(patch.sampleRefs) ? patch.sampleRefs : [];
    assertContent(samples.length <= 32 && samples.every(ref => hash(ref?.sha256) && natural(ref.bytes, 256 * 1048576) && entry.dependencies.includes(ref.sha256)), 'patches.' + identity, 'sample dependencies are incomplete');
    for (const sample of samples) if (files.has(sample.sha256)) assertContent(files.get(sample.sha256).bytes === sample.bytes, 'patches.' + identity, 'sample dependency byte count differs');
    patches.push({ identity, definitionHash: await hashData(patch, LIMITS), definition, archivedDefinition: patch, dependencies: entry.dependencies,
      engineRequirement: requirement, rights: entry.rights, state, reason });
  }
  signal?.throwIfAborted();
  const normalized = { ...pack, files: pack.files.map(file => ({ ...file, parents: [...file.parents].sort() })).sort((a, b) => before(a.path, b.path)),
    licenses: [...pack.licenses].sort((a, b) => before(a.sha256, b.sha256)),
    patches: pack.patches.map(entry => ({ ...entry, dependencies: [...entry.dependencies].sort() })).sort((a, b) => before(a.definition.id + '@' + a.definition.revision, b.definition.id + '@' + b.definition.revision)) };
  patches.sort((a, b) => before(a.identity, b.identity));
  return freezeData({ schema: SOUND_CONTENT_SCHEMA, contentHash: await hashData(normalized, LIMITS), pack: normalized, patches, totalBytes,
    qualification: 'bounded-declarative-inventory-only' });
}

export function planSoundContentSelection(prepared, selection, { availableHashes = [], reviewRights = () => ({ decision: 'unknown' }) } = {}) {
  assertContent(prepared?.schema === SOUND_CONTENT_SCHEMA && Array.isArray(selection) && selection.length > 0 && selection.length <= 256 &&
    new Set(selection).size === selection.length && Array.isArray(availableHashes) && availableHashes.length <= 1024 && availableHashes.every(hash) &&
    typeof reviewRights === 'function', 'selection', 'invalid selection plan');
  const patches = selection.map(identity => { const patch = prepared.patches.find(entry => entry.identity === identity); assertContent(patch, 'selection', 'unknown patch revision'); return patch; });
  const byHash = new Map(prepared.pack.files.map(file => [file.sha256, file])), required = new Set(), missing = new Set(), available = new Set(availableHashes);
  const add = value => {
    if (required.has(value)) return; required.add(value);
    const file = byHash.get(value); if (!file) { missing.add(value); return; }
    for (const parent of file.parents) add(parent);
  };
  for (const patch of patches) for (const dependency of patch.dependencies) add(dependency);
  const files = [...required].filter(value => byHash.has(value)).map(value => byHash.get(value)).sort((a, b) => a.sha256 < b.sha256 ? -1 : 1);
  const credits = [...patches.map(patch => ({ subject: patch.identity, kind: 'patch-recipe', rights: patch.rights })),
    ...files.map(file => ({ subject: file.sha256, kind: file.kind, rights: file.rights }))].map(entry => {
    let decision;
    try { decision = reviewRights(entry); } catch { decision = { decision: 'unknown' }; }
    const complete = entry.rights.creator && entry.rights.sourceUrl && entry.rights.licenseTextHash && entry.rights.licenseId !== 'NOASSERTION';
    return { ...entry, redistribution: complete && entry.rights.declaredUse === 'redistributable' && decision?.decision === 'allow' && text(decision.receiptId, 256) ? 'allowed' :
      decision?.decision === 'deny' || entry.rights.declaredUse === 'private' ? 'private' : 'unknown', reviewReceiptId: text(decision?.receiptId, 256) ? decision.receiptId : null };
  });
  const unavailableEngines = patches.filter(patch => patch.state !== 'definition-admitted').map(patch => ({ identity: patch.identity, state: patch.state, reason: patch.reason }));
  const absentBytes = [...required].filter(value => !available.has(value));
  const portable = prepared.pack.redistributionPolicy === 'portable' && !missing.size && credits.every(entry => entry.redistribution === 'allowed');
  return freezeData({ schema: 'lemmings-sound-selection/v1', sourcePackHash: prepared.contentHash, selection: [...selection], patches, files, credits,
    missingReferences: [...missing].sort(), missingAssetBytes: absentBytes.sort(), unavailableEngines,
    portability: portable ? absentBytes.length ? 'portable-assets-needed' : 'portable-material' : 'reference-only', playability: missing.size || absentBytes.length || unavailableEngines.length ? 'requirements-unmet' : 'definition-ready-not-auditioned',
    requiredBytes: files.reduce((total, file) => total + file.bytes, 0),
    qualification: 'dependency-and-rights-preflight-only' });
}
