import { validateSeedLayerProfile } from '../../midi/content/SeedLayerProfile.js';
import { validOwnedPcmSetDescriptor } from '../../midi/content/OwnedPcmFormat.js';
import { getOwnedSourceBankIdentity } from './OwnedSourceBank.js';
import { canonicalDataText, cloneData, freezeData } from '../../core/CanonicalData.js';
import { prepareSampleBodyProfile } from '../../midi/content/SampleBodyProfile.js';

export const SEED_LAYER_PLAN_REVISION = 'aligned-private-component-planes-and-fixed-source-clocks-v1';
export const SEED_LAYER_MAX_VOICES = 2;
const fail = message => { throw new TypeError('Layered seed preparation: ' + message); };

export function prepareSeedLayerPlan(patch, pcm, sampleRate) {
  if (patch?.engineId !== 'worklet-seed-layers' || patch.engineVersion !== 1 || typeof patch.id !== 'string' || !patch.id || patch.id.length > 256 || !Number.isSafeInteger(patch.revision) || patch.revision < 1 || !patch.parameters || Object.getPrototypeOf(patch.parameters) !== Object.prototype) fail('An exact saved layered seed patch is required.');
  if (!validOwnedPcmSetDescriptor(pcm) || pcm.banks.length !== 3 || ![44100, 48000, 96000].includes(sampleRate) || !Number.isSafeInteger(patch?.voicePolicy?.maxVoices) || patch.voicePolicy.maxVoices < 1 || patch.voicePolicy.maxVoices > SEED_LAYER_MAX_VOICES) fail('Choose a complete private three-component PCM set and the two-source profile.');
  const profile = validateSeedLayerProfile(patch.seedLayers, patch.sampleRefs), regions = profile.components.map(component => {
    const assetIndex = pcm.assetHashes.indexOf(component.assetHash), bank = pcm.banks[assetIndex];
    if (!bank || bank.sourceFrames !== component.sourceFrames || bank.sourceSampleRate !== component.sourceRate || bank.channels !== 2 || bank.frames < 2 || bank.frames > sampleRate * 8 + 1 || bank.sampleRate / sampleRate > 4) fail('Decoded component frames, stereo layout or read rate differ from the exact aligned material.');
    return { role: component.role, assetHash: component.assetHash, assetIndex, first: 0, end: bank.frames, sourceFrames: bank.sourceFrames, sourceSampleRate: bank.sourceSampleRate, decodedSampleRate: bank.sampleRate, readDerivative: bank.sampleRate / sampleRate };
  });
  if (regions.some(region => region.end !== regions[0].end || region.decodedSampleRate !== regions[0].decodedSampleRate)) fail('All component planes must use the same prepared clock; no independent stretch or covert crop repairs alignment.');
  const sourceBanks = ['sample-read-v1', 'grain-window-v1'].map(id => ({ id, hash: getOwnedSourceBankIdentity(id).hash }));
  const identity = canonicalDataText({ revision: SEED_LAYER_PLAN_REVISION, patchId: patch.id, patchRevision: patch.revision, parameters: patch.parameters, profile, pcm, sampleRate, sourceBanks }, { maxBytes: 262144, maxNodes: 32768 }).text;
  const fit = profile.bodyFit, bodyParameters = { graftModeCount: fit?.modes.length || 0, graftExcitationMode: fit ? 1 : 0 };
  const bodyT60 = fit ? Math.max(...fit.modes.map(mode => mode.t60Seconds)) : 0;
  if (fit) fit.modes.forEach((mode, index) => {
    bodyParameters['graftMode' + index + 'Ratio'] = mode.frequencyHz / fit.referenceHz;
    bodyParameters['graftMode' + index + 'T60Scale'] = mode.t60Seconds / bodyT60;
    bodyParameters['graftMode' + index + 'PickupA'] = bodyParameters['graftMode' + index + 'PickupB'] = mode.amplitude / Math.max(1, ...fit.modes.map(item => item.amplitude));
  });
  const body = prepareSampleBodyProfile(bodyParameters, sampleRate);
  return Object.freeze({ revision: SEED_LAYER_PLAN_REVISION, profile, body, bodyT60, acceptsOnset: frequency => !body || body.modes.every(mode => frequency * mode.ratio < sampleRate * 0.4), descriptor: freezeData(cloneData(pcm)), regions: freezeData(regions), sampleRate, identity, sourceBanks: freezeData(sourceBanks),
    footprint: freezeData({ semanticSources: patch.voicePolicy.maxVoices, childrenPerSource: 3, fixedRateReadHeadsPerSource: 2, maximumInternalGrainsPerSource: 16, completePcmBytes: pcm.bytes, pcmCopiesPerRenderer: 1, parentBackingLayers: 0, quality: 'unqualified-composite-source;not-perceptual-isolation-or-HQ-warp' }),
    timing: freezeData({ transient: 'original-material-rate-from-one-contact-onset', residual: 'original-material-rate-with-independent-positive-damping', sustained: 'owned-grains-with-an-independent-pitch-control;not-transparent-time-warp', sourceEnd: 'close-all-input-children;preserve-only-declared-owned-tails' })
  });
}
