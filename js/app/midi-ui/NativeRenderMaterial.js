import { DECODER_VERSION } from './AudioAssetRef.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

// Native decode returns an AudioBuffer suitable for the sample backend. Its
// cache identity remains encoded hash + output rate + native decoder version.
export async function prepareNativeRenderMaterial({ provider, resources, definition, reference = null, stage = null, patchIdentity = null,
  engineDescriptors, owner, generation = 0, sampleRate = 48000, signal, isCurrent = () => true,
  OfflineAudioContext = globalThis.OfflineAudioContext } = {}) {
  signal?.throwIfAborted();
  if (definition?.engineId !== 'native-sample' || !Array.isArray(definition.sampleRefs) || definition.sampleRefs.length < 1 || definition.sampleRefs.length > 32 || !provider?.acquire || !resources?.reserve ||
      ![44100, 48000, 96000].includes(sampleRate) || !reference && !stage || typeof OfflineAudioContext !== 'function' || typeof isCurrent !== 'function')
    throw new Error('Native offline material requires bounded pinned local samples and an isolated native decode owner.');
  let context = null, material = null, error = null;
  const storage = resources.reserve({ kind: 'native-render-decode-context', owner, generation, bytes: 8, estimateBytes: 16 * 1048576, consumerOwned: true });
  try {
    context = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate });
    if (context.sampleRate !== sampleRate || typeof context.decodeAudioData !== 'function' || typeof context.startRendering !== 'function') throw new Error('Native offline decoding is unavailable at the selected rate.');
    material = await provider.acquire({ reference, stage, patchIdentity, engineDescriptors, owner, generation, signal, isCurrent,
      decodeProfile: 'native-context', decodeContext: context, joinCancellation: true });
    signal?.throwIfAborted(); if (!isCurrent()) throw new Error('Native render material selection changed.');
    const expected = new Map(definition.sampleRefs.map(ref => [ref.sha256, ref]));
    if (material.assets.length !== expected.size) throw new Error('Native decoded material source inventory differs from the saved patch.');
    const seen = new Set();
    for (const pin of material.assets) {
      const ref = expected.get(pin?.ref?.contentHash);
      if (!ref || seen.has(pin.ref.contentHash) || !pin.isActive?.() || pin.ref.bytes !== ref.bytes || pin.variant?.decoderVersion !== DECODER_VERSION ||
          pin.variant.targetSampleRate !== sampleRate || pin.buffer.sampleRate !== sampleRate) throw new Error('Native decoded material differs from the exact saved sample or output rate.');
      seen.add(pin.ref.contentHash);
    }
  } catch (caught) { error = caught instanceof Error ? caught : new Error('Native material preparation failed.', { cause: caught }); }
  // Joined material cancellation has already waited for any accepted native
  // decode. Drain a one-frame silent context before releasing its estimate.
  let nativeFailure = null;
  try {
    if (context && context.state !== 'closed') {
      const result = await context.startRendering();
      if (result.length !== 1 || result.sampleRate !== sampleRate || result.numberOfChannels !== 2) throw new Error('Native decode context returned an unexpected retirement buffer.');
    }
  } catch (caught) { nativeFailure = caught; }
  if (nativeFailure) {
    storage.retainUnknown(nativeFailure);
    const scope = createProcgenRetirementScope(), retirement = scope.retire([{ name: 'native-decode-context', run: () => { throw nativeFailure; } }]);
    error = Object.assign(new Error('Native decode context retirement remains unresolved.'), { cause: error || nativeFailure, retirement, retainedNative: { context, material } });
  } else {
    try { storage.release(); } catch (caught) {
      const retirement = createProcgenRetirementScope().retire([{ name: 'native-decode-context-storage', run: () => { throw caught; } }]);
      error = Object.assign(new Error('Native decode context storage retirement failed.'), { cause: error || caught, retirement });
    }
  }
  context = null;
  if (error) {
    if (material) { const receipt = material.release(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; }
    throw error;
  }
  let released = false; const scope = createProcgenRetirementScope();
  return Object.freeze({ get assets() { if (released) throw new Error('Native render material was retired.'); return material.assets; },
    descriptor: Object.freeze({ encodedHash: material.assets.length === 1 ? material.assets[0].ref.contentHash : null, decoderVersion: DECODER_VERSION, sampleRate,
      bytes: material.assets.reduce((sum, pin) => sum + pin.buffer.length * pin.buffer.numberOfChannels * 4, 0),
      assets: Object.freeze(material.assets.map(pin => Object.freeze({ encodedHash: pin.ref.contentHash, sourceFrames: pin.ref.frames, sourceSampleRate: pin.ref.sourceSampleRate,
        frames: pin.buffer.length, channels: pin.buffer.numberOfChannels }))), nativeContext: 'isolated-one-frame-decode-owner', nativeContextRetired: true }),
    release() { return scope.retire([{ name: 'native-render-material', run: () => { const receipt = material.release();
      const settle = value => { if (value.outcome === 'complete') { released = true; material = null; } };
      if (receipt.state === 'retired') settle(receipt); else receipt.completion.then(settle); return receipt; } }]); } });
}
