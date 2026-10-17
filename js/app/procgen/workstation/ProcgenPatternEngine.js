import { resolveProcgenSound } from './ProcgenSoundCollections.js';
import { MidiAutomationSpans } from '../../../midi/router/MidiAutomationSpans.js';
import { applyMidiAutomationSpanValues } from '../../../midi/midi-mapping/MidiAutomationSpanValues.js';
import { positionCurveValue } from '../../../midi/midi-mapping/PositionCurve.js';
import { resolveAxisValues, resolveAxisValue } from '../../../midi/midi-mapping/MidiMappingDomain.js';

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
const createProcgenPatternEngine = ({ getProject, emit, emitCC, getLaneDistance = () => 0, getLaneObservation, getLaneSpatialPosition = () => ({}), onLaunch = () => {}, now = () => performance.now(), maxNotesPerPulse = 128 } = {}) => {
  const emptyState = () => ({ version: 1, beat: -1, timestamp: 0, bpm: 120, lanes: {}, pending: [], active: [], cursor: 0, budget: maxNotesPerPulse, ccBudget: maxNotesPerPulse, automationSerial: 0 });
  const automation = new MidiAutomationSpans([]);
  let state = emptyState(), cachedProject = null, solo = false, liveLanes = new Map(), spatialCurves = [];
  const derive = project => {
    if (cachedProject === project) return;
    cachedProject = project;
    automation.configure(project.automation);
    spatialCurves = (project.automation || []).filter(entry => !entry.span && entry.enabled !== false);
    solo = project.procgen.lanes.some(lane => lane.solo);
    liveLanes = new Map(project.procgen.lanes.map(lane => [lane.id, lane]));
    for (const id of Object.keys(state.lanes)) if (!liveLanes.has(id)) delete state.lanes[id];
  };
  const laneState = lane => {
    if (!Object.hasOwn(state.lanes, lane.id)) Object.defineProperty(state.lanes, lane.id, { enumerable: true, configurable: true, writable: true, value: {
      slot: lane.activeSlot, launchSerial: -1, origin: 0, lastStep: -1, events: 0, attempts: 0, observed: { action: '', terrain: '' }, cc: {}
    } });
    return state.lanes[lane.id];
  };
  const audible = (project, lane) => !lane.mute && lane.gain > 0 && (!solo || lane.solo);
  const send = (spec, meta) => {
    if (state.budget <= 0) return;
    state.budget--; emit?.(spec, meta);
    if (state.active.length >= 512) state.active.shift();
    state.active.push({ spec, meta, endBeat: meta.beat + spec.durationMs * state.bpm / 60000 });
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
          channel: sound.percussion ? 10 : lane.channel, program: sound.program, outputId: lane.outputId, percussion: sound.percussion,
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
  const barBeats = project => (project.transport?.timeSignature?.beats || 4) * 4 / (project.transport?.timeSignature?.unit || 4);
  const automate = (project, lane, laneIndex, current, beat, timestamp) => {
    if (!emitCC || !audible(project, lane)) return;
    current.cc ||= {};
    for (const curve of lane.ccAutomation || []) {
      if (state.ccBudget <= 0) break;
      if (!curve.enabled || !curve.points.length) continue;
      const at = ((curve.axis === 'distance' ? getLaneDistance(laneIndex) : beat) % curve.length + curve.length) % curve.length;
      let left = curve.points[0], right = curve.points.at(-1);
      for (const point of curve.points) { if (point.beat <= at) left = point; if (point.beat > at) { right = point; break; } }
      const fraction = curve.mode === 'step' || right.beat <= left.beat ? 0 : clamp((at - left.beat) / (right.beat - left.beat), 0, 1);
      const value = Math.round(left.value + (right.value - left.value) * fraction);
      const identity = `${curve.id}:${lane.outputId}:${lane.channel}:${curve.controller}`;
      if (current.cc[identity] === value) continue;
      current.cc[identity] = value;
      state.ccBudget--;
      emitCC({ controller: curve.controller, value, channel: lane.channel, outputId: lane.outputId, timeMs: timestamp }, { laneId: lane.id, laneIndex, source: 'automation', beat });
    }
  };
  const onBeat = position => {
    const project = getProject?.();
    if (!project?.procgen || !Number.isFinite(position?.beat)) return;
    derive(project);
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
    const laneCount = project.procgen.lanes.length;
    for (let offset = 0; offset < laneCount; offset++) {
      const laneIndex = (offset + state.cursor) % laneCount;
      const lane = project.procgen.lanes[laneIndex];
      const current = laneState(lane);
      automate(project, lane, laneIndex, current, beat, position.timestamp);
      if (lane.queuedSlot != null && lane.launchSerial !== current.launchSerial) {
        if (current.queuedSerial !== lane.launchSerial) {
          current.queuedSerial = lane.launchSerial;
          current.launchBeat = Math.ceil((beat - 1e-7) / bar) * bar;
        }
        if (beat + 1e-6 >= current.launchBeat) {
          current.slot = lane.queuedSlot; current.launchSerial = lane.launchSerial;
          current.origin = current.launchBeat; current.lastStep = -1;
          state.pending = state.pending.filter(item => item.meta.laneId !== lane.id);
          onLaunch({ laneId: lane.id, slot: current.slot });
        }
      }
      if (lane.mode === 'game') continue;
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
    if (laneCount > maxNotesPerPulse && (state.budget < maxNotesPerPulse || state.ccBudget < maxNotesPerPulse)) state.cursor = (state.cursor + Math.max(1, maxNotesPerPulse)) % laneCount;
  };
  const onGameEvent = (event, timestamp = now()) => {
    const project = getProject?.();
    if (!project?.procgen) return false;
    derive(project);
    const laneIndex = Number.isInteger(event?.laneIndex) ? event.laneIndex : 0;
    const lane = project.procgen.lanes[laneIndex];
    if (!lane) return true;
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
  const reset = () => { state = emptyState(); automation.reset(); };
  const snapshot = () => clone({ ...state, automation: automation.exportState() });
  const restore = value => {
    reset();
    if (value?.version === 1 && Number.isFinite(value.beat) && value.lanes && Array.isArray(value.pending)) state = { ...state, ...clone(value) };
    const project = getProject?.(); if (project?.procgen) derive(project);
    automation.restoreState(value?.automation); delete state.automation;
  };
  const flush = () => { state.pending = []; };
  const resume = ({ beat = state.beat, timestamp = now(), bpm = state.bpm, activeNotes = state.active } = {}) => {
    const project = getProject?.();
    if (!project?.procgen) return;
    derive(project);
    for (const item of activeNotes) {
      const lane = liveLanes.get(item.meta.laneId), startBeat = Math.max(beat, item.meta.beat), remaining = item.endBeat - startBeat;
      if (!lane || !audible(project, lane) || remaining <= 0) continue;
      const resumed = item.meta.beat < beat - 1e-7;
      if (resumed && item.spec.percussion) continue;
      const durationMs = remaining * 60000 / bpm;
      const envelope = resumed ? { ...item.spec.envelope, attack: 0, decay: 0 } : item.spec.envelope;
      emit?.({ ...item.spec, envelope, resumed, timeMs: timestamp + (startBeat - beat) * 60000 / bpm, durationMs, durationTicks: durationMs / 60 }, { ...item.meta, resumed, beat: startBeat });
    }
  };
  const getLanePosition = id => { const lane = state.lanes[id]; return lane ? { slot: lane.slot, origin: lane.origin, lastStep: lane.lastStep } : null; };
  return { onBeat, onGameEvent, snapshot, restore, reset, flush, resume, getState: snapshot, getLanePosition, getAutomationSpanState: (id, lane) => automation.snapshot(id, lane) };
};
export { createProcgenPatternEngine, procgenStepNotes };
