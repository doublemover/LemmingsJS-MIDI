import { prepareOwnedPcmBank } from './OwnedPcmBank.js';
import { prepareOwnedPcmSet } from './OwnedPcmSet.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export async function prepareOwnedRenderMaterial({ provider, resources, definition, reference = null, stage = null, patchIdentity = null, engineDescriptors,
  owner, generation = 0, signal, isCurrent = () => true } = {}) {
  if (!['worklet-granular', 'worklet-sample', 'worklet-seed-layers'].includes(definition?.engineId)) return null;
  const set = ['worklet-sample', 'worklet-seed-layers'].includes(definition.engineId);
  if (!provider?.acquire || !resources?.reserve || !Array.isArray(definition.sampleRefs) || definition.sampleRefs.length < 1 || definition.sampleRefs.length > (set ? 32 : 1) || !stage && !reference) throw new Error('Owned rendering needs complete pinned local source material.');
  let material = null, bank = null, copy = null, failure = null;
  const scope = createProcgenRetirementScope();
  const release = () => scope.retire([
    { name: 'material-preparation-fault', run: () => failure }, { name: 'render-pcm-input', run: () => copy?.release() },
    { name: 'render-pcm-bank', run: () => bank?.discard() }, { name: 'decoded-render-material', run: () => material?.release() }
  ]);
  try {
    material = await provider.acquire({ reference, stage, patchIdentity, engineDescriptors, owner, generation, decodeProfile: 'source-pcm', signal, isCurrent });
    signal?.throwIfAborted();
    const expected = new Map(definition.sampleRefs.map(ref => [ref.sha256, ref]));
    if (material.assets.length !== expected.size || new Set(material.assets.map(pin => pin.ref.contentHash)).size !== expected.size || material.assets.some(pin => expected.get(pin.ref.contentHash)?.bytes !== pin.ref.bytes)) throw new Error('Render material differs from its exact source reference inventory.');
    bank = await (set ? prepareOwnedPcmSet : prepareOwnedPcmBank)(set ? material.assets : material.assets[0], { resources, owner, generation, signal, isCurrent });
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
