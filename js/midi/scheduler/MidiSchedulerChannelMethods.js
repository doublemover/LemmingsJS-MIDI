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

const normalizeOutputId = (outputId) => (
  outputId == null || outputId === '' ? null : String(outputId)
);

const toOutputList = (outputs) => {
  if (!outputs) return [];
  if (Array.isArray(outputs)) return outputs;
  if (typeof outputs.values === 'function') return Array.from(outputs.values());
  return [];
};

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
    if (this.hasAnyOutput()) this._initMpe();
  },

  setOutput(output) {
    this.output = output || null;
    if (this.output) this._registerOutput(this.output);
    this._initMpe(this.output);
  },

  setOutputs(outputs) {
    this._outputsById.clear();
    for (const output of toOutputList(outputs)) {
      this._registerOutput(output);
    }
    if (this.output) this._registerOutput(this.output);
    this._initMpe();
  },

  hasAnyOutput() {
    return !!this.output || this._outputsById.size > 0;
  },

  hasOutput(outputId = null) {
    return !!this._resolveOutput(outputId);
  },

  _registerOutput(output) {
    const id = normalizeOutputId(output?.id);
    if (id && output) this._outputsById.set(id, output);
  },

  _resolveOutputId(outputId = null) {
    return normalizeOutputId(outputId);
  },

  _resolveOutput(outputId = null) {
    const id = this._resolveOutputId(outputId);
    if (id) {
      return this._outputsById.get(id) ||
        (normalizeOutputId(this.output?.id) === id ? this.output : null);
    }
    return this.output;
  },

  _listOutputs() {
    const outputs = [];
    const seenIds = new Set();
    const seenOutputs = new Set();
    const addOutput = (output) => {
      if (!output || seenOutputs.has(output)) return;
      const id = normalizeOutputId(output.id);
      if (id && seenIds.has(id)) return;
      outputs.push(output);
      seenOutputs.add(output);
      if (id) seenIds.add(id);
    };
    addOutput(this.output);
    for (const output of this._outputsById.values()) {
      addOutput(output);
    }
    return outputs;
  },

  _activeChannelKey(channelNumber, outputId = null) {
    const id = this._resolveOutputId(outputId);
    return id ? `${id}:${channelNumber}` : channelNumber;
  },

  setTickMs(tickMs) {
    if (Number.isFinite(tickMs) && tickMs > 0) {
      this.tickMs = tickMs;
    }
  },

  _nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  },

  _initMpe(output = undefined) {
    const outputs = output === undefined
      ? this._listOutputs()
      : (output ? [output] : []);
    if (!outputs.length) return;
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
    for (const targetOutput of outputs) {
      for (const ch of channels) {
        const channel = targetOutput.channels?.[ch];
        if (!channel) continue;
        channel.sendPitchBendRange(bend.semitones, bend.cents);
        channel.sendPitchBend(0);
      }
    }
    this._memberChannels = uniqueMembers.slice();
  },

  _stopActiveChannel(channelNumber, outputId = null) {
    const activeKey = this._activeChannelKey(channelNumber, outputId);
    const active = this._activeByChannel.get(activeKey);
    const resolvedOutputId = active?.outputId ?? outputId;
    const output = this._resolveOutput(resolvedOutputId);
    if (!active || !output) return;
    const channel = output.channels?.[channelNumber];
    if (channel) {
      channel.sendNoteOff(active.note);
      channel.sendPitchBend(0);
    }
    this._activeByChannel.delete(activeKey);
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
    if (!this._activeNotes.size || !this.hasAnyOutput()) return;
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
    const output = this._resolveOutput(info.outputId);
    if (!output) return;
    const channel = output.channels?.[info.channel];
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
      this._activeByChannel.delete(this._activeChannelKey(info.channel, info.outputId));
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

  _allocateChannel(outputId = null) {
    const mpe = this.config.mpe;
    if (!mpe?.enabled) {
      return normalizeChannelNumber(this.config.defaultChannel, 1);
    }
    const normalizedOutputId = this._resolveOutputId(outputId);
    for (const ch of this._memberChannels) {
      if (!this._activeByChannel.has(this._activeChannelKey(ch, normalizedOutputId))) {
        return ch;
      }
    }
    let oldest = null;
    let oldestTime = Infinity;
    for (const [ch, info] of this._activeByChannel.entries()) {
      if (this._resolveOutputId(info?.outputId) !== normalizedOutputId) continue;
      if (info.startedAt < oldestTime) {
        oldestTime = info.startedAt;
        oldest = info.channel ?? ch;
      }
    }
    if (oldest != null) {
      this._stopActiveChannel(oldest, normalizedOutputId);
      return oldest;
    }
    return normalizeChannelNumber(mpe.masterChannel, 1);
  },
};

export { midiSchedulerChannelMethods };
