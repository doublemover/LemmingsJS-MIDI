// Background playback is deliberately unsupported: every suspension revokes
// clock/output authority, while returning only makes explicit Play available.
export function createProcgenPageLifecycle({ document, window, suspend, restore = () => {} } = {}) {
  let state = document.hidden ? 'hidden' : 'active', revision = 0, retired = false, suspended = false;
  const listeners = [];
  const change = (next, reason) => {
    if (retired || state === next) return;
    state = next; revision++;
    if (['hidden', 'suspended', 'bfcache-held'].includes(next)) {
      if (!suspended) { suspended = true; suspend(Object.freeze({ state, reason, revision, policy: 'explicit-resume' })); }
    } else if (next === 'active') restore(Object.freeze({ state, reason, revision, policy: 'explicit-resume', paused: suspended }));
  };
  const listen = (target, type, fn) => { target.addEventListener?.(type, fn); listeners.push(() => target.removeEventListener?.(type, fn)); };
  listen(document, 'visibilitychange', () => change(document.hidden ? 'hidden' : 'active', 'visibility'));
  listen(document, 'freeze', () => change('suspended', 'freeze'));
  listen(document, 'resume', () => change(document.hidden ? 'hidden' : 'active', 'resume'));
  listen(window, 'pagehide', event => change(event.persisted ? 'bfcache-held' : 'suspended', 'pagehide'));
  listen(window, 'pageshow', event => { if (event.persisted) change(document.hidden ? 'hidden' : 'active', 'pageshow'); });
  if (document.hidden) { suspended = true; suspend(Object.freeze({ state, reason: 'initial-hidden', revision, policy: 'explicit-resume' })); }
  return Object.freeze({ inspect: () => Object.freeze({ state, revision, paused: suspended, policy: 'explicit-resume' }),
    resumeExplicitly() { if (retired || state !== 'active') return false; suspended = false; return true; },
    dispose() { if (retired) return; retired = true; state = 'disposed'; revision++; for (const remove of listeners) remove(); listeners.length = 0; }
  });
}
