// A causal slew starts at the supplied event time. It never interpolates toward
// an actor position that has not arrived. Rebuilding also handles future events
// submitted out of order without reading AudioParam.value as rendered evidence.
export function createSmoothedAudioParameter({ param, initialValue, startTime, smoothingSeconds = 0.008, maxEvents = 128, valueMinimum = -Number.MAX_VALUE, valueMaximum = Number.MAX_VALUE, allowedValues = null } = {}) {
  if (!param || !Number.isFinite(initialValue) || !Number.isFinite(startTime) || startTime < 0 ||
      !Number.isFinite(smoothingSeconds) || smoothingSeconds < 0 || smoothingSeconds > 1 ||
      !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 4096 || !Number.isFinite(valueMinimum) || !Number.isFinite(valueMaximum) || valueMinimum > valueMaximum || allowedValues !== null && (!Array.isArray(allowedValues) || !allowedValues.length || allowedValues.length > 256 || smoothingSeconds !== 0 || allowedValues.some(value => !Number.isFinite(value) || value < valueMinimum || value > valueMaximum))) throw new Error('Invalid smoothed audio parameter.');
  const validValue = value => Number.isFinite(value) && value >= valueMinimum && value <= valueMaximum && (allowedValues === null || allowedValues.includes(value));
  if (!validValue(initialValue)) throw new Error('Initial owned automation value is outside its declared domain.');
  let anchor = { time: startTime, value: initialValue, target: initialValue, end: startTime }, sequence = 0, minimumTime = startTime, restored = false, fault = null;
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
    if (fault || !validValue(value) || time < minimumTime || now < minimumTime || ![value, time, now, duration].every(Number.isFinite) || duration < 0 || duration > 60 || allowedValues !== null && duration !== 0 || time < startTime || time < now) return false;
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
  const valueAt = time => stateAt(Math.max(minimumTime, time)).value;
  const validateSnapshot = state => {
    if (!state || state.schema !== 'lemmings-smoothed-parameter-cut/v1' || state.smoothingSeconds !== smoothingSeconds || state.maxEvents !== maxEvents || !Number.isSafeInteger(state.sequence) || state.sequence < 0 || !Number.isFinite(state.sourceTimeSeconds) || state.sourceTimeSeconds < 0 || !validValue(state.value) || !validValue(state.target) || !Number.isFinite(state.remainingSeconds) || state.remainingSeconds < 0 || state.remainingSeconds > 60 || !Array.isArray(state.future) || state.future.length > maxEvents) throw new Error('Incompatible owned parameter automation state.');
    const seen = new Set(); let previous = null;
    for (const event of state.future) {
      if (!event || !Number.isFinite(event.afterSeconds) || event.afterSeconds <= 0 || !validValue(event.value) || !Number.isFinite(event.durationSeconds) || event.durationSeconds < 0 || event.durationSeconds > 60 || allowedValues !== null && event.durationSeconds !== 0 || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || event.sequence > state.sequence || seen.has(event.sequence) || previous && (event.afterSeconds < previous.afterSeconds || event.afterSeconds === previous.afterSeconds && event.sequence <= previous.sequence)) throw new Error('Invalid future owned automation frontier.');
      seen.add(event.sequence); previous = event;
    }
    return true;
  };
  const snapshot = time => {
    if (fault || !Number.isFinite(time) || time < minimumTime || time < anchor.time) throw new Error('Choose a covered owned automation cut time.');
    const state = stateAt(time), future = events.filter(event => event.time > time).map(event => Object.freeze({ afterSeconds: event.time - time, value: event.value, durationSeconds: event.duration, sequence: event.sequence }));
    return Object.freeze({ schema: 'lemmings-smoothed-parameter-cut/v1', sourceTimeSeconds: time, value: state.value, target: state.target, remainingSeconds: state.end - time, sequence, smoothingSeconds, maxEvents, future: Object.freeze(future), evidence: 'owned-API-curve-and-committed-future-controls;not-native-rendered-readback' });
  };
  const restore = (state, time) => {
    validateSnapshot(state);
    if (fault || restored || sequence || events.length || !Number.isFinite(time) || time < startTime || !Number.isFinite(time + state.remainingSeconds) || state.future.some(event => !Number.isFinite(time + event.afterSeconds + event.durationSeconds))) throw new Error('Restore parameter curves only into a fresh unpublished automation owner.');
    anchor = { time, value: state.value, target: state.target, end: time + state.remainingSeconds };
    events.push(...state.future.map(event => ({ time: time + event.afterSeconds, value: event.value, duration: event.durationSeconds, sequence: event.sequence })));
    sequence = state.sequence; minimumTime = time; restored = true;
    try { rebuild(time); } catch (error) { fault = 'native-automation-restore-failed'; throw error; }
    return Object.freeze({ status: 'restaged-owned-automation', targetTimeSeconds: time, futureControls: events.length, activeRampSeconds: state.remainingSeconds, nativeDspState: 'not-included' });
  };

  param.setValueAtTime(initialValue, startTime);
  return { insert, valueAt, snapshot, restore, validateSnapshot, hasFutureEvents: now => events.some(event => event.time > Math.max(startTime, now)), canInsert: now => events.filter(event => event.time > Math.max(startTime, now)).length < maxEvents,
    diagnostics: () => Object.freeze({ queued: events.length, maxEvents, smoothingSeconds, restored, fault, minimumTime, interpolation: 'causal-linear-slew' }) };
}
