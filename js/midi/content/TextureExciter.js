import { freezeData } from '../../core/CanonicalData.js';

export const TEXTURE_EXCITER_REVISION = 'owned-spatial-hash-texture-excitation-v1';
export const TEXTURE_EXCITER_KINDS = Object.freeze(['sand-drag', 'cloth-rub', 'crackle-skin', 'foam-air']);
export const TEXTURE_EXCITER_LIMITS = Object.freeze({ voices: 8, state: 48, modes: 8, modeWidth: 8, pulses: 32, pulseWidth: 8, birthsPer128Frames: 32, maximumPixelsPerSecond: 512, maximumSignedCoordinatePixels: 8000000, maximumSpanSeconds: 2 });
export const TEXTURE_MODE_FREQUENCIES = Object.freeze([
  Object.freeze([600, 1170, 2600, 4100, 5700]), Object.freeze([450, 900, 1800, 3100, 4700]),
  Object.freeze([380, 830, 1700, 3400, 6100]), Object.freeze([700, 1600, 700, 1600, 700])
]);
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
export function prepareTextureExciter(raw = {}, sampleRate = 48000) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !['kind', 'roughnessPerPixel', 'dragSlope', 'shade01', 'bodySeconds'].includes(key)) || ![44100, 48000, 96000].includes(sampleRate)) throw new TypeError('Choose a bounded procedural texture and actual supported output rate.');
  const p = { kind: 'sand-drag', roughnessPerPixel: 0.4, dragSlope: 0.5, shade01: 0.5, bodySeconds: raw.kind === 'foam-air' ? 0.16 : 0.05, ...raw };
  if (!TEXTURE_EXCITER_KINDS.includes(p.kind) || !finite(p.roughnessPerPixel, 0.2, 0.8) || !finite(p.dragSlope, 0, 1) || !finite(p.shade01, 0, 1) || !finite(p.bodySeconds, p.kind === 'foam-air' ? 0.08 : 0.02, p.kind === 'sand-drag' ? 0.07 : 0.25)) throw new RangeError('Texture density, response, spectral shape or positive decay exceeds its authored domain.');
  return freezeData({ schema: 'lemmings-texture-exciter/v1', revision: TEXTURE_EXCITER_REVISION, ...p, sampleRate, kindIndex: TEXTURE_EXCITER_KINDS.indexOf(p.kind),
    distribution: p.kind === 'cloth-rub' ? 'linearly-interpolated-bipolar-spatial-hash-noise' : p.kind === 'crackle-skin' ? 'jittered-spatial-cells;one-to-four-bounded-offspring' : 'one-jittered-bipolar-pulse-per-visited-spatial-cell',
    seedPolicy: 'existing-actor-source-seed;integer-spatial-cell-hash;no-audio-time-random-stream', rateDomain: 'actual-completed-signed-axis-travel;absolute-crossing-count;no-extrapolation',
    amplitudeLaw: 'bounded-speed-response;one-over-sqrt(max(1,density-times-observed-pixels-per-second));fixed-32-slot-peak-reference',
    modeDecayRule: 'sand=max(20ms,BODY*(1-0.12*mode));cloth/crackle=BODY*(1-0.12*mode);foam=fixed-Q0.9',
    bodyControl: p.kind === 'foam-air' ? 'gain-correlation-seconds;two-fixed-Q0.9-bands-at-700-and-1600-Hz;release-owned-separately' : 'positive-modal-amplitude-T60-seconds',
    roughnessMeaning: p.kind === 'cloth-rub' ? 'spatial-noise-knots-per-pixel=320*roughnessPerPixel;no-pulse-births' : 'jittered-pulse-cells-per-world-pixel',
    spectralShape: { highpassHz: 120, nominalLowpassHz: 2500 + 3500 * p.shade01, spatialVariation: 'sixteen-pixel-linear-correlated-positive-coefficient-field;held-at-rest' }, burstEnvelope: 'one-to-five-ms-Hann;finite-source-owned-child',
    cluster: { maximumOffspring: p.kind === 'crackle-skin' ? 4 : 1, spacingMilliseconds: p.kind === 'crackle-skin' ? [2, 12] : null, futureChildren: 'only-inside-admitted-motion-span;cancel-before-start-on-rest-or-end' },
    maximumSubevents: TEXTURE_EXCITER_LIMITS.pulses, maximumBirthsPer128Frames: TEXTURE_EXCITER_LIMITS.birthsPer128Frames,
    observationPolicy: 'motion-closes-noise-and-new-births;already-active-one-to-five-ms-bursts-finish;positive-filter-and-modal-state-may-decay;one-original-semantic-source',
    qualification: 'original-bounded-material-exciter;not-measured-material;statistics-alias-cost-and-listening-unqualified' });
}

export function textureSpatialHash(seed, cell, salt = 0) {
  let value = (seed ^ Math.imul(cell | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d); value ^= value >>> 15; value = Math.imul(value, 0x846ca68b); return (value ^ value >>> 16) >>> 0;
}
