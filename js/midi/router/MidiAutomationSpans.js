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
/** Bounded counters and span evaluation. No timers, actor scans or autonomous output. */
class MidiAutomationSpans {
  constructor(entries) { this.states = new Map(); this.configure(entries); this.reset(); }
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
    const key = JSON.stringify(compiled);
    if (key !== this.key) { this.entries = compiled; this.key = key;
      this.counts = new Float64Array(compiled.length * 1024); this.lastEvents = new Float64Array(compiled.length * 1024); this.reset(); }
  }
  reset() { this.states.clear(); this.counts?.fill(0); this.lastEvents?.fill(0); this.generation = null; this.tick = null; }
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
        phase: 0, spanPass: 0, bar: 1, beat: null, distance: null, distanceSource: null, value: null, tick: null };
      this.states.set(key, state);
    }
    return state;
  }
  observeOrigin(meta, position) {
    const counts = new Array(this.entries.length).fill(null);
    for (const entry of this.entries) {
      if (!sourceMatches(entry, meta)) continue;
      const state = this._state(entry, meta.laneIndex ?? 0);
      const slot = entry.index * 1024 + (meta.laneIndex ?? 0);
      if (Number.isFinite(meta.automationEventId) && meta.automationEventId > this.lastEvents[slot]) {
        this.lastEvents[slot] = meta.automationEventId; this.counts[slot] = Math.min(Number.MAX_SAFE_INTEGER, this.counts[slot] + 1);
      }
      counts[entry.index] = this.counts[slot];
      this._evaluate(entry, state, position, counts[entry.index]);
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
    state.conditionMatched = count > 0 && count % condition.every === condition.phase;
    state.active = !!preview?.active && state.conditionMatched;
    return state;
  }
  values(meta, position) {
    const winners = new Map();
    for (const entry of this.entries) {
      if (!sourceMatches(entry, meta)) continue;
      const state = this._evaluate(entry, this._state(entry, meta.laneIndex ?? 0), position, meta.automationEventCounts?.[entry.index]);
      if (!state.active) continue;
      const previous = winners.get(entry.target);
      if (!previous || entry.span.priority >= previous.priority) winners.set(entry.target, { id: entry.id, value: state.value,
        priority: entry.span.priority, phase: state.phase, spanPass: state.spanPass });
    }
    return winners;
  }
  snapshot(id, lane = 0) {
    const state = this.states.get(String(id) + '/' + lane);
    if (!state) return null;
    const { entryIndex, ...copy } = state;
    return Object.freeze({ ...copy, generation: this.generation });
  }
}
export { MidiAutomationSpans };
