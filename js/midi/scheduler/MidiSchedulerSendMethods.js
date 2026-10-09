import { getLocalAudioNotePan } from './LocalAudioVoiceBudget.js';
import { transferGamePhraseVoiceKey } from './MidiGamePhraseQueue.js';
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
      spec = { ...spec };
      if (!meta.requestId && this._captureEnabled()) meta = { ...meta, requestId: this._observe('request', { ...meta,
        type: 'note', note: spec.note, channel: spec.channel, program: spec.program, intendedMs: spec.timeMs }) };
      const outputId = this._resolveOutputId?.(spec.outputId) ?? null;
      const output = this._resolveOutput ? this._resolveOutput(outputId) : this.output;
      if (!output) return false;

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
      const mpeEnabled = this._isMpeNote(spec);
      const signedPan = (this.config.position?.panRange?.min ?? 0) < 0;
      const trackId = this._normalizeTrackId?.(spec.trackId) ?? null;
      const voiceBudget = trackId && spec.voiceBudget != null
        ? clamp(toPositiveInt(spec.voiceBudget, this._maxActiveNotes), 1, this._maxActiveNotes)
        : null;

      const now = this._nowMs();
      if (meta.rateReserved !== true) {
        const estimate = this.estimateMessages(spec);
        const offMessages = durationMs > 0 ? (mpeEnabled ? 2 : 1) : 0;
        const plan = { on: { timeMs: sendTimeMs, count: estimate.messages - offMessages, bytes: estimate.bytes - offMessages * MIDI_MESSAGE_BYTES },
          off: { timeMs: offTimeMs, count: offMessages, bytes: offMessages * MIDI_MESSAGE_BYTES } };
        const reservation = this.evaluateAndReserve(plan, { ...meta, trackId, outputId, voiceBudget }, now);
        if (!reservation.ok) { this.recordThrottle(reservation.reason, now, { ...meta, note: spec.note }); return false; }
        meta = { ...meta, rateReserved: true, reservationId: reservation.reservationId };
      }
      const channelNumber = mpeEnabled
        ? this._allocateChannel(outputId)
        : normalizeChannelNumber(spec.channel ?? this.config.defaultChannel, 1);
      const channel = output.channels?.[channelNumber];
      if (!channel) return false;
      let usedChannels = this._usedOutputChannels.get(output);
      if (!usedChannels) {
        usedChannels = new Set();
        this._usedOutputChannels.set(output, usedChannels);
      }
      usedChannels.add(channelNumber);
      if (output.supportsIndependentNoteGates && !this._admitLocalNote(output, meta, trackId, voiceBudget)) return false;
      const startedAt = sendTimeMs;
      const token = ++this._noteOffSeq;
      const captureMeta = this._captureEnabled() ? { ...this._captureScaleFields(), ...meta, captureScope: this._captureScope, token, note: spec.note, channel: channelNumber, program: spec.program,
        trackId, ensembleRole: spec.ensembleRole, percussion: spec.percussion, velocity: attackVelocity,
        scheduledMs: sendTimeMs, durationMs, held: durationMs === 0 } : null;
      this._observe('scheduled', { ...captureMeta, type: 'noteOn', offScheduledMs: durationMs > 0 ? offTimeMs : null });
      if (
        !output.supportsIndependentNoteGates && trackId &&
          voiceBudget != null &&
          this._countActiveNotesForTrack?.(trackId) >= voiceBudget
      ) {
        this._stealOldestNoteForTrack(trackId);
      }
      if (!output.supportsIndependentNoteGates && this._activeNotes.size >= this._maxActiveNotes) {
        this._stealOldestNote();
      }

      this._activeNotes.set(token, {
        channel: channelNumber,
        note: spec.note,
        startedAt,
        token,
        trackId,
        voiceBudget,
        outputId,
        mpe: mpeEnabled,
        phraseVoiceKey: spec.phraseVoiceKey ?? null,
        laneIndex: meta.laneIndex ?? 0, laneCount: meta.laneCount ?? 1, lemmingId: meta.lemmingId ?? null, ensembleRole: spec.ensembleRole ?? null, sfxId: meta.sfxId, priority: meta.priority,
        offTimeMs,
        hasStarted: false,
        captureMeta,
        actorMeta: meta,
        automationSpanned: !!meta.automationSpanIds?.length,
        output
      });
      if (mpeEnabled) {
        this._activeByChannel.set(this._activeChannelKey(channelNumber, outputId), {
          channel: channelNumber,
          note: spec.note,
          outputId,
          startedAt,
          token
        });
      }
      let dispatchFailed = false;
      const dispatchStart = () => {
        this._pendingNoteOns.delete(token);
        const active = this._activeNotes.get(token);
        if (!active) return;
        if (this._nowMs() > sendTimeMs + 120 || (durationMs > 0 && this._nowMs() >= offTimeMs)) {
          this.recordThrottle('expired-note', this._nowMs(), captureMeta);
          this._stopActiveNoteToken(token);
          return;
        }
        if (!active.mpe && !output.supportsIndependentNoteGates) {
          // MIDI 1.0 has one gate per output/channel/pitch. Retrigger owns that gate.
          for (const [previousToken, previous] of [...this._activeNotes]) {
            if (previousToken !== token && previous.hasStarted && previous.output === output &&
                previous.channel === channelNumber && previous.note === spec.note) {
              this._stopActiveNoteToken(previousToken);
            }
          }
        }
        try {
          const expression = this._expressionPlan(spec, output, channelNumber);
          if (!mpeEnabled && !output.supportsPerNoteInstrument && expression.controls.length) {
            for (const [previousToken, previous] of [...this._activeNotes]) {
              if (previousToken !== token && previous.hasStarted && previous.output === output && previous.channel === channelNumber) {
                this._stopActiveNoteToken(previousToken);
              }
            }
          }
          if (expression.coalesced) this._observe('coalesced', { ...captureMeta, type: 'controllers',
            count: expression.coalesced, reason: 'unchanged-controllers' });
          for (const control of expression.controls) {
            if (control.type === 'program') this._sendOutput(output, channelNumber, 'sendProgramChange', [control.value, { time: sendTimeMs }], captureMeta);
            else if (control.type === 'bend') this._sendOutput(output, channelNumber, 'sendPitchBend', [control.value, { time: sendTimeMs }], captureMeta);
            else this._sendOutput(output, channelNumber, 'sendControlChange', [control.cc, control.value, { time: sendTimeMs }], captureMeta);
            expression.state[control.key] = control.value;
          }
          Object.assign(expression.state, expression.spanState);

          const notePan = getLocalAudioNotePan(spec, meta, this.config.position, output.supportsPerNotePan);
          const accepted = this._sendOutput(output, channelNumber, 'sendNoteOn', [spec.note, { rawAttack: attackVelocity, time: sendTimeMs,
            ...(output.supportsIndependentNoteGates ? { voiceToken: token, priority: meta.priority ?? 1, laneIndex: meta.laneIndex ?? 0 } : {}),
            ...(output.supportsPlaybackMetadata ? { playback: { sfxId: meta.sfxId, triggerType: meta.triggerType, durationMs, stepIndex: spec.stepIndex, stepCount: spec.stepCount, lemmingId: meta.lemmingId, laneIndex: meta.laneIndex, ensembleRole: spec.ensembleRole, program: spec.program, channel: channelNumber } } : {}),
            ...(output.supportsPerNoteInstrument ? { instrument: { program: spec.program, percussion: spec.percussion, role: spec.ensembleRole, legacy: !spec.ensembleRole && spec.percussion !== true } } : {}),
            ...(output.supportsPerNotePan && Number.isFinite(notePan) ? { pan: notePan / 127 } : {}) }], captureMeta);
          if (accepted === false) {
            dispatchFailed = true;
            this.recordThrottle('local-render-rejected', this._nowMs(), captureMeta);
            this._stopActiveNoteToken(token);
            return;
          }
          active.hasStarted = true;
          if (typeof window !== 'undefined') window.lastMidiOutputMessage = {
            type: 'noteOn', note: spec.note, velocity: attackVelocity, channel: channelNumber, outputId, timeMs: sendTimeMs, program: spec.program, ensembleRole: spec.ensembleRole, laneIndex: meta.laneIndex, lemmingId: meta.lemmingId
          };
        } catch (error) {
          dispatchFailed = true;
          this.lastOutputError = error?.message || String(error);
          this._stopActiveNoteToken(token);
          this.allNotesOff();
        }
      };
      if (sendTimeMs > now) {
        const timerId = setTimeout(dispatchStart, Math.max(0, sendTimeMs - now));
        this._pendingNoteOns.set(token, { output, channel: channelNumber, note: spec.note, timeMs: sendTimeMs, timerId,
          spanPan: spec.spanPan === true, spanTimbre: spec.spanTimbre === true });
      } else dispatchStart();
      if (durationMs > 0 && this._activeNotes.has(token)) {
        this._scheduleNoteOff({ timeMs: offTimeMs, channel: channelNumber, note: spec.note,
          outputId, token, mpe: mpeEnabled, releaseVelocity });
      }
      const { messages, bytes } = this.estimateMessages(spec);
      if (messages > 0 && meta.rateReserved !== true) {
        const offMessages = durationMs > 0 ? (1 + (mpeEnabled ? 1 : 0)) : 0;
        const immediateMessages = messages - offMessages;
        const immediateBytes = bytes - (offMessages * MIDI_MESSAGE_BYTES);
        this._recordPlanned({
          timeMs: sendTimeMs,
          count: immediateMessages,
          bytes: immediateBytes,
          token,
          phase: 'on',
          sfxId: meta.sfxId ?? null,
          priority: meta.priority ?? 1,
          triggerType: meta.triggerType ?? null,
          trackId,
          outputId,
          voiceBudget,
          laneIndex: meta.laneIndex ?? 0,
          laneCount: meta.laneCount ?? 1
        });
        if (durationMs > 0) {
          this._recordPlanned({
            timeMs: offTimeMs,
            count: offMessages,
            bytes: offMessages * MIDI_MESSAGE_BYTES,
            token,
            phase: 'off',
            sfxId: meta.sfxId ?? null,
            priority: meta.priority ?? 1,
            triggerType: meta.triggerType ?? null,
            trackId,
            outputId,
            voiceBudget,
            laneIndex: meta.laneIndex ?? 0,
            laneCount: meta.laneCount ?? 1
          });
        }
      }
      this._checkByteRate(now);
      return !dispatchFailed;
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
    const now = this._nowMs();
    const delay = Math.max(0, this._noteOffs[0].timeMs - now);
    this._noteOffTimerId = setTimeout(() => this._processNoteOffs(), delay);
  },

  _processNoteOffs() {
    this._noteOffTimerId = 0;
    if (!this.hasAnyOutput() || !this._noteOffs.length) return;
    const now = this._nowMs();
    let idx = 0;
    while (idx < this._noteOffs.length && this._noteOffs[idx].timeMs <= now) {
      const entry = this._noteOffs[idx];
      const active = this._activeNotes.get(entry.token);
      if (active) {
        const pending = this._pendingNoteOns.get(entry.token);
        if (pending?.timerId != null) clearTimeout(pending.timerId);
        this._pendingNoteOns.delete(entry.token);
        if (active.hasStarted !== false) {
          const output = active.output || this._resolveOutput(active.outputId ?? entry.outputId);
          const channel = output?.channels?.[entry.channel];
          try {
            this._sendOutput(output, entry.channel, 'sendNoteOff', [entry.note, { rawRelease: entry.releaseVelocity, time: entry.timeMs,
              ...(output.supportsIndependentNoteGates ? { voiceToken: entry.token } : {}) }], active.captureMeta);
            if (entry.mpe) {
              this._sendOutput(output, entry.channel, 'sendPitchBend', [0, { time: entry.timeMs }], active.captureMeta);
              this._expressionState(output, entry.channel).bend = 0;
            }
          } catch (error) { this.lastOutputError = error?.message || String(error); }
        }
        if (entry.mpe) {
          const key = this._activeChannelKey(entry.channel, active.outputId ?? entry.outputId);
          if (this._activeByChannel.get(key)?.token === entry.token) this._activeByChannel.delete(key);
        }
        this._activeNotes.delete(entry.token);
      }
      idx++;
    }
    if (idx > 0) {
      this._noteOffs.splice(0, idx);
    }
    this._armNoteOffTimer();
  },

  transferActorLane(id, from, to, laneCount) {
    if (!Number.isInteger(id) || id < 0 || !Number.isInteger(laneCount) || laneCount < 1 || laneCount > 1024 ||
      !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= laneCount || to >= laneCount || from === to) return false;
    const changedKeys = this.gamePhrases.transferActorLane(id, from, to, laneCount);
    for (const voice of this._activeNotes.values()) {
      if (voice.lemmingId !== id || voice.laneIndex !== from) continue;
      voice.laneIndex = to; voice.laneCount = laneCount;
      if (voice.actorMeta) Object.assign(voice.actorMeta, {
        originLaneIndex: voice.actorMeta.originLaneIndex ?? from, laneIndex: to, laneCount });
      if (voice.captureMeta) Object.assign(voice.captureMeta, {
        originLaneIndex: voice.captureMeta.originLaneIndex ?? from, laneIndex: to, laneCount });
      voice.phraseVoiceKey = changedKeys.get(voice.phraseVoiceKey) ?? transferGamePhraseVoiceKey(voice.phraseVoiceKey, id, from, to);
    }
    return true;
  },

  isGamePhraseVoiceBusy(key) {
    const now = this._nowMs();
    for (const active of this._activeNotes.values()) {
      if (active.phraseVoiceKey === key && active.offTimeMs > now) return true;
    }
    return false;
  },

  allNotesOff({ preserveGamePhrases = false, preserveRateHistory = false } = {}) {
    this._observe('panic', { type: 'allNotesOff', preserveRateHistory, reason: 'panic-or-lifecycle' });
    if (preserveRateHistory) this._pruneRateEntries(this._nowMs());
    if (!preserveGamePhrases) this.gamePhrases.clear();
    for (const pending of this._pendingNoteOns.values()) if (pending.timerId != null) clearTimeout(pending.timerId);
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
    const outputs = new Set([...this._listOutputs(), ...this._usedOutputChannels.keys()]);
    const now = this._nowMs();
    for (const output of outputs) {
      let cleared = false;
      try {
        // WebMidi's clear wrapper can silently do nothing when native clear is unavailable.
        if (typeof output.clear === 'function' && (!output._midiOutput || typeof output._midiOutput.clear === 'function')) {
          this._sendOutput(output, null, 'clear');
          cleared = true;
        }
      } catch (error) {
        // Future note-ons still need a paired emergency note-off if clear fails.
      }
      const usedChannels = new Set([...channels, ...(this._usedOutputChannels.get(output) || [])]);
      for (const active of this._activeNotes.values()) {
        if (this._resolveOutput(active.outputId) === output) usedChannels.add(active.channel);
      }
      for (const ch of usedChannels) {
        const channel = output.channels?.[ch];
        if (!channel) continue;
        try {
          this._sendOutput(output, ch, 'sendControlChange', [64, 0], { reason: 'panic' });
          this._sendOutput(output, ch, 'sendControlChange', [120, 0], { reason: 'panic' });
          this._sendOutput(output, ch, 'sendAllNotesOff', [], { reason: 'panic' });
          this._sendOutput(output, ch, 'sendPitchBend', [0], { reason: 'panic' });
        } catch (error) {
          // A disconnected output must not prevent Panic reaching the other channels.
        }
      }
      if (!cleared) {
        for (const pending of this._pendingNoteOns.values()) {
          if (pending.timerId != null || pending.output !== output || pending.timeMs <= now) continue;
          const channel = output.channels?.[pending.channel];
          try {
            this._sendOutput(output, pending.channel, 'sendNoteOff', [pending.note, { time: pending.timeMs + 1 }], { reason: 'panic-future-release' });
            this._sendOutput(output, pending.channel, 'sendPitchBend', [0, { time: pending.timeMs + 1 }], { reason: 'panic-future-release' });
          } catch (error) {
            // Continue silencing other queued notes when an output has disconnected.
          }
        }
      }
    }
    this._expressionByOutput.clear();
    this._pendingNoteOns.clear();
    this._noteOffs.length = 0;
    if (this._noteOffTimerId) {
      clearTimeout(this._noteOffTimerId);
      this._noteOffTimerId = 0;
    }
    this._activeByChannel.clear();
    this._activeNotes.clear();
    this._noteOffs.length = 0;
    if (!preserveRateHistory) this._rateSent.length = 0;
    if (!preserveRateHistory) this._ratePlanned.length = 0;
  },

  clearQueue({ preserveGamePhrases = false, preserveRateHistory = false } = {}) {
    if (!preserveGamePhrases) this.gamePhrases.clear();
    if (this._activeNotes.size || this._pendingNoteOns.size || this._noteOffs.length) this.allNotesOff({ preserveGamePhrases, preserveRateHistory });
    if (!preserveRateHistory) this._rateSent.length = 0;
    if (!preserveRateHistory) this._ratePlanned.length = 0;
  },

  dispose() {
    for (const [ch, active] of this._activeByChannel.entries()) {
      try {
        this._stopActiveChannel(active?.channel ?? ch, active?.outputId ?? null);
      } catch (error) {
        // Panic still needs to silence the remaining outputs during disposal.
      }
    }
    this.allNotesOff();
    this._usedOutputChannels.clear();
    this.output = null;
    this._outputsById.clear();
  },
};

export { midiSchedulerSendMethods };
