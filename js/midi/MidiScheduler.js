const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const MIDI_BITS_PER_SECOND = 31250;
const MIDI_BYTES_PER_SECOND = MIDI_BITS_PER_SECOND / 8;
const MIDI_MESSAGE_BYTES = 3;

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

  setConfig(config) {
    this.config = config || {};
    const maxActive = this.config.limits?.maxActiveNotes ?? 32;
    this._maxActiveNotes = clamp(maxActive, 1, 32);
    const maxMessages = this.config.limits?.maxEventsPerSecond ?? 1000;
    const maxBytes = this.config.limits?.maxBytesPerSecond ?? MIDI_BYTES_PER_SECOND;
    this._maxMessagesPerSecond = clamp(maxMessages, 1, 1000);
    this._maxBytesPerSecond = Math.max(1, maxBytes);
    this._memberChannels = this.config.mpe?.memberChannels?.slice() || [];
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
    const master = mpe.masterChannel || 1;
    const members = mpe.memberChannels || [];
    const channels = [master, ...members];
    for (const ch of channels) {
      const channel = this.output.channels?.[ch];
      if (!channel) continue;
      channel.sendPitchBendRange(bend.semitones, bend.cents);
      channel.sendPitchBend(0);
    }
    this._memberChannels = members.slice();
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
    if (channel) {
      channel.sendNoteOff(info.note);
      if (info.mpe) channel.sendPitchBend(0);
    }
    this._activeNotes.delete(oldestToken);
    if (info.mpe) {
      this._activeByChannel.delete(info.channel);
    }
    this._removeScheduledNoteOff(oldestToken);
  }

  _allocateChannel() {
    const mpe = this.config.mpe;
    if (!mpe?.enabled) {
      return this.config.defaultChannel || 1;
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
    return mpe.masterChannel || 1;
  }

  _pruneRateEntries(now) {
    const cutoff = now - this._rateWindowMs;
    if (this._rateSent.length) {
      this._rateSent = this._rateSent.filter(entry => entry.timeMs >= cutoff);
    }
    if (this._ratePlanned.length) {
      const remaining = [];
      for (const entry of this._ratePlanned) {
        if (entry.timeMs <= now) {
          this._rateSent.push(entry);
        } else {
          remaining.push(entry);
        }
      }
      this._ratePlanned = remaining;
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
    const now = this._nowMs();
    this._pruneRateEntries(now);
    if (entry.timeMs <= now) {
      this._rateSent.push(entry);
    } else {
      this._ratePlanned.push(entry);
    }
  }

  _checkByteRate(now = this._nowMs()) {
    const snapshot = this.getRateSnapshot(now);
    if (snapshot.past.bytes > this._maxBytesPerSecond || snapshot.next.bytes > this._maxBytesPerSecond) {
      if (now - this._lastRateErrorMs > 1000) {
        this._lastRateErrorMs = now;
        console.error(`MIDI throughput exceeded ${this._maxBytesPerSecond.toFixed(0)} bytes/sec`);
      }
    }
  }

  sendNote(spec, meta = {}) {
    const perfEnabled = typeof lemmings !== 'undefined' &&
      (lemmings.performanceAPI === true || lemmings.perfMetrics === true) &&
      typeof performance !== 'undefined' &&
      typeof performance.measure === 'function' &&
      typeof performance.now === 'function';
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      if (!this.output || !spec || !Number.isFinite(spec.note)) return false;
      const channelNumber = this.config.mpe?.enabled
        ? this._allocateChannel()
        : (spec.channel ?? this.config.defaultChannel ?? 1);
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
        this._recordPlanned({
          timeMs: sendTimeMs,
          count: messages - (durationMs > 0 ? 1 + (this.config.mpe?.enabled ? 1 : 0) : 0),
          bytes: (messages - (durationMs > 0 ? 1 + (this.config.mpe?.enabled ? 1 : 0) : 0)) * MIDI_MESSAGE_BYTES,
          sfxId: meta.sfxId ?? null,
          priority: meta.priority ?? 1
        });
        if (durationMs > 0) {
          const offMessages = 1 + (this.config.mpe?.enabled ? 1 : 0);
          this._recordPlanned({
            timeMs: offTimeMs,
            count: offMessages,
            bytes: offMessages * MIDI_MESSAGE_BYTES,
            sfxId: meta.sfxId ?? null,
            priority: meta.priority ?? 1
          });
        }
      }
      this._checkByteRate(sendTimeMs);
      return true;
    } finally {
      if (perfEnabled) {
        try {
          performance.measure('MidiScheduler sendNote', {
            start: perfStart,
            detail: { devtools: { track: 'MidiScheduler', trackGroup: 'MIDI', color: 'secondary', tooltipText: 'sendNote' } }
          });
        } catch {
          /* ignored */
        }
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
    const channels = mpe?.enabled
      ? [mpe.masterChannel || 1, ...(mpe.memberChannels || [])]
      : [this.config.defaultChannel || 1];
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

  clearQueue() {
    this._noteOffs.length = 0;
    if (this._noteOffTimerId) {
      clearTimeout(this._noteOffTimerId);
      this._noteOffTimerId = 0;
    }
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
