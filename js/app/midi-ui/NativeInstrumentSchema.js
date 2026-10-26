import { freezeData, hashData } from '../../core/CanonicalData.js';
import { getActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { validateEngineDescriptor } from '../../midi/content/InstrumentPatchV2.js';

const parameter = (id, min, max, defaultValue, unit, discrete = false) => Object.freeze({ id, min, max, default: defaultValue,
  unit, discrete, interpolation: 'linear', liveSafe: !['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds', 'waveform'].includes(id), capability: null });
const envelope = (attack, decay, sustain, gain) => [parameter('attackSeconds', 0, 2, attack, 's'), parameter('decaySeconds', 0, 4, decay, 's'),
  parameter('sustain01', 0, 1, sustain, 'ratio'), parameter('releaseSeconds', 0.002, 4, 0.04, 's'),
  parameter('gain01', 0, 1, gain, 'amplitude-linear'), parameter('pan01', -1, 1, 0, 'normalized')];
const schemas = freezeData({
  'native-oscillator': [parameter('waveform', 0, 3, 1, 'enum', true), ...envelope(0.008, 0.05, 0.7, 0.5)],
  'native-fm': [parameter('carrierRatio', 0.125, 8, 1, 'ratio'), parameter('modulatorRatio', 0.125, 12, 2, 'ratio'),
    parameter('indexStart', 0, 8, 1, 'dimensionless'), parameter('indexEnd', 0, 8, 0.1, 'dimensionless'), parameter('indexSeconds', 0.001, 4, 0.3, 's'),
    parameter('dualPair', 0, 1, 0, 'enum', true), parameter('secondaryCarrierRatio', 0.125, 8, 1, 'ratio'), parameter('secondaryModulatorRatio', 0.125, 12, 1, 'ratio'),
    parameter('secondaryIndexStart', 0, 8, 0, 'dimensionless'), parameter('secondaryIndexEnd', 0, 8, 0, 'dimensionless'), parameter('secondaryMix01', 0, 1, 0, 'ratio'),
    parameter('pitchSettleCents', -1200, 1200, 0, 'cents'), parameter('pitchSettleSeconds', 0.001, 1, 0.035, 's'), parameter('maxBendCents', 0, 1200, 200, 'cents')]
    .map(spec => Object.freeze({ ...spec, liveSafe: false })).concat(envelope(0.002, 1.4, 0, 0.4)),
  'native-modal': [parameter('modeCount', 4, 8, 4, 'enum', true), parameter('bodyT60Seconds', 0.02, 2.5, 0.5, 's'), parameter('bodySizeRatio', 0.5, 2, 1, 'ratio'),
    parameter('strikePosition01', 0, 1, 0, 'normalized'), parameter('maxBendCents', 0, 1200, 200, 'cents'),
    ...Array.from({ length: 8 }, (_, index) => [parameter('mode' + index + 'Ratio', 0.125, 16, index + 1, 'ratio'),
      parameter('mode' + index + 'T60Scale', 0.01, 1, 1, 'ratio'), parameter('mode' + index + 'GainA', 0, 1, index < 4 ? 1 / (index + 1) : 0, 'amplitude-linear'),
      parameter('mode' + index + 'GainB', 0, 1, index < 4 ? 1 / (index + 1) : 0, 'amplitude-linear')]).flat()]
    .map(spec => Object.freeze({ ...spec, liveSafe: false })).concat(envelope(0.002, 0, 1, 0.4)),
  'worklet-texture': [parameter('textureKind', 0, 3, 0, 'enum', true), parameter('roughnessPerPixel', 0.2, 0.8, 0.4, 'inverse-world-pixel'), parameter('dragSlope', 0, 1, 0.5, 'normalized'), parameter('shade01', 0, 1, 0.5, 'normalized'), parameter('textureBodySeconds', 0.02, 0.25, 0.05, 's'),
    parameter('textureScope', 0, 2, 0, 'enum', true), parameter('textureAxis', 0, 1, 0, 'enum', true), parameter('textureRequireSegments', 0, 1, 0, 'enum', true), parameter('graftModeCount', 0, 8, 0, 'count', true), parameter('graftMix01', 0, 1, 0.7, 'normalized'), parameter('graftT60Seconds', 0.02, 2.5, 0.7, 's'), parameter('graftDamping01', 0, 1, 0, 'normalized'), parameter('graftExcite01', 0, 1, 1, 'normalized'), parameter('graftPickup01', 0, 1, 0.5, 'normalized'),
    ...Array.from({ length: 8 }, (_, index) => [parameter('graftMode' + index + 'Ratio', 0.125, 16, index + 1, 'ratio'), parameter('graftMode' + index + 'T60Scale', 0.01, 1, 1, 'ratio'), parameter('graftMode' + index + 'PickupA', -1, 1, 0.125, 'dimensionless'), parameter('graftMode' + index + 'PickupB', -1, 1, 0.125, 'dimensionless')]).flat()]
    .map(spec => Object.freeze({ ...spec, liveSafe: false })).concat(envelope(0.005, 0, 1, 0.6).map(spec => spec.id === 'releaseSeconds' ? Object.freeze({ ...spec, default: 0.4 }) : spec)),
  'worklet-sine': envelope(0.008, 0.05, 0.7, 0.5),
  'worklet-pluck': [parameter('pluckPosition01', 0.05, 0.45, 0.28, 'normalized'), parameter('stringT60Seconds', 0.1, 4, 0.9, 's'),
    parameter('excitationBrightness01', 0, 1, 0.5, 'normalized'), parameter('bodyMix01', 0, 0.3, 0, 'ratio'), parameter('bodyT60Seconds', 0.05, 2, 0.3, 's')]
    .map(spec => Object.freeze({ ...spec, liveSafe: false })).concat(Object.freeze({ ...parameter('damping01', 0, 1, 0, 'normalized'), causalLiveSafe: true }), envelope(0.002, 0, 1, 0.5)),
  'worklet-granular': [parameter('pitchRatio', 0.25, 4, 1, 'ratio'), parameter('regionStart01', 0, 1, 0, 'normalized'), parameter('regionEnd01', 0, 1, 1, 'normalized'),
    parameter('motionRequired', 0, 1, 1, 'enum', true), parameter('reverse', 0, 1, 0, 'enum', true), parameter('rootHz', 20, 20000, 261.6255653005986, 'Hz')]
    .map(spec => Object.freeze({ ...spec, liveSafe: false })).concat(
      [parameter('position01', 0, 1, 0.5, 'normalized'), parameter('densityHz', 0, 48, 12, 'Hz'), parameter('grainMilliseconds', 20, 140, 70, 'ms'),
        parameter('spread01', 0, 1, 0.2, 'normalized'), parameter('activity01', 0, 1, 0, 'normalized'), parameter('tone01', 0, 1, 0.7, 'normalized')]
        .map(spec => Object.freeze({ ...spec, causalLiveSafe: true })), parameter('freezePosition', 0, 1, 0, 'enum', true), envelope(0.01, 0.1, 0.8, 0.5)),
  'worklet-spectrum': [parameter('sourceMode', 0, 2, 0, 'enum', true),
    parameter('circularPeriodRatio', 1, 3, 2, 'ratio'), parameter('circularReferenceHz', 1, 20000, 55, 'Hz'), parameter('circularCenterHz', 20, 20000, 700, 'Hz'),
    parameter('circularWidthOctaves', 0.25, 3, 1.2, 'octaves'), parameter('circularLowHz', 20, 10000, 80, 'Hz'), parameter('circularHighHz', 40, 20000, 8000, 'Hz'),
    parameter('circularPartialCap', 8, 10, 10, 'count', true), parameter('circularWeight01', 0, 1, 1, 'ratio'), parameter('circularPixelsPerCycle', 1, 1000000, 512, 'world-pixel'),
    parameter('circularOriginPixels', -1000000000, 1000000000, 0, 'world-pixel'), parameter('circularPhaseOrigin', -1000000, 1000000, 0, 'cycles'),
    parameter('circularControlMode', 0, 2, 0, 'enum', true), parameter('circularScope', 0, 2, 0, 'enum', true), parameter('circularAxis', 0, 1, 0, 'enum', true), parameter('circularRequireSegments', 0, 1, 0, 'enum', true), parameter('partialCount', 1, 16, 16, 'enum', true), parameter('partialDecaySeconds', 0, 4, 0, 's'),
    ...Array.from({ length: 16 }, (_, index) => [parameter('partial' + index + 'Ratio', 0.125, 32, index + 1, 'ratio'), parameter('partial' + index + 'Gain', 0, 1, 1 / (index + 1), 'amplitude-linear'),
      parameter('partial' + index + 'T60Scale', 0.01, 1, 1, 'ratio')]).flat()].map(spec => Object.freeze({ ...spec, liveSafe: false })).concat(
    ['scan01', 'body01', 'edge01'].map(name => Object.freeze({ ...parameter(name, 0, 1, name === 'scan01' ? 0 : 0.5, 'normalized'), causalLiveSafe: true })), envelope(0.008, 0.1, 0.7, 0.5)),
  'worklet-choir': [parameter('vowel01', 0, 1, 0, 'normalized'), parameter('breath01', 0, 1, 0.1, 'normalized'), parameter('sizeRatio', 0.5, 2, 1, 'ratio'),
    parameter('chorusCents', 0, 12, 3, 'cents'), parameter('vibratoCents', 0, 12, 2, 'cents'), parameter('vowelStep', 0, 1, 0, 'enum', true), parameter('bandwidthScale', 0.5, 2, 1, 'ratio')]
    .map(spec => Object.freeze({ ...spec, liveSafe: !spec.discrete, causalLiveSafe: !spec.discrete })).concat(envelope(0.025, 0.1, 0.8, 0.5)),
  'native-sample': envelope(0.005, 0, 1, 0.7),
  'worklet-sample': [parameter('graftModeCount', 0, 8, 0, 'count', true), parameter('graftExcitationMode', 0, 1, 0, 'enum', true), parameter('graftEnergyBudget', 1e-9, 1000000, 1, 'dimensionless'), parameter('graftSupportSeconds', 0.001, 0.5, 0.25, 's'),
    parameter('graftMix01', 0, 1, 0.7, 'normalized'), parameter('graftT60Seconds', 0.02, 2.5, 0.7, 's'), parameter('graftDamping01', 0, 1, 0, 'normalized'), parameter('graftExcite01', 0, 1, 1, 'normalized'), parameter('graftPickup01', 0, 1, 0.5, 'normalized'),
    ...Array.from({ length: 8 }, (_, index) => [parameter('graftMode' + index + 'Ratio', 0.125, 16, index + 1, 'ratio'), parameter('graftMode' + index + 'T60Scale', 0.01, 1, 1, 'ratio'), parameter('graftMode' + index + 'PickupA', -1, 1, 0.125, 'dimensionless'), parameter('graftMode' + index + 'PickupB', -1, 1, 0.125, 'dimensionless')]).flat(), parameter('sampleLowpassHz', 80, 20000, 20000, 'Hz'), parameter('sampleVelocityTone01', 0, 1, 0, 'normalized')]
    .map(spec => Object.freeze({ ...spec, liveSafe: false })).concat(envelope(0.005, 0, 1, 0.7))
});
export const NATIVE_TEXTURE_FIELDS = freezeData(Object.fromEntries(schemas['worklet-texture'].map(spec => [spec.id, [spec.min, spec.max, spec.default]])));
export const NATIVE_TEXTURE_PARAMETERS = freezeData(Object.fromEntries(schemas['worklet-texture'].map(spec => [spec.id, spec])));
export const NATIVE_OSCILLATOR_PARAMETERS = freezeData(Object.fromEntries(schemas['native-oscillator'].map(spec =>
  [spec.id, { ...spec, integer: spec.discrete }])));
export const NATIVE_WORKLET_FIELDS = freezeData(Object.fromEntries(schemas['worklet-sine'].map(spec => [spec.id, [spec.min, spec.max, spec.default]])));
export const NATIVE_PLUCK_FIELDS = freezeData(Object.fromEntries(schemas['worklet-pluck'].map(spec => [spec.id, [spec.min, spec.max, spec.default]])));
export const NATIVE_PLUCK_PARAMETERS = freezeData(Object.fromEntries(schemas['worklet-pluck'].map(spec => [spec.id, { ...spec, integer: spec.discrete }])));
export const NATIVE_CHOIR_FIELDS = freezeData(Object.fromEntries(schemas['worklet-choir'].map(spec => [spec.id, [spec.min, spec.max, spec.default]])));
export const NATIVE_CHOIR_PARAMETERS = freezeData(Object.fromEntries(schemas['worklet-choir'].map(spec => [spec.id, { ...spec, integer: spec.discrete }])));
export const NATIVE_SPECTRUM_FIELDS = freezeData(Object.fromEntries(schemas['worklet-spectrum'].map(spec => [spec.id, [spec.min, spec.max, spec.default]])));
export const NATIVE_SPECTRUM_PARAMETERS = freezeData(Object.fromEntries(schemas['worklet-spectrum'].map(spec => [spec.id, { ...spec, integer: spec.discrete }])));
export const NATIVE_GRANULAR_FIELDS = freezeData(Object.fromEntries(schemas['worklet-granular'].map(spec => [spec.id, [spec.min, spec.max, spec.default]])));
export const NATIVE_GRANULAR_PARAMETERS = freezeData(Object.fromEntries(schemas['worklet-granular'].map(spec => [spec.id, { ...spec, integer: spec.discrete }])));
export const NATIVE_FM_PARAMETERS = freezeData(Object.fromEntries(schemas['native-fm'].map(spec => [spec.id, { ...spec, integer: spec.discrete }])));
export const NATIVE_MODAL_PARAMETERS = freezeData(Object.fromEntries(schemas['native-modal'].map(spec => [spec.id, { ...spec, integer: spec.discrete }])));
export const NATIVE_OWNED_SAMPLE_PARAMETERS = freezeData(Object.fromEntries(schemas['worklet-sample'].map(spec => [spec.id, spec])));
export const NATIVE_OWNED_SAMPLE_FIELDS = freezeData(Object.fromEntries(schemas['worklet-sample'].map(spec => [spec.id, [spec.min, spec.max, spec.default]])));
export const NATIVE_SAMPLE_FIELDS = freezeData(Object.fromEntries(schemas['native-sample'].map(spec => [spec.id, [spec.min, spec.max, spec.default]])));
const capabilities = id => Object.freeze({ samples: ['native-sample', 'worklet-granular', 'worklet-sample'].includes(id), sampleMaps: ['native-sample', 'worklet-sample'].includes(id), feedforwardSampleBody: id === 'worklet-sample', feedforwardMotionBody: id === 'worklet-sample', advancedSampleMaps: id === 'worklet-sample', reverseSamples: id === 'worklet-sample', positionDrivenSamples: id === 'worklet-sample', canonicalTravelSamples: id === 'worklet-sample', independentSamePitch: true, perVoicePitch: id !== 'worklet-texture',
  perVoicePressure: true, perVoicePan: true, perVoiceTimbre: ['worklet-choir', 'worklet-spectrum', 'worklet-granular'].includes(id), perVoiceDamping: id === 'worklet-pluck', ownedGates: true, releaseVelocity: ['native-sample', 'worklet-sample'].includes(id),
  forwardLoops: ['native-sample', 'worklet-sample'].includes(id), displayTelemetry: ['worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-sample', 'worklet-texture'].includes(id), renderAcknowledgment: ['worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-sample', 'worklet-texture'].includes(id), offlineRender: ['native-oscillator', 'native-fm', 'native-modal', 'native-sample', 'worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-sample', 'worklet-texture'].includes(id),
  ...(id === 'worklet-texture' ? { proceduralTextures: true, canonicalTextureTravel: true, feedforwardTextureBody: true, exactSourceStateTransfer: true } : {}),
  modulationGraph: false, macroPerformance: ['native-oscillator', 'native-fm', 'native-modal', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-sample', 'worklet-texture'].includes(id), continuousMacroPerformance: false,
  identityVariation: ['native-oscillator', 'native-fm', 'native-modal', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular'].includes(id),
  continuousPhysicalBindings: ['worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular'].includes(id),
  causalBindings: ['native-oscillator', 'native-fm', 'native-modal', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-sample'].includes(id) });
let catalogPromise = null;

export async function describeNativeInstrumentEngines(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length > 11) throw new TypeError('Invalid native engine artifact inventory.');
  const descriptors = [];
  for (const [engineId, parameters] of Object.entries(schemas)) {
    const engineCapabilities = capabilities(engineId), artifactHash = artifacts.find(artifact => artifact.engineId === engineId && artifact.engineVersion === 1)?.artifactHash;
    if (!artifactHash) continue;
    const maximumVoices = engineId === 'worklet-sample' ? 2 : ['worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-texture'].includes(engineId) ? 8 : ['native-modal', 'worklet-pluck'].includes(engineId) ? 16 : engineId === 'native-fm' ? 32 : 64, voicePolicies = ['reject'];
    const parameterSchemaHash = await hashData({ version: 1, parameters, capabilities: engineCapabilities, maximumVoices, voicePolicies });
    descriptors.push(validateEngineDescriptor({ engineId, engineVersion: 1, artifactHash, parameterSchemaHash, parameters, capabilities: engineCapabilities, maximumVoices, voicePolicies }));
  }
  return Object.freeze(descriptors);
}

export function getNativeInstrumentCatalog() {
  const identity = getActiveExecutionIdentity('browser-native-audio');
  if (identity.activeExecution !== 'bound') return Promise.resolve(freezeData({ state: 'execution-unbound', executionIdentity: identity,
    descriptors: [], engines: Object.keys(schemas), qualification: 'source-preview-without-pinned-artifact-authority' }));
  if (!catalogPromise) catalogPromise = (async () => {
    const descriptors = await describeNativeInstrumentEngines(identity.instrumentArtifacts || []);
    return freezeData({ state: 'bound-application-engines', executionIdentity: identity, descriptors, engines: Object.keys(schemas),
      artifactScope: 'transitive-renderer-code-bound-by-immutable-application-build', qualification: 'identity-and-parameter-contract-not-render-qualification' });
  })().catch(error => { catalogPromise = null; throw error; });
  return catalogPromise;
}
