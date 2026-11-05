import { ProcgenLaneWorld } from '../../js/app/procgen/ProcgenLaneWorld.js';
import { captureProcgenCheckpoint } from '../../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { createProcgenWorkstation } from '../../js/app/procgen/workstation/ProcgenWorkstation.js';
import { createProcgenWorkstationProject } from '../../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createMidiProject } from '../../js/midi/project/MidiProject.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { backgroundJobService } from '../../js/app/resources/BackgroundJobService.js';
import { createTestBackgroundJobs } from './background-worker.js';

export function target() {
  const events = new Map();
  return { addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); }, emit(type, event = {}) { for (const fn of events.get(type) || []) fn(event); } };
}
export function setup({ lookaheadMs = 0, webMidi, historyBytesLimit, backend = 'synth', outputId = null, search = '', persisted = null, startupSettings = {}, storageOverride = null,
  laneCount = 1, windowTimers = {}, navigationType = 'navigate', backgroundJobs, worldFactory = null, physicalOnly = false, audio, getInstrumentCatalog, outputSubscribe, resourceBudget = null,
  workstationFactory = createProcgenWorkstation, prepareInspectionWorld = null } = {}) {
  let time = 0, paused = false, enabled = false;
  const elements = new Map(['procgenPause', 'procgenPanic', 'procgenSpeed', 'procgenSpeedUp', 'procgenSpeedDown', 'procgenSpeedReadout'].map(id => [id, target()]));
  const document = { ...target(), getElementById: id => elements.get(id) || null };
  const values = new Map(), stored = new Map(), calls = [], positions = [], statuses = [], storageReceipts = [], exportStates = [], restarts = [], captures = [];
  if (persisted) values.set('lemmings.procgen.workstation.v1', JSON.stringify(persisted));
  const window = { ...target(), ...windowTimers, WebMidi: webMidi, location: { search }, performance: { now: () => time, getEntriesByType: () => [{ type: navigationType }] }, localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    crypto: { getRandomValues(value) { value[0] = 91; } }, prompt: () => 'Test song' };
  const scheduler = { tickMs: 60, sendNote(spec, meta) { calls.push({ spec, meta }); return true; }, allNotesOff() {}, output: { channels: { 1: { sendControlChange() {} } } } };
  let throwCamera = false;
  const makeRuntime = () => ({ world: worldFactory ? worldFactory() : { laneCount, seed: 7, timer: { speedFactor: 1 }, frontiers: [100], soundEvents: { onEvent: new EventHandler(), onBatch: new EventHandler() } },
    lanes: { setClockDriven(value) { this.clockDriven = value; }, pump(value) { positions.push(value); }, renderer: { camera: { getState: () => ({ cameraX: 45 }), applyState(value) { if (throwCamera) throw new Error('Camera unavailable'); this.restored = value; } } } },
    view: { midiPreviewRouter: { scheduler, resetClock() {} }, setMidiPreviewRouter(value) { this.midiPreviewRouter = value; } } });
  let runtime = makeRuntime();
  let project = createProcgenWorkstationProject(createMidiProject(), { seed: 7, lanes: Array.from({ length: laneCount }, (_, index) => index || physicalOnly ? {} :
    { mode: 'pattern', patternPurpose: 'Complementary transport test fixture',
      patterns: [{ length: 4, steps: Array.from({ length: 4 }, () => ({ enabled: true, note: 60, duration: 1 })) }] }) });
  const projectListeners = new Set();
  let physicalOwner = null;
  const legacy = { settings: { seed: 7, speed: 1, laneCount, ...startupSettings }, getProject: () => project, setProject(value) { project = value; for (const listener of projectListeners) listener(value); },
    setPhysicalControlOwner(owner) { physicalOwner = owner; return () => { if (physicalOwner === owner) physicalOwner = null; }; },
    subscribeProject(listener) { projectListeners.add(listener); return () => projectListeners.delete(listener); },
    setPaused(value) { paused = value; }, isPaused: () => paused, setSpeed(value) { this.settings.speed = value; },
    local: { audio, getState: () => ({ enabled, selectedBackend: backend, outputId }), ...(outputSubscribe ? { subscribe: outputSubscribe } : {}) } };
  let viewProps;
  const view = { requestProjectName: async () => window.prompt(), render() {}, renderInspector() {}, transport() {}, recording() {}, status: value => statuses.push(value), storage: value => storageReceipts.push(value),
    exportState: (artifact, delivery) => exportStates.push({ artifact, delivery }), showProjects() {}, dispose() { this.disposed = true; } };
  let rejectSave = false, saveCalls = 0;
  const storage = storageOverride || { async save(id, session) { saveCalls++; if (rejectSave) throw new Error('Storage unavailable'); stored.set(id, session); }, async load(id) { return stored.get(id); }, async list() { return [...stored.keys()].map(id => ({ id })); }, close() {} };
  let rejectRestart = false, returnFalseRestart = false, restartGate = null;
  const midiJobs = createTestBackgroundJobs();
  const jobs = backgroundJobs || { compute: options => (options.kind === 'encode-recorded-midi' ? midiJobs : backgroundJobService).compute(options) };
  const studio = workstationFactory({ document, window, legacy, getRuntime: () => runtime,
    restart: async request => { restarts.push(request); if (!request.session) studio.prepareSettings(); if (restartGate) await restartGate; if (request.lease?.signal.aborted || returnFalseRestart) return false; if (rejectRestart) throw new Error('Assets unavailable'); runtime = makeRuntime(); runtime.world.laneCount = request.session?.world.laneCount || legacy.settings.laneCount; runtime.world.seed = request.session?.world.seed ?? legacy.settings.seed; },
    createView: props => { viewProps = props; return view; }, storage,
    captureCheckpoint: world => { captures.push(world); return world instanceof ProcgenLaneWorld ? captureProcgenCheckpoint(world) : { version: 2, laneCount: world.laneCount, seed: world.seed, clock: { ...world.timer } }; },
    getInstrumentCatalog, resourceBudget, prepareInspectionWorld, transportOptions: { driver: { start() {}, stop() {} }, lookaheadMs }, historyBytesLimit, backgroundJobs: jobs
  });
  const dispose = studio.dispose; studio.dispose = () => { const retirement = dispose(); retirement.completion.then(() => midiJobs.dispose()); return retirement; };
  return { studio, legacy, view, storage, calls, positions, statuses, storageReceipts, exportStates, restarts, stored, captures, elements, document, window, get runtime() { return runtime; }, get physicalOwner() { return physicalOwner; }, get viewProps() { return viewProps; }, get saveCalls() { return saveCalls; },
    enable() { enabled = true; }, time(value) { time = value; studio.transport.pump(); }, failRestart(value = true) { rejectRestart = value; }, cancelRestart() { returnFalseRestart = true; }, failSave() { rejectSave = true; }, allowSave() { rejectSave = false; },
    holdRestart() { let release; restartGate = new Promise(resolve => { release = resolve; }); return release; }, failCamera() { throwCamera = true; } };
}
