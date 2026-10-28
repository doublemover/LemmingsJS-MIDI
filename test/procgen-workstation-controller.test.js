import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { hashProcgenPhysicsCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpointProvenance.js';
import { nativeSoundCandidates, createSilentPreparationAudio } from './helpers/native-sound-candidates.js';
import { createProcgenWorkstation } from '../js/app/procgen/workstation/ProcgenWorkstation.js';
import { createProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createMidiProject } from '../js/midi/project/MidiProject.js';
import { EventHandler } from '../js/util/EventHandler.js';
import { createProcgenRetirementScope } from '../js/app/procgen/ProcgenRetirement.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { createProcgenCausalJournal } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { backgroundJobService } from '../js/app/resources/BackgroundJobService.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';

function target() {
  const events = new Map();
  return { addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); }, emit(type, event = {}) { for (const fn of events.get(type) || []) fn(event); } };
}
function setup({ lookaheadMs = 0, webMidi, historyBytesLimit, backend = 'synth', outputId = null, search = '', persisted = null, startupSettings = {}, storageOverride = null,
  laneCount = 1, windowTimers = {}, backgroundJobs, worldFactory = null, physicalOnly = false, audio, getInstrumentCatalog, outputSubscribe, resourceBudget = null } = {}) {
  let time = 0, paused = false, enabled = false;
  const elements = new Map(['procgenPause', 'procgenPanic', 'procgenSpeed', 'procgenSpeedUp', 'procgenSpeedDown', 'procgenSpeedReadout'].map(id => [id, target()]));
  const document = { ...target(), getElementById: id => elements.get(id) || null };
  const values = new Map(), stored = new Map(), calls = [], positions = [], statuses = [], storageReceipts = [], exportStates = [], restarts = [], captures = [];
  if (persisted) values.set('lemmings.procgen.workstation.v1', JSON.stringify(persisted));
  const window = { ...target(), ...windowTimers, WebMidi: webMidi, location: { search }, performance: { now: () => time }, localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
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
  const studio = createProcgenWorkstation({ document, window, legacy, getRuntime: () => runtime,
    restart: async request => { restarts.push(request); if (!request.session) studio.prepareSettings(); if (restartGate) await restartGate; if (request.lease?.signal.aborted || returnFalseRestart) return false; if (rejectRestart) throw new Error('Assets unavailable'); runtime = makeRuntime(); runtime.world.laneCount = request.session?.world.laneCount || legacy.settings.laneCount; runtime.world.seed = request.session?.world.seed ?? legacy.settings.seed; },
    createView: props => { viewProps = props; return view; }, storage,
    captureCheckpoint: world => { captures.push(world); return world instanceof ProcgenLaneWorld ? captureProcgenCheckpoint(world) : { version: 2, laneCount: world.laneCount, seed: world.seed, clock: { ...world.timer } }; },
    getInstrumentCatalog, resourceBudget, transportOptions: { driver: { start() {}, stop() {} }, lookaheadMs }, historyBytesLimit, backgroundJobs: jobs
  });
  const dispose = studio.dispose; studio.dispose = () => { const retirement = dispose(); retirement.completion.then(() => midiJobs.dispose()); return retirement; };
  return { studio, legacy, view, storage, calls, positions, statuses, storageReceipts, exportStates, restarts, stored, captures, elements, document, window, get runtime() { return runtime; }, get physicalOwner() { return physicalOwner; }, get viewProps() { return viewProps; }, get saveCalls() { return saveCalls; },
    enable() { enabled = true; }, time(value) { time = value; studio.transport.pump(); }, failRestart(value = true) { rejectRestart = value; }, cancelRestart() { returnFalseRestart = true; }, failSave() { rejectSave = true; }, allowSave() { rejectSave = false; },
    holdRestart() { let release; restartGate = new Promise(resolve => { release = resolve; }); return release; }, failCamera() { throwCamera = true; } };
}

describe('ProcGen workstation orchestration', () => {
  it('retains a stopped MIDI prefix across New/load, refuses concatenation and clears only on an explicit action', async () => {
    const f = setup(); f.studio.bindRuntime();
    try {
      expect(f.studio.handlers.record(true)).to.equal(true); expect(f.studio.handlers.clearMidiRecording()).to.equal(false);
      f.studio.ports.recordOutput({ note: 60, timeMs: 0, durationMs: 50 }, { beat: 0 }); f.time(100); f.studio.handlers.record(false);
      const session = f.studio.capture(), retained = JSON.stringify(f.studio.ports.getRecording()), origin = f.studio.getMidiRecordingState().recordingOrigin;
      const source = f.studio.ports.createRecordingExportSource(), originalId = source.id; source.release();
      expect(await f.studio.handlers.new()).to.equal(true);
      expect(f.studio.getMidiRecordingState()).to.include({ recording: false, foreignRecording: true });
      expect(f.studio.handlers.record(true)).to.equal(false); expect(f.statuses.at(-1)).to.include('earlier project state');
      expect(JSON.stringify(f.studio.ports.getRecording())).to.equal(retained);
      expect(await f.studio.loadSession(session)).to.equal(true); expect(f.studio.getMidiRecordingState().recordingOrigin).to.equal(origin);
      expect(f.studio.handlers.record(true)).to.equal(false); expect(JSON.stringify(f.studio.ports.getRecording())).to.equal(retained);
      await f.studio.handlers.exportMidi(); const artifact = f.studio.getExportState().artifact; expect(artifact.immutableSourceRef).to.include(originalId);
      expect(f.studio.handlers.clearMidiRecording()).to.equal(true); expect(f.studio.getMidiRecordingState()).to.include({ foreignRecording: false, recordedEvents: 0, recordingOrigin: null });
      expect(f.studio.getExportState().artifact).to.include({ artifactId: artifact.artifactId, retained: true });
      expect(f.studio.handlers.record(true)).to.equal(true); expect(f.studio.ports.getRecording()).to.have.length(1);
      const next = f.studio.ports.createRecordingExportSource(); expect(next.id).not.to.equal(originalId); next.release();
    } finally { await f.studio.dispose().completion; }
  });
  for (const transition of ['New', 'load']) it('finalizes an armed MIDI recording at successful ' + transition + ' without forging a later input release', async () => {
    const f = setup(); f.studio.bindRuntime();
    try {
      const session = f.studio.capture();
      f.studio.handlers.record(true); f.studio.ports.receiveMidi([0x90, 60, 90], 0);
      expect(await (transition === 'New' ? f.studio.handlers.new() : f.studio.loadSession(session))).to.equal(true);
      expect(f.studio.getMidiRecordingState()).to.include({ recording: false, foreignRecording: true, recordingComplete: false });
      expect(f.studio.getMidiRecordingState().incompleteReasons).to.include('open-notes-at-stop');
      const before = JSON.stringify(f.studio.ports.getRecording()); f.studio.ports.receiveMidi([0x80, 60, 0], 100);
      expect(JSON.stringify(f.studio.ports.getRecording())).to.equal(before);
      expect(f.studio.ports.getRecording().filter(event => event.direction === 'input').map(event => event.data)).to.deep.equal([[0x90, 60, 90]]);
    } finally { await f.studio.dispose().completion; }
  });
  it('keeps the current recording owner when a fresh document fails before publication', async () => {
    const f = setup(); f.studio.bindRuntime();
    try {
      f.studio.handlers.record(true); f.studio.ports.recordEvent({ type: 'cc', controller: 74, value: 40, timestamp: 0, beat: 0 }); f.failRestart();
      expect(await f.studio.handlers.new()).to.equal(false); expect(f.studio.getMidiRecordingState()).to.include({ recording: true, foreignRecording: false });
    } finally { await f.studio.dispose().completion; }
  });
  it('keeps recording disarmed and reports index admission pressure, then retries after resources return', async () => {
    const budget = createResourceBudget(), f = setup({ resourceBudget: budget }), token = {};
    const before = budget.diagnostics(); budget.reserve({ token, owner: 'recording-pressure-fixture', bytes: before.limitBytes - before.accountedBytes });
    try {
      expect(f.studio.handlers.record(true)).to.equal(false); expect(f.studio.ports.getState().recording).to.equal(false);
      expect(f.statuses.at(-1)).to.include('MIDI recording not started:'); expect(f.studio.ports.getRecording()).to.have.length(0);
      expect(f.studio.ports.getRecordingIndexState().typedBytes).to.equal(0);
      budget.release({ token, owner: 'recording-pressure-fixture' });
      expect(f.studio.handlers.record(true)).to.equal(true); expect(f.studio.ports.getRecording()).to.have.length(1);
      expect(f.studio.handlers.record(false)).to.equal(false); f.studio.ports.clearRecording();
      expect(budget.diagnostics().accountedBytes).to.equal(before.accountedBytes);
    } finally { await f.studio.dispose().completion; }
    expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('rearms the reviewed default MIDI route only on an explicit activation edge', async () => {
    let notify, current = { selectedBackend: 'midi', enabled: false, outputId: 'output:reviewed' };
    const f = setup({ backend: 'midi', outputId: current.outputId, outputSubscribe: listener => { notify = listener; return () => {}; } }), calls = [];
    f.legacy.local.getState = () => current; f.studio.ports.setNoteOutput = (port, options) => calls.push({ port, rearm: options?.rearm === true });
    try {
      current = { ...current, enabled: true }; notify(current); expect(calls.at(-1).rearm).to.equal(true); const count = calls.length;
      notify({ ...current, discoveredOutputCount: 2 }); expect(calls).to.have.length(count);
      current = { ...current, enabled: false }; notify(current); expect(calls.at(-1).rearm).to.equal(false);
      current = { ...current, enabled: true }; notify(current); expect(calls.at(-1).rearm).to.equal(true);
    } finally { await f.studio.dispose().completion; }
  });
  it('expresses measured simulation rate against the base tick duration rather than its requested speed-scaled interval', async () => {
    const f = setup();
    try {
      f.runtime.world.generation = 1; Object.assign(f.runtime.world.timer, { speedFactor: 3, frameTime: 20, TIME_PER_FRAME_MS: 60 }); f.legacy.settings.speed = 3;
      f.legacy.getOperationalMetrics = () => ({ generation: 1, achievedTicksPerSecond: 50, observedAt: 1000 });
      const snapshot = f.studio.getOperationalSnapshot(); expect(snapshot.simulation).to.include({ requestedSpeed: 3, achievedTicksPerSecond: 50, tickDurationMs: 60 });
      expect(snapshot.simulation.achievedTicksPerSecond * snapshot.simulation.tickDurationMs / 1000).to.equal(3);
    } finally { await f.studio.dispose().completion; }
  });
  it('retains exact MIDI expression requests across unrelated project edits and invalidates channel/document targets', async () => {
    const f = setup(); const laneId = f.studio.getProject().procgen.lanes[0].id, events = [];
    f.studio.ports.sendEvent = event => { events.push(event); return true; };
    try {
      const input = { type: 'sustain', laneId, channel: 1, outputId: null }, initial = f.studio.handlers.expressionState(input);
      expect(initial.requestedValue).to.equal(null); expect(f.studio.handlers.expression({ ...input, value: 127, targetKey: initial.targetKey })).to.equal(true);
      f.studio.dispatch({ type: 'procgen/lane', laneId, patch: { name: 'Same expression owner' } });
      expect(f.studio.handlers.expressionState(input)).to.include({ requestedValue: 127, submittedValue: 127, receiverValue: null });
      f.studio.dispatch({ type: 'procgen/lane', laneId, patch: { channel: 2 } });
      expect(f.studio.handlers.expression({ ...input, value: 0, targetKey: initial.targetKey })).to.equal(false); expect(events).to.have.length(1);
      const nextInput = { ...input, channel: 2 }, next = f.studio.handlers.expressionState(nextInput); expect(next.requestedValue).to.equal(null);
      f.studio.handlers.expression({ ...nextInput, targetKey: next.targetKey, value: 64 }); expect(events).to.have.length(2);
      await f.studio.handlers.new(); expect(f.studio.handlers.expression({ ...input, targetKey: initial.targetKey, value: 0 })).to.equal(false); expect(events).to.have.length(2);
      expect(f.studio.handlers.expressionState(input).requestedValue).to.equal(null);
    } finally { await f.studio.dispose().completion; }
  });
  it('keeps unconfirmed MIDI submission distinct from a prior submitted request and makes Stage queries read-only', async () => {
    const f = setup(); let sends = 0;
    f.studio.ports.sendEvent = () => ++sends === 1;
    try {
      const input = { type: 'sustain' }; f.studio.handlers.expression({ ...input, value: 127 }); f.studio.handlers.expression({ ...input, value: 0 });
      expect(f.studio.handlers.expressionState(input)).to.include({ requestedValue: 0, submittedValue: 127, receiverValue: null, delivery: 'unconfirmed' });
      await f.studio.handlers.stage(); expect(f.studio.handlers.expressionState(input).canRequest).to.equal(false);
      expect(f.studio.handlers.expression({ ...input, value: 64 })).to.equal(false); expect(sends).to.equal(2);
    } finally { await f.studio.dispose().completion; }
  });
  it('binds failed initial-world recovery to the existing Start fresh owner and ignores failure after successful publication', async () => {
    const f = setup(); let starts = 0;
    try {
      f.elements.set('procgenStartupFresh', { click() { starts++; } }); expect(f.studio.reportStartupFailure(new Error('Asset unavailable'))).to.equal(true);
      const failed = f.studio.getOperationalSnapshot(); expect(failed.simulation.state).to.equal('failed'); expect(failed.recoveryAction.id).to.equal('startup-fresh');
      expect(await f.studio.handlers.recoverOperational('startup-fresh', failed.identity)).to.equal(true); expect(starts).to.equal(1);
      f.studio.bindRuntime(); expect(f.studio.getOperationalSnapshot().simulation.state).not.to.equal('failed'); expect(f.studio.reportStartupFailure(new Error('late'))).to.equal(false);
      expect(await f.studio.handlers.recoverOperational('startup-fresh', failed.identity)).to.equal(false); expect(starts).to.equal(1);
    } finally { await f.studio.dispose().completion; }
  });
  it('keeps UI edit ownership through the first durable Save and advances it only on logical document replacement', async () => {
    const f = setup({ storageOverride: { async saveDocument(id, revision) { return { id, revision: revision + 1 }; }, close() {} } });
    try {
      const identity = f.viewProps.getDocumentIdentity(); await f.studio.handlers.save(); expect(f.studio.getDocumentState().id).to.be.a('string');
      expect(f.viewProps.getDocumentIdentity()).to.equal(identity); await f.studio.handlers.new(); expect(f.viewProps.getDocumentIdentity()).not.to.equal(identity);
    } finally { await f.studio.dispose().completion; }
  });
  it('retains a current save blocker across ordinary updates and clears it only after a current successful Save', async () => {
    const f = setup();
    try {
      f.failSave(); await f.studio.handlers.save(); expect(f.studio.getOperationalSnapshot().blockedReason.code).to.equal('storage-error');
      f.studio.handlers.transport({ baseBpm: 150, bpm: 150 }); expect(f.storageReceipts.at(-1).error.message).to.equal('Storage unavailable');
      expect(f.studio.getOperationalSnapshot().blockedReason.code).to.equal('storage-error');
      f.allowSave(); await f.studio.handlers.save(); expect(f.studio.getOperationalSnapshot().blockedReason.code).not.to.equal('storage-error');
    } finally { await f.studio.dispose().completion; }
  });
  it('permits read-only operational queries in Stage while refusing route activation and stale recovery actions', async () => {
    const f = setup({ backend: 'midi', outputId: 'chosen' });
    try {
      await f.studio.handlers.stage(); const messages = f.statuses.length, state = f.studio.handlers.operationalState();
      expect(f.statuses).to.have.length(messages); expect(f.physicalOwner.canActivateOutput()).to.equal(false); expect(state.recoveryAction.id).to.equal('exit-stage');
      expect(await f.studio.handlers.recoverOperational('exit-stage', state.identity)).not.to.equal(false);
      expect(f.physicalOwner.canActivateOutput()).to.equal(true); expect(await f.studio.handlers.recoverOperational('exit-stage', state.identity)).to.equal(false);
    } finally { await f.studio.dispose().completion; }
  });
  it('invalidates paused operational evidence when controller visibility changes independently of output or clock', async () => {
    const f = setup(); let refreshes = 0;
    try {
      f.studio.transport.pause(); f.view.refreshOperational = () => refreshes++;
      f.studio.ports.setInput({ id: 'controller', state: 'connected', addListener() {}, removeListener() {} });
      const before = refreshes; f.studio.ports.configure({ activeSensingVisibility: 'filtered' }); expect(refreshes).to.be.greaterThan(before);
      const current = f.studio.getOperationalSnapshot(); expect(current.controller).to.include({ connected: true, liveness: 'unavailable' });
      expect(current.blockedReason.code).to.equal('controller-observation'); expect(current.clockAuthority.state).to.equal('internal'); expect(current.transport.state).to.equal('stopped');
    } finally { await f.studio.dispose().completion; }
  });
  it('reports an actual timer hold as a paused world even while musical play remains requested', async () => {
    const f = setup();
    try {
      f.runtime.world.timer.speedFactor = 0; expect(f.legacy.isPaused()).to.equal(false);
      expect(f.studio.getOperationalSnapshot().simulation.state).to.equal('paused');
      f.runtime.world.timer.speedFactor = 3; expect(f.studio.getOperationalSnapshot().simulation.state).to.equal('running');
      f.runtime.lanes.getOperationalState = () => ({ paused: true }); expect(f.studio.getOperationalSnapshot().simulation.state).to.equal('paused');
    } finally { await f.studio.dispose().completion; }
  });
  it('prepares a reviewed project checkpoint without requesting a download or enabling output', async () => {
    let releases = 0;
    const f = setup({ backgroundJobs: { async compute(options) {
      options.signal.throwIfAborted(); const snapshot = await options.prepareInput();
      return { value: new TextEncoder().encode(JSON.stringify(snapshot)), release() { releases++; } };
    } } });
    const source = f.physicalOwner.getShareExportDescriptor(); expect(source).to.include({ kind: 'project', available: true });
    expect(source.scope).to.include('does not contain a recorded causal take');
    const artifact = await f.physicalOwner.prepareShareExport(source);
    expect(artifact).to.include({ retained: true, formatVersion: 'procgen-session/v1' });
    expect(f.studio.getExportState().delivery).to.equal(null); expect(f.legacy.local.getState().enabled).to.equal(false); expect(releases).to.equal(1);
    let reveals = 0; f.view.revealPreparedExport = () => { reveals++; }; f.physicalOwner.revealPreparedExport(); expect(reveals).to.equal(1);
    await f.studio.dispose().completion; expect(f.physicalOwner).to.equal(null);
  });
  it('refuses changed and already canceled share sources before capturing or admitting a job', async () => {
    let jobs = 0; const f = setup({ backgroundJobs: { async compute() { jobs++; throw new Error('unexpected job'); } } });
    const source = f.physicalOwner.getShareExportDescriptor(); f.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.25 } });
    expect(() => f.physicalOwner.prepareShareExport(source)).to.throw('reviewed performance source changed');
    const controller = new AbortController(); controller.abort();
    expect(() => f.physicalOwner.prepareShareExport(f.physicalOwner.getShareExportDescriptor(), { signal: controller.signal })).to.throw();
    expect(jobs).to.equal(0); expect(f.captures).to.have.length(0); await f.studio.dispose().completion;
  });
  it('cancels an owned share job and retires its returned bytes without publishing them', async () => {
    let complete, signal, releases = 0; const started = new Promise(resolve => { complete = resolve; });
    const f = setup({ backgroundJobs: { async compute(options) { signal = options.signal; await started; return { value: new Uint8Array([1]), release() { releases++; } }; } } });
    const controller = new AbortController(), pending = f.physicalOwner.prepareShareExport(f.physicalOwner.getShareExportDescriptor(), { signal: controller.signal });
    expect(f.physicalOwner.getShareExportDescriptor().available).to.equal(false); controller.abort(); expect(signal.aborted).to.equal(true); complete();
    expect(await pending).to.equal(null); expect(f.studio.getExportState().artifact).to.equal(null); expect(releases).to.equal(1);
    expect(f.physicalOwner.getShareExportDescriptor().available).to.equal(true); await f.studio.dispose().completion;
  });
  it('does not let an older project preparation replace a newer prepared MIDI artifact', async () => {
    let complete, releases = 0; const gate = new Promise(resolve => { complete = resolve; });
    const jobs = createTestBackgroundJobs();
    const f = setup({ backgroundJobs: { async compute(options) { if (options.kind === 'encode-recorded-midi') return jobs.compute(options); await gate; return { value: new Uint8Array([1]), release() { releases++; } }; } } });
    const pending = f.physicalOwner.prepareShareExport(f.physicalOwner.getShareExportDescriptor());
    await f.studio.handlers.exportMidi(); const midi = f.studio.getExportState().artifact; expect(midi.formatVersion).to.equal('smf1/v1'); complete();
    expect(await pending).to.equal(null); expect(f.studio.getExportState().artifact.artifactId).to.equal(midi.artifactId); expect(releases).to.equal(1); await f.studio.dispose().completion; jobs.dispose();
  });
  it('keeps freshly admitted pattern voices after seeking away a paused resume boundary', async () => {
    const f = setup({ lookaheadMs: 80 }); f.studio.bindRuntime(); f.enable();
    f.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { mode: 'pattern', patternPurpose: 'A held phrase across the paused seek boundary' } });
    f.studio.dispatch({ type: 'procgen/pattern', laneId: 'lane-1', slot: 0,
      patch: { length: 16, steps: Array.from({ length: 16 }, (_, index) => ({ enabled: index === 0, note: 60, duration: 8 })) } });
    f.studio.transport.pause(); f.studio.transport.seek(0);
    f.studio.play(); expect(f.studio.engine.snapshot().active).to.have.length(1);
    f.studio.transport.pause(); f.studio.transport.seek(0);
    expect(f.studio.engine.snapshot().active).to.have.length(0);
    f.studio.play(); expect(f.studio.engine.snapshot().active).to.have.length(1);
    expect(f.calls).to.have.length(2);
    await f.studio.dispose().completion;
  });
  it('projects command readiness from canonical history and Stage policy without status side effects', async () => {
    const f = setup(); f.studio.bindRuntime();
    try {
      expect(f.viewProps.canCommand('undo')).to.equal(false); expect(f.viewProps.canCommand('redo')).to.equal(false);
      expect(f.viewProps.canCommand('copy')).to.equal(true); expect(f.viewProps.canCommand('paste')).to.equal(false); f.studio.handlers.copy(); expect(f.viewProps.canCommand('paste')).to.equal(true);
      f.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.5 } }); expect(f.viewProps.canCommand('undo')).to.equal(true);
      await f.studio.handlers.stage(); const messages = f.statuses.length;
      expect(f.viewProps.canCommand('undo')).to.equal(false); expect(f.viewProps.canCommand('import')).to.equal(false); expect(f.viewProps.canCommand('panicOutput')).to.equal(true);
      expect(f.physicalOwner.canShortcut('restartLevel')).to.equal(false); expect(f.physicalOwner.canShortcut('nuke')).to.equal(false); expect(f.physicalOwner.canShortcut('nukeInstant')).to.equal(false); expect(f.physicalOwner.nuke(null)).to.equal(false); expect(f.physicalOwner.canShortcut('togglePause')).to.equal(true);
      expect(f.statuses).to.have.length(messages); await f.studio.handlers.stageExit(); expect(f.viewProps.canCommand('undo')).to.equal(true);
      await f.studio.handlers.undo(); expect(f.viewProps.canCommand('redo')).to.equal(true);
    } finally { await f.studio.dispose().completion; }
  });
  it('renders canonical Redo when its stored change has no current reducer action', async () => {
    const f = setup(); f.studio.bindRuntime(); let renders = 0; const patches = [];
    f.view.render = () => { renders++; }; f.view.patchProject = action => { patches.push(action); };
    f.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.25 } });
    expect(patches).to.have.length(1); expect(patches[0].type).to.equal('procgen/lane');
    await f.studio.handlers.undo(); expect(f.studio.getProject().procgen.lanes[0].gain).to.equal(1);
    const beforeRedo = renders;
    await f.studio.handlers.redo(); expect(f.studio.getProject().procgen.lanes[0].gain).to.equal(0.25);
    expect(renders).to.be.greaterThan(beforeRedo); expect(patches.every(Boolean)).to.equal(true);
    await f.studio.dispose().completion;
  });
  it('authorizes the selected physical note route after asynchronous MIDI activation and retires its subscription', async () => {
    let notify, retired = 0, refreshes = 0;
    const output = { id: 'physical-state-route', state: 'connected', channels: { 1: { sendControlChange() {}, sendNoteOn() {}, sendNoteOff() {} } } };
    const f = setup({ backend: 'midi', outputId: output.id, webMidi: { outputs: [output], inputs: [] }, outputSubscribe: listener => { notify = listener; return () => retired++; } });
    f.view.refreshOperational = () => refreshes++;
    f.studio.bindRuntime(); expect(f.studio.ports.getNoteRoute().status).to.equal('rejected');
    f.enable(); notify(); expect(f.studio.ports.getNoteRoute()).to.include({ status: 'accepted', outputId: output.id, ownedVoices: true });
    expect(refreshes).to.be.greaterThan(0); const beforeUnchanged = refreshes; notify(); expect(refreshes).to.equal(beforeUnchanged + 1);
    await f.studio.dispose().completion; expect(retired).to.equal(1); const afterDispose = refreshes; notify(); expect(refreshes).to.equal(afterDispose); expect(f.studio.ports.getNoteRoute().status).to.equal('rejected');
  });
  it('records explicit MPE policy changes in the project and restores them through undo', async () => {
    const f = setup(); f.studio.bindRuntime(); const world = f.runtime.world;
    f.studio.dispatch({ type: 'procgen/global', patch: { mpe: { enabled: true, masterChannel: 1, memberChannels: [2], voicePolicy: 'reject', configuration: 'manual' } } });
    f.studio.handlers.midiRoutePolicy('steal-oldest');
    expect(f.studio.getProject().global.mpe).to.include({ enabled: true, voicePolicy: 'steal-oldest' });
    f.studio.handlers.midiRoutePolicy('send-zone'); expect(f.studio.getProject().global.mpe.configuration).to.equal('send-zone');
    f.studio.handlers.midiRoutePolicy('shared'); expect(f.studio.getProject().global.mpe.enabled).to.equal(false);
    await f.studio.handlers.undo(); expect(f.studio.getProject().global.mpe).to.include({ enabled: true, configuration: 'send-zone' });
    await f.studio.handlers.undo(); expect(f.studio.getProject().global.mpe.configuration).to.equal('manual');
    await f.studio.handlers.undo(); expect(f.studio.getProject().global.mpe.voicePolicy).to.equal('reject');
    const project = f.studio.getProject(); f.studio.handlers.midiRoutePolicy('automatic-master');
    expect(f.studio.getProject()).to.equal(project); expect(f.statuses.at(-1)).to.include('Unknown MIDI expression policy');
    expect(f.runtime.world).to.equal(world); expect(f.restarts).to.have.length(0);
    expect(f.studio.handlers.midiRouteState()).to.have.property('outputRoutes');
    expect(f.studio.handlers.outputState().selectedBackend).to.equal('synth'); await f.studio.dispose().completion;
  });
  it('preserves a real 1000-tick physical trace across six prepared renderer changes with the pattern path disabled', async function() {
    this.timeout(60000); const masks = await loadProcgenMasks(), { candidates, descriptors } = await nativeSoundCandidates();
    const create = () => setup({ physicalOnly: true, worldFactory: () => new ProcgenLaneWorld({ masks, seed: 7, laneCount: 1, assists: false, maxActors: 64 }),
      audio: createSilentPreparationAudio(), getInstrumentCatalog: async () => ({ descriptors }) });
    const control = create(), changed = create(), left = [], right = [];
    try {
      control.studio.bindRuntime(); changed.studio.bindRuntime(); control.studio.transport.play(); changed.studio.transport.play();
      control.runtime.world.soundEvents.onBatch.on(batch => left.push(batch)); changed.runtime.world.soundEvents.onBatch.on(batch => right.push(batch));
      const identity = changed.runtime.world, actors = changed.runtime.world.actors.map(actor => actor.id);
      for (let tick = 0; tick < 1000; tick++) {
        if (tick % 150 === 0 && tick < 900) {
          const before = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(changed.runtime.world));
          await changed.studio.handlers.applyInstalledInstrument(candidates[tick / 150]);
          expect(await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(changed.runtime.world))).to.equal(before);
        }
        control.runtime.world.step(tick * 16); changed.runtime.world.step(tick * 16);
        if ((tick + 1) % 200 === 0) expect(await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(changed.runtime.world))).to.equal(await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(control.runtime.world)));
      }
      expect(right).to.deep.equal(left); expect(changed.runtime.world).to.equal(identity); expect(changed.restarts).to.have.length(0);
      expect(changed.studio.getProject().procgen.lanes.every(lane => lane.mode === 'physical' && lane.patterns.length === 0)).to.equal(true);
      expect(actors).to.have.length.greaterThan(0); const beforeUndo = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(changed.runtime.world));
      await changed.studio.handlers.undo(); expect(await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(changed.runtime.world))).to.equal(beforeUndo); expect(changed.restarts).to.have.length(0);
    } finally { await control.studio.dispose().completion; await changed.studio.dispose().completion; control.runtime.world.dispose(); changed.runtime.world.dispose(); }
  });
  it('owns shared macro gestures while paused, commits one undo entry and never replaces the physical world', async () => {
    const { candidates, descriptors } = await nativeSoundCandidates();
    const f = setup({ physicalOnly: true, audio: createSilentPreparationAudio(), getInstrumentCatalog: async () => ({ descriptors }) });
    try {
      f.studio.bindRuntime(); await f.studio.handlers.applyInstalledInstrument(candidates[1]);
      const lane = f.studio.getProject().procgen.lanes[0], macro = lane.instrumentRef.definition.macros[0], world = f.runtime.world;
      const first = f.studio.handlers.beginMacroGesture(lane.id, macro.id, { momentary: true });
      f.studio.handlers.previewMacroGesture(first, 0.8); f.studio.handlers.finishMacroGesture(first);
      expect(f.studio.getProject().procgen.lanes[0]).to.equal(lane);
      const second = f.studio.handlers.beginMacroGesture(lane.id, macro.id);
      for (const value of [0.1, 0.9, 0.375]) f.studio.handlers.previewMacroGesture(second, value);
      f.studio.handlers.finishMacroGesture(second); expect(f.studio.getProject().procgen.lanes[0].instrumentControls.macros[macro.id]).to.equal(0.375);
      await f.studio.handlers.undo(); expect(f.studio.getProject().procgen.lanes[0].instrumentControls).to.deep.equal(lane.instrumentControls);
      expect(f.runtime.world).to.equal(world); expect(f.restarts).to.have.length(0); expect(f.calls).to.have.length(0);
    } finally { await f.studio.dispose().completion; }
  });
  it('warns about conflicting hardware programs without changing native sound or silently reassigning channels', () => {
    const f = setup({ laneCount: 2 }); f.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { channel: 7, externalProgram: 20 } });
    f.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-2', patch: { channel: 7, externalProgram: 60 } });
    expect(f.statuses.some(message => message.includes('External program/bank/percussion mapping conflicts'))).to.equal(true);
    expect(f.studio.getProject().procgen.lanes.map(lane => lane.channel)).to.deep.equal([7, 7]); expect(f.restarts).to.have.length(0); f.studio.dispose();
  });
  it('keeps sound aliases, hardware mapping and their Undo independent of world replacement', async () => {
    const f = setup(); f.studio.bindRuntime(); const world = f.runtime.world, theme = f.studio.getProject().procgen.lanes[0].worldThemeId;
    f.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { externalProgram: 67, channel: 4, pan: 21 } });
    for (const family of ['rock', 'snow', 'bubble', 'fire', 'dirt', 'pillar']) f.studio.dispatch({ type: 'procgen/palette', laneId: 'lane-1', family });
    expect(f.runtime.world).to.equal(world); expect(f.restarts).to.have.length(0); expect(f.studio.getLaneAssignments()).to.deep.equal([theme]);
    expect(f.studio.getProject().procgen.lanes[0]).to.include({ family: 'pillar', worldThemeId: theme, externalProgram: 67, channel: 4, pan: 21 });
    await f.studio.handlers.undo(); expect(f.studio.getProject().procgen.lanes[0].family).to.equal('dirt'); expect(f.runtime.world).to.equal(world); expect(f.restarts).to.have.length(0);
    await f.studio.handlers.redo(); expect(f.studio.getProject().procgen.lanes[0].family).to.equal('pillar'); expect(f.restarts).to.have.length(0);
    await f.studio.handlers.applyMatchingWorld('lane-1'); expect(f.restarts).to.have.length(1); expect(f.studio.getLaneAssignments()).to.deep.equal(['pillar']); f.studio.dispose();
  });
  it('cancels an externally retired document source before its candidate can publish', async () => {
    const f = setup(); f.studio.bindRuntime(); const session = f.studio.capture(), previous = f.runtime, source = new AbortController();
    const release = f.holdRestart(), pending = f.studio.loadSession(session, null, { signal: source.signal });
    await Promise.resolve(); source.abort(); release(); expect(await pending).to.equal(false);
    expect(f.runtime).to.equal(previous); f.studio.dispose();
  });
  it('records committed physical batches into a durable take and closes it before world replacement', async () => {
    const memory = createMemoryCausalStore(), storage = { ...memory.storage, close() {} };
    const f = setup({ storageOverride: storage });
    f.studio.bindRuntime();
    const armed = await f.studio.handlers.startCausalTake();
    expect(armed).to.include({ state: 'recording', durableSequence: 0 });
    const takeId = armed.takeId;
    f.runtime.world.soundEvents.onBatch.trigger({ version: 1, worldId: 'world:fixture', generation: 1, tick: 1,
      batchId: 'world:fixture:1:1:0', sourceTimeMs: 20, tickDurationMs: 20,
      completeness: { status: 'complete', dropped: 0 }, facts: [] });
    const receipt = await f.studio.stopCausalTake({ reason: 'test-stop' });
    expect(receipt).to.include({ takeId, complete: true, durableSequence: 4 });
    const journal = createProcgenCausalJournal({ storage });
    const records = await journal.query({ takeId });
    expect(records.records.map(record => record.kind)).to.deep.equal(['input-observation', 'input-observation', 'physical-batch', 'musical-intents']);
    expect((await journal.verify(takeId)).status).to.equal('complete');
    const score = await f.studio.handlers.readPhysicalScore();
    expect(score).to.include({ takeId, generation: 1, timeDomain: 'physical-source-time' });
    expect(score.counts.physicalBatches).to.equal(1);
    await f.studio.dispose().completion;
  });
  it('records graph edit, Undo and Redo as fresh monotonic mappings without replacing the world', async () => {
    const masks = await loadProcgenMasks(), memory = createMemoryCausalStore(), storage = { ...memory.storage, close() {} };
    const f = setup({ storageOverride: storage, physicalOnly: true, worldFactory: () => new ProcgenLaneWorld({ masks, assists: false, seed: 7, laneCount: 1 }) });
    f.studio.bindRuntime(); const world = f.runtime.world;
    try {
      const armed = await f.studio.handlers.startCausalTake(); expect(armed, f.statuses.join(' | ')).to.include({ state: 'recording' });
      const takeId = armed.takeId, before = f.studio.getProject().procgen.physicalGraph;
      const graph = { ...before, revision: before.revision + 1, pickups: [{ id: 'recorded-gate', geometry: { kind: 'segment', points: [{ x: 120, y: 0 }, { x: 120, y: 32 }] } }] };
      f.studio.dispatch({ type: 'procgen/physicalGraph', graph });
      expect(world.physicalAuthoring.graph.pickups[0].id).to.equal('recorded-gate');
      expect(await f.studio.handlers.undo()).to.equal(true); expect(world.physicalAuthoring.graph.pickups || []).to.have.length(0);
      expect(await f.studio.handlers.redo()).to.equal(true); expect(world.physicalAuthoring.graph.pickups[0].id).to.equal('recorded-gate');
      expect(world.physicalAuthoring.graph.revision).to.equal(before.revision + 3); expect(f.runtime.world).to.equal(world);
      const stopped = await f.studio.stopCausalTake({ reason: 'history-mapping-matrix' }); expect(stopped.complete).to.equal(true);
      const journal = createProcgenCausalJournal({ storage }), result = await journal.query({ takeId }), mappings = result.records.filter(record => record.kind === 'mapping');
      expect(mappings.map(record => record.payload.revision)).to.deep.equal([before.revision + 1, before.revision + 2, before.revision + 3]);
      expect(mappings.map(record => record.payload.pickups?.length || 0)).to.deep.equal([1, 0, 1]); expect((await journal.verify(takeId)).status).to.equal('complete');
    } finally { await f.studio.dispose().completion; world.dispose(); }
  });

  it('marks failed physical batch processing as partial instead of certifying an empty performance', async () => {
    const memory = createMemoryCausalStore(), storage = { ...memory.storage, close() {} };
    const f = setup({ storageOverride: storage }); f.studio.bindRuntime();
    const takeId = (await f.studio.handlers.startCausalTake()).takeId;
    f.runtime.world.soundEvents.onBatch.trigger({ version: 1, worldId: 'world:fixture', generation: 1, tick: 1 });
    f.runtime.world.soundEvents.onBatch.trigger({ version: 1, worldId: 'world:fixture', generation: 1, tick: 2,
      sourceTimeMs: 40, tickDurationMs: 20, facts: null });
    const stopped = await f.studio.stopCausalTake({ reason: 'test-failed-source' });
    expect(stopped.complete).to.equal(false);
    const manifest = await storage.loadCausalTake(takeId);
    expect(manifest.coverage.status).to.equal('partial');
    expect(manifest.coverage.gaps.map(gap => gap.reason)).to.include.members(['clock-observation-failed', 'capture-exception']);
    expect((await createProcgenCausalJournal({ storage }).verify(takeId)).status).to.equal('partial');
    await f.studio.dispose().completion;
  });
  it('pages saved causal takes and inspects a selected take after recording', async () => {
    const memory = createMemoryCausalStore(), storage = { ...memory.storage, close() {} };
    const f = setup({ storageOverride: storage }); f.studio.bindRuntime();
    const takeId = (await f.studio.handlers.startCausalTake({ takeName: 'A saved performance' })).takeId;
    await f.studio.stopCausalTake();
    storage.listCausalTakes = async ({ cursor }) => cursor ?
      { items: [{ takeId, takeName: 'A saved performance', state: 'finalized', durableSequence: 0 }], nextCursor: null } :
      { items: [{ takeId: 'take:older', takeName: 'Older', state: 'partial', durableSequence: 0 }], nextCursor: 'take:older' };
    await f.studio.handlers.browseCausalTakes();
    expect(f.studio.handlers.causalTakeState().takePageNumber).to.equal(1);
    await f.studio.handlers.browseCausalTakes('next');
    expect(f.studio.handlers.causalTakeState().takePageNumber).to.equal(2);
    await f.studio.handlers.selectCausalTake(takeId);
    const inspection = await f.studio.handlers.inspectLastCausalTake();
    expect(inspection).to.include({ takeId, takeName: 'A saved performance', paused: true });
    await f.studio.handlers.browseCausalTakes('previous');
    expect(f.studio.handlers.causalTakeState().takePageNumber).to.equal(1);
    await f.studio.dispose().completion;
  });
  it('records tempo and active world-speed changes before the next physical boundary', async () => {
    const memory = createMemoryCausalStore(), storage = { ...memory.storage, close() {} };
    const f = setup({ storageOverride: storage }); f.studio.bindRuntime();
    const takeId = (await f.studio.handlers.startCausalTake()).takeId;
    f.studio.handlers.transport({ bpm: 180 });
    await f.studio.stopCausalTake();
    const records = (await createProcgenCausalJournal({ storage }).query({ takeId })).records;
    expect(records.map(record => record.kind)).to.deep.equal(['input-observation', 'input-observation', 'timeline']);
    expect(records[2].payload).to.deep.equal({ version: 1, kind: 'tempo', bpm: 180 });
    await f.studio.dispose().completion;
  });
  it('commits and releases local CC reservations after channel submission', async () => {
    const f = setup(); f.studio.bindRuntime(); f.enable();
    const scheduler = f.runtime.view.midiPreviewRouter.scheduler, ledger = [];
    scheduler.output.id = 'local-cc';
    scheduler.evaluateAndReserve = (_plan, meta) => { ledger.push(['reserve', meta.outputId]); return { ok: true, reservationId: 8 }; };
    scheduler._resolveOutputId = () => 'local-cc';
    scheduler._commitReservationMessage = (id, phase, bytes, meta) => { ledger.push(['commit', id, phase, bytes, meta.outputId]); return true; };
    scheduler._releaseReservation = (id, unclaimedOnly) => { ledger.push(['release', id, unclaimedOnly]); return 0; };
    scheduler.output.channels[1].sendControlChange = () => ledger.push(['send']);
    const lane = f.studio.getProject().procgen.lanes[0];
    f.studio.dispatch({ type: 'procgen/lane', laneId: lane.id, patch: { ccAutomation: [{ id: 'cc-test', enabled: true,
      controller: 74, axis: 'beat', length: 4, mode: 'step', points: [{ beat: 0, value: 40 }] }] } });
    f.studio.play(); f.studio.engine.onBeat({ beat: 0.25, timestamp: 100, bpm: 120 });
    expect(ledger).to.deep.include(['reserve', 'local-cc']);
    expect(ledger).to.deep.include(['commit', 8, 'on', 3, 'local-cc']);
    expect(ledger).to.deep.include(['release', 8, true]);
    expect(ledger.findIndex(entry => entry[0] === 'send')).to.be.lessThan(ledger.findIndex(entry => entry[0] === 'commit'));
    await f.studio.dispose().completion;
  });
  it('stops the musical transport and flushes output without replacing the world', async () => {
    const f = setup(); f.studio.bindRuntime(); f.studio.play();
    const world = f.runtime.world;
    const stopped = f.studio.handlers.stopOutput();
    expect(stopped).to.include({ playing: false, beat: 0, reason: 'stopped' });
    expect(f.runtime.world).to.equal(world);
    expect(f.statuses.at(-1)).to.include('output flushed');
    await f.studio.dispose().completion;
  });
  it('retries the same prepared MIDI bytes after an anchor request fails', async () => {
    const f = setup(), blobs = [], calls = [], timers = [];
    let failClick = true;
    f.document.body = { append() { calls.push('append'); } };
    f.document.createElement = () => ({ click() { calls.push('click'); if (failClick) throw new Error('blocked'); }, remove() { calls.push('remove'); } });
    f.window.Blob = Blob;
    f.window.URL = { createObjectURL(blob) { blobs.push(blob); return `blob:fixture-${blobs.length}`; }, revokeObjectURL() { calls.push('revoke'); } };
    f.window.setTimeout = callback => { timers.push(callback); return timers.length; };
    await f.studio.handlers.exportMidi();
    const prepared = f.studio.getExportState();
    expect(prepared.artifact).to.include({ retained: true, activeLeases: 0 });
    expect(prepared.delivery.state).to.equal('failed');
    expect(calls.at(-1)).to.equal('revoke');
    failClick = false;
    const retried = f.studio.handlers.retryExport();
    expect(retried).to.include({ artifactId: prepared.artifact.artifactId, state: 'delivery-requested' });
    expect(new Uint8Array(await blobs[0].arrayBuffer())).to.deep.equal(new Uint8Array(await blobs[1].arrayBuffer()));
    let pickerCalls = 0, written = 0, closed = false;
    f.window.showSaveFilePicker = () => { pickerCalls++; return Promise.resolve({ createWritable() { return Promise.resolve({
      write(chunk) { written += chunk.byteLength; }, close() { closed = true; }, abort() {}
    }); } }); };
    const saving = f.studio.handlers.savePreparedExport();
    expect(pickerCalls).to.equal(1);
    const saved = await saving;
    expect(saved).to.include({ artifactId: prepared.artifact.artifactId, state: 'close-acknowledged' });
    expect(written).to.equal(prepared.artifact.byteLength); expect(closed).to.equal(true);
    timers.at(-1)();
    const retired = f.studio.dispose(); await retired.completion;
    expect(f.studio.getExportState().artifact.retained).to.equal(false);
  });
  for (const action of ['cancel', 'clear', 'dispose']) it('retires a held MIDI preparation on ' + action + ' without replacing the previous artifact or blocking Panic', async () => {
    const jobs = createTestBackgroundJobs(); let hold = false, start, release;
    const entered = new Promise(resolve => { start = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const f = setup({ backgroundJobs: { async compute(options) { if (hold) { start(); await gate; } return jobs.compute(options); } } });
    try {
      await f.studio.handlers.exportMidi(); const original = f.studio.getExportState().artifact.artifactId; hold = true;
      const pending = f.studio.handlers.exportMidi(); await entered;
      expect(f.studio.getExportState().preparation).to.include({ kind: 'midi', phase: 'queued' });
      expect(f.studio.handlers.stopOutput().playing).to.equal(false);
      if (action === 'cancel') expect(f.studio.handlers.cancelExportDelivery()).to.equal(true);
      else if (action === 'clear') f.studio.ports.clearRecording();
      else await f.studio.dispose().completion;
      release(); await pending;
      expect(f.studio.getExportState().artifact.artifactId).to.equal(original); expect(f.studio.getExportState().preparation).to.equal(null);
      if (action !== 'dispose') expect(f.studio.getExportState().artifact.retained).to.equal(true);
    } finally { release(); await f.studio.dispose().completion; jobs.dispose(); }
  });
  it('never writes a newer artifact to a picker opened for an older export', async () => {
    const f = setup(); let resolvePicker, opened = 0;
    f.document.body = { append() {} };
    f.document.createElement = () => ({ click() {}, remove() {} });
    f.window.URL = { createObjectURL() { return 'blob:fixture'; }, revokeObjectURL() {} };
    const deliveryTimers = []; f.window.setTimeout = callback => { deliveryTimers.push(callback); return deliveryTimers.length; };
    await f.studio.handlers.exportMidi();
    deliveryTimers.shift()();
    const originalId = f.studio.getExportState().artifact.artifactId;
    f.window.showSaveFilePicker = () => new Promise(resolve => { resolvePicker = resolve; });
    const saving = f.studio.handlers.savePreparedExport();
    await f.studio.handlers.exportMidi();
    expect(f.studio.getExportState().artifact.artifactId).not.to.equal(originalId);
    resolvePicker({ createWritable() { opened++; return Promise.resolve({ write() {}, close() {} }); } });
    expect(await saving).to.include({ state: 'canceled', errorKind: 'source-replaced' });
    expect(opened).to.equal(0);
    await f.studio.dispose().completion;
  });
  it('shows source and delivery receipts separately and discards only prepared bytes', async () => {
    const f = setup(), before = f.studio.getProject();
    f.document.body = { append() {} };
    f.document.createElement = () => ({ click() {}, remove() {} });
    f.window.URL = { createObjectURL() { return 'blob:fixture'; }, revokeObjectURL() {} };
    const deliveryTimers = []; f.window.setTimeout = callback => { deliveryTimers.push(callback); return deliveryTimers.length; };
    await f.studio.handlers.exportMidi();
    deliveryTimers.shift()();
    const shown = f.exportStates.at(-1);
    expect(shown.artifact).to.include({ retained: true, formatVersion: 'smf1/v1' });
    expect(shown.delivery).to.include({ state: 'delivery-requested', sinkKind: 'anchor' });
    expect(f.studio.handlers.discardExport()).to.equal(true);
    expect(f.studio.getExportState()).to.include({ artifact: null, delivery: null });
    expect(f.exportStates.at(-1)).to.deep.equal({ artifact: null, delivery: null });
    expect(f.studio.getProject()).to.equal(before);
    await f.studio.dispose().completion;
  });
  it('cancels a file write while retaining the prepared artifact for another delivery', async () => {
    const f = setup();
    f.document.body = { append() {} };
    f.document.createElement = () => ({ click() {}, remove() {} });
    f.window.URL = { createObjectURL() { return 'blob:fixture'; }, revokeObjectURL() {} };
    const deliveryTimers = []; f.window.setTimeout = callback => { deliveryTimers.push(callback); return deliveryTimers.length; };
    await f.studio.handlers.exportMidi();
    deliveryTimers.shift()();
    const originalId = f.studio.getExportState().artifact.artifactId;
    let started, finishWrite, aborted = 0;
    const writing = new Promise(resolve => { started = resolve; });
    f.window.showSaveFilePicker = () => Promise.resolve({ createWritable() { return Promise.resolve({
      write() { started(); return new Promise(resolve => { finishWrite = resolve; }); }, close() {}, abort() { aborted++; }
    }); } });
    const pending = f.studio.handlers.savePreparedExport();
    await writing;
    expect(f.studio.getExportState().delivery.state).to.equal('writing');
    expect(f.studio.handlers.cancelExportDelivery()).to.equal(true);
    expect(await pending).to.include({ state: 'canceled', artifactId: originalId });
    expect(aborted).to.equal(1); finishWrite(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.studio.getExportState().artifact).to.include({ artifactId: originalId, retained: true, activeLeases: 0 });
    expect(f.studio.handlers.retryExport()).to.include({ artifactId: originalId, state: 'delivery-requested' });
    deliveryTimers.shift()(); await f.studio.dispose().completion;
  });
  it('schedules recovery after paused edits and reports the durable revision', async () => {
    const timers = [], f = setup({ windowTimers: {
      setTimeout(callback, delay) { callback.delay = delay; timers.push(callback); return timers.length; },
      clearTimeout(id) { timers[id - 1] = null; }
    } });
    f.studio.bindRuntime(); f.studio.transport.pause();
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 45 } });
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 1, patch: { note: 46 } });
    expect(timers.filter(callback => callback?.delay === 2000)).to.have.length(1);
    expect(f.studio.getRecoveryState().state).to.equal('pending');
    const tick = timers.find(callback => callback?.delay === 2000); tick();
    await new Promise(resolve => setTimeout(resolve, 0));
    const recovery = f.studio.getRecoveryState();
    expect(recovery.state).to.equal('saved');
    expect(recovery.durableRevision).to.equal(recovery.pendingRevision);
    expect(f.stored.get('__recovery__').project.procgen.lanes[0].patterns[0].steps.slice(0, 2).map(step => step.note)).to.deep.equal([45, 46]);
    f.studio.dispose();
  });
  it('coalesces edits made during recovery and never reports a failed write as durable', async () => {
    const timers = [], writes = []; let finishFirst;
    const f = setup({ windowTimers: {
      setTimeout(callback, delay) { callback.delay = delay; timers.push(callback); return timers.length; },
      clearTimeout(id) { timers[id - 1] = null; }
    }, storageOverride: {
      saveRecovery(session) { writes.push(session); return writes.length === 1 ? new Promise(resolve => { finishFirst = resolve; }) : Promise.reject(new Error('Quota unavailable')); },
      close() {}
    } });
    f.studio.bindRuntime(); f.studio.transport.pause();
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 45 } });
    const first = f.studio.recover();
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 1, patch: { note: 46 } });
    finishFirst(); await first;
    expect(f.studio.getRecoveryState()).to.include({ state: 'pending', durableRevision: 1, pendingRevision: 2 });
    expect(timers.filter(callback => callback?.delay === 2000)).to.have.length(1);
    timers.find(callback => callback?.delay === 2000)(); await new Promise(resolve => setTimeout(resolve, 0));
    const recovery = f.studio.getRecoveryState();
    expect(recovery.state).to.equal('unavailable');
    expect(recovery.durableRevision).to.equal(1);
    expect(recovery.error.message).to.equal('Quota unavailable');
    expect(f.storageReceipts.at(-1).recovery.state).to.equal('unavailable');
    f.studio.dispose();
  });
  for (const laneCount of [8, 128]) it(`coalesces ${laneCount}-lane preference writes while edits stay in the canonical project`, async () => {
    const timers = [], f = setup({ laneCount, backgroundJobs: { async compute(request) { return { value: JSON.stringify(await request.prepareInput()), release() { request.releasePreparedInput(); } }; } }, windowTimers: {
      setTimeout(callback) { timers.push(callback); return timers.length; },
      clearTimeout(id) { timers[id - 1] = null; }
    } });
    f.studio.bindRuntime();
    const key = 'lemmings.procgen.workstation.v1', original = f.window.localStorage.getItem(key);
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 45 } });
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 1, patch: { note: 46 } });
    expect(f.window.localStorage.getItem(key)).to.equal(original);
    expect(timers.filter(Boolean)).to.have.length(1);
    timers[0](); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const durable = JSON.parse(f.window.localStorage.getItem(key));
    expect(durable.project.procgen.lanes[0].patterns[0].steps.slice(0, 2).map(step => step.note)).to.deep.equal([45, 46]);
    f.studio.dispose();
  });
  it('prepares a recipe with declared lanes and speed without inheriting a saved project', () => {
    const savedProject = createProcgenWorkstationProject(createMidiProject(), { seed: 12, lanes: [{}, {}] });
    const persisted = { version: 1, project: savedProject, transport: { bpm: 60, gameSpeed: 0.5, speedMode: 'bpm' }, ui: { slot: 2 } };
    const f = setup({ search: '?seed=999&lanes=3&speed=2', persisted, startupSettings: { seed: 999, laneCount: 3, speed: 2 } });
    expect(f.studio.getStartupPlan().mode).to.equal('recipe');
    expect(f.studio.getProject().procgen.lanes).to.have.length(3);
    expect(f.studio.prepareSettings()).to.include({ laneCount: 3, seed: 999 });
    expect(f.studio.transport.getState()).to.include({ bpm: 240, gameSpeed: 2 });
    expect(f.studio.state.slot).to.equal(0);
    expect(f.window.localStorage.getItem('lemmings.procgen.workstation.v1')).to.equal(JSON.stringify(persisted));
    f.studio.dispose();
  });
  it('defers startup and candidate preferences until a coherent world is committed', async () => {
    const f = setup(), key = 'lemmings.procgen.workstation.v1';
    expect(f.window.localStorage.getItem(key)).to.equal(undefined);
    f.studio.handlers.preferences(); expect(f.window.localStorage.getItem(key)).to.equal(undefined);
    f.studio.bindRuntime(); const previous = f.window.localStorage.getItem(key);
    const release = f.holdRestart(), rebuilding = f.studio.handlers.reroll();
    await Promise.resolve(); expect(f.window.localStorage.getItem(key)).to.equal(previous);
    release(); expect(await rebuilding).to.equal(true);
    const committed = JSON.parse(f.window.localStorage.getItem(key));
    expect(committed.project.procgen.seed).to.equal(f.runtime.world.seed);
    f.studio.dispose();
  });
  it('keeps discovered unused MIDI outputs inert and ignores their disconnects', () => {
    const calls = [], listeners = new Map();
    const makePort = id => ({ id, state: 'connected', channels: { 1: {
      sendPitchBendRange() { calls.push(id); }, sendPitchBend() { calls.push(id); },
      sendControlChange() { calls.push(id); }, sendAllNotesOff() { calls.push(id); }
    } } });
    const a = makePort('A'), b = makePort('B');
    const webMidi = { inputs: [], outputs: [a, b], addListener(name, fn) { listeners.set(name, fn); }, removeListener(name) { listeners.delete(name); } };
    const f = setup({ webMidi, backend: 'midi', outputId: 'A' });
    f.enable(); f.studio.bindRuntime();
    expect(calls).not.to.include('B');
    const before = f.studio.transport.getState().playing;
    b.state = 'disconnected'; listeners.get('disconnected')();
    expect(calls).not.to.include('B'); expect(f.studio.transport.getState().playing).to.equal(before);
    expect(f.studio.ports.getState().noteOutputIds).to.deep.equal(['A']);
    f.studio.dispose();
  });
  it('retires ports, view, and storage after a transport destructor throws', async () => {
    const f = setup(); let portsDisposed = 0, storageClosed = 0;
    const originalPortsDispose = f.studio.ports.dispose;
    f.studio.ports.dispose = () => { portsDisposed++; originalPortsDispose(); };
    f.studio.transport.dispose = () => { throw new Error('flush refused'); };
    f.storage.close = () => { storageClosed++; return Promise.reject(new Error('disk closed early')); };
    const receipt = f.studio.dispose();
    expect(f.studio.dispose()).to.equal(receipt);
    expect(portsDisposed).to.equal(1); expect(storageClosed).to.equal(1); expect(f.view.disposed).to.equal(true);
    await receipt.completion;
    expect(receipt.state).to.equal('retired');
    expect(receipt.resources.find(resource => resource.name === 'transport')).to.include({ status: 'failed', error: 'flush refused' });
    expect(receipt.resources.find(resource => resource.name === 'storage')).to.include({ status: 'failed', error: 'database: disk closed early' });
  });

  it('shares one retirement receipt across reentrant callers and awaits async cleanup', async () => {
    const scope = createProcgenRetirementScope(); let nested, attempts = 0, settle;
    const receipt = scope.retire([
      { name: 'first', run: () => { attempts++; nested = scope.retire(); } },
      { name: 'last', run: () => new Promise(resolve => { settle = resolve; }) }
    ]);
    expect(attempts).to.equal(1); expect(nested).to.equal(receipt); expect(receipt.state).to.equal('retiring');
    settle(); await receipt.completion;
    expect(receipt.state).to.equal('retired'); expect(scope.retire()).to.equal(receipt);
  });

  it('bounds an unsettled retirement promise with unknown rather than completed evidence', async () => {
    const receipt = createProcgenRetirementScope({ deadlineMs: 1 }).retire([
      { name: 'stuck-storage', run: () => new Promise(() => {}) }
    ]);
    await receipt.completion;
    expect(receipt.resources[0].status).to.equal('unknown');
    expect(receipt.state).to.equal('retired');
  });
  it('propagates a nested partial retirement while attempting the remaining independent leaves', async () => {
    const child = createProcgenRetirementScope(), parent = createProcgenRetirementScope(); let remaining = 0;
    const receipt = parent.retire([{ name: 'audio-owner', run: () => child.retire([
      { name: 'adapter-release', run: () => { throw new Error('release refused'); } },
      { name: 'pcm-release', run: () => { remaining++; } }
    ]) }, { name: 'storage', run: () => { remaining++; } }]);
    await receipt.completion; expect(remaining).to.equal(2); expect(receipt.outcome).to.equal('partial');
    expect(receipt.resources[0]).to.include({ status: 'failed', error: 'adapter-release: release refused' });
    expect(parent.retire()).to.equal(receipt); expect(child.retire().outcome).to.equal('partial');
  });
  it('starts an independent silent transport and routes accepted synth pattern performance only after listening', () => {
    const f = setup(); f.studio.bindRuntime();
    expect(f.runtime.lanes.clockDriven).to.equal(true); expect(f.studio.transport.getState().playing).to.equal(true);
    expect(f.calls).to.have.length(0); f.enable(); f.studio.handlers.record(true); f.time(125);
    expect(f.calls.length).to.be.greaterThan(0); expect(f.calls[0].spec.outputId).to.equal(null);
    expect(f.studio.ports.getRecording().some(event => (event.data[0] & 0xf0) === 0x90)).to.equal(true);
    expect(f.positions).to.include(125); f.studio.dispose(); expect(f.view.disposed).to.equal(true);
  });

  it('hooks replacement routers while keeping game events out of the complementary pattern lane', () => {
    const f = setup(); f.studio.bindRuntime(); f.enable();
    const fresh = { scheduler: f.runtime.view.midiPreviewRouter.scheduler, resetClock() {} };
    f.runtime.view.setMidiPreviewRouter(fresh);
    expect(fresh.workstationEventHandler).to.be.a('function');
    expect(fresh.workstationEventHandler({ laneIndex: 0, action: 'building' })).to.equal(true);
    expect(f.calls).to.have.length(0);
    f.runtime.world.soundEvents.onEvent.trigger({ laneIndex: 0, action: 'building' });
    expect(f.calls.some(call => call.meta.source === 'game')).to.equal(false); f.studio.dispose();
  });

  it('observes game conditions before listening without double-counting router events', () => {
    const f = setup(); f.studio.bindRuntime();
    f.runtime.world.soundEvents.onEvent.trigger({ laneIndex: 0, action: 'building', terrainFamily: 'crystal' });
    const lane = f.studio.engine.getState().lanes['lane-1'];
    expect(lane.events).to.equal(1); expect(lane.observed).to.deep.equal({ action: 'building', terrain: 'crystal' });
    expect(f.calls).to.have.length(0); f.studio.dispose();
  });

  it('commits MIDI input notes and measured durations into the selected pattern', () => {
    const f = setup(); f.studio.bindRuntime(); f.studio.handlers.record(true);
    f.studio.ports.receiveMidi([0x90, 67, 97], 0); f.time(125); f.studio.ports.receiveMidi([0x80, 67, 0], 125);
    const step = f.studio.getProject().procgen.lanes[0].patterns[0].steps[0];
    expect(step).to.include({ enabled: true, note: 67, velocity: 97, duration: 0.25 }); f.studio.dispose();
  });

  it('cancels an armed MIDI Learn when a different session loads', async () => {
    const f = setup(); f.studio.bindRuntime();
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 55 } });
    const saved = f.studio.capture();
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 60 } });
    expect(f.studio.handlers.learn()).to.equal(true);
    expect(await f.studio.loadSession(saved)).to.equal(true);
    f.studio.ports.receiveMidi([0x90, 81, 100], 0);
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(55);
    expect(f.studio.getInputEditLease()).to.equal(null);
    expect(f.studio.ports.getState().learning).to.equal(false);
    f.studio.dispose();
  });

  it('learns into the armed step even if selection changes, then offers one Undo', async () => {
    const f = setup(); f.studio.bindRuntime();
    expect(f.studio.handlers.learn()).to.equal(true);
    const lease = f.studio.getInputEditLease();
    expect(lease).to.include({ laneId: 'lane-1', slot: 0, index: 0, policy: 'fixed-target' });
    f.studio.state.step = 1;
    f.studio.ports.receiveMidi([0x90, 81, 100], 0);
    const steps = f.studio.getProject().procgen.lanes[0].patterns[0].steps;
    expect(steps[0].note).to.equal(81); expect(steps[1].note).to.equal(60);
    expect(await f.studio.handlers.undo()).to.equal(true);
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(60);
    f.studio.dispose();
  });

  it('cancels MIDI Learn on target removal, input replacement, and explicit cancellation', () => {
    const f = setup(); f.studio.bindRuntime();
    f.studio.state.step = 3;
    f.studio.handlers.learn();
    f.studio.dispatch({ type: 'procgen/pattern', laneId: 'lane-1', slot: 0, patch: { length: 2 } });
    expect(f.studio.getInputEditLease()).to.equal(null);
    f.studio.state.step = 0;
    f.studio.handlers.learn();
    f.studio.ports.setInput({ id: 'keys', ...target() });
    expect(f.studio.getInputEditLease()).to.equal(null);
    expect(f.studio.ports.getState().learning).to.equal(false);
    f.studio.handlers.learn(); f.studio.handlers.cancelLearn();
    expect(f.studio.getInputEditLease()).to.equal(null);
    f.studio.dispose();
  });

  it('keeps a rejected session load from leaving MIDI Learn armed', async () => {
    const f = setup(); f.studio.bindRuntime(); f.studio.handlers.learn();
    try { await f.studio.loadSession({ invalid: true }); } catch { /* Rejection is expected. */ }
    expect(f.studio.getInputEditLease()).to.equal(null);
    expect(f.studio.ports.getState().learning).to.equal(false);
    f.studio.dispose();
  });

  it('supports phrase editing undo and redo without a second project model', () => {
    const f = setup(); f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 1, patch: { note: 72 } });
    expect(f.legacy.getProject().procgen.lanes[0].patterns[0].steps[1].note).to.equal(72);
    f.studio.handlers.undo(); expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[1].note).to.equal(60);
    f.studio.handlers.redo(); expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[1].note).to.equal(72); f.studio.dispose();
  });

  it('replays edits made during a world-changing Undo and invalidates its Redo branch', async () => {
    const f = setup(); f.studio.bindRuntime();
    expect(await f.studio.handlers.addLane()).to.equal(true);
    const release = f.holdRestart(), pending = f.studio.handlers.undo();
    expect(f.studio.handlers.historyBusy()).to.equal(true);
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 81 } });
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(81);
    release(); expect(await pending).to.equal(true);
    expect(f.studio.handlers.historyBusy()).to.equal(false);
    expect(f.studio.getProject().procgen.lanes).to.have.length(1);
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(81);
    expect(await f.studio.handlers.redo()).to.equal(false);
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(81);
    expect(await f.studio.handlers.undo()).to.equal(true);
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(60);
    f.studio.dispose();
  });

  it('keeps concurrent edits undoable when a history rebuild fails', async () => {
    const f = setup(); f.studio.bindRuntime();
    expect(await f.studio.handlers.addLane()).to.equal(true);
    const release = f.holdRestart(), pending = f.studio.handlers.undo();
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 81 } });
    f.failRestart(); release(); expect(await pending).to.equal(false);
    expect(f.studio.getProject().procgen.lanes).to.have.length(2);
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(81);
    expect(await f.studio.handlers.undo()).to.equal(true);
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(60);
    f.studio.dispose();
  });

  for (const outcome of ['commit', 'fail', 'cancel']) {
    it('matches serial history after queued music and rapid repeats when rebuilds ' + outcome, async () => {
      const f = setup({ laneCount: 8 }); f.studio.bindRuntime();
      try {
        expect(await f.studio.handlers.addLane()).to.equal(true);
        const release = f.holdRestart(), pending = f.studio.handlers.undo();
        for (const type of ['procgen/physicalGraph', 'procgen/junctions', 'procgen/fragments', 'procgen/detachFragment', 'procgen/releaseGesture']) {
          const before = f.studio.getProject(); expect(f.studio.dispatch({ type })).to.equal(false); expect(f.studio.getProject()).to.equal(before);
        }
        expect(await f.studio.handlers.undo()).to.equal(false); expect(await f.studio.handlers.redo()).to.equal(false);
        for (const note of [81, 82, 83]) f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note } });
        expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(83);
        if (outcome === 'fail') f.failRestart(); else if (outcome === 'cancel') f.cancelRestart();
        release(); expect(await pending).to.equal(outcome === 'commit');
        const lanes = outcome === 'commit' ? 8 : 9;
        const check = note => { const project = f.studio.getProject(); expect(project.procgen.lanes).to.have.length(lanes); expect(project.procgen.lanes[0].patterns[0].steps[0].note).to.equal(note); };
        check(83); expect(await f.studio.handlers.redo()).to.equal(false); check(83);
        for (const note of [82, 81, 60]) { expect(await f.studio.handlers.undo()).to.equal(true); check(note); }
        for (const note of [81, 82, 83]) { expect(await f.studio.handlers.redo()).to.equal(true); check(note); }
        f.failRestart(false); expect(await f.studio.handlers.save()).to.equal(true);
        const saved = JSON.parse(JSON.stringify(f.stored.get('Test song'))), reopened = setup({ laneCount: lanes });
        try {
          reopened.studio.bindRuntime(); expect(await reopened.studio.loadSession(saved)).to.equal(true);
          expect(reopened.studio.getProject().procgen).to.deep.equal(f.studio.getProject().procgen);
          expect(reopened.runtime.world.laneCount).to.equal(lanes); expect(reopened.runtime.world.seed).to.equal(f.studio.getProject().procgen.seed);
          expect(reopened.studio.getDocumentState().dirty).to.equal(true);
          expect(await reopened.studio.handlers.save()).to.equal(true); expect(reopened.studio.getDocumentState().dirty).to.equal(false);
        } finally { await reopened.studio.dispose().completion; }
      } finally { await f.studio.dispose().completion; }
    });
  }

  it('bounds queued history commands by UTF-16 serialized bytes before publishing them', async () => {
    const f = setup(); f.studio.bindRuntime();
    try {
      await f.studio.handlers.addLane(); const release = f.holdRestart(), pending = f.studio.handlers.undo(), before = f.studio.getProject();
      expect(f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 81 }, ignored: 'x'.repeat(600000) })).to.equal(false);
      expect(f.studio.getProject()).to.equal(before);
      f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 82 }, ignored: 'x'.repeat(300000) });
      const accepted = f.studio.getProject();
      expect(f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 83 }, ignored: 'x'.repeat(300000) })).to.equal(false);
      expect(f.studio.getProject()).to.equal(accepted); release(); expect(await pending).to.equal(true);
      expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(82);
    } finally { await f.studio.dispose().completion; }
  });

  it('does not publish a retired history rebuild after disposal with queued music', async () => {
    const f = setup(); f.studio.bindRuntime(); await f.studio.handlers.addLane();
    const release = f.holdRestart(), pending = f.studio.handlers.undo();
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 81 } });
    const before = f.studio.getProject(), retirement = f.studio.dispose(); release();
    expect(await pending).to.equal(false); await retirement.completion;
    expect(f.studio.getProject()).to.equal(before); expect(f.studio.handlers.historyBusy()).to.equal(false);
  });

  for (const laneCount of [8, 128, 1024]) {
    it('retains bounded structural Undo and Redo charges at ' + laneCount + ' lanes', async () => {
      const f = setup({ laneCount, historyBytesLimit: 65536 });
      try {
        for (let note = 61; note < 85; note++) f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note } });
        const before = f.studio.handlers.historyState(); expect(before.retainedBytes).to.be.at.most(65536);
        expect(before.retainedBytes).to.be.at.least(before.undo * (laneCount * 8 + 1024));
        console.info('History retained-charge observation: ' + JSON.stringify({ laneCount, undo: before.undo, retainedBytes: before.retainedBytes, byteLimit: before.byteLimit, dropped: before.dropped }));
        if (laneCount === 1024) expect(before.dropped).to.be.greaterThan(0);
        expect(await f.studio.handlers.undo()).to.equal(true); expect(await f.studio.handlers.redo()).to.equal(true);
        expect(f.studio.handlers.historyState().retainedBytes).to.equal(before.retainedBytes);
        expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(84);
      } finally { await f.studio.dispose().completion; }
    });
  }

  it('quantizes consecutive recorded notes into different cells and captures simultaneous notes as a chord', () => {
    const f = setup(); f.studio.bindRuntime(); f.studio.handlers.record(true);
    f.studio.ports.receiveMidi([0x90, 60, 90], 0); f.studio.ports.receiveMidi([0x90, 64, 90], 0);
    f.time(100); f.studio.ports.receiveMidi([0x80, 60, 0], 100); f.studio.ports.receiveMidi([0x80, 64, 0], 100);
    f.time(150); f.studio.ports.receiveMidi([0x90, 72, 95], 150); f.time(200); f.studio.ports.receiveMidi([0x80, 72, 0], 200);
    const steps = f.studio.getProject().procgen.lanes[0].patterns[0].steps;
    expect(steps[0]).to.include({ note: 60, duration: 0.2 }); expect(steps[0].chord.degrees).to.deep.equal([0, 4]);
    expect(steps[1]).to.include({ note: 72, velocity: 95 }); expect(steps[1].duration).to.be.closeTo(0.1, 1e-8); f.studio.dispose();
  });

  it('groups a captured chord and its note-off duration into one Undo gesture', async () => {
    const f = setup(); f.studio.bindRuntime(); f.studio.handlers.record(true);
    f.studio.ports.receiveMidi([0x90, 60, 90], 0); f.studio.ports.receiveMidi([0x90, 64, 90], 0);
    f.time(100); f.studio.ports.receiveMidi([0x80, 60, 0], 100); f.studio.ports.receiveMidi([0x80, 64, 0], 100);
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].chord.degrees).to.deep.equal([0, 4]);
    expect(await f.studio.handlers.undo()).to.equal(true);
    const restored = f.studio.getProject().procgen.lanes[0].patterns[0].steps[0];
    expect(restored.chord).to.equal(null); expect(restored.note).to.equal(60);
    f.studio.dispose();
  });

  it('does not store no-op edits and keeps retained history within its byte budget', () => {
    const f = setup({ historyBytesLimit: 4096 });
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 60 } });
    expect(f.studio.handlers.historyState().undo).to.equal(0);
    for (let note = 61; note < 75; note++) f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note } });
    expect(f.studio.handlers.historyState().retainedBytes).to.be.at.most(4096);
    expect(f.studio.handlers.historyState().dropped).to.be.greaterThan(0);
    f.studio.dispose();
  });

  it('retains many structurally shared edits and accounts for redo by patch size', async () => {
    const f = setup({ laneCount: 128 });
    for (let note = 1; note <= 30; note++) f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1',
      slot: 0, index: 0, patch: { note } });
    const before = f.studio.handlers.historyState();
    expect(before.undo).to.equal(30);
    expect(before.retainedBytes).to.be.lessThan(100000);
    expect(await f.studio.handlers.undo()).to.equal(true);
    const after = f.studio.handlers.historyState();
    expect(after.redo).to.equal(1);
    expect(after.retainedBytes).to.be.lessThan(100000);
    expect(await f.studio.handlers.redo()).to.equal(true);
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(30);
    f.studio.dispose();
  });

  it('accepts legacy music changes without a subscription echo or a stale second project', () => {
    const f = setup(); const next = { ...f.legacy.getProject(), global: { ...f.legacy.getProject().global, scale: { root: 9, name: 'Minor', degrees: [0, 2, 3, 5, 7, 8, 10] } } };
    f.legacy.setProject(next); expect(f.studio.getProject().global.scale.root).to.equal(9);
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 75 } });
    expect(f.legacy.getProject().global.scale.root).to.equal(9); f.studio.dispose();
  });

  it('syncs automatic world seed changes into the replay project and recovery checkpoint', async () => {
    const f = setup(); f.studio.bindRuntime(); f.runtime.world.seed = 105; f.time(20);
    expect(f.studio.getProject().procgen.seed).to.equal(105); expect(f.legacy.settings.seed).to.equal(105);
    expect(await f.studio.recover()).to.equal(true);
    expect(f.stored.get('__recovery__').project.procgen.seed).to.equal(105);
    expect(f.studio.transport.getState().playing).to.equal(true); f.studio.dispose();
  });

  it('saves a checkpoint and restores project, physical settings, musical phase and camera paused', async () => {
    const f = setup(); f.studio.bindRuntime(); f.time(125);
    expect(await f.studio.handlers.save()).to.equal(true);
    const saved = f.stored.get('Test song'); expect(saved.transport).to.include({ playing: false, beat: 0.25 });
    expect(f.studio.transport.getState().playing).to.equal(true);
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 90 } });
    await f.studio.loadSession(saved);
    expect(f.studio.transport.getState()).to.include({ playing: false, beat: 0.25 });
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(60);
    expect(f.runtime.lanes.renderer.camera.restored).to.deep.equal({ cameraX: 45 }); f.studio.dispose();
  });

  it('keeps Save, Save As, and Rename on stable identities even with duplicate names', async () => {
    const documents = new Map(), storage = {
      async saveDocument(id, expectedRevision, session) {
        const current = documents.get(id);
        if ((current?.revision || 0) !== expectedRevision) throw new Error('Revision conflict');
        const revision = expectedRevision + 1;
        documents.set(id, { id, revision, session }); return { id, revision };
      },
      async listDocuments() { return [...documents.values()].map(({ id, revision, session }) => ({ id, revision, name: session.name, savedAt: session.savedAt })); },
      async listDocumentPage() { return { items: await this.listDocuments(), nextCursor: null }; },
      async loadDocument(id) { return documents.get(id); },
      async saveRecovery() {}, close() {}
    };
    const f = setup({ storageOverride: storage }); f.studio.bindRuntime();
    expect(await f.studio.handlers.save()).to.equal(true);
    const first = f.studio.getDocumentState();
    expect(await f.studio.handlers.saveAs()).to.equal(true);
    const second = f.studio.getDocumentState();
    expect(second.id).not.to.equal(first.id);
    expect(documents.size).to.equal(2);
    expect([...documents.values()].map(item => item.session.name)).to.deep.equal(['Test song', 'Test song']);
    f.window.prompt = () => 'Renamed';
    expect(await f.studio.handlers.rename()).to.equal(true);
    expect(f.studio.getDocumentState()).to.include({ id: second.id, revision: 2 });
    expect(documents.get(first.id).session.name).to.equal('Test song');
    expect(documents.get(second.id).session.name).to.equal('Renamed');
    expect(await f.studio.handlers.new()).to.equal(true);
    f.view.showProjects = (entries, load) => { f.view.entries = entries; f.view.choose = load; };
    expect(await f.studio.handlers.load()).to.equal(true);
    expect(f.view.entries.map(entry => entry.id)).to.have.members([first.id, second.id]);
    expect(await f.view.choose(first.id), JSON.stringify(f.statuses)).to.equal(true);
    expect(f.studio.getDocumentState()).to.include({ id: first.id, revision: 1, dirty: false });
    f.studio.dispose();
  });

  it('loads only a selected checkpoint after browsing compact project pages', async () => {
    const requests = [], storage = {
      async listDocumentPage(options = {}) {
        requests.push(options);
        return options.cursor ? { items: [{ id: 'doc:chosen', name: 'Chosen', savedAt: '2026-10-22T00:00:00Z', revision: 2 }], nextCursor: null } :
          { items: [{ id: 'doc:first', name: 'First', savedAt: '2026-10-22T00:00:00Z', revision: 1 }], nextCursor: { savedAt: '2026-10-22T00:00:00Z', id: 'doc:first' } };
      },
      async loadDocument(id) { if (id !== 'doc:chosen') throw new Error('Project was removed'); return { id, revision: 2, session: this.saved }; },
      async saveRecovery() {}, close() {}
    };
    const f = setup({ storageOverride: storage }); f.studio.bindRuntime(); storage.saved = f.studio.capture();
    f.view.showProjectPage = (page, load, more) => { f.view.page = page; f.view.loadChoice = load; f.view.more = more; };
    expect(await f.studio.handlers.load()).to.equal(true);
    expect(f.view.page.items).to.have.length(1); expect(requests).to.have.length(1);
    expect(requests[0].signal).to.be.instanceOf(globalThis.AbortSignal);
    expect(await f.view.loadChoice('doc:first')).to.equal(false);
    expect(f.studio.getDocumentState().id).to.equal(null);
    expect((await f.view.more(f.view.page.nextCursor, '')).items[0].id).to.equal('doc:chosen');
    expect(await f.view.loadChoice('doc:chosen')).to.equal(true);
    expect(f.studio.getDocumentState()).to.include({ id: 'doc:chosen', revision: 2, dirty: false });
    f.studio.dispose();
  });

  it('aborts the project paging storage lease on Cancel and refuses later continuation reads', async () => {
    let signal, reads = 0;
    const storage = { async listDocumentPage(options) { signal = options.signal; reads++; return { items: [], nextCursor: 'next' }; }, close() {} };
    const f = setup({ storageOverride: storage }); f.studio.bindRuntime();
    f.view.showProjectPage = (page, load, more) => { f.view.more = more; };
    expect(await f.studio.handlers.load()).to.equal(true); expect(signal.aborted).to.equal(false);
    f.studio.handlers.cancelProjectPicker(); expect(signal.aborted).to.equal(true);
    expect(await f.view.more('next', '')).to.equal(null); expect(reads).to.equal(1); f.studio.dispose();
  });

  it('keeps the picker lease available after isolated world preparation fails so the same selection can retry', async () => {
    let session;
    const storage = { async listDocumentPage() { return { items: [{ id: 'doc:retry', name: 'Retry', savedAt: '2026-10-27T12:00:00Z' }], nextCursor: null }; },
      async loadDocument() { return { id: 'doc:retry', revision: 1, session }; }, close() {} };
    const f = setup({ storageOverride: storage }); f.studio.bindRuntime(); session = f.studio.capture(); const original = f.runtime;
    f.view.showProjectPage = (page, load) => { f.view.choose = load; }; await f.studio.handlers.load();
    f.failRestart(); expect(await f.view.choose('doc:retry')).to.equal(false); expect(f.runtime).to.equal(original);
    f.failRestart(false); expect(await f.view.choose('doc:retry')).to.equal(true);
    expect(f.studio.getDocumentState()).to.include({ id: 'doc:retry', revision: 1, dirty: false }); f.studio.dispose();
  });

  it('keeps the save indicator dirty when edits outlive an in-flight durable snapshot', async () => {
    const f = setup(); f.studio.bindRuntime();
    const originalSave = f.storage.save.bind(f.storage);
    let release; const gate = new Promise(resolve => { release = resolve; });
    f.storage.save = async (...args) => { await gate; return originalSave(...args); };
    const saving = f.studio.handlers.save();
    await Promise.resolve();
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 81 } });
    release(); expect(await saving).to.equal(true);
    expect(f.storageReceipts.at(-1)).to.include({ dirty: true, savedAt: f.stored.get('Test song').savedAt });
    expect(f.statuses.at(-1)).to.include('newer edits are unsaved');
    f.studio.dispose();
  });

  it('does not rename or resume a new document when an older save completes late', async () => {
    const f = setup(); f.studio.bindRuntime();
    const originalSave = f.storage.save.bind(f.storage);
    let release; const gate = new Promise(resolve => { release = resolve; });
    f.storage.save = async (...args) => { await gate; return originalSave(...args); };
    const saving = f.studio.handlers.save();
    await Promise.resolve();
    expect(await f.studio.handlers.new()).to.equal(true);
    f.studio.transport.pause();
    release(); expect(await saving).to.equal(true);
    expect(f.stored.get('Test song')).to.exist;
    expect(f.studio.transport.getState().playing).to.equal(false);
    expect(f.studio.capture().name).to.equal('Untitled session');
    expect(f.storageReceipts.at(-1).dirty).to.equal(true);
    f.studio.dispose();
  });

  it('keeps the newer document selected when two document saves complete in reverse order', async () => {
    const documents = new Map(); let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    let calls = 0;
    const storage = { async saveDocument(id, expectedRevision, session) {
      calls++; if (calls === 1) await firstGate;
      documents.set(id, { session, revision: expectedRevision + 1 });
      return { id, revision: expectedRevision + 1 };
    }, async saveRecovery() {}, close() {} };
    const f = setup({ storageOverride: storage }); f.studio.bindRuntime();
    const oldSave = f.studio.handlers.save();
    await Promise.resolve();
    expect(await f.studio.handlers.new()).to.equal(true);
    expect(await f.studio.handlers.save()).to.equal(true);
    const selectedId = f.studio.getDocumentState().id;
    releaseFirst(); expect(await oldSave).to.equal(true);
    expect(documents.size).to.equal(2);
    expect(f.studio.getDocumentState()).to.include({ id: selectedId, revision: 1, dirty: false });
    f.studio.dispose();
  });

  it('does not override an explicit pause after Save began', async () => {
    const f = setup(); f.studio.bindRuntime();
    const originalSave = f.storage.save.bind(f.storage);
    let release; const gate = new Promise(resolve => { release = resolve; });
    f.storage.save = async (...args) => { await gate; return originalSave(...args); };
    const saving = f.studio.handlers.save();
    await Promise.resolve(); f.studio.transport.pause();
    release(); expect(await saving).to.equal(true);
    expect(f.studio.transport.getState().playing).to.equal(false);
    f.studio.dispose();
  });

  it('cancels Save before checkpoint capture or storage writes and restores playback', async () => {
    const f = setup(); f.studio.bindRuntime(); f.time(125);
    f.window.prompt = () => null;
    const project = f.studio.getProject(), before = f.studio.transport.getState(), captures = f.captures.length;
    expect(await f.studio.handlers.save()).to.equal(false);
    expect(f.captures).to.have.length(captures);
    expect(f.stored.size).to.equal(0);
    expect(f.studio.getProject()).to.equal(project);
    expect(f.studio.transport.getState()).to.include({ playing: before.playing, beat: before.beat });
    f.studio.dispose();
  });

  it('preserves a paused session on Cancel and leaves the old saved record on a storage error', async () => {
    const f = setup(); f.studio.bindRuntime();
    expect(await f.studio.handlers.save()).to.equal(true);
    const original = f.stored.get('Test song');
    f.studio.transport.pause(); f.window.prompt = () => null;
    const beforeCalls = f.saveCalls;
    expect(await f.studio.handlers.save()).to.equal(false);
    expect(f.saveCalls).to.equal(beforeCalls);
    expect(f.studio.transport.getState().playing).to.equal(false);
    f.window.prompt = () => 'Test song'; f.failSave();
    expect(await f.studio.handlers.save()).to.equal(false);
    expect(f.stored.get('Test song')).to.equal(original);
    expect(f.studio.transport.getState().playing).to.equal(false);
    f.studio.dispose();
  });

  it('does not publish a pending world after workstation disposal', async () => {
    const f = setup(); f.studio.bindRuntime(); const previous = f.runtime, release = f.holdRestart();
    const pending = f.studio.handlers.addLane(), statusCount = f.statuses.length;
    f.studio.dispose(); release();
    expect(await pending).to.equal(false);
    expect(f.runtime).to.equal(previous);
    expect(f.statuses).to.have.length(statusCount);
    expect(f.view.disposed).to.equal(true);
  });

  it('rolls back a canceled world preparation while its workstation still owns the operation', async () => {
    const f = setup(); f.studio.bindRuntime(); const previous = f.studio.getProject(), original = f.runtime;
    f.cancelRestart();
    expect(await f.studio.handlers.addLane()).to.equal(false);
    expect(f.studio.getProject().procgen.lanes).to.have.length(previous.procgen.lanes.length);
    expect(f.runtime).to.equal(original);
    expect(f.studio.transport.getState().playing).to.equal(true);
    f.studio.dispose();
  });

  it('admits only the latest selected import before reading and parsing', async () => {
    const f = setup(); f.studio.bindRuntime();
    const first = f.studio.capture(), second = f.studio.capture();
    first.project.procgen.lanes[0].patterns[0].steps[0].note = 60;
    second.project.procgen.lanes[0].patterns[0].steps[0].note = 81;
    let finishFirst, entered; const reading = new Promise(resolve => { entered = resolve; });
    const old = f.studio.handlers.import({ text: () => new Promise(resolve => { finishFirst = resolve; entered(); }) });
    await reading;
    const recent = f.studio.handlers.import({ text: async () => JSON.stringify(second) });
    expect(await recent).to.equal(true);
    finishFirst(JSON.stringify(first));
    expect(await old).to.equal(false);
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(81);
    expect(f.restarts).to.have.length(1);
    f.studio.dispose();
  });

  it('does not parse or restart an imported file that completes after disposal', async () => {
    const f = setup(); f.studio.bindRuntime();
    let finishRead, entered; const reading = new Promise(resolve => { entered = resolve; });
    const pending = f.studio.handlers.import({ text: () => new Promise(resolve => { finishRead = resolve; entered(); }) });
    await reading;
    f.studio.dispose();
    finishRead('{invalid JSON');
    expect(await pending).to.equal(false);
    expect(f.restarts).to.have.length(0);
  });

  it('rejects a known oversized project before reading or replacing the live world', async () => {
    const f = setup(); f.studio.bindRuntime();
    const original = f.runtime, project = f.studio.getProject(); let reads = 0;
    expect(await f.studio.handlers.import({ size: 64 * 1048576 + 1, async text() { reads++; return '{}'; } })).to.equal(false);
    expect(reads).to.equal(0); expect(f.restarts).to.have.length(0);
    expect(f.runtime).to.equal(original); expect(f.studio.getProject()).to.equal(project);
    f.studio.dispose();
  });

  it('preserves causal events and queued phrases when resuming a checkpoint ahead of the audible beat', async () => {
    const f = setup({ lookaheadMs: 30 }); f.studio.bindRuntime(); f.enable(); f.time(125);
    for (let i = 0; i < 5; i++) f.runtime.world.soundEvents.onEvent.trigger({ laneIndex: 0, action: 'building' });
    f.studio.dispatch({ type: 'procgen/launch', laneId: 'lane-1', slot: 1 });
    const saved = f.studio.capture();
    expect(saved.patterns.beat).to.be.greaterThan(saved.transport.beat);
    expect(saved.patterns.lanes['lane-1'].events).to.equal(5);
    await f.studio.loadSession(saved); f.studio.play();
    expect(f.studio.engine.getState().lanes['lane-1'].events).to.equal(5);
    expect(f.studio.getProject().procgen.lanes[0].queuedSlot).to.equal(1);
    f.studio.handlers.transport({ bpm: 180 });
    expect(f.studio.engine.getState().lanes['lane-1'].events).to.equal(5); f.studio.dispose();
  });

  it('rejects overlapping world commands and mismatched recovery snapshots while a rebuild is pending', async () => {
    const f = setup(); f.studio.bindRuntime(); const release = f.holdRestart();
    const pending = f.studio.handlers.addLane();
    expect(await f.studio.handlers.reroll()).to.equal(false); expect(f.restarts).to.have.length(1);
    expect(await f.studio.recover()).to.equal(false); expect(() => f.studio.capture()).to.throw('world change');
    release(); await pending;
    expect(f.studio.getProject().procgen.lanes.length).to.equal(f.runtime.world.laneCount);
    expect(await f.studio.recover()).to.equal(true); f.studio.dispose();
  });

  it('keeps the live world and project on a failed transactional session load', async () => {
    const f = setup(); f.studio.bindRuntime(); const saved = f.studio.capture(); f.studio.play();
    const original = f.runtime, project = f.studio.getProject(); f.failRestart();
    let error; try { await f.studio.loadSession(saved); } catch (value) { error = value; }
    expect(error.message).to.equal('Assets unavailable'); expect(f.runtime).to.equal(original);
    expect(f.studio.getProject()).to.equal(project); expect(f.studio.transport.getState().playing).to.equal(true); f.studio.dispose();
  });

  it('loads a legacy session without optional camera data and rejects malformed patterns before restart', async () => {
    const f = setup(); f.studio.bindRuntime(); const saved = f.studio.capture();
    const oldRuntime = f.runtime, oldProject = f.studio.getProject();
    const malformed = { ...saved, patterns: { ...saved.patterns, pending: null } };
    let error; try { await f.studio.loadSession(malformed); } catch (value) { error = value; }
    expect(error.message).to.include('pattern state is incomplete');
    expect(f.restarts).to.have.length(0);
    expect(f.runtime).to.equal(oldRuntime); expect(f.studio.getProject()).to.equal(oldProject);
    expect(await f.studio.loadSession({ ...saved, camera: undefined })).to.equal(true);
    expect(f.studio.transport.getState().playing).to.equal(false);
    f.studio.dispose();
  });

  it('keeps a post-commit presentation failure paused and restores persistence admission', async () => {
    const f = setup(); f.studio.bindRuntime(); const saved = f.studio.capture(), oldRuntime = f.runtime;
    f.failCamera();
    let error; try { await f.studio.loadSession(saved); } catch (value) { error = value; }
    expect(error.message).to.equal('Camera unavailable');
    expect(f.runtime).not.to.equal(oldRuntime);
    expect(f.studio.transport.getState().playing).to.equal(false);
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 81 } });
    expect(JSON.parse(f.window.localStorage.getItem('lemmings.procgen.workstation.v1')).project.procgen.lanes[0].patterns[0].steps[0].note).to.equal(81);
    f.studio.dispose();
  });

  it('never promotes a rejected spacing draft during Save or Recovery', async () => {
    const f = setup(); f.studio.bindRuntime(); f.failRestart(); const previous = f.runtime;
    expect(await f.studio.handlers.rebuild({ hazardSpacing: 256 })).to.equal(false);
    expect(f.runtime).to.equal(previous); expect(f.studio.state.hazardSpacing).to.equal(160);
    f.studio.state.hazardSpacing = 512; // A stale legacy UI reference is not recipe authority.
    const captured = f.studio.capture();
    expect(captured.settings.hazardSpacing).to.equal(160); expect(f.legacy.settings.hazardSpacing).to.equal(160);
    f.studio.dispose();
  });
  it('accepts spacing only at world commit and rejects a busy second draft', async () => {
    const f = setup(); f.studio.bindRuntime(); const release = f.holdRestart();
    const pending = f.studio.handlers.rebuild({ hazardSpacing: 256 });
    expect(f.studio.state.hazardSpacing).to.equal(160);
    expect(await f.studio.handlers.rebuild({ hazardSpacing: 384 })).to.equal(false);
    release(); expect(await pending).to.equal(true);
    expect(f.studio.state.hazardSpacing).to.equal(256); expect(f.studio.capture().settings.hazardSpacing).to.equal(256);
    f.studio.dispose();
  });
  it('retains each accepted sound Undo boundary after a failed terrain transaction', async () => {
    const f = setup(); f.studio.bindRuntime(); const release = f.holdRestart(); f.failRestart();
    const pending = f.studio.handlers.addLane();
    for (const note of [72, 84]) f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note } });
    release(); expect(await pending).to.equal(false);
    const note = () => f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note;
    expect(note()).to.equal(84); await f.studio.handlers.undo(); expect(note()).to.equal(72);
    await f.studio.handlers.undo(); expect(note()).to.equal(60); f.studio.dispose();
  });

  it('keeps concurrent musical edits when a candidate world fails', async () => {
    const f = setup(); f.studio.bindRuntime(); const release = f.holdRestart(); f.failRestart();
    const pending = f.studio.handlers.addLane();
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 84 } });
    release(); expect(await pending).to.equal(false);
    expect(f.studio.getProject().procgen.lanes).to.have.length(1);
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(84);
    await f.studio.handlers.undo(); expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(60); f.studio.dispose();
  });

  it('captures recovery before page suspension and leaves BFCache restoration paused', () => {
    const f = setup(); f.studio.bindRuntime();
    const world = f.runtime.world;
    expect(f.studio.transport.getState().playing).to.equal(true);
    f.window.emit('pagehide', { persisted: true });
    expect(f.runtime.world).to.equal(world);
    expect(f.studio.transport.getState().playing).to.equal(false);
    expect(f.stored.get('__recovery__').world.seed).to.equal(world.seed);
    f.window.emit('pageshow', { persisted: true });
    expect(f.studio.transport.getState().playing).to.equal(false);
    expect(f.statuses.at(-1)).to.include('restored paused');
    f.studio.dispose();
  });

  it('does not treat a restored legacy speed as a new tempo edit on the next control event', async () => {
    const f = setup(); f.studio.bindRuntime(); f.studio.handlers.transport({ bpm: 175 }); const saved = f.studio.capture();
    f.legacy.setSpeed(2); f.elements.get('procgenSpeed').emit('change');
    await f.studio.loadSession(saved);
    expect(f.studio.transport.getState().bpm).to.equal(175);
    f.elements.get('procgenPause').emit('click');
    expect(f.studio.transport.getState().bpm).to.equal(175); f.studio.dispose();
  });

  it('reattaches a saved MIDI input on device reconnection without restarting transport', () => {
    const listeners = new Map(), input = { id: 'keys', state: 'connected', addListener() {}, removeListener() {} };
    const webMidi = { enabled: true, inputs: [input], outputs: [], addListener: (type, fn) => listeners.set(type, fn), removeListener: type => listeners.delete(type) };
    const f = setup({ webMidi }); f.studio.bindRuntime(); f.studio.handlers.input('keys');
    const playing = f.studio.transport.getState().playing;
    input.state = 'disconnected'; listeners.get('disconnected')();
    expect(f.studio.transport.getState().playing).to.equal(playing);
    expect(f.studio.ports.getState().inputLiveness.mode).to.equal('unobserved');
    let attached = 0;
    webMidi.inputs = [{ ...input, state: 'connected', addListener() { attached++; } }]; listeners.get('connected')();
    expect(attached).to.be.greaterThan(0); expect(f.studio.transport.getState().playing).to.equal(playing);
    f.studio.dispose(); expect(listeners.size).to.equal(0);
  });

  it('rolls back a failed lane addition and rebuilds the world when undoing a successful lane edit', async () => {
    const failed = setup(); failed.studio.bindRuntime(); failed.failRestart();
    expect(await failed.studio.handlers.addLane()).to.equal(false);
    expect(failed.studio.getProject().procgen.lanes).to.have.length(1); expect(failed.runtime.world.laneCount).to.equal(1); failed.studio.dispose();
    const f = setup(); f.studio.bindRuntime(); await f.studio.handlers.addLane();
    expect(f.studio.getProject().procgen.lanes).to.have.length(2); expect(f.runtime.world.laneCount).to.equal(2);
    await f.studio.handlers.undo(); expect(f.studio.getProject().procgen.lanes).to.have.length(1); expect(f.runtime.world.laneCount).to.equal(1);
    await f.studio.handlers.redo(); expect(f.studio.getProject().procgen.lanes).to.have.length(2); expect(f.runtime.world.laneCount).to.equal(2); f.studio.dispose();
  });

  it('synchronizes existing pause and speed controls without resuming simulation on every clock pulse', () => {
    const f = setup(); f.studio.bindRuntime(); f.legacy.setPaused(true); f.elements.get('procgenPause').emit('click');
    expect(f.studio.transport.getState().playing).to.equal(false);
    f.legacy.setPaused(false); f.elements.get('procgenPause').emit('click'); expect(f.studio.transport.getState().playing).to.equal(true);
    f.legacy.settings.speed = 2; f.elements.get('procgenSpeedUp').emit('click');
    expect(f.studio.transport.getState().bpm).to.equal(240); expect(f.runtime.world.timer.speedFactor).to.equal(2); f.studio.dispose();
  });
});
