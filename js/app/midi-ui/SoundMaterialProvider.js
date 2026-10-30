import { sharedContentJobsFor } from '../resources/SharedContentJobs.js';
import { verifyDrumKitDecodedSources } from '../../midi/content/DrumKitDefinition.js';
import { getProceduralSoundMaterial } from '../../midi/content/ProceduralSoundMaterial.js';
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
export function createSoundMaterialProvider({ getContext, resourceBudget = null, registry = null, jobs = backgroundJobService, contentJobs = sharedContentJobsFor(jobs), maxEntries = 128 } = {}) {
  if (typeof contentJobs?.acquire !== 'function' || typeof getContext !== 'function' || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 128) throw new TypeError('Invalid sound material provider.');
  const budget = resourceBudget || createResourceBudget(), ownRegistry = !registry;
  registry ||= createSoundContentRegistry({ resourceBudget: budget });
  const resources = createAudioResourceLeases({ resourceBudget: budget, ownerPrefix: 'sound-material-' + (++nextProvider) });
  const metadata = resources.reserve({ kind: 'wave-metadata-cache', bytes: maxEntries * 1024 });
  const formats = new Map(), sources = new Map(), pending = new Set(), loans = new Set(), encodedLoans = new Set(), faults = new Set();
  const retirement = createProcgenRetirementScope(); let disposed = false, sequence = 0;
  const generateSource = async (file, signal) => {
    const original = getProceduralSoundMaterial(file); if (!original) return null;
    const workspace = resources.reserve({ kind: 'procedural-sound-material', estimateBytes: 16 * 1048576, consumerOwned: true });
    let result = null, receipt = null, storage = null, blob = null;
    const release = () => {
      receipt ||= createProcgenRetirementScope().retire([{ name: 'original-source-worker', run: () => {
        result?.release(); if (result && !['released', 'canceled'].includes(result.retirementState().phase)) throw failure('retirement-unknown', 'Original source producer retirement is unknown.');
      } }]);
      if (receipt.outcome === 'complete') {
        storage ||= createProcgenRetirementScope().retire([{ name: 'original-source-storage', run: () => workspace.release() }]);
        if (storage.outcome !== 'complete') { faults.add(storage); return storage; }
      } else { workspace.retainUnknown(new Error('Original source retirement is unknown.')); faults.add(receipt); }
      if (receipt.outcome === 'complete' && storage?.outcome === 'complete') { result = null; blob = null; }
      return receipt;
    };
    try {
      result = await contentJobs.acquire({ kind: 'generate-procedural-sound', contentHash: original.sha256, decoderVersion: 'procedural-v1.' + original.id, budgetAdapter: budget, inputBytes: 128, maxBytes: 1048576, estimatedPeakBytes: 16 * 1048576, signal,
        isCurrent: () => !disposed, deadlineMs: 60000, prepareInput: () => ({ id: original.id }) });
      signal?.throwIfAborted();
      if (!(result.value.bytes instanceof Uint8Array) || result.value.bytes.byteLength !== original.bytes || result.value.hash !== original.sha256 || result.value.id !== original.id)
        throw failure('content-mismatch', 'Original source generation returned a different immutable asset.');
      blob = new Blob([result.value.bytes], { type: file.mediaType });
      return { get blob() { if (!blob || receipt) throw failure('owner-retired', 'Original source loan is retired.'); return blob; }, release };
    } catch (error) {
      if (error.backgroundRetirementCompletion) error.backgroundRetirement = await error.backgroundRetirementCompletion;
      if (error.backgroundRetirement && !['released', 'canceled'].includes(error.backgroundRetirement.phase)) {
        workspace.retainUnknown(error); const failed = createProcgenRetirementScope().retire([{ name: 'original-source-worker', run: () => { throw error; } }]); faults.add(failed); error.retirement = failed;
      } else { const retired = release(); if (retired.outcome !== 'complete') error.retirement = retired; }
      throw error;
    }
  };
  const borrowBlob = async (file, stage, signal) => {
    signal?.throwIfAborted();
    if (disposed || faults.size || encodedLoans.size >= 64) throw failure('material-preparation-capacity', 'Encoded sound readers are unavailable or busy.');
    const readerStorage = resources.reserve({ kind: 'encoded-material-reader', bytes: 4096, consumerOwned: true });
    let loan = null, blob = null, receipt = null, storageRetirement = null;
    const reader = { get blob() { if (!blob || receipt) throw failure('owner-retired', 'Encoded material loan is retired.'); return blob; }, release: () => {
      receipt ||= createProcgenRetirementScope().retire([{ name: 'encoded-material-reader', run: () => loan?.release() }]);
      if (receipt.outcome !== 'complete') {
        faults.add(receipt); readerStorage.retainUnknown(new Error('Encoded material retirement is unknown.'));
        throw Object.assign(failure('retirement-unknown', 'Encoded material retirement is unknown.'), { retirement: receipt });
      }
      storageRetirement ||= createProcgenRetirementScope().retire([{ name: 'encoded-reader-storage', run: () => readerStorage.release() }]);
      if (storageRetirement.outcome !== 'complete') { faults.add(storageRetirement); throw Object.assign(failure('retirement-unknown', 'Encoded reader storage is unresolved.'), { retirement: storageRetirement }); }
      blob = null; loan = null; encodedLoans.delete(reader); return receipt;
    } };
    encodedLoans.add(reader);
    try {
      loan = stage ? borrowSoundContentStage(stage) : null; blob = loan?.assetBlob(file.sha256);
      if (!blob) {
        loan?.release(); loan = null;
        loan = getProceduralSoundMaterial(file) ? await generateSource(file, signal) : await registry.loadAsset(file.sha256, file.bytes, { signal }); blob = loan?.blob;
      }
      if (!blob || blob.size !== file.bytes) throw failure('asset-missing', 'Exact local sound material is unavailable: ' + file.path);
      return reader;
    } catch (error) { reader.release(); throw error; }
  };
  const loader = createAudioAssetLoader({ getContext, resourceBudget: budget, jobs, maxEntries,
    fetchAsset: async (ref, { signal }) => {
      const source = [...(sources.get(ref.contentHash) || [])].find(entry => !entry.signal.aborted);
      const file = source?.file || { sha256: ref.contentHash, bytes: ref.bytes, path: ref.path };
      const loan = await borrowBlob(file, source?.stage, signal);
      try { const bytes = new Uint8Array(await loan.blob.arrayBuffer()); signal.throwIfAborted(); return bytes; }
      finally { loan.release(); }
    } });
  const inspect = async (file, stage, operation) => {
    const original = getProceduralSoundMaterial(file);
    if (original) return { bytes: original.bytes, channels: original.channels, sourceSampleRate: original.sampleRate, frames: original.frames };
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
        estimatedPeakBytes: Math.max(16 * 1048576, file.bytes * 8 + 1048576), deadlineMs: 60000, prepareInput: () => ({ bytes, contentHash: file.sha256, assetKind: file.kind }) });
      operation.check(); const value = result.value;
      if (value.contentHash !== file.sha256 || value.bytes !== file.bytes || value.verifiedContainer !== 'riff-wave-complete') throw failure('content-mismatch', 'WAV inspection identity changed.');
      format = Object.freeze({ ...value });
    } catch (caught) {
      if (caught.backgroundRetirementCompletion) caught.backgroundRetirement = await caught.backgroundRetirementCompletion;
      error = caught;
    }
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
  const verifyDataDependency = async (file, stage, operation) => {
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 16 * 1048576) throw failure('material-adapter-unavailable', 'The non-playback dependency exceeds its bounded encoded profile.');
    const workspace = resources.reserve({ kind: 'sound-dependency-byte-verification', owner: operation.id, estimateBytes: file.bytes * 3 + 1048576, consumerOwned: true });
    let reader = null, error = null;
    try {
      reader = await borrowBlob(file, stage, operation.controller.signal); operation.check();
      const bytes = new Uint8Array(await reader.blob.arrayBuffer()); operation.check();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join(''); operation.check();
      if (bytes.length !== file.bytes || digest !== file.sha256) throw failure('content-mismatch', 'A sound recipe/model ancestry dependency differs from its immutable bytes.');
    } catch (caught) { error = caught; }
    const retired = createProcgenRetirementScope().retire([{ name: 'sound-dependency-reader', run: () => reader?.release() }]); await retired.completion;
    if (retired.outcome !== 'complete') { workspace.retainUnknown(new Error('Sound ancestry reader retirement is unknown.')); faults.add(retired); throw Object.assign(error || failure('retirement-unknown', 'Sound ancestry reader retirement is unknown.'), { retirement: retired }); }
    const released = createProcgenRetirementScope().retire([{ name: 'sound-dependency-workspace', run: () => workspace.release() }]); await released.completion;
    if (released.outcome !== 'complete') { faults.add(released); throw Object.assign(error || failure('retirement-unknown', 'Sound ancestry workspace retirement is unknown.'), { retirement: released }); }
    if (error) throw error;
  };
  const acquire = async ({ stage = null, patchIdentity = null, reference = null, engineDescriptors = [], owner = 'sound-material', generation = 0, signal, isCurrent = () => true,
    decodeProfile = null, decodeContext = null, joinCancellation = false } = {}) => {
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
        if (refs.length > (['native-sample', 'worklet-sample', 'worklet-seed-layers'].includes(patch.definition.engineId) ? 32 : 1)) throw failure('material-adapter-unavailable', 'This material exceeds its declared playable sample limit.');
        const playbackHashes = new Set(refs.map(ref => ref.sha256)), closure = new Set(patch.dependencies), files = new Map(prepared.pack.files.map(file => [file.sha256, file]));
        for (const hash of closure) {
          if (closure.size > 512) throw failure('material-adapter-unavailable', 'Sound ancestry exceeds its bounded file closure.');
          const file = files.get(hash); if (!file) throw failure('asset-missing', 'An exact sound ancestry dependency is absent from the pinned pack.');
          for (const parent of file.parents || []) closure.add(parent);
        }
        const dataOnlyHashes = [];
        for (const hash of closure) if (!playbackHashes.has(hash)) { await verifyDataDependency(files.get(hash), stage, operation); operation.check(); dataOnlyHashes.push(hash); }
        const sourcePcm = ['worklet-granular', 'worklet-sample', 'worklet-seed-layers'].includes(patch.definition.engineId); let sourcePcmBytes = 0;
        if (['worklet-sample', 'worklet-seed-layers'].includes(patch.definition.engineId) && decodeProfile != null && decodeProfile !== 'source-pcm') throw failure('material-adapter-unavailable', 'Owned sample maps require their canonical source-PCM decoder profile.');
        for (const ref of new Map(refs.map(ref => [ref.sha256, ref])).values()) {
          const file = prepared.pack.files.find(entry => entry.sha256 === ref.sha256);
          if (!file || file.bytes !== ref.bytes || file.kind !== 'sample') throw failure('asset-missing', 'The exact WAV source inventory is unavailable.');
          const entry = { stage, file, signal: operation.controller.signal }; let entries = sources.get(file.sha256);
          if (!entries) { entries = new Set(); sources.set(file.sha256, entries); } entries.add(entry); registration.push([file.sha256, entry]);
          const format = await inspect(file, stage, operation); operation.check();
          if (sourcePcm) { sourcePcmBytes += format.frames * format.channels * 4; if (format.frames > 4194304 || sourcePcmBytes > 16 * 1048576)
            throw failure('source-pcm-capacity', 'These sources exceed the aggregate 16 MiB PCM or per-source 4,194,304-frame profile.'); }
          const assetRef = validateAudioAssetRef({ contentHash: file.sha256, bytes: file.bytes, path: file.path, mime: file.mediaType, kind: file.kind,
            channels: format.channels, sourceSampleRate: format.sourceSampleRate, frames: format.frames, decodeVersion: DECODER_VERSION,
            licenseId: file.rights.licenseId, attribution: file.rights.attribution });
          assets.push(await loader.acquire(assetRef, { owner, generation, signal: operation.controller.signal, isCurrent: operation.current,
            decodeProfile: decodeProfile || (sourcePcm ? 'source-pcm' : 'native-context'), decodeContext, joinCancellation })); operation.check();
        }
        if (reference?.drumKit) verifyDrumKitDecodedSources(reference.drumKit.definition, assets);
        releaseSource();
        const captured = Object.freeze([...assets]), loan = Object.freeze({ assets: captured, availableHashes: Object.freeze([...new Set([...closure, ...playbackHashes])]),
          verification: Object.freeze({ policy: 'verify-entire-dependency-byte-closure;decode-only-declared-playback-samples', dataOnlyHashes: Object.freeze(dataOnlyHashes), playbackSampleHashes: Object.freeze([...playbackHashes]) }),
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
  const acquireImpulse = async (input, { owner = 'impulse-material', generation = 0, signal, isCurrent = () => true, decodeContext = null } = {}) => {
    const ref = validateAudioAssetRef(input);
    if (ref.kind !== 'impulse-response' || disposed || faults.size || pending.size >= 2 || loans.size >= 32 || !Number.isSafeInteger(generation) || generation < 0 || typeof isCurrent !== 'function') throw failure('material-preparation-capacity', 'Impulse material preparation is unavailable or busy.');
    signal?.throwIfAborted();
    const operation = { id: ++sequence, controller: new AbortController(), completion: null };
    operation.current = () => !disposed && !operation.controller.signal.aborted && isCurrent();
    operation.check = () => { operation.controller.signal.throwIfAborted(); if (!operation.current()) throw failure('stale-owner', 'Impulse material source changed.'); };
    const abort = () => operation.controller.abort(signal.reason); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const file = { path: ref.path, sha256: ref.contentHash, bytes: ref.bytes, kind: ref.kind, mediaType: ref.mime, rights: { licenseId: ref.licenseId, attribution: ref.attribution } };
    const entry = { stage: null, file, signal: operation.controller.signal }; let entries = sources.get(ref.contentHash);
    if (!entries) { entries = new Set(); sources.set(ref.contentHash, entries); } entries.add(entry);
    let pin = null;
    operation.completion = (async () => {
      try {
        const format = await inspect(file, null, operation); operation.check();
        if (format.channels !== ref.channels || format.frames !== ref.frames || format.sourceSampleRate !== ref.sourceSampleRate) throw failure('content-mismatch', 'Impulse WAV layout differs from its exact source descriptor.');
        const context = decodeContext || getContext();
        if (!context || context.state === 'closed') throw failure('audio-context-unavailable', 'Impulse decoding requires its existing live or offline owner context.');
        pin = await loader.acquire(ref, { owner, generation, signal: operation.controller.signal, isCurrent: operation.current, decodeProfile: 'native-context', decodeContext: context, joinCancellation: true }); operation.check();
        const scope = createProcgenRetirementScope(), loan = Object.freeze({ assets: Object.freeze([pin]), release() {
          const receipt = scope.retire([{ name: 'impulse-buffer-pin', run: () => pin.release() }]);
          if (receipt.outcome === 'complete') loans.delete(loan); else faults.add(receipt); return receipt;
        } }); loans.add(loan); return loan;
      } catch (error) {
        const receipt = createProcgenRetirementScope().retire([{ name: 'failed-impulse-pin', run: () => pin?.release() }]);
        await receipt.completion; if (receipt.outcome !== 'complete') { faults.add(receipt); error.retirement = receipt; } throw error;
      } finally {
        signal?.removeEventListener('abort', abort); entries.delete(entry); if (!entries.size && sources.get(ref.contentHash) === entries) sources.delete(ref.contentHash);
      }
    })(); pending.add(operation);
    try { return await operation.completion; } finally { pending.delete(operation); }
  };
  return Object.freeze({ acquire, acquireImpulse, borrowEncoded: (file, { signal } = {}) => borrowBlob(file, null, signal),
    diagnostics: () => Object.freeze({ pending: pending.size, loans: loans.size, encodedLoans: encodedLoans.size, formats: formats.size, faults: faults.size, loader: loader.diagnostics(), resources: resources.diagnostics(), disposed }),
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
