import { createSoundSeedLayerRecipe } from '../../midi/content/SoundSeedLayerRecipe.js';
import { SEED_LAYER_ROLES } from '../../midi/content/SeedLayerProfile.js';
import { createFiniteFmBodyGraftRecipe } from '../../midi/content/FiniteFmBodyGraftRecipe.js';
import { createSealedBodyGraftRecipe } from '../../midi/content/SealedBodyGraftRecipe.js';
import { createTextureBodyGraftRecipe } from '../../midi/content/TextureBodyGraftRecipe.js';
import { inspectOwnedSoundSeedHeader, inspectOwnedSoundSeedOrigin } from './OwnedSoundSeedSource.js';
import { createSoundSeedRecipe } from '../../midi/content/SoundSeedRecipe.js';
import { createSoundSeedGraftRecipe } from '../../midi/content/SoundSeedGraftRecipe.js';
import { createSoundSeedModalRecipe } from '../../midi/content/SoundSeedModalRecipe.js';
import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { createSoundContentReader } from './SoundContentReader.js';
import { createSoundContentRegistry } from './SoundContentRegistry.js';
import { createSoundContentInstallation } from './SoundContentInstallation.js';
import { SOUND_ARCHIVE_FORMAT, SOUND_ARCHIVE_MAGIC } from './SoundContentArchive.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const fail = message => Object.assign(new Error(message), { name: 'SoundSeedInstrumentError', code: 'sound-seed-instrument-unavailable' });

