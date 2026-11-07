import { SOUND_ARCHIVE_FORMAT, SOUND_ARCHIVE_MAGIC } from './SoundContentArchive.js';
import { prepareSoundContentPack } from '../../midi/content/SoundContentPack.js';
import { validateDrumKitBinding } from '../../midi/content/DrumKitDefinition.js';
import { canonicalDataText } from '../../core/CanonicalData.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { retireBackgroundResult } from '../resources/ResourceRetirement.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { readStagedDrumKit } from './DrumKitReference.js';

const fail = message => Object.assign(new Error('Circuit Workshop: ' + message), { code: 'circuit-workshop-preparation-unavailable' });
export async function prepareCircuitWorkshopPack({ variant, jobs, reader, resourceBudget, signal, isCurrent = () => true, stageIsCurrent = isCurrent, getCatalog = getNativeInstrumentCatalog, onProgress = () => {} } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!isCurrent()) throw fail('The selected original kit preparation changed.'); }; check();
  if (!jobs?.compute || !reader?.stageArchive || !resourceBudget) throw fail('Use the shared background, verified archive and resource owners.');
  const workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'circuit-workshop-preparation', kind: 'original-kit-archive-and-result-copy-overlap', bytes: 32 * 1048576 }), scope = createProcgenRetirementScope(), storage = createProcgenRetirementScope(); let job = null, next = null, fault = null;
  const releaseWorkspace = () => storage.retire([{ name: 'original-kit-overlap-reservation', run: () => workspace.release() }]);
  try {
    const catalog = await getCatalog(); check(); if (catalog.state !== 'bound-application-engines' || !/^[a-f0-9]{64}$/.test(catalog.executionIdentity?.buildId || '')) throw fail('Use the exact installed application build.');
    job = await jobs.compute({ kind: 'build-circuit-workshop', ownerId: 'circuit-workshop', ownerEpoch: 0, sourceRevision: variant, inputBytes: 512, maxBytes: 16 * 1048576, estimatedPeakBytes: 128 * 1048576, deadlineMs: 120000, signal, isCurrent, budgetAdapter: resourceBudget, onProgress, prepareInput: () => ({ variant, applicationBuildId: catalog.executionIdentity.buildId }) }); check();
    const value = job.value, prepared = await prepareSoundContentPack(value?.pack, { engineDescriptors: catalog.descriptors, signal }); check();
    if (prepared.contentHash !== value.contentHash || prepared.patches.length !== 1 || !Array.isArray(value.assets) || value.assets.length !== prepared.pack.files.length || new Set(value.assets.map(asset => asset?.sha256)).size !== value.assets.length || value.assets.some(asset => !(asset?.bytes instanceof Uint8Array) || !(asset.bytes.buffer instanceof ArrayBuffer)) || value.assets.reduce((sum, asset) => sum + asset.bytes.length, 0) > 16 * 1048576) throw fail('The original producer returned a different or oversized complete kit inventory.');
    const kit = validateDrumKitBinding(value.kit, prepared.patches[0].archivedDefinition), files = new Map(prepared.pack.files.map(file => [file.sha256, file]));
    if (kit.variant !== variant || value.assets.some(asset => !files.has(asset.sha256) || files.get(asset.sha256).path !== asset.path || files.get(asset.sha256).bytes !== asset.bytes.length)) throw fail('The original source bytes differ from their exact compiled kit inventory.');
    const assets = [...value.assets].sort((a, b) => a.sha256 < b.sha256 ? -1 : 1), header = canonicalDataText({ format: SOUND_ARCHIVE_FORMAT, mode: 'portable', contentHash: prepared.contentHash, pack: prepared.pack, payloads: assets.map(asset => ({ sha256: asset.sha256, bytes: asset.bytes.length })), rightsReview: [], qualification: 'verified-material-not-render-qualified' }, { maxBytes: 4 * 1048576, maxNodes: 131072 }), prefix = new Uint8Array(12); prefix.set(new TextEncoder().encode(SOUND_ARCHIVE_MAGIC)); new DataView(prefix.buffer).setUint32(8, header.bytes.length, false);
    const blob = new Blob([prefix, header.bytes, ...assets.map(asset => asset.bytes)], { type: 'application/vnd.lemmings.sound-pack' });
    next = await reader.stageArchive(blob, { engineDescriptors: catalog.descriptors, signal, isCurrent, stageIsCurrent }); check();
    const stagedKit = await readStagedDrumKit(next, prepared.patches[0].identity, { signal, resourceBudget }); check();
    if (!stagedKit || stagedKit.hash !== value.kitHash || canonicalDataText(stagedKit.definition).text !== canonicalDataText(kit).text) throw fail('The producer kit label differs from its verified staged data.');
    const receipt = scope.retire([{ name: 'original-kit-worker', run: () => retireBackgroundResult(job) }]); await receipt.completion;
    if (receipt.outcome !== 'complete') throw Object.assign(fail('Original kit producer retirement is unknown.'), { retirement: receipt }); job = null;
    const released = releaseWorkspace(); await released.completion; if (released.outcome !== 'complete') throw Object.assign(fail('Original kit copy reservation retirement is unresolved.'), { retirement: released }); const result = Object.freeze({ stage: next, name: kit.name, voices: kit.voices.length, variant, qualification: 'prepared-original-source;audition-and-listening-required' }); next = null; return result;
  } catch (error) {
    if (error.backgroundRetirementCompletion) error.backgroundRetirement = await error.backgroundRetirementCompletion;
    if (error.backgroundRetirement && !['released', 'canceled'].includes(error.backgroundRetirement.phase)) fault = error;
    const upstream = error.retirement, receipts = createProcgenRetirementScope().retire([{ name: 'original-kit-producer', run: () => retireBackgroundResult(job) }, { name: 'failed-background-producer', run: () => { if (fault) throw fault; } }, { name: 'upstream-preparation', run: async () => { if (!upstream) return; if (upstream.completion) await upstream.completion; if (upstream.outcome !== 'complete') throw fail('An upstream source reader retains unresolved ownership.'); } }, { name: 'unpublished-original-kit-stage', run: () => { if (!next) return; next.discard(); const state = next.metadata(); if (state.retirement !== 'released' || state.activeLeases) throw fail('Unpublished original kit still has active readers.'); } }]); await receipts.completion;
    let released = storage.getReceipt(); if (receipts.outcome === 'complete' && (!scope.getReceipt() || scope.getReceipt().outcome === 'complete')) { released = releaseWorkspace(); await released.completion; }
    if (receipts.outcome !== 'complete' || scope.getReceipt()?.outcome && scope.getReceipt().outcome !== 'complete' || released?.outcome !== 'complete') {
      const unresolved = createProcgenRetirementScope().retire([{ name: 'original-kit-cleanup', run: () => receipts }, { name: 'original-kit-producer', run: () => scope.getReceipt() }, { name: 'original-kit-storage', run: () => released }]); await unresolved.completion; error.retirement = unresolved; error.circuitWorkshopOwnership = { job, next, workspace, producer: scope.getReceipt(), cleanup: receipts, storage: released, upstream };
    }
    throw error;
  }
}
