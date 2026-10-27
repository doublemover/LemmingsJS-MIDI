import { compileSoundRealizationGroups } from './SoundRealizationProfiles.js';
import { canonicalDataText, cloneData, freezeData, hashData, hashDataText } from '../../core/CanonicalData.js';
import { validateEngineDescriptor, validateInstrumentPatchV2 } from './InstrumentPatchV2.js';
import { validateSampleInstrumentMap } from './SampleInstrumentMap.js';

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
const keysOnly = (value, keys, path) => assertContent(value && Object.keys(value).every(key => keys.includes(key)), path, 'unknown field in this content schema');
const kinds = ['engine-code', 'patch-recipe', 'sample-recording', 'demo-composition', 'derived-data'];
const fileKinds = ['sample', 'impulse-response', 'wavetable', 'body-table', 'tuning', 'spectrum', 'generated-data'];
const before = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const preparedPacks = new WeakMap();
const conversionRecord = (value, path) => {
  if (value == null) return;
  keysOnly(value, ['kind', 'to', 'inputMin', 'inputMax', 'outputMin', 'outputMax'], path);
  assertContent(text(value.kind, 64) && text(value.to, 32) && ['inputMin', 'inputMax', 'outputMin', 'outputMax'].every(key => value[key] == null || Number.isFinite(value[key])), path, 'invalid explicit conversion');
};
const compilerArtifact = (artifact, patch, compilerRevision) => {
  const path = 'compilation.artifacts.' + artifact.id;
  const sampleMetadata = ['typed-recipes-v11', 'typed-recipes-v12', 'typed-recipes-v13'].includes(compilerRevision);
  keysOnly(artifact.display, ['name', 'author', 'tags', ...(sampleMetadata ? ['sampleMap'] : [])], path + '.display');
  assertContent(text(artifact.display.name, 160) && text(artifact.display.author, 160) && Array.isArray(artifact.display.tags) && artifact.display.tags.length <= 16 && artifact.display.tags.every(id), path, 'invalid compiler display metadata');
  let map = null;
  if (patch.archivedDefinition.sampleMap != null) {
    assertContent(sampleMetadata, path, 'sample maps require typed-recipes-v11 compilation metadata');
    try { map = validateSampleInstrumentMap(patch.archivedDefinition.sampleMap, patch.archivedDefinition.sampleRefs, { rendererProfile: patch.archivedDefinition.sampleMap.rendererProfile }); }
    catch (error) { throw fail('invalid-content', path + '.display.sampleMap: ' + error.message, { path: path + '.display.sampleMap' }); }
    const display = artifact.display.sampleMap;
    keysOnly(display, ['articulations', 'normalizationRef'], path + '.display.sampleMap');
    assertContent(Array.isArray(display.articulations) && display.articulations.length > 0 && display.articulations.length <= 16 &&
      new Set(display.articulations.map(entry => entry?.id)).size === display.articulations.length && Object.hasOwn(display, 'normalizationRef') &&
      (display.normalizationRef === null || hash(display.normalizationRef)), path + '.display.sampleMap', 'invalid bounded sample-map display metadata');
    for (const articulation of display.articulations) { keysOnly(articulation, ['id', 'name'], path + '.display.sampleMap.articulations');
      assertContent(id(articulation.id) && text(articulation.name, 80), path + '.display.sampleMap.articulations', 'invalid articulation display'); }
    assertContent(canonicalDataText(display).text === canonicalDataText({ articulations: map.articulations, normalizationRef: map.normalizationRef }).text,
      path + '.display.sampleMap', 'sample-map display differs from its archived definition');
  } else assertContent(!Object.hasOwn(artifact.display, 'sampleMap'), path + '.display.sampleMap', 'non-sample-map patches cannot declare sample-map display metadata');
  keysOnly(artifact.engineRequirement, ['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'], path + '.engineRequirement');
  assertContent(canonicalDataText(artifact.engineRequirement).text === canonicalDataText(patch.engineRequirement).text, path, 'explanation engine requirement differs from the patch');
  for (const parameter of artifact.parameters) {
    keysOnly(parameter, ['component', 'parameter', 'authored', 'effectiveValue', 'unit', 'minimum', 'maximum', 'default', 'liveSafe'], path + '.parameters');
    keysOnly(parameter.authored, ['value', 'unit', 'conversion'], path + '.parameters.authored');
    assertContent(id(parameter.component) && id(parameter.parameter) && [parameter.authored.value, parameter.effectiveValue, parameter.minimum, parameter.maximum, parameter.default].every(Number.isFinite) &&
      text(parameter.unit, 32) && text(parameter.authored.unit, 32) && typeof parameter.liveSafe === 'boolean', path, 'invalid typed parameter explanation');
    conversionRecord(parameter.authored.conversion, path + '.conversion');
  }
  for (const macro of artifact.macros) {
    keysOnly(macro, ['id', 'name', 'mode', 'default01', 'smoothingMs', 'perceptualDirection', 'mappings', 'bipolar', 'momentary'], path + '.macros');
    assertContent((macro.bipolar == null || typeof macro.bipolar === 'boolean') && (macro.momentary == null || typeof macro.momentary === 'boolean') && id(macro.id) && text(macro.name, 80) && ['onset-only', 'continuous'].includes(macro.mode) && text(macro.perceptualDirection, 256) &&
      Array.isArray(macro.mappings) && macro.mappings.length <= 16, path, 'invalid macro explanation');
    for (const mapping of macro.mappings) {
      keysOnly(mapping, ['parameter', 'minimum', 'maximum', 'unit', 'curve', 'composition', 'conversion', 'clamp'], path + '.macroMappings');
      keysOnly(mapping.conversion, ['minimum', 'maximum'], path + '.macroConversion');
      assertContent(id(mapping.parameter) && Number.isFinite(mapping.minimum) && Number.isFinite(mapping.maximum) && text(mapping.unit, 32) && typeof mapping.clamp === 'boolean', path, 'invalid macro mapping');
      conversionRecord(mapping.conversion.minimum, path + '.macroMinimum'); conversionRecord(mapping.conversion.maximum, path + '.macroMaximum');
    }
  }
  for (const modulation of artifact.modulationBounds) {
    keysOnly(modulation, ['id', 'sourceUnit', 'bounds'], path + '.modulationBounds'); keysOnly(modulation.bounds, ['minimum', 'maximum', 'unit'], path + '.modulationRange');
    assertContent(id(modulation.id) && text(modulation.sourceUnit, 32) && text(modulation.bounds.unit, 32) &&
      Number.isFinite(modulation.bounds.minimum) && Number.isFinite(modulation.bounds.maximum), path, 'invalid modulation bounds');
  }
  keysOnly(artifact.cost, ['maxVoices', 'componentCount', 'assetCount', 'modulationEdges', 'estimateClass', ...(sampleMetadata ? ['sampleZones'] : [])], path + '.cost');
  assertContent(natural(artifact.cost.maxVoices, 1024) && natural(artifact.cost.componentCount, 32) && natural(artifact.cost.assetCount, 512) && natural(artifact.cost.modulationEdges, 64) &&
    artifact.cost.estimateClass === 'declared-structure-not-measured-cpu', path, 'invalid declared cost');
  // Legacy compiler artifacts have no sample-map capability and an implicit
  // zero zone count. Keep their archived bytes/hash unchanged on read.
  if (sampleMetadata) assertContent(Object.hasOwn(artifact.cost, 'sampleZones') && natural(artifact.cost.sampleZones, 128) && artifact.cost.sampleZones === (map?.zones.length || 0), path + '.cost.sampleZones', 'sample zone count differs from the bounded archived map');
  keysOnly(artifact.audition, ['kind', 'effectivePatchHash', 'renderEvidence'], path + '.audition');
  assertContent(artifact.audition.kind === 'real-causal-take-required' && artifact.audition.effectivePatchHash === artifact.renderKey && artifact.audition.renderEvidence === 'not-produced', path, 'imported compilation cannot supply trusted render qualification');
};

