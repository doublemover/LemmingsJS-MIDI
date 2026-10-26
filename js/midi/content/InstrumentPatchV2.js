import { validSealedBodyParameters } from './SealedBodyProfile.js';
import { prepareWindModel, WIND_MODEL_KINDS } from './WindModel.js';
import { prepareFrictionModel, FRICTION_MODEL_KINDS } from './FrictionModel.js';
import { validTextureBodyCommand, textureBodyCommandFields } from './TextureBodyProfile.js';
import { prepareTextureExciter, TEXTURE_EXCITER_KINDS } from './TextureExciter.js';
import { resolveCircularSpectrum, circularSpectrumParameters, validateCircularCoordinateControl } from './CircularSpectrum.js';
import { validateInstrumentMacros, validateInstrumentBindings } from './InstrumentPerformance.js';
import { validateInstrumentVariation } from './InstrumentIdentityVariation.js';
import { validateSampleInstrumentMap, OWNED_SAMPLE_MAP_PROFILE, NATIVE_SAMPLE_MAP_PROFILE } from './SampleInstrumentMap.js';
import { canonicalDataText, cloneData } from '../../core/CanonicalData.js';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const id = value => typeof value === 'string' && /^[a-z][a-z0-9._:-]{0,127}$/i.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const text = (value, max = 160) => typeof value === 'string' && value.length > 0 && value.length <= max;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const safeKeys = value => plain(value) && Object.keys(value).every(key => id(key) && !['__proto__', 'constructor', 'prototype'].includes(key));
const freeze = value => {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
  return value;
};

// The descriptor belongs to the actual engine implementation. Patch content
// cannot invent capabilities or parameter ranges by declaring them itself.
const validateEngineDescriptor = input => {
  if (!plain(input) || !id(input.engineId) || !integer(input.engineVersion, 1, 65535) || !hash(input.artifactHash) ||
      !hash(input.parameterSchemaHash) || !Array.isArray(input.parameters) || input.parameters.length > 128 ||
      !plain(input.capabilities) || input.maximumVoices != null && !integer(input.maximumVoices, 1, 1024) ||
      input.voicePolicies != null && (!Array.isArray(input.voicePolicies) || !input.voicePolicies.length || input.voicePolicies.length > 3 ||
        new Set(input.voicePolicies).size !== input.voicePolicies.length || input.voicePolicies.some(policy => !['reject', 'oldest', 'quietest'].includes(policy)))) throw new Error('Invalid instrument engine descriptor.');
  const ids = new Set();
  const parameters = input.parameters.map(parameter => {
    if (!plain(parameter) || !id(parameter.id) || ids.has(parameter.id) || !text(parameter.unit, 32) ||
        !finite(parameter.min, -1000000000, 1000000000) || !finite(parameter.max, -1000000000, 1000000000) ||
        parameter.min >= parameter.max || !finite(parameter.default, parameter.min, parameter.max) ||
        !['linear', 'logarithmic'].includes(parameter.interpolation) ||
        (parameter.interpolation === 'logarithmic' && parameter.min <= 0) ||
        (parameter.discrete === true && !integer(parameter.default, parameter.min, parameter.max)) ||
        (parameter.capability != null && !id(parameter.capability))) throw new Error('Invalid instrument parameter descriptor.');
    ids.add(parameter.id);
    return { id: parameter.id, unit: parameter.unit, min: parameter.min, max: parameter.max, default: parameter.default,
      interpolation: parameter.interpolation, discrete: parameter.discrete === true, liveSafe: parameter.liveSafe === true, causalLiveSafe: parameter.causalLiveSafe === true,
      capability: parameter.capability == null ? null : String(parameter.capability) };
  });
  const capabilities = {};
  for (const [key, value] of Object.entries(input.capabilities)) {
    if (!id(key) || typeof value !== 'boolean') throw new Error('Invalid instrument capability.');
    capabilities[key] = value;
  }
  return freeze({ engineId: input.engineId, engineVersion: input.engineVersion, artifactHash: input.artifactHash.toLowerCase(),
    parameterSchemaHash: input.parameterSchemaHash.toLowerCase(),
    parameters, capabilities, maximumVoices: input.maximumVoices ?? null, voicePolicies: input.voicePolicies == null ? null : [...input.voicePolicies] });
};

