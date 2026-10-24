import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const PREFIX = '@owned-execution:';
let backendSequence = 0;

export const isManagedExecutionEpoch = epoch => typeof epoch === 'string' && epoch.startsWith(PREFIX);

// Opaque handles retain their own invalid state weakly. Only live/retiring
// executions occupy the bounded registry; numeric identities are never reused.
export function createInstrumentExecutionLifecycle(backend, { isSettled, isVoiceSettled = null, forget, getContext, getGeneration, capacity = 64 }) {
  const handles = new WeakMap(), live = new Map();
  const backendId = ++backendSequence;
  const retirement = createProcgenRetirementScope();
  let serial = 0, disposed = false, peak = 0, retired = 0, incarnation = 0;
  let context = getContext(), generation = getGeneration();
  const rejected = reason => Object.freeze({ status: 'rejected', stage: 'none', reason });
  const collect = () => {
    for (const [epoch, entry] of live) if (entry.state === 'retiring' && isSettled(epoch)) {
      forget(epoch, entry.handle.generation); live.delete(epoch); entry.state = 'retired'; retired++;
    }
  };
  const close = entry => {
    if (entry.state !== 'active') return;
    entry.state = 'retiring';
    backend.cancelGenerationWithReceipt(entry.handle.generation, entry.epoch);
  };
  const invalidate = () => {
    incarnation++;
    return createProcgenRetirementScope().retire([...live.values()].map(entry => ({ name: `execution-${entry.epoch}`, run: () => close(entry) }))
      .concat({ name: 'settled-identities', run: collect }));
  };
  const sync = () => {
    const nextContext = getContext(), nextGeneration = getGeneration();
    if (context !== nextContext || generation !== nextGeneration) {
      context = nextContext; generation = nextGeneration; invalidate();
    }
    collect();
  };
  const registerExecution = ({ executionEpoch, generation: executionGeneration } = {}) => {
    sync();
    if (disposed) return rejected('disposed');
    if (typeof executionEpoch !== 'string' || !executionEpoch || executionEpoch.length > 256 ||
        !Number.isSafeInteger(executionGeneration) || executionGeneration < 0) return rejected('invalid-execution-registration');
    if (live.size >= capacity) return rejected('execution-identity-capacity');
    if (serial === Number.MAX_SAFE_INTEGER) return rejected('execution-identity-exhausted');
    const handle = Object.freeze({ version: 1, executionEpoch, generation: executionGeneration });
    const entry = { handle, epoch: `${PREFIX}${backendId}:${++serial}`, state: 'active' };
    handles.set(handle, entry); live.set(entry.epoch, entry); peak = Math.max(peak, live.size);
    return Object.freeze({ status: 'accepted', execution: handle });
  };
  const resolve = (execution, expectedGeneration) => {
    sync();
    if (disposed) return { error: 'disposed' };
    if (typeof execution === 'string') return isManagedExecutionEpoch(execution) ? { error: 'execution-handle-required' } : { epoch: execution };
    const entry = execution && typeof execution === 'object' ? handles.get(execution) : null;
    if (!entry) return { error: 'invalid-execution-handle' };
    if (entry.state !== 'active') return { error: 'execution-retired' };
    if (expectedGeneration != null && expectedGeneration !== entry.handle.generation) return { error: 'execution-generation-mismatch' };
    return { epoch: entry.epoch, entry };
  };
  const call = (name, args, index, expectedGeneration) => {
    const execution = args[index] ?? 'live', result = resolve(execution, expectedGeneration);
    if (result.error) return rejected(result.error);
    args[index] = result.epoch;
    const receipt = backend[name](...args);
    return result.entry && receipt ? Object.freeze({ ...receipt, executionEpoch: execution.executionEpoch }) : receipt;
  };
  const retireExecution = execution => {
    sync();
    const entry = execution && typeof execution === 'object' ? handles.get(execution) : null;
    if (!entry) return rejected('invalid-execution-handle');
    close(entry); collect();
    return Object.freeze({ status: 'accepted', state: entry.state, executionEpoch: execution.executionEpoch });
  };
  const cancelGenerationWithReceipt = (executionGeneration, execution = 'live') => {
    if (typeof execution === 'string') return call('cancelGenerationWithReceipt', [executionGeneration, execution], 1, executionGeneration);
    sync();
    const entry = execution && typeof execution === 'object' ? handles.get(execution) : null;
    if (!entry || executionGeneration !== entry.handle.generation) return rejected('invalid-execution-handle');
    if (entry.state !== 'active') return Object.freeze({ status: 'accepted', count: 0, state: entry.state, reason: 'already-retired' });
    entry.state = 'retiring';
    const receipt = backend.cancelGenerationWithReceipt(executionGeneration, entry.epoch); collect();
    return Object.freeze({ ...receipt, executionEpoch: execution.executionEpoch, state: entry.state });
  };
  const diagnostics = () => {
    sync(); let active = 0;
    for (const entry of live.values()) if (entry.state === 'active') active++;
    return Object.freeze({ capacity, active, retiring: live.size - active, peak, retired, incarnation,
      recovery: live.size >= capacity ? 'retire-executions-and-await-settlement' : null });
  };
  const api = Object.freeze({ ...backend, registerExecution, retireExecution,
    inspectExecution(execution, voiceId = null) {
      sync(); const entry = execution && typeof execution === 'object' ? handles.get(execution) : null;
      if (!entry || voiceId != null && (typeof voiceId !== 'string' || !voiceId || voiceId.length > 512)) return rejected('invalid-execution-handle');
      return Object.freeze({ status: 'accepted', state: entry.state, settled: isSettled(entry.epoch),
        voiceSettled: voiceId == null ? null : isVoiceSettled ? isVoiceSettled(voiceId, entry.epoch) : isSettled(entry.epoch) });
    },
    executionIncarnation: () => { sync(); return incarnation; },
    begin: (...args) => call('begin', args, 2, args[0]?.generation),
    update: (...args) => call('update', args, 3), end: (...args) => call('end', args, 3),
    renewExecutionLease: (...args) => call('renewExecutionLease', args, 1, args[0]),
    cancelGenerationWithReceipt, cancelGeneration: (...args) => cancelGenerationWithReceipt(...args).count || 0,
    renderDiagnostics: options => Object.freeze({ ...backend.renderDiagnostics(options), executions: diagnostics() }),
    onOwnerStop: () => createProcgenRetirementScope().retire([
      { name: 'execution-fence', run: invalidate }, { name: 'backend-stop', run: () => backend.onOwnerStop?.() }, { name: 'settled-identities', run: collect }
    ]),
    dispose: () => retirement.retire([
      { name: 'admission', run: () => { disposed = true; } }, { name: 'execution-fence', run: invalidate },
      { name: 'backend', run: () => backend.dispose() }, { name: 'settled-identities', run: collect }
    ])
  });
  return { api, invalidate, collect };
}
