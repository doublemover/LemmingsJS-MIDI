import { validTextureBodyCommand, textureBodyCommandFields } from '../../midi/content/TextureBodyProfile.js';
import { prepareTextureExciter, TEXTURE_EXCITER_KINDS } from '../../midi/content/TextureExciter.js';
import { planTextureTravel } from '../../midi/content/TextureTravel.js';
import { resolveCircularSpectrum, circularSpectrumParameters, planCircularTravel, validateCircularCoordinateControl } from '../../midi/content/CircularSpectrum.js';
import { prepareSampleBodyProfile, acceptsSampleBodyOnset } from '../../midi/content/SampleBodyProfile.js';
import { validOwnedPcmSetDescriptor } from '../../midi/content/OwnedPcmFormat.js';
import { TEXTURE_LAYOUT, textureSourceBytes, SINE_LAYOUT, PLUCK_LAYOUT, CHOIR_LAYOUT, SPECTRUM_LAYOUT, GRANULAR_LAYOUT, SAMPLE_LAYOUT, sampleSourceBytes, pluckSourceBytes, choirSourceBytes, spectrumSourceBytes, granularSourceBytes,
  CHOIR_SOURCE_HEAP_ESTIMATE, SPECTRUM_SOURCE_HEAP_ESTIMATE, GRANULAR_SOURCE_HEAP_ESTIMATE, SAMPLE_SOURCE_HEAP_ESTIMATE } from './OwnedSourceLayout.js';
import { NATIVE_TEXTURE_FIELDS, NATIVE_TEXTURE_PARAMETERS, NATIVE_WORKLET_FIELDS, NATIVE_PLUCK_FIELDS, NATIVE_PLUCK_PARAMETERS, NATIVE_CHOIR_FIELDS, NATIVE_CHOIR_PARAMETERS,
  NATIVE_SPECTRUM_FIELDS, NATIVE_SPECTRUM_PARAMETERS, NATIVE_GRANULAR_FIELDS, NATIVE_GRANULAR_PARAMETERS, NATIVE_OWNED_SAMPLE_FIELDS, NATIVE_OWNED_SAMPLE_PARAMETERS } from './NativeInstrumentSchema.js';

