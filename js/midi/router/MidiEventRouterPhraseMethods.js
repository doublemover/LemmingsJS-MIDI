import { quantizeToScale, resolveScale } from '../midi-mapping/MidiMappingDomain.js';
import { flattenMidiClipPhrase } from '../project/MidiClipPlayback.js';
import { MAX_GAME_PHRASE_NOTES } from '../scheduler/MidiGamePhraseQueue.js';
import { MAX_EVENTS_PER_TICK } from './MidiEventRouterShared.js';

const midiEventRouterPhraseMethods = {
  _syncGamePhraseGeneration() {
    const world = this.context?.game || null, generation = world?.generation ?? 0;
    if (this._phraseGenerationWorld === world && this._phraseGeneration === generation) return;
    const previouslyBound = this._phraseGenerationWorld !== undefined;
    this._phraseGenerationWorld = world; this._phraseGeneration = generation;
    if (!previouslyBound) return;
    // Generation resets can retain monotonic ticks, including without spans or tension.
    for (const [token, voice] of this.scheduler._activeNotes) if (voice.phraseVoiceKey) this.scheduler._stopActiveNoteToken(token);
    this.scheduler.gamePhrases.clear();
    this._arpStateBySfx.clear(); this._lastTickBySfx.clear();
    this._lastAcceptedBySfx.clear(); this._repeatHistoryByKey.clear();
  },
  _sendGamePhraseNote(spec, meta, tick, counted = false) {
    if (!this.mapping.config?.enabled) return false;
    if (!this.scheduler.hasOutput?.(spec.outputId ?? null)) return false;
    meta = { ...meta, ...this._captureBeatFields(tick) };
    if (!this._hasTickBudget(tick, meta.laneIndex, meta.laneCount)) {
      this.scheduler.recordThrottle?.('tick-limit', this._nowMs(), meta);
      return false;
    }
    const now = this._nowMs();
    let ready = {
      ...spec,
      timeMs: Number.isFinite(spec.clipScheduleAheadMs) ? now + spec.clipScheduleAheadMs : now,
      durationTicks: Math.max(1, Math.min(960, Math.round(Number(spec.durationTicks) || 1)))
    };
    const currentMeta = { ...meta };
    delete currentMeta.rateReserved;
    delete currentMeta.reservationId;
    ready = this._applyAutomationSpans(ready, currentMeta, tick, true);
    if (!ready) return false;
    ready = this._applyMusicTension(ready, currentMeta, tick);
    if (!ready) return false;
    if (!this._shouldSend(currentMeta, ready, this._planEntries(ready, ready.timeMs, 1), now)) {
      this.scheduler.recordThrottle?.(this._lastRateReport?.reason || 'count-limit', now, currentMeta);
      return false;
    }
    this._hasTickBudget(tick, meta.laneIndex, meta.laneCount, true);
    let sent = false;
    try {
      sent = this.scheduler.sendNote(ready, currentMeta);
    } catch (error) {
      this.scheduler.gamePhrases?.clear();
      this.scheduler.allNotesOff();
    }
    if (sent) this._lastAcceptedBySfx.set(meta.sfxId, now);
    return sent;
  },

  _queueGameRollingPhrase(event, spec, meta, notes, rolling) {
    const tick = event.tick, queue = this.scheduler.gamePhrases;
    if (event.reverse || !Number.isInteger(tick) || !this._phraseTimer?.onGameTick || !queue) return;
    // A lane/role responds as one finite phrase; collisions do not restart its tail.
    const key = JSON.stringify([event.laneIndex ?? 0, null, 'rolling-bounce', null, spec.trackId ?? null, spec.outputId ?? null, spec.channel ?? null]);
    if (queue.voices.get(key)?.rolling) {
      this.scheduler._observe?.('coalesced', { ...meta, type: 'event', count: 1, reason: 'rolling-phrase-origin' });
      return;
    }
    const passKey = 'rolling:' + key, pass = queue.nextRollingPass(event.laneIndex ?? 0);
    this._storeArpState(passKey, { index: pass, dir: 1, length: 8 });
    const scale = resolveScale(this.mapping.config.scale), range = this.mapping.config.noteRange;
    const role = this.mapping.config.ensemble?.roles.find(role => role.id === spec.ensembleRole);
    const low = Math.max(range.min, role?.register.min ?? range.min), high = Math.min(range.max, role?.register.max ?? range.max);
    const pitches = notes.slice(0, MAX_GAME_PHRASE_NOTES).filter(Number.isFinite).sort((a, b) => a - b);
    if (!pitches.length) return;
    const phrase = Array.from({ length: 8 }, (_, index) => {
      if (spec.percussion) return pitches[index % pitches.length];
      let note = quantizeToScale(pitches[index % pitches.length] + ((pass - 1 + Math.floor(index / 4)) % 3) * rolling.evolve, scale);
      while (note < low) note += 12;
      while (note > high) note -= 12;
      if (note < low || note > high) {
        for (let candidate = low; candidate <= high; candidate++) if (scale.degrees.includes(((candidate - scale.root) % 12 + 12) % 12)) return candidate;
        return null;
      }
      return note;
    }).filter(Number.isFinite);
    const timer = this._phraseTimer, timing = this.mapping.config.timing, baseMs = timer.TIME_PER_FRAME_MS || 60;
    const ticksPerBeat = 60000 / Math.max(20, timing.bpmBase || 120) / baseMs;
    const beatsPerBar = Math.max(1, timing.timeSignature?.beats || 4) * 4 / Math.max(1, timing.timeSignature?.unit || 4);
    const origin = this.context?.game?.generationStartTick || 0, beat = (tick - origin) / ticksPerBeat;
    const startOffsetTicks = Math.max(1, Math.ceil((Math.floor(beat) + 1) * ticksPerBeat + origin - tick));
    queue.replaceRolling(key, phrase, { ...spec, notes: null, arp: null, phrase: null }, meta, tick, {
      startOffsetTicks, spacingTicks: ticksPerBeat * beatsPerBar * rolling.bars / 8,
      onDrop: (reason, details) => this.scheduler.recordThrottle?.(reason, this._nowMs(), details)
    });
  },

  _queueGameEventPhrase(event, spec, meta, notes) {
    const bounded = notes.slice(0, MAX_GAME_PHRASE_NOTES).sort((a, b) => a - b);
    if (spec.phrase.mode === 'down') bounded.reverse();
    if (!bounded.length) return;
    const tick = Number.isInteger(event.tick) ? event.tick : this._phraseTimer?.getGameTicks?.();
    if (event.reverse || !this._phraseTimer?.onGameTick || !Number.isInteger(tick)) {
      this.scheduler.gamePhrases?.clear();
      this._sendGamePhraseNote({ ...spec, note: bounded[0] }, meta, tick, true);
      return;
    }
    const key = JSON.stringify([event.laneIndex ?? 0, event.lemmingId ?? null, event.sfxId, event.triggerType ?? null, spec.trackId ?? null, spec.outputId ?? null, spec.channel ?? null]);
    const queue = this.scheduler.gamePhrases;
    if (!queue) return;
    queue.replace(key, bounded, spec, meta, tick, spec.phrase.spacingTicks);
    queue.advance(tick,
      (ready, details, atTick) => this._sendGamePhraseNote(ready, details, atTick, true),
      voice => this.scheduler.isGamePhraseVoiceBusy(voice), key);
  },

  _queueGameEventClip(event, spec, meta, cells, spacingTicks, onComplete = null) {
    const tick = Number.isInteger(event.tick) ? event.tick : this._phraseTimer?.getGameTicks?.();
    if (event.reverse || !this._phraseTimer?.onGameTick || !Number.isInteger(tick)) {
      this.scheduler.gamePhrases?.clear();
      const expanded = flattenMidiClipPhrase(cells, spacingTicks);
      for (const cell of expanded.entries) if (cell.offsetTicks === 0 && Number.isFinite(cell.note)) this._sendGamePhraseNote(cell, meta, tick, true);
      if (expanded.entries.some(cell => cell.offsetTicks > 0 && Number.isFinite(cell.note))) this.scheduler.recordThrottle?.('clip-game-clock-unavailable', this._nowMs(), meta);
      return;
    }
    const key = JSON.stringify([event.sfxId, event.triggerType ?? null, spec.trackId ?? null, spec.outputId ?? null, spec.channel ?? null]);
    const queue = this.scheduler.gamePhrases;
    if (!queue?.replaceSteps(key, cells, meta, tick, spacingTicks, onComplete)) return;
    if (queue.voices.get(key)?.expansionTruncated) this.scheduler.recordThrottle?.('clip-expansion-cap', this._nowMs(), meta);
    queue.advance(tick, (ready, details, atTick) => this._sendGamePhraseNote(ready, details, atTick, true), () => false, key);
  },

  _advanceGamePhrases() {
    const timer = this._phraseTimer;
    const queue = this.scheduler.gamePhrases;
    if (!timer || !queue) return;
    if (!this.mapping.config?.enabled || this.context?.game?.timeTravel?.isReversing) {
      if (this.context?.game?.timeTravel?.isReversing) { this.musicTension.reset(); this._releaseTensionVoices(); this._resetAutomationSpans(); }
      queue.clear();
      return;
    }
    this.scheduler.setTickMs(this._tickMsFromEvent({ tps: timer.tps, frameMs: timer.frameTime }));
    const tick = timer.getGameTicks?.();
    this._syncGamePhraseGeneration();
    this._updateMusicTension(tick);
    this._syncAutomationSpans(tick);
    if (Number.isInteger(tick) && queue.tick != null && tick < queue.tick) {
      this._arpStateBySfx.clear(); this._lastTickBySfx.clear();
    }
    queue.advance(tick,
      (spec, meta, tick) => this._sendGamePhraseNote(spec, meta, tick),
      key => this.scheduler.isGamePhraseVoiceBusy(key));
  }
};

export { midiEventRouterPhraseMethods };
