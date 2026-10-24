const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const id = value => typeof value === 'string' && /^[a-z][a-z0-9._:-]{0,127}$/i.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const fail = message => { throw new TypeError('Instrument variation: ' + message); };
const before = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export const INSTRUMENT_VARIATION_ALGORITHM = 'fnv1a32-utf16-le-latents-v1';

export function validateInstrumentVariation(input, parameters) {
  if (input == null) return null;
  if (!object(input) || input.algorithmVersion !== INSTRUMENT_VARIATION_ALGORITHM || !Number.isSafeInteger(input.seed) || input.seed < -2147483648 || input.seed > 2147483647 ||
      input.identityScope !== 'execution-birth' || !finite(input.amount01, 0, 1) || !Array.isArray(input.targets) || input.targets.length > 16 ||
      !Array.isArray(input.eventTargets) || input.eventTargets.length > 16) fail('invalid versioned variation profile');
  const schema = new Map(parameters.map(parameter => [parameter.id, parameter]));
  const targets = (entries, scope) => {
    const ids = new Set();
    return Object.freeze(entries.map(target => {
      const parameter = object(target) && schema.get(target.parameter);
      if (!parameter || parameter.discrete || !id(target.id) || ids.has(target.id) || !['add', 'scale'].includes(target.composition) ||
          target.unit !== (target.composition === 'scale' ? 'ratio' : parameter.unit) || !finite(target.amount, 0, 1000) || !Array.isArray(target.factors) ||
          !target.factors.length || target.factors.length > 4 || target.composition === 'scale' && target.amount > 1) fail('invalid ' + scope + ' target');
      ids.add(target.id); const factors = new Set(); let magnitude = 0;
      const weights = target.factors.map(factor => {
        if (!object(factor) || !id(factor.id) || factors.has(factor.id) || !finite(factor.weight, -1, 1)) fail('invalid bounded latent factor');
        factors.add(factor.id); magnitude += Math.abs(factor.weight); return Object.freeze({ id: factor.id, weight: factor.weight });
      }).sort(before);
      if (magnitude > 1 + 1e-12) fail('latent weights exceed their bounded range');
      return Object.freeze({ id: target.id, parameter: target.parameter, unit: target.unit, composition: target.composition, amount: target.amount, factors: Object.freeze(weights) });
    }).sort(before));
  };
  return Object.freeze({ algorithmVersion: input.algorithmVersion, seed: input.seed, identityScope: input.identityScope, amount01: input.amount01,
    targets: targets(input.targets, 'actor'), eventTargets: targets(input.eventTargets, 'event') });
}

// Hash JSON array fields as explicitly ordered UTF-16 little-endian code units.
export function instrumentVariationValue(fields) {
  const encoded = JSON.stringify(fields); let hash = 2166136261;
  for (let index = 0; index < encoded.length; index++) { const unit = encoded.charCodeAt(index);
    hash = Math.imul(hash ^ (unit & 255), 16777619); hash = Math.imul(hash ^ (unit >>> 8), 16777619); }
  // Avalanche keeps nearby names/actor ordinals from sharing the high bits.
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15; hash = Math.imul(hash, 0x846ca68b); hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296 * 2 - 1;
}

export function applyInstrumentVariation(profile, patch, values, controls, identity, deltas, applyFrame) {
  if (!profile) { if (controls.variationAmount01 != null || controls.variationSeed != null) fail('controls require an authored variation profile'); return null; }
  const amount = controls.variationAmount01 ?? profile.amount01, seed = controls.variationSeed ?? profile.seed;
  const event = typeof identity?.onsetId === 'string' && identity.onsetId.length > 0 && identity.onsetId.length <= 512 ? identity.onsetId : null;
  const actor = (Number.isSafeInteger(identity?.actorId) && identity.actorId >= 0 || typeof identity?.actorId === 'string' && identity.actorId.length > 0 && identity.actorId.length <= 160) &&
    typeof identity.worldId === 'string' && identity.worldId.length > 0 && identity.worldId.length <= 160 && Number.isSafeInteger(identity.generation) && identity.generation >= 0 ?
    [identity.worldId, identity.generation, identity.actorId] : null;
  if (amount && !actor && !event) fail('captured actor or event identity is required');
  const receipt = Object.freeze({ algorithmVersion: profile.algorithmVersion, seed, amount01: amount, identityScope: actor ? 'execution-birth' : 'event-only-fallback',
    physicalRandomStateConsumed: false, cacheEntries: 0 });
  if (!amount) return receipt;
  for (const [scope, entries] of [['actor', profile.targets], ['event', profile.eventTargets]]) {
    if (amount && scope === 'event' && entries.length && !event) fail('event variation requires a stable onset identity');
    for (const target of entries) {
      let latent = 0;
      if (amount) for (const factor of target.factors) latent += factor.weight * instrumentVariationValue([INSTRUMENT_VARIATION_ALGORITHM, patch.id, patch.revision, seed,
        scope, scope === 'actor' ? actor || ['event-only', event] : event, factor.id]);
      const offset = Math.max(-1, Math.min(1, latent)) * target.amount * amount, previous = values[target.parameter];
      const requested = target.composition === 'add' ? previous + offset : previous * (1 + offset);
      values[target.parameter] = requested; deltas.push({ parameterId: target.parameter, unit: target.unit, requestedValue: requested,
        origin: scope === 'actor' ? 'identity' : 'event-variation', variationId: target.id, composition: target.composition, applyFrame, interpolation: 'onset-only', smoothingMs: 0 });
    }
  }
  return receipt;
}
