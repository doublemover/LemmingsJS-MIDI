import { flattenMidiClipPhrase } from '../project/MidiClipPlayback.js';
const MAX_GAME_PHRASE_VOICES = 16;
const MAX_GAME_PHRASE_NOTES = 8;
const MAX_ROLLING_PHRASE_LANES = 1024;
const MAX_ROLLING_PHRASE_DISPATCHES = 16;

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
    this._rollingDue = []; this._rollingCursor = 0; this._rollingPasses = new Uint32Array(MAX_ROLLING_PHRASE_LANES);
  }

  clear() {
    this.voices.clear();
    this.tick = null;
    this._rollingDue.length = 0; this._rollingCursor = 0; this._rollingPasses.fill(0);
  }

  transferActorLane(id, from, to, laneCount) {
    const changedKeys = new Map();
    for (const [key, voice] of [...this.voices]) {
      if (voice.meta.lemmingId !== id || voice.meta.laneIndex !== from) continue;
      voice.meta = { ...voice.meta, originLaneIndex: voice.meta.originLaneIndex ?? from, laneIndex: to, laneCount };
      const nextKey = voice.rolling ? transferGamePhraseVoiceKey(key, null, from, to) : voice.cells ? key : transferGamePhraseVoiceKey(key, id, from, to);
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
    this._rollingDue.length = 0;
    for (const [key, voice] of this.voices) {
      if (voice.rolling) { if (voice.dueTick <= tick && (onlyKey == null || onlyKey === key)) this._rollingDue.push(key); continue; }
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
    const due = this._rollingDue, start = this._rollingCursor % Math.max(1, due.length), count = Math.min(MAX_ROLLING_PHRASE_DISPATCHES, due.length);
    for (let index = 0; index < count; index++) {
      const key = due[(start + index) % due.length], voice = this.voices.get(key);
      if (!voice) continue;
      // Drop expired cells instead of replaying a delayed burst after a crowded tick.
      while (voice.notes.length && voice.originTick + voice.notes[0].offsetTicks < tick - voice.lateTicks) {
        voice.notes.shift(); voice.onDrop?.('rolling-phrase-expired', voice.meta);
      }
      const cell = voice.notes[0];
      if (cell && voice.originTick + cell.offsetTicks <= tick) {
        voice.notes.shift(); send({ ...cell, phraseVoiceKey: key }, voice.meta, tick);
      }
      if (!voice.notes.length) { this.voices.delete(key); voice.onComplete?.(); }
      else voice.dueTick = voice.originTick + voice.notes[0].offsetTicks;
    }
    if (onlyKey == null) this._rollingCursor = due.length ? (start + count) % due.length : this._rollingCursor;
  }

  _makeRoom(key, rolling) {
    this.voices.delete(key);
    let count = 0, oldest = null;
    for (const [candidate, voice] of this.voices) if (!!voice.rolling === rolling) { count++; oldest ??= candidate; }
    if (count >= (rolling ? MAX_ROLLING_PHRASE_LANES : MAX_GAME_PHRASE_VOICES)) this.voices.delete(oldest);
  }

  nextRollingPass(lane) {
    lane = Math.max(0, Math.min(MAX_ROLLING_PHRASE_LANES - 1, Math.trunc(lane) || 0));
    return this._rollingPasses[lane] = Math.min(0xffffffff, this._rollingPasses[lane] + 1);
  }

  replaceRolling(key, notes, spec, meta, tick, { spacingTicks, startOffsetTicks = 1, onComplete, onDrop } = {}) {
    if (!key || !Number.isInteger(tick) || tick < 0 || !notes?.length) return false;
    if (this.tick != null && (tick < this.tick || tick > this.tick + 1)) this.clear();
    this.tick = tick;
    if (this.voices.get(key)?.rolling) return 'coalesced';
    const spacing = Math.max(1, Math.min(4096, Number(spacingTicks) || 1));
    const start = Math.max(1, Math.min(4096, Math.round(startOffsetTicks) || 1));
    const cells = notes.slice(0, MAX_GAME_PHRASE_NOTES).filter(Number.isFinite).map((note, index) => ({
      ...spec, note, offsetTicks: start + Math.round(index * spacing), stepIndex: index, stepCount: Math.min(MAX_GAME_PHRASE_NOTES, notes.length)
    }));
    if (!cells.length) return false;
    this._makeRoom(key, true);
    this.voices.set(key, { rolling: true, cells: true, notes: cells, meta: { ...meta }, originTick: tick,
      dueTick: tick + cells[0].offsetTicks, lateTicks: Math.max(1, Math.min(8, Math.floor(spacing / 2))), onComplete, onDrop });
    return true;
  }

  replaceSteps(key, cells, meta, tick, spacingTicks, onComplete = null) {
    if (!key || !Number.isInteger(tick) || tick < 0 || !cells?.length) return false;
    if (this.tick != null && (tick < this.tick || tick > this.tick + 1)) this.clear();
    this.tick = tick; this._makeRoom(key, false);
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
    this._makeRoom(key, false);
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

export { MAX_GAME_PHRASE_VOICES, MAX_GAME_PHRASE_NOTES, MAX_ROLLING_PHRASE_LANES, MAX_ROLLING_PHRASE_DISPATCHES, MidiGamePhraseQueue, transferGamePhraseVoiceKey };
