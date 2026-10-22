import { createMidiProject, sanitizeMidiProject, reduceMidiProject, projectToMidiConfig } from '../../../midi/project/MidiProject.js';
import { createProcgenWorkstationProject, createProcgenPattern } from './ProcgenWorkstationProject.js';
import { createProcgenPatternEngine } from './ProcgenPatternEngine.js';
import { createProcgenTransport } from './ProcgenTransport.js';
import { createProcgenMidiPorts } from './ProcgenMidiPorts.js';
import { exportProcgenMidi } from './ProcgenMidiExport.js';
import { createProcgenWorkstationView } from './ProcgenWorkstationView.js';
import { captureProcgenCheckpoint } from './ProcgenCheckpoint.js';
import { createProcgenLaneObserver } from './ProcgenLaneObservation.js';
import { createProcgenSession, validateProcgenSession, createProcgenSessionStorage, freshProcgenSeed } from './ProcgenSessionStorage.js';

const STORAGE_KEY = 'lemmings.procgen.workstation.v1';
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Keep musical edits made while assets were loading if the candidate world fails.
function rollbackWorldProject(previous, staged, current) {
  const restored = { ...previous, procgen: { ...previous.procgen } };
  for (const key of Object.keys(current)) if (key !== 'procgen' && !equal(current[key], staged[key])) restored[key] = current[key];
  restored.procgen.lanes = previous.procgen.lanes.map(lane => {
    const before = staged.procgen.lanes.find(value => value.id === lane.id), after = current.procgen.lanes.find(value => value.id === lane.id);
    if (!before || !after) return lane;
    const next = { ...lane };
    for (const key of Object.keys(after)) if (key !== 'id' && key !== 'family' && !equal(before[key], after[key])) next[key] = after[key];
    return next;
  });
  return restored;
}

