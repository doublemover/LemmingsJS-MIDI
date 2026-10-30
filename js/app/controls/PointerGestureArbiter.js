const documents = new WeakMap();
// One physical input owner per document. Foreign contacts neither commit nor
// cancel a draft. Projection/document/descriptor identity stays frozen.
export function getPointerGestureArbiter(document) {
  let arbiter = documents.get(document); if (arbiter) return arbiter;
  let active = null, serial = 0, listenerCount = 0, unhandledRelease = null;
  const stopListening = () => {
    if (unhandledRelease != null) clearTimeout(unhandledRelease);
    unhandledRelease = null;
    while (listenerCount) {
      const [target, type, handler, capture] = listeners[--listenerCount];
      target?.removeEventListener?.(type, handler, capture);
    }
  };
  const releaseCapture = lease => {
    if (active && active !== lease && active.captureTarget === lease.captureTarget && active.pointerId === lease.pointerId) return;
    try { if (lease.pointerId != null && lease.captureTarget?.hasPointerCapture?.(lease.pointerId)) lease.captureTarget.releasePointerCapture(lease.pointerId); } catch { /* Capture may already have retired with its document. */ }
  };
  const cancel = reason => {
    if (!active) return false;
    const old = active; active = null; stopListening();
    try { old.onCancel?.(reason); } finally { releaseCapture(old); }
    return true;
  };
  const cancelSafely = reason => { try { return cancel(reason); } catch { return true; } };
  const revalidate = () => {
    if (!active) return true;
    let current = false;
    try { current = active.captureTarget?.isConnected !== false && active.getIdentity() === active.identity; } catch { /* A removed source cannot keep a gesture. */ }
    if (!current) cancelSafely('target-replaced');
    return current;
  };
  const foreignSafeCancel = event => { if (active && active.pointerId === event.pointerId) cancelSafely(event.type); };
  const owningRelease = event => {
    if (!active || active.pointerId !== event.pointerId) return; const owner = active;
    // Window handlers finish their transaction before the unhandled-release fallback.
    if (unhandledRelease != null) clearTimeout(unhandledRelease);
    unhandledRelease = setTimeout(() => { unhandledRelease = null; if (active === owner) cancelSafely('unhandled-pointerup'); }, 0);
  };
  const escape = event => {
    if (event.key === 'Escape' && active) { cancelSafely('escape'); event.preventDefault?.(); event.stopPropagation?.(); }
  };
  const listeners = [
    [document, 'pointercancel', foreignSafeCancel, true], [document, 'lostpointercapture', foreignSafeCancel, true],
    [document, 'pointerup', owningRelease, false], [document.defaultView, 'blur', () => cancelSafely('blur'), false],
    [document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') cancelSafely('hidden'); }, false],
    [document, 'keydown', escape, true],
    [document, 'beforetoggle', event => { if (event.target?.tagName === 'DIALOG' && event.newState === 'open') cancelSafely('modal-open'); }, true]
  ];
  const startListening = () => {
    try {
      while (listenerCount < listeners.length) {
        const [target, type, handler, capture] = listeners[listenerCount++];
        target?.addEventListener?.(type, handler, capture);
      }
    } catch (error) { active = null; stopListening(); throw error; }
  };
  arbiter = Object.freeze({
    acquire({ pointerId = null, targetKey, identity, getIdentity, onCancel = () => {}, captureTarget = null }) {
      revalidate();
      if (active || identity == null || typeof targetKey !== 'string' || !targetKey || typeof getIdentity !== 'function' || captureTarget?.isConnected === false) return null;
      try { if (getIdentity() !== identity) return null; } catch { return null; }
      if (!Number.isSafeInteger(serial + 1)) throw new Error('Gesture sequence exhausted.');
      const lease = { id: ++serial, pointerId, targetKey, identity, getIdentity, onCancel, captureTarget }; active = lease; startListening();
      const owns = event => {
        if (active !== lease) return false;
        if (!revalidate() || active !== lease) return false;
        return event == null || pointerId == null ? event?.pointerId == null : event.pointerId === pointerId;
      };
      return Object.freeze({ id: lease.id, pointerId, targetKey, identity, owns,
        finish(event) { if (!owns(event)) return false; active = null; stopListening(); releaseCapture(lease); return true; },
        cancel(reason = 'cancelled') { if (active !== lease) return false; return cancel(reason); } });
    },
    cancel, revalidate, inspect: () => active && Object.freeze({ id: active.id, pointerId: active.pointerId, targetKey: active.targetKey })
  }); documents.set(document, arbiter); return arbiter;
}
