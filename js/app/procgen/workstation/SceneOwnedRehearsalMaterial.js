import { prepareOwnedRenderMaterial } from '../../midi-ui/OwnedRenderMaterial.js';
import { getNativeInstrumentCatalog } from '../../midi-ui/NativeInstrumentSchema.js';
import { OWNED_SOURCE_IDS, getOwnedSourceProfile } from '../../midi-ui/OwnedSourceProfiles.js';
import { createAudioResourceLeases } from '../../midi-ui/AudioResourceLeases.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { sceneOwnedMaterialReceipt } from './SceneRehearsalLane.js';

const fail = message => Object.assign(new Error('Owned scene material: ' + message), { code: 'scene-owned-material-unavailable' });
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const metadataPcm = pcm => pcm ? { descriptor: pcm.descriptor, ...(pcm.banks ? { banks: pcm.banks.map(bank => ({ descriptor: bank.descriptor, planes: null })) } : { planes: null }) } : null;

export async function prepareSceneOwnedRehearsalMaterial({ scene, resourceBudget, getMaterialProvider, signal, isCurrent = () => true, getCatalog = getNativeInstrumentCatalog, prepareMaterial = prepareOwnedRenderMaterial } = {}) {
  const indices = scene.patchRefs.flatMap((row, index) => row.reference.assetHashes.length && OWNED_SOURCE_IDS.includes(row.reference.engineRequirement.engineId) ? [index] : []);
  if (!indices.length) return null;
  if (indices.length > 8 || typeof getMaterialProvider !== 'function') throw fail('Use at most eight pinned owned lanes and the shared material provider.');
  const resources = createAudioResourceLeases({ resourceBudget, ownerPrefix: 'scene-owned-rehearsal' }), scope = createProcgenRetirementScope(), records = []; let bytes = 0, pcmLanes = 0, released = false, retirement = null;
  const check = () => { signal?.throwIfAborted(); if (!isCurrent()) throw fail('The scene or material source changed.'); };
  const retire = () => {
    if (scope.getReceipt()) return scope.getReceipt(); released = true; for (const record of records) record.input = null; let readers = null;
    const acknowledged = value => { if (value !== true && value?.schema !== 'lemmings-retirement/v1') throw fail('A source reader did not acknowledge its retirement.'); return value; };
    retirement = scope.retire([{ name: 'owned-scene-readers', run: () => readers = createProcgenRetirementScope().retire(records.map((record, index) => ({ name: 'owned-scene-material-' + index, run: () => { const material = record.material || record.dataLoan; if (!material) return; const value = material.release(); return value?.then ? Promise.resolve(value).then(acknowledged) : acknowledged(value); } }))) }, { name: 'owned-scene-resources', run: async () => { await readers.completion; if (readers.outcome !== 'complete') throw fail('Owned source material readers retain unresolved ownership.'); const result = resources.dispose(); await result.completion; if (result.outcome !== 'complete') throw fail('Owned source reservations retain unresolved ownership.'); } }]); return retirement;
  };
  try {
    check(); const catalog = await getCatalog(); check(); if (catalog.state !== 'bound-application-engines' || catalog.executionIdentity?.buildId !== scene.sourceVersion.hash) throw fail('Use the exact current scene audio build.');
    const provider = getMaterialProvider(); if (typeof provider?.acquire !== 'function') throw fail('Pinned local scene source material is unavailable.');
    for (const index of indices) {
      check(); const reference = scene.patchRefs[index].reference, profile = getOwnedSourceProfile(reference.engineRequirement.engineId), descriptor = catalog.descriptors.find(value => value.engineId === reference.engineRequirement.engineId);
      if (!descriptor || !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => descriptor[key] === reference.engineRequirement[key])) throw fail('A pinned scene engine differs from its executing artifact.');
      const record = { material: null, dataLoan: null, input: null, receipt: null }; records.push(record); let verifiedDependencyHashes = null, pcm = null;
      if (profile.requiresPCM) {
        if (++pcmLanes > 4) throw fail('The private preview admits at most four PCM-backed source lanes.');
        record.material = await prepareMaterial({ provider, resources, definition: reference.definition, reference, engineDescriptors: catalog.descriptors, owner: 'scene-owned:' + scene.id + ':' + index, generation: 0, signal, isCurrent }); check();
        pcm = record.material.payload; verifiedDependencyHashes = record.material.verifiedDependencyHashes; const nextBytes = record.material.descriptor?.bytes;
        if (!Number.isSafeInteger(nextBytes) || nextBytes < 1 || bytes + nextBytes > 16 * 1048576) throw fail('The aggregate private source PCM exceeds its 16 MiB profile.'); bytes += nextBytes;
      } else {
        record.dataLoan = await provider.acquire({ reference, engineDescriptors: catalog.descriptors, owner: 'scene-data:' + scene.id + ':' + index, generation: 0, signal, isCurrent }); check();
        if (record.dataLoan.assets.length) throw fail('A data-only source cannot substitute decoded PCM.'); verifiedDependencyHashes = record.dataLoan.availableHashes;
      }
      if (!Array.isArray(verifiedDependencyHashes) || verifiedDependencyHashes.length > 512 || verifiedDependencyHashes.some(value => !hash(value)) || new Set(verifiedDependencyHashes).size !== verifiedDependencyHashes.length || reference.assetHashes.some(value => !verifiedDependencyHashes.includes(value))) throw fail('The complete exact recipe/source ancestry must be verified before private rendering.');
      record.input = { sourceIndex: index, verifiedDependencyHashes: [...verifiedDependencyHashes], pcm };
      record.receipt = await sceneOwnedMaterialReceipt(record.input, reference); check();
    }
    check(); return Object.freeze({ bytes, inputs() { if (released) throw fail('Private material input references are retired.'); return records.map(record => record.input); }, metadata() { if (released) throw fail('Private material input references are retired.'); return records.map(record => ({ ...record.input, pcm: metadataPcm(record.input.pcm) })); },
      // Snapshot handoff drops these input references. Async bank retirement is
      // still owned and charged here, and the rehearsal joins retire() separately.
      receipts: () => records.map(record => record.receipt), releaseInputs() { retire(); return true; }, retire });
  } catch (error) { const receipt = retire(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
