export function createDeviceMutationOwner({ routes, ci, now = () => performance.now() } = {}) {
  let active = null, latest = null, serial = 0, disposed = false;
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) { try { listener(); } catch {} } };
  const finish = (transaction, result) => {
    if (active !== transaction) return;
    active = null; for (const hold of transaction.holds) routes.releaseObservation(hold);
    latest = Object.freeze({ operationId: transaction.operationId, endpoint: transaction.scope.outputGrant, connectionEpoch: transaction.scope.connectionEpoch,
      routeRevision: transaction.routeRevision, requested: transaction.requested, applyBoundary: 'owned-output-quiescent-before-control-send',
      startedHostMs: transaction.started, completedHostMs: now(), ...result });
    transaction.resolve(latest); emit();
  };
  return Object.freeze({
    async run({ requested, confirmed = false, send, isCurrent = () => true, allOutputs = false }) {
      if (disposed || active || confirmed !== true || typeof send !== 'function') return Object.freeze({ status: 'rejected', reason: 'Explicit confirmation and an idle device mutation owner are required' });
      const scope = ci.state(), affectedGrants = allOutputs ? routes.state().grants.filter(row => row.direction === 'output').map(row => row.grant) : [scope.outputGrant], holds = [];
      try { for (const grant of affectedGrants) holds.push(routes.holdForObservation(grant)); if (!affectedGrants.includes(scope.outputGrant)) throw new Error('The selected device output is no longer owned'); }
      catch (error) { for (const hold of holds) routes.releaseObservation(hold); return Object.freeze({ status: 'rejected', reason: error.message }); }
      let resolve; const completion = new Promise(done => { resolve = done; });
      const transaction = { completion, holds, resolve, scope, operationId: 'device-mutation-' + ++serial, requested: Object.freeze({ ...requested }), started: now(), routeRevision: routes.state().revision };
      active = transaction; emit();
      const current = () => !disposed && !transaction.cancelled && active === transaction && ci.state().epoch === scope.epoch && routes.client.session === scope.connectionEpoch && (!allOutputs || routes.state().grants.filter(row => row.direction === 'output').every(row => affectedGrants.includes(row.grant))) && isCurrent();
      try {
        await Promise.all(affectedGrants.map(grant => routes.invalidateDeviceState(grant, 'explicit-device-mutation:' + (requested.kind || 'profile'))));
        if (!current()) { finish(transaction, { status: 'cancelled', receiverState: 'unknown', reason: 'Device mutation scope changed' }); return completion; }
        const result = await send(current);
        await Promise.all(affectedGrants.map(grant => routes.invalidateDeviceState(grant, (transaction.cancelled ? 'cancelled-device-mutation:' : 'settled-device-mutation:') + (requested.kind || 'profile'))));
        if (active === transaction) finish(transaction, current() ? result : { status: 'cancelled', receiverState: 'unknown', reason: 'Device mutation scope changed after submission' });
      } catch (error) { finish(transaction, { status: 'incomplete', receiverState: 'unknown', reason: error.message }); }
      return completion;
    },
    state: () => Object.freeze({ busy: !!active, latest, requested: active?.requested || null }),
    subscribe(listener) { if (disposed || typeof listener !== 'function' || listeners.size >= 8) throw new Error('Device mutation observer capacity'); listeners.add(listener); return () => listeners.delete(listener); },
    cancel() { if (active) { active.cancelled = true; emit(); } },
    dispose() { if (disposed) return active?.completion || Promise.resolve(); disposed = true; if (active) active.cancelled = true; listeners.clear(); return active?.completion || Promise.resolve(); }
  });
}
