import { planPreparedBodyStrike } from '../../../midi/content/PreparedBodyStrike.js';
import { createAudioIntervalAdmission } from '../../midi-ui/AudioIntervalAdmission.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

export function createPreparedBodyStrikeBackend({ owner, resolveBody, inventory, enqueue, panicBody, observe, resourceBudget = null, sinkId = 'physical-shared-body', onReceipt = () => {} }) {
  if ([resolveBody, inventory, enqueue, panicBody, observe, onReceipt].some(value => typeof value !== 'function')) throw new TypeError('Finite body sources need the existing body owner, native command transport and receipt observer.');
  if (typeof sinkId !== 'string' || !sinkId || sinkId.length > 512) throw new TypeError('Finite body sources need a bounded sink identity.');
  const storage = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'finite-body-source-metadata-estimate', category: 'audio', bytes: 32768 });
  const intervals = createAudioIntervalAdmission({ maxIntervals: 68 }), pending = new Map(), gates = new Map(), executions = new Set(), retirement = createProcgenRetirementScope({ deadlineMs: 15000 });
  let sequence = 0, disposed = false, timer = null;
  const report = value => { try { onReceipt(Object.freeze(value)); } catch {} };
  const targetKey = body => JSON.stringify([body.owner, body.ownerGeneration, body.ownerRouteRevision, body.graphDefinitionHash, body.nodeId]);
  const expected = body => ({ ownerRouteRevision: body.ownerRouteRevision, graphDefinitionHash: body.graphDefinitionHash });
  const gateKey = (voiceId, execution) => JSON.stringify([execution.executionEpoch, execution.generation, voiceId]);
  const settle = () => {
    const available = new Set(inventory().map(targetKey));
    for (const [token, record] of pending) if (!available.has(targetKey(record.body))) { pending.delete(token); report({ status: 'accepted', stage: 'body-source-owner-retired', token, source: record.plan.source, appliedFrame: null, acousticReceipt: false }); }
    for (const execution of executions) if (execution.closed && ![...pending.values()].some(record => record.execution === execution)) { executions.delete(execution); execution.resolve?.(); }
    if (timer != null) clearTimeout(timer); timer = null;
    if ([...executions].some(execution => execution.closed)) timer = setTimeout(settle, 25);
  };
  let unsubscribe;
  try { unsubscribe = observe(receipt => {
    if (receipt.stage === 'body-strike-ownership-unknown') { report({ status: 'rejected', stage: 'effect-performance-capture', reason: 'prepared-body-strike-ownership-unknown', acousticReceipt: false }); return; }
    const record = pending.get(receipt.token);
    if (!record || targetKey(record.body) !== targetKey(receipt)) return;
    report({ ...receipt, source: record.plan.source, command: record.plan.command, intentId: record.plan.source.intentId, batchId: record.batchId, generation: record.execution.generation,
      sinkId, targetTimeDomain: 'audio-sample-frames', bodyInstanceId: record.body.bodyInstanceId, executionEpoch: record.execution.executionEpoch, sampleRate: record.body.sampleRate });
    if (['body-strike-rejected', 'body-strike-ended'].includes(receipt.stage) || receipt.stage === 'body-strike-dsp-queued' && receipt.status === 'rejected') { pending.delete(receipt.token); settle(); }
  }); if (typeof unsubscribe !== 'function') throw new TypeError('The body observer did not retain a removable subscription.'); }
  catch (error) { storage.release(); throw error; }
  const valid = execution => !disposed && executions.has(execution) && !execution.closed;
  const retireExecution = execution => {
    if (!executions.has(execution)) return createProcgenRetirementScope().retire();
    if (execution.retirement) return execution.retirement;
    execution.closed = true; for (const [key, gate] of gates) if (gate.execution === execution) gates.delete(key);
    let complete; const promise = new Promise(resolve => { complete = resolve; }); execution.resolve = complete;
    execution.retirement = createProcgenRetirementScope({ deadlineMs: 15000 }).retire([{ name: 'finite-body-source-children', run: () => promise }]); settle(); return execution.retirement;
  };
  return Object.freeze({
    registerExecution({ executionEpoch, generation }) {
      settle(); if (disposed || executions.size >= 16 || typeof executionEpoch !== 'string' || !executionEpoch || !Number.isSafeInteger(generation) || generation < 0) return { status: 'rejected', reason: 'body-execution-unavailable' };
      const execution = { executionEpoch, generation, closed: false }; executions.add(execution); return { status: 'accepted', execution };
    },
    executionIncarnation: () => 0,
    renewExecutionLease(generation, execution, untilFrame) { return valid(execution) && execution.generation === generation && Number.isSafeInteger(untilFrame) && untilFrame >= 0 ? { status: 'accepted', stage: 'finite-source-no-sustained-drive-lease' } : { status: 'rejected', reason: 'body-execution-unavailable' }; },
    begin(intent, frame, execution) {
      if (!valid(execution) || execution.generation !== intent.generation) return { status: 'rejected', reason: 'body-execution-unavailable' }; settle();
      const body = resolveBody(intent.preparedBodyStrike?.surfaceId), key = gateKey(intent.voiceId, execution);
      if (!body || body.executionEpoch !== execution.executionEpoch || gates.has(key) || gates.size >= 512 || pending.size >= 544 || sequence === Number.MAX_SAFE_INTEGER) return { status: 'rejected', reason: 'prepared-body-source-unavailable' };
      let plan;
      try {
        if (!Array.isArray(intent.sourceEventIds) || !intent.sourceEventIds.length || intent.sourceEventIds.length > 16 || intent.sourceEventIds.some(id => typeof id !== 'string' || !id || id.length > 512) || [intent.intentId, intent.voiceId, intent.onsetId].some(id => typeof id !== 'string' || !id || id.length > 1024)) throw new Error('Source identity exceeds the bounded finite exciter metadata.');
        plan = planPreparedBodyStrike(intent, body, frame, sequence + 1);
        const voices = [...pending.values()].filter(record => record.body.bodyInstanceId === body.bodyInstanceId);
        if (voices.length >= 68 || !intervals.inspect({ voices, first: frame, last: plan.endFrame, limit: 4, cost: 1 }).accepted) return { status: 'rejected', reason: 'finite-body-exciter-capacity' };
        storage.resize(12 * 1048576);
      } catch (error) { return { status: 'rejected', reason: error.message }; }
      const token = ++sequence, record = { body, plan, execution, batchId: intent.batchId, start: frame, end: plan.endFrame, renderCost: 1 }; pending.set(token, record);
      try {
        const receipt = enqueue(body.nodeId, plan.command, expected(body));
        if (receipt?.status !== 'accepted' || receipt.token !== token || receipt.targetFrame !== frame || receipt.graphDefinitionHash !== body.graphDefinitionHash) throw new Error('The exact prepared body did not acknowledge command submission.');
        gates.set(key, { execution, bodyInstanceId: body.bodyInstanceId });
        return { status: 'accepted', stage: 'prepared-body-source-api-submitted', bodyStrike: { ...plan.source, targetFrame: frame, endFrame: plan.endFrame, token, acousticReceipt: false } };
      } catch (error) {
        // Admission failures precede delivery; other exceptions retain possible children.
        if (['invalid-body-strike', 'body-strike-capacity', 'body-strike-quarantined', 'stale-prepared-body'].includes(error.code)) pending.delete(token);
        else { try { panicBody(body.nodeId, expected(body)); } catch {} report({ status: 'rejected', stage: 'effect-performance-capture', reason: 'body-source-submission-unknown', acousticReceipt: false }); }
        return { status: 'rejected', reason: error.code || error.message };
      }
    },
    update(voiceId, expression, frame, execution) { return valid(execution) && gates.has(gateKey(voiceId, execution)) ? { status: 'accepted', stage: 'finite-body-semantic-observation', outputRequested: false } : { status: 'rejected', reason: 'body-source-unavailable' }; },
    updatePhysical(voiceId, cause, frame, execution) { return this.update(voiceId, {}, frame, execution); },
    end(voiceId, release, frame, execution) { return valid(execution) && gates.delete(gateKey(voiceId, execution)) ? { status: 'accepted', stage: 'finite-body-semantic-end;exciter-and-shared-tail-owned', outputRequested: false } : { status: 'rejected', reason: 'body-source-unavailable' }; },
    cancelGeneration(generation, execution) {
      if (executions.has(execution) && execution.generation === generation) { const seen = new Set(); for (const record of pending.values()) if (record.execution === execution && !seen.has(record.body.bodyInstanceId)) { seen.add(record.body.bodyInstanceId); panicBody(record.body.nodeId, expected(record.body)); } }
      return retireExecution(execution);
    },
    retireExecution,
    diagnostics: () => ({ pendingExciters: pending.size, semanticGates: gates.size, executions: executions.size, finiteSupport: '4/8/12ms;no-sustained-source-lease', pitchPolicy: 'fixed-prepared-body', releasePolicy: 'semantic-end-does-not-erase-another-actors-shared-energy', reservation: storage.receipt() }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; const receipts = [...executions].map(retireExecution); return retirement.retire([{ name: 'finite-source-producer-retirement', run: async () => { await Promise.all(receipts.map(receipt => receipt.completion)); if (pending.size || receipts.some(receipt => receipt.outcome !== 'complete')) throw new Error('Finite body sources retain unresolved producer ownership.'); if (timer != null) clearTimeout(timer); timer = null; unsubscribe(); gates.clear(); storage.release(); } }]); }
  });
}
