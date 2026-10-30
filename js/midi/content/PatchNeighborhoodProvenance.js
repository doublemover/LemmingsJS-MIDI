import { cloneData, freezeData } from '../../core/CanonicalData.js';

export const PATCH_NEIGHBORHOOD_RECEIPT_SCHEMA = 'lemmings-patch-neighborhood-receipt/v1';
const id = value => typeof value === 'string' && /^[a-z][a-z0-9._:-]{0,127}$/i.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const list = (values, maximum) => Array.isArray(values) && values.length <= maximum && new Set(values).size === values.length && values.every(id);
const fail = () => { throw new TypeError('Invalid authored patch neighborhood provenance.'); };

export function validatePatchNeighborhoodProvenance(raw, { definition = null, engineRequirement = null } = {}) {
  const value = cloneData(raw, { maxBytes: 65536, maxNodes: 8192, domain: 'Patch neighborhood provenance' }), parent = value?.parent;
  if (value?.schema !== PATCH_NEIGHBORHOOD_RECEIPT_SCHEMA || value.algorithmRevision !== 'authored-neighborhoods-v1' || !id(value.neighborhoodId) ||
      !Number.isSafeInteger(value.neighborhoodVersion) || value.neighborhoodVersion < 1 || !Number.isInteger(value.seed) || value.seed < -2147483648 || value.seed > 2147483647 ||
      !Number.isInteger(value.slot) || value.slot < 0 || value.slot > 7 || !finite(value.amount01, 0, 1) || !parent || !id(parent.patchId) ||
      !Number.isInteger(parent.revision) || parent.revision < 1 || !hash(parent.packHash) || !hash(parent.definitionHash) ||
      value.scope !== 'one-pinned-realization' || value.parentProfile !== null && !id(value.parentProfile) ||
      !list(value.locks?.parameters, 128) || !list(value.locks?.macros, 4) || !Array.isArray(value.changes) || value.changes.length > 32) fail();
  for (const coordinates of [value.requestedCoordinates, value.sampleCoordinates]) {
    if (!coordinates || typeof coordinates !== 'object' || Array.isArray(coordinates) || Object.keys(coordinates).length > 4 ||
        Object.entries(coordinates).some(([key, number]) => !id(key) || !finite(number, -1, 1))) fail();
  }
  const requirement = value.engineRequirement;
  if (!requirement || !id(requirement.engineId) || !Number.isInteger(requirement.engineVersion) || requirement.engineVersion < 1 ||
      !hash(requirement.artifactHash) || !hash(requirement.parameterSchemaHash) || engineRequirement &&
      ['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].some(key => requirement[key] !== engineRequirement[key])) fail();
  const changed = new Set();
  for (const change of value.changes) {
    if (!change || !id(change.parameter) || changed.has(change.parameter) || typeof change.unit !== 'string' || change.unit.length > 32 ||
        ![change.previous, change.requested, change.value].every(Number.isFinite) || typeof change.clamped !== 'boolean' ||
        value.locks.parameters.includes(change.parameter) && !Object.is(change.previous, change.value) ||
        definition && !Object.is(definition.parameters[change.parameter], change.value)) fail();
    changed.add(change.parameter);
  }
  if (definition && value.locks.macros.some(macroId => !definition.macros.some(macro => macro.id === macroId))) fail();
  return freezeData(value);
}
