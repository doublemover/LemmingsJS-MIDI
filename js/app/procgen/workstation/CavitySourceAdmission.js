import { cloneData } from '../../../core/CanonicalData.js';
import { estimateJournalBytes } from './CausalJournalCanonical.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

export function createCavitySourceAdmission({ backend, getBody, getContext, resourceBudget }) {
  const storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'cavity-source-admission', kind: 'bounded-cavity-source-buffer', category: 'audio', bytes: 32768 }), retirement = createProcgenRetirementScope(), pending = new Set(), retained = new Set(), producers = new Set();
  let disposed = false, highWaterBytes = 32768, admitted = 0, rejected = 0, retirementError = null;
  const reject = reason => ({ status: 'rejected', reason, stage: 'cavity-source-not-submitted' });
  const nowFrame = () => { const context = getContext(); return context?.state === 'running' ? Math.floor(context.currentTime * context.sampleRate) : null; };
  const find = (voiceId, execution) => [...pending].find(record => record.intent.voiceId === voiceId && record.execution === execution);
  const future = () => { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; };
  const terminal = async outcome => { const value = outcome?.status === 'deferred' ? await outcome.completion : outcome; return ['accepted', 'degraded', 'rejected'].includes(value?.status) ? value : reject('invalid-cavity-source-outcome'); };
  const admitBytes = additional => {
    const next = 32768 + [...retained].reduce((sum, record) => sum + record.bytes, additional);
    if (next > 8 * 1048576) throw new Error('cavity-source-byte-capacity'); const peak = Math.max(highWaterBytes, next); storage.resize(peak); highWaterBytes = peak;
  };
  const settleProducer = record => { if (--record.producers === 0) { retained.delete(record); record.intent = record.end = record.context = record.ticket = record.completion = null; } };
  const finish = (record, outcome) => {
    if (record.finished) return false; record.finished = true; clearTimeout(record.timer); pending.delete(record); record.completion.resolve(outcome);
    if (outcome?.status === 'rejected') { rejected++; record.end?.completion.resolve(outcome); } else admitted++;
    return true;
  };
  const cancelRecord = (record, reason) => {
    finish(record, reject(reason));
    if (!record.submitted) return true;
    try { if (record.nativeCancel) return record.nativeCancel(reason);
      return backend.cancelGenerationWithReceipt ? backend.cancelGenerationWithReceipt(record.generation, record.execution) : backend.cancelGeneration?.(record.generation, record.execution);
    } catch (error) { retirementError = error; throw error; }
  };
  const cancel = (execution, reason) => { for (const record of [...pending]) if (execution == null || record.execution === execution) cancelRecord(record, reason); };
  return Object.freeze({ ...backend,
    begin(intent, frame, execution, context) {
      if (disposed || retirementError) return reject('cavity-source-owner-retired');
      const body = getBody(); if (body?.canEmit(intent)) return backend.begin(intent, frame, execution, context);
      const ticket = body?.qualification(intent), current = nowFrame(), audioContext = getContext();
      if (!ticket || current == null || !Number.isSafeInteger(frame) || frame < current || retained.size >= 64 || producers.size >= 64 || find(intent.voiceId, execution)) return reject('cavity-body-or-buffer-unavailable');
      let owned, bytes;
      try { bytes = estimateJournalBytes(intent, { maxBytes: 8192, maxNodes: 512 }) * 8 + 1024; admitBytes(bytes); owned = cloneData(intent, { maxBytes: 8192, maxNodes: 512 }); }
      catch (error) { return reject(error.code || error.message); }
      const record = { intent: owned, generation: intent.generation, bytes, frame, execution, context, ticket, end: null, finished: false, submitted: false, nativeCancel: null, timer: null, completion: future(), producers: 1 }; pending.add(record); retained.add(record);
      record.timer = setTimeout(() => finish(record, reject('cavity-preparation-deadline')), Math.max(0, Math.min(50, (frame - current) / audioContext.sampleRate * 1000)));
      const task = Promise.resolve().then(() => body.ensure()).then(async () => {
        if (record.finished) return;
        if (disposed || body !== getBody() || audioContext !== getContext() || !body.canEmit(record.intent, ticket) || nowFrame() == null || frame < nowFrame()) { finish(record, reject('cavity-geometry-or-original-frame-unavailable')); return; }
        record.submitted = true; clearTimeout(record.timer);
        const outcome = backend.begin(record.intent, frame, execution, context); record.nativeCancel = outcome?.cancel || null;
        if (['accepted', 'degraded', 'deferred'].includes(outcome?.status) && record.end) {
          const endOutcome = backend.end(record.intent.voiceId, record.end.options, record.end.frame, execution, record.end.intent, record.end.context);
          record.producers++; const endTask = terminal(endOutcome).then(value => record.end.completion.resolve(value), error => { try { cancelRecord(record, 'cavity-end-submission-unknown'); } catch {} record.end.completion.resolve(reject(error.code || error.message)); }).finally(() => { producers.delete(endTask); settleProducer(record); }); producers.add(endTask);
        }
        finish(record, await terminal(outcome));
      }).catch(error => { try { cancelRecord(record, error.code || error.message); } catch {} }).finally(() => { producers.delete(task); settleProducer(record); }); producers.add(task);
      return { status: 'deferred', stage: 'cavity-body-preparation', reason: 'awaiting-qualified-body-before-original-target-frame', completion: record.completion.promise, cancel: reason => cancelRecord(record, reason || 'cavity-admission-cancelled') };
    },
    end(voiceId, options, frame, execution, intent, context) {
      const record = find(voiceId, execution); if (!record || record.submitted) return backend.end(voiceId, options, frame, execution, intent, context);
      if (record.end) return reject('duplicate-pending-cavity-end');
      let owned, ownedOptions, bytes;
      try { bytes = estimateJournalBytes({ intent, options }, { maxBytes: 8192, maxNodes: 512 }) * 8 + 1024; admitBytes(bytes); owned = cloneData(intent, { maxBytes: 8192, maxNodes: 512 }); ownedOptions = cloneData(options, { maxBytes: 2048, maxNodes: 64 }); }
      catch (error) { cancelRecord(record, 'cavity-end-buffer-unavailable'); return reject(error.code || error.message); }
      record.bytes += bytes; record.end = { options: ownedOptions, frame, intent: owned, context, completion: future() };
      return { status: 'deferred', stage: 'cavity-source-end-awaiting-original-begin', reason: 'ordered-after-pending-begin', completion: record.end.completion.promise, cancel: reason => cancelRecord(record, reason || 'cavity-end-admission-cancelled') };
    },
    retireExecution(execution) { cancel(execution, 'cavity-execution-retired'); return backend.retireExecution?.(execution); },
    cancelGeneration(generation, execution) { cancel(execution, 'cavity-generation-cancelled'); return backend.cancelGeneration?.(generation, execution); },
    cancelGenerationWithReceipt(generation, execution) { cancel(execution, 'cavity-generation-cancelled'); return backend.cancelGenerationWithReceipt ? backend.cancelGenerationWithReceipt(generation, execution) : backend.cancelGeneration?.(generation, execution); },
    cavityDiagnostics: () => Object.freeze({ pending: pending.size, retainedSources: retained.size, producers: producers.size, admitted, rejected, highWaterBytes, maximumSources: 64, maximumWallDelayMs: 50, retirementError: retirementError?.message || null, targetPolicy: 'original-frame-only;no-retiming-or-catch-up' }),
    disposeCavityBuffer() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; try { cancel(null, 'cavity-source-owner-retired'); } catch {} return retirement.retire([{ name: 'cavity-source-producers', run: async () => { await Promise.allSettled([...producers]); if (retirementError) throw retirementError; storage.release(); } }]); }
  });
}
