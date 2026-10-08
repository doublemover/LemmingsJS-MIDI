import { MAX_GAME_PHRASE_NOTES } from '../scheduler/MidiGamePhraseQueue.js';
import { MAX_EVENTS_PER_TICK } from './MidiEventRouterShared.js';

const midiEventRouterPhraseMethods = {
  _sendGamePhraseNote(spec, meta, tick, counted = false) {
    if (!this.mapping.config?.enabled) return false;
    if (!this.scheduler.hasOutput?.(spec.outputId ?? null)) return false;
    if (this._tickCounter.tick !== tick) this._tickCounter = { tick, count: 0 };
    const maxPerTick = Math.min(Math.max(this.mapping.config?.limits?.maxEventsPerTick ?? MAX_EVENTS_PER_TICK, 1), MAX_EVENTS_PER_TICK);
    if (!counted && this._tickCounter.count >= maxPerTick) return false;
    if (!counted) this._tickCounter.count += 1;
    const now = this._nowMs();
    const ready = {
      ...spec,
      timeMs: now,
      durationTicks: Math.max(1, Math.min(960, Math.round(Number(spec.durationTicks) || 1)))
    };
    const currentMeta = { ...meta };
    delete currentMeta.rateReserved;
    delete currentMeta.reservationId;
    if (!this._shouldSend(currentMeta, ready, this._planEntries(ready, now, 1), now)) return false;
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
    const key = JSON.stringify([event.sfxId, event.triggerType ?? null, spec.trackId ?? null, spec.outputId ?? null, spec.channel ?? null]);
    const queue = this.scheduler.gamePhrases;
    if (!queue) return;
    queue.replace(key, bounded, spec, meta, tick, spec.phrase.spacingTicks);
    queue.advance(tick,
      (ready, details, atTick) => this._sendGamePhraseNote(ready, details, atTick, true),
      voice => this.scheduler.isGamePhraseVoiceBusy(voice), key);
  },

  _queueGameEventClip(event, spec, meta, cells, spacingTicks) {
    const tick = Number.isInteger(event.tick) ? event.tick : this._phraseTimer?.getGameTicks?.();
    if (event.reverse || !this._phraseTimer?.onGameTick || !Number.isInteger(tick)) {
      this.scheduler.gamePhrases?.clear();
      if (Number.isFinite(cells[0]?.note)) this._sendGamePhraseNote(cells[0], meta, tick, true);
      return;
    }
    const key = JSON.stringify([event.sfxId, event.triggerType ?? null, spec.trackId ?? null, spec.outputId ?? null, spec.channel ?? null]);
    const queue = this.scheduler.gamePhrases;
    if (!queue?.replaceSteps(key, cells, meta, tick, spacingTicks)) return;
    queue.advance(tick, (ready, details, atTick) => this._sendGamePhraseNote(ready, details, atTick, true), () => false, key);
  },

  _advanceGamePhrases() {
    const timer = this._phraseTimer;
    const queue = this.scheduler.gamePhrases;
    if (!timer || !queue) return;
    if (!this.mapping.config?.enabled || this.context?.game?.timeTravel?.isReversing) {
      queue.clear();
      return;
    }
    this.scheduler.setTickMs(this._tickMsFromEvent({ tps: timer.tps, frameMs: timer.frameTime }));
    queue.advance(timer.getGameTicks?.(),
      (spec, meta, tick) => this._sendGamePhraseNote(spec, meta, tick),
      key => this.scheduler.isGamePhraseVoiceBusy(key));
  }
};

export { midiEventRouterPhraseMethods };
