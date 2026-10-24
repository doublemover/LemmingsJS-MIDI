import { SINE_LAYOUT, PLUCK_LAYOUT, CHOIR_LAYOUT, SPECTRUM_LAYOUT, GRANULAR_LAYOUT, pluckSourceBytes, choirSourceBytes, spectrumSourceBytes, granularSourceBytes,
  CHOIR_SOURCE_HEAP_ESTIMATE, SPECTRUM_SOURCE_HEAP_ESTIMATE, GRANULAR_SOURCE_HEAP_ESTIMATE } from './OwnedSourceLayout.js';
import { NATIVE_WORKLET_FIELDS, NATIVE_PLUCK_FIELDS, NATIVE_PLUCK_PARAMETERS, NATIVE_CHOIR_FIELDS, NATIVE_CHOIR_PARAMETERS,
  NATIVE_SPECTRUM_FIELDS, NATIVE_SPECTRUM_PARAMETERS, NATIVE_GRANULAR_FIELDS, NATIVE_GRANULAR_PARAMETERS } from './NativeInstrumentSchema.js';

const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const spectrumPartials = Object.freeze(Array.from({ length: 16 }, (_, index) => Object.freeze(['Ratio', 'Gain', 'T60Scale'].map(suffix => 'partial' + index + suffix))));
const acceptsSpectrum = parameters => {
  if (parameters.sourceMode) return true;
  if (parameters.partialCount !== 16) return false;
  for (const names of spectrumPartials) for (const name of names) if (parameters[name] !== NATIVE_SPECTRUM_FIELDS[name][2]) return false;
  return true;
};
const createProfile = ({ id, width, voices, fields, parameters = null, buildId, abi, workletUrl, rateLimit = false,
  seedDomain = null, minHz = 0.1, maxHz = null, bendCents = 24000, minimumControlSeconds = 0, heapEstimate = 0,
  sourceBytes = () => 0, cost = () => 1, acceptsParameters = () => true, acceptsOnset = () => true, beginFields = () => ({}), expressions = [], damping = false, requiresPCM = false }) => {
  const slots = Object.freeze(expressions.map(entry => Object.freeze([...entry]))), liveIds = Object.freeze([...slots.map(([name]) => name), ...(damping ? ['damping01'] : [])]);
  const runtime = Object.freeze({ engineId: id, engineVersion: 1, buildId, runtimeABI: abi, workletUrl,
    sharedMemory: false, transport: 'batched-transferable-message-port', minimumControlSeconds,
    ...(rateLimit ? { supportedSampleRates: Object.freeze([44100, 48000, 96000]) } : {}) });
  return Object.freeze({ id, width, voices, fields, parameters: parameters ? Object.freeze(Object.values(parameters)) : null, seedDomain, runtime,
    minHz, maxHz, bendCents, heapEstimate, sourceBytes, cost, acceptsParameters, acceptsOnset, beginFields, liveIds, damping, requiresPCM,
    extended: parameters !== null, perVoiceTimbre: slots.length > 0, offlineRender: id === 'worklet-sine',
    writeUpdate(expression, voice, values) {
      let mask = 0;
      for (const [name, bit, field] of slots) {
        if (expression[name] == null) continue;
        if (!finite(expression[name], fields[name][0], fields[name][1]) || parameters?.[name]?.discrete && !Number.isInteger(expression[name])) return null;
        mask |= bit; values[field] = expression[name];
      }
      if (damping && expression.damping01 != null) {
        if (!finite(expression.damping01, 0, 1)) return null;
        mask |= 8; values[20] = Math.max(0.02, voice.stringT60Seconds * (1 - 0.95 * expression.damping01));
        values[23] = Math.max(0.02, voice.bodyT60Seconds * (1 - 0.95 * expression.damping01));
      }
      return mask;
    }
  });
};
const profiles = Object.freeze({
  'worklet-granular': createProfile({ id: 'worklet-granular', width: GRANULAR_LAYOUT.width, voices: GRANULAR_LAYOUT.voices, fields: NATIVE_GRANULAR_FIELDS, parameters: NATIVE_GRANULAR_PARAMETERS,
    buildId: 'owned-granular-v1', abi: 'owned-granular-f64-command-v1', workletUrl: new URL('./worklet/OwnedGranularProcessor.js', import.meta.url).href, rateLimit: true, seedDomain: 'grain-choices-v1', minHz: 20, maxHz: 2000, bendCents: 200,
    sourceBytes: (rate, pcm) => granularSourceBytes(rate) + (pcm?.bytes || 0), heapEstimate: GRANULAR_SOURCE_HEAP_ESTIMATE, cost: () => 16, minimumControlSeconds: 0.008, requiresPCM: true,
    acceptsParameters: parameters => parameters.regionStart01 < parameters.regionEnd01,
    acceptsOnset: (parameters, frequency, pcm) => {
      if (!pcm || !finite(frequency / parameters.rootHz * parameters.pitchRatio, 0.25, 4)) return false;
      const start = Math.floor(parameters.regionStart01 * pcm.sourceFrames), end = Math.ceil(parameters.regionEnd01 * pcm.sourceFrames);
      return end - start >= 2 && Math.min(pcm.frames, Math.ceil(end * pcm.sampleRate / pcm.sourceSampleRate)) - Math.floor(start * pcm.sampleRate / pcm.sourceSampleRate) >= 2;
    },
    expressions: [['position01', 8, 19], ['densityHz', 16, 20], ['grainMilliseconds', 32, 21], ['spread01', 64, 23], ['freezePosition', 128, 26], ['activity01', 256, 28], ['tone01', 512, 32]],
    beginFields: (parameters, seed, pcm) => ({ 18: seed, 19: parameters.position01, 20: parameters.densityHz, 21: parameters.grainMilliseconds, 22: parameters.pitchRatio, 23: parameters.spread01,
      24: Math.floor(parameters.regionStart01 * pcm.sourceFrames), 25: Math.ceil(parameters.regionEnd01 * pcm.sourceFrames), 26: parameters.freezePosition, 27: parameters.motionRequired,
      28: parameters.activity01, 29: 0, 30: parameters.reverse, 31: parameters.rootHz, 32: parameters.tone01 }) }),
  'worklet-sine': createProfile({ id: 'worklet-sine', width: SINE_LAYOUT.width, voices: SINE_LAYOUT.voices, fields: NATIVE_WORKLET_FIELDS,
    buildId: 'owned-sine-v2-display', abi: 'owned-sine-f64-command-v1', workletUrl: new URL('./worklet/OwnedSineProcessor.js', import.meta.url).href }),
  'worklet-pluck': createProfile({ id: 'worklet-pluck', width: PLUCK_LAYOUT.width, voices: PLUCK_LAYOUT.voices, fields: NATIVE_PLUCK_FIELDS, parameters: NATIVE_PLUCK_PARAMETERS,
    buildId: 'owned-pluck-v1', abi: 'owned-pluck-f64-command-v1', workletUrl: new URL('./worklet/OwnedPluckProcessor.js', import.meta.url).href, rateLimit: true, seedDomain: 'pluck-excitation-v1', minHz: 50, maxHz: 2000, bendCents: 200,
    sourceBytes: pluckSourceBytes, cost: parameters => parameters.bodyMix01 > 0 ? 3 : 1, damping: true,
    beginFields: (parameters, seed) => ({ 18: seed, 19: parameters.pluckPosition01, 20: Math.max(0.02, parameters.stringT60Seconds * (1 - 0.95 * parameters.damping01)),
      21: parameters.excitationBrightness01, 22: parameters.bodyMix01, 23: Math.max(0.02, parameters.bodyT60Seconds * (1 - 0.95 * parameters.damping01)) }) }),
  'worklet-choir': createProfile({ id: 'worklet-choir', width: CHOIR_LAYOUT.width, voices: CHOIR_LAYOUT.voices, fields: NATIVE_CHOIR_FIELDS, parameters: NATIVE_CHOIR_PARAMETERS,
    buildId: 'owned-choir-v1', abi: 'owned-choir-f64-command-v1', workletUrl: new URL('./worklet/OwnedChoirProcessor.js', import.meta.url).href, rateLimit: true, seedDomain: 'choir-excitation-v1', minHz: 50, maxHz: 2000, bendCents: 200,
    sourceBytes: choirSourceBytes, heapEstimate: CHOIR_SOURCE_HEAP_ESTIMATE * 2, cost: () => 3, minimumControlSeconds: 0.008,
    expressions: [['vowel01', 8, 19], ['breath01', 16, 20], ['sizeRatio', 32, 21], ['chorusCents', 64, 22], ['vibratoCents', 128, 23], ['bandwidthScale', 256, 25]],
    beginFields: (parameters, seed) => ({ 18: seed, 19: parameters.vowel01, 20: parameters.breath01, 21: parameters.sizeRatio, 22: parameters.chorusCents,
      23: parameters.vibratoCents, 24: parameters.vowelStep, 25: parameters.bandwidthScale }) }),
  'worklet-spectrum': createProfile({ id: 'worklet-spectrum', width: SPECTRUM_LAYOUT.width, voices: SPECTRUM_LAYOUT.voices, fields: NATIVE_SPECTRUM_FIELDS, parameters: NATIVE_SPECTRUM_PARAMETERS,
    buildId: 'owned-spectrum-v1', abi: 'owned-spectrum-f64-command-v1', workletUrl: new URL('./worklet/OwnedSpectrumProcessor.js', import.meta.url).href, rateLimit: true, seedDomain: 'spectrum-phase-v1', minHz: 20, maxHz: 2000, bendCents: 200,
    sourceBytes: spectrumSourceBytes, heapEstimate: SPECTRUM_SOURCE_HEAP_ESTIMATE, acceptsParameters: acceptsSpectrum,
    cost: parameters => parameters.sourceMode ? parameters.partialCount : 4, minimumControlSeconds: 0.008, expressions: [['scan01', 8, 21], ['body01', 16, 22], ['edge01', 32, 23]],
    beginFields: (parameters, seed) => {
      const fields = { 18: seed, 19: parameters.sourceMode, 20: parameters.partialCount, 21: parameters.scan01, 22: parameters.body01, 23: parameters.edge01, 24: parameters.partialDecaySeconds };
      for (let index = 0; index < spectrumPartials.length; index++) {
        const names = spectrumPartials[index]; fields[25 + index] = parameters[names[0]]; fields[41 + index] = parameters[names[1]]; fields[57 + index] = parameters[names[2]];
      } return fields;
    } })
});
export const OWNED_SOURCE_IDS = Object.freeze(Object.keys(profiles));
export function getOwnedSourceProfile(id) {
  if (!Object.hasOwn(profiles, id)) throw new TypeError('Unsupported owned worklet source.'); return profiles[id];
}
