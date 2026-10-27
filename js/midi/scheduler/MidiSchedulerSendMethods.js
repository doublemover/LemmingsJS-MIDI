import { getLocalAudioNotePan } from './LocalAudioVoiceBudget.js';
import { pendingReservationConflicts } from './VoiceReservationIntervals.js';
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
    const externalReservationId = meta.rateReserved === true ? meta.reservationId : null;
    const releaseExternalShare = () => this._releaseReservationPart(externalReservationId,
      Math.max(1, (meta.reservationPartCount ?? 1) - (meta.reservationPartIndex ?? 0)));
    if (this._disposed || this._cleanupDepth || this._outputCallbackDepth) { releaseExternalShare(); return false; }
    const lifecycle = this._lifecycleVersion;
    const app = this.config?.runtime?.app || getAppContext();
    const perfEnabled = !!app &&
        (app.performanceAPI === true || app.perfMetrics === true) &&
        canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    let localReservationId = null, admissionToken = null, reservationClaimed = false;
    try {
      if (!spec || !Number.isFinite(spec.note)) { releaseExternalShare(); return false; }
      spec = { ...spec };
      if (!meta.requestId && this._captureEnabled()) meta = { ...meta, requestId: this._observe('request', { ...meta,
        type: 'note', note: spec.note, channel: spec.channel, program: spec.program, intendedMs: spec.timeMs }) };
      const outputId = this._resolveOutputId?.(spec.outputId) ?? null;
      const output = this._resolveOutput ? this._resolveOutput(outputId) : this.output;
      if (!output) { releaseExternalShare(); return false; }
      const routeLease = this._outputLeases.get(output), zoneRevision = this._mpeRevision;

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
      const scope = this._outputChannelScopes.get(output);
      if (scope && (mpeEnabled ? !this._mpeZonePlan?.ok || !scope.has(this._mpeZonePlan.managerChannel) ||
          this._mpeZonePlan.memberChannels.some(channel => !scope.has(channel)) :
        !scope.has(normalizeChannelNumber(spec.channel ?? this.config.defaultChannel, 1)))) { releaseExternalShare(); return false; }
      if (mpeEnabled && this._mpeStatusByOutput.get(output) === false) { releaseExternalShare(); return false; }
      if (mpeEnabled && !this._memberChannels.some(ch => output.channels?.[ch] && !this._ensembleChannels().has(ch))) { releaseExternalShare(); return false; }
      if (!mpeEnabled && !output.channels?.[normalizeChannelNumber(spec.channel ?? this.config.defaultChannel, 1)]) { releaseExternalShare(); return false; }
      const signedPan = (this.config.position?.panRange?.min ?? 0) < 0;
      const trackId = this._normalizeTrackId?.(spec.trackId) ?? null;
      const voiceBudget = trackId && spec.voiceBudget != null
        ? clamp(toPositiveInt(spec.voiceBudget, this._maxActiveNotes), 1, this._maxActiveNotes)
        : null;

      const now = this._nowMs();
      if (sendTimeMs > now && this._pendingNoteOns.size >= Math.max(32, this._maxActiveNotes * 4)) { releaseExternalShare(); return false; }
      const releaseUnclaimed = () => { if (localReservationId != null) this._releaseReservation(localReservationId); };
      if (meta.rateReserved !== true) {
        const estimate = this.estimateMessages(spec);
        const offMessages = durationMs > 0 ? (mpeEnabled ? 2 : 1) : 0;
        const plan = { on: { timeMs: sendTimeMs, count: estimate.messages - offMessages, bytes: estimate.bytes - offMessages * MIDI_MESSAGE_BYTES },
          off: { timeMs: offTimeMs, count: offMessages, bytes: offMessages * MIDI_MESSAGE_BYTES } };
        const reservation = this.evaluateAndReserve(plan, { ...meta, trackId, outputId, voiceBudget }, now);
        if (!reservation.ok) { this.recordThrottle(reservation.reason, now, { ...meta, note: spec.note }); return false; }
        localReservationId = reservation.reservationId;
        meta = { ...meta, rateReserved: true, reservationId: reservation.reservationId };
      }
      // Resolve MPE ownership at onset, including an onset dispatched now.
      // Admission and rate reservation must not evict a sounding owner.
      const deferredMpe = mpeEnabled;
      let channelNumber = mpeEnabled
        ? null
        : normalizeChannelNumber(spec.channel ?? this.config.defaultChannel, 1);
      if (!deferredMpe && !output.channels?.[channelNumber]) { releaseUnclaimed(); releaseExternalShare(); return false; }
      let usedChannels = this._usedOutputChannels.get(output);
      if (!usedChannels) {
        usedChannels = new Set();
        this._usedOutputChannels.set(output, usedChannels);
      }
      if (channelNumber != null) usedChannels.add(channelNumber);
      const startedAt = sendTimeMs;
      const token = ++this._noteOffSeq;
      admissionToken = token;
      reservationClaimed = this._claimReservation(meta.reservationId, token,
        Math.max(1, (meta.reservationPartCount ?? 1) - (meta.reservationPartIndex ?? 0)), outputId);
      if (!reservationClaimed) {
        releaseUnclaimed(); releaseExternalShare(); this.recordThrottle('stale-reservation', now, { ...meta, outputId }); return false;
      }
      const captureMeta = (this._captureEnabled() || this._submissionObservers.size > 0) ? { ...this._captureScaleFields(), ...meta, captureScope: this._captureScope, token, note: spec.note, channel: channelNumber, program: spec.program,
        trackId, ensembleRole: spec.ensembleRole, percussion: spec.percussion, velocity: attackVelocity,
        scheduledMs: sendTimeMs, durationMs, held: durationMs === 0,
        connectionEpoch: routeLease?.connectionEpoch ?? null, routeRevision: routeLease?.routeRevision ?? null } : null;
      this._observe('scheduled', { ...captureMeta, type: 'noteOn', offScheduledMs: durationMs > 0 ? offTimeMs : null });
      if (this._disposed || lifecycle !== this._lifecycleVersion || this._resolveOutput(outputId) !== output) {
        this._removePlannedRateEntries(token);
        releaseUnclaimed();
        return false;
      }
      this._activeNotes.set(token, {
        channel: channelNumber,
        note: spec.note,
        startedAt,
        token,
        trackId,
        voiceBudget,
        outputId,
        connectionEpoch: routeLease?.connectionEpoch ?? null,
        routeRevision: routeLease?.routeRevision ?? null,
        zoneRevision,
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
      if (mpeEnabled && !deferredMpe) {
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
        if (!active) { dispatchFailed = true; return; }
        const ownsVoice = () => !this._disposed && !this._cleanupDepth && this._activeNotes.get(token) === active;
        if (this._nowMs() > sendTimeMs + 120 || (durationMs > 0 && this._nowMs() >= offTimeMs)) {
          this.recordThrottle('expired-note', this._nowMs(), captureMeta);
          this._stopActiveNoteToken(token);
          return;
        }
        if (this._resolveOutput(outputId) !== output || this._outputLeases.get(output) !== routeLease ||
            (mpeEnabled && (zoneRevision !== this._mpeRevision || this._mpeStatusByOutput.get(output) === false))) {
          this._stopActiveNoteToken(token, 'output-retired');
          return;
        }
        if (deferredMpe) {
          const started = info => info.hasStarted === true;
          const rejectCapacity = () => {
            dispatchFailed = true; this.recordThrottle('mpe-capacity', this._nowMs(), { ...meta, outputId, note: spec.note });
            this._stopActiveNoteToken(token, 'mpe-capacity');
          };
          if (trackId && voiceBudget != null &&
              this._countSoundingNotes(trackId) >= voiceBudget) {
            if (this._mpeZonePlan?.voicePolicy === 'reject') { rejectCapacity(); return; }
            const victim = this._findOldestActiveNote(info => started(info) && info.trackId === trackId);
            this._stopActiveNoteToken(victim, 'mpe-track-voice-budget');
          }
          if (!ownsVoice()) { dispatchFailed = true; return; }
          if (this._countSoundingNotes() >= this._maxActiveNotes) {
            if (this._mpeZonePlan?.voicePolicy === 'reject') { rejectCapacity(); return; }
            this._stopActiveNoteToken(this._findOldestActiveNote(started), 'mpe-global-voice-budget');
          }
          if (!ownsVoice()) { dispatchFailed = true; return; }
          channelNumber = this._allocateChannel(outputId, 'mpe-channel-steal');
          if (!ownsVoice()) { dispatchFailed = true; return; }
          if (!output.channels?.[channelNumber] || this._activeByChannel.has(this._activeChannelKey(channelNumber, outputId))) {
            rejectCapacity();
            return;
          }
          active.channel = channelNumber;
          if (captureMeta) captureMeta.channel = channelNumber;
          usedChannels.add(channelNumber);
          this._activeByChannel.set(this._activeChannelKey(channelNumber, outputId), {
            channel: channelNumber, note: spec.note, outputId, startedAt, token
          });
        }
        try {
          if (!ownsVoice()) { dispatchFailed = true; return; }
          if (typeof output.channels?.[channelNumber]?.sendNoteOn !== 'function') {
            dispatchFailed = true;
            this.recordThrottle('onset-unsupported', this._nowMs(), captureMeta);
            this._stopActiveNoteToken(token, 'onset-unsupported');
            return;
          }
          let localVictims = !active.mpe && output.supportsIndependentNoteGates
            ? this._planLocalNoteAdmission(output, meta, trackId, voiceBudget) : [];
          if (localVictims === null) {
            dispatchFailed = true; this._stopActiveNoteToken(token, 'local-admission-rejected'); return;
          }
          this._removePlannedRateEntries(token, 'on');
          const expression = this._expressionPlan(spec, output, channelNumber);
          if (expression.coalesced) this._observe('coalesced', { ...captureMeta, type: 'controllers',
            count: expression.coalesced, reason: 'unchanged-controllers' });
          if (expression.controls.some(control => typeof output.channels?.[control.channel]?.[
            control.type === 'program' ? 'sendProgramChange' : control.type === 'bend' ? 'sendPitchBend' : 'sendControlChange'] !== 'function')) {
            dispatchFailed = true; this.recordThrottle('setup-unsupported', this._nowMs(), captureMeta);
            this._stopActiveNoteToken(token, 'setup-unsupported'); return;
          }
          if (!active.mpe) {
            if (output.supportsIndependentNoteGates) {
              localVictims = this._planLocalNoteAdmission(output, meta, trackId, voiceBudget);
              if (localVictims === null) {
                dispatchFailed = true; this._stopActiveNoteToken(token, 'local-admission-rejected'); return;
              }
              for (const victim of localVictims) this._stopActiveNoteToken(victim, 'local-voice-budget');
            } else {
              while (ownsVoice() && trackId && voiceBudget != null && this._countSoundingNotes(trackId) >= voiceBudget) {
                this._stopActiveNoteToken(this._findOldestActiveNote(info => info.hasStarted === true && info.trackId === trackId), 'ordinary-track-voice-budget');
              }
              while (ownsVoice() && this._countSoundingNotes() >= this._maxActiveNotes) {
                this._stopActiveNoteToken(this._findOldestActiveNote(info => info.hasStarted === true), 'ordinary-global-voice-budget');
              }
              for (const [previousToken, previous] of this._activeNotes) {
                if (previousToken !== token && previous.hasStarted && previous.output === output && previous.channel === channelNumber && previous.note === spec.note) {
                  this._stopActiveNoteToken(previousToken, 'same-pitch-retrigger');
                }
              }
            }
          }
          const zonePatchChanged = mpeEnabled && expression.controls.some(control => control.channel !== channelNumber);
          if ((!mpeEnabled || zonePatchChanged) && !output.supportsPerNoteInstrument && expression.controls.length) {
            for (const [previousToken, previous] of [...this._activeNotes]) {
              if (previousToken !== token && previous.hasStarted && previous.output === output &&
                  (zonePatchChanged ? previous.mpe : previous.channel === channelNumber)) {
                this._stopActiveNoteToken(previousToken, zonePatchChanged ? 'mpe-zone-patch-replaced' : 'channel-expression-replaced');
              }
            }
          }
          for (const control of expression.controls) {
            if (!ownsVoice()) { dispatchFailed = true; return; }
            const method = control.type === 'program' ? 'sendProgramChange' : control.type === 'bend' ? 'sendPitchBend' : 'sendControlChange';
            const args = control.type === 'cc' ? [control.cc, control.value, { time: sendTimeMs }] : [control.value, { time: sendTimeMs }];
            const target = output.channels?.[control.channel];
            const submission = typeof target?.[method] === 'function' ? this._submitAccountedOutput(output, control.channel, method, args, captureMeta,
              { token, phase: 'on', trackId, laneIndex: meta.laneIndex ?? 0, laneCount: meta.laneCount ?? 1, sfxId: meta.sfxId, priority: meta.priority }) : { ok: false };
            if (!submission.ok) {
              dispatchFailed = true;
              if (submission.error) this.lastOutputError = submission.error?.message || String(submission.error);
              this._expressionByOutput.delete(output);
              this.recordThrottle('setup-rejected', this._nowMs(), captureMeta);
              this._stopActiveNoteToken(token, 'setup-rejected');
              return;
            }
            if (!ownsVoice()) { dispatchFailed = true; return; }
            control.state[control.key] = control.value;
            control.state.bindings.set(control.binding, control.value);
          }
          Object.assign(expression.state, expression.spanState);

          if (!active.mpe && output.supportsIndependentNoteGates &&
              typeof output.canAllocateVoice === 'function' && !output.canAllocateVoice()) {
            dispatchFailed = true; this.recordThrottle('local-source-cap', this._nowMs(), captureMeta);
            this._stopActiveNoteToken(token, 'local-admission-changed'); return;
          }

          if (!ownsVoice()) { dispatchFailed = true; return; }
          if (typeof output.channels?.[channelNumber]?.sendNoteOn !== 'function') {
            dispatchFailed = true;
            this.recordThrottle('onset-unsupported', this._nowMs(), captureMeta);
            this._stopActiveNoteToken(token, 'onset-unsupported');
            return;
          }
          active.submitting = true;
          const notePan = getLocalAudioNotePan(spec, meta, this.config.position, output.supportsPerNotePan);
          const submission = this._submitAccountedOutput(output, channelNumber, 'sendNoteOn', [spec.note, { rawAttack: attackVelocity, time: sendTimeMs,
            ...(output.supportsIndependentNoteGates ? { voiceToken: token, priority: meta.priority ?? 1, laneIndex: meta.laneIndex ?? 0 } : {}),
            ...(output.supportsPlaybackMetadata ? { playback: { sfxId: meta.sfxId, triggerType: meta.triggerType, sourceId: meta.sourceId, sourceKind: meta.sourceKind, sourceKey: meta.sourceKey, clipId: meta.clipId, originTick: meta.originTick, eventType: meta.eventType, durationMs, stepIndex: spec.stepIndex, stepCount: spec.stepCount, lemmingId: meta.lemmingId, laneIndex: meta.laneIndex, ensembleRole: spec.ensembleRole, program: spec.program, channel: channelNumber } } : {}),
            ...(output.supportsPerNoteInstrument ? { instrument: { program: spec.program, percussion: spec.percussion, role: spec.ensembleRole, legacy: !spec.ensembleRole && spec.percussion !== true,
              ...(spec.ensembleRole && spec.envelope ? { envelope: spec.envelope } : {}), resumed: spec.resumed === true } } : {}),
            ...(output.supportsPerNotePan && Number.isFinite(notePan) ? { pan: notePan / 127 } : {}) }], captureMeta,
          { token, phase: 'on', trackId, laneIndex: meta.laneIndex ?? 0, laneCount: meta.laneCount ?? 1, sfxId: meta.sfxId, priority: meta.priority });
          active.submitting = false;
          active.hasStarted = submission.ok || submission.acceptedMessages > 0;
          if (!ownsVoice()) {
            dispatchFailed = true;
            if (active.hasStarted) {
              const cleanupMeta = { ...captureMeta, reason: 'onset-retired-during-submission' }, cleanupRate = { token, phase: 'off', trackId };
              const cleanup = this._submitAccountedOutput(output, channelNumber, 'sendNoteOff', [spec.note, { rawRelease: releaseVelocity,
                ...(output.supportsIndependentNoteGates ? { voiceToken: token } : {}) }], cleanupMeta, cleanupRate);
              const reset = mpeEnabled ? this._submitAccountedOutput(output, channelNumber, 'sendPitchBend', [0], cleanupMeta, cleanupRate) : { ok: true };
              this._observe('voice-terminal', { ...cleanupMeta, state: cleanup.ok && reset.ok ? 'release-submitted' : 'uncertain',
                evidence: cleanup.ok && reset.ok ? 'adapter-returned' : 'release-unconfirmed' });
            }
            return;
          }
          if (!submission.ok) {
            dispatchFailed = true;
            if (submission.error) this.lastOutputError = submission.error?.message || String(submission.error);
            this.recordThrottle('local-render-rejected', this._nowMs(), captureMeta);
            this._stopActiveNoteToken(token);
            if (spec.phraseVoiceKey != null) this.cancelGamePhrase(spec.phraseVoiceKey, { releaseActive: false, complete: true });
            return;
          }
          if (!active.mpe && sendTimeMs <= now && this._pendingNoteOns.size) {
            for (const victim of pendingReservationConflicts(this._activeNotes.values(), active, this._maxActiveNotes, voiceBudget)) {
              this._stopActiveNoteToken(victim, 'reservation-superseded-at-onset');
            }
          }
          if (typeof window !== 'undefined') window.lastMidiOutputMessage = {
            type: 'noteOn', note: spec.note, velocity: attackVelocity, channel: channelNumber, outputId, timeMs: sendTimeMs, program: spec.program, ensembleRole: spec.ensembleRole, laneIndex: meta.laneIndex, lemmingId: meta.lemmingId
          };
        } catch (error) {
          dispatchFailed = true;
          this.lastOutputError = error?.message || String(error);
          this._expressionByOutput.delete(output);
          this._stopActiveNoteToken(token);
          if (spec.phraseVoiceKey != null) this.cancelGamePhrase(spec.phraseVoiceKey, { releaseActive: false, complete: true });
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
      this._checkByteRate(now, outputId);
      return !dispatchFailed;
    } catch (error) {
      this.lastOutputError = error?.message || String(error);
      if (this._activeNotes.has(admissionToken)) this._stopActiveNoteToken(admissionToken, 'admission-error');
      else if (admissionToken != null) this._removePlannedRateEntries(admissionToken);
      if (localReservationId != null) this._releaseReservation(localReservationId);
      if (!reservationClaimed) releaseExternalShare();
      this._observe('drop', { ...meta, type: 'noteOn', reason: 'admission-error' });
      return false;
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
    while (this._noteOffs.length && this._noteOffs[0].timeMs <= now) {
      const entry = this._noteOffs.shift();
      this._stopActiveNoteToken(entry.token, 'duration-ended', { rawRelease: entry.releaseVelocity, time: entry.timeMs, dispatchedAtMs: now });
    }
    this._armNoteOffTimer();
  },

  cancelGamePhrase(key, { releaseActive = true, complete = false } = {}) {
    if (key == null) return false;
    const phrase = this.gamePhrases.voices.get(key);
    let cancelled = this.gamePhrases.voices.delete(key);
    if (cancelled && complete) phrase.onComplete?.();
    for (const [token, voice] of this._activeNotes) if (voice.phraseVoiceKey === key && (releaseActive || !voice.hasStarted)) {
      this._stopActiveNoteToken(token, 'phrase-cancelled'); cancelled = true;
    }
    return cancelled;
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

  allNotesOff({ preserveGamePhrases = false, wholeDevice = false, reason = 'owned-stop' } = {}) {
    if (this._panicking) return;
    this._panicking = true; this._cleanupDepth++; this._lifecycleVersion++;
    try {
      this._observe('panic', { type: 'allNotesOff', wholeDevice, reason });
      this._pruneRateEntries(this._nowMs());
      if (!preserveGamePhrases) this.gamePhrases.clear();
      const cleanup = { reason, wholeDevice, queuedRemoved: 0, releaseSubmitted: 0, uncertain: 0, effectiveBoundary: this._nowMs() };
      const scopes = new Map();
      for (const output of this._listOutputs()) if (output.supportsIndependentNoteGates) scopes.set(output, new Set());
      for (const [output, channels] of this._usedOutputChannels) if (output.supportsIndependentNoteGates) scopes.set(output, new Set(channels));
      for (const [token, voice] of this._activeNotes) {
        if (voice.hasStarted) {
          if (!scopes.has(voice.output)) scopes.set(voice.output, new Set());
          scopes.get(voice.output).add(voice.channel);
        }
        const result = this._stopActiveNoteToken(token, reason);
        if (result?.state === 'cancelled') cleanup.queuedRemoved++;
        else if (result?.state === 'release-submitted') cleanup.releaseSubmitted++;
        else if (result) cleanup.uncertain++;
      }
      for (const output of scopes.keys()) if (output.supportsIndependentNoteGates && typeof output.clear === 'function') {
        try { if (this._sendOutput(output, null, 'clear', [], { reason }) === false) cleanup.uncertain++; } catch { cleanup.uncertain++; }
      }
      if (wholeDevice) for (const output of this._listOutputs()) scopes.set(output, new Set(Object.keys(output.channels || {}).map(Number)));
      for (const [output, channels] of scopes) for (const channel of channels) {
        if (!wholeDevice && !output.supportsIndependentNoteGates && !output.exclusiveChannels?.includes(channel)) continue;
        for (const [method, args] of [['sendControlChange', [64, 0]], ['sendControlChange', [120, 0]], ['sendAllNotesOff', []], ['sendPitchBend', [0]]]) {
          try {
            if (this._sendAccountedCleanup(output, channel, method, args, { reason }) === false) cleanup.uncertain++;
          } catch { cleanup.uncertain++; }
        }
      }
      this.lastCleanup = Object.freeze(cleanup);
      this._expressionByOutput.clear();
      this._pendingNoteOns.clear();
      this._noteOffs.length = 0;
      if (this._noteOffTimerId) {
        clearTimeout(this._noteOffTimerId);
        this._noteOffTimerId = 0;
      }
      this._activeByChannel.clear();
      this._activeNotes.clear();
      this._usedOutputChannels.clear();
      this._noteOffs.length = 0;
      this._ratePlanned.length = 0;
    } finally { this._cleanupDepth--; this._panicking = false; }
  },

  clearQueue({ preserveGamePhrases = false } = {}) {
    if (!preserveGamePhrases) this.gamePhrases.clear();
    if (this._activeNotes.size || this._pendingNoteOns.size || this._noteOffs.length) this.allNotesOff({ preserveGamePhrases });
    this._ratePlanned.length = 0;
    this._pruneRateEntries(this._nowMs());
  },

  dispose() {
    this._disposed = true;
    for (const [ch, active] of this._activeByChannel.entries()) {
      try {
        this._stopActiveChannel(active?.channel ?? ch, active?.outputId ?? null);
      } catch (error) {
        // Panic still needs to silence the remaining outputs during disposal.
      }
    }
    this.allNotesOff();
    this._usedOutputChannels.clear();
    this._submissionObservers.clear();
    this._outputLeases.clear();
    this._additionalOutputs.clear();
    this._rateLanesByOutput.clear();
    this._throttleByOutput.clear();
    this._rateSent.length = 0;
    this.output = null;
    this._outputsById.clear();
  },
};

export { midiSchedulerSendMethods };
