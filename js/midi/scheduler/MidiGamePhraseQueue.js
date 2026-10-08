const MAX_GAME_PHRASE_VOICES = 16;
const MAX_GAME_PHRASE_NOTES = 8;

class MidiGamePhraseQueue {
  constructor() {
    this.voices = new Map();
    this.tick = null;
  }

  clear() {
    this.voices.clear();
    this.tick = null;
  }

  advance(tick, send, isBusy = () => false, onlyKey = null) {
    if (!Number.isInteger(tick) || tick < 0) return;
    if (this.tick != null && (tick < this.tick || tick > this.tick + 1)) {
      this.clear();
    }
    this.tick = tick;
    for (const [key, voice] of this.voices) {
      if (onlyKey != null && key !== onlyKey) continue;
      if (voice.dueTick > tick || (!voice.cells && isBusy(key))) continue;
      const note = voice.notes.shift();
      if (voice.cells) {
        if (Number.isFinite(note?.note)) send({ ...note, phraseVoiceKey: key }, voice.meta, tick);
      } else send({ ...voice.spec, note, phraseVoiceKey: key }, voice.meta, tick);
      if (voice.notes.length) voice.dueTick = tick + voice.spacingTicks;
      else this.voices.delete(key);
    }
  }

  replaceSteps(key, cells, meta, tick, spacingTicks) {
    if (!key || !Number.isInteger(tick) || tick < 0 || !cells?.length) return false;
    if (this.tick != null && (tick < this.tick || tick > this.tick + 1)) this.clear();
    this.tick = tick; this.voices.delete(key);
    while (this.voices.size >= MAX_GAME_PHRASE_VOICES) this.voices.delete(this.voices.keys().next().value);
    this.voices.set(key, { notes: cells.slice(0, 16).map(cell => ({ ...cell })), cells: true, meta: { ...meta }, dueTick: tick,
      spacingTicks: Math.max(1, Math.min(8, Math.round(Number(spacingTicks) || 2))) });
    return true;
  }

  replace(key, notes, spec, meta, tick, spacingTicks) {
    if (!key || !Number.isInteger(tick) || tick < 0) return false;
    const bounded = notes.slice(0, MAX_GAME_PHRASE_NOTES).filter(Number.isFinite);
    if (!bounded.length) return false;
    if (this.tick != null && (tick < this.tick || tick > this.tick + 1)) this.clear();
    this.tick = tick;
    this.voices.delete(key);
    while (this.voices.size >= MAX_GAME_PHRASE_VOICES) {
      this.voices.delete(this.voices.keys().next().value);
    }
    this.voices.set(key, {
      notes: bounded,
      spec: { ...spec },
      meta: { ...meta },
      dueTick: tick,
      spacingTicks: Math.max(1, Math.min(8, Math.round(Number(spacingTicks) || 2)))
    });
    return true;
  }
}

export { MAX_GAME_PHRASE_VOICES, MAX_GAME_PHRASE_NOTES, MidiGamePhraseQueue };
