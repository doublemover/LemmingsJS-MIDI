import { selectLocalAudioVoice } from './LocalAudioVoiceBudget.js';
import { createMpeZonePlan } from './MpeZonePlan.js';
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
  prepareOutputConfig(config = {}) {
    const plan = createMpeZonePlan(config.mpe, this._ensembleChannels(config)), outputIds = [];
    if (!config.mpe?.enabled) return { ok: true, plan, outputIds };
    if (!plan.ok) return { ok: false, reason: plan.reason, plan, outputIds };
    const required = [plan.managerChannel, ...plan.memberChannels];
    for (const output of this._outputLeases.keys()) {
      const scope = this._outputChannelScopes.get(output);
      if (scope && required.some(channel => !scope.has(channel))) outputIds.push(String(output.id));
    }
    return { ok: !outputIds.length, reason: outputIds.length ? 'mpe-channel-scope' : null, plan, outputIds };
  },

  setOutputChannelScope(output, channels = null) {
    if (!output || channels != null && (!Array.isArray(channels) || channels.some(channel => !Number.isInteger(channel) || channel < 1 || channel > 16))) return false;
    const prior = this._outputChannelScopes.get(output), scope = channels == null ? null : new Set(channels);
    if ((!prior && !scope) || prior && scope && prior.size === scope.size && [...prior].every(channel => scope.has(channel))) return true;
    const active = this._outputLeases.has(output);
    if (active && scope && this.config.mpe?.enabled && (!this._mpeZonePlan?.ok || !scope.has(this._mpeZonePlan.managerChannel) ||
        this._mpeZonePlan.memberChannels.some(channel => !scope.has(channel)))) return false;
    this._cleanupDepth++;
    try {
      if (active) this._retireOutput(output);
      if (scope) this._outputChannelScopes.set(output, scope); else this._outputChannelScopes.delete(output);
      if (active) { this._registerOutput(output); this._initMpe(output); }
    } finally { this._cleanupDepth--; }
    return true;
  },

  setConfig(config) {
    const candidate = this.prepareOutputConfig(config || {});
    if (!candidate.ok && [...this._outputLeases.keys()].some(output => this._outputChannelScopes.has(output))) {
      this.lastConfigurationFailure = Object.freeze({ reason: candidate.reason, outputIds: Object.freeze(candidate.outputIds), retained: true });
      return false;
    }
    this.lastConfigurationFailure = null;
    const mpeChanged = JSON.stringify(this.config?.mpe) !== JSON.stringify(config?.mpe) ||
      (this.config?.enabled === false && config?.enabled !== false) ||
      JSON.stringify([...this._ensembleChannels(this.config || {})]) !== JSON.stringify([...this._ensembleChannels(config || {})]);
    if (mpeChanged) {
      this._mpeRevision++;
      const modeChanged = !!this.config?.mpe?.enabled !== !!config?.mpe?.enabled;
      for (const [token, voice] of this._activeNotes) if (voice.mpe || modeChanged) this._stopActiveNoteToken(token, 'mpe-zone-changed');
      this._expressionByOutput.clear();
    }
    const expressionBinding = JSON.stringify([config?.mpe?.timbreCc, config?.position?.panRange, config?.mpe?.pitchBendRange]);
    const bindingChanged = expressionBinding !== this._expressionBinding;
    const budgetKey = JSON.stringify(config?.limits), budgetChanged = budgetKey !== this._transportBudgetKey;
    if (bindingChanged) this._expressionByOutput.clear();
    if (this.config && (mpeChanged || bindingChanged || budgetChanged)) {
      for (const [token, voice] of this._activeNotes) if (voice.hasStarted === false) this._stopActiveNoteToken(token, 'route-configuration-changed');
      this._ratePlanned = this._ratePlanned.filter(entry => entry.token != null);
      for (const [output, lease] of this._outputLeases) this._outputLeases.set(output, { ...lease, routeRevision: ++this._routeRevision });
    }
    this._expressionBinding = expressionBinding;
    this._transportBudgetKey = budgetKey;
    const phraseConfigKey = JSON.stringify([
      config?.enabled, config?.sfx, config?.triggers, config?.scale, config?.noteRange,
      config?.velocityRange, config?.durationTicks, config?.density, config?.envelope,
      config?.position, config?.mpe, config?.limits, config?.defaultChannel, config?.timing,
      config?.repeat, config?.reverse, config?.laneMusic
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
    this._mpeZonePlan = createMpeZonePlan(this.config.mpe, this._ensembleChannels());
    this._memberChannels = this._mpeZonePlan.ok ? [...this._mpeZonePlan.memberChannels] : [];
    if (this.hasAnyOutput() && mpeChanged) this._initMpe();
    return true;
  },

  setOutput(output) {
    if (this._disposed) return;
    const next = output || null, previous = this.output;
    if (next === previous) return;
    this._cleanupDepth++;
    try {
      if (previous && !this._additionalOutputs.has(previous)) {
        this._retireOutput(previous);
        const id = normalizeOutputId(previous.id);
        if (this._outputsById.get(id) === previous) this._outputsById.delete(id);
      }
      this.output = next;
      const newlyActivated = next && !this._outputLeases.has(next);
      if (next) this._registerOutput(next);
      if (newlyActivated) this._initMpe(next);
    } finally { this._cleanupDepth--; }
  },

  setOutputs(outputs) {
    if (this._disposed) return;
    const nextOutputs = toOutputList(outputs), previousOutputs = [...this._outputsById.values()];
    this._additionalOutputs = new Set(nextOutputs);
    this._cleanupDepth++;
    try {
      for (const output of previousOutputs) if (!nextOutputs.includes(output) && output !== this.output) {
        this._retireOutput(output);
      }
      this._outputsById.clear();
      for (const output of nextOutputs) this._registerOutput(output);
      if (this.output) this._registerOutput(this.output);
      for (const output of nextOutputs) if (!previousOutputs.includes(output)) this._initMpe(output);
    } finally { this._cleanupDepth--; }
  },

  _retireOutput(output) {
    for (const [token, voice] of this._activeNotes) if (voice.output === output) this._stopActiveNoteToken(token, 'output-retired');
    const outputId = normalizeOutputId(output?.id);
    for (const [key, phrase] of this.gamePhrases.voices) {
      if (this._resolveOutputId(phrase.spec?.outputId ?? phrase.meta?.outputId) === outputId) this.gamePhrases.voices.delete(key);
    }
    let write = 0;
    for (const entry of this._ratePlanned) {
      if (entry.outputId === outputId) continue;
      this._ratePlanned[write++] = entry;
    }
    this._ratePlanned.length = write;
    if (outputId != null) this._rateLanesByOutput.delete(outputId);
    if (outputId != null) this._throttleByOutput.delete(outputId);
    this._expressionByOutput.delete(output);
    this._mpeStatusByOutput.delete(output);
    this._mpeFailureByOutput.delete(output);
    this._usedOutputChannels.delete(output);
    this._outputLeases.delete(output);
    this._routeRevision++;
  },

  hasAnyOutput() {
    return !!this.output || this._outputsById.size > 0;
  },

  hasOutput(outputId = null) {
    return !!this._resolveOutput(outputId);
  },

  _registerOutput(output) {
    const id = normalizeOutputId(output?.id);
    if (output && !this._outputLeases.has(output)) this._outputLeases.set(output, {
      connectionEpoch: ++this._connectionSequence, routeRevision: ++this._routeRevision
    });
    if (id && output) this._outputsById.set(id, output);
  },

  getOutputRouteState(outputId = null) {
    const output = this._resolveOutput(outputId), lease = this._outputLeases.get(output);
    return { outputId: this._resolveOutputId(outputId), active: !!lease, available: !!output && output.state !== 'disconnected',
      connectionEpoch: lease?.connectionEpoch ?? null, routeRevision: lease?.routeRevision ?? this._routeRevision,
      channelScope: this._outputChannelScopes.has(output) ? [...this._outputChannelScopes.get(output)] : null,
      budgetProfile: this.getTransportBudget(outputId),
      mpeReady: output && this.config.mpe?.enabled ? this._mpeStatusByOutput.get(output) ?? null : null,
      mpeFailure: output && this.config.mpe?.enabled ? this._mpeFailureByOutput.get(output) ?? null : null,
      mpeZone: this.config.mpe?.enabled ? this._mpeZonePlan : null,
      expressiveCapacity: this.config.mpe?.enabled ? this._memberChannels.length : null,
      voicePolicy: this.config.mpe?.enabled ? this._mpeZonePlan?.voicePolicy : null,
      mpeEvidence: output && this.config.mpe?.enabled && this._mpeStatusByOutput.get(output) ? this._mpeZonePlan?.configuration === 'send-zone'
        ? 'zone-configuration-api-accepted' : 'manual-zone-api-accepted' : null };
  },

  invalidateOutputState(outputId = null, channel = null) {
    const output = this._resolveOutput(outputId);
    if (channel == null) this._expressionByOutput.delete(output);
    else this._expressionByOutput.get(output)?.delete(channel);
  },

  rearmOutput(outputId = null) {
    const output = this._resolveOutput(outputId);
    if (!output || this._disposed) return false;
    this.lastOutputError = null;
    this._cleanupDepth++;
    try { this._retireOutput(output); this._registerOutput(output); this._initMpe(output); }
    finally { this._cleanupDepth--; }
    return this._mpeStatusByOutput.get(output) !== false;
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
    if (!state) { state = { bindings: new Map() }; channels.set(channelNumber, state); }
    return state;
  },

  _ensembleChannels(config = this.config) {
    const ensemble = config.ensemble;
    const channels = new Set(ensemble?.enabled ? (ensemble.roles || []).filter(role => role.track).map(role =>
      normalizeChannelNumber(role.track.channel, 1)) : []);
    if (Object.values(config.sfx || {}).some(source => source?.percussion)) channels.add(10);
    for (const range of config.laneMusic?.ranges || []) if (range.enabled) {
      if (range.schemeId.startsWith('procgen-drum-')) channels.add(10);
      if (range.schemeId === 'game-iron-ensemble') for (const channel of [2, 3, 4, 10]) channels.add(channel);
    }
    return channels;
  },

  _isMpeNote(spec) {
    return !!this.config.mpe?.enabled && !spec?.ensembleRole && !spec?.percussion;
  },

  _expressionPlan(spec, output, channelNumber, estimating = false) {
    const state = output ? this._expressionState(output, channelNumber) : {};
    let hasPending = false, pendingSpanPan = false, pendingSpanTimbre = false;
    if (estimating) for (const pending of this._pendingNoteOns.values()) if (pending.output === output && pending.channel === channelNumber) {
      hasPending = true; pendingSpanPan ||= pending.spanPan; pendingSpanTimbre ||= pending.spanTimbre;
    }
    const uncertain = estimating && (this._isMpeNote(spec) || hasPending);
    const controls = [];
    const signed = (this.config.position?.panRange?.min ?? 0) < 0;
    const panValue = pan => signed ? Math.round((clamp(pan, -127, 127) + 127) / 2) : clamp(pan, 0, 127);
    const spanState = { spanPan: spec.spanPan === true && !output?.supportsPerNotePan, spanTimbre: spec.spanTimbre === true,
      spanBasePan: Number.isFinite(spec.spanBasePan) ? panValue(spec.spanBasePan) : state.spanPan ? state.spanBasePan : state.pan ?? panValue(0),
      spanBaseTimbre: Number.isFinite(spec.spanBaseTimbre) ? spec.spanBaseTimbre : state.spanTimbre ? state.spanBaseTimbre : state.timbre ?? 64 };
    let coalesced = 0;
    const add = (key, value, type, cc = null, bytes = MIDI_MESSAGE_BYTES, force = false, targetChannel = channelNumber) => {
      const binding = `${type}:${cc ?? key}`;
      const controlState = targetChannel === channelNumber ? state : this._expressionState(output, targetChannel);
      if (force || uncertain || controlState.bindings?.get(binding) !== value) controls.push({ key, value, type, cc, bytes, binding, channel: targetChannel, state: controlState });
      else coalesced += 1;
    };
    const patchChannel = this._isMpeNote(spec) && this._mpeZonePlan?.programPolicy !== 'member-mode4'
      ? this._mpeZonePlan.managerChannel : channelNumber;
    if (!output?.supportsPerNoteInstrument) {
      if (Number.isInteger(spec.bankMsb) && spec.bankMsb >= 0 && spec.bankMsb <= 127) add('bankMsb', spec.bankMsb, 'cc', 0, 3, false, patchChannel);
      if (Number.isInteger(spec.bankLsb) && spec.bankLsb >= 0 && spec.bankLsb <= 127) add('bankLsb', spec.bankLsb, 'cc', 32, 3, false, patchChannel);
    }
    if (!output?.supportsPerNoteInstrument && Number.isInteger(spec.program) && spec.program >= 0 && spec.program <= 127) {
      add('program', spec.program, 'program', null, 2, controls.some(control => control.key === 'bankMsb' || control.key === 'bankLsb'), patchChannel);
    }
    if (this._isMpeNote(spec) || Number.isFinite(spec.pitchBend)) add('bend', clamp(spec.pitchBend ?? 0, -1, 1), 'bend');
    if (Number.isFinite(spec.timbre)) add('timbre', clamp(spec.timbre, 0, 127), 'cc', this.config.mpe?.timbreCc ?? 74);
    else if (state.spanTimbre || pendingSpanTimbre) add('timbre', state.spanBaseTimbre ?? 64, 'cc', this.config.mpe?.timbreCc ?? 74);
    if (Number.isFinite(spec.pan) && !output?.supportsPerNotePan && (!spec.spatialPan || this._isMpeNote(spec))) {
      add('pan', panValue(spec.pan), 'cc', 10);
    } else if (!output?.supportsPerNotePan && (state.spanPan || pendingSpanPan)) add('pan', state.spanBasePan ?? panValue(0), 'cc', 10);
    return { state, spanState, controls, coalesced, messages: controls.length, bytes: controls.reduce((sum, control) => sum + control.bytes, 0) };
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
    const setupRevision = this._mpeRevision;
    const plan = this._mpeZonePlan || createMpeZonePlan(mpe, this._ensembleChannels());
    const master = plan.managerChannel, uniqueMembers = plan.memberChannels;
    this._mpeZoneFailure = plan.reason;
    const channels = plan.ok ? [master, ...uniqueMembers] : [];
    for (const targetOutput of outputs) {
      let ready = !this._mpeZoneFailure && channels.length === uniqueMembers.length + 1;
      if (ready) ready = channels.every(ch => targetOutput.channels?.[ch] &&
        typeof targetOutput.channels[ch].sendPitchBendRange === 'function' &&
        typeof targetOutput.channels[ch].sendPitchBend === 'function');
      if (ready && plan.configurationMessages.length) ready = typeof targetOutput.channels?.[master]?.sendControlChange === 'function';
      if (!ready) {
        this._mpeStatusByOutput.set(targetOutput, false);
        this._mpeFailureByOutput.set(targetOutput, this._mpeZoneFailure || 'mpe-channel-unsupported');
        continue;
      }
      const outputId = this._resolveOutputId(targetOutput.id), timestamp = this._nowMs();
      const setupMessages = channels.length * 7 + plan.configurationMessages.length;
      const reservation = this.evaluateAndReserve({ on: { timeMs: timestamp, count: setupMessages, bytes: setupMessages * 3 } },
        { outputId, source: 'mpe-init' }, timestamp);
      if (!reservation.ok) {
        this._mpeStatusByOutput.set(targetOutput, false); this._mpeFailureByOutput.set(targetOutput, 'setup-' + reservation.reason);
        this.recordThrottle(reservation.reason, timestamp, { outputId }); continue;
      }
      let acceptedBytes = 0;
      const setupLease = this._outputLeases.get(targetOutput);
      const stillAuthorized = () => setupRevision === this._mpeRevision && this._outputLeases.get(targetOutput) === setupLease;
      const removeObserver = this.addSubmissionObserver(event => {
        if (event.output !== targetOutput || event.reason !== 'mpe-init' || !event.accepted || !event.midiBytes) return;
        acceptedBytes += event.midiBytes.length;
        if (!this._commitReservationMessage(reservation.reservationId, 'on', event.midiBytes.length, { outputId }, event.submittedMs)) {
          this._recordSent({ timeMs: event.submittedMs, count: 1, bytes: event.midiBytes.length, outputId, phase: 'on' }, event.submittedMs);
        }
      });
      try {
        for (const [controller, value] of plan.configurationMessages) {
          if (!stillAuthorized() || this._sendOutput(targetOutput, master, 'sendControlChange', [controller, value], { reason: 'mpe-init' }) === false) {
            ready = false; break;
          }
        }
        for (const ch of channels) {
          try {
            if (!ready || !stillAuthorized()) { ready = false; break; }
            const bend = ch === master ? plan.managerRange : plan.memberRange;
            const before = acceptedBytes;
            const rangeAccepted = this._sendOutput(targetOutput, ch, 'sendPitchBendRange', [bend.semitones, bend.cents], { reason: 'mpe-init' });
            if (rangeAccepted === false) { ready = false; break; }
            if (acceptedBytes === before && !this._commitReservationCost(reservation.reservationId, 'on', 6, 18, { outputId }, this._nowMs())) {
              this._recordSent({ timeMs: this._nowMs(), count: 6, bytes: 18, outputId, phase: 'on' }, this._nowMs());
            }
            if (!stillAuthorized()) { ready = false; break; }
            if (this._sendOutput(targetOutput, ch, 'sendPitchBend', [0], { reason: 'mpe-init' }) === false) { ready = false; break; }
            if (!stillAuthorized()) { ready = false; break; }
            this._expressionState(targetOutput, ch).bend = 0;
            this._expressionState(targetOutput, ch).bindings.set('bend:bend', 0);
          } catch (error) {
            this.lastOutputError = error?.message || String(error);
            ready = false;
            break;
          }
        }
      } catch (error) { ready = false; this.lastOutputError = error?.message || String(error); }
      finally { removeObserver(); this._releaseReservation(reservation.reservationId); }
      if (setupRevision !== this._mpeRevision) continue;
      this._mpeStatusByOutput.set(targetOutput, ready);
      this._mpeFailureByOutput.set(targetOutput, ready ? null : 'mpe-setup-rejected');
      if (!ready) this._expressionByOutput.delete(targetOutput);
    }
    if (setupRevision === this._mpeRevision) this._memberChannels = plan.ok ? uniqueMembers.slice() : [];
  },

  _stopActiveChannel(channelNumber, outputId = null, reason = 'ownership-release') {
    const activeKey = this._activeChannelKey(channelNumber, outputId);
    const active = this._activeByChannel.get(activeKey);
    if (active?.token != null && this._activeNotes.has(active.token)) {
      this._stopActiveNoteToken(active.token, reason);
      return;
    }
    const resolvedOutputId = active?.outputId ?? outputId;
    const output = this._resolveOutput(resolvedOutputId);
    if (!active || !output) return;
    const channel = output.channels?.[channelNumber];
    if (channel) {
      this._sendOutput(output, channelNumber, 'sendNoteOff', [active.note], active.captureMeta);
      this._sendOutput(output, channelNumber, 'sendPitchBend', [0], active.captureMeta);
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

  _countSoundingNotes(trackId = null) {
    const normalized = normalizeTrackId(trackId);
    let count = 0;
    for (const info of this._activeNotes.values()) {
      if (info.hasStarted === true && (!normalized || info.trackId === normalized)) count++;
    }
    return count;
  },

  _planLocalNoteAdmission(output, meta, trackId, voiceBudget) {
    if (typeof output.isVoiceActive === 'function') {
      for (const [token, info] of this._activeNotes) {
        if (info.output === output && info.hasStarted && !output.isVoiceActive(token)) this._stopActiveNoteToken(token);
      }
    }
    if (typeof output.canAllocateVoice === 'function' && !output.canAllocateVoice()) {
      this.recordThrottle('local-source-cap', this._nowMs(), meta);
      return null;
    }
    let total = this._countSoundingNotes(), trackTotal = trackId ? this._countSoundingNotes(trackId) : 0;
    if (total < this._maxActiveNotes && (!trackId || voiceBudget == null || trackTotal < voiceBudget)) return [];
    const victims = [], candidates = [...this._activeNotes.values()].filter(info => info.hasStarted === true && info.output === output);
    while (total >= this._maxActiveNotes || trackId && voiceBudget != null && trackTotal >= voiceBudget) {
      const trackFull = trackId && voiceBudget != null && trackTotal >= voiceBudget;
      const victim = selectLocalAudioVoice(trackFull ? candidates.filter(info => info.trackId === trackId) : candidates, meta);
      if (!victim) {
        this.recordThrottle('local-voice-priority', this._nowMs(), meta);
        return null;
      }
      victims.push(victim.token); candidates.splice(candidates.indexOf(victim), 1);
      total--; if (victim.trackId === trackId) trackTotal--;
    }
    return victims;
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

  _stopActiveNoteToken(oldestToken, reason = 'ownership-release', releaseOptions = null) {
    if (oldestToken == null || typeof this._activeNotes?.get !== 'function') return;
    const info = this._activeNotes.get(oldestToken);
    if (!info) return;
    // Detach ownership before invoking an output: callbacks may stop or replace it.
    this._activeNotes.delete(oldestToken);
    if (info.mpe) {
      const key = this._activeChannelKey(info.channel, info.outputId);
      if (this._activeByChannel.get(key)?.token === oldestToken) this._activeByChannel.delete(key);
    }
    this._removeScheduledNoteOff(oldestToken);
    const pending = this._pendingNoteOns.get(oldestToken);
    if (pending?.timerId != null) clearTimeout(pending.timerId);
    this._pendingNoteOns.delete(oldestToken);
    if (info.hasStarted === false && !info.submitting) this._observe('cancelled', { ...info.captureMeta, type: 'noteOn', reason: 'pending-note-cancelled' });
    const output = info.output || this._resolveOutput(info.outputId), channel = output?.channels?.[info.channel];
    let sentMessages = 0, released = false, cleanupUncertain = false;
    this._cleanupDepth++;
    try {
      if (channel && info.hasStarted !== false) {
        const outputReleaseOptions = releaseOptions ? { ...releaseOptions } : null;
        if (outputReleaseOptions) delete outputReleaseOptions.dispatchedAtMs;
        const options = releaseOptions || output.supportsIndependentNoteGates
          ? [{ ...outputReleaseOptions, ...(output.supportsIndependentNoteGates ? { voiceToken: info.token, reason } : {}) }] : [];
        if (typeof channel.sendNoteOff === 'function' &&
            this._sendOutput(output, info.channel, 'sendNoteOff', [info.note, ...options], { ...info.captureMeta, scheduledMs: releaseOptions?.time ?? this._nowMs(), reason }) !== false) { sentMessages += 1; released = true; }
        if (info.mpe) {
          if (typeof channel.sendPitchBend === 'function' &&
              this._sendOutput(output, info.channel, 'sendPitchBend', [0, ...(releaseOptions ? [{ time: releaseOptions.time }] : [])], info.captureMeta) !== false) {
            this._expressionState(output, info.channel).bend = 0;
            this._expressionState(output, info.channel).bindings.set('bend:bend', 0);
            sentMessages += 1;
          } else cleanupUncertain = true;
        }
      }
    } catch (error) { this.lastOutputError = error?.message || String(error); cleanupUncertain = true; }
    finally { this._cleanupDepth--; }
    this._removePlannedRateEntries(oldestToken, 'off');
    if (info.hasStarted === false) this._removePlannedRateEntries(oldestToken, 'on');
    // Normal timed releases already own a reserved rate entry.
    if (sentMessages > 0) {
      const sentAt = Number.isFinite(releaseOptions?.dispatchedAtMs) ? releaseOptions.dispatchedAtMs : this._nowMs();
      this._recordSent({ timeMs: sentAt, count: sentMessages, bytes: sentMessages * MIDI_MESSAGE_BYTES,
        token: oldestToken, phase: 'off', outputId: info.outputId ?? null, laneIndex: info.laneIndex ?? 0,
        laneCount: info.laneCount ?? 1, sfxId: info.sfxId, priority: info.priority }, sentAt);
    }
    const result = Object.freeze({ token: oldestToken, outputId: info.outputId ?? null, channel: info.channel,
      connectionEpoch: info.connectionEpoch ?? null, routeRevision: info.routeRevision ?? null, reason,
      state: info.submitting ? 'uncertain' : info.hasStarted === false ? 'cancelled' : released && !cleanupUncertain ? 'release-submitted' : 'uncertain',
      evidence: info.submitting ? 'submission-in-progress' : info.hasStarted === false ? 'application-queue-removed' : released ? 'adapter-returned' : 'release-unconfirmed' });
    this._observe('voice-terminal', { ...info.captureMeta, ...result });
    return result;
  },

  _allocateChannel(outputId = null, reason = 'mpe-channel-steal') {
    const mpe = this.config.mpe;
    if (!mpe?.enabled) {
      return normalizeChannelNumber(this.config.defaultChannel, 1);
    }
    if (this._mpeZonePlan?.ok === false) return null;
    const normalizedOutputId = this._resolveOutputId(outputId);
    const output = this._resolveOutput(normalizedOutputId);
    const reserved = this._ensembleChannels();
    const eligible = new Set(this._memberChannels.filter(ch => !reserved.has(ch) && (!output || !!output.channels?.[ch])));
    for (const ch of this._memberChannels) {
      if (eligible.has(ch) && !this._activeByChannel.has(this._activeChannelKey(ch, normalizedOutputId))) {
        return ch;
      }
    }
    if (this._mpeZonePlan?.voicePolicy === 'reject') return null;
    let oldest = null;
    let oldestTime = Infinity;
    for (const [ch, info] of this._activeByChannel.entries()) {
      const occupiedChannel = info.channel ?? ch;
      if (this._resolveOutputId(info?.outputId) !== normalizedOutputId || !eligible.has(occupiedChannel)) continue;
      if (info.startedAt < oldestTime) {
        oldestTime = info.startedAt;
        oldest = occupiedChannel;
      }
    }
    if (oldest != null) {
      this._stopActiveChannel(oldest, normalizedOutputId, reason);
      return oldest;
    }
    return null;
  },
};

export { midiSchedulerChannelMethods };
