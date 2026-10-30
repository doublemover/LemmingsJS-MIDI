import { OWNED_STRETCH_CORE } from '../../midi/content/OwnedStretchCoreIdentity.js';
import { requireSynchronousResourceAcknowledgement } from '../resources/ResourceRetirement.js';
import { createOwnedSoundSeedSource, inspectOwnedSoundSeedHeader, inspectOwnedSoundSeedOrigin } from './OwnedSoundSeedSource.js';
import { prepareExportArtifact } from '../export/ExportArtifact.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';

const fail = message => Object.assign(new Error(message), { name: 'SeedDerivedError', code: 'derived-seed-unavailable' });
let ordinal = 0;

export function createSoundSeedDerivedOwner({ resourceBudget, jobs = backgroundJobService, kind = 'components', coreMaterial = null, onState = () => {} } = {}) {
  if (!['components', 'body-fit', 'composition', 'warp'].includes(kind) || kind === 'warp' && typeof coreMaterial?.borrow !== 'function') throw new TypeError('Choose an owned seed analysis kind.');
  const expectedKinds = kind === 'warp' ? ['warped-seed'] : kind === 'composition' ? ['component-composition'] : kind === 'components' ? ['transient-like', 'sustained-like', 'residual', 'neutral-recombined'] : ['modal-reconstruction', 'modal-residual'];
  const ownerId = 'seed-derived-' + (++ordinal), retirement = createProcgenRetirementScope(), unknown = new Set();
  let current = null, active = null, sequence = 0, disposed = false, error = null, phase = 'no-derived-analysis', progress = null;
  const state = () => Object.freeze({ disposed, active: !!active, phase, progress, error, unknownRetirement: unknown.size, analysis: current?.summary || null });
  const report = () => { if (!disposed) { try { onState(state()); } catch {} } };
  const discard = record => {
    if (!record) return null; if (record.scope.getReceipt()) return record.scope.getReceipt();
    return record.scope.retire(record.entries.map(entry => ({ name: entry.kind, run: async () => {
      entry.artifact?.discard(); await entry.artifact?.digest(); const metadata = entry.artifact?.metadata();
      if (metadata?.activeLeases || metadata?.budgetState === 'failed-or-unknown') throw fail('A derived component retains an unresolved reader.');
      entry.workspace.release(); entry.waveform = null;
    } })));
  };
  const prepare = (candidate, { options = {}, componentCandidates = [], isCurrent = () => true } = {}) => {
    if (disposed || active || unknown.size || !candidate?.metadata().assetReady || typeof isCurrent !== 'function' || current?.entries.some(entry => entry.artifact === candidate?.artifact)) return Promise.reject(fail('Select one ready frozen seed and finish its current analysis.'));
    const parents = kind === 'composition' ? [candidate, ...componentCandidates] : [candidate];
    if (kind === 'composition' && (componentCandidates.length !== 3 || parents.some(parent => !parent?.metadata?.().assetReady))) return Promise.reject(fail('Composition needs the original and its three ready decomposition components.'));
    const generation = ++sequence, operation = { controller: new AbortController(), sources: [], windows: [], coreLoan: null, job: null, handed: false, producer: null, next: { scope: createProcgenRetirementScope(), entries: [], summary: null }, promise: null };
    const savedOptions = freezeData(JSON.parse(canonicalDataText(options, { maxBytes: 4096, maxNodes: 128 }).text));
    const check = () => { operation.controller.signal.throwIfAborted(); if (disposed || !isCurrent() || parents.some(parent => !parent.metadata().assetReady)) throw fail('The parent seed or derived draft generation changed.'); };
    const releaseWindow = () => {
      const receipts = operation.windows.map(window => window.release());
      if (receipts.some(receipt => receipt.outcome !== 'complete')) throw fail('Derived input window retirement is unresolved.'); operation.windows.length = 0; return true;
    };
    const releaseCore = () => { if (operation.coreLoan) { requireSynchronousResourceAcknowledgement(operation.coreLoan.release(), 'Core material reader release'); operation.coreLoan = null; } return true; };
    const releaseInputs = () => { let failure = null; try { releaseWindow(); } catch (caught) { failure = caught; } try { releaseCore(); } catch (caught) { failure ||= caught; } if (failure) throw failure; return true; };

    active = operation; error = progress = null; phase = 'reading-frozen-seed'; report();
    operation.promise = (async () => {
      let caught = null;
      try {
        check();
        for (const parent of parents) {
          const source = createOwnedSoundSeedSource({ artifact: parent.artifact, manifest: parent.manifest, resourceBudget }); operation.sources.push(source);
          const metadata = source.metadata();
          if (metadata.sourceFrames * 8 > 4 * 1048576 || metadata.sourceFrames > metadata.sampleRate * 8) throw fail('Select at most eight seconds and 4 MiB of frozen stereo material for advanced analysis.');
          operation.windows.push(await source.readWindow({ firstFrame: 0, endFrame: metadata.sourceFrames, signal: operation.controller.signal, isCurrent })); check();
        }
        const metadata = operation.sources[0].metadata(), pcmBytes = metadata.sourceFrames * 8;
        const inputs = operation.windows.map(window => ({ ...window.value, generation })), [originalInput, ...componentInputs] = inputs;
        const metadataBytes = canonicalDataText({ ...originalInput, pcm: null, originBytes: null, options: savedOptions, ...(kind === 'warp' ? { wasmBytes: null } : {}),
          ...(kind === 'composition' ? { componentInputs: componentInputs.map(value => ({ ...value, pcm: null, originBytes: null })) } : {}) }, { maxBytes: 65536, maxNodes: 8192 }).bytes.length;
        const inputBytes = inputs.reduce((sum, value) => sum + value.pcm.length + value.originBytes.length, metadataBytes) + (kind === 'warp' ? OWNED_STRETCH_CORE.wasmBytes : 0);
        if (kind === 'warp') { phase = 'preparing-owned-warp-core'; report(); operation.coreLoan = await coreMaterial.borrow({ signal: operation.controller.signal, isCurrent }); if (!(operation.coreLoan.blob instanceof Blob) || operation.coreLoan.blob.size !== OWNED_STRETCH_CORE.wasmBytes) throw fail('The exact immutable warp core reader is unavailable.'); check(); }
        const size = savedOptions.fftSize ?? 2048, cells = (Math.ceil(metadata.sourceFrames / (size / 4)) + 1) * (size / 2 + 1);
        phase = kind === 'warp' ? 'queued-finite-warp' : kind === 'composition' ? 'queued-component-composition' : 'queued-component-analysis'; report();
        operation.job = await jobs.compute({ kind: kind === 'warp' ? 'warp-sound-seed' : kind === 'composition' ? 'compose-sound-seed-components' : kind === 'body-fit' ? 'fit-sound-seed-modes' : 'decompose-sound-seed', ownerId, ownerEpoch: generation, sourceRevision: candidate.metadata().assetHash,
          inputBytes, maxBytes: inputBytes, estimatedPeakBytes: kind === 'warp' ? 128 * 1048576 : kind === 'composition' ? 64 * 1048576 + pcmBytes * 32 : kind === 'body-fit' ? 64 * 1048576 + pcmBytes * 16 : Math.ceil(32 * 1048576 + pcmBytes * 16 + cells * 12), priority: 'background', budgetAdapter: resourceBudget,
          signal: operation.controller.signal, isCurrent: () => !disposed && isCurrent(), onProgress: value => { progress = value; phase = value.phase; report(); },
          prepareInput: async () => { operation.handed = true; const wasmBytes = kind === 'warp' ? new Uint8Array(await operation.coreLoan.blob.arrayBuffer()) : null; check(); return { ...originalInput, options: savedOptions, ...(kind === 'warp' ? { wasmBytes } : {}), ...(kind === 'composition' ? { componentInputs } : {}) }; }, releasePreparedInput: kind === 'warp' ? releaseCore : releaseInputs }); check();
        const result = operation.job.value, artifacts = [...(result?.components || []), ...(kind === 'components' && result?.recombined ? [result.recombined] : [])];
        if (operation.job.receipt.method !== 'dedicated-worker' || operation.job.receipt.executionIdentity?.activeExecution !== 'bound' || result?.schema !== (kind === 'warp' ? 'lemmings-seed-warp-result/v1' : kind === 'composition' ? 'lemmings-seed-component-composition/v1' : kind === 'body-fit' ? 'lemmings-seed-modal-fit/v1' : 'lemmings-seed-decomposition/v1') ||
            result.generation !== generation || result.recipe.parentAssetHash !== candidate.metadata().assetHash || !Array.isArray(result.components) || artifacts.length !== expectedKinds.length ||
            artifacts.some((entry, index) => entry.kind !== expectedKinds[index] || !(entry.bytes instanceof Uint8Array) || !/^[a-f0-9]{64}$/.test(entry.assetHash) ||
              entry.manifest?.frames !== (kind === 'warp' ? result.recipe.bodyFrames + result.recipe.tailFrames : metadata.sourceFrames) || entry.manifest.sampleRate !== (kind === 'warp' ? savedOptions.outputRate : metadata.sampleRate) || !(entry.waveform?.minMax instanceof Float32Array) || entry.waveform.minMax.length !== entry.waveform.bins * 4 || entry.waveform.bins > 1024)) throw fail('The derived artifacts differ from their admitted parent, frame inventory or worker.');
        if (kind === 'warp' && (operation.job.receipt.kind !== 'warp-sound-seed' || operation.job.receipt.sourceRevision !== candidate.metadata().assetHash || result.recipe.coreArtifactHash !== OWNED_STRETCH_CORE.wasmSha256 || !/^[a-f0-9]{64}$/.test(result.recipe.coreConfigurationHash || '') || !Number.isSafeInteger(result.recipe.tailFrames) || result.recipe.tailFrames < 0 || result.recipe.tailFrames > savedOptions.outputRate * 2 || result.recipe.preparedMaterial?.originalRate !== metadata.sampleRate || result.recipe.preparedMaterial?.preparedRate !== savedOptions.outputRate || result.recipe.bodyFrames !== Math.ceil(metadata.sourceFrames * savedOptions.outputRate / metadata.sampleRate / savedOptions.rateRatio) || canonicalDataText(result.recipe.options).text !== canonicalDataText(savedOptions).text || result.recipeHash !== await hashData(result.recipe, { maxBytes: 65536, maxNodes: 8192 }) || artifacts[0].manifest.derivedTransform?.recipeHash !== result.recipeHash)) throw fail('The finite warp differs from its exact core, source/rate coordinates or immutable recipe.'); check();
        const candidateScope = operation.next.scope;
        for (const entry of artifacts) {
          const workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: ownerId, generation, kind: 'seed-component-waveform', category: 'candidate',
            bytes: 262144 + entry.waveform.minMax.byteLength + canonicalDataText(entry.manifest, { maxBytes: 262144, maxNodes: 32768 }).bytes.length * 8 + (kind === 'warp' ? entry.bytes.byteLength * 2 : 0) });
          const record = { kind: entry.kind, workspace, waveform: null, artifact: null, api: null }; operation.next.entries.push(record);
          if (kind === 'warp') {
            const header = inspectOwnedSoundSeedHeader(entry.bytes.subarray(0, 56), entry.bytes.length), { recipeHash, ...declaredRecipe } = entry.manifest.derivedTransform;
            if (header.frames !== entry.manifest.frames || header.sampleRate !== entry.manifest.sampleRate || header.dataBytes > 15 * 1048576 || recipeHash !== result.recipeHash || canonicalDataText(declaredRecipe, { maxBytes: 65536, maxNodes: 8192 }).text !== canonicalDataText(result.recipe, { maxBytes: 65536, maxNodes: 8192 }).text || !Number.isSafeInteger(entry.waveform.bins) || !Number.isSafeInteger(entry.waveform.blockFrames) || entry.waveform.blockFrames < 1 || entry.waveform.bins !== Math.ceil(header.frames / entry.waveform.blockFrames)) throw fail('The frozen warp header, annotation or waveform inventory differs.');
            inspectOwnedSoundSeedOrigin(entry.bytes.subarray(header.metadataOffset), entry.manifest);
          }
          record.waveform = Object.freeze({ stage: 'derived-component-PCM', firstParentFrame: 0, endParentFrame: entry.manifest.frames, channels: 2,
            levels: Object.freeze([Object.freeze({ ...entry.waveform, minMax: new Float32Array(entry.waveform.minMax) })]), zeroCrossings: { inLocalFrame: null, outLocalFrame: null } });
          record.artifact = prepareExportArtifact({ bytes: entry.bytes, immutableSourceRef: entry.assetHash, formatVersion: entry.manifest.schema, mediaType: 'audio/wav',
            suggestedFilename: 'seed-' + entry.kind + '-' + entry.assetHash.slice(0, 12) + '.wav', lifetimeMs: 86400000, maxBytes: (kind === 'warp' ? 16 : 8) * 1048576, budgetAdapter: resourceBudget });
          if (kind === 'warp') { if (await record.artifact.digest() !== entry.assetHash) throw fail('The frozen warp bytes differ from their worker hash.'); check(); workspace.resize(262144 + entry.waveform.minMax.byteLength + canonicalDataText(entry.manifest, { maxBytes: 262144, maxNodes: 32768 }).bytes.length * 8); }
          const saved = freezeData({ assetHash: entry.assetHash, frames: entry.manifest.frames, sampleRate: entry.manifest.sampleRate, statistics: entry.manifest.statistics, coverage: entry.manifest.coverage, ancestry: entry.manifest.ancestry });
          record.api = Object.freeze({ artifact: record.artifact, manifest: freezeData(entry.manifest), metadata: () => Object.freeze({ ...saved, assetReady: !candidateScope.getReceipt() && record.artifact.metadata().retained, compiledPatchReady: false, audibleAuditionReady: false, durable: false }),
            withWaveform(visitor) { if (!record.waveform || candidateScope.getReceipt() || typeof visitor !== 'function') throw fail('Derived waveform retired.'); const output = visitor(record.waveform); if (output?.then) throw fail('Derived waveform visits must be synchronous.'); } });
        }
        operation.next.summary = freezeData({ schema: result.schema, recipeHash: result.recipeHash ?? null, parentAssetHash: result.recipe.parentAssetHash, generation, recipe: result.recipe, reconstruction: result.reconstruction ?? null,
          components: result.components.map(entry => ({ kind: entry.kind, assetHash: entry.assetHash })), recombinedAssetHash: result.recombined?.assetHash ?? null, estimate: result.estimate ?? null, evidence: kind === 'warp' ? 'finite-material-ready;live-warp-and-quality-not-established' : 'analysis-ready;audition-and-durability-not-established' });
      } catch (failure) {
        caught = failure; if (failure.retirement && failure.retirement.outcome !== 'complete') unknown.add({ failure });
        if (failure.backgroundRetirementCompletion) failure.backgroundRetirement = await failure.backgroundRetirementCompletion;
        operation.producer = failure.backgroundRetirement || null;
      }
      const workerFinished = Promise.resolve().then(() => {
        operation.job?.release(); const receipt = operation.job?.retirementState?.();
        if (receipt && !['released', 'canceled'].includes(receipt.phase) || operation.producer && !['released', 'canceled'].includes(operation.producer.phase) || operation.handed && !operation.job && !['released', 'canceled'].includes(operation.producer?.phase)) throw fail('Derived analysis worker retirement is unresolved.');
        operation.job = operation.producer = null;
      });
      const inputFinished = workerFinished.then(releaseInputs);
      const cleanup = createProcgenRetirementScope().retire([{ name: 'derived-worker', run: () => workerFinished }, { name: 'derived-input', run: () => inputFinished },
        { name: 'derived-source', run: async () => { await inputFinished; const receipts = operation.sources.map(source => source.dispose()); await Promise.all(receipts.map(receipt => receipt.completion)); if (receipts.some(receipt => receipt.outcome !== 'complete')) throw fail('Derived source reader retirement is unresolved.'); operation.sources.length = 0; } }]); await cleanup.completion;
      if (cleanup.outcome !== 'complete') { unknown.add({ operation, cleanup }); caught ||= fail('Derived analysis retains unresolved ownership.'); }
      if (!caught) { try { check(); const prior = discard(current); if (prior) { await prior.completion; if (prior.outcome !== 'complete') { unknown.add({ current, prior }); throw fail('Previous components retain unresolved readers.'); } } check();
        current = operation.next; phase = kind === 'warp' ? 'finite-warp-material-ready' : kind === 'composition' ? 'component-composition-ready' : kind === 'body-fit' ? 'modal-estimate-ready' : 'components-ready'; progress = null; report(); return current.summary;
      } catch (failure) { caught = failure; } }
      const discarded = discard(operation.next); await discarded.completion; if (discarded.outcome !== 'complete') unknown.add({ record: operation.next, discarded });
      error = String(caught.message).slice(0, 512); phase = unknown.size ? 'ownership-unknown' : current ? 'previous-components-retained' : 'no-derived-analysis'; report(); throw caught;
    })(); operation.promise.finally(() => { if (active === operation) active = null; report(); }).catch(() => {}); return operation.promise;
  };
  const cancel = () => active?.controller.abort(fail('Derived analysis canceled.'));
  const clear = async () => { cancel(); await active?.promise.catch(() => {}); if (unknown.size) throw fail('Derived analysis has unresolved ownership.'); const receipt = discard(current); if (receipt) { await receipt.completion; if (receipt.outcome !== 'complete') { unknown.add({ current, receipt }); throw fail('Derived material retirement is unresolved.'); } } current = null; phase = 'no-derived-analysis'; progress = null; report(); };
  return Object.freeze({ prepare, cancel, clear, state, component: kind => current?.entries.find(entry => entry.kind === kind)?.api || null,
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; cancel();
      return retirement.retire([{ name: 'derived-operation-and-artifacts', run: () => clear() }]);
    } });
}
