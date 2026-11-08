export const OWNED_MIDI_ADMISSION = Symbol('owned-midi-admission');
const owners = new WeakMap();
const uncertainOutputs = new WeakMap();
export const hasUncertainOwnedMidiOutput = (scheduler, output) => !!output && uncertainOutputs.get(scheduler)?.has(output) === true;
const refused = reason => Object.freeze({ status: 'rejected', reason });
const byte = value => Number.isInteger(value) && value >= 0 && value <= 127;
const commandsFor = patch => {
  if (!patch || Object.getPrototypeOf(patch) !== Object.prototype || Object.keys(patch).some(key => !['bend', 'pan', 'timbre', 'pressure', 'gain'].includes(key))) return null;
  const commands = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'bend') {
      if (!Number.isFinite(value) || value < -1 || value > 1) return null;
      commands.push({ method: 'sendPitchBend', args: [value], bytes: 3 });
    } else {
      if (!byte(value)) return null;
      commands.push(key === 'pressure' ? { method: 'sendChannelAftertouch', args: [value], bytes: 2 } :
        { method: 'sendControlChange', args: [key === 'pan' ? 10 : key === 'gain' ? 11 : 74, value], bytes: 3 });
    }
  }
  return commands;
};
export function finishOwnedMidiVoice(scheduler, record, terminal) {
  if (!record || record.scheduler !== scheduler || record.terminal) return;
  record.terminal = terminal;
  if (terminal.state === 'uncertain') {
    if (!uncertainOutputs.has(scheduler)) uncertainOutputs.set(scheduler, new Set());
    uncertainOutputs.get(scheduler).add(record.output);
  }
  if (record.timer != null) clearTimeout(record.timer);
  record.timer = null;
  for (const job of record.jobs) {
    scheduler._releaseReservation(job.reservationId);
    try { job.onResult?.(refused('voice-retired')); } catch { /* Observers cannot retain work. */ }
  }
  record.jobs.length = 0;
  try { if (record.handle) record.onTerminal?.(terminal); } catch { /* Terminal observers cannot reopen ownership. */ }
}
export function observeOwnedMidiSubmission(scheduler, record, receipt) {
  if (!record || record.scheduler !== scheduler || record.terminal || !record.handle) return;
  try { record.onSubmitted?.(Object.freeze(receipt)); } catch { /* Submission evidence cannot change a gate. */ }
}
export function canSubmitOwnedMidiVoice(scheduler, record) {
  if (!record) return true;
  if (record.scheduler !== scheduler || record.terminal || uncertainOutputs.get(scheduler)?.has(record.output)) return false;
  try { return !record.canSubmit || record.canSubmit() === true; } catch { return false; }
}
const stateFor = (scheduler, handle) => {
  const record = owners.get(handle);
  return record?.scheduler === scheduler ? record : null;
};
const activeFor = (scheduler, record) => {
  const voice = record && !record.terminal && scheduler._activeNotes.get(record.token);
  return voice?.ownedAdmission === record ? voice : null;
};
const execute = (scheduler, record, job) => {
  scheduler._releaseReservation(job.reservationId);
  const voice = activeFor(scheduler, record);
  if (!voice || !voice.hasStarted) return refused('onset-not-submitted');
  const lease = scheduler._outputLeases.get(voice.output);
  if (!lease || lease.connectionEpoch !== voice.connectionEpoch || lease.routeRevision !== voice.routeRevision || voice.output.state === 'disconnected') return refused('output-ownership-changed');
  if (!voice.mpe && !voice.output.supportsIndependentNoteGates) return refused('per-note-expression-unavailable');
  if (job.commands.some(command => typeof voice.output.channels?.[voice.channel]?.[command.method] !== 'function')) return refused('expression-unsupported');
  let submittedMessages = 0;
  for (const command of job.commands) {
    if (activeFor(scheduler, record) !== voice) return Object.freeze({ ...refused('voice-retired-during-expression'), submittedMessages });
    const options = { time: job.timeMs, ...(command.method === 'sendChannelAftertouch' ? { rawValue: true } : {}) };
    const result = scheduler._submitAccountedOutput(voice.output, voice.channel, command.method, [...command.args, options], voice.captureMeta,
      { token: record.token, phase: 'expression', outputId: voice.outputId, laneIndex: voice.laneIndex, laneCount: voice.laneCount });
    submittedMessages += result.acceptedMessages;
    if (!result.ok) return Object.freeze({ ...refused('expression-submission-rejected'), submittedMessages });
  }
  scheduler.invalidateOutputState(voice.outputId, voice.channel);
  return Object.freeze({ status: 'accepted', stage: 'submitted', submittedMessages, outputId: voice.outputId, channel: voice.channel, timeMs: job.timeMs });
};
const arm = (scheduler, record) => {
  if (record.timer != null) clearTimeout(record.timer);
  record.timer = null;
  if (!record.jobs.length || record.terminal) return;
  record.timer = setTimeout(() => {
    record.timer = null;
    while (record.jobs.length && record.jobs[0].timeMs <= scheduler._nowMs()) {
      const job = record.jobs.shift(), result = execute(scheduler, record, job);
      try { job.onResult?.(result); } catch { /* Output observers cannot stop draining. */ }
    }
    arm(scheduler, record);
  }, Math.max(0, record.jobs[0].timeMs - scheduler._nowMs()));
};