const validateInstrumentPatchV2 = (input, descriptor) => {
  if (!plain(input) || input.schemaVersion !== 2 || !id(input.id) || !integer(input.revision, 1, 2147483647) ||
      !text(input.name) || !text(input.author) || !Array.isArray(input.tags) || input.tags.length > 16 ||
      input.tags.some(tag => !id(tag)) || !id(input.engineId) || !integer(input.engineVersion, 1, 65535) ||
      !safeKeys(input.parameters) || Object.keys(input.parameters).length > 128 ||
      !Array.isArray(input.modulations) || input.modulations.length > 64 ||
      !Array.isArray(input.sampleRefs) || input.sampleRefs.length > 32 ||
      !Array.isArray(input.macros) || input.macros.length > 4 ||
      !Array.isArray(input.causalBindings) || input.causalBindings.length > 64 ||
      !plain(input.voicePolicy) || !plain(input.mix)) throw new Error('Invalid InstrumentPatchV2.');
  const engine = validateEngineDescriptor(descriptor);
  if (input.engineId !== engine.engineId || input.engineVersion !== engine.engineVersion) throw new Error('Patch engine revision is unavailable.');
  if (engine.capabilities.modulationGraph === false && input.modulations.length || engine.capabilities.macroPerformance === false && input.macros.length ||
      engine.capabilities.causalBindings === false && input.causalBindings.length || engine.capabilities.samples === false && input.sampleRefs.length)
    throw new Error('Patch mappings or samples are not realized by this engine.');
  const schema = new Map(engine.parameters.map(parameter => [parameter.id, parameter]));
  const parameters = {};
  for (const [key, value] of Object.entries(input.parameters)) {
    const parameter = schema.get(key);
    if (!parameter || !finite(value, parameter.min, parameter.max) || parameter.discrete && !Number.isInteger(value) ||
        parameter.capability && !engine.capabilities[parameter.capability]) throw new Error(`Unsupported patch parameter: ${key}.`);
    parameters[key] = value;
  }
  const modulationIds = new Set(), dependencies = new Map();
  const modulations = input.modulations.map(item => {
    if (!plain(item) || !id(item.id) || modulationIds.has(item.id) || !id(item.target) || !schema.has(item.target) ||
        (schema.get(item.target).capability && !engine.capabilities[schema.get(item.target).capability]) ||
        !text(item.source, 128) || !finite(item.amount, -1000000, 1000000) ||
        !finite(item.smoothingMs, 0, 60000) || !['linear', 'logarithmic', 'step'].includes(item.curve)) throw new Error('Invalid patch modulation.');
    const target = schema.get(item.target), mode = item.mode ?? 'onset-only';
    if (!['onset-only', 'continuous'].includes(mode) || mode === 'continuous' && !target.liveSafe || mode === 'onset-only' && item.smoothingMs !== 0 ||
        target.discrete && (item.curve !== 'step' || !Number.isInteger(item.amount))) throw new Error('Invalid modulation application semantics.');
    modulationIds.add(item.id);
    if (item.source.startsWith('parameter:')) {
      const sourceId = item.source.slice('parameter:'.length);
      const source = schema.get(sourceId);
      if (!source || source.capability && !engine.capabilities[source.capability]) throw new Error('Unknown or unavailable modulation source parameter.');
      if (item.mode === 'continuous' && !source.liveSafe) throw new Error('Init-only modulation source cannot drive continuous modulation.');
      (dependencies.get(sourceId) || (dependencies.set(sourceId, []), dependencies.get(sourceId))).push(item.target);
    } else if (!item.source.startsWith('physical:') || !id(item.source.slice('physical:'.length))) throw new Error('Unsupported modulation source.');
    return { id: item.id, source: item.source, target: item.target, mode, amount: item.amount, smoothingMs: item.smoothingMs, curve: item.curve };
  });
  const visited = new Set(), visiting = new Set();
  const visit = source => {
    if (visiting.has(source)) throw new Error('Cyclic patch modulation.');
    if (visited.has(source)) return;
    visiting.add(source);
    for (const target of dependencies.get(source) || []) visit(target);
    visiting.delete(source); visited.add(source);
  };
  for (const source of dependencies.keys()) visit(source);
  if (['worklet-wind', 'worklet-friction'].includes(input.engineId) && !validSealedBodyParameters(input.parameters)) throw new TypeError('A sealed outer body needs bounded modes and its complete four-second parent tail.');
  if (input.engineId === 'worklet-wind') prepareWindModel({ kind: WIND_MODEL_KINDS[input.parameters.windKind ?? 0], air01: input.parameters.airPressure01 ?? 0.35, bite01: input.parameters.bite01 ?? 0.5, lengthRatio: input.parameters.acousticLengthRatio ?? 1, leak01: input.parameters.breathLeak01 ?? 0.25, bell01: input.parameters.bellOpening01 ?? 0.35 });
  if (input.engineId === 'worklet-friction') prepareFrictionModel({ kind: FRICTION_MODEL_KINDS[input.parameters.frictionKind ?? 0], dragSlope: input.parameters.frictionDragSlope ?? 0.5, pressure01: input.parameters.frictionPressure01 ?? 0.4, contactPosition01: input.parameters.frictionContact01 ?? 0.18, bodyMix01: input.parameters.frictionBodyMix01 ?? 0.12 });
  if (input.engineId === 'worklet-texture' && !validTextureBodyCommand(textureBodyCommandFields(input.parameters), 20, 48000)) throw new TypeError('Invalid texture body calibration or signed observation.');
  if (input.engineId === 'worklet-texture') prepareTextureExciter({ kind: TEXTURE_EXCITER_KINDS[input.parameters.textureKind ?? 0], roughnessPerPixel: input.parameters.roughnessPerPixel ?? 0.4, dragSlope: input.parameters.dragSlope ?? 0.5, shade01: input.parameters.shade01 ?? 0.5, bodySeconds: input.parameters.textureBodySeconds ?? 0.05 });
  if (input.engineId === 'worklet-spectrum' && input.parameters.sourceMode === 2) {
    const resolved = Object.fromEntries(engine.parameters.map(spec => [spec.id, input.parameters[spec.id] ?? spec.default]));
    resolveCircularSpectrum(circularSpectrumParameters(resolved), 48000); validateCircularCoordinateControl(resolved);
  }
  const sampleIds = new Set();
  const sampleRefs = input.sampleRefs.map(sample => {
    if (!plain(sample) || !id(sample.id) || sampleIds.has(sample.id) || !hash(sample.sha256) ||
        !integer(sample.bytes, 0, 268435456)) throw new Error('Invalid patch sample reference.');
    sampleIds.add(sample.id);
    return { id: sample.id, sha256: sample.sha256.toLowerCase(), bytes: sample.bytes, required: sample.required !== false };
  });
  if (input.sampleMap != null && engine.capabilities.sampleMaps !== true || ['native-sample', 'worklet-sample'].includes(input.engineId) && input.sampleMap == null)
    throw new Error('An authored resolved sample map is required for this engine capability.');
  const sampleMap = input.sampleMap == null ? null : validateSampleInstrumentMap(input.sampleMap, sampleRefs, {
    rendererProfile: engine.capabilities.advancedSampleMaps === true ? OWNED_SAMPLE_MAP_PROFILE : NATIVE_SAMPLE_MAP_PROFILE });
  const macros = validateInstrumentMacros(input.macros, engine.parameters);
  if (engine.capabilities.continuousMacroPerformance === false && macros.some(macro => macro.mode === 'continuous')) throw new Error('Continuous macros are unavailable on this engine.');
  if (macros.some(macro => macro.targets.some(target => schema.get(target.parameter).capability && !engine.capabilities[schema.get(target.parameter).capability]))) throw new Error('Unsupported macro target capability.');
  const causalBindings = validateInstrumentBindings(input.causalBindings, engine.parameters);
  if (causalBindings.some(binding => binding.mode === 'continuous') && engine.capabilities.continuousPhysicalBindings !== true) throw new Error('Continuous physical bindings are unavailable on this engine.');
  if (causalBindings.some(binding => schema.get(binding.target).capability && !engine.capabilities[schema.get(binding.target).capability])) throw new Error('Unsupported physical target capability.');
  const variation = validateInstrumentVariation(input.variation, engine.parameters);
  if (variation && engine.capabilities.identityVariation !== true) throw new Error('Identity variation is not realized by this engine.');
  if (!integer(input.voicePolicy.maxVoices, 1, 1024) || !['oldest', 'quietest', 'reject'].includes(input.voicePolicy.steal) ||
      !finite(input.mix.gain01, 0, 1) || !finite(input.mix.pan01, -1, 1)) throw new Error('Invalid patch voice or mix policy.');
  if (engine.maximumVoices != null && input.voicePolicy.maxVoices > engine.maximumVoices || engine.voicePolicies && !engine.voicePolicies.includes(input.voicePolicy.steal))
    throw new Error('Patch voice policy is not realized by this engine.');
  const midiFallback = input.midiFallback == null ? null : input.midiFallback;
  if (midiFallback && (!plain(midiFallback) || !integer(midiFallback.bankMSB, 0, 127) ||
      !integer(midiFallback.bankLSB, 0, 127) || !integer(midiFallback.program, 0, 127) ||
      !plain(midiFallback.percussionMap || {}) || Object.entries(midiFallback.percussionMap || {}).some(([key, value]) =>
    !integer(Number(key), 0, 127) || !integer(value, 0, 127)))) throw new Error('Invalid MIDI fallback.');
  return freeze({ schemaVersion: 2, id: input.id, revision: input.revision, name: input.name, author: input.author,
    tags: input.tags, engineId: input.engineId, engineVersion: input.engineVersion, parameters,
    modulations, sampleRefs, ...(sampleMap ? { sampleMap } : {}), voicePolicy: { maxVoices: input.voicePolicy.maxVoices, steal: input.voicePolicy.steal },
    mix: { gain01: input.mix.gain01, pan01: input.mix.pan01 }, macros, causalBindings, ...(variation ? { variation } : {}),
    midiFallback: midiFallback && { bankMSB: midiFallback.bankMSB, bankLSB: midiFallback.bankLSB,
      program: midiFallback.program, percussionMap: midiFallback.percussionMap || {} } });
};

