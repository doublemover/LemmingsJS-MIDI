import { getAppContext } from '../core/dependencies.js';
import {
  canMeasurePerformance,
  recordPerformanceMeasure
} from '../util/performanceInstrumentation.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const MIDI_BITS_PER_SECOND = 31250;
const MIDI_BYTES_PER_SECOND = MIDI_BITS_PER_SECOND / 8;
const MIDI_MESSAGE_BYTES = 3;
const MAX_RATE_ENTRIES = 4096;
const toFiniteNumber = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const toPositiveInt = (value, fallback) => {
  const numeric = Math.trunc(toFiniteNumber(value, fallback));
  return numeric > 0 ? numeric : fallback;
};
const normalizeChannelNumber = (value, fallback = 1) => {
  const numeric = Math.trunc(toFiniteNumber(value, fallback));
  return clamp(numeric, 1, 16);
};

/**
 * Schedule MIDI note on/off traffic with channel allocation, MPE, and rate limits.
 */
class MidiScheduler {
  constructor(config = {}) {
    this.output = null;
    this.tickMs = 60;
    this._activeByChannel = new Map();
    this._activeNotes = new Map();
    this._maxActiveNotes = 32;
    this._memberChannels = [];
    this._noteOffs = [];
    this._noteOffTimerId = 0;
    this._noteOffSeq = 0;
    this._rateWindowMs = 1000;
    this._rateSent = [];
    this._ratePlanned = [];
    this._maxMessagesPerSecond = 1000;
    this._maxBytesPerSecond = MIDI_BYTES_PER_SECOND;
    this._lastRateErrorMs = 0;
    this.setConfig(config);
  }

  /**
   * Apply runtime scheduler configuration.
   * @param {object} config
   */
  setConfig(config) {
    this.config = config || {};
    const maxActive = toPositiveInt(this.config.limits?.maxActiveNotes, 32);
    this._maxActiveNotes = clamp(maxActive, 1, 32);
    const maxMessages = toPositiveInt(this.config.limits?.maxEventsPerSecond, 1000);
    const maxBytes = toPositiveInt(this.config.limits?.maxBytesPerSecond, MIDI_BYTES_PER_SECOND);
    this._maxMessagesPerSecond = clamp(maxMessages, 1, 1000);
    this._maxBytesPerSecond = maxBytes;
    const members = Array.isArray(this.config.mpe?.memberChannels) ? this.config.mpe.memberChannels : [];
    this._memberChannels = members
      .map((channel) => normalizeChannelNumber(channel))
      .filter((channel, index, list) => list.indexOf(channel) === index);
    if (this.output) this._initMpe();
  }

  setOutput(output) {
    this.output = output;
    this._initMpe();
  }

  setTickMs(tickMs) {
    if (Number.isFinite(tickMs) && tickMs > 0) {
      this.tickMs = tickMs;
    }
  }

  _nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  _initMpe() {
    if (!this.output) return;
    const mpe = this.config.mpe;
    if (!mpe?.enabled) return;
    const bend = mpe.pitchBendRange || { semitones: 2, cents: 0 };
    const master = normalizeChannelNumber(mpe.masterChannel, 1);
    const members = Array.isArray(mpe.memberChannels)
      ? mpe.memberChannels.map((channel) => normalizeChannelNumber(channel))
      : [];
    const uniqueMembers = members
      .filter((channel, index, list) => channel !== master && list.indexOf(channel) === index);
    const channels = [master, ...uniqueMembers];
    for (const ch of channels) {
      const channel = this.output.channels?.[ch];
      if (!channel) continue;
      channel.sendPitchBendRange(bend.semitones, bend.cents);
      channel.sendPitchBend(0);
    }
    this._memberChannels = uniqueMembers.slice();
  }

  _stopActiveChannel(channelNumber) {
    const active = this._activeByChannel.get(channelNumber);
    if (!active || !this.output) return;
    const channel = this.output.channels?.[channelNumber];
    if (channel) {
      channel.sendNoteOff(active.note);
      channel.sendPitchBend(0);
    }
    this._activeByChannel.delete(channelNumber);
    if (active.token != null) {
      this._activeNotes.delete(active.token);
      this._removeScheduledNoteOff(active.token);
    }
  }

