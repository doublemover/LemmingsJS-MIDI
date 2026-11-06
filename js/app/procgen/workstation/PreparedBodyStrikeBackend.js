import { cloneData } from '../../../core/CanonicalData.js';
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
      sinkId, targetTimeDomain: 'audio-sample-frames', bodyInstanceId: record.body.bodyInstanceId, executionEpoch: record.execution.executionEpoch, sampleRate: record.body.sampleRate,
      ...(receipt.stage === 'body-strike-ended' && receipt.reasonCode === 3 ? { terminal: Object.freeze({ state: 'cancelled', reason: 'body-strike-panic' }), reason: 'body-strike-panic' } : {}) });
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
    snapshot({ audioFrame, sampleRate }) {
      settle();
      if (disposed || !Number.isSafeInteger(audioFrame) || audioFrame < 0 || ![44100, 48000, 96000].includes(sampleRate)) throw new Error('Finite sources require a current shared audio frontier.');
      return cloneData({ schema: 'lemmings-finite-body-source-cut/v1', audioFrame, sampleRate, sequence,
        executions: [...executions].map(execution => ({ executionEpoch: execution.executionEpoch, generation: execution.generation, closed: execution.closed })),
        pending: [...pending].filter(([, record]) => record.end > audioFrame).map(([token, record]) => ({ token, body: record.body, plan: record.plan, batchId: record.batchId, start: record.start, end: record.end, renderCost: record.renderCost,
          executionEpoch: record.execution.executionEpoch, generation: record.execution.generation })),
        gates: [...gates].map(([key, gate]) => ({ key, bodyInstanceId: gate.bodyInstanceId, executionEpoch: gate.execution.executionEpoch, generation: gate.execution.generation }))
      }, { maxBytes: 2 * 1048576, maxNodes: 131072 });
    },
    restore(raw, { bodyInstances, executionBindings, audioFrame, sampleRate, isCurrent = () => true } = {}) {
      if (disposed || pending.size || gates.size || sequence || !Array.isArray(bodyInstances) || !Array.isArray(executionBindings)) throw new Error('Restore finite sources only into fresh prepared execution owners.');
      const state = cloneData(raw, { maxBytes: 2 * 1048576, maxNodes: 131072 }), natural = value => Number.isSafeInteger(value) && value >= 0, text = value => typeof value === 'string' && value.length > 0 && value.length <= 2048;
      if (state.schema !== 'lemmings-finite-body-source-cut/v1' || !natural(state.audioFrame) || !natural(audioFrame) || state.sampleRate !== sampleRate ||
          ![44100, 48000, 96000].includes(sampleRate) || !natural(state.sequence) || !Array.isArray(state.executions) || state.executions.length > 16 ||
          !Array.isArray(state.pending) || state.pending.length > 544 || !Array.isArray(state.gates) || state.gates.length > 512 ||
          executionBindings.length !== state.executions.length || executions.size !== state.executions.length) throw new Error('Invalid finite-source continuation inventory.');
      const byOld = new Map(), newEpochs = new Set(), replacementBodies = new Map(bodyInstances.map(body => [body.fromBodyInstanceId, body])), targets = inventory(), nextPending = new Map(), nextGates = new Map();
      for (const saved of state.executions) {
        const binding = executionBindings.find(binding => binding.fromExecutionEpoch === saved.executionEpoch), execution = binding?.execution;
        if (!text(saved.executionEpoch) || !natural(saved.generation) || typeof saved.closed !== 'boolean' || !execution || !valid(execution) || execution.generation !== saved.generation ||
            execution.executionEpoch === saved.executionEpoch || newEpochs.has(execution.executionEpoch) || byOld.has(saved.executionEpoch)) throw new Error('Every finite-source epoch needs a distinct current opaque execution binding.');
        byOld.set(saved.executionEpoch, execution); newEpochs.add(execution.executionEpoch);
      }
      const shift = audioFrame - state.audioFrame;
      for (const saved of state.pending) {
        const execution = byOld.get(saved.executionEpoch), identity = replacementBodies.get(saved.body?.bodyInstanceId), target = identity && targets.find(target => targetKey(target) === targetKey(identity));
        const plan = saved.plan, command = plan?.command, source = plan?.source, pulse = target?.pulses?.[command?.pulseIndex], start = saved.start + shift, end = saved.end + shift;
        if (!execution || execution.generation !== saved.generation || !identity || !target || target.quarantined || !target.pendingStrikeTokens?.includes(saved.token) ||
            !natural(saved.token) || saved.token < 1 || saved.token > state.sequence || nextPending.has(saved.token) || !command || command.token !== saved.token || command.frame !== saved.start ||
            !pulse || !Number.isInteger(command.pulseIndex) || ![command.x01, command.y01, command.amplitude01].every(value => Number.isFinite(value) && value >= 0 && value <= 1) ||
            !natural(saved.start) || saved.end !== saved.start + pulse.frames || saved.end !== plan.endFrame || saved.end <= state.audioFrame || !natural(start) || !natural(end) ||
            !source || source.bodyInstanceId !== saved.body.bodyInstanceId || source.generation !== saved.generation || source.worldId !== identity.worldId || source.generation !== identity.generation ||
            source.surfaceId !== identity.surfaceId || source.surfaceRevision !== identity.surfaceRevision || source.mapId !== identity.surfaceMap.id || source.mapRevision !== identity.surfaceMap.revision ||
            !natural(source.actorId) || ['intentId', 'voiceId', 'onsetId', 'contactInstanceId'].some(key => !text(source[key])) || source.pitchPolicy !== 'fixed-prepared-body' ||
            !Array.isArray(source.sourceEventIds) || !source.sourceEventIds.length || source.sourceEventIds.length > 16 || source.sourceEventIds.some(id => !text(id)) || !text(saved.batchId) || saved.renderCost !== 1) throw new Error('A continuing finite exciter differs from its staged body, source identity or exact remaining pulse.');
        const body = Object.freeze({ ...identity, pulses: target.pulses, sampleRate, pendingStrikeTokens: target.pendingStrikeTokens, strikeTokenFloor: target.strikeTokenFloor || 0 });
        nextPending.set(saved.token, { body, plan: cloneData({ command: { ...command, frame: start }, endFrame: end, source: { ...source, bodyInstanceId: identity.bodyInstanceId } }),
          execution, batchId: saved.batchId, start, end, renderCost: 1 });
      }
      for (const saved of state.gates) {
        const execution = byOld.get(saved.executionEpoch); let key; try { key = JSON.parse(saved.key); } catch { throw new Error('Invalid finite-source semantic gate.'); }
        if (!execution || execution.generation !== saved.generation || !Array.isArray(key) || key.length !== 3 || key[0] !== saved.executionEpoch || key[1] !== saved.generation || !text(key[2]) || !/^[a-f0-9]{64}$/.test(saved.bodyInstanceId)) throw new Error('Invalid continued finite-source semantic gate.');
        const mappedKey = gateKey(key[2], execution);
        if (nextGates.has(mappedKey)) throw new Error('Aliased finite-source semantic gate.');
        nextGates.set(mappedKey, { execution, bodyInstanceId: replacementBodies.get(saved.bodyInstanceId)?.bodyInstanceId || saved.bodyInstanceId });
      }
      if (!isCurrent() || disposed) throw new Error('Finite source restoration was superseded.');
      storage.resize(nextPending.size ? 12 * 1048576 : 32768);
      for (const [token, record] of nextPending) pending.set(token, record);
      for (const [key, gate] of nextGates) gates.set(key, gate);
      sequence = state.sequence;
      for (const saved of state.executions) byOld.get(saved.executionEpoch).closed = saved.closed;
      settle();
      return Object.freeze({ pendingExciters: pending.size, semanticGates: gates.size, commandRetransmissions: 0, freshExecutions: byOld.size });
    },
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
        sequence = Math.max(sequence, body.strikeTokenFloor || 0);
        if (!Number.isSafeInteger(sequence + 1)) return { status: 'rejected', reason: 'finite-body-token-capacity' };
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