const migrateInstrumentPatchParameters = (source, descriptor, renames, nextRevision) => {
  if (!plain(source) || source.schemaVersion !== 2 || !safeKeys(source.parameters) || !Array.isArray(source.modulations) ||
      !Array.isArray(source.macros) || !Array.isArray(source.causalBindings) || !safeKeys(renames) || !integer(nextRevision, 1, 2147483647) ||
      nextRevision <= source.revision) throw new Error('Invalid patch migration request.');
  const parameters = { ...source.parameters };
  for (const [from, to] of Object.entries(renames)) {
    if (!id(to) || !Object.hasOwn(parameters, from) || Object.hasOwn(parameters, to)) throw new Error('Patch parameter migration conflicts with existing data.');
    parameters[to] = parameters[from]; delete parameters[from];
  }
  const rename = value => Object.hasOwn(renames, value) ? renames[value] : value;
  const migrated = validateInstrumentPatchV2({ ...source, revision: nextRevision, parameters,
    modulations: source.modulations.map(modulation => ({ ...modulation,
      source: modulation.source.startsWith('parameter:') ? `parameter:${rename(modulation.source.slice('parameter:'.length))}` : modulation.source,
      target: rename(modulation.target) })),
    macros: source.macros.map(macro => ({ ...macro, targets: macro.targets.map(target => ({ ...target, parameter: rename(target.parameter) })) })),
    causalBindings: source.causalBindings.map(binding => ({ ...binding, target: rename(binding.target) })),
    ...(source.variation ? { variation: { ...source.variation, targets: source.variation.targets.map(target => ({ ...target, parameter: rename(target.parameter) })),
      eventTargets: source.variation.eventTargets.map(target => ({ ...target, parameter: rename(target.parameter) })) } } : {}) }, descriptor);
  return Object.freeze({ patch: migrated, report: Object.freeze({ kind: 'parameter-rename', patchId: source.id,
    fromRevision: source.revision, toRevision: nextRevision,
    renamed: Object.freeze(Object.entries(renames).map(([from, to]) => Object.freeze({ from, to }))) }) });
};

