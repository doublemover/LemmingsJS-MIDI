import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const failure = message => Object.assign(new Error(message), { name: 'AuditionOwnershipError' });
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const wait = (work, signal) => new Promise((resolve, reject) => {
  const abort = () => reject(signal.reason || failure('Prelisten preparation canceled.'));
  signal.addEventListener('abort', abort, { once: true });
  Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)); if (signal.aborted) abort();
});

export function createForegroundAuditionOwner({ onChange = () => {} } = {}) {
  const records = new Set(), retirement = createProcgenRetirementScope();
  let current = null, last = null, serial = 0, disposed = false, ownershipFault = false;
  const snapshot = record => record ? Object.freeze({ schema: 'lemmings-audition-lease/v1', leaseId: record.id, generation: record.id,
    source: record.source, routeRevision: record.routeRevision, state: record.phase, stopFrontier: record.stopFrontier,
    canRevealSource: typeof record.onReveal === 'function',
    retirement: record.receipt ? Object.freeze({ state: record.receipt.state, outcome: record.receipt.outcome }) : null }) : null;
  const state = () => Object.freeze({ foreground: snapshot(current) || last, active: !!current, acceptedSources: records.size,
    maxSources: 2, unresolvedOwnership: ownershipFault, disposed });
  const report = () => { try { onChange(state()); } catch { /* Source tools cannot own the shared monitor view. */ } };
  const close = (record, receipt) => {
    if (record.closed) return record.done;
    record.closed = true; record.receipt = receipt;
    record.phase = receipt?.state === 'retired' && receipt.outcome === 'complete' ? 'stopped' : 'failed';
    if (record.phase === 'failed') ownershipFault = true; else records.delete(record);
    record.externalSignal?.removeEventListener('abort', record.onExternalAbort);
    if (current === record) { last = snapshot(record); current = null; }
    record.resolve(snapshot(record)); report(); return record.done;
  };
  const stopRecord = (record, reason) => {
    if (!record || record.closed || record.stopping) return record?.done || Promise.resolve(null);
    record.stopping = true; record.phase = 'stopping'; record.stopFrontier = reason;
    record.controller.abort(failure(reason));
    try {
      const requested = record.onStop?.(reason);
      if (requested && typeof requested.then === 'function') { Promise.resolve(requested).catch(() => {}); ownershipFault = true; }
    } catch { ownershipFault = true; }
    report(); return record.done;
  };
  const acquire = async ({ source, routeRevision, signal, onStop, onReveal } = {}) => {
    signal?.throwIfAborted();
    if (disposed || ownershipFault || !source || !['name', 'kind', 'revision', 'sourceRef'].every(key => text(source[key])) ||
        Object.keys(source).some(key => !['name', 'kind', 'revision', 'sourceRef'].includes(key)) ||
        !Number.isSafeInteger(routeRevision) || routeRevision < 0 || typeof onStop !== 'function') throw failure('Invalid or unavailable foreground prelisten source.');
    if (records.size >= 2) throw failure('Previous prelisten source still owns its preparation or stop frontier.');
    const prior = [...records].filter(record => !record.closed), previous = current;
    const record = { id: ++serial, source: Object.freeze({ ...source }), routeRevision, phase: 'preparing', onStop, onReveal,
      stopFrontier: null, controller: new AbortController(), externalSignal: signal, onExternalAbort: null, closed: false, stopping: false, issued: false,
      done: null, resolve: null, receipt: null };
    record.done = new Promise(resolve => { record.resolve = resolve; }); records.add(record); current = record;
    record.onExternalAbort = () => stopRecord(record, 'source-operation-canceled');
    signal?.addEventListener('abort', record.onExternalAbort, { once: true }); if (signal?.aborted) record.onExternalAbort();
    if (previous) void stopRecord(previous, 'foreground-source-handoff'); report();
    try {
      await wait(Promise.all(prior.map(value => value.done)), record.controller.signal);
      record.controller.signal.throwIfAborted();
      if (disposed || current !== record || ownershipFault) throw failure('Prelisten handoff could not retire the previous source.');
      record.issued = true;
      const check = () => { record.controller.signal.throwIfAborted(); if (record.closed || disposed || current !== record) throw failure('Prelisten lease belongs to a retired source.'); };
      return Object.freeze({ signal: record.controller.signal, snapshot: () => snapshot(record), isCurrent: () => !record.closed && !disposed && current === record && !record.controller.signal.aborted,
        markReady() { check(); if (record.phase !== 'preparing') throw failure('Prelisten preparation is already settled.'); record.phase = 'ready'; report(); },
        markPlaying() { check(); if (record.phase !== 'ready') throw failure('Prelisten source is not ready.'); record.phase = 'playing'; report(); },
        close: receipt => close(record, receipt) });
    } catch (error) {
      if (!record.issued) close(record, createProcgenRetirementScope().retire());
      throw error;
    }
  };
  return Object.freeze({ acquire, state, revealSource: () => current?.onReveal?.(), stop: (reason = 'performer-stopped-prelisten') => stopRecord(current, reason),
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true;
      return retirement.retire([...records].map(record => ({ name: 'audition-source-' + record.id,
        run: async () => { await stopRecord(record, 'monitor-owner-retired'); if (record.receipt?.outcome !== 'complete') throw failure('Audition source retirement is unresolved.'); } }))
        .concat([{ name: 'retained-ownership-fault', run: () => { if (ownershipFault) throw failure('Prelisten cancellation or retirement remains unresolved.'); } }]));
    }
  });
}
