import { getAppContext } from '../../core/dependencies.js';
import {
  canMeasurePerformance,
  recordPerformanceMeasure
} from '../../util/performanceInstrumentation.js';
import {
  MAX_RATE_ENTRIES,
  MIDI_BYTES_PER_SECOND,
  MIDI_MESSAGE_BYTES,
  clamp,
  normalizeChannelNumber,
  toFiniteNumber,
  toPositiveInt
} from './MidiSchedulerShared.js';

const midiSchedulerChannelMethods = {
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
  },

  setOutput(output) {
    this.output = output;
    this._initMpe();
  },

  setTickMs(tickMs) {
    if (Number.isFinite(tickMs) && tickMs > 0) {
      this.tickMs = tickMs;
    }
  },

  _nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  },

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
  },

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
  },

  _removeScheduledNoteOff(token) {
    if (token == null || !this._noteOffs.length) return;
    for (let i = this._noteOffs.length - 1; i >= 0; i--) {
      if (this._noteOffs[i].token === token) {
        this._noteOffs.splice(i, 1);
      }
    }
    this._armNoteOffTimer();
  },

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
      this._recordSent({
        timeMs: this._nowMs(),
        count: sentMessages,
        bytes: sentMessages * MIDI_MESSAGE_BYTES,
        token: oldestToken,
        phase: 'off'
      });
    }
  },

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
  },
};

export { midiSchedulerChannelMethods };