export function createProcgenWorkstation({ document, window, legacy, getRuntime, restart,
  createView = createProcgenWorkstationView, storage = createProcgenSessionStorage(window.indexedDB),
  captureCheckpoint = captureProcgenCheckpoint, transportOptions = {} }) {
  const now = () => window.performance?.now?.() ?? performance.now();
  let saved = null;
  try { saved = JSON.parse(window.localStorage?.getItem(STORAGE_KEY) || 'null'); } catch { /* Keep the default project. */ }
  const initialSeed = legacy.settings.seed ?? freshProcgenSeed(window.crypto);
  let project = createProcgenWorkstationProject(sanitizeMidiProject(saved?.project || legacy.getProject()), { seed: initialSeed });
  const state = { laneId: project.procgen.lanes[0].id, slot: 0, step: 0, tab: 'Lane', tool: 'select', layout: 'strip',
    inspectorWidth: 304, firstLane: 0, minimumRow: 64, hazardSpacing: 160, observerMode: 'overview', observerLane: null, observerHold: 6,
    inputId: null, clockOutputId: null, thru: false, recording: false, lastMidi: '', ...(saved?.ui || {}) };
  state.recording = false; state.thru = false;
  let view = null, disposed = false, boundRuntime = null, boundSession = null, unhookRouter = null, unhookWorld = null;
  let ports, engine, lastPlaying = false, lastLegacySpeed = legacy.settings.speed, pendingResume = false, lastTempo = null;
  let savedName = 'Untitled session', clipboard = null, loadSerial = 0, suppressPersistence = false;
  let operationSerial = 0, currentOperation = null;
  let lastRecovery = now(), recoveryPending = false, recoveryTimer = null;
  let lastBudgetNotice = -Infinity;
  let lastObserverAt = -Infinity, observerCursor = 0;
  let writingLegacy = false;
  let worldBusy = false;
  let laneObserver = null;
  const routerRestores = new Map();
  const undo = [], redo = [], listeners = [], noteEntries = new Map();
  const status = text => { if (!disposed) view?.status(text); };
  const beginOperation = kind => {
    currentOperation?.controller.abort();
    const lease = { ownerId: 'procgen-workstation', generation: ++operationSerial, kind, controller: new AbortController() };
    lease.signal = lease.controller.signal;
    currentOperation = lease;
    return lease;
  };
  const ownsOperation = lease => !disposed && currentOperation === lease && !lease.signal.aborted;
  const finishOperation = lease => { if (currentOperation === lease) currentOperation = null; };
  const listen = (target, event, handler) => { target?.addEventListener?.(event, handler); listeners.push(() => target?.removeEventListener?.(event, handler)); };
  const runtime = () => getRuntime?.();
  const renderer = () => runtime()?.lanes?.renderer;
  const router = () => runtime()?.view?.midiPreviewRouter;
  const selected = () => project.procgen.lanes.find(lane => lane.id === state.laneId) || project.procgen.lanes[0];
  const setLegacyProject = next => { writingLegacy = true; try { legacy.setProject(next); } finally { writingLegacy = false; } };
  const budgetNotice = () => { if (now() - lastBudgetNotice > 1000) { lastBudgetNotice = now(); status('Output budget reached; some notes or CC were thinned. The musical clock continues.'); } };
  const reportRouting = () => {
    const addresses = new Map();
    for (const lane of project.procgen.lanes) for (const curve of lane.ccAutomation || []) {
      if (!curve.enabled || lane.mute) continue;
      const key = `${lane.outputId || 'default'}:${lane.channel}:${curve.controller}`;
      if (addresses.has(key)) { status(`CC ${curve.controller} on channel ${lane.channel} is shared by ${addresses.get(key)} and ${lane.name}. Use separate channels to control them independently.`); return; }
      addresses.set(key, lane.name);
    }
  };
  const syncWorldSeed = () => {
    if (worldBusy) return;
    const seed = runtime()?.world?.seed;
    if (Number.isFinite(seed) && seed !== project.procgen.seed) { project = { ...project, procgen: { ...project.procgen, seed } }; legacy.settings.seed = seed; setLegacyProject(project); persist(); }
  };
  const observeFrame = timestamp => {
    if (state.observerMode !== 'director' || timestamp - lastObserverAt < Math.max(2, Number(state.observerHold) || 6) * 1000) return;
    lastObserverAt = timestamp;
    const world = runtime()?.world, render = renderer(); if (!world || !render) return;
    const ranked = project.procgen.lanes.map((lane, index) => ({ index, distance: world.stall?.lanes?.[index]?.maxX || world.frontiers?.[index] || 0 })).sort((a, b) => b.distance - a.distance || a.index - b.index);
    const count = Math.min(8, ranked.length), selectedLane = ranked[observerCursor++ % count];
    if (selectedLane) { state.firstLane = selectedLane.index; render.followLaneIndex = selectedLane.index; render.camera?.followFrontier?.(); view?.layout?.(); view?.launched?.(); }
  };
  const persist = () => {
    if (suppressPersistence || disposed) return;
    try { window.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, project, ui: { ...state, recording: false, thru: false, lastMidi: '' }, transport: transport.snapshot() })); }
    catch { status('Project preferences could not be stored. Export a project file to save.'); }
  };
  const syncProject = (next, { history = true, render = true, fromLegacy = false } = {}) => {
    if (history) { undo.push(project); if (undo.length > 20) undo.shift(); redo.length = 0; }
    project = createProcgenWorkstationProject(sanitizeMidiProject(next));
    if (!project.procgen.lanes.some(lane => lane.id === state.laneId)) state.laneId = project.procgen.lanes[0].id;
    state.slot = Math.max(0, Math.min(3, state.slot || 0)); state.step = Math.max(0, Math.min(selected().patterns[state.slot].length - 1, state.step || 0));
    if (!fromLegacy) setLegacyProject(project); ports?.configure({ schedulerConfig: projectToMidiConfig(project) });
    persist(); if (render) { view?.render(); reportRouting(); } return project;
  };
  const dispatch = action => {
    if (disposed) return project;
    if (action.type === 'procgen/palette' && action.family && project.procgen.lanes.find(lane => lane.id === action.laneId)?.family !== action.family) {
      return safe(() => rebuild({ projectNext: reduceMidiProject(project, action) }))();
    }
    const next = syncProject(reduceMidiProject(project, action), { history: action.type !== 'procgen/launched', render: action.type !== 'procgen/launched' });
    if (action.type === 'procgen/launched') view?.launched?.();
    return next;
  };
  const explicitSpeed = new URLSearchParams(window.location?.search || '').has('speed');
  const transport = createProcgenTransport({ now, bpm: 120, gameSpeed: explicitSpeed ? legacy.settings.speed || 1 : 1,
    speedMode: 'bpm', ...(saved?.transport || {}), ...transportOptions,
    onBeat: position => {
      const held = position.source === 'external' && pendingResume ? engine?.snapshot().active : null;
      if (held) pendingResume = false;
      engine?.onBeat({ ...position, preserveAhead: true });
      if (held) engine.resume({ ...position, activeNotes: held });
    },
    onSpeed(speed) { const timer = runtime()?.world?.timer; if (timer) timer.speedFactor = speed; },
    onFlush(reason) {
      ports?.flush(); router()?.scheduler?.allNotesOff?.();
      if (['seek', 'stopped', 'midi-start', 'restored'].includes(reason)) engine?.reset();
      else pendingResume = (engine?.getState().beat ?? -1) >= 0;
    },
    onStop(reason) {
      if (!disposed && ['clock-lost', 'suspended', 'clock-overload', 'output-disconnected'].includes(reason)) status('Transport stopped: ' + reason.replaceAll('-', ' ') + '. Press Play or send MIDI Start/Continue to resume.');
    },
    onPosition(position) {
      if (disposed) return;
      if (position.playing !== lastPlaying) { lastPlaying = position.playing; legacy.setPaused(!position.playing); }
      if (position.playing) runtime()?.lanes?.pump?.(position.timestamp);
      syncWorldSeed(); observeFrame(position.timestamp);
      if (position.bpm !== lastTempo) { lastTempo = position.bpm; ports?.recordTempo(position.bpm, position.beat, position.timestamp); }
      view?.transport(position);
      if (position.playing && position.timestamp - lastRecovery >= 30000 && !recoveryPending && recoveryTimer == null) {
        lastRecovery = position.timestamp;
        recoveryTimer = window.setTimeout?.(() => { recoveryTimer = null; recover(); }, 0) ?? null;
      }
    }
  });
  const inputStep = (event, learned = false) => {
    if (event.type !== 'noteOn' && event.type !== 'noteOff') return;
    const key = `${event.channel}:${event.note}`;
    if (event.type === 'noteOn') {
      const lane = selected(), laneId = lane.id, slot = state.slot, pattern = lane.patterns[slot], position = transport.getState(), beat = event.beat ?? position.beat;
      const index = !learned && state.recording && position.playing
        ? ((Math.floor((beat - (engine.getLanePosition(laneId)?.origin || 0)) * 4 * pattern.rate + 1e-7) % pattern.length) + pattern.length) % pattern.length : state.step;
      const chord = [...noteEntries.values()].filter(entry => entry.laneId === laneId && entry.slot === slot && entry.index === index && Math.abs(entry.beat - beat) < 0.25 / pattern.rate);
      const notes = [...new Set([...chord.map(entry => entry.note), event.note])].sort((a, b) => a - b), group = chord[0]?.group || { duration: 0 };
      dispatch({ type: 'procgen/step', laneId, slot, index, patch: { enabled: true, note: notes[0], velocity: event.velocity,
        chord: notes.length > 1 ? { degrees: notes.map(note => note - notes[0]), inversion: 0, spread: 0 } : null } });
      if (!learned) noteEntries.set(key, { laneId, slot, index, beat, note: event.note, group });
      status(`Recorded note ${event.note} into step ${index + 1}.`);
    } else {
      const start = noteEntries.get(key); if (!start) return;
      noteEntries.delete(key); start.group.duration = Math.max(start.group.duration, 1 / 96, (event.beat ?? transport.getState().beat) - start.beat);
      dispatch({ type: 'procgen/step', laneId: start.laneId, slot: start.slot, index: start.index, patch: { duration: start.group.duration } });
    }
  };
  ports = createProcgenMidiPorts({ transport, now, schedulerConfig: projectToMidiConfig(project),
    onMonitor(event) { state.lastMidi = event.type === 'system' ? `MIDI ${event.data[0].toString(16).toUpperCase()}` : `${event.type} · ch ${event.channel} · ${event.note ?? event.controller ?? ''} ${event.velocity ?? event.value ?? ''}`; view?.midi?.(state.lastMidi); },
    onLearn: event => inputStep(event, true), onRecord: event => { if (event.source === 'input') inputStep(event); }
  });
  const localEnabled = () => legacy.local.getState().enabled && legacy.local.getState().selectedBackend !== 'midi';
  let outputEpoch = 0;
  const admission = (status, sinkId, spec, meta, reason = null) => ({ status, reason, sinkId,
    eventId: meta?.eventId ?? meta?.automationEventId ?? null, voiceId: meta?.voiceId ?? null,
    connectionEpoch: outputEpoch, targetTime: spec?.timeMs ?? null, timeDomain: 'performance-ms',
    ackState: status === 'accepted' ? 'scheduled' : 'none' });
  engine = createProcgenPatternEngine({ getProject: () => project, now,
    getSinkKey: () => { const output = legacy.local.getState(); return `${output.selectedBackend}:${output.outputId || ''}:${output.enabled}:${outputEpoch}`; },
    getLaneDistance: index => runtime()?.world?.frontiers?.[index] || 0,
    getLaneObservation: index => laneObserver?.(index),
    getLaneSpatialPosition: index => {
      const world = runtime()?.world, observed = laneObserver?.(index);
      return { x: observed?.x, y: observed?.y, levelWidth: world?.width, levelHeight: world?.height };
    },
    emit(spec, meta) {
      if (!transport.getState().playing) return admission('rejected', null, spec, meta, 'transport-stopped');
      if (localEnabled()) {
        const scheduler = router()?.scheduler;
        if (scheduler?.sendNote({ ...spec, outputId: null, durationTicks: (spec.durationMs || 0) / (scheduler.tickMs || 60) }, meta)) {
          ports.recordOutput(spec, meta);
          return admission('accepted', 'local-preview', spec, meta);
        }
        if (scheduler?.getOutputPressure?.().throttled) budgetNotice();
        return admission('rejected', 'local-preview', spec, meta, 'scheduler-rejected');
      }
      if (legacy.local.getState().selectedBackend === 'midi' && legacy.local.getState().enabled) {
        if (ports.sendNote(spec, meta)) return admission('accepted', spec.outputId || 'midi-default', spec, meta);
        budgetNotice(); return admission('rejected', spec.outputId || 'midi-default', spec, meta, 'output-rejected');
      }
      return admission('rejected', null, spec, meta, 'no-enabled-sink');
    },
    emitCC(spec, meta) {
      const event = { ...spec, type: 'cc', timestamp: spec.timeMs };
      if (localEnabled()) {
        const scheduler = router()?.scheduler, channel = scheduler?.output?.channels?.[spec.channel];
        const reservation = scheduler?.evaluateAndReserve?.({ on: { timeMs: spec.timeMs, count: 1, bytes: 3 } }, meta, now());
        if (reservation && !reservation.ok) { scheduler.recordThrottle?.(reservation.reason, now(), meta); budgetNotice(); return admission('rejected', 'local-preview', spec, meta, reservation.reason); }
        if (channel?.sendControlChange) { channel.sendControlChange(spec.controller, spec.value, { time: spec.timeMs }); ports.recordEvent(event, meta); return admission('accepted', 'local-preview', spec, meta); }
        return admission('rejected', 'local-preview', spec, meta, 'channel-unavailable');
      }
      if (legacy.local.getState().selectedBackend === 'midi' && legacy.local.getState().enabled) {
        if (ports.sendEvent(event)) return admission('accepted', spec.outputId || 'midi-default', spec, meta);
        budgetNotice(); return admission('rejected', spec.outputId || 'midi-default', spec, meta, 'output-rejected');
      }
      return admission('rejected', null, spec, meta, 'no-enabled-sink');
    },
    onLaunch: action => dispatch({ type: 'procgen/launched', ...action })
  });
  const devices = () => ({ inputs: Array.from(window.WebMidi?.inputs || []).filter(port => port.state !== 'disconnected'), outputs: Array.from(window.WebMidi?.outputs || []).filter(port => port.state !== 'disconnected') });
  const syncPorts = () => {
    outputEpoch++;
    const available = devices(), outputState = legacy.local.getState();
    ports.setNoteOutputs(available.outputs);
    ports.setNoteOutput(outputState.selectedBackend === 'midi' && outputState.enabled ? available.outputs.find(port => port.id === outputState.outputId) || null : null);
    ports.setInput(available.inputs.find(port => port.id === state.inputId) || null);
    ports.setClockOutput(available.outputs.find(port => port.id === state.clockOutputId) || null);
  };
  const play = () => {
    const held = pendingResume ? engine.snapshot().active : null; pendingResume = false;
    transport.play(); if (held) engine.resume({ ...transport.getState(), timestamp: now(), activeNotes: held });
    return transport.getState();
  };
  const configureTransport = patch => {
    const previous = transport.getState(), held = previous.playing ? engine.snapshot().active : null;
    transport.configure(patch);
    if (held && previous.bpm !== transport.getState().bpm) { pendingResume = false; engine.resume({ ...transport.getState(), timestamp: now(), activeNotes: held }); }
  };
  const beforeRestart = () => { transport.pause(); ports.flush(); return transport.snapshot(); };
  const prepareSettings = () => {
    Object.assign(legacy.settings, { workstation: true, laneCount: project.procgen.lanes.length, seed: project.procgen.seed,
      hazardSpacing: state.hazardSpacing, laneAssignments: project.procgen.lanes.map(lane => lane.family) });
    return legacy.settings;
  };
  const attachRouter = next => {
    if (!next) return;
    if (!routerRestores.has(next)) routerRestores.set(next, { event: next.workstationEventHandler, automation: next.getAutomationSpanState });
    next.workstationEventHandler = () => true;
    next.getAutomationSpanState = (id, lane) => engine.getAutomationSpanState?.(id, lane);
    next.resetClock?.({ preserveGamePhrases: true });
  };
  const bindRuntime = ({ session } = {}) => {
    if (disposed) return null;
    const next = runtime(); if (!next || (next === boundRuntime && session === boundSession)) return next;
    unhookRouter?.(); unhookWorld?.(); boundRuntime = next; boundSession = session;
    laneObserver = createProcgenLaneObserver(next.world);
    const bus = next.world?.soundEvents?.onEvent;
    const onGameEvent = event => { if (transport.getState().playing) engine.onGameEvent(event, now()); };
    bus?.on?.(onGameEvent); unhookWorld = () => bus?.off?.(onGameEvent);
    next.lanes?.setClockDriven?.(true);
    if (next.view?.setMidiPreviewRouter) {
      const owner = next.view, original = owner.setMidiPreviewRouter;
      owner.setMidiPreviewRouter = function(value, ...args) { const result = original.call(this, value, ...args); attachRouter(value); syncPorts(); return result; };
      unhookRouter = () => {
        owner.setMidiPreviewRouter = original;
        for (const [attached, previous] of routerRestores) { attached.workstationEventHandler = previous.event; attached.getAutomationSpanState = previous.automation; }
        routerRestores.clear();
      };
    }
    attachRouter(next.view?.midiPreviewRouter);
    if (session) {
      suppressPersistence = true;
      syncProject(session.project, { history: false, render: false }); Object.assign(legacy.settings, session.settings, { workstation: true });
      lastLegacySpeed = legacy.settings.speed;
      Object.assign(state, session.ui || {}, { recording: false, thru: false }); savedName = session.name;
      transport.restore(session.transport || {}); engine.restore(session.patterns); pendingResume = true;
      renderer()?.camera?.applyState?.(session.camera); suppressPersistence = false;
      ports.configure({ recording: false, thru: false }); undo.length = 0; redo.length = 0; status('Project loaded paused. Press Play to resume.');
    }
    prepareSettings(); legacy.setPaused(!transport.getState().playing); lastPlaying = transport.getState().playing;
    const timer = next.world?.timer; if (timer) timer.speedFactor = transport.getState().effectiveSpeed;
    syncPorts(); view?.render(); view?.transport(transport.getState());
    if (legacy.local.getState().status === 'suspended') Promise.resolve(legacy.local.resumeGame?.()).catch(error => status(error?.message || 'Reconnect the audio output.'));
    if (!session && !pendingResume) play();
    persist(); return next;
  };
  const snapshotSession = name => {
    if (worldBusy) throw new Error('Wait for the world change to finish before saving.');
    syncWorldSeed();
    return createProcgenSession({ name, project: clone(project), settings: clone(prepareSettings()), world: captureCheckpoint(runtime().world),
      transport: transport.snapshot(), patterns: engine.snapshot(), camera: renderer()?.camera?.getState?.(), ui: { ...state, recording: false, thru: false, lastMidi: '' } });
  };
  const recover = async () => {
    if (disposed || worldBusy || recoveryPending || !runtime()?.world) return false;
    recoveryPending = true; lastRecovery = now();
    try { await storage.save('__recovery__', snapshotSession(savedName + ' (recovery)')); return true; }
    catch { return false; }
    finally { recoveryPending = false; }
  };
  const capture = (name = savedName, { resume = true } = {}) => {
    if (worldBusy) throw new Error('Wait for the world change to finish before saving.');
    if (!runtime()?.world) throw new Error('The world is not ready to save.');
    const wasPlaying = transport.getState().playing; beforeRestart();
    try {
      return snapshotSession(name);
    } finally { if (resume && wasPlaying) play(); }
  };
  const download = (bytes, filename, type) => {
    const url = window.URL.createObjectURL(new window.Blob([bytes], { type })), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
  };
  const safe = fn => async (...args) => { try { return await fn(...args); } catch (error) { status(error?.message || String(error)); return false; } };
  async function loadSession(value, admittedLease = null) {
    if (disposed || (admittedLease && !ownsOperation(admittedLease))) return false;
    if (worldBusy) throw new Error('A world change is already running. Wait for it to finish.');
    const lease = admittedLease || beginOperation('load');
    const session = validateProcgenSession(value), serial = ++loadSerial;
    const validatedProject = createProcgenWorkstationProject(sanitizeMidiProject(session.project));
    if (validatedProject.procgen.lanes.length !== session.world.laneCount) throw new Error('Project lanes and world checkpoint do not match.');
    worldBusy = true;
    const previous = transport.getState(), oldSettings = { ...legacy.settings };
    const prepared = { ...session, project: validatedProject };
    beforeRestart();
    try {
      const restarted = await restart({ session: prepared, lease });
      if (!ownsOperation(lease) || serial !== loadSerial) return false;
      if (restarted === false) throw new Error('World preparation was canceled.');
      bindRuntime({ session: prepared }); return true;
    } catch (error) {
      if (!ownsOperation(lease)) return false;
      Object.assign(legacy.settings, oldSettings); lastLegacySpeed = legacy.settings.speed; if (previous.playing) play(); throw error;
    } finally { worldBusy = false; finishOperation(lease); }
  }
  async function rebuild({ seed = project.procgen.seed, fresh = false, projectNext = null, history = true } = {}) {
    if (disposed) return false;
    if (worldBusy) throw new Error('A world change is already running. Wait for it to finish.');
    const lease = beginOperation('rebuild');
    worldBusy = true;
    const previous = project, oldSettings = { ...legacy.settings }, previousTransport = transport.getState(), previousPatterns = engine.snapshot(), undoLength = undo.length;
    beforeRestart();
    const source = projectNext || project;
    const next = fresh ? createProcgenWorkstationProject(createMidiProject(), { seed }) : { ...source, procgen: { ...source.procgen, seed } };
    if (fresh) { transport.configure({ baseBpm: 120, bpm: 120, gameSpeed: 1, speedMode: 'bpm', linked: true, clockSource: 'internal' }); legacy.setSpeed(1); lastLegacySpeed = 1; }
    syncProject(next, { history }); prepareSettings();
    const staged = project;
    try {
      const restarted = await restart({ lease });
      if (!ownsOperation(lease)) return false;
      if (restarted === false) throw new Error('World preparation was canceled.');
      engine.reset(); transport.stop(); pendingResume = false; bindRuntime();
      if (previousTransport.playing) play(); status(fresh ? 'New project ready.' : 'World rebuilt.'); return true;
    } catch (error) {
      if (!ownsOperation(lease)) return false;
      const restored = rollbackWorldProject(previous, staged, project);
      syncProject(restored, { history: false }); undo.length = undoLength;
      if (!equal(restored, previous)) undo.push(previous);
      Object.assign(legacy.settings, oldSettings);
      lastLegacySpeed = legacy.settings.speed;
      transport.restore(previousTransport); engine.restore(previousPatterns); pendingResume = true;
      if (previousTransport.playing) play(); throw error;
    } finally { worldBusy = false; finishOperation(lease); }
  }
  const changesWorld = next => next.procgen.seed !== project.procgen.seed || next.procgen.lanes.length !== project.procgen.lanes.length || next.procgen.lanes.some((lane, index) => lane.family !== project.procgen.lanes[index]?.family);
  const historyMove = async (from, to) => {
    if (!from.length) return;
    const previous = project, next = from.at(-1);
    if (changesWorld(next) && !await rebuild({ projectNext: next, seed: next.procgen.seed, history: false })) return false;
    else syncProject(next, { history: false });
    from.pop(); to.push(previous);
  };
  const handlers = {
    status, preferences: persist, devices, engineState: () => engine.getState(), playhead: id => engine.getLanePosition?.(id),
    transport(patch) { configureTransport(patch); if (patch.gameSpeed != null) legacy.setSpeed(patch.gameSpeed); persist(); },
    addLane: safe(async () => { if (!await rebuild({ projectNext: reduceMidiProject(project, { type: 'procgen/addLane' }) })) return false; state.laneId = project.procgen.lanes.at(-1).id; view.render(); return true; }),
    removeLane: safe(async () => { await rebuild({ projectNext: reduceMidiProject(project, { type: 'procgen/removeLane', laneId: selected().id }) }); }),
    duplicate() { const lane = selected(), slot = (state.slot + 1) % 4; dispatch({ type: 'procgen/pattern', laneId: lane.id, slot, patch: clone(lane.patterns[state.slot]) }); state.slot = slot; view.render(); },
    clear() { const lane = selected(); dispatch({ type: 'procgen/pattern', laneId: lane.id, slot: state.slot, patch: { steps: lane.patterns[state.slot].steps.map(step => ({ ...step, enabled: false, tie: false })) } }); },
    copy() { clipboard = clone(selected().patterns[state.slot]); status('Phrase copied.'); },
    paste() { if (clipboard) dispatch({ type: 'procgen/pattern', laneId: selected().id, slot: state.slot, patch: clone(clipboard) }); },
    undo: safe(() => historyMove(undo, redo)),
    redo: safe(() => historyMove(redo, undo)),
    resetPattern() { dispatch({ type: 'procgen/pattern', laneId: selected().id, slot: state.slot, patch: createProcgenPattern(selected().family, selected().role, state.slot) }); },
    record(value) { state.recording = !!value; ports.configure({ recording: state.recording }); noteEntries.clear(); view.recording(state.recording); if (state.recording) ports.recordTempo(transport.getState().bpm, transport.getState().beat); },
    learn() { const accept = event => { if (event.type === 'noteOn') inputStep(event, true); else ports.learnNext(accept); }; ports.learnNext(accept); status('Play a MIDI note to learn this step.'); },
    input(id) { state.inputId = id || null; syncPorts(); view.renderInspector(); persist(); },
    clockOutput(id) { state.clockOutputId = id || null; syncPorts(); persist(); },
    thru(value) { state.thru = !!value; ports.configure({ thru: state.thru }); },
    connect: safe(async () => { if (!window.WebMidi) throw new Error('Web MIDI is unavailable in this browser.'); if (!window.WebMidi.enabled) await window.WebMidi.enable({ sysex: false }); syncPorts(); view.renderInspector(); status('MIDI connected. Choose note and clock ports, then press Play.'); }),
    expression(event) { ports.sendEvent({ ...event, type: event.type === 'pitchBend' ? 'bend' : event.type }); },
    save: safe(async () => {
      if (worldBusy) throw new Error('Wait for the world change to finish before saving.');
      const wasPlaying = transport.getState().playing; beforeRestart();
      try { const name = typeof window.prompt === 'function' ? window.prompt('Project name', savedName) : savedName; if (name == null) return false; if (!name.trim()) { status('Enter a project name to save.'); return false; } const session = capture(name, { resume: false }); await storage.save(name, session); savedName = name; status('Saved ' + name + '.'); return true; }
      finally { if (wasPlaying) play(); }
    }),
    load: safe(async () => { if (worldBusy) throw new Error('A world change is already running. Wait for it to finish.'); const lease = beginOperation('select-session'); const entries = await storage.list(); if (!ownsOperation(lease)) return false; view.showProjects(entries, safe(async id => { if (!ownsOperation(lease)) return false; return loadSession(await storage.load(id), lease); })); return true; }),
    import: safe(async file => { if (worldBusy) throw new Error('A world change is already running. Wait for it to finish.'); const lease = beginOperation('import'); const text = await file.text(); if (!ownsOperation(lease)) return false; const session = JSON.parse(text); if (!ownsOperation(lease)) return false; return loadSession(session, lease); }),
    export: safe(async () => { const session = capture(); download(JSON.stringify(session), savedName.replace(/[^a-z0-9_-]+/gi, '-') + '.procgen.json', 'application/json'); status('Project exported.'); }),
    exportMidi() { download(exportProcgenMidi(ports.getRecording(), { bpm: transport.getState().bpm, beatsPerBar: project.transport?.timeSignature?.beats, beatUnit: project.transport?.timeSignature?.unit }), 'procgen-performance.mid', 'audio/midi'); status('Recorded performance exported.'); },
    new: safe(() => rebuild({ seed: freshProcgenSeed(window.crypto, project.procgen.seed), fresh: true })),
    reroll: safe(() => rebuild({ seed: freshProcgenSeed(window.crypto, project.procgen.seed) })),
    replay: safe(() => rebuild()), rebuild: safe(() => rebuild()), seed: safe(seed => rebuild({ seed: Number(seed) >>> 0 })),
    observe(patch) {
      state.observerMode = patch.mode ?? state.observerMode; state.observerLane = patch.laneId ?? state.observerLane; state.observerHold = patch.holdSeconds ?? state.observerHold;
      const render = renderer(), index = project.procgen.lanes.findIndex(lane => lane.id === state.observerLane);
      if (state.observerMode === 'overview') { if (render) render.followLaneIndex = null; render?.camera?.setZoom?.(render.camera.minimumScale()); }
      else if (state.observerMode === 'follow') { if (index >= 0) { state.firstLane = index; if (render) render.followLaneIndex = index; } render?.camera?.followFrontier?.(); view.render(); }
      else { render?.cctv?.setEnabled?.(true); render?.cctv?.setMode?.('director'); lastObserverAt = -Infinity; observeFrame(now()); }
      persist();
    }
  };
  view = createView({ document, window, getProject: () => project, getRuntime, dispatch, handlers, state });
  const unsubscribeProject = legacy.subscribeProject?.(next => { if (!disposed && !writingLegacy && next !== project) syncProject(next, { fromLegacy: true }); });
  if (unsubscribeProject) listeners.push(unsubscribeProject);
  const syncLegacyControls = () => {
    if (legacy.settings.speed !== lastLegacySpeed) { lastLegacySpeed = legacy.settings.speed; configureTransport({ gameSpeed: lastLegacySpeed }); persist(); }
    if (legacy.isPaused() === transport.getState().playing) { if (legacy.isPaused()) transport.pause(); else play(); }
  };
  for (const id of ['procgenPause', 'procgenSpeedUp', 'procgenSpeedDown', 'procgenSpeed', 'procgenSpeedReadout']) {
    const el = document.getElementById(id); listen(el, 'click', syncLegacyControls); listen(el, 'change', syncLegacyControls); listen(el, 'contextmenu', syncLegacyControls);
  }
  listen(document, 'keyup', syncLegacyControls);
  listen(window, 'pagehide', () => { persist(); recover(); });
  listen(document.getElementById('procgenPanic'), 'click', () => { ports.panic(); status('All notes stopped.'); });
  const disconnected = () => { outputEpoch++; ports.checkConnections(); view.renderInspector(); };
  const connected = () => { syncPorts(); view.renderInspector(); status('MIDI device connected. Press Play or send MIDI Start/Continue to resume.'); };
  window.WebMidi?.addListener?.('disconnected', disconnected);
  window.WebMidi?.addListener?.('connected', connected);
  listeners.push(() => window.WebMidi?.removeListener?.('disconnected', disconnected));
  listeners.push(() => window.WebMidi?.removeListener?.('connected', connected));
  prepareSettings(); setLegacyProject(project); legacy.setSpeed(transport.getState().gameSpeed); lastLegacySpeed = legacy.settings.speed; view.render(); view.transport(transport.getState());
  return { getProject: () => project, getLaneAssignments: () => project.procgen.lanes.map(lane => lane.family),
    getPlaybackState: () => ({ ...legacy.local.getState(), activeNotes: router()?.scheduler?._activeNotes?.size || 0, pendingNotes: router()?.scheduler?._pendingNoteOns?.size || 0, pressure: router()?.scheduler?.getOutputPressure?.() || ports.getState().pressure }),
    prepareSettings, bindRuntime, beforeRestart, loadSession, capture, recover, dispatch, play, handlers, state, transport, ports, engine,
    get settings() { return legacy.settings; },
    dispose() {
      if (disposed) return; disposed = true; loadSerial++; currentOperation?.controller.abort(); currentOperation = null; unhookRouter?.(); unhookWorld?.(); transport.dispose(); ports.dispose();
      if (recoveryTimer != null) window.clearTimeout?.(recoveryTimer);
      for (const remove of listeners) remove(); view.dispose(); Promise.resolve(storage.close?.()).catch(() => {});
    }
  };
}
