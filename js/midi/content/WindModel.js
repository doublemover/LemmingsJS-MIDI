import { freezeData } from '../../core/CanonicalData.js';

export const WIND_MODEL_REVISION = 'owned-implicit-negative-resistance-modal-wind-v1';
export const WIND_MODEL_KINDS = Object.freeze(['hollow-reed', 'air-pipe', 'overblown-branch']);
export const WIND_MODEL_LIMITS = Object.freeze({ voices: 2, state: 64, modes: 8, modeWidth: 18, iterations: 20, forceScale: 160, minimumVelocityScale: 0.02, maximumEnergy: 1048576, registerLow: 0.32, registerHigh: 0.42 });
export const WIND_PRESSURE_DOMAINS = Object.freeze([Object.freeze([0.18, 0.55]), Object.freeze([0.15, 0.5]), Object.freeze([0.18, 0.55])]);
export const WIND_PITCH_DOMAINS = Object.freeze([Object.freeze([110, 660]), Object.freeze([220, 1320]), Object.freeze([110, 330])]);
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
export function prepareWindModel(raw = {}, sampleRate = 48000) {
  if (![44100, 48000, 96000].includes(sampleRate) || !raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !['kind', 'air01', 'bite01', 'lengthRatio', 'leak01', 'bell01'].includes(key))) throw new TypeError('Choose a bounded original modal wind model and actual output rate.');
  const kind = raw.kind ?? 'hollow-reed', kindIndex = WIND_MODEL_KINDS.indexOf(kind), pressure = WIND_PRESSURE_DOMAINS[kindIndex], p = { air01: kind === 'air-pipe' ? 0.3 : 0.35, bite01: 0.5, lengthRatio: 1, leak01: 0.25, bell01: 0.35, ...raw, kind };
  if (!pressure || !finite(p.air01, pressure[0], pressure[1]) || !finite(p.bite01, 0.35, 0.65) || !finite(p.lengthRatio, 0.75, 1.25) || !finite(p.leak01, 0, 1) || !finite(p.bell01, 0.2, 0.5)) throw new RangeError('Normalized air, bite/mouth position, acoustic size, leak or bell exceeds its authored model domain.');
  return freezeData({ schema: 'lemmings-wind-model/v1', revision: WIND_MODEL_REVISION, ...p, kindIndex, sampleRate, modeCount: WIND_MODEL_LIMITS.modes, pitchDomainHz: WIND_PITCH_DOMAINS[kindIndex],
    exciter: 'original-saturating-negative-resistance-modal-port;not-a-measured-clarinet-or-flute', solver: 'fixed-twenty-bisections;unique-bounded-implicit-root', resonator: 'positive-modal-midpoint;odd-or-open-pipe-frequency-family;digital-pole-prewarped',
    pressure: 'normalized-model-control;expression-floor-zero;no-measured-pressure-unit', acousticSize: 'actual-base-Hz=intended-onset-Hz/lengthRatio;never-route-length',
    breath: 'seeded-900Hz-highpass-6kHz-lowpass-port-noise;maximum-minus-26dB-reference-scale;no-independent-onsets', onsetSeconds: kindIndex === 1 ? 0.08 : 0.03, breathReleaseSeconds: kindIndex === 1 ? 0.3 : 0.12,
    maximumForceSlopeProduct: WIND_MODEL_LIMITS.forceScale * 0.55 / (2 * 44100 * WIND_MODEL_LIMITS.minimumVelocityScale), register: kindIndex === 2 ? 'experimental;0.32-arm/0.42-rise;at-most-one-octave-transition-per-owned-gesture;energy-preserving-coordinate-change' : 'fixed-onset-register',
    qualification: 'authored-experimental;pressure-pitch-stability-tone-alias-device-cost-and-listening-pending' });
}
export function windForceCurve(contactVelocity, noise, cap, velocityScale) { return cap * Math.tanh((contactVelocity + noise) / velocityScale); }
export function windRandomStep(value) { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return value >>> 0; }
