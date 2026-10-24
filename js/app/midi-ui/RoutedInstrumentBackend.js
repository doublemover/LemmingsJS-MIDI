import { createInstrumentExecutionLifecycle } from './InstrumentExecutionLifecycle.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const reject = reason => Object.freeze({ status: 'rejected', reason, stage: 'none' });
const keyFor = (epoch, voiceId) => JSON.stringify([epoch, voiceId]);
const validLane = lane => typeof lane === 'string' && lane.length > 0 && lane.length <= 160;

export function createRoutedInstrumentBackend({ defaultBackend, getContext, getGeneration, resolveLane = value => String(value), maxChildren = 17, maxVoices = 512 } = {}) {
  if (!defaultBackend?.registerExecution || !defaultBackend?.inspectExecution || typeof getContext !== 'function' || typeof getGeneration !== 'function' || typeof resolveLane !== 'function' ||
      !Number.isInteger(maxChildren) || maxChildren < 2 || maxChildren > 65 || !Number.isInteger(maxVoices) || maxVoices < 1 || maxVoices > 2048) throw new TypeError('Invalid routed instrument owner.');
  const defaults = { key: 'default', backend: defaultBackend, retirement: null }, children = new Map([['default', defaults]]), assignments = new Map(), executions = new Map(), voices = new Map();
  const retirement = createProcgenRetirementScope(); let disposed = false, voiceCursor = voices.entries(), collected = 0;
  const stateFor = (child, execution, voiceId = null) => {
    try { const result = child.backend.inspectExecution(execution, voiceId); return result?.status === 'accepted' ? result : null; } catch { return null; }
  };
  const collectVoices = (limit = 16) => {
    for (let index = 0; index < limit && voices.size; index++) {
      let item = voiceCursor.next(); if (item.done) { voiceCursor = voices.entries(); item = voiceCursor.next(); if (item.done) break; }
      const [key, voice] = item.value;
      if (stateFor(voice.child, voice.execution, voice.voiceId)?.voiceSettled === true) { voices.delete(key); collected++; }
    }
  };
  const childSettled = child => {
    for (const execution of executions.values()) {
      const handle = execution.children.get(child);
      if (handle && stateFor(child, handle)?.settled !== true) return false;
    }
    return true;
  };
  const retireChild = child => {
    if (child.retirement) return child.retirement;
    const handles = [...executions.values()].filter(execution => execution.children.has(child));
    child.retirement = createProcgenRetirementScope().retire([
      ...handles.map((execution, index) => ({ name: 'execution-' + index, run: () => child.backend.retireExecution(execution.children.get(child)) })),
      { name: 'renderer', run: () => child.backend.dispose() }
    ]);
    const acknowledge = receipt => { if (receipt.outcome === 'complete') { children.delete(child.key); for (const execution of handles) execution.children.delete(child); } };
    acknowledge(child.retirement); if (child.retirement.state !== 'retired') child.retirement.completion.then(acknowledge);
    return child.retirement;
  };
  const collect = () => {
    collectVoices(); const assigned = new Set(assignments.values());
    for (const child of children.values()) if (child !== defaults && !child.pins && !assigned.has(child) && !child.retirement && childSettled(child)) retireChild(child);
  };
  const executionFor = (child, epoch, generation) => {
    let execution = executions.get(epoch);
    if (!execution) { if (executions.size >= 64) return null; execution = { generation, children: new Map(), leaseUntil: null }; executions.set(epoch, execution); }
    if (execution.generation !== generation || child.retirement) return null;
    if (!execution.children.has(child)) {
      const registered = child.backend.registerExecution({ executionEpoch: epoch, generation }); if (registered?.status !== 'accepted') return null;
      execution.children.set(child, registered.execution);
      if (execution.leaseUntil != null && child.backend.renewExecutionLease(generation, registered.execution, execution.leaseUntil)?.status !== 'accepted') return null;
    }
    return execution.children.get(child);
  };
  const begin = (intent, targetFrame, epoch) => {
    if (disposed) return reject('disposed'); collectVoices();
    if (voices.size >= maxVoices) collectVoices(voices.size);
    if (voices.size >= maxVoices || voices.has(keyFor(epoch, intent?.voiceId))) return reject('routed-voice-capacity-or-duplicate');
    let lane; try { lane = resolveLane(intent.laneId); } catch { return reject('lane-unavailable'); }
    const child = assignments.get(lane) || defaults; if (child.blocked) return reject(child.reason);
    const execution = executionFor(child, epoch, intent.generation); if (!execution) return reject('renderer-execution-unavailable');
    const outcome = child.backend.begin(intent, targetFrame, execution);
    if (outcome?.status === 'accepted') voices.set(keyFor(epoch, intent.voiceId), { child, execution, epoch, voiceId: intent.voiceId });
    return outcome;
  };
  const voiceCall = (method, voiceId, value, frame, epoch) => {
    if (disposed) return reject('disposed'); const voice = voices.get(keyFor(epoch, voiceId));
    if (!voice) return reject('voice-unavailable'); return voice.child.backend[method](voiceId, value, frame, voice.execution);
  };
  const cancelGenerationWithReceipt = (generation, epoch) => {
    const execution = executions.get(epoch), outcomes = [];
    const receipt = createProcgenRetirementScope().retire(execution && execution.generation === generation ? [...execution.children].map(([child, handle]) => ({ name: child.key, run: () => {
      const outcome = child.backend.cancelGenerationWithReceipt(generation, handle); outcomes.push(outcome);
      return outcome?.retirement?.schema === 'lemmings-retirement/v1' ? outcome.retirement : outcome;
    } })) : []);
    return Object.freeze({ status: receipt.outcome === 'partial' ? 'degraded' : 'accepted', count: outcomes.reduce((sum, outcome) => sum + (outcome?.count || 0), 0), retirement: receipt });
  };
  const renewExecutionLease = (generation, epoch, until) => {
    if (disposed || !Number.isSafeInteger(until) || until < 0) return reject('invalid-execution-lease');
    let execution = executions.get(epoch); if (!execution) { if (executions.size >= 64) return reject('execution-identity-capacity'); execution = { generation, children: new Map(), leaseUntil: null }; executions.set(epoch, execution); }
    if (execution.generation !== generation || execution.leaseUntil != null && until <= execution.leaseUntil) return reject('stale-execution-lease');
    const outcomes = [...execution.children].map(([child, handle]) => child.backend.renewExecutionLease(generation, handle, until));
    if (outcomes.some(outcome => outcome?.status !== 'accepted')) return reject('renderer-lease-rejected'); execution.leaseUntil = until; return Object.freeze({ status: 'accepted' });
  };
  const backend = { begin, update: (...args) => voiceCall('update', ...args), end: (...args) => voiceCall('end', ...args), renewExecutionLease,
    cancelGenerationWithReceipt, cancelGeneration: (...args) => cancelGenerationWithReceipt(...args).count,
    capabilities: Object.freeze({ routedInstruments: true, independentSamePitch: true, renderAcknowledgment: false }),
    renderDiagnostics: () => { collect(); return Object.freeze({ children: children.size, assignments: assignments.size, retainedVoices: voices.size,
      collectedVoices: collected, unknownRetirement: [...children.values()].filter(child => child.retirement?.outcome === 'partial').length,
      renderers: Object.freeze([...children.values()].map(child => Object.freeze({ key: child.key, retirement: child.retirement?.outcome || null,
        diagnostics: child.backend.renderDiagnostics() }))) }); },
    dispose: () => { disposed = true; return retirement.retire([...children.values()].map(child => ({ name: child.key, run: () => retireChild(child) }))); }
  };
  const lifecycle = createInstrumentExecutionLifecycle(backend, { getContext, getGeneration,
    isSettled: epoch => { const execution = executions.get(epoch); return !execution || [...execution.children].every(([child, handle]) => stateFor(child, handle)?.settled === true); },
    isVoiceSettled: (voiceId, epoch) => { const voice = voices.get(keyFor(epoch, voiceId)); return !voice || stateFor(voice.child, voice.execution, voiceId)?.voiceSettled === true; },
    forget: epoch => {
      const execution = executions.get(epoch);
      const receipt = createProcgenRetirementScope().retire(execution ? [...execution.children].map(([child, handle]) => ({ name: child.key, run: () => {
        const result = child.backend.retireExecution(handle);
        if (result?.status !== 'accepted') throw new Error('Child execution retirement was not accepted.'); return result.retirement;
      } })) : []);
      if (receipt.outcome !== 'complete') throw Object.assign(new Error('Routed execution retirement is incomplete.'), { retirement: receipt });
      executions.delete(epoch); for (const [key, voice] of voices) if (voice.epoch === epoch) voices.delete(key); collect();
    }
  });
  return Object.freeze({ backend: lifecycle.api,
    canAssign(key) { collect(); const child = children.get(key); return !disposed && (child ? !child.retirement : children.size < maxChildren); },
    assign(lane, key, renderer) {
      if (!validLane(lane) || typeof key !== 'string' || !key || key.length > 256 || key === 'default' || disposed || !renderer?.inspectExecution) throw new TypeError('Invalid lane instrument assignment.');
      collect(); if (!assignments.has(lane) && assignments.size >= 64) throw new Error('Routed lane capacity exceeded.'); let child = children.get(key);
      if (child && (child.backend !== renderer || child.retirement) || !child && children.size >= maxChildren) throw new Error('Lane instrument replacement exceeds retained renderer capacity.');
      if (!child) { child = { key, backend: renderer, retirement: null, pins: 0 }; children.set(key, child); } assignments.set(lane, child);
    },
    find: key => children.get(key)?.retirement ? null : children.get(key)?.backend || null,
    retain(key) { const child = children.get(key); if (!child || child.retirement || disposed) return null; child.pins = (child.pins || 0) + 1; let released = false;
      return Object.freeze({ backend: child.backend, release() { if (!released) { released = true; child.pins--; collect(); } } }); },
    assignment: lane => assignments.get(lane)?.key || null,
    unassign(lane) { assignments.delete(lane); collect(); },
    block(lane, reason) { if (!validLane(lane) || typeof reason !== 'string' || !reason || reason.length > 128 || disposed || !assignments.has(lane) && assignments.size >= 64) throw new TypeError('Invalid lane requirement failure.'); assignments.set(lane, { blocked: true, reason }); collect(); },
    collect, dispose: lifecycle.api.dispose
  });
}
