import { createAudioAssetLoader } from './AudioAssetLoader.js';
import { validateAudioAssetRef, DECODER_VERSION } from './AudioAssetRef.js';
import { createSoundContentRegistry } from './SoundContentRegistry.js';
import { borrowSoundContentStage } from './SoundContentReader.js';
import { createAudioResourceLeases } from './AudioResourceLeases.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { createResourceBudget } from '../resources/ResourceBudget.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'SoundContentError', code });
let nextProvider = 0;
export function createSoundMaterialProvider({ getContext, resourceBudget = null, registry = null, jobs = backgroundJobService, maxEntries = 128 } = {}) {
  if (typeof getContext !== 'function' || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 128) throw new TypeError('Invalid sound material provider.');
  const budget = resourceBudget || createResourceBudget(), ownRegistry = !registry;
  registry ||= createSoundContentRegistry({ resourceBudget: budget });
  const resources = createAudioResourceLeases({ resourceBudget: budget, ownerPrefix: 'sound-material-' + (++nextProvider) });
  const metadata = resources.reserve({ kind: 'wave-metadata-cache', bytes: maxEntries * 1024 });
  const formats = new Map(), sources = new Map(), pending = new Set(), loans = new Set(), faults = new Set();
  const retirement = createProcgenRetirementScope(); let disposed = false, sequence = 0;
  const borrowBlob = async (file, stage, signal) => {
    signal?.throwIfAborted();
    let loan = stage ? borrowSoundContentStage(stage) : null;
    try {
      let blob = loan?.assetBlob(file.sha256);
      if (!blob) { loan?.release(); loan = await registry.loadAsset(file.sha256, file.bytes, { signal }); blob = loan?.blob; }
      if (!blob || blob.size !== file.bytes) throw failure('asset-missing', 'Exact local sound material is unavailable: ' + file.path);
      return { blob, release: () => loan?.release() };
    } catch (error) { loan?.release(); throw error; }
  };
  const loader = createAudioAssetLoader({ getContext, resourceBudget: budget, maxEntries,
    fetchAsset: async (ref, { signal }) => {
      const source = [...(sources.get(ref.contentHash) || [])].find(entry => !entry.signal.aborted);
      const file = source?.file || { sha256: ref.contentHash, bytes: ref.bytes, path: ref.path };
      const loan = await borrowBlob(file, source?.stage, signal);
      try { const bytes = new Uint8Array(await loan.blob.arrayBuffer()); signal.throwIfAborted(); return bytes; }
      finally { loan.release(); }
    } });
  const inspect = async (file, stage, operation) => {
    let format = formats.get(file.sha256);
    if (format) {
      if (format.bytes !== file.bytes) throw failure('content-mismatch', 'Sound material byte inventory changed.');
      formats.delete(file.sha256); formats.set(file.sha256, format); return format;
    }
    const workspace = resources.reserve({ kind: 'wave-inspection', owner: operation.id, bytes: file.bytes,
      estimateBytes: Math.max(16 * 1048576, file.bytes * 8 + 1048576), consumerOwned: true });
    let source = null, result = null, error = null;
    try {
      source = await borrowBlob(file, stage, operation.controller.signal);
      const bytes = new Uint8Array(await source.blob.arrayBuffer()); operation.check();
      result = await jobs.compute({ kind: 'inspect-wave-asset', ownerId: 'sound-material-wave', ownerEpoch: operation.id,
        sourceRevision: file.sha256, signal: operation.controller.signal, isCurrent: operation.current, inputBytes: file.bytes, maxBytes: file.bytes,
        estimatedPeakBytes: Math.max(16 * 1048576, file.bytes * 8 + 1048576), deadlineMs: 60000, prepareInput: () => ({ bytes, contentHash: file.sha256 }) });
      operation.check(); const value = result.value;
      if (value.contentHash !== file.sha256 || value.bytes !== file.bytes || value.verifiedContainer !== 'riff-wave-complete') throw failure('content-mismatch', 'WAV inspection identity changed.');
      format = Object.freeze({ ...value });
    } catch (caught) { error = caught; }
    finally {
      const receipt = createProcgenRetirementScope().retire([
        { name: 'wave-worker', run: () => {
          result?.release(); const state = result?.retirementState() || error?.backgroundRetirement;
          if (state && !['released', 'canceled'].includes(state.phase)) throw failure('retirement-unknown', 'WAV inspection worker retirement is unknown.');
        } }, { name: 'wave-blob-reader', run: () => source?.release() }
      ]);
      await receipt.completion;
      if (receipt.outcome === 'complete') {
        const reservation = createProcgenRetirementScope().retire([{ name: 'wave-workspace', run: () => workspace.release() }]);
        if (reservation.outcome !== 'complete') { faults.add(reservation); error = Object.assign(failure('retirement-unknown', 'WAV preparation workspace remains unresolved.'), { retirement: reservation }); }
      }
      else { workspace.retainUnknown(new Error('WAV inspection retirement is unknown.')); faults.add(receipt); error = Object.assign(failure('retirement-unknown', 'WAV preparation source remains unresolved.'), { retirement: receipt }); }
    }
    if (error) throw error;
    if (formats.size >= maxEntries) formats.delete(formats.keys().next().value); formats.set(file.sha256, format); return format;
  };
  const acquire = async ({ stage = null, patchIdentity = null, reference = null, engineDescriptors = [], owner = 'sound-material', generation = 0, signal, isCurrent = () => true } = {}) => {
    signal?.throwIfAborted();
    if (disposed || faults.size || pending.size >= 2 || loans.size >= 32 || !Number.isSafeInteger(generation) || generation < 0) throw failure('material-preparation-capacity', 'Sound material preparation is unavailable or busy.');
    const operation = { id: ++sequence, controller: new AbortController(), completion: null };
    operation.current = () => !disposed && !operation.controller.signal.aborted && isCurrent();
    operation.check = () => { operation.controller.signal.throwIfAborted(); if (!operation.current()) throw failure('stale-owner', 'Sound material source changed.'); };
    const cancel = () => operation.controller.abort(signal.reason); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    let source = null, assets = [], registration = [], releaseReceipt = null, sourceRetirement = null;
    const releaseSource = () => {
      sourceRetirement ||= createProcgenRetirementScope().retire([{ name: 'material-pack-reader', run: () => source?.release() }]);
      if (sourceRetirement.outcome !== 'complete') { faults.add(sourceRetirement); throw Object.assign(failure('retirement-unknown', 'Sound pack reader retirement is unknown.'), { retirement: sourceRetirement }); }
      source = null;
    };
    const releaseAssets = () => releaseReceipt ||= createProcgenRetirementScope().retire(assets.map((pin, index) => ({ name: 'decoded-material-' + index, run: () => pin.release() })));
    const work = (async () => {
      try {
        source = stage ? borrowSoundContentStage(stage) : await registry.loadPack(reference?.packHash, { signal: operation.controller.signal, engineDescriptors }); operation.check();
        if (!source) throw failure('asset-missing', 'The pinned sound pack is not installed locally.');
        const prepared = source.prepared, patch = prepared.patches.find(entry => reference ? entry.definitionHash === reference.definitionHash && entry.identity === reference.patchId + '@' + reference.revision : entry.identity === patchIdentity);
        if (!patch || patch.state !== 'definition-admitted' || reference && prepared.contentHash !== reference.packHash) throw failure('content-mismatch', 'Pinned sound material definition is unavailable.');
        const refs = patch.definition.sampleRefs;
        if (refs.length > 1 || patch.dependencies.some(hash => !refs.some(ref => ref.sha256 === hash))) throw failure('material-adapter-unavailable', 'This material needs a supported single-source adapter.');
        for (const ref of refs) {
          const file = prepared.pack.files.find(entry => entry.sha256 === ref.sha256);
          if (!file || file.bytes !== ref.bytes || file.kind !== 'sample') throw failure('asset-missing', 'The exact WAV source inventory is unavailable.');
          const entry = { stage, file, signal: operation.controller.signal }; let entries = sources.get(file.sha256);
          if (!entries) { entries = new Set(); sources.set(file.sha256, entries); } entries.add(entry); registration.push([file.sha256, entry]);
          const format = await inspect(file, stage, operation); operation.check();
          const assetRef = validateAudioAssetRef({ contentHash: file.sha256, bytes: file.bytes, path: file.path, mime: file.mediaType, kind: file.kind,
            channels: format.channels, sourceSampleRate: format.sourceSampleRate, frames: format.frames, decodeVersion: DECODER_VERSION,
            licenseId: file.rights.licenseId, attribution: file.rights.attribution });
          assets.push(await loader.acquire(assetRef, { owner, generation, signal: operation.controller.signal, isCurrent: operation.current })); operation.check();
        }
        releaseSource();
        const captured = Object.freeze([...assets]), loan = Object.freeze({ assets: captured, availableHashes: Object.freeze(refs.map(ref => ref.sha256)),
          release() { const receipt = releaseAssets(); if (receipt.outcome === 'complete') loans.delete(loan); else faults.add(receipt); return receipt; } });
        loans.add(loan); return loan;
      } catch (error) { const receipt = releaseAssets(); await receipt.completion; if (receipt.outcome !== 'complete') { faults.add(receipt); error.retirement = receipt; } throw error; }
      finally {
        signal?.removeEventListener('abort', cancel);
        for (const [hash, entry] of registration) { const entries = sources.get(hash); entries?.delete(entry); if (!entries?.size) sources.delete(hash); }
        releaseSource();
      }
    })();
    operation.completion = work; pending.add(operation);
    try { return await work; } finally { pending.delete(operation); }
  };
  return Object.freeze({ acquire,
    diagnostics: () => Object.freeze({ pending: pending.size, loans: loans.size, formats: formats.size, faults: faults.size, loader: loader.diagnostics(), resources: resources.diagnostics(), disposed }),
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true;
      for (const operation of pending) operation.controller.abort(failure('owner-retired', 'Sound material owner retired.'));
      let readers, cache;
      return retirement.retire([
        { name: 'material-readers', run: () => readers = createProcgenRetirementScope().retire([{ name: 'pending-material', run: async () => {
          await Promise.allSettled([...pending].map(operation => operation.completion));
          return createProcgenRetirementScope().retire([...loans].map((loan, index) => ({ name: 'material-' + index, run: () => loan.release() })));
        } }]) },
        { name: 'decoded-cache', run: async () => { await readers.completion; cache = loader.dispose(); await cache.completion; return cache; } },
        { name: 'stored-material', run: async () => { await readers.completion; if (ownRegistry) return registry.close(); } },
        { name: 'material-reservations', run: async () => {
          await readers.completion;
          if (!cache) cache = loader.dispose(); await cache.completion;
          if (readers.outcome !== 'complete' || cache.outcome !== 'complete' || faults.size) throw failure('retirement-unknown', 'Sound material still has unresolved native ownership.');
          formats.clear(); metadata.release(); return resources.dispose();
        } }
      ]);
    }
  });
}
