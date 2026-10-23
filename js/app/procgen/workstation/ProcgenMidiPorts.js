import { MidiScheduler } from '../../../midi/MidiScheduler.js';
import { clearProcgenMidiQueue, sendProcgenMidiBytes } from './ProcgenMidiBytes.js';

const byte = value => Math.min(127, Math.max(0, Math.round(Number(value) || 0)));
const channelByte = channel => Math.min(15, Math.max(0, (Number(channel) || 1) - 1));
const ACTIVE_SENSING_TIMEOUT_MS = 300;
const HOST_OBSERVATION_GAP_MS = 600;

export function decodeProcgenMidi(data, timestamp = 0) {
  const bytes = Array.from(data || []), status = bytes[0], family = status & 0xf0;
  if (!(status >= 0x80 && status <= 0xef)) return { type: 'system', data: bytes, timestamp };
  const event = { data: bytes, timestamp, channel: (status & 15) + 1 };
  if (family === 0x80 || family === 0x90) return { ...event, type: family === 0x80 || !bytes[2] ? 'noteOff' : 'noteOn', note: bytes[1], velocity: bytes[2] };
  if (family === 0xa0) return { ...event, type: 'polyPressure', note: bytes[1], value: bytes[2] };
  if (family === 0xb0) return { ...event, type: 'cc', controller: bytes[1], value: bytes[2] };
  if (family === 0xc0) return { ...event, type: 'program', value: bytes[1] };
  if (family === 0xd0) return { ...event, type: 'pressure', value: bytes[1] };
  return { ...event, type: 'bend', value: ((bytes[2] << 7) | bytes[1]) - 8192 };
}

export function encodeProcgenMidi(event) {
  if (event.data) return [Array.from(event.data)];
  const channel = channelByte(event.channel);
  switch (event.type) {
  case 'noteOn': return [[0x90 | channel, byte(event.note), byte(event.velocity ?? 100)]];
  case 'noteOff': return [[0x80 | channel, byte(event.note), byte(event.velocity)]];
  case 'sustain': return [[0xb0 | channel, 64, event.value === true ? 127 : byte(event.value)]];
  case 'cc': return [[0xb0 | channel, byte(event.controller), byte(event.value)]];
  case 'program': return [[0xc0 | channel, byte(event.value ?? event.program)]];
  case 'bank': return [[0xb0 | channel, 0, byte(event.msb)], [0xb0 | channel, 32, byte(event.lsb)]];
  case 'pressure': return [[0xd0 | channel, byte(event.value)]];
  case 'polyPressure': return [[0xa0 | channel, byte(event.note), byte(event.value)]];
  case 'bend': {
    const bend = Math.min(16383, Math.max(0, Math.round(Number(event.value) || 0) + 8192));
    return [[0xe0 | channel, bend & 127, bend >> 7]];
  }
  default: return [];
  }
}

