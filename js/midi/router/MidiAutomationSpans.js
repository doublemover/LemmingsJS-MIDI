import { MAX_MIDI_AUTOMATION_SPANS, MAX_MIDI_AUTOMATION_SPAN_STATES, sanitizeMidiAutomationSpan,
  clampMidiAutomationSpanValue, previewMidiAutomationSpan, SPAN_TARGET_RANGES } from '../project/MidiAutomationSpan.js';
const sourceMatches = (entry, meta) => {
  const span = entry.span, lane = meta.laneIndex ?? 0, condition = span.condition;
  if (!Number.isInteger(lane) || lane < 0 || lane >= 1024) return false;
  if (entry.scope === 'track' && (!entry.trackId || entry.trackId !== meta.trackId)) return false;
  if (span.laneScope !== 'global' && (lane < span.laneStart || lane > span.laneEnd)) return false;
  if (condition.sfxId != null && condition.sfxId !== meta.sfxId) return false;
  if (condition.triggerType != null && condition.triggerType !== meta.triggerType) return false;
  return true;
};
const matchingKey = entry => JSON.stringify([entry.scope, entry.scope === 'track' ? entry.trackId : null,
  entry.span.laneScope === 'global' ? 0 : entry.span.laneStart, entry.span.laneScope === 'global' ? 1023 : entry.span.laneEnd,
  entry.span.condition.sfxId, entry.span.condition.triggerType]);