const createInstrumentPatchRegistry = ({ maxDefinitions = 1024, maxUnsupported = 256, maxArchiveBytes = 16 * 1048576 } = {}) => {
  if (!integer(maxDefinitions, 1, 4096) || !integer(maxUnsupported, 0, 1024) || !integer(maxArchiveBytes, 65536, 64 * 1048576)) throw new Error('Invalid patch registry limits.');
  const definitions = new Map(), unsupported = new Map(), requirements = new Map(), identities = new Map();
  let archiveBytes = 0;
  const key = (patchId, revision) => `${patchId}@${revision}`;
  const encode = value => canonicalDataText(value, { maxBytes: 65536, maxNodes: 8192, domain: 'Instrument patch' });
  const registerBatch = (entries, { allowIdentical = true } = {}) => {
    if (!Array.isArray(entries) || !entries.length || entries.length > 256) throw new Error('Invalid patch registration batch.');
    const staged = [], seen = new Set(); let bytes = archiveBytes, added = 0;
    for (const entry of entries) {
      const descriptor = validateEngineDescriptor(entry?.descriptor), validated = validateInstrumentPatchV2(cloneData(entry.patch,
          { maxBytes: 65536, maxNodes: 8192, domain: 'Instrument patch' }), descriptor), identity = key(validated.id, validated.revision);
      if (seen.has(identity) || unsupported.has(identity)) throw new Error('Patch revision conflicts with an existing archive or batch.');
      seen.add(identity);
      const requirement = Object.freeze({ engineId: descriptor.engineId, engineVersion: descriptor.engineVersion,
        artifactHash: descriptor.artifactHash, parameterSchemaHash: descriptor.parameterSchemaHash });
      const encoded = encode({ definition: validated, engineRequirement: requirement }), previous = identities.get(identity);
      if (previous) {
        if (!allowIdentical || previous !== encoded.text) throw new Error('Patch revision is already registered with an immutable identity.');
        staged.push({ identity, definition: definitions.get(identity), existing: true }); continue;
      }
      bytes += encoded.bytes.byteLength;
      if (++added + definitions.size > maxDefinitions || bytes > maxArchiveBytes) throw new Error('Patch registry capacity exceeded.');
      staged.push({ identity, definition: validated, requirement, encoded });
    }
    for (const entry of staged) if (!entry.existing) {
      definitions.set(entry.identity, entry.definition); requirements.set(entry.identity, entry.requirement); identities.set(entry.identity, entry.encoded.text);
    }
    archiveBytes = bytes;
    return Object.freeze(staged.map(entry => entry.definition));
  };
  const readOnlyJson = json => {
    if (typeof json !== 'string' || json.length > 65536) throw new Error('Unsupported patch archive exceeds its size limit.');
    const parsed = JSON.parse(json), budget = { remaining: 2048 };
    const copy = (value, depth) => {
      if (--budget.remaining < 0 || depth > 8) throw new Error('Unsupported patch archive exceeds its structure limit.');
      if (value == null || typeof value === 'boolean') return value;
      if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Invalid archived patch value.'); return value; }
      if (typeof value === 'string') { if (value.length > 4096) throw new Error('Invalid archived patch string.'); return value; }
      if (Array.isArray(value)) { if (value.length > 256) throw new Error('Invalid archived patch array.'); return Object.freeze(value.map(item => copy(item, depth + 1))); }
      if (!plain(value) || Object.keys(value).length > 128) throw new Error('Invalid archived patch object.');
      const entries = Object.entries(value);
      if (entries.some(([property]) => !id(property))) throw new Error('Invalid archived patch key.');
      return Object.freeze(Object.fromEntries(entries.map(([property, item]) => [property, copy(item, depth + 1)])));
    };
    return copy(parsed, 0);
  };
  return {
    register(patch, descriptor) {
      return registerBatch([{ patch, descriptor }], { allowIdentical: false })[0];
    },
    registerBatch,
    retainUnsupportedJson(json) {
      const archived = readOnlyJson(json);
      if (!plain(archived) || !id(archived.id) || !integer(archived.revision, 1, 2147483647)) throw new Error('Invalid archived patch identity.');
      const identity = key(archived.id, archived.revision);
      if (definitions.has(identity)) throw new Error('A playable patch revision is already registered.');
      const encoded = encode(archived), previous = identities.get(identity);
      if (previous) {
        if (previous !== encoded.text) throw new Error('Archived patch revision has conflicting immutable bytes.');
        return unsupported.get(identity);
      }
      if (unsupported.size >= maxUnsupported || archiveBytes + encoded.bytes.byteLength > maxArchiveBytes) throw new Error('Patch registry capacity exceeded.');
      unsupported.set(identity, archived); identities.set(identity, encoded.text); archiveBytes += encoded.bytes.byteLength; return archived;
    },
    inspect(patchId, revision) { return definitions.get(key(patchId, revision)) || unsupported.get(key(patchId, revision)) || null; },
    inspectEngineRequirement(patchId, revision) { return requirements.get(key(patchId, revision)) || null; },
    diagnostics: () => Object.freeze({ definitions: definitions.size, unsupported: unsupported.size, archiveBytes, maxDefinitions, maxUnsupported, maxArchiveBytes,
      accounting: 'canonical-archive-bytes-not-heap-measurement' }),
    resolve(patchId, revision, { engineDescriptors = [], assetHashes = [], qualityTier = 'full', mappingRevision = 0 } = {}) {
      if (!id(qualityTier) || !integer(mappingRevision, 0, 2147483647) || !Array.isArray(engineDescriptors) || engineDescriptors.length > 256 ||
          !Array.isArray(assetHashes) || assetHashes.length > 512 || assetHashes.some(value => !hash(value))) throw new Error('Invalid patch resolution context.');
      const patch = definitions.get(key(patchId, revision));
      if (!patch) return Object.freeze({ status: 'unknown-patch-revision', patchId, revision,
        archivedDefinition: unsupported.get(key(patchId, revision)) || null });
      const engine = engineDescriptors.find(item => item.engineId === patch.engineId && item.engineVersion === patch.engineVersion);
      if (!engine) return Object.freeze({ status: 'engine-unavailable', patchId, revision, patch });
      let descriptor;
      try { descriptor = validateEngineDescriptor(engine); validateInstrumentPatchV2(patch, descriptor); }
      catch (error) { return Object.freeze({ status: 'engine-rejected', patchId, revision, patch, reason: String(error.message) }); }
      const pinned = requirements.get(key(patchId, revision));
      if (pinned.artifactHash !== descriptor.artifactHash || pinned.parameterSchemaHash !== descriptor.parameterSchemaHash)
        return Object.freeze({ status: 'engine-revision-mismatch', patchId, revision, patch, requiredEngine: pinned });
      const available = new Set(assetHashes.map(value => value.toLowerCase())), missing = patch.sampleRefs.filter(sample => sample.required && !available.has(sample.sha256));
      if (missing.length) return Object.freeze({ status: 'asset-missing', patchId, revision, patch,
        missingHashes: Object.freeze(missing.map(sample => sample.sha256)) });
      const missingOptional = patch.sampleRefs.filter(sample => !sample.required && !available.has(sample.sha256));
      const receipt = Object.freeze({ patchId, revision, engineArtifactHash: descriptor.artifactHash,
        parameterSchemaHash: descriptor.parameterSchemaHash, assetHashes: Object.freeze(patch.sampleRefs.filter(sample => available.has(sample.sha256)).map(sample => sample.sha256)),
        capabilityDecision: missingOptional.length ? 'degraded-optional-assets' : 'ready', qualityTier, mappingRevision });
      return Object.freeze({ status: missingOptional.length ? 'degraded' : 'ready', patch, receipt,
        missingOptionalHashes: Object.freeze(missingOptional.map(sample => sample.sha256)) });
    }
  };
};

export { validateEngineDescriptor, validateInstrumentPatchV2, migrateInstrumentPatchParameters, createInstrumentPatchRegistry };
