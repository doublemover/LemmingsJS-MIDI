import { MidiScheduler } from '../../../midi/MidiScheduler.js';
import { lowerMidi2ChannelVoice } from '../../../midi/protocol/MidiProtocolLowering.js';
import { createMpeZonePlan } from '../../../midi/scheduler/MpeZonePlan.js';
import { clearProcgenMidiQueue, sendProcgenMidiBytes, validProcgenMidiChannelBytes } from './ProcgenMidiBytes.js';

const byte = value => Math.min(127, Math.max(0, Math.round(Number(value) || 0)));
const channelByte = channel => Math.min(15, Math.max(0, (Number(channel) || 1) - 1));
const ACTIVE_SENSING_TIMEOUT_MS = 300;
const HOST_OBSERVATION_GAP_MS = 600;
const isReleasePacket = data => (data[0] & 0xf0) === 0x80 || ((data[0] & 0xf0) === 0x90 && data[2] === 0) ||
  ((data[0] & 0xf0) === 0xb0 && [64, 120, 123].includes(data[1]) && !data[2]);
const snapshotIntent = intent => Object.freeze({ ...intent,
  ...(intent.laneIndices ? { laneIndices: Object.freeze([...intent.laneIndices]) } : {}),
  ...(Array.isArray(intent.channels) ? { channels: Object.freeze([...intent.channels]) } : {}),
  ...(Array.isArray(intent.exclusiveChannels) ? { exclusiveChannels: Object.freeze([...intent.exclusiveChannels]) } : {}),
  ...(intent.protocolLowering ? { protocolLowering: JSON.parse(JSON.stringify(intent.protocolLowering)) } : {}) });
