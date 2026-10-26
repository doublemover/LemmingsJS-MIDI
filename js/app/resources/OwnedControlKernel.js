import { computeOwnedSourceBank } from './OwnedSourceBankComputation.js';

export async function createOwnedControlKernel(profile, rate, voices, options = {}) {
  if (!profile.controlReferenceRender) throw new TypeError('This source has no fixed offline control adapter.');
  const bank = profile.bankId ? options.sourceBank || await computeOwnedSourceBank(profile.bankId, options) : null;
  options.signal?.throwIfAborted();
  if (profile.id === 'worklet-friction') { const { OwnedFrictionKernel } = await import('../midi-ui/worklet/OwnedFrictionProcessor.js'); return new OwnedFrictionKernel(rate, voices); }
  if (profile.id === 'worklet-texture') { const { OwnedTextureKernel } = await import('../midi-ui/worklet/OwnedTextureProcessor.js'); return new OwnedTextureKernel(rate, voices); }
  if (profile.id === 'worklet-sample') { const { OwnedSampleKernel } = await import('../midi-ui/worklet/OwnedSampleProcessor.js'); return new OwnedSampleKernel(rate, options.pcm, options.patch, voices, bank); }
  if (profile.id === 'worklet-sine') { const { OwnedSineKernel } = await import('../midi-ui/worklet/OwnedSineProcessor.js'); return new OwnedSineKernel(rate, voices); }
  if (profile.id === 'worklet-pluck') { const { OwnedPluckKernel } = await import('../midi-ui/worklet/OwnedPluckProcessor.js'); return new OwnedPluckKernel(rate, voices); }
  if (profile.id === 'worklet-choir') { const { OwnedChoirKernel } = await import('../midi-ui/worklet/OwnedChoirProcessor.js'); return new OwnedChoirKernel(rate, voices, bank); }
  if (profile.id === 'worklet-granular') { const { OwnedGranularKernel } = await import('../midi-ui/worklet/OwnedGranularProcessor.js'); return new OwnedGranularKernel(rate, options.pcm, voices, bank); }
  if (profile.id === 'worklet-spectrum') { const { OwnedSpectrumKernel } = await import('../midi-ui/worklet/OwnedSpectrumProcessor.js'); return new OwnedSpectrumKernel(rate, voices, bank); }
  throw new TypeError('Unknown fixed control source.');
}
