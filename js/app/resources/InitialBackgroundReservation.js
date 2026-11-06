const ownershipError = message => Object.assign(new Error(message), { name: 'ResourceOwnershipError' });

export function createInitialBackgroundReservation({ budgets, request, identity, onPending, onReleased }) {
  const entries = budgets.map(budget => ({ budget, reserve: budget.reserve, release: budget.release, inspect: budget.inspectReservation, attempted: false, closed: false, pending: null }));
  let phase = 'admitting', reason = null, retirement = null;
  const snapshot = () => Object.freeze({ ...identity, phase, estimatedPeakBytes: request.bytes, admission: 'not-granted', reason });
  const owner = Object.freeze({ snapshot, retry() {
    if (retirement) return retirement;
    if (phase === 'released') return Promise.resolve(snapshot());
    phase = 'failed-or-unknown'; onPending(owner);
    retirement = Promise.resolve().then(async () => {
      await Promise.all(entries.map(entry => entry.pending));
      // The shared accounting guard outlives the uncertain external reservation.
      for (const entry of [...entries].reverse()) {
        if (!entry.attempted || entry.closed) continue;
        const result = await entry.release.call(entry.budget, { token: request.token, owner: request.owner });
        if (result === false && (typeof entry.inspect !== 'function' || entry.inspect.call(entry.budget, { token: request.token, owner: request.owner }) !== null)) throw ownershipError('Initial background reservation retirement was not acknowledged.');
        entry.closed = true;
      }
      phase = 'released'; reason = null; onReleased(owner); return snapshot();
    }).catch(error => { reason = String(error?.message || error).slice(0, 512); return snapshot(); }).finally(() => { retirement = null; });
    return retirement;
  } });
  return Object.freeze({
    reserve() {
      for (const entry of entries) {
        entry.attempted = true;
        const acknowledgment = entry.reserve.call(entry.budget, request);
        if (acknowledgment && typeof acknowledgment.then === 'function') {
          entry.pending = Promise.resolve(acknowledgment).then(() => {}, () => {});
          throw ownershipError('Background resource admission must acknowledge synchronously.');
        }
        if (acknowledgment === false) throw ownershipError('Background resource admission was refused.');
      }
      return entries.map(entry => entry.budget);
    },
    refuse(error) {
      const reported = error instanceof Error && Object.isExtensible(error) ? error : Object.assign(new Error(String(error?.message || error)), { cause: error });
      reason = String(reported.message).slice(0, 512); phase = 'failed-or-unknown';
      reported.backgroundRetirement = snapshot(); reported.backgroundRetirementCompletion = owner.retry();
      reported.retryBackgroundAdmissionRetirement = owner.retry;
      return reported;
    }
  });
}
