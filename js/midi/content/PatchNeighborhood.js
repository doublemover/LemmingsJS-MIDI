import { cloneData, freezeData, hashData } from '../../core/CanonicalData.js';
import { validateEngineDescriptor } from './InstrumentPatchV2.js';
import { validateSoundContentReference } from './SoundContentReference.js';
import { createResolvedPatchRecipeSource, compileSoundContent } from './SoundContentCompiler.js';
import { PATCH_NEIGHBORHOOD_RECEIPT_SCHEMA } from './PatchNeighborhoodProvenance.js';
import { findPatchNeighborhood } from './AuthoredPatchNeighborhoods.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const before = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'PatchNeighborhoodError', code }); };
const requireValue = (condition, code, message) => { if (!condition) fail(code, message); };
const current = (signal, isCurrent) => { signal?.throwIfAborted(); if (!isCurrent()) fail('stale-source', 'The selected parent or generation changed.'); };

export async function generatePatchNeighborhood({ prepared, reference: rawReference, descriptor: rawDescriptor, neighborhoodId = null,
  seed = 0, coordinates: rawCoordinates = {}, amount01 = 0.5, locks: rawLocks = {}, count = 4, signal, isCurrent = () => true,
  compile = compileSoundContent, onCandidate = null } = {}) {
  current(signal, isCurrent);
  requireValue(Number.isInteger(seed) && seed >= -2147483648 && seed <= 2147483647 && Number.isInteger(count) && count >= 1 && count <= 8 &&
    Number.isFinite(amount01) && amount01 >= 0 && amount01 <= 1, 'invalid-input', 'Use an int32 seed, one to eight candidates and an amount between zero and one.');
  const reference = validateSoundContentReference(rawReference), descriptor = validateEngineDescriptor(rawDescriptor);
  requireValue(reference, 'invalid-parent', 'Choose a complete immutable parent reference.');
  const neighborhood = findPatchNeighborhood(descriptor.engineId, neighborhoodId);
  requireValue(neighborhood && neighborhood.engineVersion === descriptor.engineVersion, 'unsupported-neighborhood', 'This exact engine has no authored neighborhood.');
  requireValue(!reference.drumKit, 'compound-parent', 'Choose an individual Circuit voice; a complete drum kit cannot be silently replaced by one patch.');
  requireValue(descriptor.engineId !== 'worklet-sample' || reference.definition.sampleMap?.zones.length === 1,
    'compound-parent', 'The Circuit neighborhood requires one resolved sample voice, with its exact material retained.');
  requireValue(prepared?.contentHash === reference.packHash && reference.definition.engineId === descriptor.engineId &&
    ['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => reference.engineRequirement[key] === descriptor[key]),
  'changed-parent', 'The selected parent and its exact engine requirement must still be available.');
  const parameters = new Map(descriptor.parameters.map(spec => [spec.id, spec]));
  const coordinates = cloneData(rawCoordinates), axes = neighborhood.axes;
  requireValue(coordinates && typeof coordinates === 'object' && !Array.isArray(coordinates) &&
    Object.keys(coordinates).every(key => axes.some(axis => axis.id === key)) && Object.values(coordinates).every(value => Number.isFinite(value) && value >= -1 && value <= 1),
  'invalid-coordinates', 'Neighborhood coordinates must name authored axes and stay between minus one and one.');
  const requestedCoordinates = Object.fromEntries(axes.map(axis => [axis.id, coordinates[axis.id] ?? axis.default]));
  const locks = cloneData(rawLocks);
  requireValue(locks && typeof locks === 'object' && !Array.isArray(locks) && Object.keys(locks).every(key => ['parameters', 'macros'].includes(key)), 'invalid-locks', 'Unknown neighborhood lock fields.');
  const parameterLocks = locks.parameters ?? [], macroLocks = locks.macros ?? [];
  requireValue(Array.isArray(parameterLocks) && parameterLocks.length <= 128 && new Set(parameterLocks).size === parameterLocks.length && parameterLocks.every(key => parameters.has(key)) &&
    Array.isArray(macroLocks) && macroLocks.length <= 4 && new Set(macroLocks).size === macroLocks.length && macroLocks.every(key => reference.definition.macros.some(macro => macro.id === key)),
  'invalid-locks', 'Locks must name unique existing parameters or macros.');
  const effectiveLocks = new Set(parameterLocks);
  for (const macro of reference.definition.macros) if (macroLocks.includes(macro.id)) for (const target of macro.targets) effectiveLocks.add(target.parameter);
  requireValue(effectiveLocks.size <= 128, 'invalid-locks', 'The macro locks exceed the bounded parameter lock inventory.');
  const pinnedLocks = { parameters: [...effectiveLocks].sort(before), macros: [...macroLocks].sort(before) };
  for (const axis of axes) for (const mapping of axis.mappings) {
    const spec = parameters.get(mapping.parameter);
    requireValue(spec && !spec.discrete && spec.unit === mapping.unit, 'unsupported-parameter', 'The exact engine does not admit authored parameter ' + mapping.parameter + '.');
  }
  const profile = (prepared.pack.compilation?.realizationGroups || []).flatMap(group => group.profiles)
    .find(entry => entry.patchIdentity === reference.patchId + '@' + reference.revision && entry.definitionHash === reference.definitionHash);
  const batchInput = { algorithmRevision: 'authored-neighborhoods-v1', neighborhoodId: neighborhood.id, neighborhoodVersion: neighborhood.version,
    seed, amount01, requestedCoordinates, locks: pinnedLocks, parent: { patchId: reference.patchId, revision: reference.revision,
      packHash: reference.packHash, definitionHash: reference.definitionHash }, engineRequirement: reference.engineRequirement,
    scope: 'one-pinned-realization', parentProfile: profile?.id || null };
  const batchId = await hashData(batchInput), candidates = [], parameterSignatures = new Set();
  for (let slot = 0; slot < count; slot++) {
    current(signal, isCurrent);
    const sampleCoordinates = {};
    for (const axis of axes) {
      const digest = await hashData([batchId, slot, axis.id]);
      const jitter = Number.parseInt(digest.slice(0, 13), 16) / 0xfffffffffffff * 2 - 1;
      sampleCoordinates[axis.id] = clamp(requestedCoordinates[axis.id] + jitter * 0.25, -1, 1) * amount01;
    }
    const candidateId = 'variation.' + await hashData([batchId, slot]), name = (reference.definition.name.slice(0, 142) + ' variation ' + (slot + 1));
    const base = reference.definition.parameters, next = { ...base }, mutations = new Map(), changes = [];
    let candidate;
    try {
      for (const axis of axes) for (const mapping of axis.mappings) {
        if (effectiveLocks.has(mapping.parameter)) continue;
        const accumulated = mutations.get(mapping.parameter) || { octaves: 0, offset: 0 };
        accumulated[mapping.mode] += sampleCoordinates[axis.id] * mapping.span; mutations.set(mapping.parameter, accumulated);
      }
      for (const [parameter, mutation] of mutations) {
        const spec = parameters.get(parameter), previous = base[parameter] ?? spec.default;
        const requested = previous * 2 ** mutation.octaves + mutation.offset, value = clamp(requested, spec.min, spec.max);
        requireValue(Number.isFinite(requested), 'unsafe-parameter', 'A candidate exceeded the finite parameter domain.');
        if (!Object.is(previous, value) || !Object.is(requested, value)) next[parameter] = value;
        if (!Object.is(previous, value) || !Object.is(requested, value)) changes.push({ parameter, unit: spec.unit, previous, requested, value, clamped: !Object.is(requested, value) });
      }
      for (const constraint of neighborhood.constraints) {
        const read = (values, key) => values[key] ?? parameters.get(key).default;
        requireValue(constraint.kind === 'preserve-order' && Math.sign(read(next, constraint.first) - read(next, constraint.second)) ===
          Math.sign(read(base, constraint.first) - read(base, constraint.second)), 'constraint-conflict',
        'The candidate would reverse the authored ' + constraint.first + '/' + constraint.second + ' contour; locks remain unchanged.');
      }
      const provenance = { schema: PATCH_NEIGHBORHOOD_RECEIPT_SCHEMA, ...batchInput, slot, sampleCoordinates, changes };
      const source = await createResolvedPatchRecipeSource({ prepared, reference, descriptor, candidateId, name, parameters: next, provenance, signal });
      current(signal, isCurrent);
      const compiled = await compile(source, { targets: [{ descriptor }], signal });
      current(signal, isCurrent);
      const patch = compiled.prepared.patches[0];
      requireValue(patch?.state === 'definition-admitted', 'prepare-refused', patch?.reason || 'The generated definition could not prepare.');
      const signature = await hashData(next), duplicateLike = parameterSignatures.has(signature) || changes.length === 0;
      parameterSignatures.add(signature);
      candidate = { id: candidateId, slot, name, state: 'compiled', duplicateLike, provenance, compiled,
        reference: { schema: reference.schema, packHash: compiled.prepared.contentHash, patchId: candidateId, revision: 1,
          definitionHash: patch.definitionHash, engineRequirement: patch.engineRequirement, assetHashes: [...patch.dependencies].sort(before), definition: patch.archivedDefinition },
        qualification: 'compiled-data-not-render-qualified' };
    } catch (error) {
      current(signal, isCurrent);
      if (error?.name === 'AbortError') throw error;
      candidate = { id: candidateId, slot, name, state: 'rejected', code: error.code || 'invalid-candidate', reason: String(error.message).slice(0, 1024), sampleCoordinates };
    }
    candidates.push(freezeData(candidate));
    onCandidate?.(candidate);
    current(signal, isCurrent);
  }
  return freezeData({ schema: 'lemmings-patch-neighborhood-batch/v1', id: batchId, ...batchInput, candidates,
    counts: { requested: count, compiled: candidates.filter(entry => entry.state === 'compiled').length,
      rejected: candidates.filter(entry => entry.state === 'rejected').length, duplicateLike: candidates.filter(entry => entry.duplicateLike).length },
    qualification: 'compiled-data-not-render-qualified' });
}
