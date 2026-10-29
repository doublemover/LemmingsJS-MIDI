import { createSinkAdmissionRegistry } from './SinkAdmissionRegistry.js';

const fields = ['worldId', 'generation', 'batchId', 'intentId', 'onsetId', 'voiceId', 'eventId', 'sinkId', 'connectionEpoch', 'routeRevision', 'targetTime', 'timeDomain'];
const acknowledged = stage => stage === 'submitted' ? 'driver-submitted' : ['scheduled', 'driver-submitted', 'applied', 'receiver-observed'].includes(stage) ? stage : 'scheduled';
const confirmed = value => value === true || value?.outcome === 'complete' || value?.status === 'accepted';

export function createCausalSinkAdmissions({ maxPending = 128, capacity = 4096, historyLimit = 1024, publish = value => Object.freeze(value) } = {}) {
  if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 4096 || !Number.isInteger(capacity) || capacity < maxPending || capacity > 65536) throw new RangeError('Invalid causal admission bounds.');
  const registry = createSinkAdmissionRegistry({ capacity, historyLimit }), pending = new Map(), reservations = new Set(), owners = new WeakMap();
  let disposed = false;
  const current = entry => { try { return !disposed && entry.isCurrent() === true; } catch { return false; } };
  const seal = (entry, admission, changes = {}) => {
    entry.admission = admission;
    const receipt = Object.freeze({ ...(entry.receipt || entry.template), ...changes, admission, receiptId: admission.receiptId, receiptVersion: admission.receiptVersion, sequence: admission.sequence, ackState: admission.ackState });
    owners.set(receipt, entry); entry.receipt = receipt; publish(receipt); return receipt;
  };
  const advance = (entry, update, changes) => {
    const previousAdmissionStatus = entry.admission.status;
    const admission = registry.advance(entry.admission, update);
    return admission ? seal(entry, admission, { ...changes, previousAdmissionStatus }) : null;
  };
  const cancel = (entry, reason) => {
    if (entry.cancelled) return; entry.cancelled = true; entry.acknowledgements.length = 0;
    advance(entry, { expectedVersion: entry.admission.receiptVersion, status: 'rejected', reason }, { status: 'rejected', stage: 'none', reason });
    try {
      const result = entry.cancel(reason);
      Promise.resolve(result?.completion ?? result).then(value => {
        if (confirmed(result) || confirmed(value)) pending.delete(entry.admission.receiptId);
        else entry.cancellationUnconfirmed = true;
      }, () => { entry.cancellationUnconfirmed = true; }).catch(() => { entry.cancellationUnconfirmed = true; });
    } catch { entry.cancellationUnconfirmed = true; }
  };
  const sweep = (reason = null, predicate = () => true) => {
    for (const entry of pending.values()) if (predicate(entry.template) && (reason || !current(entry))) cancel(entry, reason || 'admission-context-retired');
  };
  const reserve = () => { if (disposed || pending.size + reservations.size >= maxPending) return null; const token = {}; reservations.add(token); return token; };
  const open = (template, outcome, isCurrent, reservation, canSettle = () => true) => {
    let value = outcome;
    if (!['accepted', 'rejected', 'degraded', 'deferred'].includes(value?.status)) value = { status: 'rejected', reason: template.reason || 'invalid-sink-receipt' };
    const entry = { template, isCurrent, admission: null, receipt: null, cancel: outcome?.cancel, cancelled: false, cancellationUnconfirmed: false, acknowledgements: [] };
    if (!reservations.has(reservation)) value = { status: 'rejected', reason: 'admission-capacity' };
    const invalidIdentity = fields.some(name => Object.hasOwn(outcome || {}, name) && outcome[name] !== (name === 'targetTime' ? template.targetFrame ?? null : name === 'timeDomain' ? template.targetTimeDomain ?? null : template[name] ?? null));
    if (invalidIdentity && value?.status !== 'deferred') value = { status: 'rejected', reason: 'stale-sink-identity' };
    const invalidDeferral = value?.status === 'deferred' && (typeof value.cancel !== 'function' || typeof value.completion?.then !== 'function');
    const status = value?.status === 'degraded' ? 'accepted' : value?.status;
    const admission = registry.open({ ...template, targetTime: template.targetFrame ?? null, timeDomain: template.targetTimeDomain ?? null },
      { ...value, status, ackState: status === 'accepted' ? value?.outputRequested === false ? 'none' : value.ackState ?? acknowledged(value.stage) : 'none' });
    if (!admission) { reservations.delete(reservation); return publish({ ...template, status: 'rejected', stage: 'none', reason: 'admission-registry-capacity' }); }
    const accepted = admission.status === 'accepted', deferred = admission.status === 'deferred';
    if (deferred) pending.set(admission.receiptId, entry); reservations.delete(reservation);
    const receipt = seal(entry, admission, { status: accepted ? value.status : admission.status, stage: accepted ? template.stage : deferred ? 'deferred' : 'none', reason: accepted ? template.reason : admission.reason });
    if (deferred) {
      Promise.resolve(value.completion).then(next => {
        if (entry.cancelled || pending.get(admission.receiptId) !== entry) return;
        if (!current(entry) || canSettle() !== true || next?.expectedVersion != null && next.expectedVersion !== entry.admission.receiptVersion || fields.some(name => Object.hasOwn(next || {}, name) && next[name] !== entry.admission[name])) { cancel(entry, 'admission-context-retired'); return; }
        if (!['accepted', 'rejected', 'degraded'].includes(next?.status)) { cancel(entry, 'invalid-deferred-admission'); return; }
        const status = next.status === 'degraded' ? 'accepted' : next.status;
        const changed = advance(entry, { expectedVersion: entry.admission.receiptVersion, status, ackState: status === 'accepted' ? next.outputRequested === false ? 'none' : next.ackState ?? acknowledged(next.stage) : 'none', reason: next.reason,
          ...(next.appliedFrame == null ? {} : { appliedFrame: next.appliedFrame }),
          ...(next.acknowledgedTime == null ? {} : { acknowledgedTime: next.acknowledgedTime, acknowledgementTimeDomain: next.acknowledgementTimeDomain }) },
        { status: next.status, stage: status === 'accepted' ? next.stage || 'scheduled' : 'none', reason: next.reason || null });
        if (!changed) { cancel(entry, 'invalid-deferred-admission'); return; }
        pending.delete(admission.receiptId);
        for (const acknowledgement of entry.acknowledgements.splice(0)) acknowledgeCurrent(entry.receipt, acknowledgement);
      }, () => { if (!entry.cancelled) cancel(entry, 'deferred-sink-exception'); }).catch(() => { if (!entry.cancelled) cancel(entry, 'deferred-sink-exception'); });
    }
    if (deferred && (invalidIdentity || invalidDeferral || !current(entry))) cancel(entry, invalidIdentity ? 'stale-sink-identity' : invalidDeferral ? 'uncancellable-deferral' : 'admission-context-retired');
    return receipt;
  };
  const acknowledge = (receipt, update) => {
    const entry = owners.get(receipt);
    if (!entry || !update || entry.receipt !== receipt || entry.admission.status !== 'accepted' || !current(entry)) return null;
    return advance(entry, update, { stage: update.ackState ?? receipt.stage,
      ...(update.appliedFrame == null ? {} : { appliedFrame: update.appliedFrame }),
      ...(update.acknowledgedTime == null ? {} : { acknowledgedTime: update.acknowledgedTime, acknowledgementTimeDomain: update.acknowledgementTimeDomain }) });
  };
  const acknowledgeCurrent = (receipt, update) => {
    const entry = owners.get(receipt);
    if (!entry || !update || entry.cancelled || !current(entry)) return false;
    if (entry.admission.status === 'deferred') { if (entry.acknowledgements.length >= 8) return false; entry.acknowledgements.push(Object.freeze({ ...update })); return true; }
    return !!acknowledge(entry.receipt, { expectedVersion: entry.admission.receiptVersion, ...update });
  };
  return Object.freeze({ reserve, open, acknowledge, acknowledgeCurrent, sweep, available: () => !disposed && pending.size + reservations.size < maxPending,
    snapshot: () => Object.freeze({ ...registry.snapshot(), reserved: reservations.size, pending: Object.freeze([...pending.values()].map(entry => Object.freeze({ receiptId: entry.admission.receiptId, cancelled: entry.cancelled, cancellationUnconfirmed: entry.cancellationUnconfirmed }))) }),
    dispose() { if (disposed) return; disposed = true; sweep('dispatcher-disposed'); } });
}
