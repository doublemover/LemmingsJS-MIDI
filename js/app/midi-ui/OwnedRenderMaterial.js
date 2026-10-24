import { prepareOwnedPcmBank } from './OwnedPcmBank.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export async function prepareOwnedRenderMaterial({ provider, resources, definition, reference = null, stage = null, patchIdentity = null, engineDescriptors,
  owner, generation = 0, signal, isCurrent = () => true } = {}) {
  if (definition?.engineId !== 'worklet-granular') return null;
  if (!provider?.acquire || !resources?.reserve || definition.sampleRefs?.length !== 1 || !stage && !reference) throw new Error('Granular rendering needs one pinned local source and its material owner.');
  let material = null, bank = null, copy = null, failure = null;
  const scope = createProcgenRetirementScope();
  const release = () => scope.retire([
    { name: 'material-preparation-fault', run: () => failure }, { name: 'render-pcm-input', run: () => copy?.release() },
    { name: 'render-pcm-bank', run: () => bank?.discard() }, { name: 'decoded-render-material', run: () => material?.release() }
  ]);
  try {
    material = await provider.acquire({ reference, stage, patchIdentity, engineDescriptors, owner, generation, decodeProfile: 'source-pcm', signal, isCurrent });
    signal?.throwIfAborted();
    const pin = material.assets[0];
    if (material.assets.length !== 1 || pin.ref.contentHash !== definition.sampleRefs[0].sha256 || pin.ref.bytes !== definition.sampleRefs[0].bytes) throw new Error('Render material differs from its exact source reference.');
    bank = await prepareOwnedPcmBank(pin, { resources, owner, generation, signal, isCurrent });
    copy = await bank.copyForProcessor({ signal, isCurrent });
    const decoded = material.release(); await decoded.completion;
    if (decoded.outcome !== 'complete') throw Object.assign(new Error('Decoded render material retirement is unknown.'), { retirement: decoded });
    material = null;
    return Object.freeze({ descriptor: bank.descriptor, get payload() { return copy.payload; }, release });
  } catch (error) {
    failure = error.retirement || null; const receipt = release(); await receipt.completion;
    if (receipt.outcome !== 'complete') error.retirement = receipt; throw error;
  }
}