export function createSoundSeedInstrumentOwner({ audio, resourceBudget, jobs = backgroundJobService, indexedDB, keyRange, onApply,
  getCatalog = getNativeInstrumentCatalog, getTargetIdentity = () => null, onState = () => {}, onReveal } = {}) {
  if (typeof onApply !== 'function' || typeof onState !== 'function' || typeof getTargetIdentity !== 'function') throw new TypeError('A seed instrument needs an undoable lane application owner.');
  const targetIdentity = () => canonicalDataText(getTargetIdentity(), { maxBytes: 8192, maxNodes: 256 }).text;
  const reader = createSoundContentReader({ resourceBudget, jobs, maxPending: 2, stageLifetimeMs: 3600000 });
  const registry = createSoundContentRegistry({ indexedDB, keyRange, resourceBudget });
  const installation = createSoundContentInstallation({ audio, registry, getCatalog, onReveal });
  const retirement = createProcgenRetirementScope(), unknown = new Set();
  let current = null, active = null, disposed = false, sequence = 0, error = null, phase = 'no-patch';
  const state = () => Object.freeze({ phase, active: !!active, disposed, error, unknownRetirement: unknown.size,
    compiledPatchReady: !!current?.stage.metadata().retained, audibleAuditionReady: !!current && !!installation.getAudition(current.stage, current.identity),
    durable: !!current?.installed, targetCurrent: !current?.targetIdentity || current.targetIdentity === targetIdentity(), assetHash: current?.assetHash || null, recipe: current?.contract || null, patchIdentity: current?.identity || null, contentHash: current?.stage.metadata().contentHash || null });
  const report = () => { if (!disposed) { try { onState(state()); } catch {} } };
  const discard = record => {
    if (!record) return;
    record.stage.discard(); const status = record.stage.metadata();
    if (status.retirement !== 'released' || status.activeLeases) { unknown.add(record); throw fail('The prepared seed pack has unresolved readers.'); }
  };
  const run = (name, work) => {
    if (disposed || active || unknown.size) return Promise.reject(fail('Finish the current seed instrument operation or resolve its ownership first.'));
    const operation = { controller: new AbortController(), ordinal: ++sequence, promise: null }; active = operation; phase = name; error = null; report();
    const check = () => { operation.controller.signal.throwIfAborted(); if (disposed || active !== operation) throw fail('The seed instrument owner changed.'); };
    operation.promise = Promise.resolve().then(() => work(operation, check)).catch(failure => { error = String(failure.message).slice(0, 512); phase = unknown.size ? 'ownership-unknown' : current ? 'previous-patch-retained' : 'no-patch'; throw failure; })
      .finally(() => { if (active === operation) active = null; report(); }); return operation.promise;
  };
  const prepare = (candidate, { transform, pitch, modalFit = null, decomposition = null, layerComponents = null, graftBody = 'tin', textureKind = 'sand-drag', traversalBinding = null, isCurrent = () => true } = {}) => run('compiling', async (operation, checkOwner) => {
    const layered = ['hammer-cloud', 'hollow-tool'].includes(transform);
    if (layered && (!Array.isArray(layerComponents) || layerComponents.length !== 3 || layerComponents.some(entry => !entry?.metadata?.().assetReady))) throw fail('Prepare the complete current decomposition before compiling a layered seed.');
    const motionTarget = ['motion-body-graft', 'texture-body-graft', 'sealed-friction-body-graft'].includes(transform) ? targetIdentity() : null;
    if (motionTarget === 'null') throw fail('A motion body requires an explicit document and lane target identity.');
    const check = () => { checkOwner(); if (!isCurrent() || !candidate.metadata().assetReady || layered && layerComponents.some(entry => !entry.metadata().assetReady)) throw fail('The seed draft changed while preparing its instrument.'); if (motionTarget && targetIdentity() !== motionTarget) throw fail('The motion mapping document or lane target changed while preparing its instrument.'); };
    let loan = null, job = null, workspace = null, next = null, prepared = null;
    const extraLoans = [], extraRetirement = createProcgenRetirementScope();
    const releaseExtraLoans = () => extraRetirement.retire(extraLoans.map((entry, index) => ({ name: 'seed-layer-input-' + index, run: () => {
      const result = entry.release(); if (result === false || result?.then) throw fail('Layer input retirement requires a synchronous acknowledgement.');
    } })));
    try {
      check(); const metadata = candidate.metadata(), artifactMetadata = candidate.artifact.metadata();
      workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'sound-seed-instrument', generation: operation.ordinal, category: 'candidate', kind: 'seed-private-pack', bytes: artifactMetadata.byteLength + (layered ? layerComponents.reduce((sum, entry) => sum + entry.artifact.metadata().byteLength, 0) : 0) + 8 * 1048576 });
      loan = candidate.artifact.borrow(); if (!(loan.blob instanceof Blob)) throw fail('Frozen seed material must be an independently owned immutable Blob.');
      const sourceHeader = inspectOwnedSoundSeedHeader(new Uint8Array(await loan.blob.slice(0, 56).arrayBuffer()), artifactMetadata.byteLength); check();
      if (sourceHeader.frames !== candidate.manifest.frames || sourceHeader.sampleRate !== candidate.manifest.sampleRate) throw fail('Frozen seed frame inventory differs from its recipe.');
      inspectOwnedSoundSeedOrigin(new Uint8Array(await loan.blob.slice(sourceHeader.metadataOffset).arrayBuffer()), candidate.manifest); check();
      let material = { manifest: candidate.manifest, assetHash: metadata.assetHash, byteLength: artifactMetadata.byteLength, blob: loan.blob };
      const layerMaterials = [];
      if (layered) for (let index = 0; index < SEED_LAYER_ROLES.length; index++) {
        const child = layerComponents[index], childMetadata = child.metadata(), childArtifact = child.artifact.metadata(), borrowed = child.artifact.borrow(); extraLoans.push(borrowed);
        if (!(borrowed.blob instanceof Blob) || borrowed.blob.size !== childArtifact.byteLength) throw fail('A complete immutable layer Blob is required.');
        const header = inspectOwnedSoundSeedHeader(new Uint8Array(await borrowed.blob.slice(0, 56).arrayBuffer()), childArtifact.byteLength); check();
        if (header.frames !== child.manifest.frames || header.sampleRate !== child.manifest.sampleRate) throw fail('Layer PCM differs from its exact source coordinates.');
        inspectOwnedSoundSeedOrigin(new Uint8Array(await borrowed.blob.slice(header.metadataOffset).arrayBuffer()), child.manifest); check();
        layerMaterials.push({ manifest: child.manifest, assetHash: childMetadata.assetHash, byteLength: childArtifact.byteLength, blob: borrowed.blob });
      }
      if (transform === 'finite-fm-body-graft') {
        const input = { parentManifest: candidate.manifest, parentAssetHash: metadata.assetHash, sampleRate: 48000 }, inputBytes = canonicalDataText(input, { maxBytes: 262144, maxNodes: 32768 }).bytes.length;
        job = await jobs.compute({ kind: 'bake-finite-fm-exciter', ownerId: 'sound-seed-instrument', ownerEpoch: operation.ordinal, sourceRevision: metadata.assetHash + ':finite-fm-v1', inputBytes, maxBytes: 262144, estimatedPeakBytes: 32 * 1048576, budgetAdapter: resourceBudget, signal: operation.controller.signal, isCurrent: () => !disposed && active === operation && isCurrent(), prepareInput: () => input }); check();
        if (job.receipt.method !== 'dedicated-worker' || job.receipt.executionIdentity?.activeExecution !== 'bound' || job.receipt.kind !== 'bake-finite-fm-exciter') throw fail('Finite FM material needs its bound application worker.');
        const result = job.value;
        if (!(result.bytes instanceof Uint8Array) || result.bytes.length > 524288 || !/^[a-f0-9]{64}$/.test(result.assetHash || '') || result.manifest?.derivedTransform?.parentAssetHash !== metadata.assetHash) throw fail('Finite FM material did not retain the selected body ancestry.');
        material = { manifest: result.manifest, assetHash: result.assetHash, byteLength: result.bytes.length, blob: new Blob([result.bytes], { type: 'audio/wav' }) };
        job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) throw fail('Finite FM worker retirement remains unresolved.'); job = null; check();
      }
      const recipe = await (layered ? createSoundSeedLayerRecipe : transform === 'finite-fm-body-graft' ? createFiniteFmBodyGraftRecipe : ['sealed-wind-body-graft', 'sealed-friction-body-graft'].includes(transform) ? createSealedBodyGraftRecipe : transform === 'texture-body-graft' ? createTextureBodyGraftRecipe : ['feedforward-graft', 'motion-body-graft'].includes(transform) ? createSoundSeedGraftRecipe : transform === 'modal-body' ? createSoundSeedModalRecipe : createSoundSeedRecipe)({ manifest: material.manifest, assetHash: material.assetHash, byteLength: material.byteLength, transform, pitch, modalFit, decomposition, layerMaterials, graftBody, textureKind, traversalBinding }); check();
      const inputBytes = canonicalDataText(recipe.source, { maxBytes: 1048576, maxNodes: 32768 }).bytes.length;
      job = await jobs.compute({ kind: 'compile-sound-content', ownerId: 'sound-seed-instrument', ownerEpoch: operation.ordinal, sourceRevision: recipe.contractHash,
        inputBytes, maxBytes: 4 * 1048576, estimatedPeakBytes: 64 * 1048576, budgetAdapter: resourceBudget, signal: operation.controller.signal,
        isCurrent: () => !disposed && active === operation && isCurrent(), prepareInput: () => recipe.source }); check();
      if (job.receipt.method !== 'dedicated-worker' || job.receipt.executionIdentity?.activeExecution !== 'bound') throw fail('Seed compilation needs its bound application worker.');
      const catalog = await getCatalog(); check();
      prepared = job.value;
      const payloads = [...(layered ? layerMaterials.map(entry => ({ sha256: entry.assetHash, bytes: entry.byteLength, blob: entry.blob })) : [{ sha256: material.assetHash, bytes: material.byteLength, blob: material.blob }]),
        { sha256: recipe.contractHash, bytes: new TextEncoder().encode(recipe.contractText).length, blob: new Blob([recipe.contractText], { type: 'application/json' }) }].sort((a, b) => a.sha256 < b.sha256 ? -1 : 1);
      const header = canonicalDataText({ format: SOUND_ARCHIVE_FORMAT, mode: 'portable', contentHash: prepared.contentHash, pack: prepared.pack,
        payloads: payloads.map(({ sha256, bytes }) => ({ sha256, bytes })), rightsReview: [], qualification: 'private-local-material;redistribution-not-asserted' }, { maxBytes: 4 * 1048576 }).bytes;
      const prefix = new Uint8Array(12); prefix.set(new TextEncoder().encode(SOUND_ARCHIVE_MAGIC)); new DataView(prefix.buffer).setUint32(8, header.length, false);
      phase = 'verifying-frozen-material'; report();
      next = await reader.stageArchive(new Blob([prefix, header, ...payloads.map(entry => entry.blob)]), { engineDescriptors: catalog.descriptors,
        signal: operation.controller.signal, isCurrent: () => !disposed && active === operation && isCurrent() }); check();
      const identities = next.metadata().patches; if (identities.length !== 1) throw fail('Seed compilation did not produce one complete instrument.');
      const record = { stage: next, identity: identities[0], contract: recipe.contract, assetHash: metadata.assetHash, targetIdentity: motionTarget, installed: false };
      // Publish after producer/input retirement, preserving the old patch on failure.
      job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) { unknown.add({ job, loan, workspace, stage: next }); job = loan = workspace = next = null; throw fail('Seed compiler retirement is unresolved.'); } job = null; prepared = null;
      const childReceipt = releaseExtraLoans(); await childReceipt.completion;
      if (childReceipt.outcome !== 'complete') { unknown.add({ childReceipt, extraLoans, loan, workspace, stage: next }); loan = workspace = next = null; throw fail('Layer input retirement remains unresolved.'); }
      loan.release(); loan = null; workspace.release(); workspace = null; check(); discard(current); current = record; next = null; phase = 'compiled-patch-ready'; return state();
    } catch (failure) {
      if (failure.backgroundRetirementCompletion) failure.backgroundRetirement = await failure.backgroundRetirementCompletion;
      if (failure.backgroundRetirement && !['released', 'canceled'].includes(failure.backgroundRetirement.phase)) { unknown.add({ failure, job, loan, workspace, stage: next }); job = loan = workspace = next = null; }
      throw failure;
    } finally {
      const childReceipt = releaseExtraLoans(); await childReceipt.completion;
      if (childReceipt.outcome !== 'complete') { unknown.add({ childReceipt, extraLoans, loan, workspace, stage: next }); loan = workspace = next = null; }
      if (job) { job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) { unknown.add({ job, loan, workspace, stage: next }); loan = workspace = next = null; } }
      if (next) discard({ stage: next }); loan?.release(); workspace?.release();
    }
  });
  const audition = ({ repeatCount = 1, comparison = false, graftComparison = null } = {}) => run('auditioning', async (operation, check) => {
    if (typeof comparison !== 'boolean' || graftComparison !== null && !['exciter-only', 'body-only'].includes(graftComparison) || comparison && graftComparison) throw fail('Declare an instrument audition or a dry source comparison.');
    if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 3) throw fail('Choose one audition or an explicit bounded three-pass loop.');
    if (!current?.stage.metadata().retained) throw fail('Compile the current seed before auditioning.');
    let receipt;
    for (let pass = 0; pass < repeatCount; pass++) {
      check(); receipt = await installation.audition(current.stage, current.identity, { signal: operation.controller.signal,
        graftComparison, ...(comparison ? { sourceMode: 'original' } : ['hammer-seed', 'route-relic', 'finite-fm-body-graft', 'feedforward-graft', 'motion-body-graft'].includes(current.contract.transform) ? { sampleHoldSeconds: Math.max(0.2, Math.min(8, current.contract.frames / current.contract.sampleRate + 0.02)) } : {}) }); check();
    }
    phase = 'audition-complete'; return receipt;
  });
  const install = () => run('saving-immutable-material', async (operation, check) => {
    if (!current) throw fail('Compile and audition this seed first.');
    const receipt = await installation.install(current.stage, { signal: operation.controller.signal, isCurrent: () => !disposed && active === operation });
    current.installed = true; check(); phase = 'durable'; return receipt;
  });
  const apply = () => run('applying-to-selected-lane', async (operation, check) => {
    if (!current) throw fail('Prepare this seed first.'); if (current.targetIdentity && current.targetIdentity !== targetIdentity()) throw fail('The motion mapping document or selected lane changed. Prepare its exact target again.'); const source = current, candidate = installation.applyCandidate(source.stage, source.identity); check();
    await onApply(candidate, { signal: operation.controller.signal }); check(); if (source.targetIdentity) source.targetIdentity = targetIdentity(); phase = 'applied'; return freezeData({ state: 'applied', assetHash: source.assetHash, patchIdentity: source.identity });
  });
  const stop = () => { active?.controller.abort(fail('Sound seed operation canceled.')); installation.stop(); };
  const clear = async () => { stop(); await active?.promise.catch(() => {}); if (unknown.size) throw fail('Seed instrument retirement remains unresolved.'); discard(current); current = null; phase = 'no-patch'; error = null; report(); };
  return Object.freeze({ prepare, audition, install, apply, stop, clear, state,
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; stop(); const stopped = Promise.resolve(active?.promise).catch(() => {});
      const installationFinished = stopped.then(async () => { const receipt = installation.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('Seed audition retirement remains unresolved.'); });
      return retirement.retire([{ name: 'accepted-seed-instrument-operation', run: () => stopped }, { name: 'seed-installation', run: () => installationFinished },
        { name: 'seed-material-stage', run: async () => { await installationFinished; if (unknown.size) throw fail('Seed instrument ownership remains unresolved.'); discard(current); current = null; reader.dispose(); registry.close(); } }]);
    }
  });
}
