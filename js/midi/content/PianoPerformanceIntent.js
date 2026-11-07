export const PIANO_DYNAMICS = Object.freeze([
  ['silent', 0x0200, 0, 0x03ff], ['pppp', 0x1400, 0x0400, 0x23ff], ['ppp', 0x3200, 0x2400, 0x41ff],
  ['pp', 0x5000, 0x4200, 0x5dff], ['p', 0x6a00, 0x5e00, 0x77ff], ['mp', 0x8410, 0x7800, 0x9248],
  ['mf', 0x9e79, 0x9249, 0xacb1], ['f', 0xb8e3, 0xacb2, 0xc71b], ['ff', 0xd145, 0xc71c, 0xe185],
  ['fff', 0xebae, 0xe186, 0xf7de], ['ffff', 0xfbef, 0xf7df, 0xffff]
].map(([mark, center, minimum, maximum]) => Object.freeze({ mark, center, minimum, maximum })));
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
export function validatePianoPerformancePolicy(value) {
  if (!value || value.schema !== 'lemmings-piano-performance-policy/v1' || !['authored-dynamic', 'impact-in-authored-range'].includes(value.dynamicMode) ||
      !PIANO_DYNAMICS.some(row => row.mark === value.minimumDynamic) || !PIANO_DYNAMICS.some(row => row.mark === value.maximumDynamic) ||
      !Number.isFinite(value.impactExponent) || value.impactExponent < 0.1 || value.impactExponent > 10 || !['off', 'pressure01', 'swarm-density01'].includes(value.sustainSource) ||
      !Number.isFinite(value.smoothingMs) || value.smoothingMs < 0 || value.smoothingMs > 60000 || !unit(value.deadband01) || typeof value.pickup !== 'boolean' ||
      value.releaseVelocity01 != null && !unit(value.releaseVelocity01)) throw new Error('Invalid authored piano performance policy');
  if (PIANO_DYNAMICS.findIndex(row => row.mark === value.minimumDynamic) > PIANO_DYNAMICS.findIndex(row => row.mark === value.maximumDynamic)) throw new Error('Piano dynamic range is reversed');
  const tuning = value.tuning;
  if (tuning != null && (!Number.isInteger(tuning.temperament) || tuning.temperament < 0 || tuning.temperament > 6 || !Number.isInteger(tuning.tonic) || tuning.tonic < 0 || tuning.tonic > 11)) throw new Error('Choose a defined piano temperament and tonic');
  return Object.freeze({ schema: value.schema, dynamicMode: value.dynamicMode, minimumDynamic: value.minimumDynamic, maximumDynamic: value.maximumDynamic, impactExponent: value.impactExponent,
    sustainSource: value.sustainSource, smoothingMs: value.smoothingMs, deadband01: value.deadband01, pickup: value.pickup, releaseVelocity01: value.releaseVelocity01 ?? null,
    tuning: tuning ? Object.freeze({ temperament: tuning.temperament, tonic: tuning.tonic }) : null, reconnect: 'explicit-profile-review-required' });
}
export function validatePianoPartControls(value = {}) {
  value ??= {};
  if (!value || Object.keys(value).some(key => !['sustain01', 'sostenuto01', 'unaCorda01'].includes(key)) || ['sustain01', 'sostenuto01', 'unaCorda01'].some(key => value[key] != null && !unit(value[key]))) throw new Error('Invalid shared piano pedal controls');
  return Object.freeze({ sustain01: value.sustain01 ?? null, sostenuto01: value.sostenuto01 ?? null, unaCorda01: value.unaCorda01 ?? null });
}
export function createPianoPerformanceIntent(policy, controls, { velocity01, expression, swarm, sourceActionId } = {}) {
  if (!policy) return null;
  if (!unit(velocity01)) throw new Error('Invalid normalized physical piano impact');
  const minimum = PIANO_DYNAMICS.find(row => row.mark === policy.minimumDynamic), maximum = PIANO_DYNAMICS.find(row => row.mark === policy.maximumDynamic);
  const hammerVelocity = policy.dynamicMode === 'authored-dynamic' ? maximum.center : Math.round(minimum.center + (maximum.center - minimum.center) * velocity01 ** policy.impactExponent);
  const dynamic = PIANO_DYNAMICS.find(row => hammerVelocity >= row.minimum && hammerVelocity <= row.maximum).mark;
  const sustain01 = policy.sustainSource === 'pressure01' ? Math.max(0, Math.min(1, expression?.pressure01 ?? 0)) : policy.sustainSource === 'swarm-density01' && Number.isSafeInteger(swarm?.sourceCount) ? Math.min(1, Math.log2(swarm.sourceCount + 1) / 8) : 0;
  return Object.freeze({ schema: 'lemmings-piano-performance-intent/v1', mappingRevision: 'M2-126-v1.0-2026-07-08', authoredDynamicRange: Object.freeze([minimum.mark, maximum.mark]), dynamic, hammerVelocity,
    physicalImpact01: velocity01, physicalImpactInterpretation: 'normalized-authored-source-not-measured-hammer-force', sustainContribution01: sustain01,
    controls: validatePianoPartControls(controls), sourceActionId: sourceActionId ?? null });
}