export function createProcgenMidiPorts({ transport, now = () => performance.now(), scheduler: suppliedScheduler, schedulerConfig = { defaultChannel: 1 },
  onMonitor = () => {}, onLearn = () => {}, onRecord = () => {}, onState = () => {}, maxRecordedEvents = 100000 } = {}) {
  const scheduler = suppliedScheduler || new MidiScheduler(schedulerConfig);
  let input = null, noteOutput = null, clockOutput = null, removeInput = null;
  let thru = false, recording = false, learn = null, disposed = false, records = [], droppedRecords = 0;
  let inputEpoch = 0, lastObservationMs = now(), expiredAt = null, systemResetPolicy = 'observe', sensingTimer = null;
  const inputLiveness = { mode: 'unobserved', lastTrafficTime: null, deadline: null, evidence: 'no-active-sensing-observed', reason: null };
  const thruNotes = new Map();
  let retainedEvents = 0, eventSequence = 0, firstLostSequence = null, incompleteReason = null, intentRenderSequence = 0;
  const intentRenderEntries = new Set(), intentExpiry = [], activeTrace = new Map();
  const usedChannels = new Map(), noteOutputs = new Map();
  const resolveOutput = outputId => outputId == null || outputId === '' ? noteOutput : noteOutputs.get(String(outputId)) || (String(noteOutput?.id) === String(outputId) ? noteOutput : null);
  const useChannel = (port, channel) => {
    if (!usedChannels.has(port)) usedChannels.set(port, new Set());
    usedChannels.get(port).add(channel);
  };
  const getState = () => ({ inputId: input?.id || null, noteOutputId: noteOutput?.id || null,
    clockOutputId: clockOutput?.id || null, thru, recording, learning: !!learn,
    inputPortConnected: input ? input.state !== 'disconnected' : null,
    inputLiveness: { sourceRoute: input?.id || null, connectionEpoch: inputEpoch, observationDomain: 'performance-now', ...inputLiveness },
    clockStatus: transport?.getState?.().clockStatus ?? null, systemResetPolicy,
    noteOutputIds: [...noteOutputs.keys()], recordedEvents: retainedEvents, droppedRecords,
    recordingComplete: !incompleteReason, incompleteReason, firstLostSequence,
    pressure: scheduler.getOutputPressure?.(now()) || null });
  const report = () => onState(getState());
  const markIncomplete = reason => {
    if (!incompleteReason) { incompleteReason = reason; report(); }
  };
  const record = event => {
    if (!recording) return false;
    const sequence = ++eventSequence;
    if (records.length >= maxRecordedEvents) {
      droppedRecords++;
      firstLostSequence ??= sequence;
      recording = false;
      markIncomplete('recording-cap-reached');
      return false;
    }
    const state = transport?.getState(), timestamp = event.timestamp ?? now();
    const processingMs = now(), sourceIsPast = event.direction === 'input' && timestamp < processingMs;
    const beat = event.beat ?? (sourceIsPast ? null : (state?.beat || 0) + (timestamp - processingMs) * (state?.bpm || 120) / 60000);
    const stored = { ...event, sequence, beat, timestamp, data: [...event.data],
      ...(sourceIsPast ? { processedMs: processingMs, processingBeat: state?.beat ?? null, timingUncertainty: 'source-clock-unmapped' } : {}) };
    records.push(stored); retainedEvents++;
    if (event.evidence !== 'intent-render' && (event.direction === 'input' || event.direction === 'output')) {
      const [status, note, velocity] = stored.data;
      const family = status & 0xf0, key = `${event.direction}:${event.outputId || ''}:${status & 15}:${note}`;
      if (family === 0x90 && velocity) activeTrace.set(key, (activeTrace.get(key) || 0) + 1);
      else if (family === 0x80 || (family === 0x90 && !velocity)) {
        const remaining = (activeTrace.get(key) || 0) - 1;
        if (remaining > 0) activeTrace.set(key, remaining); else activeTrace.delete(key);
      }
    }
    onRecord(stored);
    return stored;
  };
  const cancelRecorded = event => { if (event && !event.cancelled) { event.cancelled = true; retainedEvents--; } };
  const pruneIntentEntries = timestamp => {
    while (intentExpiry.length && intentExpiry[0].end.timestamp <= timestamp) {
      const last = intentExpiry.pop();
      const expired = intentExpiry.length ? intentExpiry[0] : last;
      if (intentExpiry.length) {
        let parent = 0;
        while (true) {
          const left = parent * 2 + 1, right = left + 1;
          if (left >= intentExpiry.length) break;
          const child = right < intentExpiry.length && intentExpiry[right].end.timestamp < intentExpiry[left].end.timestamp ? right : left;
          if (intentExpiry[child].end.timestamp >= last.end.timestamp) break;
          intentExpiry[parent] = intentExpiry[child]; parent = child;
        }
        intentExpiry[parent] = last;
      }
      intentRenderEntries.delete(expired);
    }
  };
  const trackIntentExpiry = entry => {
    let index = intentExpiry.length;
    intentExpiry.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (intentExpiry[parent].end.timestamp <= entry.end.timestamp) break;
      intentExpiry[index] = intentExpiry[parent]; index = parent;
    }
    intentExpiry[index] = entry;
  };
  const removeSubmissionObserver = scheduler.addSubmissionObserver?.(event => {
    if (disposed || !recording || !event.accepted || event.backend !== 'midi-output-api' || !event.midiBytes) return;
    const { output, channel, scheduledMs, submittedMs, midiBytes: data } = event;
    useChannel(output, channel);
    record({ data, timestamp: scheduledMs, submittedMs, timestampDomain: 'performance-ms',
      outputId: event.outputId, outputScope: event.outputScope, channel, token: event.token ?? null,
      intentId: event.intentId ?? null, onsetId: event.onsetId ?? null, voiceId: event.voiceId ?? null,
      connectionEpoch: event.connectionEpoch ?? null, routeRevision: event.routeRevision ?? null,
      direction: 'output', source: 'scheduler', evidence: 'api-accepted', acknowledgement: 'adapter-returned',
      ...(event.reason ? { reason: event.reason } : {}) });
  });
  const raw = (data, timestamp = now(), meta = {}, capture = true) => {
    const port = resolveOutput(meta.outputId);
    if (disposed || !port || data[0] >= 0xf0) return false;
    let ownedReservationId = null;
    try {
      const family = data[0] & 0xf0;
      const release = family === 0x80 || (family === 0x90 && data[2] === 0) || (family === 0xb0 && [64, 120, 123].includes(data[1]) && !data[2]);
      if (capture && !release && meta.reservationId == null) {
        const reservation = scheduler.evaluateAndReserve?.({ on: { timeMs: timestamp, count: 1, bytes: data.length } }, { ...meta, outputId: port.id }, now());
        if (reservation && !reservation.ok) { scheduler.recordThrottle?.(reservation.reason, now(), meta); return false; }
        ownedReservationId = reservation?.reservationId ?? null;
      }
      if (!sendProcgenMidiBytes(port, data, timestamp)) {
        scheduler._releaseReservation?.(ownedReservationId, true);
        transport?.pause(); return false;
      }
      const sentAt = now(), reservationId = meta.reservationId ?? ownedReservationId;
      const committed = reservationId != null && scheduler._commitReservationMessage?.(reservationId, meta.reservationPhase ?? 'on', data.length,
        { ...meta, outputId: port.id }, sentAt);
      if (!committed) scheduler._recordSent?.({ timeMs: sentAt, count: 1, bytes: data.length, phase: meta.reservationPhase ?? 'on',
        outputId: port.id, trackId: meta.trackId, laneIndex: meta.laneIndex, laneCount: meta.laneCount, sfxId: meta.sfxId, priority: meta.priority }, sentAt);
      useChannel(port, (data[0] & 15) + 1);
      record({ ...meta, ...decodeProcgenMidi(data, timestamp), submittedMs: sentAt, timestampDomain: 'performance-ms',
        outputId: port.id || null, direction: 'output', source: meta.source || 'output', evidence: 'api-accepted', acknowledgement: 'adapter-returned' });
      return true;
    } catch { scheduler._releaseReservation?.(ownedReservationId, true); panic('output-error'); return false; }
  };
  function flushRecording() {
    if (!recording) return;
    const timestamp = now();
    pruneIntentEntries(timestamp);
    for (const entry of intentRenderEntries) {
      if (entry.start.timestamp > timestamp) {
        for (const event of entry.events) cancelRecorded(event);
      } else if (!entry.end || entry.end.timestamp > timestamp) {
        cancelRecorded(entry.end);
        if (!record({ direction: 'output', source: 'intent-render-cleanup', evidence: 'intent-render', outputId: entry.start.outputId,
          data: [0x80 | (entry.start.data[0] & 15), entry.start.data[1], 0], timestamp, intentRenderId: entry.id })) markIncomplete('cleanup-not-retained');
      }
    }
    intentRenderEntries.clear();
    intentExpiry.length = 0;
  }
  function flush() {
    flushRecording();
    thruNotes.clear();
    for (const port of new Set([noteOutput, clockOutput, ...noteOutputs.values()])) clearProcgenMidiQueue(port);
    scheduler.allNotesOff({ preserveRateHistory: true });
    for (const [port, channels] of usedChannels) {
      for (const channel of channels) {
        const base = channel - 1;
        for (const data of [[0xb0 | base, 64, 0], [0xb0 | base, 123, 0], [0xb0 | base, 120, 0], [0xe0 | base, 0, 64]]) {
          const timestamp = now();
          try {
            if (sendProcgenMidiBytes(port, data, timestamp)) record({ data, timestamp, submittedMs: now(), outputId: port?.id || null,
              direction: 'output', source: 'cleanup', evidence: 'api-accepted', acknowledgement: 'adapter-returned' });
          } catch { /* Cleanup must continue across disconnected ports. */ }
        }
      }
    }
    usedChannels.clear();
  }
  function panic() { transport?.panic(); flush(); }
  function releaseThru(reason) {
    const timestamp = now();
    for (const entry of thruNotes.values()) {
      for (let index = 0; index < entry.count; index++) {
        const data = [0x80 | (entry.channel - 1), entry.note, 0];
        try {
          if (sendProcgenMidiBytes(entry.port, data, timestamp)) record({ data, timestamp, submittedMs: now(),
            outputId: entry.port?.id || null, direction: 'output', source: 'input-safety', reason,
            evidence: 'api-accepted', acknowledgement: 'adapter-returned' });
        } catch { /* A disconnected output cannot acknowledge a safety release. */ }
      }
    }
    thruNotes.clear();
  }
  const resetInputLiveness = (mode = 'unobserved', reason = null) => {
    clearTimeout(sensingTimer); sensingTimer = null;
    inputLiveness.mode = mode; inputLiveness.lastTrafficTime = null; inputLiveness.deadline = null;
    inputLiveness.evidence = mode === 'unavailable' ? 'host-observation-gap' : 'no-active-sensing-observed';
    inputLiveness.reason = reason; expiredAt = null; lastObservationMs = now();
  };
  const inspectInputLiveness = () => {
    const observedAt = now();
    if (inputLiveness.mode === 'armed' && observedAt > inputLiveness.deadline) {
      const hostGap = observedAt - lastObservationMs > HOST_OBSERVATION_GAP_MS;
      inputLiveness.mode = hostGap ? 'unavailable' : 'expired'; inputLiveness.deadline = null;
      clearTimeout(sensingTimer); sensingTimer = null;
      inputLiveness.evidence = hostGap ? 'host-observation-gap' : 'active-sensing-timeout';
      inputLiveness.reason = hostGap ? 'host-suspended' : 'sensing-expired'; expiredAt = observedAt;
      if ([...activeTrace.keys()].some(key => key.startsWith('input:'))) {
        record({ type: 'safety-termination', direction: 'safety', source: 'input-liveness', reason: inputLiveness.reason,
          data: [], timestamp: observedAt, connectionEpoch: inputEpoch });
        for (const key of activeTrace.keys()) if (key.startsWith('input:')) activeTrace.delete(key);
        markIncomplete('input-sensing-terminated');
      }
      releaseThru(inputLiveness.reason); report();
    }
    lastObservationMs = observedAt;
    return observedAt;
  };
  const scheduleSensingWatchdog = () => {
    clearTimeout(sensingTimer);
    if (disposed || inputLiveness.mode !== 'armed') return;
    sensingTimer = setTimeout(() => { sensingTimer = null; inspectInputLiveness(); if (inputLiveness.mode === 'armed') scheduleSensingWatchdog(); },
      Math.max(1, Math.ceil(inputLiveness.deadline - now() + 1)));
  };
  function receiveMidi(data, timestamp = now()) {
    if (disposed || !data?.length) return false;
    const observedAt = inspectInputLiveness();
    if (expiredAt != null && Number.isFinite(timestamp) && timestamp < expiredAt) return false;
    const event = decodeProcgenMidi(data, timestamp);
    if (data[0] === 0xfe) {
      const changed = inputLiveness.mode !== 'armed'; inputLiveness.mode = 'armed'; inputLiveness.evidence = 'observed-active-sensing'; inputLiveness.reason = null;
      inputLiveness.lastTrafficTime = observedAt; inputLiveness.deadline = observedAt + ACTIVE_SENSING_TIMEOUT_MS;
      if (changed) report();
    } else if (inputLiveness.mode === 'armed') { inputLiveness.lastTrafficTime = observedAt; inputLiveness.deadline = observedAt + ACTIVE_SENSING_TIMEOUT_MS; }
    else if (expiredAt != null) { inputLiveness.mode = 'unobserved'; inputLiveness.evidence = 'no-active-sensing-observed'; inputLiveness.reason = null; }
    if (inputLiveness.mode === 'armed') scheduleSensingWatchdog();
    onMonitor(event); transport?.receiveMidi(data, timestamp);
    if (data[0] === 0xff && systemResetPolicy === 'release-owned') releaseThru('system-reset-observed');
    if (event.type === 'system') return true;
    record({ ...event, direction: 'input', source: 'input' });
    if (learn) { const callback = learn; learn = null; callback(event); report(); }
    // Realtime/transport messages are never echoed, including when Thru is on.
    if (thru && raw(event.data, timestamp, { source: 'thru' }) && ['noteOn', 'noteOff'].includes(event.type)) {
      const port = noteOutput, key = `${inputEpoch}:${port?.id}:${event.channel}:${event.note}`, previous = thruNotes.get(key);
      if (event.type === 'noteOn') thruNotes.set(key, { port, channel: event.channel, note: event.note, count: (previous?.count || 0) + 1 });
      else if (previous?.count > 1) previous.count--; else thruNotes.delete(key);
    }
    return true;
  }
  const replaceInput = port => {
    if (input === port || disposed) return;
    transport?.pause(); releaseThru('input-replaced'); removeInput?.(); removeInput = null; input = port || null; inputEpoch++; learn = null; resetInputLiveness();
    const epoch = inputEpoch, attached = input;
    const listener = event => attached === input && epoch === inputEpoch && receiveMidi(event.data || event.message?.data, event.receivedTime ?? event.timestamp ?? now());
    if (input?.addEventListener) {
      input.addEventListener('midimessage', listener);
      const attached = input; removeInput = () => attached.removeEventListener('midimessage', listener);
    } else if (input?.addListener) {
      input.addListener('midimessage', listener);
      const attached = input; removeInput = () => attached.removeListener('midimessage', listener);
    }
    report();
  };
  const noteMessages = spec => {
    const channel = channelByte(spec.channel), messages = [];
    if (Number.isFinite(spec.bankMsb)) messages.push([0xb0 | channel, 0, byte(spec.bankMsb)]);
    if (Number.isFinite(spec.bankLsb)) messages.push([0xb0 | channel, 32, byte(spec.bankLsb)]);
    if (Number.isFinite(spec.program)) messages.push([0xc0 | channel, byte(spec.program)]);
    if (Number.isFinite(spec.pitchBend)) messages.push(...encodeProcgenMidi({ type: 'bend', channel: spec.channel, value: Math.round(spec.pitchBend * 8192) }));
    if (Number.isFinite(spec.timbre)) messages.push([0xb0 | channel, scheduler.config?.mpe?.timbreCc ?? 74, byte(spec.timbre)]);
    if (Number.isFinite(spec.pan)) messages.push([0xb0 | channel, 10, byte(scheduler.config?.position?.panRange?.min < 0 ? (spec.pan + 127) / 2 : spec.pan)]);
    messages.push([0x90 | channel, byte(spec.note), byte(spec.velocity ?? 100)]);
    return messages;
  };
  const duration = spec => Math.max(0, spec.durationMs ?? (spec.durationTicks || 0) * (scheduler.tickMs || 60));
  function recordOutput(spec, meta = {}) {
    if (disposed || !recording || !Number.isFinite(spec.note)) return false;
    pruneIntentEntries(now());
    const timestamp = spec.timeMs ?? meta.timestamp ?? now(), durationMs = duration(spec);
    const state = transport?.getState(), bpm = meta.bpm ?? state?.bpm ?? 120;
    const beat = meta.beat ?? ((state?.beat || 0) + (timestamp - now()) * bpm / 60000);
    const outputId = spec.outputId ?? meta.outputId ?? noteOutput?.id ?? null;
    const messages = noteMessages(spec);
    if (records.length + messages.length + (durationMs ? 1 : 0) > maxRecordedEvents) {
      droppedRecords += messages.length + (durationMs ? 1 : 0);
      firstLostSequence ??= eventSequence + 1;
      recording = false;
      markIncomplete('recording-cap-reached');
      return false;
    }
    const id = ++intentRenderSequence, events = [];
    for (const data of messages) events.push(record({ ...meta, direction: 'output', source: meta.source || 'output', evidence: 'intent-render',
      intentRenderId: id, outputId, data, timestamp, beat }));
    let end = null;
    if (durationMs) end = record({ direction: 'output', source: meta.source || 'output', evidence: 'intent-render', intentRenderId: id, outputId,
      data: [0x80 | channelByte(spec.channel), byte(spec.note), byte(spec.releaseVelocity)],
      timestamp: timestamp + durationMs, beat: beat + durationMs * bpm / 60000 });
    if (end) events.push(end);
    const entry = { id, start: events.at(-1 - (end ? 1 : 0)), end, events };
    intentRenderEntries.add(entry);
    if (end) trackIntentExpiry(entry);
    return true;
  }
  return {
    getState, receiveMidi, flush, panic, recordOutput,
    setInput: replaceInput,
    setNoteOutput(port) {
      if (noteOutput === port || disposed) return;
      transport?.pause(); flush(); noteOutput = port || null;
      scheduler.setOutput(noteOutput?.channels ? noteOutput : null); report();
    },
    setNoteOutputs(ports = []) {
      if (disposed) return;
      const list = Array.isArray(ports) ? ports : Array.from(ports.values());
      const next = new Map(list.filter(port => port?.id).map(port => [String(port.id), port]));
      if (next.size === noteOutputs.size && [...next].every(([id, port]) => noteOutputs.get(id) === port)) return;
      for (const [id, port] of noteOutputs) if (next.get(id) !== port) clearProcgenMidiQueue(port);
      noteOutputs.clear();
      for (const [id, port] of next) noteOutputs.set(id, port);
      scheduler.setOutputs?.(list.filter(port => port.channels)); report();
    },
    setClockOutput(port) {
      if (clockOutput === port || disposed) return;
      clearProcgenMidiQueue(clockOutput); transport?.setClockOutput(port);
      clockOutput = port || null; report();
    },
    configure(settings = {}) {
      if (settings.thru !== undefined) thru = !!settings.thru;
      if (settings.systemResetPolicy !== undefined) {
        if (!['observe', 'release-owned'].includes(settings.systemResetPolicy)) throw new RangeError('Invalid input System Reset policy');
        systemResetPolicy = settings.systemResetPolicy;
      }
      if (settings.recording !== undefined) {
        if (recording && !settings.recording && (activeTrace.size || [...intentRenderEntries].some(entry => !entry.end || entry.end.timestamp > now()))) {
          markIncomplete('open-notes-at-stop');
        }
        recording = !!settings.recording;
      }
      if (settings.schedulerConfig) scheduler.setConfig?.(settings.schedulerConfig);
      report(); return getState();
    },
    learnNext(callback = onLearn) { learn = callback; report(); },
    cancelLearn() { learn = null; report(); },
    sendEvent(event) {
      const timestamp = event.timestamp ?? event.timeMs ?? now();
      const messages = encodeProcgenMidi(event);
      if (!messages.length) return false;
      for (const data of messages) if (!raw(data, timestamp, event)) return false;
      return true;
    },
    sendNote(spec, meta = {}) {
      const port = resolveOutput(spec.outputId);
      if (disposed || !port) return false;
      const timestamp = spec.timeMs ?? now(), durationMs = duration(spec), outputId = spec.outputId ?? port.id ?? null;
      if (port.channels) {
        const banks = noteMessages(spec).filter(data => (data[0] & 0xf0) === 0xb0 && (data[1] === 0 || data[1] === 32));
        if (banks.length) {
          const reservation = scheduler.evaluateAndReserve?.({ on: { timeMs: timestamp, count: banks.length, bytes: banks.length * 3 } }, { ...meta, outputId }, now());
          if (reservation && !reservation.ok) { scheduler.recordThrottle?.(reservation.reason, now(), meta); return false; }
          try {
            for (const data of banks) if (!raw(data, timestamp, { ...meta, outputId, reservationId: reservation?.reservationId }, false)) return false;
          } finally { scheduler._releaseReservation?.(reservation?.reservationId, true); }
        }
        const accepted = scheduler.sendNote({ ...spec, durationTicks: durationMs / (scheduler.tickMs || 60) }, meta);
        return accepted;
      }
      const messages = noteMessages(spec);
      const reservation = scheduler.evaluateAndReserve?.({ on: { timeMs: timestamp, count: messages.length, bytes: messages.reduce((sum, data) => sum + data.length, 0) },
        off: { timeMs: timestamp + durationMs, count: durationMs ? 1 : 0, bytes: durationMs ? 3 : 0 } }, { ...meta, outputId }, now());
      if (reservation && !reservation.ok) { scheduler.recordThrottle?.(reservation.reason, now(), meta); return false; }
      try {
        for (const data of messages) if (!raw(data, timestamp, { ...meta, outputId, reservationId: reservation?.reservationId }, false)) return false;
        if (durationMs && !raw([0x80 | channelByte(spec.channel), byte(spec.note), byte(spec.releaseVelocity)], timestamp + durationMs,
          { ...meta, beat: meta.beat == null ? undefined : meta.beat + durationMs * (meta.bpm ?? transport?.getState()?.bpm ?? 120) / 60000,
            outputId, reservationId: reservation?.reservationId, reservationPhase: 'off' }, false)) return false;
        return true;
      } finally { scheduler._releaseReservation?.(reservation?.reservationId, true); }
    },
    getRecording({ direction = 'all', evidence = 'all' } = {}) {
      return records.filter(event => !event.cancelled && (direction === 'all' || event.direction === direction || event.type === 'tempo') &&
        (evidence === 'all' || event.evidence === evidence || event.type === 'tempo'))
        .map(event => ({ ...event, data: [...event.data] }));
    },
    recordEvent(event, meta = {}) {
      for (const data of encodeProcgenMidi(event)) record({ ...meta, ...event, data, direction: 'output', source: meta.source || 'output',
        evidence: 'intent-render', timestamp: event.timestamp ?? event.timeMs ?? now() });
    },
    recordTempo(bpm, beat = transport?.getState().beat || 0, timestamp = now()) { record({ type: 'tempo', bpm, beat, timestamp, data: [], source: 'transport' }); },
    clearRecording() {
      records = []; droppedRecords = 0; retainedEvents = 0; eventSequence = 0; firstLostSequence = null; incompleteReason = null;
      intentRenderEntries.clear(); intentExpiry.length = 0; activeTrace.clear(); report();
    },
    checkConnections() {
      inspectInputLiveness();
      if (input?.state === 'disconnected') { replaceInput(null); report(); return false; }
      if ([noteOutput, clockOutput].some(port => port?.state === 'disconnected')) {
        panic(); report(); return false;
      }
      const connected = [...noteOutputs.values()].filter(port => port?.state !== 'disconnected');
      if (connected.length !== noteOutputs.size) { this.setNoteOutputs(connected); report(); return false; }
      return true;
    },
    dispose() {
      if (disposed) return;
      clearTimeout(sensingTimer); sensingTimer = null;
      panic(); removeInput?.(); removeInput = null; input = null; noteOutput = null; clockOutput = null;
      noteOutputs.clear();
      removeSubmissionObserver?.();
      if (!suppliedScheduler) scheduler.dispose(); disposed = true;
    }
  };
}