  _removeScheduledNoteOff(token) {
    if (token == null || !this._noteOffs.length) return;
    for (let i = this._noteOffs.length - 1; i >= 0; i--) {
      if (this._noteOffs[i].token === token) {
        this._noteOffs.splice(i, 1);
      }
    }
    this._armNoteOffTimer();
  }

  _stealOldestNote() {
    if (!this._activeNotes.size || !this.output) return;
    let oldestToken = null;
    let oldestTime = Infinity;
    for (const [token, info] of this._activeNotes.entries()) {
      if (info.startedAt < oldestTime) {
        oldestTime = info.startedAt;
        oldestToken = token;
      }
    }
    if (oldestToken == null) return;
    const info = this._activeNotes.get(oldestToken);
    if (!info) return;
    const channel = this.output.channels?.[info.channel];
    let sentMessages = 0;
    if (channel) {
      channel.sendNoteOff(info.note);
      sentMessages += 1;
      if (info.mpe) {
        channel.sendPitchBend(0);
        sentMessages += 1;
      }
    }
    this._activeNotes.delete(oldestToken);
    if (info.mpe) {
      this._activeByChannel.delete(info.channel);
    }
    this._removeScheduledNoteOff(oldestToken);
    this._removePlannedRateEntries(oldestToken, 'off');
    if (sentMessages > 0) {
      this._recordPlanned({
        timeMs: this._nowMs(),
        count: sentMessages,
        bytes: sentMessages * MIDI_MESSAGE_BYTES,
        token: oldestToken,
        phase: 'off'
      });
    }
  }

  _allocateChannel() {
    const mpe = this.config.mpe;
    if (!mpe?.enabled) {
      return normalizeChannelNumber(this.config.defaultChannel, 1);
    }
    for (const ch of this._memberChannels) {
      if (!this._activeByChannel.has(ch)) {
        return ch;
      }
    }
    let oldest = null;
    let oldestTime = Infinity;
    for (const [ch, info] of this._activeByChannel.entries()) {
      if (info.startedAt < oldestTime) {
        oldestTime = info.startedAt;
        oldest = ch;
      }
    }
    if (oldest != null) {
      this._stopActiveChannel(oldest);
      return oldest;
    }
    return normalizeChannelNumber(mpe.masterChannel, 1);
  }

  _pruneRateEntries(now) {
    const cutoff = now - this._rateWindowMs;
    if (this._rateSent.length) {
      let write = 0;
      for (let read = 0; read < this._rateSent.length; read += 1) {
        const entry = this._rateSent[read];
        if (entry.timeMs < cutoff) continue;
        this._rateSent[write] = entry;
        write += 1;
      }
      this._rateSent.length = write;
    }
    if (this._ratePlanned.length) {
      let write = 0;
      for (let read = 0; read < this._ratePlanned.length; read += 1) {
        const entry = this._ratePlanned[read];
        if (entry.timeMs <= now) {
          this._rateSent.push(entry);
        } else {
          this._ratePlanned[write] = entry;
          write += 1;
        }
      }
      this._ratePlanned.length = write;
    }
    this._trimRateEntries();
  }

  _trimRateEntries() {
    if (this._rateSent.length > MAX_RATE_ENTRIES) {
      this._rateSent.splice(0, this._rateSent.length - MAX_RATE_ENTRIES);
    }
    if (this._ratePlanned.length > MAX_RATE_ENTRIES) {
      this._ratePlanned.splice(0, this._ratePlanned.length - MAX_RATE_ENTRIES);
    }
  }

  _sumRate(entries, startMs, endMs) {
    let count = 0;
    let bytes = 0;
    const bySfx = new Map();
    for (const entry of entries) {
      if (entry.timeMs < startMs || entry.timeMs >= endMs) continue;
      count += entry.count;
      bytes += entry.bytes;
      const key = entry.sfxId ?? 'unknown';
      const curr = bySfx.get(key) || { count: 0, bytes: 0, priority: entry.priority ?? 1 };
      curr.count += entry.count;
      curr.bytes += entry.bytes;
      if (entry.priority != null) curr.priority = entry.priority;
      bySfx.set(key, curr);
    }
    return { count, bytes, bySfx };
  }