const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const spectrumPartials = Object.freeze(Array.from({ length: 16 }, (_, index) => Object.freeze(['Ratio', 'Gain', 'T60Scale'].map(suffix => 'partial' + index + suffix))));
const acceptsSpectrum = parameters => {
  if (parameters.sourceMode === 2) { try { resolveCircularSpectrum(circularSpectrumParameters(parameters), 48000); validateCircularCoordinateControl(parameters); return true; } catch { return false; } }
  if (parameters.sourceMode) return true;
  if (parameters.partialCount !== 16) return false;
  for (const names of spectrumPartials) for (const name of names) if (parameters[name] !== NATIVE_SPECTRUM_FIELDS[name][2]) return false;
  return true;
};
const createProfile = ({ id, width, voices, fields, parameters = null, buildId, abi, workletUrl, rateLimit = false,
  seedDomain = null, minHz = 0.1, maxHz = null, bendCents = 24000, minimumControlSeconds = 0, heapEstimate = 0,
  storageBytes = () => 0, cost = () => 1, acceptsParameters = () => true, acceptsOnset = () => true, beginFields = () => ({}), expressions = [], damping = false, requiresPCM = false, requiresPCMSet = false, bankId = null, controlReferenceRender = false, travelPlanner = null, travelReceiptKey = 'circularTravel', restoration = 'exactSnapshot', acceptsExpression = () => true }) => {
  const slots = Object.freeze(expressions.map(entry => Object.freeze([...entry]))), liveIds = Object.freeze([...slots.map(([name]) => name), ...(damping ? ['damping01'] : [])]);
  const runtime = Object.freeze({ engineId: id, engineVersion: 1, buildId, runtimeABI: abi, workletUrl,
    sharedMemory: false, transport: 'batched-transferable-message-port', minimumControlSeconds,
    ...(rateLimit ? { supportedSampleRates: Object.freeze([44100, 48000, 96000]) } : {}) });
  return Object.freeze({ id, width, voices, fields, parameters: parameters ? Object.freeze(Object.values(parameters)) : null, seedDomain, runtime,
    minHz, maxHz, bendCents, heapEstimate, sourceBytes(options = {}) {
      if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.keys(options).some(key => !['sampleRate', 'voices', 'pcm'].includes(key))) throw new TypeError('Owned source footprint requires named rate, voice capacity and PCM fields.');
      const { sampleRate, voices: requestedCapacity = voices, pcm = null } = options;
      const capacity = requiresPCMSet ? voices : requestedCapacity;
      if (!Number.isSafeInteger(sampleRate) || !finite(sampleRate, 8000, 384000) || rateLimit && ![44100, 48000, 96000].includes(sampleRate) ||
          !Number.isSafeInteger(requestedCapacity) || requestedCapacity < 1 || requestedCapacity > voices) throw new RangeError('Invalid owned source footprint rate or voice capacity.');
      if (requiresPCMSet ? !validOwnedPcmSetDescriptor(pcm) : requiresPCM ? !pcm || pcm.schema !== 'lemmings-owned-pcm-bank/v1' || !Number.isSafeInteger(pcm.frames) || pcm.frames < 1 || ![1, 2].includes(pcm.channels) ||
          !Number.isSafeInteger(pcm.sampleRate) || !finite(pcm.sampleRate, 8000, 192000) || !Number.isSafeInteger(pcm.bytes) || pcm.bytes !== pcm.frames * pcm.channels * 4 || pcm.bytes > 16 * 1048576 : pcm != null)
        throw new TypeError('Owned source footprint PCM does not match this source profile.');
      return storageBytes(sampleRate, capacity) + (requiresPCM ? pcm.bytes : 0);
    }, footprintContract: requiresPCMSet ? 'named-rate-voice-pcm-set-maximum-configuration-v1' : 'named-rate-voice-pcm-v1', cost, acceptsParameters, acceptsOnset, beginFields, liveIds, damping, requiresPCM, requiresPCMSet, bankId,
    controlReferenceRender, travelPlanner, travelReceiptKey, restoration, extended: parameters !== null, perVoiceTimbre: slots.length > 0, offlineRender: controlReferenceRender,
    writeUpdate(expression, voice, values) {
      if (!acceptsExpression(expression, voice)) return null;
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
  'worklet-texture': createProfile({ id: 'worklet-texture', controlReferenceRender: true, width: TEXTURE_LAYOUT.width, voices: TEXTURE_LAYOUT.voices, fields: NATIVE_TEXTURE_FIELDS, parameters: NATIVE_TEXTURE_PARAMETERS,
    buildId: 'owned-texture-v3-state-cut', abi: 'owned-texture-f64-command-v2', workletUrl: new URL('./worklet/OwnedTextureProcessor.js', import.meta.url).href,
    rateLimit: true, seedDomain: 'spatial-texture-v1', minHz: 20, maxHz: 2000, bendCents: 0, storageBytes: textureSourceBytes, heapEstimate: 65536, cost: p => 32 + (p.graftModeCount || 5),
    acceptsOnset: (p, frequency, pcm, rate) => validTextureBodyCommand(textureBodyCommandFields(p), frequency, rate),
    travelPlanner: planTextureTravel, travelReceiptKey: 'textureTravel', restoration: 'exactSnapshot', acceptsExpression: expression => expression.pitchOffsetCents == null || expression.pitchOffsetCents === 0,
    acceptsParameters: p => { try { if (!validTextureBodyCommand(textureBodyCommandFields(p), 20, 48000)) return false; prepareTextureExciter({ kind: TEXTURE_EXCITER_KINDS[p.textureKind], roughnessPerPixel: p.roughnessPerPixel, dragSlope: p.dragSlope, shade01: p.shade01, bodySeconds: p.textureBodySeconds }); return true; } catch { return false; } },
    beginFields: (p, seed, pcm, selected, travel) => ({ ...textureBodyCommandFields(p), 18: seed, 19: p.textureKind, 20: p.roughnessPerPixel, 21: p.dragSlope, 22: p.shade01, 23: p.textureBodySeconds,
      ...(travel ? { 34: travel.firstFrame, 35: travel.endFrame, 36: travel.from, 37: travel.to, 38: 1 } : {}) }) }),
  'worklet-sample': createProfile({ id: 'worklet-sample', controlReferenceRender: true, width: SAMPLE_LAYOUT.width, voices: SAMPLE_LAYOUT.voices, fields: NATIVE_OWNED_SAMPLE_FIELDS, parameters: NATIVE_OWNED_SAMPLE_PARAMETERS,
    buildId: 'owned-sample-v6-motion-body', abi: 'owned-sample-f64-command-v2', workletUrl: new URL('./worklet/OwnedSampleProcessor.js', import.meta.url).href,
    rateLimit: true, requiresPCM: true, requiresPCMSet: true, bankId: 'sample-read-v1', storageBytes: sampleSourceBytes, heapEstimate: SAMPLE_SOURCE_HEAP_ESTIMATE,
    cost: parameters => 32 + (parameters.graftModeCount || 0) * 2, minHz: 0.1, maxHz: 20000, bendCents: 4800, minimumControlSeconds: 0.008,
    acceptsExpression: (expression, voice) => !voice.sourceValues?.graftModeCount || expression.pitchOffsetCents == null || expression.pitchOffsetCents === 0,
    acceptsOnset: (parameters, frequency, pcm, rate = 48000) => { try { return validOwnedPcmSetDescriptor(pcm) && acceptsSampleBodyOnset(prepareSampleBodyProfile(parameters, rate), frequency, { mix01: parameters.graftMix01, t60Seconds: parameters.graftT60Seconds, damping01: parameters.graftDamping01, excite01: parameters.graftExcite01, pickup01: parameters.graftPickup01 }); } catch { return false; } },
    beginFields: (parameters, seed, pcm, selected) => { if (!selected || !Number.isInteger(selected.zoneIndex)) throw new TypeError('An owned sample onset requires its prepared semantic selection.');
      return { 18: selected.zoneIndex, 19: selected.region.selectionSeed, 31: parameters.sampleLowpassHz ?? 20000, 32: parameters.sampleVelocityTone01 ?? 0, 33: selected.velocity01 ?? 1, 34: parameters.graftMix01 ?? 0.7, 35: parameters.graftT60Seconds ?? 0.7, 36: parameters.graftDamping01 ?? 0, 37: parameters.graftExcite01 ?? 1, 38: parameters.graftPickup01 ?? 0.5, 39: parameters.graftModeCount ?? 0 }; } }),
  'worklet-granular': createProfile({ id: 'worklet-granular', controlReferenceRender: true, bankId: 'grain-window-v1', width: GRANULAR_LAYOUT.width, voices: GRANULAR_LAYOUT.voices, fields: NATIVE_GRANULAR_FIELDS, parameters: NATIVE_GRANULAR_PARAMETERS,
    buildId: 'owned-granular-v6-owned-retirement', abi: 'owned-granular-f64-command-v1', workletUrl: new URL('./worklet/OwnedGranularProcessor.js', import.meta.url).href, rateLimit: true, seedDomain: 'grain-choices-v1', minHz: 20, maxHz: 2000, bendCents: 200,
    storageBytes: granularSourceBytes, heapEstimate: GRANULAR_SOURCE_HEAP_ESTIMATE, cost: () => 16, minimumControlSeconds: 0.008, requiresPCM: true,
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
  'worklet-sine': createProfile({ id: 'worklet-sine', controlReferenceRender: true, width: SINE_LAYOUT.width, voices: SINE_LAYOUT.voices, fields: NATIVE_WORKLET_FIELDS,
    buildId: 'owned-sine-v7-owned-retirement', abi: 'owned-sine-f64-command-v1', workletUrl: new URL('./worklet/OwnedSineProcessor.js', import.meta.url).href }),
  'worklet-pluck': createProfile({ id: 'worklet-pluck', controlReferenceRender: true, width: PLUCK_LAYOUT.width, voices: PLUCK_LAYOUT.voices, fields: NATIVE_PLUCK_FIELDS, parameters: NATIVE_PLUCK_PARAMETERS,
    buildId: 'owned-pluck-v6-owned-retirement', abi: 'owned-pluck-f64-command-v1', workletUrl: new URL('./worklet/OwnedPluckProcessor.js', import.meta.url).href, rateLimit: true, seedDomain: 'pluck-excitation-v1', minHz: 50, maxHz: 2000, bendCents: 200,
    storageBytes: pluckSourceBytes, cost: parameters => parameters.bodyMix01 > 0 ? 3 : 1, damping: true,
    beginFields: (parameters, seed) => ({ 18: seed, 19: parameters.pluckPosition01, 20: Math.max(0.02, parameters.stringT60Seconds * (1 - 0.95 * parameters.damping01)),
      21: parameters.excitationBrightness01, 22: parameters.bodyMix01, 23: Math.max(0.02, parameters.bodyT60Seconds * (1 - 0.95 * parameters.damping01)) }) }),
  'worklet-choir': createProfile({ id: 'worklet-choir', controlReferenceRender: true, bankId: 'choir-v1', width: CHOIR_LAYOUT.width, voices: CHOIR_LAYOUT.voices, fields: NATIVE_CHOIR_FIELDS, parameters: NATIVE_CHOIR_PARAMETERS,
    buildId: 'owned-choir-v6-owned-retirement', abi: 'owned-choir-f64-command-v1', workletUrl: new URL('./worklet/OwnedChoirProcessor.js', import.meta.url).href, rateLimit: true, seedDomain: 'choir-excitation-v1', minHz: 50, maxHz: 2000, bendCents: 200,
    storageBytes: choirSourceBytes, heapEstimate: CHOIR_SOURCE_HEAP_ESTIMATE, cost: () => 3, minimumControlSeconds: 0.008,
    expressions: [['vowel01', 8, 19], ['breath01', 16, 20], ['sizeRatio', 32, 21], ['chorusCents', 64, 22], ['vibratoCents', 128, 23], ['bandwidthScale', 256, 25]],
    beginFields: (parameters, seed) => ({ 18: seed, 19: parameters.vowel01, 20: parameters.breath01, 21: parameters.sizeRatio, 22: parameters.chorusCents,
      23: parameters.vibratoCents, 24: parameters.vowelStep, 25: parameters.bandwidthScale }) }),
  'worklet-spectrum': createProfile({ id: 'worklet-spectrum', controlReferenceRender: true, bankId: 'spectrum-v1', width: SPECTRUM_LAYOUT.width, voices: SPECTRUM_LAYOUT.voices, fields: NATIVE_SPECTRUM_FIELDS, parameters: NATIVE_SPECTRUM_PARAMETERS,
    buildId: 'owned-spectrum-v9-route-coordinate', abi: 'owned-spectrum-f64-command-v1', workletUrl: new URL('./worklet/OwnedSpectrumProcessor.js', import.meta.url).href, rateLimit: true, seedDomain: 'spectrum-phase-v1', minHz: 20, maxHz: 2000, bendCents: 200,
    travelPlanner: planCircularTravel, acceptsExpression: (expression, voice) => voice.sourceValues?.sourceMode !== 2 || !['scan01', 'body01', 'edge01'].some(id => expression[id] != null),
    acceptsOnset: (parameters, frequency, pcm, rate) => { if (parameters.sourceMode !== 2) return true; try { resolveCircularSpectrum(circularSpectrumParameters(parameters), rate, frequency / 261.6255653005986); return true; } catch { return false; } },
    storageBytes: spectrumSourceBytes, heapEstimate: SPECTRUM_SOURCE_HEAP_ESTIMATE, acceptsParameters: acceptsSpectrum,
    cost: parameters => parameters.sourceMode === 2 ? parameters.circularPartialCap : parameters.sourceMode ? parameters.partialCount : 4, minimumControlSeconds: 0.008, expressions: [['scan01', 8, 21], ['body01', 16, 22], ['edge01', 32, 23]],
    beginFields: (parameters, seed, pcm, selected, travel) => {
      if (parameters.sourceMode === 2) return { 18: seed, 19: 2, 25: parameters.circularReferenceHz, 26: parameters.circularCenterHz, 27: parameters.circularWidthOctaves, 28: parameters.circularLowHz, 29: parameters.circularHighHz, 30: parameters.circularPartialCap, 31: parameters.circularWeight01, 32: travel?.from ?? parameters.circularPhaseOrigin, 33: parameters.circularPeriodRatio, ...(travel ? { 34: travel.firstFrame, 35: travel.endFrame, 36: travel.from, 37: travel.to, 38: 1 } : {}) };
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
