import { procgenLane, procgenLaneIndex, procgenProjectChange } from './ProcgenProjectIndex.js';
import { resolveProcgenSound } from './ProcgenSoundCollections.js';
import { MidiAutomationSpans } from '../../../midi/router/MidiAutomationSpans.js';
import { applyMidiAutomationSpanValues } from '../../../midi/midi-mapping/MidiAutomationSpanValues.js';
import { positionCurveValue } from '../../../midi/midi-mapping/PositionCurve.js';
import { resolveAxisValues, resolveAxisValue } from '../../../midi/midi-mapping/MidiMappingDomain.js';
import { meterQuarterLength } from '../../../midi/project/MidiMusicalPosition.js';
import { createSinkAdmissionRegistry } from './SinkAdmissionRegistry.js';

const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomFor = (seed, ...keys) => {
  let hash = seed >>> 0;
  for (const key of keys.join(':')) { hash ^= key.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296;
};
const degreeNote = (degree, octave, scale) => {
  const degrees = scale?.degrees?.length ? scale.degrees : [0, 2, 3, 5, 7, 8, 10];
  const index = ((degree % degrees.length) + degrees.length) % degrees.length;
  return clamp((octave + 1) * 12 + (scale?.root || 0) + Math.floor(degree / degrees.length) * 12 + degrees[index], 0, 127);
};
const procgenStepNotes = (step, sound, scale) => {
  if (sound.percussion) return [step.note ?? 36];
  let notes = (step.chord?.degrees?.length ? step.chord.degrees : [0]).map(offset => step.note != null ? clamp(step.note + offset, 0, 127) : degreeNote(step.degree + offset, sound.octave, scale)).sort((a, b) => a - b);
  const inversion = step.chord?.inversion || 0;
  for (let index = 0; index < Math.abs(inversion); index++) {
    if (inversion > 0) notes.push(notes.shift() + 12); else notes.unshift(notes.pop() - 12);
  }
  notes = notes.map((note, index) => clamp(note + (index % 2 ? (step.chord?.spread || 0) * 12 : 0), 0, 127));
  return [...new Set(notes)];
};
const createProcgenPatternEngine = ({ getProject, emit, emitCC, getSinkKey = () => 'default', getAdmissionIdentity = () => ({}), getLaneDistance = () => 0, getLaneObservation, getLaneSpatialPosition = () => ({}), onLaunch = () => {}, onLaunchBatch, now = () => performance.now(), maxNotesPerPulse = 128,
  maxPendingAdmissions = 128, maxSinkOutcomes = 8, onAdmission = () => {} } = {}) => {
  if (!Number.isInteger(maxPendingAdmissions) || maxPendingAdmissions < 1 || maxPendingAdmissions > 4096 || !Number.isInteger(maxSinkOutcomes) || maxSinkOutcomes < 1 || maxSinkOutcomes > 8 || maxSinkOutcomes > maxPendingAdmissions) throw new RangeError('Invalid deferred admission bounds.');
  const emptyState = () => ({ version: 1, beat: -1, timestamp: 0, bpm: 120, lanes: {}, pending: [], active: [], cursor: 0, budget: maxNotesPerPulse, ccBudget: maxNotesPerPulse, automationSerial: 0 });
  const automation = new MidiAutomationSpans([]);
  let state = emptyState(), cachedProject = null, solo = false, soloCount = 0, liveLanes = new Map(), spatialCurves = [];
  const admissions = createSinkAdmissionRegistry({ onTransition: onAdmission }), deferred = new Map(), pendingKeys = new Map();
  let admissionGeneration = 0, eventSerial = 0;
  const derive = project => {
    if (cachedProject === project) return;
    const previous = cachedProject, change = previous && procgenProjectChange(previous, project);
    if (previous?.automation !== project.automation) {
      automation.configure(project.automation);
      spatialCurves = (project.automation || []).filter(entry => !entry.span && entry.enabled !== false);
    }
    if (change && !change.structural) {
      for (const id of change.laneIds) soloCount += Number(!!procgenLane(project.procgen.lanes, id)?.solo) - Number(!!procgenLane(previous.procgen.lanes, id)?.solo);
    } else soloCount = project.procgen.lanes.reduce((count, lane) => count + Number(lane.solo), 0);
    solo = soloCount > 0;
    liveLanes = { get: id => procgenLane(project.procgen.lanes, id), has: id => procgenLaneIndex(project.procgen.lanes).has(id) };
    if (previous) for (const id of change && !change.structural ? change.laneIds : Object.keys(state.lanes)) {
      if (!state.lanes[id]) continue;
      if (procgenLane(previous.procgen.lanes, id)?.ccAutomation === liveLanes.get(id)?.ccAutomation) continue;
      for (const entry of deferred.values()) if (entry.meta.laneId === id && entry.meta.source === 'automation') cancelEntry(entry, 'controller-definition-changed');
      Object.assign(state.lanes[id], { cc: {}, ccBySink: {}, ccTargets: {} });
    }
    if (!change || change.structural) for (const id of Object.keys(state.lanes)) if (!liveLanes.has(id)) delete state.lanes[id];
    cachedProject = project;
  };
  const laneState = lane => {
    if (!Object.hasOwn(state.lanes, lane.id)) Object.defineProperty(state.lanes, lane.id, { enumerable: true, configurable: true, writable: true, value: {
      slot: lane.activeSlot, launchSerial: -1, origin: 0, lastStep: -1, events: 0, attempts: 0, observed: { action: '', terrain: '' }, cc: {}
    } });
    return state.lanes[lane.id];
  };
  const audible = (project, lane) => !lane.mute && lane.gain > 0 && (!solo || lane.solo);
  const accepted = receipt => receipt?.status === 'accepted' && receipt.outputRequested !== false;
  const routeFor = lane => String(getSinkKey(lane));
  const releaseEntry = entry => {
    deferred.delete(entry.receipt.receiptId);
    if (pendingKeys.get(entry.pendingKey) === entry) pendingKeys.delete(entry.pendingKey);
  };
  const cancelEntry = (entry, reason) => {
    if (entry.cancelling) return;
    entry.cancelling = true;
    const cancelled = admissions.advance(entry.receipt, { expectedVersion: entry.receipt.receiptVersion, status: 'rejected', reason });
    if (cancelled) entry.receipt = cancelled;
    try {
      const cancellation = entry.cancel(reason);
      Promise.resolve(cancellation?.completion ?? cancellation).then(value => {
        const result = cancellation?.schema === 'lemmings-retirement/v1' ? cancellation : value;
        if (result === true || result?.outcome === 'complete' || result?.status === 'accepted') releaseEntry(entry);
        else entry.cancellationUnconfirmed = true;
      }, () => { entry.cancellationUnconfirmed = true; }).catch(() => { entry.cancellationUnconfirmed = true; });
    } catch { entry.cancellationUnconfirmed = true; }
  };
  const currentEntry = entry => {
    const project = getProject?.(); if (!project?.procgen || entry.generation !== admissionGeneration) return false;
    derive(project); const lane = liveLanes.get(entry.meta.laneId);
    return !!lane && audible(project, lane) && routeFor(lane) === entry.route && (entry.endBeat == null || entry.endBeat > state.beat + 1e-7) &&
      (entry.meta.source !== 'pattern' || lane.mode === 'pattern' && (entry.meta.slot == null || state.lanes[lane.id]?.slot === entry.meta.slot));
  };
  const sweepAdmissions = reason => {
    for (const entry of deferred.values()) if (reason || !currentEntry(entry)) cancelEntry(entry, reason || 'admission-context-retired');
  };
  const commitActive = (spec, meta, receipt, route) => {
    state.active.push({ spec, meta, receipt, routeKey: route, endBeat: meta.beat + spec.durationMs * state.bpm / 60000 });
  };
  const dispatchAdmission = (callback, spec, meta, accept, { isNote = false, coalesceKey = null, onTargets = () => {} } = {}) => {
    sweepAdmissions();
    if (deferred.size + maxSinkOutcomes > maxPendingAdmissions || isNote && state.active.length + deferred.size + maxSinkOutcomes > 512) return false;
    const project = getProject?.(), lane = project?.procgen && procgenLane(project.procgen.lanes, meta.laneId), route = lane ? routeFor(lane) : 'unavailable';
    const generation = admissionGeneration;
    const serial = 'pattern:' + ++eventSerial;
    const identity = { ...getAdmissionIdentity(lane, spec, meta), eventId: meta.eventId ?? meta.automationEventId ?? serial,
      intentId: meta.intentId ?? serial, onsetId: meta.onsetId ?? serial, voiceId: meta.voiceId ?? serial,
      targetTime: Number.isFinite(spec.timeMs) ? spec.timeMs : null, timeDomain: 'performance-ms' };
    let outcome;
    try { outcome = callback?.(spec, { ...meta, admissionIdentity: Object.freeze(identity) }); } catch { outcome = { status: 'rejected', reason: 'sink-exception' }; }
    const outcomes = outcome?.schema === 'lemmings-sink-admissions/v1' && Array.isArray(outcome.outcomes) && outcome.outcomes.length > 0 && outcome.outcomes.length <= maxSinkOutcomes
      ? outcome.outcomes : [outcome?.schema === 'lemmings-sink-admissions/v1' ? { status: 'rejected', reason: 'invalid-sink-outcomes' } : outcome];
    onTargets([...new Set(outcomes.map(result => typeof result?.sinkId === 'string' && result.sinkId ? result.sinkId : 'unavailable'))]);
    const sinks = new Set(); let anyAccepted = false;
    for (let result of outcomes) {
      const sinkId = typeof result?.sinkId === 'string' && result.sinkId ? result.sinkId : 'unavailable';
      if (sinks.has(sinkId)) continue; sinks.add(sinkId);
      if (meta.targetSinkId && meta.targetSinkId !== sinkId || meta.targetSinkIds && !meta.targetSinkIds.includes(sinkId)) continue;
      const sameIdentity = ['connectionEpoch', 'routeRevision'].every(name => identity[name] == null || result?.[name] == null || result[name] === identity[name]);
      if (result?.status === 'deferred' && (typeof result.cancel !== 'function' || !result.completion || typeof result.completion.then !== 'function')) result = { ...result, status: 'rejected', reason: 'uncancellable-deferral' };
      if (sinkId === 'unavailable' && result?.status !== 'rejected') result = { status: 'rejected', reason: 'sink-identity-unavailable' };
      if (!sameIdentity && result?.status === 'accepted') result = { ...result, status: 'rejected', reason: 'stale-sink-identity' };
      const receipt = admissions.open({ ...identity, sinkId, connectionEpoch: identity.connectionEpoch ?? result?.connectionEpoch ?? route,
        routeRevision: identity.routeRevision ?? result?.routeRevision ?? route }, result);
      if (!receipt) continue;
      const context = { meta, route, generation, endBeat: isNote ? meta.beat + spec.durationMs * state.bpm / 60000 : null };
      if (accepted(receipt)) { if (currentEntry(context)) { accept(receipt, route); anyAccepted = true; } }
      else if (receipt.status === 'deferred') {
        const entry = { ...context, receipt, spec, cancel: result.cancel, pendingKey: coalesceKey == null ? null : JSON.stringify([coalesceKey, sinkId]) };
        deferred.set(receipt.receiptId, entry);
        if (entry.pendingKey) pendingKeys.set(entry.pendingKey, entry);
        if (!sameIdentity || !currentEntry(entry)) cancelEntry(entry, 'admission-context-retired');
        Promise.resolve(result.completion).then(next => {
          if (entry.cancelling || deferred.get(receipt.receiptId) !== entry) return;
          if (!currentEntry(entry) || ['sinkId', 'connectionEpoch', 'routeRevision'].some(name => next?.[name] != null && next[name] !== receipt[name])) { cancelEntry(entry, 'admission-context-retired'); return; }
          const update = admissions.advance(receipt, { ...next, expectedVersion: receipt.receiptVersion, status: next?.status === 'accepted' ? 'accepted' : 'rejected', reason: next?.reason || 'deferred-sink-rejected' });
          if (!update || !accepted(update)) { cancelEntry(entry, update?.reason || 'invalid-deferred-reply'); return; }
          if (entry.cancelling || !currentEntry(entry)) { cancelEntry(entry, 'admission-context-retired'); return; }
          releaseEntry(entry); accept(update, route);
        }, () => cancelEntry(entry, 'deferred-sink-exception')).catch(() => cancelEntry(entry, 'deferred-settlement-exception'));
      }
    }
    return anyAccepted;
  };
  const send = (spec, meta) => {
    if (state.budget <= 0) return false;
    state.budget--;
    return dispatchAdmission(emit, spec, meta, (receipt, route) => commitActive(spec, meta, receipt, route), { isNote: true });
  };
  const matches = (condition, counters, observed) => {
    if (!condition) return true;
    if (condition.kind === 'action' || condition.kind === 'terrain') return String(observed[condition.kind]).toLowerCase().includes(condition.value.toLowerCase());
    return (counters[condition.kind] - 1) % condition.every === condition.offset % condition.every;
  };
  const automationPosition = (project, laneIndex, beat, event) => ({ beat, bar: Math.floor(beat / barBeats(project)) + 1,
    distance: Number.isFinite(event?.x) ? event.x : getLaneDistance(laneIndex), distanceSource: Number.isFinite(event?.x) ? 'event-origin' : 'lane-frontier', tick: event?.tick ?? null });
  const spatialValues = (laneIndex, origin) => {
    const position = getLaneSpatialPosition(laneIndex) || {}, event = { x: origin?.x ?? position.x, y: origin?.y ?? position.y };
    const axes = resolveAxisValues(event, position), values = new Map();
    for (const entry of spatialCurves) {
      if (entry.scope === 'track' && entry.trackId !== origin.trackId) continue;
      const axis = resolveAxisValue(entry, axes);
      if (axis == null) continue;
      const value = positionCurveValue(entry, axis, entry.min, entry.max);
      values.set(entry.target, { id: entry.id, value: value + (entry.target === 'note' ? values.get('note')?.value || 0 : 0) });
    }
    return values;
  };
  const queueStep = (project, lane, laneIndex, current, pattern, stepIndex, beat, timestamp, source) => {
    const step = pattern.steps[stepIndex];
    if (!step?.enabled || step.tie || !audible(project, lane)) return;
    const counters = { event: source === 'game' ? current.events : ++current.attempts, pass: Math.floor(Math.max(0, current.lastStep) / pattern.length) + 1, bar: Math.floor(beat / barBeats(project)) + 1 };
    const observed = getLaneObservation ? getLaneObservation(laneIndex) || { action: '', terrain: '' } : current.observed;
    if (!matches(step.condition, counters, observed)) return;
    if (randomFor(project.procgen.seed, lane.id, current.slot, stepIndex, step.probabilityBasis, counters[step.probabilityBasis]) >= step.probability) return;
    const sound = resolveProcgenSound(lane.family, lane.role, lane.patch);
    let duration = step.duration * sound.playbackDuration;
    const spacing = 0.25 / pattern.rate;
    // Extend before scheduling so ties never retrigger or require mutable note-off timers.
    if (source === 'pattern') {
      for (let offset = 1; offset < pattern.length; offset++) {
        const next = pattern.steps[(stepIndex + offset) % pattern.length];
        if (next.tie || (step.hold && !next.enabled)) duration = Math.max(duration, offset * spacing + (next.tie ? next.duration : spacing));
        else break;
      }
    }
    const response = sound.eventResponse;
    const accent = source === 'game' ? lane.eventAccent * response.velocity : 1;
    if (accent <= 0) return;
    const eventStep = source === 'game' && !sound.percussion ? { ...step, degree: step.degree + response.degree } : step;
    const notes = procgenStepNotes(eventStep, sound, project.global?.scale);
    const responseDuration = source === 'game' ? response.duration : 1;
    const emphasis = source === 'game' && current.observed.action.includes(response.action) ? 1.15 : 1;
    const origin = source === 'game' ? current.eventMeta : { laneIndex, trackId: project.tracks?.[0]?.id, automationEventId: ++state.automationSerial };
    const spatial = spatialCurves.length ? spatialValues(laneIndex, origin) : null;
    if (automation.entries.length && source === 'pattern') origin.automationEventCounts = automation.observeOrigin(origin, automationPosition(project, laneIndex, beat));
    for (let repeat = 0; repeat < step.repeats; repeat++) {
      const offset = spacing * repeat / step.repeats;
      const meta = { ...origin, laneIndex, laneId: lane.id, ensembleRole: lane.role, source, sourceKind: 'procgen', role: lane.role, beat: beat + offset, stepIndex, slot: current.slot };
      const spanValues = automation.entries.length ? automation.values(meta, automationPosition(project, laneIndex, beat + offset, source === 'game' ? current.eventMeta : null)) : null;
      for (const note of notes) {
        let spec = { note, velocity: step.velocity,
          channel: lane.channel, program: lane.externalProgram, outputId: lane.outputId, percussion: lane.externalPercussion,
          bankMSB: lane.bankMSB, bankLSB: lane.bankLSB,
          bankMsb: lane.bankMSB, bankLsb: lane.bankLSB,
          ensembleRole: lane.role, envelope: sound.envelope, timbre: sound.timbre, pan: lane.pan,
          durationMs: duration * responseDuration / step.repeats * 60000 / state.bpm,
          durationTicks: duration * responseDuration / step.repeats * 60000 / state.bpm / 60,
          timeMs: timestamp + offset * 60000 / state.bpm, stepIndex, stepCount: pattern.length };
        if (spatial?.size) {
          // Legacy spatial offsets are additive semitones; bounded spans quantize independently afterward.
          const offset = spatial.get('note')?.value, bend = spatial.get('pitchBend')?.value;
          const values = new Map(spatial); values.delete('note'); values.delete('pitchBend');
          spec = applyMidiAutomationSpanValues(spec, values, project.global || {});
          if (Number.isFinite(offset) && !spec.percussion) spec.note = clamp(spec.note + Math.round(offset), project.global?.noteRange?.min ?? 0, project.global?.noteRange?.max ?? 127);
          if (Number.isFinite(bend)) spec.pitchBend = clamp(bend, -1, 1);
          if (spatial.has('duration') || spatial.has('sustain')) spec.durationMs = spec.durationTicks * 60;
        }
        if (spanValues?.size) {
          spec = applyMidiAutomationSpanValues(spec, spanValues, project.global || {});
          if (!spec) continue;
          if (spanValues.has('duration') || spanValues.has('sustain')) spec.durationMs = spec.durationTicks * 60;
          meta.automationSpanIds = [...spanValues.values()].map(value => value.id);
        }
        spec.velocity = clamp(Math.round(spec.velocity * lane.gain * sound.playbackGain * accent * emphasis), 1, 127);
        if (repeat === 0) send(spec, meta);
        else if (state.pending.length < 4096) state.pending.push({ beat: beat + offset, spec, meta });
      }
    }
  };
  const barBeats = project => meterQuarterLength(project.transport?.timeSignature);
  const automate = (project, lane, laneIndex, current, beat, timestamp) => {
    if (!emitCC || !audible(project, lane)) return;
    const sinkKey = String(getSinkKey(lane));
    if (current.ccRoute !== sinkKey) { current.cc = {}; current.ccBySink = {}; current.ccTargets = {}; current.ccRoute = sinkKey; }
    current.cc ||= {};
    current.ccBySink ||= {}; current.ccTargets ||= {};
    for (const curve of lane.ccAutomation || []) {
      if (state.ccBudget <= 0) break;
      if (!curve.enabled || !curve.points.length) continue;
      const at = ((curve.axis === 'distance' ? getLaneDistance(laneIndex) : beat) % curve.length + curve.length) % curve.length;
      let left = curve.points[0], right = curve.points.at(-1);
      for (const point of curve.points) { if (point.beat <= at) left = point; if (point.beat > at) { right = point; break; } }
      const fraction = curve.mode === 'step' || right.beat <= left.beat ? 0 : clamp((at - left.beat) / (right.beat - left.beat), 0, 1);
      const value = Math.round(left.value + (right.value - left.value) * fraction);
      const identity = `${curve.id}:${lane.outputId}:${lane.channel}:${curve.controller}`;
      const coalesceKey = JSON.stringify([lane.id, identity]), known = (current.ccTargets[identity] || []).filter(sinkId => sinkId !== 'unavailable');
      const targets = known.filter(sinkId => {
        const entry = pendingKeys.get(JSON.stringify([coalesceKey, sinkId]));
        if (entry && !entry.cancelling && entry.spec.value !== value) cancelEntry(entry, 'controller-value-superseded');
        if (current.ccBySink[JSON.stringify([identity, sinkId])] === value) return false;
        if (!entry || entry.cancelling) return true;
        if (entry.spec.value === value) return false;
        return true;
      });
      if (known.length && !targets.length) continue;
      state.ccBudget--;
      const spec = { controller: curve.controller, value, channel: lane.channel, outputId: lane.outputId, timeMs: timestamp };
      const meta = { laneId: lane.id, laneIndex, source: 'automation', beat, ...(known.length ? { targetSinkIds: targets } : {}) };
      dispatchAdmission(emitCC, spec, meta, receipt => {
        if (current.ccRoute !== sinkKey) return;
        current.ccBySink[JSON.stringify([identity, receipt.sinkId])] = value;
        if (current.ccTargets[identity].every(sinkId => current.ccBySink[JSON.stringify([identity, sinkId])] === value)) current.cc[identity] = value;
      }, { coalesceKey, onTargets: sinkIds => { current.ccTargets[identity] = [...new Set([...known, ...sinkIds])]; } });
    }
  };
  const onBeat = position => {
    const project = getProject?.();
    if (!project?.procgen || !Number.isFinite(position?.beat)) return;
    derive(project);
    sweepAdmissions();
    const beat = position.beat;
    if (beat < state.beat - 1e-6) {
      if (position.preserveAhead) { state.bpm = position.bpm || state.bpm; return; }
      reset();
    }
    if (Math.abs(beat - state.beat) < 1e-7) { state.bpm = position.bpm || state.bpm; return; }
    const previousBeat = state.beat;
    state.budget = maxNotesPerPulse;
    state.ccBudget = maxNotesPerPulse;
    state.beat = beat; state.timestamp = position.timestamp; state.bpm = position.bpm || 120;
    sweepAdmissions();
    state.active = state.active.filter(item => item.endBeat > beat + 1e-7);
    const bar = barBeats(project);
    const remaining = [];
    for (const item of state.pending) {
      if (item.beat <= beat + 1e-6) {
        const lane = liveLanes.get(item.meta.laneId);
        if (lane && audible(project, lane) && (item.meta.source !== 'pattern' || lane.mode !== 'game')) send({ ...item.spec, timeMs: position.timestamp - (beat - item.beat) * 60000 / state.bpm }, item.meta);
      } else remaining.push(item);
    }
    state.pending = remaining;
    const laneCount = project.procgen.lanes.length, launches = [];
    for (let offset = 0; offset < laneCount; offset++) {
      const laneIndex = (offset + state.cursor) % laneCount;
      const lane = project.procgen.lanes[laneIndex];
      const current = laneState(lane);
      automate(project, lane, laneIndex, current, beat, position.timestamp);
      if (lane.queuedSlot != null && lane.launchSerial !== current.launchSerial) {
        current.queuedMeter ??= bar;
        if (current.queuedSerial !== lane.launchSerial || current.queuedMeter !== bar) {
          current.queuedSerial = lane.launchSerial;
          current.queuedMeter = bar;
          current.launchBeat = Math.ceil((beat - 1e-7) / bar) * bar;
        }
        if (beat + 1e-6 >= current.launchBeat) {
          current.slot = lane.queuedSlot; current.launchSerial = lane.launchSerial;
          current.origin = current.launchBeat; current.lastStep = -1;
          state.pending = state.pending.filter(item => item.meta.laneId !== lane.id);
          const launch = { laneId: lane.id, slot: current.slot };
          if (onLaunchBatch) launches.push(launch); else onLaunch(launch);
        }
      }
      if (lane.mode !== 'pattern') continue;
      const pattern = lane.patterns[current.slot];
      if (!pattern) continue;
      const absolute = Math.floor((beat - current.origin) * 4 * pattern.rate + 1e-6);
      if (absolute <= current.lastStep) continue;
      // A seek or delayed pulse skips missed cells; it cannot create a burst of old notes.
      const start = current.lastStep >= 0 && beat - previousBeat <= 1 / 12 + 1e-6 ? current.lastStep + 1 : absolute;
      for (let step = start; step <= absolute; step++) {
        current.lastStep = step;
        const stepBeat = current.origin + step / (4 * pattern.rate);
        const timestamp = position.timestamp - (beat - stepBeat) * 60000 / state.bpm;
        queueStep(project, lane, laneIndex, current, pattern, ((step % pattern.length) + pattern.length) % pattern.length, stepBeat, timestamp, 'pattern');
      }
    }
    if (launches.length) onLaunchBatch(launches);
    sweepAdmissions();
    if (laneCount > maxNotesPerPulse && (state.budget < maxNotesPerPulse || state.ccBudget < maxNotesPerPulse)) state.cursor = (state.cursor + Math.max(1, maxNotesPerPulse)) % laneCount;
  };
  const onGameEvent = (event, timestamp = now()) => {
    const project = getProject?.();
    if (!project?.procgen) return false;
    derive(project);
    const laneIndex = Number.isInteger(event?.laneIndex) ? event.laneIndex : 0;
    const lane = project.procgen.lanes[laneIndex];
    if (!lane) return true;
    // Physical play is consumed by CausalMusicEngine. It can never select the
    // next pattern cell, even if a caller accidentally forwards a legacy SFX.
    if (lane.mode !== 'pattern') return false;
    const current = laneState(lane);
    current.events++;
    const source = project.sources?.find(item => event.triggerType != null ? ['trigger', 'midiFlag'].includes(item.kind) && item.sourceKey === String(event.triggerType) : item.kind === 'sfx' && item.sourceKey === String(event.sfxId));
    current.eventMeta = { automationEventId: ++state.automationSerial, laneIndex, trackId: source?.trackId ?? project.tracks?.[0]?.id,
      sfxId: event.sfxId, triggerType: event.triggerType ?? null, lemmingId: event.lemmingId, x: event.x, y: event.y, tick: event.tick };
    if (automation.entries.length) current.eventMeta.automationEventCounts = automation.observeOrigin(current.eventMeta, automationPosition(project, laneIndex, Math.max(0, state.beat), event));
    current.observed = { action: String(event.action ?? event.type ?? ''), terrain: String(event.terrainFamily ?? event.themeId ?? event.terrain ?? '') };
    if (Object.entries(lane.eventMask || {}).some(([key, enabled]) => !enabled && current.observed.action.toLowerCase().includes(key))) return true;
    if (lane.mode === 'pattern') return true;
    const pattern = lane.patterns[current.slot];
    const stepIndex = (current.events - 1) % pattern.length;
    current.lastStep = lane.mode === 'game' ? current.events - 1 : current.lastStep;
    queueStep(project, lane, laneIndex, current, pattern, stepIndex, Math.max(0, state.beat), timestamp, 'game');
    return true;
  };
  const reset = () => { admissionGeneration++; sweepAdmissions('engine-reset'); state = emptyState(); automation.reset(); };
  const snapshot = () => clone({ ...state, automation: automation.exportState(), admissionCursor: { ...admissions.counters(), eventSerial }, pendingAdmissions: [...deferred.values()].map(entry => ({ receipt: entry.receipt, cancelling: !!entry.cancelling, cancellationUnconfirmed: !!entry.cancellationUnconfirmed })) });
  const restore = value => {
    reset();
    if (value?.version === 1 && Number.isFinite(value.beat) && value.lanes && Array.isArray(value.pending)) {
      const restored = clone(value); delete restored.pendingAdmissions; delete restored.admissionCursor; state = { ...state, ...restored };
      if (value.admissionCursor != null) {
        if (!Number.isSafeInteger(value.admissionCursor.eventSerial) || value.admissionCursor.eventSerial < 0 || value.admissionCursor.eventSerial > Number.MAX_SAFE_INTEGER - 65536 ||
            !admissions.restoreCounters(value.admissionCursor)) throw new Error('Invalid pattern admission cursor.');
        eventSerial = Math.max(eventSerial, value.admissionCursor.eventSerial);
      }
    }
    const project = getProject?.(); if (project?.procgen) derive(project);
    automation.restoreState(value?.automation); delete state.automation;
  };
  const flush = () => { sweepAdmissions('engine-flushed'); state.pending = []; };
  const resume = ({ beat = state.beat, timestamp = now(), bpm = state.bpm, activeNotes = state.active } = {}) => {
    const project = getProject?.();
    if (!project?.procgen) return;
    derive(project);
    const previousActive = [...activeNotes]; state.active = [];
    for (const item of previousActive) {
      const lane = liveLanes.get(item.meta.laneId), startBeat = Math.max(beat, item.meta.beat), remaining = item.endBeat - startBeat;
      if (!lane || !audible(project, lane) || remaining <= 0 || item.routeKey != null && item.routeKey !== routeFor(lane) || !accepted(item.receipt)) continue;
      const resumed = item.meta.beat < beat - 1e-7;
      if (resumed && item.spec.percussion) continue;
      const durationMs = remaining * 60000 / bpm;
      const envelope = resumed ? { ...item.spec.envelope, attack: 0, decay: 0 } : item.spec.envelope;
      const spec = { ...item.spec, envelope, resumed, timeMs: timestamp + (startBeat - beat) * 60000 / bpm, durationMs, durationTicks: durationMs / 60 };
      const meta = { ...item.meta, resumed, beat: startBeat, targetSinkId: item.receipt.sinkId, voiceId: item.receipt.voiceId, onsetId: item.receipt.onsetId };
      dispatchAdmission(emit, spec, meta, (receipt, route) => state.active.push({ ...item, receipt, routeKey: route }), { isNote: true });
    }
  };
  const getLanePosition = id => { const lane = state.lanes[id]; return lane ? { slot: lane.slot, origin: lane.origin, lastStep: lane.lastStep } : null; };
  const acknowledgeAdmission = (receipt, update) => {
    const next = admissions.advance(receipt, update);
    if (next) for (const item of state.active) if (item.receipt.receiptId === next.receiptId) item.receipt = next;
    return next;
  };
  return { onBeat, onGameEvent, snapshot, restore, reset, flush, resume, cancelPendingAdmissions: sweepAdmissions, getAdmissions: admissions.snapshot, acknowledgeAdmission,
    getState: snapshot, getLanePosition, getAutomationSpanState: (id, lane) => automation.snapshot(id, lane) };
};
export { createProcgenPatternEngine, procgenStepNotes };
