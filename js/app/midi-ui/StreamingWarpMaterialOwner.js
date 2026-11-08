import { createOwnedSoundSeedSource } from './OwnedSoundSeedSource.js';
import { createOwnedStretchMaterial } from './OwnedStretchMaterial.js';
import { sealStretchImageMaterial } from './StretchImageMaterial.js';
import { validateStretchImageMetadata } from '../../midi/content/StretchImageProfile.js';
import { validateBufferedWarpPlan } from '../../midi/content/BufferedWarpPlan.js';
import { getActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { requireSynchronousResourceAcknowledgement, awaitBackgroundFailureRetirement } from '../resources/ResourceRetirement.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { canonicalDataText, cloneData, freezeData, hashData } from '../../core/CanonicalData.js';

const fail = message => Object.assign(new Error(message), { code: 'streaming-warp-material-owner-unavailable' });
let nextOwner = 0;
export function createStreamingWarpMaterialOwner({ resourceBudget, jobs = backgroundJobService, coreMaterial = null, onState = () => {} } = {}) {
  const id = 'streaming-warp-material-' + (++nextOwner), ownCore = !coreMaterial, cores = coreMaterial || createOwnedStretchMaterial({ resourceBudget }),
    scope = createProcgenRetirementScope(), records = new Set();
  let current = null, active = null, sequence = 0, disposed = false, error = null, unknown = null, borrowed = 0;
  const state = () => Object.freeze({ phase: disposed ? 'disposed' : unknown ? 'ownership-unknown' : active ? 'preparing' : current ? 'ready' : 'empty', active: !!active,
    sourceAssetHash: current?.plan.assetHash || null, planHash: current?.planHash || null, plan: current?.plan || null, retainedMaterials: records.size, readers: borrowed,
    error, qualification: 'verified-material-and-shared-initial-image;streaming-output-quality-separate' });
  const report = () => { try { onState(state()); } catch {} };
  const release = record => {
    if (!record || record.readers || !record.retiring || !records.has(record)) return;
    record.image?.dispose(); record.pcm = null; record.reservation.release(); records.delete(record);
  };
  const prepare = (candidate, options = {}) => {
    if (disposed || active || unknown || records.size >= 2 || !candidate?.metadata?.().assetReady) return Promise.reject(fail('Use a ready frozen source and finish or release the previous bounded material preparations.'));
    const execution = getActiveExecutionIdentity('browser-background-jobs'); if (execution.activeExecution !== 'bound') return Promise.reject(fail('Prepare streaming material in its immutable built application.'));
    const control = cloneData(options, { maxBytes: 8192, maxNodes: 512 }), generation = ++sequence, operation = { controller: new AbortController(), source: null, window: null, core: null, job: null, record: null, promise: null };
    active = operation; error = null; report();
    const check = () => { operation.controller.signal.throwIfAborted(); if (disposed || active !== operation || !candidate.metadata().assetReady) throw fail('The frozen streaming material source changed.'); };
    operation.promise = (async () => {
      let candidateRecord = null, operationError = null;
      try {
        operation.source = createOwnedSoundSeedSource({ artifact: candidate.artifact, manifest: candidate.manifest, resourceBudget }); const metadata = operation.source.metadata();
        if (metadata.sourceFrames * 8 > 4 * 1048576 || metadata.sourceFrames > metadata.sampleRate * 8) throw fail('Select at most eight seconds and 4 MiB of stereo source material.');
        operation.window = await operation.source.readWindow({ firstFrame: 0, endFrame: metadata.sourceFrames, signal: operation.controller.signal, isCurrent: () => !disposed && active === operation }); check();
        operation.core = await cores.borrow({ signal: operation.controller.signal, isCurrent: () => !disposed && active === operation }); check();
        const source = { ...operation.window.value, generation }, info = canonicalDataText({ ...source, pcm: null, originBytes: null, options: control, applicationBuildId: execution.buildId }, { maxBytes: 65536, maxNodes: 8192 });
        operation.job = await jobs.compute({ kind: 'prepare-streaming-warp-material', ownerId: id, ownerEpoch: generation, sourceRevision: metadata.immutableSourceRef,
          signal: operation.controller.signal, budgetAdapter: resourceBudget, isCurrent: () => !disposed && active === operation,
          inputBytes: info.bytes.length + source.pcm.length + source.originBytes.length + operation.core.blob.size, maxBytes: 8 * 1048576,
          estimatedPeakBytes: 256 * 1048576, deadlineMs: 120000, prepareInput: async () => ({ ...source, options: control, applicationBuildId: execution.buildId, wasmBytes: new Uint8Array(await operation.core.blob.arrayBuffer()) }) }); check();
        let result = operation.job.value;
        if (operation.job.receipt.method !== 'dedicated-worker' || operation.job.receipt.executionIdentity?.buildId !== execution.buildId || result?.schema !== 'lemmings-prepared-streaming-warp-material/v1' ||
            result.applicationBuildId !== execution.buildId || result.generation !== generation || result.plan.assetHash !== metadata.immutableSourceRef) throw fail('The prepared image/PCM result differs from its producing build or frozen source.');
        const plan = validateBufferedWarpPlan(result.plan), imageMetadata = validateStretchImageMetadata(result.image?.metadata), pcmBytes = result.pcm?.planes?.reduce((sum, plane) => sum + plane.byteLength, 0),
          frames = Math.ceil(metadata.sourceFrames * plan.outputRate / metadata.sampleRate), pcmMetadata = result.pcm?.metadata;
        if (!Number.isSafeInteger(pcmBytes) || pcmBytes < 16 || pcmBytes > 16 * 1048576 || result.pcm.planes.length !== 2 ||
            result.pcm.planes.some(plane => !(plane instanceof Float32Array) || plane.length !== frames) || plan.sourceRate !== metadata.sampleRate || plan.sourceFrames !== metadata.sourceFrames ||
            plan.sourceFrameRegion[0] !== 0 || plan.sourceFrameRegion[1] !== metadata.sourceFrames || plan.outputRate !== control.outputRate || plan.rateRatio !== control.rateRatio || plan.pitchRatio !== control.pitchRatio ||
            pcmMetadata?.originalRate !== metadata.sampleRate || pcmMetadata.preparedRate !== plan.outputRate || pcmMetadata.preparedFrames !== frames || pcmMetadata.normalization !== 'none' ||
            await hashData(plan) !== result.planHash) throw fail('The prepared PCM inventory, frame clocks or immutable plan differs from its admitted source and controls.');
        const planeHashes = await Promise.all(result.pcm.planes.map(async plane => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(plane.buffer, plane.byteOffset, plane.byteLength)))].map(value => value.toString(16).padStart(2, '0')).join(''))); check();
        if (planeHashes.some((hash, index) => hash !== pcmMetadata.planeHashes?.[index])) throw fail('The worker PCM planes differ from their immutable content hashes.');
        const reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: id, generation, kind: 'shared-prepared-image-and-immutable-source-pcm', category: 'audio',
          bytes: imageMetadata.heapBytes + imageMetadata.moduleBytes + imageMetadata.compiledModuleEstimateBytes + pcmBytes * 2 + 2 * 1048576 });
        const record = { reservation, image: null, pcm: null, plan, planHash: result.planHash, readers: 0, retiring: true }; operation.record = record; records.add(record);
        record.image = await sealStretchImageMaterial(result.image, { applicationBuildId: execution.buildId, sampleRate: plan.outputRate,
          estimatedPeakBytes: 256 * 1048576, signal: operation.controller.signal, current: () => !disposed && active === operation }); check();
        if (record.image.metadata.configurationHash !== plan.algorithm.configurationHash) throw fail('The shared core image differs from the prepared source algorithm configuration.'); check();
        record.pcm = Object.freeze({ metadata: freezeData(cloneData(result.pcm.metadata)), planes: result.pcm.planes.map(plane => plane.slice()) });
        result = null; operation.job.release(); if (!['released', 'canceled'].includes(operation.job.retirementState().phase)) throw fail('The streaming preparation worker retains unresolved result ownership.'); operation.job = null;
        candidateRecord = record;
      } catch (caught) {
        operationError = caught;
        try { await awaitBackgroundFailureRetirement(caught); } catch (retirement) { unknown = retirement; }
        error = String(caught.message).slice(0, 512); throw caught;
      } finally {
        const failures = [];
        if (operation.record && !candidateRecord) { operation.record.retiring = true; try { release(operation.record); } catch (caught) { failures.push(caught); } }
        if (operation.job) try { operation.job.release(); if (!['released', 'canceled'].includes(operation.job.retirementState().phase)) throw fail('The streaming worker result remains owned.'); } catch (caught) { failures.push(caught); }
        for (const [value, method] of [[operation.window, 'release'], [operation.core, 'release']]) try { if (value) requireSynchronousResourceAcknowledgement(value[method](), 'Streaming material source reader'); } catch (caught) { failures.push(caught); }
        if (operation.source) try { const receipt = operation.source.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('The frozen source reader retains unresolved ownership.'); } catch (caught) { failures.push(caught); }
        let canceled = null;
        if (candidateRecord) {
          if (!failures.length && !disposed && active === operation && !operation.controller.signal.aborted) {
            const previous = current; candidateRecord.retiring = false; current = candidateRecord; operation.record = null;
            if (previous) try { previous.retiring = true; release(previous); } catch (caught) { failures.push(caught); }
          } else {
            try { candidateRecord.retiring = true; release(candidateRecord); } catch (caught) { failures.push(caught); }
            canceled = operation.controller.signal.reason || fail('The streaming material source retired before publication.');
          }
        }
        if (failures.length) { unknown = failures[0]; error = unknown.message; }
        if (active === operation) active = null; report();
        if (unknown && operationError) operationError.retirementError = unknown;
        else if (unknown || canceled) throw unknown || canceled;
      }
      return state();
    })(); return operation.promise;
  };
  return Object.freeze({ prepare, state, cancel() { active?.controller.abort(); },
    borrow() {
      if (disposed || unknown || !current || borrowed >= 8) throw fail('No verified streaming material reader is available.');
      const record = current, bytes = record.pcm.planes.reduce((sum, plane) => sum + plane.byteLength, 0), reservation = createOwnedResourceReservation({ budget: resourceBudget,
        owner: id + ':reader', generation: sequence, kind: 'private-streaming-pcm-reader-copy', category: 'candidate', bytes: bytes + 65536 });
      let value;
      try { value = Object.freeze({ plan: record.plan, pcm: Object.freeze({ metadata: record.pcm.metadata, planes: record.pcm.planes.map(plane => plane.slice()) }),
        image: Object.freeze({ fork: options => { if (!value) throw fail('The streaming image reader retired.'); return record.image.fork(options); } }) }); } catch (caught) { reservation.release(); throw caught; }
      record.readers++; borrowed++;
      return Object.freeze({ get value() { if (!value) throw fail('The streaming material reader retired.'); return value; },
        release() { if (!value) return false; value = null; record.readers--; borrowed--; reservation.release(); release(record); report(); return true; } });
    },
    clear() { active?.controller.abort(); if (current) { current.retiring = true; const previous = current; current = null; release(previous); } report(); },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; active?.controller.abort(); const pending = active?.promise;
      return scope.retire([{ name: 'streaming-material-producer', run: async () => { if (pending) await Promise.allSettled([pending]); if (unknown) throw unknown; } },
        { name: 'streaming-material-cache', run: async () => { if (pending) await Promise.allSettled([pending]); current = null; for (const record of records) { record.retiring = true; release(record); }
          if (records.size) throw fail('Streaming material readers retain their charged immutable source/image.'); } },
        { name: 'streaming-core-source', run: () => ownCore ? cores.dispose() : null }]); }
  });
}
