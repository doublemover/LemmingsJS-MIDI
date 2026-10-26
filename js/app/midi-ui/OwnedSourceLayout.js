import { SEALED_BODY_STATE, SEALED_BODY_PARAMETERS, SEALED_BODY_PACKET } from '../../midi/content/SealedBodyProfile.js';
import { WIND_MODEL_LIMITS } from '../../midi/content/WindModel.js';
import { FRICTION_MODEL_LIMITS } from '../../midi/content/FrictionModel.js';
import { TEXTURE_EXCITER_LIMITS } from '../../midi/content/TextureExciter.js';
import { SAMPLE_READ_TABLE_SAMPLES } from '../../midi/content/SampleReadProfile.js';
export const LIVE_LANE_TAP_LIMIT = 8;
export const LIVE_LANE_TAP_PROTOCOL = 3;
export const LIVE_LANE_ID_LIMIT = 4096;
export const WIND_LAYOUT = Object.freeze({ width: 82, voices: WIND_MODEL_LIMITS.voices });
export const FRICTION_LAYOUT = Object.freeze({ width: 84, voices: FRICTION_MODEL_LIMITS.voices });
export const TEXTURE_LAYOUT = Object.freeze({ width: 80, voices: TEXTURE_EXCITER_LIMITS.voices });
export const SINE_LAYOUT = Object.freeze({ width: 18, voices: 64 });
export const PLUCK_LAYOUT = Object.freeze({ width: 24, voices: 16, state: 28, delayFloorHz: 32, delayMargin: 4 });
export const CHOIR_LAYOUT = Object.freeze({ width: 26, voices: 8, state: 40, bands: 3, bandState: 8, tableLength: 2048, tableSamples: 8 * 2049 });
export const SPECTRUM_LAYOUT = Object.freeze({ width: 73, voices: 8, state: 36, partialState: 6, partials: 16, tableLength: 2048, tableSamples: 16 * 5 * 2049, sineSamples: 2049, frameSamples: 256 });
export const GRANULAR_LAYOUT = Object.freeze({ width: 33, voices: 8, cloudState: 44, grainState: 14, grains: 16, windowSamples: 2049, birthsPerBucket: 32 });
export const SAMPLE_LAYOUT = Object.freeze({ width: 40, voices: 2, state: 144, zones: 128, cursorCapacity: 32, cursorWidth: 7, cursorScalars: 21 });
export const CHOIR_SOURCE_HEAP_ESTIMATE = 65536;
export const SPECTRUM_SOURCE_HEAP_ESTIMATE = 65536;
export const GRANULAR_SOURCE_HEAP_ESTIMATE = 65536;
export const SAMPLE_SOURCE_HEAP_ESTIMATE = 4 * 1048576;
const check = (rate, voices, maximum, maxRate = 384000) => {
  if (!Number.isFinite(rate) || rate < 8000 || rate > maxRate || !Number.isInteger(voices) || voices < 1 || voices > maximum) throw new RangeError('Invalid owned source storage profile.');
};
export function pluckSourceBytes(rate, voices = PLUCK_LAYOUT.voices) {
  check(rate, voices, PLUCK_LAYOUT.voices); const stride = Math.ceil(rate / PLUCK_LAYOUT.delayFloorHz) + PLUCK_LAYOUT.delayMargin;
  return stride * voices * 4 + stride * 8 + voices * PLUCK_LAYOUT.state * 8;
}
export function choirSourceBytes(rate, voices = CHOIR_LAYOUT.voices) {
  check(rate, voices, CHOIR_LAYOUT.voices); return CHOIR_LAYOUT.tableSamples * 4 + voices * (CHOIR_LAYOUT.state + CHOIR_LAYOUT.bands * CHOIR_LAYOUT.bandState) * 8;
}
export function spectrumSourceBytes(rate, voices = SPECTRUM_LAYOUT.voices) {
  check(rate, voices, SPECTRUM_LAYOUT.voices);
  return (SPECTRUM_LAYOUT.tableSamples + SPECTRUM_LAYOUT.sineSamples + SPECTRUM_LAYOUT.frameSamples) * 4 + voices * (SPECTRUM_LAYOUT.state + SPECTRUM_LAYOUT.partials * SPECTRUM_LAYOUT.partialState) * 8;
}
export function granularSourceBytes(rate, voices = GRANULAR_LAYOUT.voices) {
  check(rate, voices, GRANULAR_LAYOUT.voices, 192000); if (!Number.isInteger(rate)) throw new RangeError('Invalid granular source rate.');
  return GRANULAR_LAYOUT.windowSamples * 4 + voices * (GRANULAR_LAYOUT.cloudState + GRANULAR_LAYOUT.grains * GRANULAR_LAYOUT.grainState) * 8;
}
export function sampleSourceBytes(rate, voices = SAMPLE_LAYOUT.voices) {
  check(rate, voices, SAMPLE_LAYOUT.voices, 96000);
  if (![44100, 48000, 96000].includes(rate)) throw new RangeError('Invalid owned sample source rate.');
  return 524288 + SAMPLE_READ_TABLE_SAMPLES * 4 + voices * (SAMPLE_LAYOUT.state + SAMPLE_LAYOUT.zones * (SAMPLE_LAYOUT.cursorCapacity * SAMPLE_LAYOUT.cursorWidth + SAMPLE_LAYOUT.cursorScalars)) * 8;
}

export function textureSourceBytes(rate, voices = TEXTURE_LAYOUT.voices) {
  check(rate, voices, TEXTURE_LAYOUT.voices, 96000); if (![44100, 48000, 96000].includes(rate)) throw new RangeError('Invalid texture source rate.');
  const p = TEXTURE_EXCITER_LIMITS; return (voices * (p.state + p.modes * p.modeWidth + p.modes + p.pulses * p.pulseWidth) + 2) * 8;
}

export function frictionSourceBytes(rate, voices = FRICTION_LAYOUT.voices) {
  check(rate, voices, FRICTION_LAYOUT.voices, 96000); if (![44100, 48000, 96000].includes(rate)) throw new RangeError('Invalid friction source rate.');
  return voices * (FRICTION_MODEL_LIMITS.state + FRICTION_MODEL_LIMITS.modes * FRICTION_MODEL_LIMITS.modeWidth + SEALED_BODY_STATE + SEALED_BODY_PARAMETERS + SEALED_BODY_PACKET) * 8;
}

export function windSourceBytes(rate, voices = WIND_LAYOUT.voices) {
  check(rate, voices, WIND_LAYOUT.voices, 96000); if (![44100, 48000, 96000].includes(rate)) throw new RangeError('Unsupported wind source rate.');
  return voices * (WIND_MODEL_LIMITS.state + WIND_MODEL_LIMITS.modes * WIND_MODEL_LIMITS.modeWidth + SEALED_BODY_STATE + SEALED_BODY_PARAMETERS + SEALED_BODY_PACKET) * 8;
}
