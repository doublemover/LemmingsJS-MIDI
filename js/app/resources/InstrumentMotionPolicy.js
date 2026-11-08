const MODES = new Set(['system', 'reduce', 'freeze']);
const validValue = value => Number.isFinite(value) && Math.abs(value) <= 65536;

export function createInstrumentMotionPolicy({ document, window = document?.defaultView || {}, budget = null, maxTransitions = 256, now = () => window.performance?.now?.() ?? 0 } = {}) {
  if (!Number.isSafeInteger(maxTransitions) || maxTransitions < 1 || maxTransitions > 1280 || typeof now !== 'function') throw new TypeError('Invalid motion policy bounds.');
  const reservation = {}, transitions = new Map(), subscribers = new Map(), releases = [];
  let transitionCapacity = 0, retainedBytes = 4096;
  budget?.retain?.(reservation, retainedBytes, 'instrument-motion');
  let mode = 'system', paused = false, visible = document?.hidden !== true, retired = false, media = null, systemReduced = false;
  let rawTime = null, presentationTime = 0, revision = 0, skipped = 0, regressions = 0, callbackFailures = 0;
  const reduced = () => mode === 'reduce' || systemReduced;
  const frozen = () => mode === 'freeze' || paused || !visible;
  const staticMotion = () => retired || reduced() || frozen();
  function clock(timestamp = now()) {
    if (!Number.isFinite(timestamp)) timestamp = rawTime ?? 0;
    if (rawTime == null) { rawTime = timestamp; presentationTime = timestamp; }
    if (timestamp < rawTime) { regressions++; timestamp = rawTime; }
    if (!frozen() && !reduced()) presentationTime += timestamp - rawTime;
    rawTime = timestamp; return presentationTime;
  }
  const snapshot = () => Object.freeze({ schema: 'instrument-motion/v1', mode, state: reduced() ? 'reduced' : frozen() ? 'frozen' : 'full',
    systemPreference: media ? systemReduced ? 'reduce' : 'no-preference' : 'unavailable', paused, visible, retired, revision,
    activeTransitions: transitions.size, maxTransitions, transitionCapacity, subscribers: subscribers.size, skipped, regressions, callbackFailures, retainedBytes });
  const publish = () => { revision++; const value = snapshot(); for (const [owner, callback] of [...subscribers]) { if (subscribers.get(owner) !== callback) continue; try { callback(value); } catch { callbackFailures++; } } };
  const observe = (target, type, callback) => { target?.addEventListener?.(type, callback); releases.push(() => target?.removeEventListener?.(type, callback)); };
  function configure(patch = {}) {
    if (retired) return false;
    if (patch.mode != null && !MODES.has(patch.mode)) throw new TypeError('Unknown instrument motion mode.');
    if (patch.paused != null && typeof patch.paused !== 'boolean' || patch.visible != null && typeof patch.visible !== 'boolean') throw new TypeError('Invalid motion visibility or pause state.');
    const nextMode = patch.mode ?? mode, nextPaused = patch.paused ?? paused, nextVisible = patch.visible ?? visible;
    if (nextMode === mode && nextPaused === paused && nextVisible === visible) return false;
    clock(); mode = nextMode; paused = nextPaused; visible = nextVisible; if (reduced()) transitions.clear(); publish(); return true;
  }
  const sampleRecord = (record, time) => {
    const progress = Math.max(0, Math.min(1, (time - record.start) / record.duration));
    if (progress === 0) return record.from; if (progress === 1) return record.target;
    return record.from + (record.target - record.from) * progress * progress * (3 - 2 * progress);
  };
  try {
    media = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    systemReduced = media?.matches === true;
    const changed = () => { if (retired) return; clock(); systemReduced = media.matches === true; if (reduced()) transitions.clear(); publish(); };
    if (media?.addEventListener) observe(media, 'change', changed);
    else if (media?.addListener) { media.addListener(changed); releases.push(() => media.removeListener(changed)); }
    observe(document, 'visibilitychange', () => configure({ visible: document.hidden !== true }));
  } catch (error) { for (const release of releases) release(); budget?.release?.(reservation); throw error; }
  return Object.freeze({
    get revision() { return revision; },
    get matches() { return staticMotion(); }, get automaticCamera() { return !staticMotion(); },
    get frameIntervalMs() { return staticMotion() ? 250 : 16; },
    presentationTime(timestamp) { if (retired) return presentationTime; if (timestamp != null && !Number.isFinite(timestamp)) throw new TypeError('Invalid presentation timestamp.'); return clock(timestamp); },
    configure, getState: snapshot,
    subscribe(callback) {
      if (retired) return () => {};
      if (typeof callback !== 'function' || subscribers.size >= 32) throw new TypeError('Invalid or exhausted motion subscription.');
      const owner = {}; subscribers.set(owner, callback); let owned = true; return () => { if (!owned) return; owned = false; subscribers.delete(owner); };
    },
    retarget(key, target, { from = target, durationMs = 120, timestamp } = {}) {
      if ((!key || typeof key !== 'object') && (typeof key !== 'string' || !key || key.length > 160) || !validValue(target) || !validValue(from) || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 2000 || timestamp != null && !Number.isFinite(timestamp)) throw new TypeError('Invalid finite motion transition.');
      if (retired || reduced() || durationMs === 0) { transitions.delete(key); return target; }
      const time = clock(timestamp), previous = transitions.get(key), current = previous ? sampleRecord(previous, time) : from;
      if (previous?.target === target) { if (time >= previous.start + previous.duration) transitions.delete(key); return current; }
      if (current === target) { transitions.delete(key); return target; }
      if (!previous && transitions.size >= maxTransitions) { skipped++; return current; }
      if (!previous && transitions.size >= transitionCapacity) {
        const capacity = Math.min(maxTransitions, Math.max(8, transitionCapacity * 2)), bytes = 4096 + capacity * 192;
        try { budget?.retain?.(reservation, bytes, 'instrument-motion'); } catch { skipped++; return current; }
        transitionCapacity = capacity; retainedBytes = bytes;
      }
      const record = previous || {}; record.from = current; record.target = target; record.start = time; record.duration = durationMs; transitions.set(key, record); return current;
    },
    sample(key, fallback, timestamp) {
      if (!validValue(fallback) || timestamp != null && !Number.isFinite(timestamp)) throw new TypeError('Invalid motion sample.');
      const record = transitions.get(key); if (!record || retired) return fallback;
      const time = clock(timestamp), value = sampleRecord(record, time); if (time >= record.start + record.duration) transitions.delete(key); return value;
    },
    release: key => transitions.delete(key),
    dispose() { if (retired) return; retired = true; for (const release of releases) release(); transitions.clear(); subscribers.clear(); budget?.release?.(reservation); retainedBytes = 0; }
  });
}
