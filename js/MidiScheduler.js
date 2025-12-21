import { Lemmings } from './LemmingsNamespace.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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
    this.setConfig(config);
  }

  setConfig(config) {
    this.config = config || {};
    const maxActive = this.config.limits?.maxActiveNotes ?? 32;
    this._maxActiveNotes = clamp(maxActive, 1, 32);
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

  sendNote(spec) {
    if (!this.output || !spec || !Number.isFinite(spec.note)) return false;
    const channelNumber = this.config.mpe?.enabled
      ? this._allocateChannel()
      : (spec.channel ?? this.config.defaultChannel ?? 1);
    const channel = this.output.channels?.[channelNumber];
    if (!channel) return false;

    const durationMs = Math.max(0, spec.durationTicks * this.tickMs);
    const velocity = clamp(spec.velocity ?? 64, 1, 127);
    const timbreCc = this.config.mpe?.timbreCc ?? 74;

    if (this.config.mpe?.enabled) {
      if (Number.isFinite(spec.pitchBend) && spec.pitchBend !== 0) {
        channel.sendPitchBend(clamp(spec.pitchBend, -1, 1));
      } else {
        channel.sendPitchBend(0);
      }
      if (spec.timbre != null && Number.isFinite(spec.timbre)) {
        channel.sendControlChange(timbreCc, clamp(spec.timbre, 0, 127));
      }
    }
    if (spec.pan != null && Number.isFinite(spec.pan)) {
      const panRange = this.config.position?.panRange;
      const signedPan = (panRange?.min ?? 0) < 0;
      let panValue = spec.pan;
      if (signedPan) {
        panValue = Math.round((clamp(panValue, -127, 127) + 127) / 2);
      }
      channel.sendControlChange(10, clamp(panValue, 0, 127));
    }

    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const token = ++this._noteOffSeq;
    if (this._activeNotes.size >= this._maxActiveNotes) {
      this._stealOldestNote();
    }

    channel.sendNoteOn(spec.note, { rawAttack: velocity });

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
      this._scheduleNoteOff({
        timeMs: startedAt + durationMs,
        channel: channelNumber,
        note: spec.note,
        token,
        mpe: !!this.config.mpe?.enabled
      });
    }
    return true;
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
      const channel = this.output.channels?.[entry.channel];
      const active = this._activeNotes.get(entry.token);
      if (active && channel) {
        channel.sendNoteOff(entry.note);
        if (entry.mpe) {
          channel.sendPitchBend(0);
          this._activeByChannel.delete(entry.channel);
        }
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
  }

  dispose() {
    for (const [ch] of this._activeByChannel.entries()) {
      this._stopActiveChannel(ch);
    }
    this._activeByChannel.clear();
    this._activeNotes.clear();
    this._noteOffs.length = 0;
    if (this._noteOffTimerId) {
      clearTimeout(this._noteOffTimerId);
      this._noteOffTimerId = 0;
    }
    this.output = null;
  }
}

Lemmings.MidiScheduler = MidiScheduler;
export { MidiScheduler };