/** Bounded counters and span evaluation. No timers, actor scans or autonomous output. */
class MidiAutomationSpans {
  constructor(entries) { this.states = new Map(); this._resolutionStates = new Array(MAX_MIDI_AUTOMATION_SPANS).fill(null); this.configure(entries); this.reset(); }
  configure(entries) {
    const compiled = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (compiled.length >= MAX_MIDI_AUTOMATION_SPANS) break;
      const span = sanitizeMidiAutomationSpan(entry?.span);
      if (!span || entry.enabled === false || !Object.hasOwn(SPAN_TARGET_RANGES, entry.target)) continue;
      compiled.push({ index: compiled.length, id: String(entry.id || 'span-' + compiled.length).slice(0, 128), target: entry.target,
        scope: entry.scope === 'track' ? 'track' : 'global', trackId: typeof entry.trackId === 'string' ? entry.trackId.slice(0, 128) : null,
        min: clampMidiAutomationSpanValue(entry.target, entry.min), max: clampMidiAutomationSpanValue(entry.target, entry.max), span });
    }
    for (const entry of compiled) entry.matchingKey = matchingKey(entry);
    const key = JSON.stringify(compiled);
    if (key === this.key) return;
    const previous = new Map((this.entries || []).map(entry => [entry.id, entry]));
    const counts = new Float64Array(compiled.length * 1024), lastEvents = new Float64Array(compiled.length * 1024), retained = new Map();
    for (const entry of compiled) {
      const old = previous.get(entry.id);
      if (old?.matchingKey === entry.matchingKey) {
        entry.owner = old.owner; retained.set(entry.id, entry);
        const start = old.index * 1024, destination = entry.index * 1024;
        counts.set(this.counts.subarray(start, start + 1024), destination);
        lastEvents.set(this.lastEvents.subarray(start, start + 1024), destination);
      } else { this._ownerSequence = (this._ownerSequence || 0) + 1; entry.owner = this._ownerSequence; }
    }
    this._resolutionStates.fill(null);
    this.entries = compiled; this.key = key; this.counts = counts; this.lastEvents = lastEvents;
    const states = new Map();
    for (const [stateKey, state] of this.states) {
      const entry = retained.get(state.id);
      if (!entry) continue;
      const copy = { ...state, entryIndex: entry.index, resolution: null };
      this._evaluate(entry, copy, { beat: state.beat, bar: state.bar, distance: state.distance, distanceSource: state.distanceSource, tick: state.tick }, state.originEventCount);
      states.set(stateKey, copy);
    }
    this.states = states;
  }
  reset() { this.epoch = (this.epoch || 0) + 1; this.states.clear(); this._resolutionStates.fill(null); this.counts?.fill(0); this.lastEvents?.fill(0); this.generation = null; this.tick = null; this.evaluation = 0; }
  synchronize(generation, tick) {
    const changed = this.generation != null && (this.generation !== generation || Number.isFinite(tick) && tick < this.tick);
    if (changed) this.reset();
    this.generation = generation; this.tick = Number.isFinite(tick) ? tick : this.tick;
    return changed;
  }
  _state(entry, lane) {
    const key = entry.id + '/' + lane;
    let state = this.states.get(key);
    if (!state) {
      if (this.states.size >= MAX_MIDI_AUTOMATION_SPAN_STATES) this.states.delete(this.states.keys().next().value);
      state = { id: entry.id, entryIndex: entry.index, laneIndex: lane, eventCount: 0, originEventCount: 0, active: false, conditionMatched: false,
        phase: 0, spanPass: 0, bar: 1, beat: null, distance: null, distanceSource: null, value: null, tick: null, resolution: null };
      this.states.set(key, state);
    }
    return state;
  }
  observeOrigin(meta, position) {
    const counts = [];
    for (const entry of this.entries) {
      if (!sourceMatches(entry, meta)) continue;
      const state = this._state(entry, meta.laneIndex ?? 0);
      const slot = entry.index * 1024 + (meta.laneIndex ?? 0);
      if (Number.isFinite(meta.automationEventId) && meta.automationEventId > this.lastEvents[slot]) {
        this.lastEvents[slot] = meta.automationEventId; this.counts[slot] = Math.min(Number.MAX_SAFE_INTEGER, this.counts[slot] + 1);
      }
      counts.push(Object.freeze({ id: entry.id, owner: entry.owner, epoch: this.epoch, count: this.counts[slot] }));
      this._evaluate(entry, state, position, this.counts[slot]);
    }
    return Object.freeze(counts);
  }
  _evaluate(entry, state, position, originCount = null) {
    const span = entry.span, preview = previewMidiAutomationSpan(entry, span.domain === 'beats' ? position.beat : position.distance);
    const condition = span.condition;
    state.eventCount = this.counts[entry.index * 1024 + state.laneIndex];
    state.originEventCount = Number.isFinite(originCount) ? originCount : state.eventCount;
    const count = condition.unit === 'bar' ? position.bar : condition.unit === 'pass' ? preview?.spanPass || 0 : state.originEventCount;
    state.beat = position.beat; state.bar = position.bar; state.distance = position.distance; state.distanceSource = position.distanceSource; state.tick = position.tick;
    state.phase = preview?.phase ?? 0; state.spanPass = preview?.spanPass ?? 0; state.value = preview?.value ?? null;
    state.conditionMatched = condition.every === 1 || count > 0 && count % condition.every === condition.phase;
    state.active = !!preview?.active && state.conditionMatched;
    return state;
  }
  values(meta, position) {
    const winners = new Map(); this._resolutionStates.fill(null);
    const origins = Array.isArray(meta.automationEventCounts) ? new Map(meta.automationEventCounts.map(origin => [origin.id, origin])) : null;
    for (const entry of this.entries) {
      if (!sourceMatches(entry, meta)) continue;
      const origin = origins?.get(entry.id);
      const ordinal = origins ? origin?.owner === entry.owner && origin.epoch === this.epoch ? origin.count : 0 : null;
      const state = this._evaluate(entry, this._state(entry, meta.laneIndex ?? 0), position, ordinal);
      this._resolutionStates[entry.index] = state;
      if (!state.active) continue;
      const previous = winners.get(entry.target);
      if (!previous || entry.span.priority >= previous.priority) winners.set(entry.target, { id: entry.id, value: state.value,
        priority: entry.span.priority, phase: state.phase, spanPass: state.spanPass });
    }
    const evaluation = this.evaluation = Math.min(Number.MAX_SAFE_INTEGER, this.evaluation + 1);
    // Retain the last resolved note evaluation, independently of later origin observations.
    // Reuse one record per cached state; no output or clock is created by inspection.
    for (const entry of this.entries) {
      const state = this._resolutionStates[entry.index]; if (!state) continue;
      this._resolutionStates[entry.index] = null;
      const winner = winners.get(entry.target);
      if (!state.resolution) state.resolution = {};
      Object.assign(state.resolution, { evaluation, target: entry.target, laneIndex: state.laneIndex,
        tick: state.tick, beat: state.beat, distance: state.distance, distanceSource: state.distanceSource,
        phase: state.phase, spanPass: state.spanPass, bar: state.bar, originEventCount: state.originEventCount, value: state.value, active: state.active, conditionMatched: state.conditionMatched,
        winnerId: winner?.id ?? null, winnerValue: winner?.value ?? null, won: winner?.id === entry.id });
    }
    return winners;
  }
  snapshot(id, lane = 0) {
    const state = this.states.get(String(id) + '/' + lane);
    if (!state) return null;
    const { entryIndex, ...copy } = state;
    return Object.freeze({ ...copy, resolution: state.resolution ? Object.freeze({ ...state.resolution }) : null, generation: this.generation });
  }
}
export { MidiAutomationSpans };
