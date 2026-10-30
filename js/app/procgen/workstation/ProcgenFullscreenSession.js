// Browser fullscreen belongs to the current presentation root, not the world or audio transport.
const rootOwners = new WeakMap();
export function createProcgenFullscreenSession({ document, root, control, getGeneration = () => 0,
  onTransition = () => {}, onReflow = () => {}, onStatus = () => {}, focusFallback = () => null } = {}) {
  if (!document?.addEventListener || !root || !control) throw new Error('Fullscreen needs a presentation root and document.');
  const owner = {}; rootOwners.set(root, owner);
  const ownsRoot = () => rootOwners.get(root) === owner;
  let disposed = false, epoch = 0, state = 'idle', focusToken = null, pendingExit = false, entryGeneration = null;
  const belongs = () => document.fullscreenElement === root;
  const publish = next => { state = next; control.setAttribute('aria-pressed', String(next === 'entered')); };
  const restoreFocus = () => {
    const token = focusToken; focusToken = null;
    if (!token || token.generation !== getGeneration()) return;
    const active = document.activeElement;
    if (active?.closest?.('dialog[open]')) return;
    if (active && active !== control && active !== document.body && active !== root && active.isConnected !== false) return;
    const target = token.element?.isConnected && root.contains(token.element) ? token.element : focusFallback();
    if (target?.isConnected !== false) target?.focus?.({ preventScroll: true });
  };
  const reconcile = () => {
    if (disposed || !ownsRoot()) return;
    const wasEntered = state === 'entered' || state === 'exiting';
    if (belongs()) {
      if (entryGeneration !== null && entryGeneration !== getGeneration()) { focusToken = null; pendingExit = false; void exit(); return; }
      publish('entered'); onReflow();
      if (pendingExit) { pendingExit = false; void exit(); }
      return;
    }
    if (wasEntered) onTransition('exiting');
    publish('idle'); onReflow();
    if (wasEntered) restoreFocus();
  };
  const changed = () => reconcile();
  const failed = () => { if (disposed || !ownsRoot()) return; pendingExit = false; publish(belongs() ? 'entered' : 'failed'); onReflow(); };
  document.addEventListener('fullscreenchange', changed);
  document.addEventListener('fullscreenerror', failed);
  const enter = async () => {
    if (disposed || !ownsRoot() || state === 'requesting' || state === 'exiting') return false;
    if (belongs()) { reconcile(); return true; }
    if (typeof root.requestFullscreen !== 'function') { publish('failed'); onStatus('Fullscreen is unavailable in this browser.'); return false; }
    const operation = ++epoch;
    const generation = getGeneration(); entryGeneration = generation;
    pendingExit = false;
    focusToken = { element: document.activeElement, generation: getGeneration() };
    publish('requesting'); onTransition('requesting');
    try { await root.requestFullscreen(); }
    catch (error) {
      if (!disposed && ownsRoot() && operation === epoch) { failed(); onStatus(`Fullscreen could not start: ${error?.message || 'request rejected'}.`); }
      return false;
    }
    if (disposed || !ownsRoot() || operation !== epoch || generation !== getGeneration() || root.isConnected === false) {
      if (ownsRoot() && belongs() && (disposed || operation === epoch || root.isConnected === false)) {
        focusToken = null;
        try { await document.exitFullscreen?.(); } catch { /* The browser exit control remains available. */ }
      }
      if (!disposed && ownsRoot() && operation === epoch) reconcile();
      return false;
    }
    reconcile(); return belongs();
  };
  const exit = async () => {
    if (disposed || !ownsRoot() || state === 'exiting') return false;
    if (!belongs()) { reconcile(); return false; }
    if (typeof document.exitFullscreen !== 'function') { publish('failed'); onStatus('Fullscreen exit is unavailable. Use the browser exit control.'); return false; }
    const operation = ++epoch;
    pendingExit = false;
    publish('exiting'); onTransition('exiting');
    try { await document.exitFullscreen(); }
    catch (error) {
      if (!disposed && ownsRoot() && operation === epoch) { failed(); onStatus(`Fullscreen could not exit: ${error?.message || 'request rejected'}.`); }
      return false;
    }
    if (disposed || !ownsRoot() || operation !== epoch) return false;
    reconcile(); return !belongs();
  };
  return {
    enter, exit, toggle: () => state === 'requesting' ? (pendingExit = true, Promise.resolve(false)) : belongs() ? exit() : enter(),
    getState: () => Object.freeze({ state, epoch, entered: belongs(), pendingExit, available: typeof root.requestFullscreen === 'function' }),
    dispose() {
      if (disposed) return;
      disposed = true; epoch++; focusToken = null;
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('fullscreenerror', failed);
      if (ownsRoot() && belongs()) void Promise.resolve().then(() => document.exitFullscreen?.()).catch(() => {});
    }
  };
}
