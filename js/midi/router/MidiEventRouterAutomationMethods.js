import { getMidiEnsembleRole } from '../project/MidiEnsemble.js';
const midiEventRouterAutomationMethods = {
  getAutomationSpanState(id, lane = 0) { return this.automationSpans.snapshot(id, lane); },
  _releaseAutomationVoices() {
    if (!this.scheduler?._activeNotes?.[Symbol.iterator]) return;
    for (const [token, voice] of this.scheduler._activeNotes) if (voice.automationSpanned) this.scheduler._stopActiveNoteToken(token);
  },
  _resetAutomationSpans() {
    this.automationSpans.reset(); this._automationEventSerial = 0;
    this._releaseAutomationVoices(); this.scheduler.gamePhrases?.clear();
  },
  _syncAutomationSpans(tick) {
    if (!this.automationSpans.entries.length) return;
    const world = this.context?.game || null;
    if (world !== this._automationWorld) { this._resetAutomationSpans(); this._automationWorld = world; }
    if (this.automationSpans.synchronize(world?.generation ?? 0, tick)) {
      this._automationEventSerial = 0; this._releaseAutomationVoices(); this.scheduler.gamePhrases?.clear();
    }
  },
  _automationPosition(meta, tick, queued = false) {
    const world = this.context?.game, timer = this._phraseTimer || world?.getGameTimer?.();
    const origin = Number.isFinite(world?.generationStartTick) ? world.generationStartTick : 0;
    const baseMs = Number.isFinite(timer?.TIME_PER_FRAME_MS) && timer.TIME_PER_FRAME_MS > 0 ? timer.TIME_PER_FRAME_MS : 60;
    const tempo = this.mapping.config?.timing?.bpmBase;
    const bpm = Number.isFinite(tempo) ? Math.max(20, tempo) : 120;
    const rawBeat = Number.isFinite(tick) ? Math.max(0, tick - origin) * baseMs / 60000 * bpm : null;
    const beat = Number.isFinite(rawBeat) ? Math.min(Number.MAX_SAFE_INTEGER, rawBeat) : null;
    const signature = this.mapping.config?.timing?.timeSignature;
    const beatsPerBar = Math.max(1, signature?.beats || 4) * 4 / Math.max(1, signature?.unit || 4);
    let distance = Number.isFinite(meta.eventWorldX) ? meta.eventWorldX : null, distanceSource = distance == null ? null : 'event-origin';
    if (queued && typeof world?.getLaneMusicActorPosition === 'function') {
      const position = world.getLaneMusicActorPosition(meta.lemmingId, meta.laneIndex ?? 0);
      if (Number.isFinite(position?.x) && Number.isFinite(position.tick) && position.tick <= tick && (position.generation == null || position.generation === world.generation)) {
        distance = position.x; distanceSource = 'completed-actor';
      }
    }
    return { tick, beat, bar: beat == null ? 1 : Math.floor(beat / beatsPerBar) + 1, distance, distanceSource };
  },
  _observeAutomationEvent(event) {
    if (!this.automationSpans.entries.length) return null;
    this._syncAutomationSpans(event.tick);
    const config = this.mapping.config, source = this.mapping.getSfxConfig(event.sfxId) || {};
    const mapping = event.triggerType != null ? { ...source, ...config.triggers?.[String(event.triggerType)] } : source;
    let trackId = mapping.trackId ?? null;
    if (config.ensemble?.enabled && trackId === config.ensemble.sourceTrackId) trackId = getMidiEnsembleRole(config.ensemble, event)?.trackId ?? trackId;
    const meta = { automationEventId: ++this._automationEventSerial, laneIndex: event.laneIndex ?? 0,
      lemmingId: event.lemmingId, sfxId: event.sfxId, triggerType: event.triggerType ?? null, trackId, eventWorldX: event.x };
    const automationEventCounts = this.automationSpans.observeOrigin(meta, this._automationPosition(meta, event.tick));
    return { automationEventId: meta.automationEventId, automationEventCounts, eventWorldX: event.x };
  },
  _applyAutomationSpans(spec, meta, tick, queued = false) {
    if (!this.automationSpans.entries.length) return spec;
    this._syncAutomationSpans(tick);
    const position = this._automationPosition(meta, tick, queued), values = this.automationSpans.values({ ...meta, trackId: spec.trackId ?? meta.trackId }, position);
    if (!values.size) return spec;
    meta.automationSpanIds = [...values.values()].map(value => value.id);
    if (this.scheduler._captureEnabled?.()) Object.assign(meta, { automationBeat: position.beat, automationDistance: position.distance, distanceSource: position.distanceSource });
    return this.mapping.applySpanValues(spec, values);
  }
};
export { midiEventRouterAutomationMethods };