const rights = (value, path, licenses) => {
  keysOnly(value, ['kind', 'creator', 'sourceUrl', 'licenseId', 'licenseUrl', 'attribution', 'modifications', 'declaredUse', 'licenseTextHash'], path);
  assertContent(value && kinds.includes(value.kind) && (value.creator == null || text(value.creator, 160)) && sourceUrl(value.sourceUrl) &&
    text(value.licenseId, 128) && sourceUrl(value.licenseUrl) && text(value.attribution, 4096, true) &&
    Array.isArray(value.modifications) && value.modifications.length <= 32 && value.modifications.every(item => text(item, 1024)) &&
    ['redistributable', 'private', 'unknown'].includes(value.declaredUse) && (value.licenseTextHash == null || hash(value.licenseTextHash) && licenses.has(value.licenseTextHash)), path, 'invalid rights reference');
  return value;
};

export async function prepareSoundContentPack(raw, { engineDescriptors = [], signal } = {}) {
  signal?.throwIfAborted();
  const pack = cloneData(raw, LIMITS);
  keysOnly(pack, ['schema', 'id', 'version', 'name', 'author', 'sourceUrl', 'licenseId', 'licenseUrl', 'attribution', 'modifications', 'redistributionPolicy',
    'files', 'patches', 'licenses', 'origin', 'compilation'], 'pack');
  assertContent(pack?.schema === SOUND_CONTENT_SCHEMA && id(pack.id) && text(pack.version, 64) && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pack.version) &&
    text(pack.name, 160) && text(pack.author, 160) && sourceUrl(pack.sourceUrl) && text(pack.licenseId, 128) && sourceUrl(pack.licenseUrl) &&
    text(pack.attribution, 4096, true) && Array.isArray(pack.modifications) && pack.modifications.length <= 32 && pack.modifications.every(item => text(item, 1024)) &&
    ['portable', 'project-only', 'reference-only', 'unknown'].includes(pack.redistributionPolicy), 'pack', 'unsupported pack header');
  assertContent(Array.isArray(pack.files) && pack.files.length <= 512 && Array.isArray(pack.patches) && pack.patches.length > 0 && pack.patches.length <= 256 &&
    Array.isArray(pack.licenses) && pack.licenses.length <= 128 && Array.isArray(engineDescriptors) && engineDescriptors.length <= 256, 'pack', 'inventory exceeds its bounds');
  const licenses = new Map();
  for (const license of pack.licenses) {
    keysOnly(license, ['id', 'sha256', 'text', 'url'], 'licenses');
    signal?.throwIfAborted();
    assertContent(license && text(license.id, 128) && hash(license.sha256) && text(license.text, 32768) && sourceUrl(license.url) && !licenses.has(license.sha256), 'licenses', 'invalid license snapshot');
    assertContent(await hashDataText(license.text) === license.sha256, 'licenses.' + license.id, 'license snapshot hash mismatch'); licenses.set(license.sha256, license);
  }
  const files = new Map(), paths = new Set(); let totalBytes = 0;
  const rightsDigests = new Map(), fileRights = new Map();
  const rightsDigest = async value => {
    const encoded = canonicalDataText(value, { maxBytes: 65536, maxNodes: 2048, domain: 'Sound rights' });
    if (!rightsDigests.has(encoded.text)) rightsDigests.set(encoded.text, hashDataText(encoded.text));
    return rightsDigests.get(encoded.text);
  };
  for (const file of pack.files) {
    signal?.throwIfAborted();
    keysOnly(file, ['path', 'sha256', 'bytes', 'kind', 'mediaType', 'parents', 'rights'], 'files');
    assertContent(file && localPath(file.path) && !paths.has(file.path) && hash(file.sha256) && !files.has(file.sha256) && natural(file.bytes, 16 * 1048576) &&
      fileKinds.includes(file.kind) && !/\.(?:[cm]?js|wasm|html|svg)$/i.test(file.path) &&
      (['sample', 'impulse-response'].includes(file.kind) ? ['audio/wav', 'audio/x-wav'].includes(file.mediaType) : ['application/json', 'application/octet-stream'].includes(file.mediaType)) &&
      Array.isArray(file.parents) && file.parents.length <= 32 && new Set(file.parents).size === file.parents.length && file.parents.every(hash), 'files', 'invalid asset inventory');
    assertContent(rights(file.rights, 'files.' + file.path + '.rights', licenses), 'files', 'invalid asset rights');
    assertContent(['sample-recording', 'derived-data'].includes(file.rights.kind), 'files.' + file.path, 'engine or recipe rights cannot stand in for recorded/derived asset rights');
    totalBytes += file.bytes; assertContent(totalBytes <= 256 * 1048576, 'files', 'declared source bytes exceed the pack limit');
    paths.add(file.path); files.set(file.sha256, file);
    fileRights.set(file.sha256, await rightsDigest(file.rights));
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
    keysOnly(entry, ['definition', 'engineRequirement', 'dependencies', 'rights'], 'patches');
    const patch = entry?.definition, requirement = entry?.engineRequirement, identity = patch?.id + '@' + patch?.revision;
    keysOnly(requirement, ['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'], 'patches.engineRequirement');
    if (patch?.schemaVersion === 2) keysOnly(patch, ['schemaVersion', 'id', 'revision', 'name', 'author', 'tags', 'engineId', 'engineVersion', 'parameters',
      'modulations', 'sampleRefs', 'sampleMap', 'seedLayers', 'macros', 'causalBindings', 'variation', 'voicePolicy', 'mix', 'midiFallback'], 'patches.definition');
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
      engineRequirement: requirement, rights: entry.rights, rightsHash: await rightsDigest(entry.rights), state, reason });
  }
  signal?.throwIfAborted();
  if (pack.origin != null) {
    keysOnly(pack.origin, ['id', 'version', 'contentHash'], 'origin');
    assertContent(id(pack.origin.id) && text(pack.origin.version, 64) && hash(pack.origin.contentHash), 'origin', 'invalid immutable source reference');
  }
  if (pack.compilation != null) {
    const compilation = pack.compilation; keysOnly(compilation, ['compilerRevision', 'sourceHash', 'schemaRevision', 'artifacts', ...(compilation.compilerRevision === 'typed-recipes-v13' ? ['realizationGroups'] : [])], 'compilation');
    assertContent(['typed-recipes-v1', 'typed-recipes-v2', 'typed-recipes-v3', 'typed-recipes-v4', 'typed-recipes-v5', 'typed-recipes-v6', 'typed-recipes-v7', 'typed-recipes-v8', 'typed-recipes-v9', 'typed-recipes-v10', 'typed-recipes-v11', 'typed-recipes-v12', 'typed-recipes-v13'].includes(compilation.compilerRevision) && compilation.schemaRevision === 'lemmings-sound-recipes/v1' && hash(compilation.sourceHash) &&
      Array.isArray(compilation.artifacts) && compilation.artifacts.length === patches.length && compilation.artifacts.every(artifact => artifact && typeof artifact === 'object' && !Array.isArray(artifact)) &&
      new Set(compilation.artifacts.map(artifact => artifact.id + '@' + artifact.revision)).size === patches.length,
    'compilation', 'unsupported compilation inventory');
    for (const artifact of compilation.artifacts) {
      keysOnly(artifact, ['id', 'revision', 'display', 'renderKey', 'rightsHash', 'engineRequirement', 'inheritance', 'overrides', 'parameters', 'macros', 'modulationBounds', 'cost', 'audition'], 'compilation.artifacts');
      assertContent(identities.has(artifact.id + '@' + artifact.revision) && hash(artifact.renderKey) && hash(artifact.rightsHash) && Array.isArray(artifact.inheritance) &&
        artifact.inheritance.length <= 33 && artifact.inheritance.every(id) && Array.isArray(artifact.overrides) && artifact.overrides.length <= 128 && artifact.overrides.every(value => text(value, 256)) &&
        Array.isArray(artifact.parameters) && artifact.parameters.length <= 128 && Array.isArray(artifact.macros) && artifact.macros.length <= 4 &&
        Array.isArray(artifact.modulationBounds) && artifact.modulationBounds.length <= 64, 'compilation.artifacts', 'invalid compiler explanation bounds');
      compilerArtifact(artifact, patches.find(patch => patch.identity === artifact.id + '@' + artifact.revision), compilation.compilerRevision);
    }
    if (compilation.compilerRevision === 'typed-recipes-v13') {
      assertContent(Array.isArray(compilation.realizationGroups) && compilation.realizationGroups.length <= 32, 'compilation.realizationGroups', 'invalid bounded realization inventory');
      let rebuilt;
      try { rebuilt = await compileSoundRealizationGroups(compilation.realizationGroups.map(group => group.authored), patches.map(patch => ({ definition: patch.archivedDefinition, dependencies: patch.dependencies, engineRequirement: patch.engineRequirement, artifact: compilation.artifacts.find(artifact => artifact.id === patch.archivedDefinition.id) }))); }
      catch (error) { throw fail('invalid-content', 'compilation.realizationGroups: ' + error.message); }
      assertContent(canonicalDataText(rebuilt).text === canonicalDataText(compilation.realizationGroups).text, 'compilation.realizationGroups', 'realizations differ from their actual archived patches or import claims runtime qualification');
    }

  }
  const normalized = { ...pack, files: pack.files.map(file => ({ ...file, parents: [...file.parents].sort() })).sort((a, b) => before(a.path, b.path)),
    licenses: [...pack.licenses].sort((a, b) => before(a.sha256, b.sha256)),
    patches: pack.patches.map(entry => ({ ...entry, dependencies: [...entry.dependencies].sort() })).sort((a, b) => before(a.definition.id + '@' + a.definition.revision, b.definition.id + '@' + b.definition.revision)) };
  patches.sort((a, b) => before(a.identity, b.identity));
  const encoded = canonicalDataText(normalized, LIMITS);
  const result = freezeData({ schema: SOUND_CONTENT_SCHEMA, contentHash: await hashDataText(encoded.text), manifestBytes: encoded.bytes.byteLength, pack: normalized, patches, totalBytes,
    qualification: 'bounded-declarative-inventory-only' });
  preparedPacks.set(result, { fileRights }); return result;
}

export function planSoundContentSelection(prepared, selection, { availableHashes = [], reviewRights = () => ({ decision: 'unknown' }) } = {}) {
  assertContent(preparedPacks.has(prepared) && Array.isArray(selection) && selection.length > 0 && selection.length <= 256 &&
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
  const credits = [...patches.map(patch => ({ subject: patch.identity, contentHash: patch.definitionHash, rightsHash: patch.rightsHash, kind: 'patch-recipe', rights: patch.rights })),
    ...files.map(file => ({ subject: file.sha256, contentHash: file.sha256, rightsHash: preparedPacks.get(prepared).fileRights.get(file.sha256), kind: file.kind, rights: file.rights }))].map(entry => {
    let decision;
    try { decision = reviewRights(Object.freeze(entry)); } catch { decision = { decision: 'unknown' }; }
    const complete = entry.rights.creator && entry.rights.sourceUrl && entry.rights.licenseTextHash && entry.rights.licenseId !== 'NOASSERTION';
    return { ...entry, redistribution: complete && entry.rights.declaredUse === 'redistributable' && decision?.decision === 'allow' &&
      decision.contentHash === entry.contentHash && decision.rightsHash === entry.rightsHash && text(decision.receiptId, 256) ? 'allowed' :
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