  getRateSnapshot(now = this._nowMs()) {
    this._pruneRateEntries(now);
    const past = this._sumRate(this._rateSent, now - this._rateWindowMs, now);
    const next = this._sumRate(this._ratePlanned, now, now + this._rateWindowMs);
    return {
      now,
      past,
      next,
      maxMessagesPerSecond: this._maxMessagesPerSecond,
      maxBytesPerSecond: this._maxBytesPerSecond
    };
  }

  getUsageShare(window = 'past', now = this._nowMs()) {
    const snapshot = this.getRateSnapshot(now);
    const data = window === 'next' ? snapshot.next : snapshot.past;
    const total = data.count || 0;
    const totalBytes = data.bytes || 0;
    const shares = [];
    for (const [sfxId, entry] of data.bySfx.entries()) {
      shares.push({
        sfxId,
        count: entry.count,
        bytes: entry.bytes,
        priority: entry.priority ?? 1,
        percentCount: total ? entry.count / total : 0,
        percentBytes: totalBytes ? entry.bytes / totalBytes : 0
      });
    }
    shares.sort((a, b) => b.count - a.count);
    return shares;
  }

  estimateMessages(spec) {
    if (!spec || !Number.isFinite(spec.note)) return { messages: 0, bytes: 0 };
    let messages = 1;
    if (this.config.mpe?.enabled) {
      messages += 1;
    } else if (spec.pitchBend != null && Number.isFinite(spec.pitchBend) && spec.pitchBend !== 0) {
      messages += 1;
    }
    if (spec.timbre != null && Number.isFinite(spec.timbre)) messages += 1;
    if (spec.pan != null && Number.isFinite(spec.pan)) messages += 1;
    if (spec.durationTicks && spec.durationTicks > 0) {
      messages += 1;
      if (this.config.mpe?.enabled) messages += 1;
    }
    return { messages, bytes: messages * MIDI_MESSAGE_BYTES };
  }

  _recordPlanned(entry) {
    if (!entry || !Number.isFinite(entry.timeMs)) return;
    const count = Math.trunc(toFiniteNumber(entry.count, 0));
    if (count <= 0) return;
    const bytes = Math.trunc(toFiniteNumber(entry.bytes, count * MIDI_MESSAGE_BYTES));
    if (bytes <= 0) return;
    const normalized = { ...entry, count, bytes };
    const now = this._nowMs();
    this._pruneRateEntries(now);
    if (normalized.timeMs <= now) {
      this._rateSent.push(normalized);
    } else {
      this._ratePlanned.push(normalized);
    }
    this._trimRateEntries();
  }

  _removePlannedRateEntries(token, phase = null) {
    if (token == null || !this._ratePlanned.length) return;
    let write = 0;
    for (let read = 0; read < this._ratePlanned.length; read += 1) {
      const entry = this._ratePlanned[read];
      const remove = entry?.token === token && (phase == null || entry.phase === phase);
      if (remove) continue;
      this._ratePlanned[write] = entry;
      write += 1;
    }
    this._ratePlanned.length = write;
  }

  _checkByteRate(now = this._nowMs()) {
    const snapshot = this.getRateSnapshot(now);
    const pastCount = toFiniteNumber(snapshot.past?.count, 0);
    const nextCount = toFiniteNumber(snapshot.next?.count, 0);
    const pastBytes = toFiniteNumber(snapshot.past?.bytes, 0);
    const nextBytes = toFiniteNumber(snapshot.next?.bytes, 0);
    const overMessageRate = pastCount > this._maxMessagesPerSecond || nextCount > this._maxMessagesPerSecond;
    const overByteRate = pastBytes > this._maxBytesPerSecond || nextBytes > this._maxBytesPerSecond;
    if (overMessageRate || overByteRate) {
      if (now - this._lastRateErrorMs > 1000) {
        this._lastRateErrorMs = now;
        const limits = [];
        if (overMessageRate) limits.push(`${this._maxMessagesPerSecond.toFixed(0)} messages/sec`);
        if (overByteRate) limits.push(`${this._maxBytesPerSecond.toFixed(0)} bytes/sec`);
        console.error(`MIDI throughput exceeded ${limits.join(' and ')}`);
      }
    }
  }

