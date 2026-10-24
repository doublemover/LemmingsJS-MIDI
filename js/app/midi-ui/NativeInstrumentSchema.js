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
  'worklet-sine': envelope(0.008, 0.05, 0.7, 0.5),
  'native-sample': envelope(0.005, 0, 1, 0.7)
});
export const NATIVE_OSCILLATOR_PARAMETERS = freezeData(Object.fromEntries(schemas['native-oscillator'].map(spec =>
  [spec.id, { ...spec, integer: spec.discrete }])));
export const NATIVE_WORKLET_FIELDS = freezeData(Object.fromEntries(schemas['worklet-sine'].map(spec => [spec.id, [spec.min, spec.max, spec.default]])));
export const NATIVE_FM_PARAMETERS = freezeData(Object.fromEntries(schemas['native-fm'].map(spec => [spec.id, { ...spec, integer: spec.discrete }])));
export const NATIVE_SAMPLE_FIELDS = freezeData(Object.fromEntries(schemas['native-sample'].map(spec => [spec.id, [spec.min, spec.max, spec.default]])));
const capabilities = id => Object.freeze({ samples: id === 'native-sample', independentSamePitch: true, perVoicePitch: true,
  perVoicePressure: true, perVoicePan: true, perVoiceTimbre: false, ownedGates: true, releaseVelocity: id === 'native-sample',
  forwardLoops: id === 'native-sample', displayTelemetry: id === 'worklet-sine', renderAcknowledgment: id === 'worklet-sine', offlineRender: id === 'worklet-sine',
  modulationGraph: false, macroPerformance: ['native-oscillator', 'native-fm'].includes(id), continuousMacroPerformance: false, causalBindings: false });
let catalogPromise = null;

export async function describeNativeInstrumentEngines(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length > 4) throw new TypeError('Invalid native engine artifact inventory.');
  const descriptors = [];
  for (const [engineId, parameters] of Object.entries(schemas)) {
    const engineCapabilities = capabilities(engineId), artifactHash = artifacts.find(artifact => artifact.engineId === engineId && artifact.engineVersion === 1)?.artifactHash;
    if (!artifactHash) continue;
    const maximumVoices = engineId === 'native-fm' ? 32 : 64, voicePolicies = ['reject'];
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
