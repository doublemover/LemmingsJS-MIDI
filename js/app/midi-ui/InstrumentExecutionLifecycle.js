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
    for (const [epoch, entry] of live) if (entry.state === 'retiring' && (!entry.displayRetirement || entry.displayRetirement.getReceipt()?.outcome === 'complete') && isSettled(epoch)) {
      forget(epoch, entry.handle.generation); live.delete(epoch); entry.state = 'retired'; retired++;
    }
  };
  const close = entry => {
    if (entry.closeScope) return entry.closeScope.getReceipt();
    if (entry.state !== 'active') return entry.displayRetirement?.getReceipt();
    entry.state = 'retiring';
    entry.closeScope = createProcgenRetirementScope();
    return entry.closeScope.retire([
      { name: 'display-observers', run: () => retireDisplays(entry) },
      { name: 'generation', run: () => { const outcome = backend.cancelGenerationWithReceipt(entry.handle.generation, entry.epoch); return outcome?.retirement || outcome; } }
    ]);
  };
  const retireDisplays = entry => {
    entry.displayRetirement ||= createProcgenRetirementScope();
    return entry.displayRetirement.retire([...(entry.displays || [])].map((release, index) => ({ name: 'observer-' + index, run: release }))
      .concat([...(entry.commands || [])].map((release, index) => ({ name: 'command-observer-' + index, run: release }))));
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
    const retirement = close(entry); collect();
    return Object.freeze({ status: 'accepted', state: entry.state, executionEpoch: execution.executionEpoch, retirement });
  };
  const cancelGenerationWithReceipt = (executionGeneration, execution = 'live') => {
    if (typeof execution === 'string') return call('cancelGenerationWithReceipt', [executionGeneration, execution], 1, executionGeneration);
    sync();
    const entry = execution && typeof execution === 'object' ? handles.get(execution) : null;
    if (!entry || executionGeneration !== entry.handle.generation) return rejected('invalid-execution-handle');
    if (entry.state !== 'active') return Object.freeze({ status: 'accepted', count: 0, state: entry.state, reason: 'already-retired' });
    entry.state = 'retiring';
    let receipt;
    try { receipt = backend.cancelGenerationWithReceipt(executionGeneration, entry.epoch); } finally { retireDisplays(entry); }
    collect();
    return Object.freeze({ ...receipt, executionEpoch: execution.executionEpoch, state: entry.state });
  };
  const diagnostics = () => {
    sync(); let active = 0;
    for (const entry of live.values()) if (entry.state === 'active') active++;
    return Object.freeze({ capacity, active, retiring: live.size - active, peak, retired, incarnation,
      recovery: live.size >= capacity ? 'retire-executions-and-await-settlement' : null });
  };
  const api = Object.freeze({ ...backend, registerExecution, retireExecution,
    ...(typeof backend.observeCommandOutcomes === 'function' ? { observeCommandOutcomes(listener, { execution } = {}) {
      const resolved = resolve(execution);
      if (resolved.error || !resolved.entry || typeof listener !== 'function') throw new TypeError('Command observation requires the active owned execution handle.');
      const entry = resolved.entry, contextAtOpen = getContext(), generationAtOpen = getGeneration();
      if ((entry.commands?.size || 0) >= 8) throw new RangeError('Execution command observation capacity reached.');
      let active = true, attempted = false, releaseError = null;
      const stop = backend.observeCommandOutcomes(value => {
        if (active && entry.state === 'active' && getContext() === contextAtOpen && getGeneration() === generationAtOpen && value?.executionEpoch === entry.epoch)
          listener(Object.freeze({ ...value, executionEpoch: execution.executionEpoch }));
      });
      if (typeof stop !== 'function') throw new TypeError('Command observation did not return a retirement function.');
      const release = () => {
        if (attempted) { if (releaseError) throw releaseError; return; } attempted = true; active = false;
        try { const ack = stop(); if (ack === false || ack && typeof ack.then === 'function') {
          if (ack?.then) Promise.resolve(ack).catch(() => {}); throw new Error('Command observation retirement is unresolved.');
        } entry.commands.delete(release); } catch (error) { releaseError = error instanceof Error ? error : new Error('Command observation retirement failed.'); throw releaseError; }
      };
      (entry.commands ||= new Set()).add(release);
      if (entry.state !== 'active' || getContext() !== contextAtOpen || getGeneration() !== generationAtOpen) { release(); throw new Error('Command execution changed during observation setup.'); }
      return release;
    } } : {}),
    ...(typeof backend.observeDisplaySamples === 'function' ? { observeDisplaySamples(listener, options = {}) {
      const { execution, identity, ...selection } = options, resolved = resolve(execution);
      if (resolved.error || !resolved.entry || typeof listener !== 'function' || identity?.executionEpoch !== execution.executionEpoch || identity?.generation !== execution.generation)
        throw new TypeError('Display observation requires the active owned execution handle.');
      const entry = resolved.entry, contextAtOpen = getContext(), generationAtOpen = getGeneration();
      if ((entry.displays?.size || 0) >= 8) throw new RangeError('Execution display observation capacity reached.');
      let active = true, subscribed = false, releaseAttempted = false, releaseError = null;
      const releaseNative = backend.observeDisplaySamples(sample => {
        if (!active || !subscribed || entry.state !== 'active' || getContext() !== contextAtOpen || getGeneration() !== generationAtOpen ||
            sample?.executionEpoch !== entry.epoch || sample.generation !== execution.generation) return;
        listener(Object.freeze({ ...sample, executionEpoch: execution.executionEpoch }));
      }, { ...selection, identity: { ...identity, executionEpoch: entry.epoch } });
      if (typeof releaseNative !== 'function') throw new TypeError('Display source did not return an observation lease.');
      const release = () => {
        if (releaseAttempted) { if (releaseError) throw releaseError; return; } releaseAttempted = true; active = false;
        try {
          const ack = releaseNative();
          if (ack === false || ack && typeof ack.then === 'function') { if (ack?.then) Promise.resolve(ack).catch(() => {}); throw new Error('Display source retirement is unresolved.'); }
          entry.displays.delete(release);
        } catch (error) { releaseError = error; throw error; }
      };
      (entry.displays ||= new Set()).add(release); subscribed = true;
      if (entry.state !== 'active' || getContext() !== contextAtOpen || getGeneration() !== generationAtOpen) { release(); throw new Error('Display execution changed during observation setup.'); }
      return release;
    } } : {}),
    inspectExecution(execution, voiceId = null) {
      sync(); const entry = execution && typeof execution === 'object' ? handles.get(execution) : null;
      if (!entry || voiceId != null && (typeof voiceId !== 'string' || !voiceId || voiceId.length > 512)) return rejected('invalid-execution-handle');
      return Object.freeze({ status: 'accepted', state: entry.state, settled: isSettled(entry.epoch),
        voiceSettled: voiceId == null ? null : isVoiceSettled ? isVoiceSettled(voiceId, entry.epoch) : isSettled(entry.epoch) });
    },
    executionIncarnation: () => { sync(); return incarnation; },
    begin: (...args) => call('begin', args, 2, args[0]?.generation),
    update: (...args) => call('update', args, 3), end: (...args) => call('end', args, 3),
    ...(typeof backend.updateLaneMix === 'function' ? { updateLaneMix: (...args) => call('updateLaneMix', args, 3) } : {}),
    ...(typeof backend.transferVoiceLane === 'function' ? { transferVoiceLane: (...args) => call('transferVoiceLane', args, 3) } : {}),
    ...(typeof backend.updateCanonicalTravel === 'function' ? { updateCanonicalTravel: (...args) => call('updateCanonicalTravel', args, 3) } : {}),
    ...(typeof backend.updateSampleTravel === 'function' ? { updateSampleTravel: (...args) => call('updateSampleTravel', args, 3) } : {}),
    ...(typeof backend.updateSamplePosition === 'function' ? { updateSamplePosition: (...args) => call('updateSamplePosition', args, 3) } : {}),
    ...(typeof backend.updatePhysical === 'function' ? { updatePhysical: (...args) => call('updatePhysical', args, 3) } : {}),
    renewExecutionLease: (...args) => call('renewExecutionLease', args, 1, args[0]),
    cancelGenerationWithReceipt, cancelGeneration: (...args) => cancelGenerationWithReceipt(...args).count || 0,
    ...(typeof backend.inspectSourceState === 'function' ? { inspectSourceState: () => backend.inspectSourceState() } : {}),
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
