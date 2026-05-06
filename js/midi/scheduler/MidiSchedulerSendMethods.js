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

const midiSchedulerSendMethods = {
  sendNote(spec, meta = {}) {
    const app = this.config?.runtime?.app || getAppContext();
    const perfEnabled = !!app &&
        (app.performanceAPI === true || app.perfMetrics === true) &&
        canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      if (!spec || !Number.isFinite(spec.note)) return false;
      const outputId = this._resolveOutputId?.(spec.outputId) ?? null;
      const output = this._resolveOutput ? this._resolveOutput(outputId) : this.output;
      if (!output) return false;
      const channelNumber = this.config.mpe?.enabled
        ? this._allocateChannel(outputId)
        : normalizeChannelNumber(spec.channel ?? this.config.defaultChannel, 1);
      const channel = output.channels?.[channelNumber];
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
      const trackId = this._normalizeTrackId?.(spec.trackId) ?? null;
      const voiceBudget = trackId && spec.voiceBudget != null
        ? clamp(toPositiveInt(spec.voiceBudget, this._maxActiveNotes), 1, this._maxActiveNotes)
        : null;

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
      if (
        trackId &&
          voiceBudget != null &&
          this._countActiveNotesForTrack?.(trackId) >= voiceBudget
      ) {
        this._stealOldestNoteForTrack(trackId);
      }
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
          outputId,
          timeMs: sendTimeMs
        };
      }

      this._activeNotes.set(token, {
        channel: channelNumber,
        note: spec.note,
        startedAt,
        token,
        trackId,
        voiceBudget,
        outputId,
        mpe: !!this.config.mpe?.enabled
      });
      if (this.config.mpe?.enabled) {
        this._activeByChannel.set(this._activeChannelKey(channelNumber, outputId), {
          channel: channelNumber,
          note: spec.note,
          outputId,
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
          outputId,
          token,
          mpe: !!this.config.mpe?.enabled
        });
      }
      const { messages, bytes } = this.estimateMessages(spec);
      if (messages > 0 && meta.rateReserved !== true) {
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
  },

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
  },

  _armNoteOffTimer() {
    if (this._noteOffTimerId) {
      clearTimeout(this._noteOffTimerId);
      this._noteOffTimerId = 0;
    }
    if (!this._noteOffs.length) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const delay = Math.max(0, this._noteOffs[0].timeMs - now);
    this._noteOffTimerId = setTimeout(() => this._processNoteOffs(), delay);
  },

  _processNoteOffs() {
    this._noteOffTimerId = 0;
    if (!this.hasAnyOutput() || !this._noteOffs.length) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let idx = 0;
    while (idx < this._noteOffs.length && this._noteOffs[idx].timeMs <= now + 1) {
      const entry = this._noteOffs[idx];
      const active = this._activeNotes.get(entry.token);
      if (active && entry.mpe) {
        this._activeByChannel.delete(this._activeChannelKey(entry.channel, active.outputId ?? entry.outputId));
      }
      if (active) this._activeNotes.delete(entry.token);
      idx++;
    }
    if (idx > 0) {
      this._noteOffs.splice(0, idx);
    }
    this._armNoteOffTimer();
  },

  allNotesOff() {
    if (!this.hasAnyOutput()) return;
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
    for (const output of this._listOutputs()) {
      for (const ch of channels) {
        const channel = output.channels?.[ch];
        if (!channel) continue;
        channel.sendAllNotesOff?.();
        channel.sendPitchBend?.(0);
      }
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
  },

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
  },

  dispose() {
    for (const [ch, active] of this._activeByChannel.entries()) {
      this._stopActiveChannel(active?.channel ?? ch, active?.outputId ?? null);
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
    this._outputsById.clear();
  },
};

export { midiSchedulerSendMethods };
