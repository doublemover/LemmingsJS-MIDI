import { createOwnedSoundSeedSource } from './OwnedSoundSeedSource.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { prepareExportArtifact } from '../export/ExportArtifact.js';
import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';

const fail = message => Object.assign(new Error(message), { name: 'SoundSeedError', code: 'sound-seed-unavailable' });
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const complete = receipt => receipt?.outcome === 'complete';
let nextOwner = 0;

export function createSoundSeedAnalysisOwner({ resourceBudget, jobs = backgroundJobService, onState = () => {} } = {}) {
  if (!resourceBudget?.reserve || !resourceBudget?.release || typeof jobs?.compute !== 'function' || typeof onState !== 'function') throw new TypeError('Sound-seed analysis needs shared worker and resource owners.');
  const ownerId = 'sound-seed-analysis-' + (++nextOwner), retirement = createProcgenRetirementScope(), unknown = new Set(), ancestors = new Set();
  let source = null, candidate = null, active = null, disposed = false, sequence = 0, errorCode = null, sourceSelection = 0, selecting = 0, sourceChanges = Promise.resolve(), phase = 'no-source', progress = null, error = null;
  const state = () => Object.freeze({ phase, progress, error, errorCode, disposed, active: !!active, source: source?.metadata() || null,
    candidate: candidate?.api.metadata() || null, selectingSource: !!selecting, retainedAncestorSources: ancestors.size, unknownRetirement: unknown.size });
  const report = () => { if (disposed) return; try { onState(state()); } catch {} };
  const discardCandidate = record => {
    if (!record) return null; if (record.scope.getReceipt()) return record.scope.getReceipt();
    const artifactFinished = Promise.resolve().then(async () => {
      if (!record.artifact) return; record.artifact.discard(); await record.artifact.digest(); const metadata = record.artifact.metadata();
      if (metadata.activeLeases || metadata.budgetState === 'failed-or-unknown') throw fail('A frozen seed still has an active reader or unknown reservation.');
    });
    return record.scope.retire([{ name: 'frozen-seed-artifact', run: () => artifactFinished },
      { name: 'seed-waveform-and-metadata', run: async () => { await artifactFinished; record.workspace.release(); record.waveform = null; } }]);
  };
  const releaseInput = operation => {
    if (!operation.window) return;
    const receipt = operation.window.release();
    if (!complete(receipt)) throw Object.assign(fail('The immutable source window has unresolved retirement.'), { retirement: receipt });
    operation.window = null;
  };
  const cancel = () => active?.controller.abort(Object.assign(fail('Sound-seed preparation canceled.'), { name: 'AbortError' }));
  const selectSource = request => {
    const token = ++sourceSelection; selecting++; phase = 'selecting-source'; report();
    const work = sourceChanges.then(async () => {
      if (disposed || unknown.size || token !== sourceSelection) throw fail('The source selection is stale or has unresolved ownership.');
      const next = createOwnedSoundSeedSource({ ...request, resourceBudget });
      cancel(); await active?.promise.catch(() => {});
      const previous = source, records = new Set([...ancestors, ...(candidate ? [candidate] : [])]);
      try {
        if (disposed || token !== sourceSelection) throw fail('The source selection changed.');
        const receipt = previous?.dispose(); if (receipt) { await receipt.completion; if (!complete(receipt)) { unknown.add({ previous, receipt }); throw fail('The previous source reader could not retire completely.'); } }
        if (disposed || token !== sourceSelection) throw fail('The source selection changed.');
        for (const record of records) if (record.artifact !== request.artifact) {
          const receipt = discardCandidate(record); await receipt.completion;
          if (!complete(receipt)) { unknown.add({ record, receipt }); throw fail('The previous frozen seed still has an active reader.'); }
        }
        if (disposed || token !== sourceSelection) throw fail('The source selection changed.');
        ancestors.clear(); for (const record of records) if (record.artifact === request.artifact) ancestors.add(record);
        source = next; candidate = null; error = errorCode = null; phase = 'source-selected'; report(); return source.metadata();
      } catch (failure) {
        const cleanup = next.dispose(); await cleanup.completion; if (!complete(cleanup)) unknown.add({ source: next, receipt: cleanup }); throw failure;
      }
    });
    sourceChanges = work.catch(failure => {
      if (failure.retirement && !complete(failure.retirement)) unknown.add({ failure, receipt: failure.retirement });
      if (token === sourceSelection && !disposed) { error = String(failure.message).slice(0, 512); errorCode = failure.code || failure.name; phase = unknown.size ? 'ownership-unknown' : candidate ? 'previous-candidate-retained' : source ? 'source-selected' : 'no-source'; report(); }
    });
    work.finally(() => { selecting--; report(); }).catch(() => {}); return work;
  };
  const prepare = ({ firstFrame, endFrame, fades = {}, signal: externalSignal, isCurrent = () => true } = {}) => {
    externalSignal?.throwIfAborted();
    if (disposed || !source || active || selecting || unknown.size || typeof isCurrent !== 'function') return Promise.reject(fail('Select one retained source and finish its current operation first.'));
    const selectedSource = source, controller = new AbortController(), ordinal = ++sequence, operation = { controller, window: null, job: null, handed: false, producer: null, candidate: null, promise: null };
    const abort = () => controller.abort(externalSignal.reason); externalSignal?.addEventListener('abort', abort, { once: true });
    const check = () => { controller.signal.throwIfAborted(); if (disposed || source !== selectedSource || !isCurrent()) throw fail('The source or editable seed draft changed.'); };
    active = operation; phase = 'reading-source-window'; error = errorCode = null; progress = null; report();
    operation.promise = (async () => {
      let outcome = null, caught = null;
      try {
        const savedFades = freezeData(JSON.parse(canonicalDataText(fades, { maxBytes: 4096, maxNodes: 64 }).text));
        operation.window = await selectedSource.readWindow({ firstFrame, endFrame, signal: controller.signal, isCurrent, onProgress: value => { progress = value; report(); } }); check();
        let value = operation.window.value; const pcmBytes = value.pcm.byteLength, metadataBytes = canonicalDataText({ ...value, pcm: null, originBytes: null, generation: ordinal, fades: savedFades }, { maxBytes: 65536, maxNodes: 8192 }).bytes.length;
        const inputBytes = value.pcm.byteLength + value.originBytes.byteLength + metadataBytes, sourceRevision = await hashData(selectedSource.metadata()); check(); value = null; phase = 'queued-analysis'; report();
        operation.job = await jobs.compute({ kind: 'analyze-sound-seed-window', ownerId, ownerEpoch: ordinal, sourceRevision,
          inputBytes, maxBytes: inputBytes, estimatedPeakBytes: pcmBytes * 10 + 32 * 1048576, priority: 'background', budgetAdapter: resourceBudget,
          signal: controller.signal, isCurrent: () => !disposed && source === selectedSource && isCurrent(),
          onProgress: value => { if (active === operation && !disposed) { phase = value.phase; progress = value; report(); } },
          prepareInput: () => { operation.handed = true; return { ...operation.window.value, generation: ordinal, fades: savedFades }; },
          releasePreparedInput: () => releaseInput(operation) }); check();
        const result = operation.job.value, manifest = result?.manifest, wave = result?.waveform;
        if (!(result?.bytes instanceof Uint8Array) || result.bytes.length > 16 * 1048576 || !hash(result.assetHash) || manifest?.schema !== 'lemmings-sound-seed/v1' || result.generation !== ordinal ||
            manifest.frames !== endFrame - firstFrame || manifest.sampleRate !== selectedSource.metadata().sampleRate || wave?.firstParentFrame !== firstFrame || wave.endParentFrame !== endFrame ||
            !Array.isArray(wave.levels) || !wave.levels.length || wave.levels.length > 8 || wave.levels.some(level => !(level.minMax instanceof Float32Array) || level.minMax.length !== level.bins * 4 || level.bins < 1 || level.bins > 2048) ||
            operation.job.receipt.method !== 'dedicated-worker' || operation.job.receipt.executionIdentity?.activeExecution !== 'bound') throw fail('The analysis result does not match its admitted immutable source window.');
        const workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: ownerId, generation: ordinal, category: 'candidate', kind: 'sound-seed-waveform',
          bytes: 262144 + wave.levels.reduce((sum, level) => sum + level.minMax.byteLength, 0) + canonicalDataText(manifest, { maxBytes: 262144, maxNodes: 32768 }).bytes.length * 8 });
        const record = operation.candidate = { workspace, artifact: null, waveform: null, scope: createProcgenRetirementScope(), api: null };
        record.waveform = Object.freeze({ ...wave, levels: Object.freeze(wave.levels.map(level => Object.freeze({ ...level, minMax: new Float32Array(level.minMax) }))) });
        record.artifact = prepareExportArtifact({ bytes: result.bytes, immutableSourceRef: result.assetHash, formatVersion: manifest.schema, mediaType: 'audio/wav',
          suggestedFilename: 'sound-seed-' + result.assetHash.slice(0, 12) + '.wav', lifetimeMs: 24 * 60 * 60 * 1000, coverageLossReportRef: 'embedded-lmjs-sound-seed-origin', maxBytes: 16 * 1048576, budgetAdapter: resourceBudget });
        const saved = freezeData({ schema: 'lemmings-sound-seed-candidate/v1', assetHash: result.assetHash, generation: ordinal, frames: manifest.frames, sampleRate: manifest.sampleRate,
          firstParentFrame: firstFrame, endParentFrame: endFrame, statistics: manifest.statistics, coverage: manifest.coverage, ancestry: manifest.ancestry,
          assetReady: true, compiledPatchReady: false, audibleAuditionReady: false, durable: false, qualification: manifest.qualification });
        record.api = Object.freeze({ artifact: record.artifact, manifest: freezeData(manifest), metadata: () => Object.freeze({ ...saved, retained: !record.scope.getReceipt(), assetReady: !record.scope.getReceipt() && record.artifact.metadata().retained }),
          withWaveform(visitor) { if (!record.waveform || record.scope.getReceipt() || typeof visitor !== 'function') throw fail('The frozen waveform view is retired.');
            const result = visitor(record.waveform); if (result?.then) throw fail('Waveform visits must finish synchronously.'); },
          discard: () => discardCandidate(record) }); outcome = record.api;
      } catch (failure) {
        caught = failure;
        if (failure.backgroundRetirementCompletion) failure.backgroundRetirement = await failure.backgroundRetirementCompletion;
        operation.producer = failure.backgroundRetirement || null;
      } finally {
        externalSignal?.removeEventListener('abort', abort);
        const workerFinished = Promise.resolve().then(() => {
          operation.job?.release(); const status = operation.job?.retirementState?.();
          if (status && !['released', 'canceled'].includes(status.phase) || operation.producer && !['released', 'canceled'].includes(operation.producer.phase)) throw fail('Sound-seed worker retirement is unresolved.');
        });
        const cleanup = createProcgenRetirementScope().retire([{ name: 'analysis-worker', run: () => workerFinished },
          { name: 'accepted-source-window', run: async () => {
            await workerFinished;
            if (operation.window && operation.handed && !operation.job && !['released', 'canceled'].includes(operation.producer?.phase)) throw fail('The source window remains with an unacknowledged worker.');
            await releaseInput(operation);
          } }]); await cleanup.completion;
        if (!complete(cleanup)) { unknown.add({ operation, cleanup }); caught ||= Object.assign(fail('Sound-seed analysis ownership is unresolved.'), { retirement: cleanup }); }
      }
      if (!caught) { try {
        check(); const previous = candidate, receipt = discardCandidate(previous); if (receipt) { await receipt.completion; if (!complete(receipt)) { unknown.add({ previous, receipt }); throw fail('The previous frozen candidate still has an active reader.'); } }
        check(); candidate = operation.candidate; phase = 'asset-ready'; progress = null; report(); return outcome;
      } catch (failure) { caught = failure; } }
      const discarded = discardCandidate(operation.candidate); if (discarded) { await discarded.completion; if (!complete(discarded)) unknown.add({ candidate: operation.candidate, receipt: discarded }); }
      error = String(caught?.message || 'Seed preparation failed.').slice(0, 512); errorCode = caught?.code || caught?.name || 'seed-analysis-failed'; phase = unknown.size ? 'ownership-unknown' : candidate ? 'previous-candidate-retained' : 'source-selected'; report(); throw caught;
    })(); operation.promise.finally(() => { if (active === operation) active = null; report(); }).catch(() => {}); return operation.promise;
  };
  return Object.freeze({ selectSource, prepare, cancel, state, candidate: () => candidate?.api || null,
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; sourceSelection++; cancel();
      const stopped = Promise.allSettled([sourceChanges, active?.promise]);
      const sourceFinished = stopped.then(async () => {
        const receipt = source?.dispose(); if (receipt) { await receipt.completion; if (!complete(receipt)) throw fail('The original seed source has unresolved retirement.'); } source = null;
      });
      return retirement.retire([{ name: 'accepted-seed-analysis', run: () => stopped },
        { name: 'sound-seed-source', run: () => sourceFinished },
        { name: 'frozen-seed-candidates', run: async () => {
          await sourceFinished;
          for (const record of new Set([...ancestors, ...(candidate ? [candidate] : [])])) {
            const receipt = discardCandidate(record); await receipt.completion; if (!complete(receipt)) throw fail('A retained seed candidate has unresolved retirement.');
          }
          candidate = null; ancestors.clear();
        } },
        { name: 'unresolved-seed-owners', run: async () => { await stopped; if (unknown.size) throw fail('Sound-seed producer retirement remains unknown.'); } }]);
    }
  });
}
