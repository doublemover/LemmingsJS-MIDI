import { MAX_GAME_PHRASE_NOTES } from '../scheduler/MidiGamePhraseQueue.js';
import { MAX_EVENTS_PER_TICK } from './MidiEventRouterShared.js';

const midiEventRouterPhraseMethods = {
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
      timeMs: now,
      durationTicks: Math.max(1, Math.min(960, Math.round(Number(spec.durationTicks) || 1)))
    };
    const currentMeta = { ...meta };
    delete currentMeta.rateReserved;
    delete currentMeta.reservationId;
    ready = this._applyAutomationSpans(ready, currentMeta, tick, true);
    if (!ready) return false;
    ready = this._applyMusicTension(ready, currentMeta, tick);
    if (!ready) return false;
    if (!this._shouldSend(currentMeta, ready, this._planEntries(ready, now, 1), now)) {
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
      if (Number.isFinite(cells[0]?.note)) this._sendGamePhraseNote(cells[0], meta, tick, true);
      return;
    }
    const key = JSON.stringify([event.sfxId, event.triggerType ?? null, spec.trackId ?? null, spec.outputId ?? null, spec.channel ?? null]);
    const queue = this.scheduler.gamePhrases;
    if (!queue?.replaceSteps(key, cells, meta, tick, spacingTicks, onComplete)) return;
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
