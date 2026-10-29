const stages = Object.freeze({ none: 0, scheduled: 1, 'driver-submitted': 2, applied: 3, 'receiver-observed': 4 });
const identityFields = Object.freeze(['worldId', 'generation', 'batchId', 'intentId', 'onsetId', 'voiceId', 'eventId', 'sinkId', 'connectionEpoch', 'routeRevision', 'targetTime', 'timeDomain']);

export function createSinkAdmissionRegistry({ capacity = 4096, historyLimit = 1024, onTransition = () => {} } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 65536 || !Number.isInteger(historyLimit) || historyLimit < 0 || historyLimit > 65536) throw new RangeError('Invalid sink admission bounds.');
  const latest = new Map(), history = Array(historyLimit);
  let serial = 0, sequence = 0, cursor = 0, retained = 0;
  const publish = value => {
    if (sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Sink admission sequence exhausted.');
    const receipt = Object.freeze({ ...value, sequence: ++sequence });
    latest.set(receipt.receiptId, receipt);
    if (historyLimit) { history[cursor] = receipt; cursor = (cursor + 1) % historyLimit; retained = Math.min(historyLimit, retained + 1); }
    try { onTransition(receipt); } catch { /* Observation cannot change admission. */ }
    return receipt;
  };
  const open = (identity, outcome) => {
    if (serial >= Number.MAX_SAFE_INTEGER) return null;
    if (latest.size >= capacity) {
      let evict = null;
      for (const [id, receipt] of latest) if (receipt.status !== 'deferred') { evict = id; break; }
      if (evict == null) return null;
      latest.delete(evict);
    }
    const status = ['accepted', 'rejected', 'deferred'].includes(outcome?.status) ? outcome.status : 'rejected';
    const ackState = status === 'accepted' ? outcome.ackState ?? 'scheduled' : 'none';
    const fields = {}; let validIdentity = true;
    for (const name of identityFields) {
      const value = identity?.[name] ?? null;
      const valid = value == null || (name === 'targetTime' ? typeof value === 'number' && Number.isFinite(value) && value >= 0 :
        typeof value === 'string' && value.length > 0 && value.length <= 512 || Number.isSafeInteger(value) && value >= 0);
      fields[name] = valid ? value : null; validIdentity &&= valid;
    }
    const valid = validIdentity && Object.hasOwn(stages, ackState) && (status !== 'accepted' || ackState !== 'none');
    return publish({ schema: 'lemmings-sink-admission/v1', ...fields, receiptId: 'admission:' + ++serial, receiptVersion: 1,
      status: valid ? status : 'rejected', reason: !validIdentity ? 'invalid-admission-identity' : !valid ? 'invalid-ack-state' : status === 'accepted' ? null : String(outcome?.reason || (status === 'deferred' ? 'sink-deferred' : 'sink-rejected')).slice(0, 512),
      ackState: valid ? ackState : 'none' });
  };
  const advance = (previous, update) => {
    if (!previous || latest.get(previous.receiptId) !== previous || previous.status === 'rejected' || !update ||
        update.expectedVersion !== previous.receiptVersion || identityFields.some(name => Object.hasOwn(update, name) && update[name] !== previous[name])) return null;
    const status = update.status ?? previous.status, ackState = update.ackState ?? (status === 'accepted' ? previous.status === 'deferred' ? 'scheduled' : previous.ackState : 'none');
    if (!['accepted', 'rejected'].includes(status) || previous.status === 'accepted' && status !== 'accepted' || !Object.hasOwn(stages, ackState) ||
        status === 'accepted' && (!stages[ackState] || stages[ackState] < stages[previous.ackState]) || status !== 'accepted' && ackState !== 'none' ||
        update.appliedFrame != null && (!Number.isSafeInteger(update.appliedFrame) || update.appliedFrame < 0 || !['applied', 'receiver-observed'].includes(ackState)) ||
        update.acknowledgedTime != null && (!Number.isFinite(update.acknowledgedTime) || typeof update.acknowledgementTimeDomain !== 'string' || !update.acknowledgementTimeDomain)) return null;
    return publish({ ...previous, status, ackState, receiptVersion: previous.receiptVersion + 1,
      reason: status === 'accepted' ? null : update.reason || 'sink-rejected',
      ...(update.appliedFrame != null ? { appliedFrame: update.appliedFrame } : {}),
      ...(update.acknowledgedTime != null ? { acknowledgedTime: update.acknowledgedTime, acknowledgementTimeDomain: update.acknowledgementTimeDomain } : {}) });
  };
  const snapshot = () => Object.freeze({ latest: Object.freeze([...latest.values()]), history: Object.freeze(Array.from({ length: retained }, (_, index) => history[(cursor - retained + historyLimit + index) % historyLimit])) });
  const counters = () => Object.freeze({ serial, sequence });
  const restoreCounters = value => {
    if (!value || !Number.isSafeInteger(value.serial) || value.serial < 0 || value.serial > Number.MAX_SAFE_INTEGER - 65536 ||
        !Number.isSafeInteger(value.sequence) || value.sequence < value.serial || value.sequence > Number.MAX_SAFE_INTEGER - 65536) return false;
    serial = Math.max(serial, value.serial); sequence = Math.max(sequence, value.sequence); return true;
  };
  return Object.freeze({ open, advance, snapshot, counters, restoreCounters });
}
