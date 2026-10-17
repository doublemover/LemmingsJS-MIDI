import { MidiScheduler } from '../../../midi/MidiScheduler.js';
import { clearProcgenMidiQueue, sendProcgenMidiBytes } from './ProcgenMidiBytes.js';

const byte = value => Math.min(127, Math.max(0, Math.round(Number(value) || 0)));
const channelByte = channel => Math.min(15, Math.max(0, (Number(channel) || 1) - 1));

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
  const usedChannels = new Map(), noteOutputs = new Map();
  const resolveOutput = outputId => outputId == null || outputId === '' ? noteOutput : noteOutputs.get(String(outputId)) || (String(noteOutput?.id) === String(outputId) ? noteOutput : null);
  const useChannel = (port, channel) => {
    if (!usedChannels.has(port)) usedChannels.set(port, new Set());
    usedChannels.get(port).add(channel);
  };
  const getState = () => ({ inputId: input?.id || null, noteOutputId: noteOutput?.id || null,
    clockOutputId: clockOutput?.id || null, thru, recording, learning: !!learn,
    noteOutputIds: [...noteOutputs.keys()], recordedEvents: records.length, droppedRecords, pressure: scheduler.getOutputPressure?.(now()) || null });
  const report = () => onState(getState());
  const record = event => {
    if (!recording) return;
    const state = transport?.getState(), timestamp = event.timestamp ?? now();
    const beat = event.beat ?? ((state?.beat || 0) + Math.max(0, timestamp - now()) * (state?.bpm || 120) / 60000);
    const stored = { ...event, beat, timestamp, data: [...event.data] };
    if (records.length < maxRecordedEvents) records.push(stored); else droppedRecords++;
    onRecord(stored);
  };
  const raw = (data, timestamp = now(), meta = {}, capture = true) => {
    const port = resolveOutput(meta.outputId);
    if (disposed || !port || data[0] >= 0xf0) return false;
    try {
      const family = data[0] & 0xf0;
      const release = family === 0x80 || (family === 0x90 && data[2] === 0) || (family === 0xb0 && [64, 120, 123].includes(data[1]) && !data[2]);
      if (capture && !release) {
        const reservation = scheduler.evaluateAndReserve?.({ on: { timeMs: timestamp, count: 1, bytes: data.length } }, { ...meta, outputId: port.id }, now());
        if (reservation && !reservation.ok) { scheduler.recordThrottle?.(reservation.reason, now(), meta); return false; }
      }
      if (!sendProcgenMidiBytes(port, data, timestamp)) { transport?.pause(); return false; }
      useChannel(port, (data[0] & 15) + 1);
      if (capture) record({ ...meta, ...decodeProcgenMidi(data, timestamp), outputId: port.id || null, direction: 'output', source: meta.source || 'output' });
      return true;
    } catch { panic('output-error'); return false; }
  };
  function flushRecording() {
    if (!recording) return;
    const timestamp = now(), active = new Map();
    records = records.filter(event => event.direction !== 'output' || event.timestamp <= timestamp);
    for (const event of [...records].sort((a, b) => a.timestamp - b.timestamp)) {
      if (event.direction !== 'output') continue;
      const [status, note, velocity] = event.data;
      const key = `${event.outputId || ''}:${status & 15}:${note}`;
      if ((status & 0xf0) === 0x90 && velocity) active.set(key, event);
      else if ((status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && !velocity)) active.delete(key);
    }
    for (const event of active.values()) record({ direction: 'output', source: 'cleanup', outputId: event.outputId,
      data: [0x80 | (event.data[0] & 15), event.data[1], 0], timestamp });
  }
  function flush() {
    flushRecording();
    for (const port of new Set([noteOutput, clockOutput, ...noteOutputs.values()])) clearProcgenMidiQueue(port);
    scheduler.allNotesOff();
    for (const [port, channels] of usedChannels) {
      for (const channel of channels) {
        const base = channel - 1;
        for (const data of [[0xb0 | base, 64, 0], [0xb0 | base, 123, 0], [0xb0 | base, 120, 0], [0xe0 | base, 0, 64]]) {
          try { sendProcgenMidiBytes(port, data, now()); } catch { /* Cleanup must continue across disconnected ports. */ }
          record({ data, timestamp: now(), outputId: port?.id || null, direction: 'output', source: 'cleanup' });
        }
      }
    }
    usedChannels.clear();
  }
  function panic() { transport?.panic(); flush(); }
  function receiveMidi(data, timestamp = now()) {
    if (disposed || !data?.length) return false;
    const event = decodeProcgenMidi(data, timestamp);
    onMonitor(event); transport?.receiveMidi(data, timestamp);
    if (event.type === 'system') return true;
    record({ ...event, direction: 'input', source: 'input' });
    if (learn) { const callback = learn; learn = null; callback(event); report(); }
    // Realtime/transport messages are never echoed, including when Thru is on.
    if (thru) raw(event.data, timestamp, { source: 'thru' });
    return true;
  }
  const listener = event => receiveMidi(event.data || event.message?.data, event.receivedTime ?? event.timestamp ?? now());
  const replaceInput = port => {
    if (input === port || disposed) return;
    transport?.pause(); removeInput?.(); removeInput = null; input = port || null;
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
    const timestamp = spec.timeMs ?? meta.timestamp ?? now(), durationMs = duration(spec);
    const state = transport?.getState(), bpm = meta.bpm ?? state?.bpm ?? 120;
    const beat = meta.beat ?? ((state?.beat || 0) + (timestamp - now()) * bpm / 60000);
    const outputId = spec.outputId ?? meta.outputId ?? noteOutput?.id ?? null;
    for (const data of noteMessages(spec)) record({ ...meta, direction: 'output', source: meta.source || 'output', outputId, data, timestamp, beat });
    if (durationMs) record({ direction: 'output', source: meta.source || 'output', outputId, data: [0x80 | channelByte(spec.channel), byte(spec.note), byte(spec.releaseVelocity)],
      timestamp: timestamp + durationMs, beat: beat + durationMs * bpm / 60000 });
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
      transport?.pause(); flush(); noteOutputs.clear();
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
      if (settings.recording !== undefined) recording = !!settings.recording;
      if (settings.schedulerConfig) scheduler.setConfig?.(settings.schedulerConfig);
      report(); return getState();
    },
    learnNext(callback = onLearn) { learn = callback; report(); },
    cancelLearn() { learn = null; report(); },
    sendEvent(event) {
      const timestamp = event.timestamp ?? event.timeMs ?? now();
      const messages = encodeProcgenMidi(event);
      return !!messages.length && messages.map(data => raw(data, timestamp, event)).every(Boolean);
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
          if (!banks.every(data => raw(data, timestamp, { ...meta, outputId }, false))) return false;
        }
        const accepted = scheduler.sendNote({ ...spec, durationTicks: durationMs / (scheduler.tickMs || 60) }, meta);
        if (accepted) {
          useChannel(port, spec.channel || 1); recordOutput(spec, meta);
        }
        return accepted;
      }
      const messages = noteMessages(spec);
      const reservation = scheduler.evaluateAndReserve?.({ on: { timeMs: timestamp, count: messages.length, bytes: messages.reduce((sum, data) => sum + data.length, 0) },
        off: { timeMs: timestamp + durationMs, count: durationMs ? 1 : 0, bytes: durationMs ? 3 : 0 } }, { ...meta, outputId }, now());
      if (reservation && !reservation.ok) { scheduler.recordThrottle?.(reservation.reason, now(), meta); return false; }
      const accepted = messages.every(data => raw(data, timestamp, { ...meta, outputId }, false));
      if (accepted && durationMs) raw([0x80 | channelByte(spec.channel), byte(spec.note), byte(spec.releaseVelocity)], timestamp + durationMs, { ...meta, outputId }, false);
      if (accepted) recordOutput(spec, meta);
      return accepted;
    },
    getRecording() { return records.map(event => ({ ...event, data: [...event.data] })); },
    recordEvent(event, meta = {}) {
      for (const data of encodeProcgenMidi(event)) record({ ...meta, ...event, data, direction: 'output', source: meta.source || 'output', timestamp: event.timestamp ?? event.timeMs ?? now() });
    },
    recordTempo(bpm, beat = transport?.getState().beat || 0, timestamp = now()) { record({ type: 'tempo', bpm, beat, timestamp, data: [], source: 'transport' }); },
    clearRecording() { records = []; droppedRecords = 0; report(); },
    checkConnections() {
      if ([input, noteOutput, clockOutput, ...noteOutputs.values()].some(port => port?.state === 'disconnected')) {
        panic(); if (input?.state === 'disconnected') replaceInput(null); report(); return false;
      }
      return true;
    },
    dispose() {
      if (disposed) return;
      panic(); removeInput?.(); removeInput = null; input = null; noteOutput = null; clockOutput = null;
      noteOutputs.clear();
      if (!suppliedScheduler) scheduler.dispose(); disposed = true;
    }
  };
}
