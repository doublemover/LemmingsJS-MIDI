const MAX_DIRECTION_LANES = 1024, MAX_PENDING_CUES = 64;
const GAINS = Object.freeze({ exploration: { bass: 0.62, melody: 0.72, rhythm: 0, percussion: 0 }, construction: { bass: 0.85, melody: 0.88, rhythm: 0.78, percussion: 0.6 }, relief: { bass: 0.68, melody: 0.88, rhythm: 0.52, percussion: 0 } });
class MidiMusicDirector {
  constructor() { this.reset(); }
  reset() {
    this.world = null; this.generation = null; this.tick = null; this.epoch = null; this.clock = null;
    this.current = 'exploration'; this.previous = 'exploration'; this.committedBeat = -Infinity;
    this.candidate = 'exploration'; this.candidateBeat = 0; this.pending = null;
    this.reliefUntil = -Infinity; this.cooldownUntil = -Infinity;
    this.cues = new Map(); this.seen = new Map(); this.foreground = null; this.cueStatus = 'idle';
  }
  bind(world, tick, epoch, clock) {
    const generation = world?.generation ?? 0;
    const changed = this.world !== world || this.generation !== generation || this.epoch !== epoch || this.clock !== clock ||
      this.tick != null && (tick < this.tick || tick > this.tick + 1);
    if (changed) this.reset();
    this.world = world; this.generation = generation; this.tick = tick; this.epoch = epoch; this.clock = clock;
    return changed;
  }
  observe(position, working) {
    const desired = position.beat < this.reliefUntil ? 'relief' : working ? 'construction' : 'exploration';
    if (desired !== this.candidate) { this.candidate = desired; this.candidateBeat = position.beat; this.pending = null; }
    if (desired === this.current) { this.pending = null; return; }
    if (!this.pending && position.beat - this.candidateBeat >= 1) {
      this.pending = { state: desired, beat: Math.max((Math.floor(position.beat / position.quartersPerBar) + 1) * position.quartersPerBar, this.committedBeat + position.quartersPerBar) };
    }
    if (this.pending && position.beat + 1e-12 >= this.pending.beat) {
      this.previous = this.current; this.current = this.pending.state; this.committedBeat = this.pending.beat; this.pending = null;
    }
  }
  request(event, spec, meta, position) {
    const lane = event.laneIndex ?? 0, id = event.crewProjectId;
    if (!Number.isInteger(lane) || lane < 0 || lane >= MAX_DIRECTION_LANES || typeof id !== 'string' || !id || id.length > 128 ||
        event.generation !== this.generation || !event.routeRevisionsUnchanged || !(event.ordinaryCrossings > 0) || !Number.isInteger(event.tick)) return false;
    const seen = this.seen.get(lane);
    if (seen && (seen.ids.includes(id) || event.tick <= seen.tick)) return false;
    this.seen.set(lane, { ids: [...(seen?.ids || []).slice(-7), id], tick: event.tick });
    if (!this.cues.has(lane) && this.cues.size >= MAX_PENDING_CUES) return false;
    const cue = { id, lane, generation: event.generation, event: { ...event }, spec: { ...spec }, meta: { ...meta },
      beat: Math.max(Math.floor(position.beat + 1e-12) + 1, this.cooldownUntil), expires: position.beat + position.quartersPerBar * 8 };
    this.cues.set(lane, cue); this.cueStatus = 'pending'; return true;
  }
  ready(position, relevant, queued) {
    for (const [lane, cue] of this.cues) if (position.beat > cue.expires || !relevant(cue)) this.cues.delete(lane);
    const active = this.foreground;
    if (active) {
      if (!relevant(active.cue) || position.beat > active.cue.expires || active.key && !queued(active.key) && !active.complete) return { cancel: true };
      if (!active.complete) return null;
      if (active.phase === 'reply' || !active.admitted) { this.cueStatus = active.admitted ? 'idle' : 'thinned'; this.foreground = null; return null; }
      if (position.beat > active.replyBeat + 1 / position.ticksPerQuarter + 1e-12) { this.cueStatus = 'idle'; this.foreground = null; return null; }
      this.cueStatus = 'reply-pending';
      if (position.beat + 1e-12 >= active.replyBeat) return { cue: active.cue, phase: 'reply' };
      return null;
    }
    if (position.beat + 1e-12 < this.cooldownUntil) return null;
    for (const cue of this.cues.values()) if (position.beat + 1e-12 >= cue.beat) { this.cues.delete(cue.lane); return { cue, phase: 'lead' }; }
    if (!this.cues.size && this.cueStatus === 'pending') this.cueStatus = 'idle';
    return null;
  }
  started(cue, phase, key, position) {
    if (phase === 'lead') this.foreground = { cue, phase, key, admitted: false, complete: false, replyBeat: Math.max(cue.beat, Math.floor(position.beat)) + position.quartersPerBar };
    else Object.assign(this.foreground, { phase, key, admitted: false, complete: false });
    this.cueStatus = phase === 'lead' ? 'pending' : 'reply-pending';
  }
  admitted(key, position) {
    const active = this.foreground; if (!active || active.key !== key) return;
    if (!active.admitted && active.phase === 'lead') {
      this.cooldownUntil = Math.floor(position.beat) + position.quartersPerBar * 4;
      this.reliefUntil = Math.floor(position.beat) + position.quartersPerBar * 2;
    }
    active.admitted = true;
  }
  completed(key) { if (this.foreground?.key === key) this.foreground.complete = true; }
  apply(spec, position) {
    if (!spec.ensembleRole || spec.musicDirectionCue) return spec;
    const blend = Math.max(0, Math.min(1, position.beat - this.committedBeat));
    const previous = GAINS[this.previous][spec.ensembleRole] ?? 1, next = GAINS[this.current][spec.ensembleRole] ?? 1;
    const gain = previous + (next - previous) * blend;
    return gain <= 0 ? null : { ...spec, velocity: Math.max(1, Math.min(127, Math.round(spec.velocity * gain))) };
  }
  snapshot(position) { return { enabled: true, current: this.current, pending: this.pending?.state ?? null,
    nextBar: this.pending ? Math.floor(this.pending.beat / position.quartersPerBar) + 1 : null, cue: this.cueStatus }; }
}
export { MidiMusicDirector, MAX_DIRECTION_LANES, MAX_PENDING_CUES };
