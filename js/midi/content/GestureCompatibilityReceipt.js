import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validateGestureCompatibilityReceipt(raw, reference = null) {
  if (raw == null) return null;
  const value = JSON.parse(canonicalDataText(raw, { maxBytes: 16384, maxNodes: 1024 }).text), patch = value.patchReceipt;
  if (value.schema !== 'lemmings-gesture-compatibility-receipt/v1' || !hash(value.requestHash) || value.descriptorHash !== null && !hash(value.descriptorHash) ||
      !['immutable-intent-compatible', 'measured-compatible', 'requires-reinterpretation', 'requires-reconstruction', 'unknown', 'measured-failure', 'unsupported'].includes(value.state) ||
      ['immutable-intent-compatible', 'measured-compatible'].includes(value.state) && !hash(value.descriptorHash) ||
      !patch || !['packHash', 'definitionHash'].every(key => hash(patch[key])) || !patch.engineRequirement || !['artifactHash', 'parameterSchemaHash'].every(key => hash(patch.engineRequirement[key])) ||
      typeof patch.patchIdentity !== 'string' || patch.patchIdentity.length > 256 || !Array.isArray(value.explanations) || value.explanations.length > 8 || value.explanations.some(item => typeof item !== 'string' || item.length > 512) ||
      value.take != null && (!hash(value.take.canonicalHash) || typeof value.take.takeId !== 'string' || value.take.takeId.length > 256 || !Number.isSafeInteger(value.take.revision) || value.take.revision < 1) ||
      value.scope !== 'exact-query-source-and-local-report-reference;not-new-render-or-listening-acceptance') throw new Error('Keep the exact bounded compatibility request/descriptor/patch/take reference.');
  if (reference && (reference.packHash !== patch.packHash || reference.definitionHash !== patch.definitionHash || reference.patchId + '@' + reference.revision !== patch.patchIdentity ||
      ['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].some(key => reference.engineRequirement[key] !== patch.engineRequirement[key]))) throw new Error('The kept compatibility evidence describes another exact instrument revision.');
  return freezeData(value);
}
