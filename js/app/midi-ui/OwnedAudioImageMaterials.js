import { encodeOwnedAudioImage, openOwnedAudioImage, inspectOwnedAudioImage } from './OwnedAudioImageOwner.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { getOwnedSourceProfile } from './OwnedSourceProfiles.js';
import { validateSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { prepareOwnedPcmBank } from './OwnedPcmBank.js';
import { prepareOwnedPcmSet } from './OwnedPcmSet.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
let serial = 0;
const fail = message => { throw Object.assign(new Error(message), { name: 'AudioRestoreError', code: 'audio-image-materials' }); };
const check = options => { options.signal?.throwIfAborted(); if (options.isCurrent?.() === false) fail('The audio image material source changed.'); };
const join = async receipt => { await receipt?.completion; if (receipt?.outcome && receipt.outcome !== 'complete') throw Object.assign(new Error('Audio image material retirement remains unresolved.'), { retirement: receipt }); };
async function withMaterials(rows, options, work) {
  check(options);
  if (!Array.isArray(rows) || rows.length > 16 || new Set(rows.map(row => row?.sourceId)).size !== rows.length || rows.some(row => typeof row?.sourceId !== 'string' || !row.sourceId || row.sourceId.length > 160)) fail('Use the exact bounded source reference inventory.');
  const sources = rows.map(row => { const reference = validateSoundContentReference(row.reference), profile = reference && getOwnedSourceProfile(reference.engineRequirement.engineId); if (!reference || !profile) fail('An audio image needs its exact supported owned source references.'); return { sourceId: row.sourceId, reference, pcm: row.pcm ?? null, profile }; });
  const entries = [], retirement = createProcgenRetirementScope(), buffers = createProcgenRetirementScope(); let result = null, failure = null;
  try {
    let catalog = null;
    for (const source of sources) {
      check(options); if (!source.profile.requiresPCM || source.pcm) continue;
      if (!options.materialProvider?.acquire || !options.resources?.reserve) fail('Enable the canonical sample material provider before reopening this image.');
      catalog ||= await (options.getCatalog || getNativeInstrumentCatalog)(); check(options);
      if (catalog.state !== 'bound-application-engines') fail('The sample material loader has no bound engine inventory.');
      const material = await options.materialProvider.acquire({ reference: source.reference, engineDescriptors: catalog.descriptors, owner: 'audio-image-material:' + (++serial), generation: 0, signal: options.signal, isCurrent: options.isCurrent });
      const entry = { material, bank: null, copy: null }; entries.push(entry); check(options);
      const controls = { resources: options.resources, owner: 'audio-image-pcm:' + serial, generation: 0, signal: options.signal, isCurrent: options.isCurrent, maxPrepareMs: 60000 };
      entry.bank = await (source.profile.requiresPCMSet ? prepareOwnedPcmSet(material.assets, controls) : prepareOwnedPcmBank(material.assets[0], controls)); check(options);
      entry.copy = await entry.bank.copyForProcessor({ signal: options.signal, isCurrent: options.isCurrent, maxCopyMs: 60000 }); check(options); source.pcm = entry.copy.payload;
    }
    result = await work(sources.map(({ profile, ...source }) => source)); check(options);
  } catch (error) { failure = error instanceof Error ? error : new Error(String(error)); }
  const receipt = retirement.retire([{ name: 'owned-pcm-readers-and-banks', run: () => buffers.retire(entries.flatMap((entry, index) => [{ name: 'copy-' + index, run: () => entry.copy?.release() }, { name: 'bank-' + index, run: () => entry.bank?.discard() }])) },
    { name: 'immutable-material-pins', run: async () => { await join(buffers.getReceipt()); if (failure?.retirement && failure.retirement.outcome !== 'complete') throw Object.assign(new Error('A failed material producer still owns its pinned input.'), { retirement: failure.retirement });
      const pins = createProcgenRetirementScope().retire(entries.map((entry, index) => ({ name: 'material-' + index, run: () => entry.material.release() }))); await join(pins); } }]);
  await receipt.completion;
  if (receipt.outcome !== 'complete') failure ||= Object.assign(new Error('Audio image material inputs retain unresolved ownership.'), { retirement: receipt });
  if (failure) {
    if (result?.release) { try { await join(result.release()); } catch (error) { failure.resultRetirement = error.retirement || error; } }
    if (receipt.outcome !== 'complete') failure.materialRetirement = receipt; throw failure;
  }
  return result;
}
export async function encodeMaterializedAudioImage(options = {}) {
  if (!Array.isArray(options.sources)) fail('Encoding requires the captured source references.');
  return withMaterials(options.sources, options, sources => encodeOwnedAudioImage({ ...options, sources }));
}
async function prepareCut(cut, prepare, sources) {
  let result = null, failure = null;
  try { result = await prepare(cut, sources); } catch (error) { failure = error; }
  try { await join(cut.release()); } catch (error) { failure ||= error; }
  if (failure) { if (result?.release) { try { await join(result.release()); } catch (error) { failure.resultRetirement = error.retirement || error; } } throw failure; } return result;
}
async function openWithMaterials(options, prepare) {
  if (Object.hasOwn(options, 'materials')) {
    const cut = await openOwnedAudioImage(options);
    return prepare ? prepareCut(cut, prepare, cut.references().map(row => ({ ...row, pcm: options.materials.find(material => material.sourceId === row.sourceId)?.pcm ?? null }))) : cut;
  }
  const inspection = await inspectOwnedAudioImage(options); let result = null, failure = null;
  try {
    result = await withMaterials(inspection.references(), options, async sources => {
      const cut = await openOwnedAudioImage({ ...options, materials: sources.map(({ sourceId, pcm }) => ({ sourceId, pcm })) });
      return prepare ? prepareCut(cut, prepare, sources) : cut;
    });
  } catch (error) { failure = error; }
  try { await join(inspection.release()); } catch (error) { failure ||= error; }
  if (failure) { if (result?.release) { try { await join(result.release()); } catch (error) { failure.resultRetirement = error.retirement || error; } } throw failure; } return result;
}
export const prepareMaterializedAudioCut = (options = {}, prepare) => { if (typeof prepare !== 'function' || !options.cut) fail('Prepare one retained cut with its complete immutable source references.'); return withMaterials(options.sources, options, sources => prepare(options.cut, sources)); };
export const openMaterializedAudioImage = (options = {}) => openWithMaterials(options, null);
export const prepareMaterializedAudioImage = (options = {}, prepare) => {
  if (typeof prepare !== 'function') fail('A complete image continuation preparer is required.'); return openWithMaterials(options, prepare);
};
