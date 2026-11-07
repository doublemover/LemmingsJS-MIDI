import { getBrowserPerformanceLease } from '../../midi-ui/BrowserPerformanceLease.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

let ordinal = 0;
export function createProcgenMidiPerformance({ transport, resourceBudget = null,
  coordinator = getBrowserPerformanceLease({ resourceBudget }), createOutputAdmission = () => null,
  releaseOutputs = () => {}, hasOutputs = () => false, canActivate = () => true, onState = () => {} } = {}) {
  if (!coordinator) return null;
  const scope = 'workstation-midi-' + ++ordinal, bindings = new Set();
  const metadata = createOwnedResourceReservation({ budget: resourceBudget, owner: scope, category: 'audio', kind: 'midi-performance-bindings', bytes: 65536 });
  let token = null, claim = null, controller = null, release = null, retirement = null, stopOwner = null, disposal = null, disposed = false;
  let clockPort = null, clockArmed = false, clockAttached = false, clockPreparing = false, clockRevision = 0, clockWork = null;
  const source = coordinator.register({ scope, role: 'live', stop: (reason, prior) => prior || stop(reason, true) });
  const current = owned => !!owned && source.isCurrent(owned);
  const cleanup = owned => !!owned && (source.isCurrent(owned) || source.canRelease(owned));
  const ensure = () => {
    if (disposed || retirement && retirement.outcome !== 'complete') return Promise.resolve(null);
    if (current(token)) return Promise.resolve(token);
    if (claim) return claim;
    const pendingController = new AbortController(); controller = pendingController;
    const pending = (async () => {
      if (release && !await release || disposed || pendingController.signal.aborted) return null;
      const owned = await source.acquire({ signal: pendingController.signal });
      if (!owned || disposed || pendingController.signal.aborted) return null;
      token = owned; retirement = null; stopOwner = null;
      for (const binding of bindings) if (binding.pending === pendingController && !binding.closed) binding.token = owned;
      return owned;
    })();
    claim = pending;
    pending.finally(() => { if (claim === pending) { claim = null; controller = null; } onState(); });
    return pending;
  };
  function stop(reason = 'output-stopped', stopInput = false) {
    if (stopOwner) return stopOwner.getReceipt();
    stopOwner = createProcgenRetirementScope();
    clockRevision++; clockPreparing = false; clockArmed = false; controller?.abort();
    for (const binding of bindings) binding.alive = false;
    retirement = stopOwner.retire([
      { name: 'clock-submission-frontier', run: () => {
        if (clockAttached) { clockAttached = false; return transport?.retireClockOutput?.(); }
        if (stopInput) transport?.pause();
      } },
      { name: 'owned-midi-output', run: () => releaseOutputs(reason, stopInput) }
    ]);
    return retirement;
  }
  const releaseStopped = receipt => {
    if (release) return release;
    const work = source.release({ receipt }); release = work;
    work.then(complete => { if (complete) { token = null; for (const binding of bindings) binding.closed = true; bindings.clear(); retirement = null; stopOwner = null; } }, () => {}).finally(() => { if (release === work) release = null; onState(); });
    return work;
  };
  const releaseIdle = () => {
    if (disposed || stopOwner || hasOutputs() || clockArmed || clockPreparing || release || !token && !claim) return;
    releaseStopped(stop('outputs-disabled'));
  };
  return Object.freeze({
    bind() {
      if (disposed || release || bindings.size >= 128) return null;
      const parent = createOutputAdmission();
      if (typeof parent !== 'function' || !parent(false)) return null;
      const binding = { alive: true, closed: false, token, pending: null };
      bindings.add(binding); void ensure(); binding.pending = controller;
      return Object.freeze({
        check: releasing => !binding.closed && (releasing ? cleanup(binding.token) || parent(true) === true : binding.alive && parent(false) === true),
        isCurrent: () => binding.alive && parent(false) === true,
        retire() { binding.alive = false; },
        finish() { binding.closed = true; bindings.delete(binding); }
      });
    },
    outputsChanged: releaseIdle,
    selectClock(port, { arm = false } = {}) {
      if (disposed || clockPort === port && !arm) return clockWork || Promise.resolve(clockArmed);
      clockPort = port || null; const revision = ++clockRevision;
      clockPreparing = !!port && arm && canActivate(); clockArmed = false;
      const previous = clockAttached ? transport?.retireClockOutput?.() : null; clockAttached = false;
      clockWork = (async () => {
        if (previous) { await previous.completion; if (previous.outcome !== 'complete') return false; }
        if (!clockPreparing || disposed || revision !== clockRevision) return false;
        const owned = await ensure();
        if (!owned || disposed || revision !== clockRevision || !canActivate() || !current(owned)) return false;
        const admission = releasing => releasing ? cleanup(owned) : current(owned);
        transport?.setClockOutputAdmission?.(admission);
        if (transport?.setClockOutput(port, { preserveExternal: true }) === false) return false;
        clockAttached = true;
        clockArmed = true; return true;
      })().finally(() => { if (revision === clockRevision) { clockPreparing = false; releaseIdle(); onState(); } });
      return clockWork;
    },
    state: () => Object.freeze({ clockArmed, clockPreparing, performanceLease: coordinator.state(), retirement }),
    setDocumentIdentity: value => source.setDocumentIdentity(value),
    stop(reason, stopInput = true) { const receipt = stop(reason, stopInput); void releaseStopped(receipt); return receipt; },
    dispose() {
      if (disposed) return disposal;
      disposed = true; const receipt = stop('disposed', true);
      disposal = createProcgenRetirementScope().retire([
        { name: 'owned-midi', run: () => receipt },
        { name: 'performance-registration', run: async () => { if (!await source.dispose({ receipt })) throw new Error('MIDI performance retirement remains unresolved.'); metadata.release(); bindings.clear(); } }
      ]); return disposal;
    }
  });
}