const validInputPacket = data => {
  const status = data?.[0];
  if (!Number.isInteger(status) || status < 0x80 || status > 0xff) return false;
  if (status === 0xf0) return data.length >= 2 && data.at(-1) === 0xf7 && Array.from(data).slice(1, -1).every(value => Number.isInteger(value) && value >= 0 && value < 128);
  const length = status < 0xf0 ? [0xc0, 0xd0].includes(status & 0xf0) ? 2 : 3
    : ({ 0xf1: 2, 0xf2: 3, 0xf3: 2, 0xf6: 1, 0xf7: 1, 0xf8: 1, 0xfa: 1, 0xfb: 1, 0xfc: 1, 0xfe: 1, 0xff: 1 })[status];
  return data.length === length && Array.from(data).slice(1).every(value => Number.isInteger(value) && value >= 0 && value < 128);
};

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
  if (!event || typeof event !== 'object') return [];
  if (event.data) return validProcgenMidiChannelBytes(event.data) ? [Array.from(event.data)] : [];
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
  onMonitor = () => {}, onLearn = () => {}, onRecord = () => {}, onState = () => {}, onInputSafety = () => {}, maxRecordedEvents = 100000 } = {}) {
  const scheduler = suppliedScheduler || new MidiScheduler(schedulerConfig);
  let input = null, noteOutput = null, clockOutput = null, removeInput = null;
  let thru = false, recording = false, learn = null, disposed = false, records = [], droppedRecords = 0;
  let inputEpoch = 0, lastObservationMs = now(), expiredAt = null, systemResetPolicy = 'observe', sensingTimer = null;
  let activeSensingVisibility = 'unknown', configuredSensingVisibility = 'unknown', lastInputSafety = null;
  let notifyingInputSafety = false, inputSelectionRevision = 0, inputSafetySequence = 0;
  let lastCallbackError = null;
  const callConsumer = (source, callback, value) => {
    try { return callback(value); } catch (error) { lastCallbackError = Object.freeze({ source, message: error?.message || String(error), timestamp: now() }); }
  };
  let protocolLowering = null, lastLowering = null, rawDispatchDepth = 0;
  const inputLiveness = { mode: 'unobserved', lastTrafficTime: null, deadline: null, evidence: 'no-active-sensing-observed', reason: null };
  const thruNotes = new Map();
  let retainedEvents = 0, eventSequence = 0, firstLostSequence = null, incompleteReason = null, intentRenderSequence = 0;
  const incompleteReasons = new Set();
  let firstRetainedSequence = null, lastRetainedSequence = null, firstRetainedMs = null, lastRetainedMs = null;
  let retainedRangeDirty = false;
  let droppedCategories = { input: 0, output: 0, transport: 0, other: 0 };
  let nearCapReported = false;
  const intentRenderEntries = new Set(), intentExpiry = [], activeTrace = new Map();
  const usedChannels = new Map(), noteOutputs = new Map(), activeOutputs = new Map(), routeIntents = new Map(), rawVoices = new Map(), sustainedChannels = new Map();
  const retiredPorts = new WeakSet(), retiredOutputIds = new Set();
  const activationFailures = new Map();
  let routeRevision = 0, outputEpoch = 0, lastRouteLoss = null, lastCleanup = null, activeIntentKey = '';
  let lastConfigurationFailure = null;
  const resolveOutput = outputId => {
    const id = outputId == null || outputId === '' ? noteOutput?.id : outputId;
    return activeOutputs.get(String(id))?.port || null;
  };
  const syncSchedulerOutputs = () => {
    const selected = resolveOutput();
    for (const route of activeOutputs.values()) scheduler.setOutputChannelScope?.(route.port, route.intent.channels ?? null);
    scheduler.setOutputs?.([...activeOutputs.values()].map(route => route.port));
    scheduler.setOutput(selected || null);
    for (const [id, route] of activeOutputs) {
      const state = scheduler.getOutputRouteState?.(id);
      if (state?.connectionEpoch != null) { route.connectionEpoch = state.connectionEpoch; route.routeRevision = state.routeRevision; }
    }
  };
  const activateOutput = (port, intent = {}) => {
    if (!port?.id || port.state === 'disconnected') return false;
    const id = String(port.id), current = activeOutputs.get(id);
    intent = snapshotIntent(intent);
    const invalid = reason => { if (current) retireOutput(id, 'route-activation-rejected'); activationFailures.set(id, reason); return false; };
    if (intent.channels && (!Array.isArray(intent.channels) || intent.channels.some(channel => !Number.isInteger(channel) || channel < 1 || channel > 16))) return invalid('invalid-channel-scope');
    if (port.channels && scheduler.config?.mpe?.enabled && intent.channels) {
      const plan = createMpeZonePlan(scheduler.config.mpe, scheduler._ensembleChannels?.() || new Set());
      if (!plan.ok) return invalid(plan.reason);
      const required = [plan.managerChannel, ...plan.memberChannels];
      if (required.some(channel => !intent.channels.includes(channel))) return invalid('mpe-channel-scope');
    }
    activationFailures.delete(id);
    if (current?.port === port) {
      const binding = route => JSON.stringify([route.channels, route.exclusiveChannels, route.protocolLowering]);
      if (binding(current.intent) === binding(intent)) { current.intent = intent; return true; }
      retireOutput(id, 'route-policy-changed'); scheduler.rearmOutput?.(port.id);
    }
    if (current) retireOutput(id, 'route-replaced');
    retiredPorts.delete(port);
    retiredOutputIds.delete(id);
    activeOutputs.set(id, { port, intent, loweredVoices: new Map(), connectionEpoch: ++outputEpoch, routeRevision: ++routeRevision });
    return true;
  };
  function retireOutput(id, reason) {
    const route = activeOutputs.get(String(id));
    if (!route) return;
    flushRawPort(route.port, reason);
    activeOutputs.delete(String(id)); retiredPorts.add(route.port); routeRevision++;
    retiredOutputIds.add(String(id));
    for (const [key, voice] of thruNotes) if (voice.port === route.port) thruNotes.delete(key);
    lastRouteLoss = { outputId: String(id), reason, connectionEpoch: route.connectionEpoch,
      affectedLanes: [...(route.intent.laneIndices || (Number.isInteger(route.intent.laneIndex) ? [route.intent.laneIndex] : []))] };
  }
  const outputForIntent = outputId => {
    const current = resolveOutput(outputId);
    if (current || outputId == null || outputId === '' || retiredOutputIds.has(String(outputId))) return current;
    const port = noteOutputs.get(String(outputId));
    if (!port || retiredPorts.has(port) || !activateOutput(port, routeIntents.get(String(outputId)) || { role: 'explicit-note' })) return null;
    syncSchedulerOutputs();
    return port;
  };
  const useChannel = (port, channel) => {
    if (!usedChannels.has(port)) usedChannels.set(port, new Set());
    usedChannels.get(port).add(channel);
  };
  const refreshRetainedRange = () => {
    if (!retainedRangeDirty) return;
    firstRetainedSequence = null; lastRetainedSequence = null; firstRetainedMs = null; lastRetainedMs = null;
    for (const event of records) {
      if (event.cancelled) continue;
      firstRetainedSequence ??= event.sequence; lastRetainedSequence = event.sequence;
      firstRetainedMs = firstRetainedMs == null ? event.timestamp : Math.min(firstRetainedMs, event.timestamp);
      lastRetainedMs = lastRetainedMs == null ? event.timestamp : Math.max(lastRetainedMs, event.timestamp);
    }
    retainedRangeDirty = false;
  };
  const getState = () => { refreshRetainedRange(); return ({ inputId: input?.id || null, noteOutputId: noteOutput?.id || null,
    clockOutputId: clockOutput?.id || null, thru, recording, learning: !!learn,
    inputPortConnected: input ? input.state !== 'disconnected' : null,
    inputLiveness: { sourceRoute: input?.id || null, connectionEpoch: inputEpoch, observationDomain: 'performance-now', activeSensingVisibility, ...inputLiveness },
    clockStatus: transport?.getState?.().clockStatus ?? null, systemResetPolicy,
    noteOutputIds: [...noteOutputs.keys()], availableNoteOutputIds: [...noteOutputs.keys()],
    mpeZone: scheduler.config?.mpe?.enabled ? scheduler._mpeZonePlan || null : null,
    authorizedNoteOutputIds: [...activeOutputs.keys()], activeNoteOutputIds: [...activeOutputs].filter(([id, route]) => {
      if (!route.port.channels) return true; const state = scheduler.getOutputRouteState?.(id);
      return state?.mpeReady !== false && state?.ownedVoiceAdmissionReady !== false;
    }).map(([id]) => id),
    routeRevision, lastRouteLoss, lastLowering, lastInputSafety, lastCallbackError, lastConfigurationFailure, lastCleanup: lastCleanup || scheduler.lastCleanup || null,
    outputRoutes: [...new Set([...noteOutputs.keys(), ...activeOutputs.keys(), ...routeIntents.keys(), ...(noteOutput ? [String(noteOutput.id)] : [])])].map(id => {
      const active = activeOutputs.get(id), selected = String(noteOutput?.id) === id;
      const port = noteOutputs.get(id) || active?.port || (selected ? noteOutput : null);
      const schedulerState = scheduler.getOutputRouteState?.(id), ready = schedulerState?.mpeReady !== false && schedulerState?.ownedVoiceAdmissionReady !== false;
      return { ...schedulerState, outputId: id, name: port?.name || active?.port.name || null, selected, authorized: !!active, active: !!active && ready,
        activationFailure: activationFailures.get(id) ?? null,
        configurationFailure: lastConfigurationFailure?.outputIds.includes(id) ? lastConfigurationFailure.reason : null,
        available: !!port && port.state !== 'disconnected', state: active ? ready ? 'active' : 'setup-rejected' : selected || routeIntents.has(id) ? 'unavailable' : 'discovered',
        connectionEpoch: active?.connectionEpoch ?? null, routeRevision: active?.routeRevision ?? routeRevision,
        role: active?.intent.role || (selected ? 'default-note' : 'note') };
    }), recordedEvents: retainedEvents, droppedRecords,
    recordingComplete: !incompleteReason, incompleteReason, incompleteReasons: [...incompleteReasons], firstLostSequence,
    retainedRange: { firstSequence: firstRetainedSequence, lastSequence: lastRetainedSequence,
      firstTimestamp: firstRetainedMs, lastTimestamp: lastRetainedMs },
    droppedCategories: { ...droppedCategories },
    recordingCapacity: maxRecordedEvents,
    recordingPressure: maxRecordedEvents > 0 ? records.length / maxRecordedEvents : records.length ? 1 : 0,
    pressure: scheduler.getOutputPressure?.(now(), noteOutput?.id) || null }); };
  const report = () => callConsumer('state', onState, getState());
  const markIncomplete = reason => {
    if (incompleteReasons.has(reason)) return;
    incompleteReasons.add(reason);
    incompleteReason ??= reason;
    report();
  };
  const drop = (count, category) => {
    const size = Math.max(1, count);
    firstLostSequence ??= eventSequence + 1;
    eventSequence += size;
    droppedRecords += size;
    droppedCategories[category] = (droppedCategories[category] || 0) + size;
    recording = false;
    markIncomplete('recording-cap-reached');
  };
  const record = event => {
    if (!recording) return false;
    if (records.length >= maxRecordedEvents) {
      drop(1, event.direction === 'input' ? 'input' : event.direction === 'output' ? 'output' : event.type === 'tempo' ? 'transport' : 'other');
      return false;
    }
    const sequence = ++eventSequence;
    const state = transport?.getState(), timestamp = event.timestamp ?? now();
    const processingMs = now(), sourceIsPast = event.direction === 'input' && timestamp < processingMs;
    const beat = event.beat ?? (sourceIsPast ? null : (state?.beat || 0) + (timestamp - processingMs) * (state?.bpm || 120) / 60000);
    const stored = { ...event, sequence, beat, timestamp, data: Object.freeze([...event.data]),
      ...(sourceIsPast ? { processedMs: processingMs, processingBeat: state?.beat ?? null, timingUncertainty: 'source-clock-unmapped' } : {}) };
    records.push(stored); retainedEvents++;
    if (!nearCapReported && maxRecordedEvents > 0 && records.length >= maxRecordedEvents * 0.8) {
      nearCapReported = true;
      report();
    }
    firstRetainedSequence ??= sequence; lastRetainedSequence = sequence;
    firstRetainedMs = firstRetainedMs == null ? timestamp : Math.min(firstRetainedMs, timestamp);
    lastRetainedMs = lastRetainedMs == null ? timestamp : Math.max(lastRetainedMs, timestamp);
    if (event.evidence !== 'intent-render' && (event.direction === 'input' || event.direction === 'output')) {
      const [status, note, velocity] = stored.data;
      const family = status & 0xf0, key = `${event.direction}:${event.outputId || ''}:${status & 15}:${note}`;
      if (family === 0x90 && velocity) activeTrace.set(key, (activeTrace.get(key) || 0) + 1);
      else if (family === 0x80 || (family === 0x90 && !velocity)) {
        const remaining = (activeTrace.get(key) || 0) - 1;
        if (remaining > 0) activeTrace.set(key, remaining); else activeTrace.delete(key);
      }
    }
    callConsumer('record', onRecord, Object.freeze({ ...stored }));
    return stored;
  };
  const cancelRecorded = event => {
    if (!event || event.cancelled) return;
    event.cancelled = true; retainedEvents--;
    if (event.sequence === firstRetainedSequence || event.sequence === lastRetainedSequence ||
        event.timestamp === firstRetainedMs || event.timestamp === lastRetainedMs) retainedRangeDirty = true;
  };
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
  const forgetThruGate = (port, channel, note) => {
    for (const [key, entry] of thruNotes) if (entry.port === port && entry.channel === channel && entry.note === note) thruNotes.delete(key);
  };
  const removeSubmissionObserver = scheduler.addSubmissionObserver?.(event => {
    if (disposed || !event.accepted || event.backend !== 'midi-output-api' || !event.midiBytes) return;
    const { output, channel, scheduledMs, submittedMs, midiBytes: data } = event;
    const family = data[0] & 0xf0;
    if ([0x80, 0x90].includes(family)) {
      const addressedChannel = (data[0] & 15) + 1;
      forgetThruGate(output, addressedChannel, data[1]);
      rawVoices.get(output)?.delete(`${addressedChannel - 1}:${data[1]}`);
      if (!rawVoices.get(output)?.size) rawVoices.delete(output);
    }
    if (!recording) return;
    record({ data, timestamp: scheduledMs, submittedMs, timestampDomain: 'performance-ms',
      outputId: event.outputId, outputScope: event.outputScope, channel, token: event.token ?? null,
      intentId: event.intentId ?? null, onsetId: event.onsetId ?? null, voiceId: event.voiceId ?? null,
      connectionEpoch: event.connectionEpoch ?? null, routeRevision: event.routeRevision ?? null,
      encodingEvidence: event.encodingEvidence,
      direction: 'output', source: 'scheduler', evidence: 'api-accepted', acknowledgement: 'adapter-returned',
      ...(event.reason ? { reason: event.reason } : {}) });
  });
  const trackRawVoice = (port, data, timestamp) => {
    const family = data[0] & 0xf0, key = `${data[0] & 15}:${data[1]}`;
    if (family === 0xb0 && [64, 66].includes(data[1])) {
      if (!sustainedChannels.has(port)) sustainedChannels.set(port, new Map());
      sustainedChannels.get(port).set(`${data[0] & 15}:${data[1]}`, data[2] >= 64);
      return;
    }
    if (family !== 0x80 && family !== 0x90) return;
    let voices = rawVoices.get(port);
    if (!voices) { voices = new Map(); rawVoices.set(port, voices); }
    if (family === 0x90 && data[2]) voices.set(key, { channel: (data[0] & 15) + 1, note: data[1], start: timestamp, end: null });
    else if (voices.has(key)) {
      if (timestamp <= now()) voices.delete(key);
      else voices.get(key).end = timestamp;
    }
    if (!voices.size) rawVoices.delete(port);
  };
  function flushRawPort(port, reason = 'owned-stop', { wholeDevice = false } = {}) {
    const timestamp = now(), voices = rawVoices.get(port), route = activeOutputs.get(String(port?.id));
    const cleanup = { outputId: port?.id ?? null, reason, queuedRemoved: 0, releaseSubmitted: 0, uncertain: 0, effectiveBoundary: timestamp };
    if (voices) {
      for (const [key, voice] of voices) if (voice.end != null && voice.end <= timestamp) voices.delete(key);
      const future = [...voices.values()].some(voice => voice.start > timestamp || voice.end > timestamp);
      const cleared = future && clearProcgenMidiQueue(port);
      for (const voice of voices.values()) {
        if (cleared && voice.start > timestamp) { cleanup.queuedRemoved++; continue; }
        const releaseTime = !cleared && voice.start > timestamp ? voice.start + 1 : timestamp;
        if (releaseTime > timestamp) { cleanup.uncertain++; cleanup.effectiveBoundary = Math.max(cleanup.effectiveBoundary, releaseTime); }
        const data = [0x80 | (voice.channel - 1), voice.note, 0];
        try {
          if (sendProcgenMidiBytes(port, data, releaseTime)) {
            cleanup.releaseSubmitted++;
            scheduler._recordSent?.({ timeMs: now(), count: 1, bytes: data.length, outputId: port.id, phase: 'off' }, now());
            record({ data, timestamp: releaseTime, submittedMs: now(), outputId: port.id, direction: 'output', source: 'cleanup', reason,
              connectionEpoch: route?.connectionEpoch ?? null, routeRevision: route?.routeRevision ?? routeRevision,
              evidence: 'api-accepted', acknowledgement: 'adapter-returned', encodingEvidence: 'direct-byte-boundary' });
          } else cleanup.uncertain++;
        } catch { cleanup.uncertain++; }
      }
      rawVoices.delete(port);
    }
    const exclusive = route?.intent.exclusiveChannels || port?.exclusiveChannels || [];
    if (!wholeDevice) for (const [binding, held] of sustainedChannels.get(port) || []) {
      if (held && !exclusive.includes(Number(binding.split(':')[0]) + 1)) { cleanup.uncertain++; cleanup.sharedPedalHeld = true; }
    }
    for (const channel of usedChannels.get(port) || []) {
      if (!wholeDevice && !exclusive.includes(channel)) continue;
      const base = channel - 1;
      for (const data of [[0xb0 | base, 64, 0], [0xb0 | base, 123, 0], [0xb0 | base, 120, 0], [0xe0 | base, 0, 64]]) {
        try {
          if (!sendProcgenMidiBytes(port, data, timestamp)) { cleanup.uncertain++; continue; }
          scheduler._recordSent?.({ timeMs: now(), count: 1, bytes: data.length, outputId: port.id, phase: 'off' }, now());
          record({ data, timestamp, submittedMs: now(), outputId: port.id, direction: 'output', source: 'cleanup', reason,
            connectionEpoch: route?.connectionEpoch ?? null, routeRevision: route?.routeRevision ?? routeRevision,
            evidence: 'api-accepted', acknowledgement: 'adapter-returned', encodingEvidence: 'direct-byte-boundary' });
        } catch { cleanup.uncertain++; }
      }
    }
    usedChannels.delete(port);
    sustainedChannels.delete(port);
    lastCleanup = Object.freeze(cleanup);
    return lastCleanup;
  }
  const raw = (data, timestamp = now(), meta = {}, capture = true) => {
    if (!validProcgenMidiChannelBytes(data) || !Number.isFinite(timestamp) || timestamp < 0) return false;
    const port = outputForIntent(meta.outputId);
    if (disposed || !port || data[0] >= 0xf0) return false;
    if (rawDispatchDepth || scheduler._outputCallbackDepth) return false;
    const route = activeOutputs.get(String(port.id)), channel = (data[0] & 15) + 1;
    if (route?.intent.channels && !route.intent.channels.includes(channel)) return false;
    const maxPending = Math.min(4096, Math.max(1, scheduler.config?.limits?.maxPendingRawVoices ?? 1024));
    if ((data[0] & 0xf0) === 0x90 && data[2] && (rawVoices.get(port)?.size || 0) >= maxPending && !rawVoices.get(port)?.has(`${data[0] & 15}:${data[1]}`)) {
      scheduler.recordThrottle?.('raw-voice-cap', now(), { ...meta, outputId: port.id }); return false;
    }
    let ownedReservationId = null;
    try {
      const family = data[0] & 0xf0;
      const release = isReleasePacket(data), phase = meta.reservationPhase ?? (release ? 'off' : 'on');
      if (meta.source === 'thru' && [0x80, 0x90].includes(family) && release &&
          ![...thruNotes.values()].some(entry => entry.port === port && entry.channel === channel && entry.note === data[1] && entry.inputEpoch === inputEpoch)) return false;
      if (capture && !release) {
        const reservation = scheduler.evaluateAndReserve?.({ on: { timeMs: timestamp, count: 1, bytes: data.length } }, { ...meta, outputId: port.id }, now());
        if (reservation && !reservation.ok) { scheduler.recordThrottle?.(reservation.reason, now(), meta); return false; }
        ownedReservationId = reservation?.reservationId ?? null;
      }
      let accepted;
      rawDispatchDepth++;
      try { accepted = sendProcgenMidiBytes(port, data, timestamp); } finally { rawDispatchDepth--; }
      if (!accepted) {
        scheduler._releaseReservation?.(ownedReservationId, true);
        retireOutput(String(port.id), 'output-send-rejected'); syncSchedulerOutputs(); report(); return false;
      }
      const sentAt = now(), reservationId = ownedReservationId ?? (capture ? null : meta.reservationId);
      const committed = reservationId != null && scheduler._commitReservationMessage?.(reservationId, phase, data.length,
        { ...meta, outputId: port.id }, sentAt);
      if (!committed) scheduler._recordSent?.({ timeMs: sentAt, count: 1, bytes: data.length, phase,
        outputId: port.id, trackId: meta.trackId, laneIndex: meta.laneIndex, laneCount: meta.laneCount, sfxId: meta.sfxId, priority: meta.priority }, sentAt);
      useChannel(port, (data[0] & 15) + 1);
      if (meta.source !== 'thru' && [0x80, 0x90].includes(family)) forgetThruGate(port, channel, data[1]);
      trackRawVoice(port, data, timestamp);
      if (!meta.sourceUmp && [0x80, 0x90].includes(family)) for (const [key, voice] of route.loweredVoices) {
        if (voice.channel === channel && voice.note === data[1]) route.loweredVoices.delete(key);
      }
      if ([0xb0, 0xc0, 0xe0].includes(family)) scheduler.invalidateOutputState?.(port.id, channel);
      record({ ...meta, ...decodeProcgenMidi(data, timestamp), submittedMs: sentAt, timestampDomain: 'performance-ms',
        outputId: port.id || null, connectionEpoch: route?.connectionEpoch ?? null, routeRevision: route?.routeRevision ?? routeRevision,
        direction: 'output', source: meta.source || 'output', evidence: 'api-accepted', acknowledgement: 'adapter-returned', encodingEvidence: 'direct-byte-boundary' });
      if (activeOutputs.get(String(port.id)) !== route) { flushRawPort(port, 'route-retired-during-submission'); return false; }
      return true;
    } catch { scheduler._releaseReservation?.(ownedReservationId, true); retireOutput(String(port.id), 'output-error'); syncSchedulerOutputs(); report(); return false; }
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
  function flush({ wholeDevice = false, reason = 'owned-stop' } = {}) {
    flushRecording();
    thruNotes.clear();
    scheduler.allNotesOff({ preserveRateHistory: true, wholeDevice, reason });
    const cleanup = { reason, wholeDevice, queuedRemoved: 0, releaseSubmitted: 0, uncertain: 0, effectiveBoundary: now(), ...scheduler.lastCleanup };
    for (const port of new Set([...rawVoices.keys(), ...usedChannels.keys()])) {
      const result = flushRawPort(port, reason, { wholeDevice });
      for (const key of ['queuedRemoved', 'releaseSubmitted', 'uncertain']) cleanup[key] += result[key];
      cleanup.effectiveBoundary = Math.max(cleanup.effectiveBoundary, result.effectiveBoundary);
      if (result.sharedPedalHeld) cleanup.sharedPedalHeld = true;
    }
    lastCleanup = Object.freeze(cleanup);
    for (const route of activeOutputs.values()) route.loweredVoices.clear();
    usedChannels.clear();
  }
  function panic(options = {}) { transport?.panic(); flush({ ...options, reason: options.reason || 'owned-panic' }); }
  function releaseThru(reason, source, onComplete = () => {}) {
    const entries = [...thruNotes.values()]; thruNotes.clear();
    const release = () => { const result = releaseThruEntries(entries, reason, source); onComplete(result); };
    if (scheduler._outputCallbackDepth || rawDispatchDepth) queueMicrotask(release); else release();
  }
  function releaseThruEntries(entries, reason, source = {}) {
    if (disposed) return null;
    const timestamp = now();
    const cleanup = { reason, ...source, queuedRemoved: 0, releaseSubmitted: 0, ownershipTransferred: 0, uncertain: 0, effectiveBoundary: timestamp };
    for (const entry of entries) {
      if (!entry.voice || rawVoices.get(entry.port)?.get(`${entry.channel - 1}:${entry.note}`) !== entry.voice) { cleanup.ownershipTransferred++; continue; }
      const releaseTime = entry.voice.start > timestamp ? entry.voice.start + 1 : timestamp;
      if (releaseTime > timestamp) { cleanup.uncertain++; cleanup.effectiveBoundary = Math.max(cleanup.effectiveBoundary, releaseTime); }
      const route = activeOutputs.get(String(entry.port?.id));
      const exclusive = route?.intent.exclusiveChannels || entry.port?.exclusiveChannels || [];
      if (!exclusive.includes(entry.channel) && [...(sustainedChannels.get(entry.port) || [])].some(([binding, held]) => held && Number(binding.split(':')[0]) + 1 === entry.channel)) {
        cleanup.uncertain++; cleanup.sharedPedalHeld = true;
      }
      for (let index = 0; index < entry.count; index++) {
        const data = [0x80 | (entry.channel - 1), entry.note, 0];
        try {
          let accepted;
          rawDispatchDepth++;
          try { accepted = sendProcgenMidiBytes(entry.port, data, releaseTime); } finally { rawDispatchDepth--; }
          if (accepted) {
            cleanup.releaseSubmitted++;
            scheduler._recordSent?.({ timeMs: now(), count: 1, bytes: data.length, outputId: entry.port.id, phase: 'off' }, now());
            record({ data, timestamp: releaseTime, submittedMs: now(),
              outputId: entry.port?.id || null, direction: 'output', source: 'input-safety', reason,
              connectionEpoch: route?.connectionEpoch ?? null, routeRevision: route?.routeRevision ?? routeRevision,
              evidence: 'api-accepted', acknowledgement: 'adapter-returned', encodingEvidence: 'direct-byte-boundary' });
            trackRawVoice(entry.port, data, releaseTime);
          } else cleanup.uncertain++;
        } catch { cleanup.uncertain++; }
      }
    }
    lastCleanup = Object.freeze(cleanup);
    return lastCleanup;
  }
  const terminateInputSource = (reason, evidence, incomplete = 'input-source-terminated') => {
    const openTrace = [...activeTrace.keys()].some(key => key.startsWith('input:'));
    const safety = Object.freeze({ type: 'safety-termination', direction: 'safety', source: 'input-liveness', reason, evidence,
      sourceRoute: input?.id ?? null, connectionEpoch: inputEpoch, timestamp: now(), observationDomain: 'performance-now',
      terminationId: ++inputSafetySequence, thruGates: thruNotes.size, data: Object.freeze([]), cleanup: null });
    lastInputSafety = safety;
    if (openTrace) {
      for (const key of activeTrace.keys()) if (key.startsWith('input:')) activeTrace.delete(key);
      record(safety);
      markIncomplete(incomplete);
    }
    let deferred = false;
    releaseThru(reason, { sourceRoute: safety.sourceRoute, connectionEpoch: safety.connectionEpoch }, cleanup => {
      if (cleanup && lastInputSafety?.terminationId === safety.terminationId) {
        lastInputSafety = Object.freeze({ ...lastInputSafety, cleanup });
        if (deferred) report();
      }
    });
    deferred = true;
    if (!notifyingInputSafety) {
      notifyingInputSafety = true;
      try { callConsumer('input-safety', onInputSafety, lastInputSafety?.terminationId === safety.terminationId ? lastInputSafety : safety); }
      finally { notifyingInputSafety = false; }
    }
  };
  const resetInputLiveness = (mode = 'unobserved', reason = null) => {
    clearTimeout(sensingTimer); sensingTimer = null;
    inputLiveness.mode = mode; inputLiveness.lastTrafficTime = null; inputLiveness.deadline = null;
    inputLiveness.evidence = mode === 'unavailable' ? reason === 'port-disconnected' ? 'port-disconnected' : 'host-observation-gap' : 'no-active-sensing-observed';
    inputLiveness.reason = reason; expiredAt = null; lastObservationMs = now();
    if (mode === 'unobserved' && ['filtered', 'backend-consumed', 'unavailable'].includes(activeSensingVisibility)) {
      inputLiveness.mode = 'unavailable'; inputLiveness.evidence = 'active-sensing-' + activeSensingVisibility;
    }
  };
  const inspectInputLiveness = () => {
    const observedAt = now();
    if (inputLiveness.mode === 'armed' && observedAt > inputLiveness.deadline) {
      const hostGap = observedAt - lastObservationMs > HOST_OBSERVATION_GAP_MS;
      inputLiveness.mode = hostGap ? 'unavailable' : 'expired'; inputLiveness.deadline = null;
      clearTimeout(sensingTimer); sensingTimer = null;
      inputLiveness.evidence = hostGap ? 'host-observation-gap' : 'active-sensing-timeout';
      inputLiveness.reason = hostGap ? 'host-suspended' : 'sensing-expired'; expiredAt = observedAt;
      terminateInputSource(inputLiveness.reason, inputLiveness.evidence, 'input-sensing-terminated'); report();
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
  function receiveMidi(data, timestamp = now(), { connectionEpoch = inputEpoch, sourceRoute = input?.id ?? null } = {}) {
    if (disposed || connectionEpoch !== inputEpoch || sourceRoute !== (input?.id ?? null) || !validInputPacket(data)) return false;
    const observedAt = inspectInputLiveness();
    if (connectionEpoch !== inputEpoch || sourceRoute !== (input?.id ?? null)) return false;
    if (expiredAt != null && Number.isFinite(timestamp) && timestamp < expiredAt) return false;
    const event = { ...decodeProcgenMidi(data, timestamp), connectionEpoch: inputEpoch, sourceRoute: input?.id ?? null,
      ingressMs: observedAt, observationDomain: 'performance-now' };
    Object.freeze(event.data); Object.freeze(event);
    if (data[0] === 0xfe) {
      const changed = inputLiveness.mode !== 'armed'; inputLiveness.mode = 'armed'; inputLiveness.evidence = 'observed-active-sensing'; inputLiveness.reason = null;
      activeSensingVisibility = 'observable';
      inputLiveness.lastTrafficTime = observedAt; inputLiveness.deadline = observedAt + ACTIVE_SENSING_TIMEOUT_MS;
      if (changed) report();
    } else if (inputLiveness.mode === 'armed') { inputLiveness.lastTrafficTime = observedAt; inputLiveness.deadline = observedAt + ACTIVE_SENSING_TIMEOUT_MS; }
    else if (expiredAt != null) { inputLiveness.mode = 'unobserved'; inputLiveness.evidence = 'no-active-sensing-observed'; inputLiveness.reason = null; }
    if (inputLiveness.mode === 'armed') scheduleSensingWatchdog();
    callConsumer('monitor', onMonitor, event);
    if (connectionEpoch !== inputEpoch || sourceRoute !== (input?.id ?? null)) return false;
    transport?.receiveMidi?.(data, timestamp);
    if (connectionEpoch !== inputEpoch || sourceRoute !== (input?.id ?? null)) return false;
    if (data[0] === 0xff && systemResetPolicy === 'release-owned') terminateInputSource('system-reset-observed', 'observed-system-reset');
    if (data[0] === 0xff) record({ ...event, direction: 'input', source: 'input-system', systemResetPolicy });
    if (event.type === 'system') return true;
    record({ ...event, direction: 'input', source: 'input' });
    if (connectionEpoch !== inputEpoch || sourceRoute !== (input?.id ?? null)) return false;
    if (learn) { const callback = learn; learn = null; callConsumer('learn', callback, event); report(); }
    if (connectionEpoch !== inputEpoch || sourceRoute !== (input?.id ?? null)) return false;
    // Realtime/transport messages are never echoed, including when Thru is on.
    const ownedThru = event.type === 'noteOff' ? [...thruNotes.values()].find(entry => entry.inputEpoch === inputEpoch && entry.channel === event.channel && entry.note === event.note) : null;
    const thruPort = ownedThru?.port || resolveOutput();
    if (thru && raw(event.data, timestamp, { source: 'thru', outputId: thruPort?.id }) && ['noteOn', 'noteOff'].includes(event.type)) {
      if (event.connectionEpoch !== inputEpoch) {
        if (event.type === 'noteOn') releaseThruEntries([{ port: thruPort, channel: event.channel, note: event.note, count: 1,
          voice: rawVoices.get(thruPort)?.get(`${event.channel - 1}:${event.note}`) }], 'input-changed-during-submission',
        { sourceRoute: event.sourceRoute, connectionEpoch: event.connectionEpoch });
        return true;
      }
      const port = thruPort, key = `${inputEpoch}:${port?.id}:${event.channel}:${event.note}`, previous = thruNotes.get(key);
      if (event.type === 'noteOn') thruNotes.set(key, { port, channel: event.channel, note: event.note, inputEpoch,
        voice: rawVoices.get(port)?.get(`${event.channel - 1}:${event.note}`), count: (previous?.count || 0) + 1 });
      else if (previous?.count > 1) previous.count--; else thruNotes.delete(key);
    }
    return true;
  }
  const replaceInput = (port, { reason = port ? 'input-replaced' : 'input-detached' } = {}) => {
    if (input === port || disposed) return;
    const revision = ++inputSelectionRevision;
    terminateInputSource(reason, reason === 'port-disconnected' ? 'port-disconnected' : 'source-selection-changed');
    if (revision !== inputSelectionRevision || disposed) return;
    removeInput?.(); removeInput = null; input = port || null; inputEpoch++; learn = null;
    activeSensingVisibility = configuredSensingVisibility;
    resetInputLiveness(reason === 'port-disconnected' ? 'unavailable' : 'unobserved', reason === 'port-disconnected' ? reason : null);
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
  function sendLoweredEvent(event) {
    const id = String(event.outputId ?? noteOutput?.id ?? ''), existing = activeOutputs.get(id);
    const eventTime = event.timestamp ?? event.timeMs ?? now(), observedTime = now();
    if (existing) for (const [key, voice] of existing.loweredVoices) if (voice.endAt != null && voice.endAt <= observedTime) existing.loweredVoices.delete(key);
    const policy = existing?.intent.protocolLowering || protocolLowering;
    const words = event.umpWords, first = words?.[0] || 0;
    const sourceKey = `${(first >>> 24) & 15}:${((first >>> 16) & 15) + 1}:${(first >>> 8) & 255}`;
    const ownedAddress = existing?.loweredVoices.get(sourceKey);
    let plan = lowerMidi2ChannelVoice(words, policy || {}, { ownedAddress, soundingPitch: event.soundingPitch });
    if (plan.ok && plan.action !== 'begin' && ownedAddress && (eventTime < ownedAddress.startAt || ownedAddress.endAt != null && eventTime >= ownedAddress.endAt)) plan = { ...plan, ok: false, reason: 'outside-owned-voice-interval', messages: [] };
    if (!policy) plan = { ...plan, ok: false, reason: 'lowering-policy-required', messages: [] };
    if (scheduler.config?.mpe?.enabled) plan = { ...plan, ok: false, reason: 'mpe-ump-lowering-unavailable', messages: [] };
    let victimKey = null;
    if (plan.ok && plan.action === 'begin') for (const [key, voice] of existing?.loweredVoices || []) {
      if (voice.channel === plan.address.channel && voice.note === plan.note) { victimKey = key; break; }
    }
    if (victimKey != null) plan = lowerMidi2ChannelVoice(words, policy, { ownedAddress, soundingPitch: event.soundingPitch, conflictingVoice: true });
    lastLowering = Object.freeze({ outputId: id, mode: plan.mode, ok: plan.ok, reason: plan.reason, losses: plan.losses,
      sourceProtocol: 'midi2', destinationProtocol: 'midi1', sourceGroup: plan.address?.group ?? null,
      destinationChannel: plan.address?.channel ?? null, submittedMessages: 0 });
    if (!plan.ok) { report(); return false; }
    const port = outputForIntent(event.outputId), route = activeOutputs.get(id), timestamp = event.timestamp ?? event.timeMs ?? now();
    if (!port || !route) { lastLowering = Object.freeze({ ...lastLowering, ok: false, reason: 'route-unavailable' }); report(); return false; }
    if (plan.action === 'begin' && route.loweredVoices.size >= 1024 && !route.loweredVoices.has(sourceKey)) {
      lastLowering = Object.freeze({ ...lastLowering, ok: false, reason: 'lowering-voice-cap' }); report(); return false;
    }
    const reservation = plan.action === 'end' ? null : scheduler.evaluateAndReserve?.({ on: { timeMs: timestamp,
      count: plan.messages.length, bytes: plan.messages.reduce((sum, data) => sum + data.length, 0) } }, { ...event, outputId: port.id }, now());
    if (reservation && !reservation.ok) {
      lastLowering = Object.freeze({ ...lastLowering, ok: false, reason: reservation.reason }); report(); return false;
    }
    let submittedMessages = 0;
    try {
      for (const data of plan.messages) {
        if (!raw(data, timestamp, { ...event, umpWords: plan.sourceWords, outputId: port.id, sourceProtocol: 'midi2', sourceUmp: plan.sourceWords,
          sourceGroup: plan.address.group, loweringLosses: plan.losses, reservationId: reservation?.reservationId }, false)) return false;
        submittedMessages++;
        if (victimKey != null && submittedMessages === 1) route.loweredVoices.delete(victimKey);
      }
      if (plan.action === 'begin') route.loweredVoices.set(sourceKey, { note: plan.note, channel: plan.address.channel, soundingPitch: plan.soundingPitch, startAt: timestamp, endAt: null });
      else if (plan.action === 'end') { const voice = route.loweredVoices.get(sourceKey); if (voice) voice.endAt = timestamp; if (timestamp <= now()) route.loweredVoices.delete(sourceKey); }
      return true;
    } finally {
      scheduler._releaseReservation?.(reservation?.reservationId, true);
      lastLowering = Object.freeze({ ...lastLowering, submittedMessages, ok: submittedMessages === plan.messages.length,
        reason: submittedMessages === plan.messages.length ? null : 'partial-submission' }); report();
    }
  }
  function recordOutput(spec, meta = {}) {
    if (disposed || !recording || !Number.isFinite(spec.note)) return false;
    pruneIntentEntries(now());
    const timestamp = spec.timeMs ?? meta.timestamp ?? now(), durationMs = duration(spec);
    const state = transport?.getState(), bpm = meta.bpm ?? state?.bpm ?? 120;
    const beat = meta.beat ?? ((state?.beat || 0) + (timestamp - now()) * bpm / 60000);
    const outputId = spec.outputId ?? meta.outputId ?? noteOutput?.id ?? null;
    const messages = noteMessages(spec);
    if (records.length + messages.length + (durationMs ? 1 : 0) > maxRecordedEvents) {
      drop(messages.length + (durationMs ? 1 : 0), 'output');
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
    setNoteOutput(port, { rearm = false } = {}) {
      if (disposed || !rearm && noteOutput === port && (!port || resolveOutput() === port)) return;
      const previous = noteOutput;
      if (rearm && port && activeOutputs.get(String(port.id))?.port === port) {
        retireOutput(String(port.id), 'explicit-rearm'); scheduler.rearmOutput?.(port.id);
      }
      if (previous && previous !== port && !routeIntents.has(String(previous.id))) retireOutput(String(previous.id), 'selection-changed');
      noteOutput = port || null;
      if (port && (rearm || !retiredOutputIds.has(String(port.id)))) activateOutput(port, routeIntents.get(String(port.id)) || { role: 'default-note' });
      syncSchedulerOutputs(); report();
    },
    setNoteOutputs(ports = []) {
      if (disposed) return;
      const list = Array.isArray(ports) ? ports : Array.from(ports.values());
      const next = new Map(list.filter(port => port?.id).map(port => [String(port.id), port]));
      if (next.size === noteOutputs.size && [...next].every(([id, port]) => noteOutputs.get(id) === port)) return;
      let changedActive = false;
      for (const [id, route] of activeOutputs) if (next.get(id) !== route.port) {
        retireOutput(id, next.has(id) ? 'connection-replaced' : 'catalog-removed'); changedActive = true;
      }
      noteOutputs.clear();
      for (const [id, port] of next) noteOutputs.set(id, port);
      if (changedActive) syncSchedulerOutputs();
      routeRevision++; report();
    },
    setActiveNoteOutputs(routes = [], { rearm = false } = {}) {
      if (disposed) return false;
      const intents = routes.map(route => snapshotIntent(typeof route === 'string' || typeof route === 'number' ? { outputId: String(route) }
        : { ...route, outputId: String(route?.outputId ?? route?.id ?? '') })).filter(route => route.outputId);
      const key = JSON.stringify(intents);
      if (key === activeIntentKey && !rearm) return false;
      activeIntentKey = key;
      const next = new Map(intents.map(route => [route.outputId, route]));
      for (const [id] of routeIntents) if (!next.has(id) && id !== String(noteOutput?.id)) retireOutput(id, 'route-removed');
      routeIntents.clear();
      for (const [id, intent] of next) {
        routeIntents.set(id, intent);
        const port = noteOutputs.get(id) || (String(noteOutput?.id) === id ? noteOutput : null);
        if (port && (rearm || !retiredOutputIds.has(id))) activateOutput(port, intent);
      }
      syncSchedulerOutputs(); report(); return true;
    },
    setClockOutput(port) {
      if (clockOutput === port || disposed) return;
      clearProcgenMidiQueue(clockOutput); transport?.setClockOutput(port);
      clockOutput = port || null; report();
    },
    configure(settings = {}) {
      if (settings.schedulerConfig) {
        const config = settings.schedulerConfig, plan = createMpeZonePlan(config.mpe, scheduler._ensembleChannels?.(config) || new Set());
        const required = config.mpe?.enabled ? [plan.managerChannel, ...plan.memberChannels] : [];
        const incompatible = [...activeOutputs].filter(([, route]) => route.port.channels && route.intent.channels && required.some(channel => !route.intent.channels.includes(channel))).map(([id]) => id);
        if (config.mpe?.enabled && !plan.ok || incompatible.length) {
          lastConfigurationFailure = Object.freeze({ reason: !plan.ok && config.mpe?.enabled ? plan.reason : 'mpe-channel-scope',
            outputIds: Object.freeze(incompatible), requiredChannels: Object.freeze(required), retained: true, routeRevision });
          report(); return getState();
        }
      }
      if (settings.thru !== undefined) thru = !!settings.thru;
      if (settings.systemResetPolicy !== undefined) {
        if (!['observe', 'release-owned'].includes(settings.systemResetPolicy)) throw new RangeError('Invalid input System Reset policy');
        systemResetPolicy = settings.systemResetPolicy;
      }
      if (settings.activeSensingVisibility !== undefined) {
        if (!['unknown', 'observable', 'filtered', 'backend-consumed', 'unavailable'].includes(settings.activeSensingVisibility)) throw new RangeError('Invalid Active Sensing visibility');
        if (inputLiveness.mode === 'armed') terminateInputSource('sensing-visibility-changed', 'visibility-policy-changed');
        activeSensingVisibility = settings.activeSensingVisibility; configuredSensingVisibility = settings.activeSensingVisibility; resetInputLiveness();
      }
      if (settings.protocolLowering !== undefined) {
        if (settings.protocolLowering !== null && typeof settings.protocolLowering !== 'object') throw new TypeError('Invalid protocol lowering policy');
        flush({ reason: 'lowering-policy-changed' });
        for (const route of activeOutputs.values()) route.loweredVoices.clear();
        protocolLowering = settings.protocolLowering == null ? null : JSON.parse(JSON.stringify(settings.protocolLowering));
      }
      if (settings.recording !== undefined) {
        if (recording && !settings.recording && (activeTrace.size || [...intentRenderEntries].some(entry => !entry.end || entry.end.timestamp > now()))) {
          markIncomplete('open-notes-at-stop');
        }
        recording = !!settings.recording;
      }
      if (settings.schedulerConfig) {
        if (scheduler.setConfig?.(settings.schedulerConfig) === false) lastConfigurationFailure = scheduler.lastConfigurationFailure || { reason: 'scheduler-configuration-rejected', outputIds: [], retained: true };
        else { lastConfigurationFailure = null; syncSchedulerOutputs(); }
      }
      report(); return getState();
    },
    learnNext(callback = onLearn) { learn = callback; report(); },
    cancelLearn() { learn = null; report(); },
    sendEvent(event) {
      if (!event || typeof event !== 'object') return false;
      const timestamp = event.timestamp ?? event.timeMs ?? now();
      if (!Number.isFinite(timestamp) || timestamp < 0) return false;
      if (event?.umpWords) return sendLoweredEvent(event);
      const messages = encodeProcgenMidi(event);
      if (!messages.length || !messages.every(validProcgenMidiChannelBytes)) return false;
      const port = outputForIntent(event.outputId);
      if (disposed || !port) return false;
      const planned = messages.filter(data => !isReleasePacket(data));
      const reservation = planned.length ? scheduler.evaluateAndReserve?.({ on: { timeMs: timestamp,
        count: planned.length, bytes: planned.reduce((sum, data) => sum + data.length, 0) } }, { ...event, outputId: port.id }, now()) : null;
      if (reservation && !reservation.ok) { scheduler.recordThrottle?.(reservation.reason, now(), { ...event, outputId: port.id }); return false; }
      try {
        for (const data of messages) if (!raw(data, timestamp, { ...event, outputId: port.id,
          reservationId: isReleasePacket(data) ? null : reservation?.reservationId, reservationPhase: isReleasePacket(data) ? 'off' : 'on' }, false)) return false;
        return true;
      } finally { scheduler._releaseReservation?.(reservation?.reservationId, true); }
    },
    getRouteRevision: () => routeRevision,
    getOutputActivity: () => {
      let activeNotes = 0; for (const voice of scheduler._activeNotes?.values() || []) if (voice.hasStarted === true) activeNotes++;
      return Object.freeze({ activeNotes, pendingNotes: scheduler._pendingNoteOns?.size || 0, ownedNotes: scheduler._activeNotes?.size || 0 });
    },
    getNoteRoute(outputId = null) {
      const port = resolveOutput(outputId);
      if (disposed || !port) return Object.freeze({ status: 'rejected', reason: 'note-route-unavailable' });
      const route = scheduler.getOutputRouteState?.(port.id);
      return Object.freeze({ ...route, outputId: port.id, status: 'accepted', ownedVoices: !!port.channels && typeof scheduler.beginOwnedVoice === 'function' });
    },
    beginOwnedVoice(spec, meta = {}, options = {}) {
      const port = !disposed && !rawDispatchDepth && spec && resolveOutput(spec.outputId);
      if (!port?.channels || typeof scheduler.beginOwnedVoice !== 'function') return Object.freeze({ status: 'rejected', reason: 'owned-note-backend-unavailable' });
      const allowed = activeOutputs.get(String(port.id))?.intent.channels;
      if (allowed) {
        const plan = scheduler.config?.mpe?.enabled ? scheduler._mpeZonePlan : null;
        if (plan ? !plan.ok || !allowed.includes(plan.managerChannel) || plan.memberChannels.some(channel => !allowed.includes(channel)) :
          !allowed.includes(spec.channel ?? scheduler.config?.defaultChannel ?? 1)) return Object.freeze({ status: 'rejected', reason: 'owned-note-channel-scope' });
      }
      return scheduler.beginOwnedVoice({ ...spec, outputId: port.id }, meta, options);
    },
    inspectOwnedVoice(handle) { return scheduler.inspectOwnedVoice?.(handle) || Object.freeze({ status: 'rejected', reason: 'owned-note-backend-unavailable' }); },
    updateOwnedVoice(handle, patch, options) {
      if (disposed || rawDispatchDepth) return Object.freeze({ status: 'rejected', reason: 'owned-note-route-unavailable' });
      return scheduler.updateOwnedVoice?.(handle, patch, options) || Object.freeze({ status: 'rejected', reason: 'owned-note-backend-unavailable' });
    },
    endOwnedVoice(handle, options) { return scheduler.endOwnedVoice?.(handle, options) || Object.freeze({ status: 'rejected', reason: 'owned-note-backend-unavailable' }); },
    sendNote(spec, meta = {}) {
      if (rawDispatchDepth || !spec || !Number.isFinite(spec.note)) return false;
      const timestamp = spec.timeMs ?? now();
      if (!Number.isFinite(timestamp) || timestamp < 0 || [spec.durationMs, spec.durationTicks].some(value => value != null && (!Number.isFinite(value) || value < 0))) return false;
      const port = outputForIntent(spec.outputId);
      if (disposed || !port) return false;
      const durationMs = duration(spec), outputId = spec.outputId ?? port.id ?? null;
      if (port.channels) {
        const allowed = activeOutputs.get(String(port.id))?.intent.channels;
        if (allowed) {
          const plan = scheduler.config?.mpe?.enabled ? scheduler._mpeZonePlan || createMpeZonePlan(scheduler.config.mpe, scheduler._ensembleChannels?.() || new Set()) : null;
          if (plan ? !plan.ok || !allowed.includes(plan.managerChannel) || plan.memberChannels.some(channel => !allowed.includes(channel)) :
            !allowed.includes(spec.channel ?? scheduler.config?.defaultChannel ?? 1)) return false;
        }
        const accepted = scheduler.sendNote({ ...spec, durationTicks: durationMs / (scheduler.tickMs || 60) }, meta);
        return accepted;
      }
      if (scheduler.config?.mpe?.enabled) return false;
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
      const messages = encodeProcgenMidi(event);
      if (!recording || !messages.length) return false;
      if (records.length + messages.length > maxRecordedEvents) { drop(messages.length, 'output'); return false; }
      for (const data of messages) record({ ...meta, ...event, data, direction: 'output', source: meta.source || 'output',
        evidence: 'intent-render', timestamp: event.timestamp ?? event.timeMs ?? now() });
      return true;
    },
    recordTempo(bpm, beat = transport?.getState().beat || 0, timestamp = now()) { record({ type: 'tempo', bpm, beat, timestamp, data: [], source: 'transport' }); },
    clearRecording() {
      records = []; droppedRecords = 0; retainedEvents = 0; eventSequence = 0; firstLostSequence = null; incompleteReason = null;
      incompleteReasons.clear();
      firstRetainedSequence = null; lastRetainedSequence = null; firstRetainedMs = null; lastRetainedMs = null;
      retainedRangeDirty = false;
      droppedCategories = { input: 0, output: 0, transport: 0, other: 0 };
      nearCapReported = false;
      intentRenderEntries.clear(); intentExpiry.length = 0; activeTrace.clear(); report();
    },
    checkConnections() {
      inspectInputLiveness();
      const lostInput = input?.state === 'disconnected';
      if (lostInput) { replaceInput(null, { reason: 'port-disconnected' }); report(); }
      let lostActive = false;
      for (const [id, route] of activeOutputs) if (route.port.state === 'disconnected') { retireOutput(id, 'port-disconnected'); lostActive = true; }
      if (lostActive) syncSchedulerOutputs();
      if (clockOutput?.state === 'disconnected') { transport?.setClockOutput(null); clockOutput = null; lostActive = true; }
      const connected = [...noteOutputs.values()].filter(port => port?.state !== 'disconnected');
      if (connected.length !== noteOutputs.size) this.setNoteOutputs(connected);
      if (lostActive) report();
      return !lostActive && !lostInput;
    },
    dispose() {
      if (disposed) return;
      clearTimeout(sensingTimer); sensingTimer = null;
      panic(); removeInput?.(); removeInput = null; input = null; noteOutput = null; clockOutput = null;
      noteOutputs.clear();
      activeOutputs.clear(); routeIntents.clear(); rawVoices.clear();
      removeSubmissionObserver?.();
      if (!suppliedScheduler) scheduler.dispose(); disposed = true;
    }
  };
}
