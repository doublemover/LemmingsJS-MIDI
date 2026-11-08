const INITIAL = Object.freeze({ program: null, volume: 1, expression: 1, pan: 0, bend: 0, bendRange: 2, timbre: null });
const KINDS = new Set(['program', 'volume', 'expression', 'pan', 'bend', 'bendRange', 'timbre', 'allNotesOff']);

// A channel's future controls are ordered by render time, then by admission
// sequence for equal-frame commands. Already elapsed controls collapse into a
// baseline when the caller advances the retention floor.
export function createTimedControlTimeline({ maxEvents = 128 } = {}) {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 65536) throw new Error('Invalid control timeline capacity.');
  let baseline = { ...INITIAL }, floor = 0, sequence = 0;
  const events = [];
  const apply = (state, event) => { if (event.kind !== 'allNotesOff') state[event.kind] = event.value; };
  const retainFrom = time => {
    if (!Number.isFinite(time) || time < floor) return;
    let consumed = 0;
    while (consumed < events.length && events[consumed].time < time) { apply(baseline, events[consumed]); consumed++; }
    if (consumed) events.splice(0, consumed);
    floor = time;
  };
  const insert = (time, kind, value) => {
    if (!Number.isFinite(time) || time < floor || !KINDS.has(kind) || events.length >= maxEvents) return null;
    const event = Object.freeze({ time, sequence: ++sequence, kind, value });
    let lo = 0, hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].time <= time) lo = mid + 1;
      else hi = mid;
    }
    events.splice(lo, 0, event);
    return event;
  };
  const at = time => {
    if (!Number.isFinite(time) || time < floor) throw new Error('Control time is outside retained history.');
    const state = { ...baseline };
    for (const event of events) { if (event.time > time) break; apply(state, event); }
    return state;
  };
  const from = time => events.filter(event => event.time > time);
  const clear = () => { baseline = { ...INITIAL }; floor = 0; sequence = 0; events.length = 0; };
  const diagnostics = () => Object.freeze({ floor, events: events.length, maxEvents });
  return { insert, at, from, retainFrom, clear, diagnostics };
}
