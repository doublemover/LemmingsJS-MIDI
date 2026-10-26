import { createOriginalShapeBodySource } from '../../midi/content/OriginalShapeMeshes.js';
import { canonicalDataText, hashData, freezeData } from '../../core/CanonicalData.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { createSoundContentReader } from './SoundContentReader.js';
import { createSoundContentRegistry } from './SoundContentRegistry.js';
import { createSoundContentInstallation } from './SoundContentInstallation.js';
import { SOUND_ARCHIVE_FORMAT, SOUND_ARCHIVE_MAGIC } from './SoundContentArchive.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { SHAPE_REFINEMENT_PROFILE, SHAPE_REFINEMENT_REVISION } from '../resources/ShapeBodyRefinement.js';

const fail = message => Object.assign(new Error(message), { name: 'ShapeFoundryError', code: 'shape-foundry-unavailable' });
export function createShapeFoundryOwner({ audio, resourceBudget, jobs = backgroundJobService, indexedDB, keyRange, getCatalog = getNativeInstrumentCatalog, onApply, onState = () => {} } = {}) {
  if (typeof onApply !== 'function') throw new TypeError('The shape foundry needs the canonical lane application owner.');
  const reader = createSoundContentReader({ resourceBudget, jobs, maxPending: 2, stageLifetimeMs: 3600000 }), registry = createSoundContentRegistry({ indexedDB, keyRange, resourceBudget }), installation = createSoundContentInstallation({ audio, registry, getCatalog }), retirement = createProcgenRetirementScope(), unknown = new Set(), sourceLoans = new Set();
  let active = null, current = null, ordinal = 0, disposed = false, phase = 'idle', error = null, progress = null;
  const state = () => Object.freeze({ disposed, active: !!active, phase, error, progress, unknownRetirement: unknown.size, overview: current?.overview || null, contract: current?.contract || null, config: current?.config || null,
    compiledReady: !!current?.stage.metadata().retained, auditionReady: !!current && !!installation.getAudition(current.stage, current.identity), durable: current?.installed === true, patchIdentity: current?.identity || null, refinement: current?.refinement || null, sharedBody: current?.sharedBody ? { state: current.sharedBody.state, reason: current.sharedBody.reason ?? null, fieldHash: current.sharedBody.fieldHash ?? null, sites: current.sharedBody.maps?.map(model => model.siteId) ?? [] } : null });
  const report = () => { if (!disposed) { try { onState(state()); } catch {} } };
  const discard = value => { if (!value) return; value.stage.discard(); const metadata = value.stage.metadata(); if (metadata.retirement !== 'released' || metadata.activeLeases) { unknown.add(value); throw fail('The previous foundry pack retains unresolved readers.'); } try { try { value.refinementStorage?.release(); } finally { value.sharedStorage?.release(); } } catch (caught) { unknown.add(value); throw caught; } };
  const run = (nextPhase, work) => {
    if (disposed || active || unknown.size) return Promise.reject(fail('Finish or cancel the current foundry operation before starting another.'));
    const operation = { controller: new AbortController(), ordinal: ++ordinal, promise: null }; active = operation; phase = nextPhase; error = null; progress = null; report();
    const check = () => { operation.controller.signal.throwIfAborted(); if (disposed || active !== operation) throw fail('The foundry operation owner changed.'); };
    operation.promise = Promise.resolve().then(() => work(operation, check)).catch(caught => { error = caught.message; phase = unknown.size ? 'ownership-unknown' : current ? 'previous-prepared-body-retained' : 'idle'; throw caught; }).finally(() => { if (active === operation) active = null; report(); }); return operation.promise;
  };
  const prepare = ({ shapeId = 'pocket-bar', modeCount = 8, sampleRate = 48000, seconds = 2 } = {}, { isCurrent = () => true } = {}) => run('preparing-original-solid', async (operation, checkOwner) => {
    let job = null, workspace = null, next = null, sharedStorage = null;
    const releaseProducer = () => { if (!job) return; try { job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) throw fail('The foundry producer has unresolved retirement.'); }
    catch (caught) { unknown.add({ caught, job, workspace, sharedStorage, stage: next }); job = workspace = next = sharedStorage = null; throw caught; } job = null; };
    const releaseWorkspace = () => { if (!workspace) return; try { workspace.release(); } catch (caught) { unknown.add({ caught, workspace, sharedStorage, stage: next }); workspace = next = sharedStorage = null; throw caught; } workspace = null; };
    const check = () => { checkOwner(); if (!isCurrent()) throw fail('The selected document, lane or shape draft changed.'); };
    try {
      check(); if (![8, 16, 32].includes(modeCount) || ![44100, 48000, 96000].includes(sampleRate) || !Number.isFinite(seconds) || seconds < 0.2 || seconds > 4) throw fail('Choose a supported explicit tier, sample rate and finite duration.');
      const catalog = await getCatalog(); check(); if (catalog.state !== 'bound-application-engines' || !/^[a-f0-9]{64}$/.test(catalog.executionIdentity?.buildId)) throw fail('Build the current immutable application before preparing a foundry instrument.');
      const source = createOriginalShapeBodySource(shapeId, { validate: false }), sourceRevision = await hashData(source, { maxBytes: 262144, maxNodes: 16384 }); check();
      const input = { source, solverBuildHash: catalog.executionIdentity.buildId, modeCount, sampleRate, seconds }, inputBytes = canonicalDataText(input, { maxBytes: 262144, maxNodes: 16384 }).bytes.length;
      job = await jobs.compute({ kind: 'build-shape-body-content', ownerId: 'shape-foundry', ownerEpoch: operation.ordinal, sourceRevision, inputBytes, maxBytes: 262144, estimatedPeakBytes: 128 * 1048576,
        budgetAdapter: resourceBudget, signal: operation.controller.signal, isCurrent: () => !disposed && active === operation && isCurrent(), deadlineMs: 180000, prepareInput: () => input,
        onProgress: value => { if (!disposed && active === operation) { progress = Object.freeze(value); phase = value.phase || 'preparing'; report(); } } }); check();
      if (job.receipt.method !== 'dedicated-worker' || job.receipt.executionIdentity?.activeExecution !== 'bound' || job.receipt.executionIdentity.buildId !== catalog.executionIdentity.buildId) throw fail('The foundry output did not execute its exact bound worker.');
      const result = job.value, payloadBytes = result.contents.reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
      workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'shape-foundry-archive', generation: operation.ordinal, kind: 'generated-pack-archive-and-copy-estimate', category: 'candidate', bytes: payloadBytes * 3 + 8 * 1048576 });
      const payloads = result.contents.map(entry => ({ sha256: entry.sha256, bytes: entry.bytes.byteLength, blob: new Blob([entry.bytes], { type: entry.path.endsWith('.wav') ? 'audio/wav' : 'application/json' }) })).sort((a, b) => a.sha256 < b.sha256 ? -1 : 1);
      const header = canonicalDataText({ format: SOUND_ARCHIVE_FORMAT, mode: 'portable', contentHash: result.prepared.contentHash, pack: result.prepared.pack, payloads: payloads.map(({ sha256, bytes }) => ({ sha256, bytes })), rightsReview: [], qualification: 'experimental-original-solid;algebraic-calibration-not-acoustic-qualification' }, { maxBytes: 4 * 1048576 }).bytes;
      const prefix = new Uint8Array(12); prefix.set(new TextEncoder().encode(SOUND_ARCHIVE_MAGIC)); new DataView(prefix.buffer).setUint32(8, header.byteLength, false); phase = 'verifying-generated-material'; report();
      next = await reader.stageArchive(new Blob([prefix, header, ...payloads.map(entry => entry.blob)]), { engineDescriptors: catalog.descriptors, signal: operation.controller.signal, isCurrent: () => !disposed && active === operation && isCurrent() }); check();
      if (next.metadata().patches.length !== 1) throw fail('The foundry did not prepare one complete ordinary instrument.');
      const endpointFile = payloads.find(entry => entry.sha256 === result.overview.assetHash); if (!endpointFile || endpointFile.blob.size > 2 * 1048576) throw fail('The exact retained foundry body source is unavailable or oversized.');
      sharedStorage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'shape-foundry-edge-and-endpoint', generation: operation.ordinal, kind: 'solved-edge-and-retained-endpoint-source', category: 'candidate', bytes: endpointFile.blob.size + 131072 + (result.sharedBody ? canonicalDataText(result.sharedBody, { maxBytes: 524288, maxNodes: 32768 }).bytes.length * 8 : 0) });
      const record = { endpointFile, sharedBody: result.sharedBody ? freezeData(result.sharedBody) : null, sharedStorage, stage: next, identity: next.metadata().patches[0], overview: freezeData(result.overview), contract: freezeData(result.receipt), config: Object.freeze({ shapeId, modeCount, sampleRate, seconds }), installed: false };
      releaseProducer(); releaseWorkspace(); check(); discard(current); current = record; next = sharedStorage = null; phase = 'compiled-body-ready'; return state();
    } catch (caught) {
      if (caught.backgroundRetirementCompletion) caught.backgroundRetirement = await caught.backgroundRetirementCompletion;
      if (caught.backgroundRetirement && !['released', 'canceled'].includes(caught.backgroundRetirement.phase)) { unknown.add({ caught, job, workspace, sharedStorage, stage: next }); job = workspace = next = sharedStorage = null; }
      throw caught;
    } finally {
      releaseProducer(); try { if (next) discard({ stage: next, sharedStorage }); else sharedStorage?.release(); } finally { releaseWorkspace(); }
    }
  });
  const compareRefinement = ({ isCurrent = () => true } = {}) => run('comparing-original-mesh-refinement', async (operation, checkOwner) => {
    const source = current; let job = null, storage = null;
    const check = () => { checkOwner(); if (!source?.stage.metadata().retained || source !== current || !isCurrent() || source.config.shapeId !== 'pocket-bar') throw fail('Prepare the exact current original pocket bar before comparing its nested meshes.'); };
    const releaseProducer = () => { if (!job) return; job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) throw fail('Refinement worker ownership remains unresolved.'); job = null; };
    try {
      check(); const catalog = await getCatalog(); check(); if (catalog.state !== 'bound-application-engines' || catalog.executionIdentity?.buildId !== source.overview.solver.buildHash) throw fail('The executing solver changed. Prepare the current original body again.');
      const input = { shapeId: 'pocket-bar', profileId: SHAPE_REFINEMENT_PROFILE.id, comparisonBuildHash: catalog.executionIdentity.buildId, expectedCoarseAssetHash: source.overview.assetHash };
      job = await jobs.compute({ kind: 'qualify-original-shape-refinement', ownerId: 'shape-foundry-refinement', ownerEpoch: operation.ordinal, sourceRevision: source.overview.assetHash, inputBytes: canonicalDataText(input).bytes.length, maxBytes: 4096, estimatedPeakBytes: 128 * 1048576,
        budgetAdapter: resourceBudget, signal: operation.controller.signal, isCurrent: () => !disposed && active === operation && source === current && isCurrent(), deadlineMs: 180000, prepareInput: () => input,
        onProgress: value => { if (!disposed && active === operation) { progress = Object.freeze(value); phase = value.phase || 'comparing-original-mesh-refinement'; report(); } } }); check();
      const value = job.value, { receiptHash, ...receipt } = value;
      if (job.receipt.method !== 'dedicated-worker' || job.receipt.executionIdentity?.activeExecution !== 'bound' || job.receipt.executionIdentity.buildId !== catalog.executionIdentity.buildId || value.schema !== 'lemmings-shape-refinement-comparison/v1' || value.revision !== SHAPE_REFINEMENT_REVISION || value.comparisonBuildHash !== catalog.executionIdentity.buildId || value.coarse?.assetHash !== source.overview.assetHash ||
          canonicalDataText(value.profile).text !== canonicalDataText(SHAPE_REFINEMENT_PROFILE).text || !['within-profile-tolerances', 'outside-profile-tolerances', 'inconclusive-degenerate-subspace'].includes(value.status) || value.summary?.comparedModes !== SHAPE_REFINEMENT_PROFILE.modeCount || !Array.isArray(value.pairs) || value.pairs.length !== SHAPE_REFINEMENT_PROFILE.modeCount ||
          value.automaticTierAdmission !== false || value.acousticQualification !== false || value.listeningQualification !== false || value.deviceCostQualification !== false || await hashData(receipt, { maxBytes: 262144, maxNodes: 16384 }) !== receiptHash) throw fail('The comparison result differs from its admitted body, algorithm or actual worker.'); check();
      storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'shape-foundry-refinement', generation: operation.ordinal, kind: 'retained-mesh-comparison-receipt-estimate', bytes: Math.max(4096, canonicalDataText(value, { maxBytes: 262144, maxNodes: 16384 }).bytes.length * 8) });
      const retained = freezeData(value); releaseProducer(); check(); try { source.refinementStorage?.release(); } catch (caught) { unknown.add(source); throw caught; } source.refinementStorage = storage; source.refinement = retained; storage = null; phase = 'refinement-' + retained.status; return state();
    } catch (caught) {
      if (caught.backgroundRetirementCompletion) caught.backgroundRetirement = await caught.backgroundRetirementCompletion;
      if (caught.backgroundRetirement && !['released', 'canceled'].includes(caught.backgroundRetirement.phase)) { unknown.add({ caught, job, storage }); job = storage = null; } throw caught;
    } finally { try { releaseProducer(); } catch (caught) { unknown.add({ caught, job, storage }); job = storage = null; throw caught; } finally { if (storage) try { storage.release(); } catch (caught) { unknown.add({ caught, storage }); throw caught; } } }
  });
  const audition = (siteId, { isCurrent = () => true } = {}) => run('auditioning-selected-site', async (operation, check) => {
    if (!current?.stage.metadata().retained || !current.contract.sites.includes(siteId) || !isCurrent()) throw fail('Prepare the current body and choose one actual authored site.');
    const receipt = await installation.audition(current.stage, current.identity, { signal: operation.controller.signal, sampleGesture: siteId, sampleHoldSeconds: Math.max(0.2, Math.min(8, current.config.seconds + 0.02)) }); check(); if (!isCurrent()) throw fail('The foundry target changed during audition.'); phase = 'site-audition-complete'; return receipt;
  });
  const install = () => run('saving-immutable-body', async (operation, check) => { if (!current) throw fail('Prepare and audition a body first.'); const receipt = await installation.install(current.stage, { signal: operation.controller.signal, isCurrent: () => !disposed && active === operation }); check(); current.installed = true; phase = 'durable-body'; return receipt; });
  const apply = ({ isCurrent = () => true } = {}) => run('applying-body-to-selected-lane', async (operation, check) => { if (!current || !isCurrent()) throw fail('The prepared body or selected lane changed.'); const candidate = installation.applyCandidate(current.stage, current.identity); await onApply(candidate, { signal: operation.controller.signal }); check(); phase = 'applied'; return state(); });
  const stop = () => { active?.controller.abort(fail('Foundry operation canceled.')); installation.stop(); };
  return Object.freeze({ prepare, compareRefinement,
    borrowEndpointSource() {
      if (disposed || active || unknown.size || !current?.endpointFile || sourceLoans.size >= 2) throw fail('Prepare the exact foundry source and settle earlier source readers first.');
      const blob = current.endpointFile.blob, reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'shape-foundry-endpoint-reader', kind: 'independent-immutable-body-source-reader', category: 'candidate', bytes: blob.size + 8192 }); let released = false;
      const loan = Object.freeze({ assetHash: current.overview.assetHash, file: Object.freeze({ size: blob.size, text() { if (released) throw fail('This independent body source reader has retired.'); return blob.text(); } }), release() { if (released) return; try { reservation.release(); released = true; sourceLoans.delete(loan); } catch (caught) { unknown.add(loan); throw caught; } } }); sourceLoans.add(loan); return loan;
    }, sharedMap: siteId => current?.sharedBody?.maps?.find(model => model.siteId === siteId) || null, audition, install, apply, stop, state,
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; stop(); const pending = Promise.resolve(active?.promise).catch(() => {}), installationFinished = pending.then(async () => { const receipt = installation.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('Foundry audition retirement is unresolved.'); });
      return retirement.retire([{ name: 'foundry-operation', run: () => pending }, { name: 'foundry-audition', run: () => installationFinished }, { name: 'foundry-material-stage', run: async () => { await installationFinished; if (unknown.size) throw fail('Generated foundry material retains unresolved ownership.'); discard(current); current = null; reader.dispose(); registry.close(); } }]); }
  });
}
