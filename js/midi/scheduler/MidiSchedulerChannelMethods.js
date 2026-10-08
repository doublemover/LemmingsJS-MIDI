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

const normalizeTrackId = (trackId) => (
  trackId == null || trackId === '' ? null : String(trackId)
);

const toOutputList = (outputs) => {
  if (!outputs) return [];
  if (Array.isArray(outputs)) return outputs;
  if (typeof outputs.values === 'function') return Array.from(outputs.values());
  return [];
};

const midiSchedulerChannelMethods = {
  setConfig(config) {
    const mpeChanged = JSON.stringify(this.config?.mpe) !== JSON.stringify(config?.mpe) ||
      (this.config?.enabled === false && config?.enabled !== false);
    const phraseConfigKey = JSON.stringify([
      config?.enabled, config?.sfx, config?.triggers, config?.scale, config?.noteRange,
      config?.velocityRange, config?.durationTicks, config?.density, config?.envelope,
      config?.position, config?.mpe, config?.limits, config?.defaultChannel, config?.timing,
      config?.repeat, config?.reverse
    ]);
    if (phraseConfigKey !== this._gamePhraseConfigKey) this.gamePhrases.clear();
    this._gamePhraseConfigKey = phraseConfigKey;
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
    if (this.hasAnyOutput() && mpeChanged) this._initMpe();
  },

  setOutput(output) {
    if ((output || null) !== this.output) this.gamePhrases.clear();
    this.output = output || null;
    if (this.output) this._registerOutput(this.output);
    this._initMpe(this.output);
  },

  setOutputs(outputs) {
    const nextOutputs = toOutputList(outputs);
    const previousOutputs = [...this._outputsById.values()];
    if (previousOutputs.some(output => !nextOutputs.includes(output))) this.gamePhrases.clear();
    this._outputsById.clear();
    for (const output of nextOutputs) {
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
    return normalizeOutputId(outputId) ?? normalizeOutputId(this.output?.id);
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

  _expressionState(output, channelNumber) {
    let channels = this._expressionByOutput.get(output);
    if (!channels) { channels = new Map(); this._expressionByOutput.set(output, channels); }
    let state = channels.get(channelNumber);
    if (!state) { state = {}; channels.set(channelNumber, state); }
    return state;
  },

  _ensembleChannels() {
    const ensemble = this.config.ensemble;
    return new Set(ensemble?.enabled ? (ensemble.roles || []).filter(role => role.track).map(role =>
      normalizeChannelNumber(role.track.channel, 1)) : []);
  },

  _isMpeNote(spec) {
    return !!this.config.mpe?.enabled && !spec?.ensembleRole;
  },

  _expressionPlan(spec, output, channelNumber, estimating = false) {
    const state = output ? this._expressionState(output, channelNumber) : {};
    const channel = output?.channels?.[channelNumber];
    const uncertain = estimating && (this._isMpeNote(spec) || [...this._pendingNoteOns.values()].some(pending =>
      pending.output === output && pending.channel === channelNumber));
    const controls = [];
    const add = (key, value, type, cc = null, bytes = MIDI_MESSAGE_BYTES) => {
      if (uncertain || state[key] !== value) controls.push({ key, value, type, cc, bytes });
    };
    if (!output?.supportsPerNoteInstrument && Number.isInteger(spec.program) && spec.program >= 0 && spec.program <= 127 &&
      (!output || typeof channel?.sendProgramChange === 'function')) add('program', spec.program, 'program', null, 2);
    if (this._isMpeNote(spec) || Number.isFinite(spec.pitchBend)) add('bend', clamp(spec.pitchBend ?? 0, -1, 1), 'bend');
    if (Number.isFinite(spec.timbre)) add('timbre', clamp(spec.timbre, 0, 127), 'cc', this.config.mpe?.timbreCc ?? 74);
    if (Number.isFinite(spec.pan) && !output?.supportsPerNotePan && (!spec.spatialPan || this._isMpeNote(spec))) {
      const signed = (this.config.position?.panRange?.min ?? 0) < 0;
      const value = signed ? Math.round((clamp(spec.pan, -127, 127) + 127) / 2) : clamp(spec.pan, 0, 127);
      add('pan', value, 'cc', 10);
    }
    return { state, controls, messages: controls.length, bytes: controls.reduce((sum, control) => sum + control.bytes, 0) };
  },

  _activeChannelKey(channelNumber, outputId = null) {
    const id = this._resolveOutputId(outputId);
    return id ? `${id}:${channelNumber}` : channelNumber;
  },

  _normalizeTrackId(trackId = null) {
    return normalizeTrackId(trackId);
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
    if (this.config?.enabled === false) return;
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
    const reserved = this._ensembleChannels();
    const uniqueMembers = members
      .filter((channel, index, list) => channel !== master && list.indexOf(channel) === index && !reserved.has(channel));
    const channels = [master, ...uniqueMembers].filter(channel => !reserved.has(channel));
    for (const targetOutput of outputs) {
      for (const ch of channels) {
        const channel = targetOutput.channels?.[ch];
        if (!channel) continue;
        channel.sendPitchBendRange(bend.semitones, bend.cents);
        channel.sendPitchBend(0);
        this._expressionState(targetOutput, ch).bend = 0;
      }
    }
    this._memberChannels = uniqueMembers.slice();
  },

  _stopActiveChannel(channelNumber, outputId = null) {
    const activeKey = this._activeChannelKey(channelNumber, outputId);
    const active = this._activeByChannel.get(activeKey);
    if (active?.token != null && this._activeNotes.has(active.token)) {
      this._stopActiveNoteToken(active.token);
      return;
    }
    const resolvedOutputId = active?.outputId ?? outputId;
    const output = this._resolveOutput(resolvedOutputId);
    if (!active || !output) return;
    const channel = output.channels?.[channelNumber];
    if (channel) {
      channel.sendNoteOff(active.note);
      channel.sendPitchBend(0);
      this._expressionState(output, channelNumber).bend = 0;
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

  _findOldestActiveNote(matches = null) {
    if (!this._activeNotes?.size || typeof this._activeNotes.entries !== 'function') return null;
    let oldestToken = null;
    let oldestTime = Infinity;
    for (const [token, info] of this._activeNotes.entries()) {
      if (!info || (matches && !matches(info, token))) continue;
      if (info.startedAt < oldestTime) {
        oldestTime = info.startedAt;
        oldestToken = token;
      }
    }
    return oldestToken;
  },

  _countActiveNotesForTrack(trackId) {
    const normalized = normalizeTrackId(trackId);
    if (!normalized || !this._activeNotes?.size || typeof this._activeNotes.entries !== 'function') return 0;
    let count = 0;
    for (const [, info] of this._activeNotes.entries()) {
      if (normalizeTrackId(info?.trackId) === normalized) count += 1;
    }
    return count;
  },

  _stealOldestNoteForTrack(trackId) {
    const normalized = normalizeTrackId(trackId);
    if (!normalized) return;
    const oldestToken = this._findOldestActiveNote(
      info => normalizeTrackId(info?.trackId) === normalized
    );
    this._stopActiveNoteToken(oldestToken);
  },

  _stealOldestNote() {
    const oldestToken = this._findOldestActiveNote();
    this._stopActiveNoteToken(oldestToken);
  },

  _stopActiveNoteToken(oldestToken) {
    if (oldestToken == null) return;
    if (typeof this._activeNotes?.get !== 'function') return;
    const info = this._activeNotes.get(oldestToken);
    if (!info) return;
    const pending = this._pendingNoteOns.get(oldestToken);
    if (pending?.timerId != null) clearTimeout(pending.timerId);
    this._pendingNoteOns.delete(oldestToken);
    const output = info.output || this._resolveOutput(info.outputId);
    const channel = output?.channels?.[info.channel];
    let sentMessages = 0;
    try {
      if (channel && info.hasStarted !== false) {
        channel.sendNoteOff(info.note);
        sentMessages += 1;
        if (info.mpe) {
          channel.sendPitchBend(0);
          this._expressionState(output, info.channel).bend = 0;
          sentMessages += 1;
        }
      }
    } catch (error) { this.lastOutputError = error?.message || String(error); }
    if (typeof this._activeNotes.delete === 'function') {
      this._activeNotes.delete(oldestToken);
    }
    if (info.mpe) {
      const key = this._activeChannelKey(info.channel, info.outputId);
      if (this._activeByChannel.get(key)?.token === oldestToken) this._activeByChannel.delete(key);
    }
    this._removeScheduledNoteOff(oldestToken);
    this._removePlannedRateEntries(oldestToken, 'off');
    if (info.hasStarted === false) this._removePlannedRateEntries(oldestToken, 'on');
    if (sentMessages > 0) {
      this._recordSent({
        timeMs: this._nowMs(),
        count: sentMessages,
        bytes: sentMessages * MIDI_MESSAGE_BYTES,
        token: oldestToken,
        phase: 'off',
        laneIndex: info.laneIndex ?? 0, laneCount: info.laneCount ?? 1, sfxId: info.sfxId, priority: info.priority
      });
    }
  },

  _allocateChannel(outputId = null) {
    const mpe = this.config.mpe;
    if (!mpe?.enabled) {
      return normalizeChannelNumber(this.config.defaultChannel, 1);
    }
    const normalizedOutputId = this._resolveOutputId(outputId);
    const reserved = this._ensembleChannels();
    for (const ch of this._memberChannels) {
      if (!reserved.has(ch) && !this._activeByChannel.has(this._activeChannelKey(ch, normalizedOutputId))) {
        return ch;
      }
    }
    let oldest = null;
    let oldestTime = Infinity;
    for (const [ch, info] of this._activeByChannel.entries()) {
      if (this._resolveOutputId(info?.outputId) !== normalizedOutputId || reserved.has(info.channel)) continue;
      if (info.startedAt < oldestTime) {
        oldestTime = info.startedAt;
        oldest = info.channel ?? ch;
      }
    }
    if (oldest != null) {
      this._stopActiveChannel(oldest, normalizedOutputId);
      return oldest;
    }
    const master = normalizeChannelNumber(mpe.masterChannel, 1);
    return reserved.has(master) ? null : master;
  },
};

export { midiSchedulerChannelMethods };