  /**
   * Queue and transmit a note with optional expressive controls.
   * @param {object} spec
   * @param {object} [meta]
   * @returns {boolean} True when a note-on message was scheduled on an output channel.
   */
  sendNote(spec, meta = {}) {
    const app = this.config?.runtime?.app || getAppContext();
    const perfEnabled = !!app &&
      (app.performanceAPI === true || app.perfMetrics === true) &&
      canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      if (!this.output || !spec || !Number.isFinite(spec.note)) return false;
      const channelNumber = this.config.mpe?.enabled
        ? this._allocateChannel()
        : normalizeChannelNumber(spec.channel ?? this.config.defaultChannel, 1);
      const channel = this.output.channels?.[channelNumber];
      if (!channel) return false;

      const sendTimeMs = Number.isFinite(spec.timeMs) ? spec.timeMs : this._nowMs();
      const durationMs = Number.isFinite(spec.durationTicks)
        ? Math.max(0, spec.durationTicks * this.tickMs)
        : 0;
      const offTimeMs = sendTimeMs + durationMs;
      const baseVelocity = clamp(spec.velocity ?? 64, 1, 127);
      const baseRelease = clamp(spec.releaseVelocity ?? baseVelocity, 1, 127);
      const reverse = !!spec.reverse;
      const attackVelocity = reverse ? baseRelease : baseVelocity;
      const releaseVelocity = reverse ? baseVelocity : baseRelease;
      const timbreCc = this.config.mpe?.timbreCc ?? 74;

      if (this.config.mpe?.enabled) {
        if (Number.isFinite(spec.pitchBend) && spec.pitchBend !== 0) {
          channel.sendPitchBend(clamp(spec.pitchBend, -1, 1), { time: sendTimeMs });
        } else {
          channel.sendPitchBend(0, { time: sendTimeMs });
        }
        if (spec.timbre != null && Number.isFinite(spec.timbre)) {
          channel.sendControlChange(timbreCc, clamp(spec.timbre, 0, 127), { time: sendTimeMs });
        }
      }
      if (spec.pan != null && Number.isFinite(spec.pan)) {
        const panRange = this.config.position?.panRange;
        const signedPan = (panRange?.min ?? 0) < 0;
        let panValue = spec.pan;
        if (signedPan) {
          panValue = Math.round((clamp(panValue, -127, 127) + 127) / 2);
        }
        channel.sendControlChange(10, clamp(panValue, 0, 127), { time: sendTimeMs });
      }

      const startedAt = sendTimeMs;
      const token = ++this._noteOffSeq;
      if (this._activeNotes.size >= this._maxActiveNotes) {
        this._stealOldestNote();
      }

      channel.sendNoteOn(spec.note, { rawAttack: attackVelocity, time: sendTimeMs });
      if (typeof window !== 'undefined') {
        window.lastMidiOutputMessage = {
          type: 'noteOn',
          note: spec.note,
          velocity: attackVelocity,
          channel: channelNumber,
          timeMs: sendTimeMs
        };
      }

      this._activeNotes.set(token, {
        channel: channelNumber,
        note: spec.note,
        startedAt,
        token,
        mpe: !!this.config.mpe?.enabled
      });
      if (this.config.mpe?.enabled) {
        this._activeByChannel.set(channelNumber, {
          note: spec.note,
          startedAt,
          token
        });
      }
      if (durationMs > 0) {
        channel.sendNoteOff(spec.note, { rawRelease: releaseVelocity, time: offTimeMs });
        if (this.config.mpe?.enabled) {
          channel.sendPitchBend(0, { time: offTimeMs });
        }
        this._scheduleNoteOff({
          timeMs: offTimeMs,
          channel: channelNumber,
          note: spec.note,
          token,
          mpe: !!this.config.mpe?.enabled
        });
      }
      const { messages, bytes } = this.estimateMessages(spec);
      if (messages > 0) {
        const offMessages = durationMs > 0 ? (1 + (this.config.mpe?.enabled ? 1 : 0)) : 0;
        const immediateMessages = messages - offMessages;
        const immediateBytes = bytes - (offMessages * MIDI_MESSAGE_BYTES);
        this._recordPlanned({
          timeMs: sendTimeMs,
          count: immediateMessages,
          bytes: immediateBytes,
          token,
          phase: 'on',
          sfxId: meta.sfxId ?? null,
          priority: meta.priority ?? 1
        });
        if (durationMs > 0) {
          this._recordPlanned({
            timeMs: offTimeMs,
            count: offMessages,
            bytes: offMessages * MIDI_MESSAGE_BYTES,
            token,
            phase: 'off',
            sfxId: meta.sfxId ?? null,
            priority: meta.priority ?? 1
          });
        }
      }
      this._checkByteRate(sendTimeMs);
      return true;
    } finally {
      if (perfEnabled) {
        recordPerformanceMeasure('MidiScheduler sendNote', {
          start: perfStart,
          detail: { devtools: { track: 'MidiScheduler', trackGroup: 'MIDI', color: 'secondary', tooltipText: 'sendNote' } }
        });
      }
    }
  }

  _scheduleNoteOff(entry) {
    const list = this._noteOffs;
    list.push(entry);
    let i = list.length - 1;
    while (i > 0 && list[i - 1].timeMs > entry.timeMs) {
      list[i] = list[i - 1];
      i--;
    }
    list[i] = entry;
    if (i === 0) this._armNoteOffTimer();
  }

  _armNoteOffTimer() {
    if (this._noteOffTimerId) {
      clearTimeout(this._noteOffTimerId);
      this._noteOffTimerId = 0;
    }
    if (!this._noteOffs.length) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const delay = Math.max(0, this._noteOffs[0].timeMs - now);
    this._noteOffTimerId = setTimeout(() => this._processNoteOffs(), delay);
  }

  _processNoteOffs() {
    this._noteOffTimerId = 0;
    if (!this.output || !this._noteOffs.length) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let idx = 0;
    while (idx < this._noteOffs.length && this._noteOffs[idx].timeMs <= now + 1) {
      const entry = this._noteOffs[idx];
      const active = this._activeNotes.get(entry.token);
      if (active && entry.mpe) {
        this._activeByChannel.delete(entry.channel);
      }
      if (active) this._activeNotes.delete(entry.token);
      idx++;
    }
    if (idx > 0) {
      this._noteOffs.splice(0, idx);
    }
    this._armNoteOffTimer();
  }

  allNotesOff() {
    if (!this.output) return;
    const mpe = this.config.mpe;
    let channels;
    if (mpe?.enabled) {
      const master = normalizeChannelNumber(mpe.masterChannel, 1);
      const members = (Array.isArray(mpe.memberChannels) ? mpe.memberChannels : [])
        .map((channel) => normalizeChannelNumber(channel))
        .filter((channel, index, list) => channel !== master && list.indexOf(channel) === index);
      channels = [master, ...members];
    } else {
      channels = [normalizeChannelNumber(this.config.defaultChannel, 1)];
    }
    for (const ch of channels) {
      const channel = this.output.channels?.[ch];
      if (!channel) continue;
      channel.sendAllNotesOff?.();
      channel.sendPitchBend?.(0);
    }
    this._noteOffs.length = 0;
    if (this._noteOffTimerId) {
      clearTimeout(this._noteOffTimerId);
      this._noteOffTimerId = 0;
    }
    this._activeByChannel.clear();
    this._activeNotes.clear();
    this._noteOffs.length = 0;
    this._rateSent.length = 0;
    this._ratePlanned.length = 0;
  }

  /**
   * Drop pending note-off queue state without sending any MIDI output.
   * Active-note tracking is reset so subsequent scheduling starts cleanly.
   */
  clearQueue() {
    this._noteOffs.length = 0;
    if (this._noteOffTimerId) {
      clearTimeout(this._noteOffTimerId);
      this._noteOffTimerId = 0;
    }
    this._activeByChannel.clear();
    this._activeNotes.clear();
    this._rateSent.length = 0;
    this._ratePlanned.length = 0;
  }

  dispose() {
    for (const [ch] of this._activeByChannel.entries()) {
      this._stopActiveChannel(ch);
    }
    this._activeByChannel.clear();
    this._activeNotes.clear();
    this._noteOffs.length = 0;
    this._rateSent.length = 0;
    this._ratePlanned.length = 0;
    if (this._noteOffTimerId) {
      clearTimeout(this._noteOffTimerId);
      this._noteOffTimerId = 0;
    }
    this.output = null;
  }
}

export { MidiScheduler };
