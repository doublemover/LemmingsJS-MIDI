const documents = new WeakMap();
// One physical input owner per document. Foreign contacts neither commit nor
// cancel a draft. Projection/document/descriptor identity stays frozen.
export function getPointerGestureArbiter(document) {
  let arbiter = documents.get(document); if (arbiter) return arbiter;
  let active = null, serial = 0;
  const cancel = reason => { if (!active) return false; const old = active; active = null; old.onCancel?.(reason); return true; };
  arbiter = Object.freeze({
    acquire({ pointerId = null, targetKey, identity, getIdentity, onCancel = () => {} }) {
      if (active || identity == null || typeof targetKey !== 'string' || !targetKey || typeof getIdentity !== 'function' || getIdentity() !== identity) return null;
      if (!Number.isSafeInteger(serial + 1)) throw new Error('Gesture sequence exhausted.');
      const lease = { id: ++serial, pointerId, targetKey, identity, getIdentity, onCancel }; active = lease;
      const owns = event => {
        if (active !== lease) return false;
        if (getIdentity() !== identity) { cancel('target-replaced'); return false; }
        return event == null || pointerId == null ? event?.pointerId == null : event.pointerId === pointerId;
      };
      return Object.freeze({ id: lease.id, pointerId, targetKey, identity, owns,
        finish(event) { if (!owns(event)) return false; active = null; return true; },
        cancel(reason = 'cancelled') { if (active !== lease) return false; return cancel(reason); } });
    },
    cancel, inspect: () => active && Object.freeze({ id: active.id, pointerId: active.pointerId, targetKey: active.targetKey })
  }); documents.set(document, arbiter); return arbiter;
}