export const ownedMidiVoiceMethods = {
  beginOwnedVoice(spec, meta = {}, { onTerminal, onSubmitted, canSubmit } = {}) {
    if (this._disposed || this._cleanupDepth || this._outputCallbackDepth || !spec || spec.durationTicks != null && spec.durationTicks !== 0) return refused('owned-voice-admission-unavailable');
    if (onTerminal != null && typeof onTerminal !== 'function' || onSubmitted != null && typeof onSubmitted !== 'function' || canSubmit != null && typeof canSubmit !== 'function') return refused('invalid-voice-observer');
    const output = this._resolveOutput(spec.outputId), channel = spec.channel ?? this.config.defaultChannel ?? 1, start = spec.timeMs ?? this._nowMs();
    if (!Number.isInteger(spec.note) || spec.note < 0 || spec.note > 127 || !Number.isInteger(channel) || channel < 1 || channel > 16 || !Number.isFinite(start) || start < 0 || start - this._nowMs() > 5000) return refused('invalid-owned-note');
    if (uncertainOutputs.get(this)?.has(output)) return refused('owned-output-retirement-unknown');
    if (!this._isMpeNote(spec) && !output?.supportsIndependentNoteGates) for (const voice of this._activeNotes.values()) {
      if (voice.output === output && voice.channel === channel && voice.note === spec.note && (voice.offTimeMs > voice.startedAt ? voice.offTimeMs : Infinity) > start) return refused('same-pitch-owner-busy');
    }
    const record = { scheduler: this, token: null, output, jobs: [], timer: null, terminal: null, handle: null, onTerminal, onSubmitted, canSubmit };
    const accepted = this.sendNote({ ...spec, durationTicks: 0, [OWNED_MIDI_ADMISSION]: record }, meta);
    const active = activeFor(this, record);
    if (!accepted || !active) {
      let handle = null;
      if (record.terminal?.state === 'uncertain') { handle = Object.freeze({ schema: 'midi-owned-voice/v1', token: record.token }); owners.set(handle, record); record.handle = handle; }
      return Object.freeze({ ...refused(record.terminal?.state === 'uncertain' ? 'onset-ownership-uncertain' : 'onset-rejected'), ...(handle ? { handle } : {}), ...(record.terminal ? { terminal: record.terminal } : {}) });
    }
    const handle = Object.freeze({ schema: 'midi-owned-voice/v1', token: record.token }); owners.set(handle, record);
    record.handle = handle;
    return Object.freeze({ status: 'accepted', stage: active.hasStarted ? 'submitted' : 'scheduled', handle, outputId: active.outputId, channel: active.channel });
  },
  inspectOwnedVoice(handle) {
    const record = stateFor(this, handle), voice = activeFor(this, record);
    if (!record) return refused('foreign-voice-handle');
    return Object.freeze({ status: voice ? voice.hasStarted ? 'submitted' : 'scheduled' : 'retired', token: record.token,
      ...(voice ? { outputId: voice.outputId, channel: voice.channel, note: voice.note, generation: voice.actorMeta?.generation ?? null,
        connectionEpoch: voice.connectionEpoch, routeRevision: voice.routeRevision, mpe: voice.mpe, pendingUpdates: record.jobs.length } : { terminal: record.terminal }) });
  },
  updateOwnedVoice(handle, patch, { timeMs = this._nowMs(), onResult } = {}) {
    const record = stateFor(this, handle), voice = activeFor(this, record), commands = commandsFor(patch), now = this._nowMs();
    if (!voice || this._disposed || this._cleanupDepth || this._outputCallbackDepth) return refused('voice-unavailable');
    if (!commands || !Number.isFinite(timeMs) || timeMs < 0 || timeMs - now > 5000 || onResult != null && typeof onResult !== 'function') return refused('invalid-owned-expression');
    if (!voice.mpe && !voice.output.supportsIndependentNoteGates && commands.length) return refused('per-note-expression-unavailable');
    if (!commands.length) return Object.freeze({ status: 'accepted', stage: 'unchanged' });
    const channels = voice.channel == null ? this._memberChannels : [voice.channel];
    if (!channels.length || channels.some(channel => commands.some(command => typeof voice.output.channels?.[channel]?.[command.method] !== 'function'))) return refused('expression-unsupported');
    if (record.jobs.length >= 16) return refused('owned-expression-capacity');
    const reservation = this.evaluateAndReserve({ on: { timeMs, count: commands.length, bytes: commands.reduce((sum, command) => sum + command.bytes, 0) } }, { ...voice.actorMeta, outputId: voice.outputId }, now);
    if (!reservation.ok) return refused(reservation.reason);
    const job = { timeMs, commands, onResult, reservationId: reservation.reservationId };
    if (timeMs <= now) return execute(this, record, job);
    record.jobs.push(job); record.jobs.sort((a, b) => a.timeMs - b.timeMs); arm(this, record);
    return Object.freeze({ status: 'accepted', stage: 'scheduled', timeMs, outputId: voice.outputId });
  },
  endOwnedVoice(handle, { timeMs = this._nowMs(), releaseVelocity = 64, reason = 'semantic-release' } = {}) {
    const record = stateFor(this, handle), voice = activeFor(this, record);
    if (!record) return refused('foreign-voice-handle');
    if (!voice) return record.terminal?.state === 'uncertain' ? Object.freeze({ ...refused('release-unconfirmed'), terminal: record.terminal }) : Object.freeze({ status: 'accepted', stage: 'already-retired', terminal: record.terminal });
    if (!Number.isFinite(timeMs) || timeMs < 0 || !byte(releaseVelocity) || typeof reason !== 'string' || reason.length > 128 || timeMs - this._nowMs() > 5000) return refused('invalid-owned-release');
    if (timeMs > this._nowMs() && timeMs >= voice.startedAt) {
      if (voice.offTimeMs > voice.startedAt && voice.offTimeMs <= timeMs) return Object.freeze({ status: 'accepted', stage: 'scheduled', timeMs: voice.offTimeMs });
      this._removeScheduledNoteOff(record.token); voice.offTimeMs = timeMs;
      this._scheduleNoteOff({ timeMs, token: record.token, releaseVelocity, reason });
      return Object.freeze({ status: 'accepted', stage: 'scheduled', timeMs });
    }
    const terminal = this._stopActiveNoteToken(record.token, reason, { rawRelease: releaseVelocity, time: Math.max(timeMs, this._nowMs()) });
    return Object.freeze({ status: terminal?.state === 'uncertain' ? 'rejected' : 'accepted', stage: terminal?.state === 'cancelled' ? 'cancelled' : 'submitted',
      ...(terminal?.state === 'uncertain' ? { reason: 'release-unconfirmed' } : {}), terminal });
  }
};
