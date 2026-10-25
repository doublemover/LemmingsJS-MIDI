// A causal slew starts at the supplied event time. It never interpolates toward
// an actor position that has not arrived. Rebuilding also handles future events
// submitted out of order without reading AudioParam.value as rendered evidence.
export function createSmoothedAudioParameter({ param, initialValue, startTime, smoothingSeconds = 0.008, maxEvents = 128 } = {}) {
  if (!param || !Number.isFinite(initialValue) || !Number.isFinite(startTime) || startTime < 0 ||
      !Number.isFinite(smoothingSeconds) || smoothingSeconds < 0 || smoothingSeconds > 1 ||
      !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 4096) throw new Error('Invalid smoothed audio parameter.');
  let anchor = { time: startTime, value: initialValue, target: initialValue, end: startTime }, sequence = 0;
  const events = [];
  const interpolate = (state, time) => state.end <= state.time || time >= state.end ? state.target :
    state.value + (state.target - state.value) * Math.max(0, time - state.time) / (state.end - state.time);
  const stateAt = time => {
    let state = anchor;
    for (const event of events) {
      if (event.time > time) break;
      state = { time: event.time, value: interpolate(state, event.time), target: event.value, end: event.time + event.duration };
    }
    return { time, value: interpolate(state, time), target: state.target, end: Math.max(time, state.end) };
  };
  const rebuild = now => {
    const from = Math.max(startTime, now), state = stateAt(from);
    // We know the entire automation curve, including interrupted ramps. This
    // supplies the same hold value on browsers without cancelAndHoldAtTime.
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(from);
    else param.cancelScheduledValues(from);
    param.setValueAtTime(state.value, from);
    let cursor = state;
    const finish = until => {
      if (cursor.end > cursor.time) param.linearRampToValueAtTime(interpolate(cursor, until), Math.min(until, cursor.end));
    };
    for (const event of events) {
      if (event.time <= from) continue;
      finish(event.time);
      const value = interpolate(cursor, event.time);
      param.setValueAtTime(value, event.time);
      cursor = { time: event.time, value, target: event.value, end: event.time + event.duration };
      if (event.duration === 0) param.setValueAtTime(event.value, event.time);
    }
    finish(cursor.end);
    if (state.end <= from && !events.some(event => event.time > from)) param.setValueAtTime(state.target, from);
  };
  const insert = (value, time, now, duration = smoothingSeconds) => {
    if (![value, time, now, duration].every(Number.isFinite) || duration < 0 || duration > 60 || time < startTime || time < now) return false;
    const floor = Math.max(startTime, now);
    anchor = stateAt(floor);
    let consumed = 0;
    while (consumed < events.length && events[consumed].time <= floor) consumed++;
    if (consumed) events.splice(0, consumed);
    if (events.length >= maxEvents) return false;
    const event = { time, value, duration, sequence: ++sequence };
    let index = events.length;
    while (index > 0 && events[index - 1].time > time) index--;
    events.splice(index, 0, event);
    rebuild(now);
    return true;
  };
  const valueAt = time => stateAt(Math.max(startTime, time)).value;
  param.setValueAtTime(initialValue, startTime);
  return { insert, valueAt, hasFutureEvents: now => events.some(event => event.time > Math.max(startTime, now)), canInsert: now => events.filter(event => event.time > Math.max(startTime, now)).length < maxEvents,
    diagnostics: () => Object.freeze({ queued: events.length, maxEvents, smoothingSeconds, interpolation: 'causal-linear-slew' }) };
}
