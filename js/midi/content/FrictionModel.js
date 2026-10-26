import { freezeData } from '../../core/CanonicalData.js';

export const FRICTION_MODEL_REVISION = 'owned-implicit-modal-stribeck-friction-v1';
export const FRICTION_MODEL_KINDS = Object.freeze(['hairline', 'glass-drag', 'rosin-grain']);
export const FRICTION_MODEL_LIMITS = Object.freeze({ voices: 2, state: 48, modes: 12, modeWidth: 10, iterations: 16, minimumHz: 110, maximumHz: 660, maximumPixelsPerSecond: 512, maximumCoordinatePixels: 8000000, maximumSpanSeconds: 2, maximumEnergy: 1048576, maximumVelocity: 0.45, forceScale: 1280, staticToDynamicRatio: 0.25, stribeckVelocity: 0.12, frictionSmoothingVelocity: 0.002 });
export const FRICTION_PRESSURE_DOMAINS = Object.freeze([Object.freeze([0.25, 0.55]), Object.freeze([0.1, 0.4]), Object.freeze([0.35, 0.65])]);
export const FRICTION_GLASS_RATIOS = Object.freeze([1, 2.32, 4.25, 6.63, 9.38, 12.22]);
export const FRICTION_GLASS_T60 = Object.freeze([2.8, 2, 1.4, 0.9, 0.6, 0.4]);
export const FRICTION_BODY_HZ = Object.freeze([180, 540, 1150, 2710]);
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
export function prepareFrictionModel(raw = {}, sampleRate = 48000) {
  if (![44100, 48000, 96000].includes(sampleRate) || !raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !['kind', 'dragSlope', 'pressure01', 'contactPosition01', 'bodyMix01'].includes(key))) throw new TypeError('Choose a bounded original friction model and actual output rate.');
  const kind = raw.kind ?? 'hairline', kindIndex = FRICTION_MODEL_KINDS.indexOf(kind), p = { kind, dragSlope: 0.5, pressure01: kind === 'glass-drag' ? 0.25 : kind === 'rosin-grain' ? 0.5 : 0.4, contactPosition01: 0.18, bodyMix01: kind === 'glass-drag' ? 0.05 : 0.12, ...raw }, pressure = FRICTION_PRESSURE_DOMAINS[kindIndex];
  if (!pressure || !finite(p.dragSlope, 0, 1) || !finite(p.pressure01, pressure[0], pressure[1]) || !finite(p.contactPosition01, 0.1, 0.45) || !finite(p.bodyMix01, 0, 1)) throw new RangeError('Friction response, normalized pressure, contact or body observation exceeds its authored domain.');
  return freezeData({ schema: 'lemmings-friction-model/v1', revision: FRICTION_MODEL_REVISION, ...p, kindIndex, sampleRate, modeCount: kindIndex === 1 ? 6 : 12,
    nonlinearPort: 'implicit-relative-velocity-Stribeck-Coulomb;positive-friction-dissipation;unique-bounded-root', solver: 'fixed-sixteen-bisections;sign-passivity-projection;no-variable-iteration-loop',
    integration: 'positive-damped-modal-implicit-midpoint;digital-pole-prewarped-frequency-and-amplitude-T60', maximumForceSlopeProduct: 1 / (2 * 44100) * FRICTION_MODEL_LIMITS.forceScale * 0.65 * 1.2 * (1 - FRICTION_MODEL_LIMITS.staticToDynamicRatio) / FRICTION_MODEL_LIMITS.stribeckVelocity,
    motion: 'signed-completed-axis-pixels;maximum-512-pixels-per-second;no-extrapolation', pressure: 'normalized-model-control;no-measured-force-unit',
    acousticLength: 'onset-pitch-selects-virtual-modal-frequencies;route-pixels-do-not-set-acoustic-length', pressureAttackSeconds: 0.035,
    roughness: kindIndex === 2 ? 'four-pixel-positive-spatial-correlation;20-to-80-ms-only-at-50-to-200-pixels-per-second' : 'none',
    body: kindIndex === 1 ? 'six-authored-glass-modes;body-control-selects-signed-observation' : 'eight-string-modes-plus-four-authored-positive-body-modes;shared-force-port',
    rest: 'zero-bow-velocity-means-no-input-work;friction-and-positive-linear-loss-can-dissipate-existing-energy',
    release: 'source-contact-ends;declared-parent-release-separately-owns-tail-lifetime', livePitch: false,
    qualification: 'original-sealed-friction-model;stability-tone-alias-cost-and-listening-pending' });
}
