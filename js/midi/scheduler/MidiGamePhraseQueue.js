import { flattenMidiClipPhrase } from '../project/MidiClipPlayback.js';
const MAX_GAME_PHRASE_VOICES = 16;
const MAX_GAME_PHRASE_NOTES = 8;

const transferGamePhraseVoiceKey = (key, id, from, to) => {
  try {
    const parts = JSON.parse(key);
    if (Array.isArray(parts) && parts.length === 7 && parts[0] === from && parts[1] === id) {
      parts[0] = to; return JSON.stringify(parts);
    }
  } catch { /* Non-router keys retain their existing ownership. */ }
  return key;
};

class MidiGamePhraseQueue {
  constructor() {
    this.voices = new Map();
    this.tick = null;
  }

  clear() {
    this.voices.clear();
    this.tick = null;
  }

  transferActorLane(id, from, to, laneCount) {
    const changedKeys = new Map();
    for (const [key, voice] of [...this.voices]) {
      if (voice.meta.lemmingId !== id || voice.meta.laneIndex !== from) continue;
      voice.meta = { ...voice.meta, originLaneIndex: voice.meta.originLaneIndex ?? from, laneIndex: to, laneCount };
      const nextKey = voice.cells ? key : transferGamePhraseVoiceKey(key, id, from, to);
      if (nextKey !== key) {
        this.voices.delete(key);
        if (!this.voices.has(nextKey)) this.voices.set(nextKey, voice);
        changedKeys.set(key, nextKey);
      }
    }
    return changedKeys;
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
      if (voice.cells) {
        while (voice.notes.length && voice.dueTick <= tick) {
          const note = voice.notes.shift();
          if (Number.isFinite(note?.note)) send({ ...note, phraseVoiceKey: key }, voice.meta, tick);
          voice.dueTick = voice.originTick + (voice.notes[0]?.offsetTicks ?? 0);
        }
      } else {
        const note = voice.notes.shift(); send({ ...voice.spec, note, phraseVoiceKey: key }, voice.meta, tick);
        voice.dueTick = tick + voice.spacingTicks;
      }
      if (!voice.notes.length) { this.voices.delete(key); voice.onComplete?.(); }
    }
  }

  replaceSteps(key, cells, meta, tick, spacingTicks, onComplete = null) {
    if (!key || !Number.isInteger(tick) || tick < 0 || !cells?.length) return false;
    if (this.tick != null && (tick < this.tick || tick > this.tick + 1)) this.clear();
    this.tick = tick; this.voices.delete(key);
    while (this.voices.size >= MAX_GAME_PHRASE_VOICES) this.voices.delete(this.voices.keys().next().value);
    const expanded = flattenMidiClipPhrase(cells, Math.max(1, Math.min(8, Math.round(Number(spacingTicks) || 2))));
    this.voices.set(key, { notes: expanded.entries, expansionTruncated: expanded.truncated, originTick: tick, cells: true, onComplete, meta: { ...meta }, dueTick: tick + expanded.entries[0].offsetTicks,
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

export { MAX_GAME_PHRASE_VOICES, MAX_GAME_PHRASE_NOTES, MidiGamePhraseQueue, transferGamePhraseVoiceKey };
