import { expect } from 'chai';
import { createProcgenWorkstation } from '../js/app/procgen/workstation/ProcgenWorkstation.js';
import { createProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createMidiProject } from '../js/midi/project/MidiProject.js';
import { EventHandler } from '../js/util/EventHandler.js';
import { createProcgenRetirementScope } from '../js/app/procgen/ProcgenRetirement.js';

function target() {
  const events = new Map();
  return { addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); }, emit(type, event = {}) { for (const fn of events.get(type) || []) fn(event); } };
}
function setup({ lookaheadMs = 0, webMidi, historyBytesLimit, backend = 'synth', outputId = null } = {}) {
  let time = 0, paused = false, enabled = false;
  const elements = new Map(['procgenPause', 'procgenPanic', 'procgenSpeed', 'procgenSpeedUp', 'procgenSpeedDown', 'procgenSpeedReadout'].map(id => [id, target()]));
  const document = { ...target(), getElementById: id => elements.get(id) || null };
  const values = new Map(), stored = new Map(), calls = [], positions = [], statuses = [], restarts = [], captures = [];
  const window = { WebMidi: webMidi, performance: { now: () => time }, localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    crypto: { getRandomValues(value) { value[0] = 91; } }, prompt: () => 'Test song' };
  const scheduler = { tickMs: 60, sendNote(spec, meta) { calls.push({ spec, meta }); return true; }, allNotesOff() {}, output: { channels: { 1: { sendControlChange() {} } } } };
  const makeRuntime = () => ({ world: { laneCount: 1, seed: 7, timer: { speedFactor: 1 }, frontiers: [100], soundEvents: { onEvent: new EventHandler() } },
    lanes: { setClockDriven(value) { this.clockDriven = value; }, pump(value) { positions.push(value); }, renderer: { camera: { getState: () => ({ cameraX: 45 }), applyState(value) { this.restored = value; } } } },
    view: { midiPreviewRouter: { scheduler, resetClock() {} }, setMidiPreviewRouter(value) { this.midiPreviewRouter = value; } } });
  let runtime = makeRuntime();
  let project = createProcgenWorkstationProject(createMidiProject(), { seed: 7, lanes: [{ mode: 'hybrid', patterns: [{ length: 4, steps: Array.from({ length: 4 }, () => ({ enabled: true, note: 60, duration: 1 })) }] }] });
  const projectListeners = new Set();
  const legacy = { settings: { seed: 7, speed: 1, laneCount: 1 }, getProject: () => project, setProject(value) { project = value; for (const listener of projectListeners) listener(value); },
    subscribeProject(listener) { projectListeners.add(listener); return () => projectListeners.delete(listener); },
    setPaused(value) { paused = value; }, isPaused: () => paused, setSpeed(value) { this.settings.speed = value; },
    local: { getState: () => ({ enabled, selectedBackend: backend, outputId }) } };
  let viewProps;
  const view = { render() {}, renderInspector() {}, transport() {}, recording() {}, status: value => statuses.push(value), showProjects() {}, dispose() { this.disposed = true; } };
  let rejectSave = false, saveCalls = 0;
  const storage = { async save(id, session) { saveCalls++; if (rejectSave) throw new Error('Storage unavailable'); stored.set(id, session); }, async load(id) { return stored.get(id); }, async list() { return [...stored.keys()].map(id => ({ id })); }, close() {} };
  let rejectRestart = false, returnFalseRestart = false, restartGate = null;
  const studio = createProcgenWorkstation({ document, window, legacy, getRuntime: () => runtime,
    restart: async request => { restarts.push(request); if (restartGate) await restartGate; if (request.lease?.signal.aborted || returnFalseRestart) return false; if (rejectRestart) throw new Error('Assets unavailable'); runtime = makeRuntime(); runtime.world.laneCount = request.session?.world.laneCount || legacy.settings.laneCount; runtime.world.seed = request.session?.world.seed ?? legacy.settings.seed; },
    createView: props => { viewProps = props; return view; }, storage,
    captureCheckpoint: world => { captures.push(world); return { version: 1, laneCount: world.laneCount, seed: world.seed, clock: { ...world.timer } }; },
    transportOptions: { driver: { start() {}, stop() {} }, lookaheadMs }, historyBytesLimit
  });
  return { studio, legacy, view, storage, calls, positions, statuses, restarts, stored, captures, elements, window, get runtime() { return runtime; }, get viewProps() { return viewProps; }, get saveCalls() { return saveCalls; },
    enable() { enabled = true; }, time(value) { time = value; studio.transport.pump(); }, failRestart() { rejectRestart = true; }, cancelRestart() { returnFalseRestart = true; }, failSave() { rejectSave = true; },
    holdRestart() { let release; restartGate = new Promise(resolve => { release = resolve; }); return release; } };
}

describe('ProcGen workstation orchestration', () => {
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
    expect(receipt.resources.find(resource => resource.name === 'storage')).to.include({ status: 'failed', error: 'disk closed early' });
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
  it('starts an independent silent transport and routes accepted synth pattern performance only after listening', () => {
    const f = setup(); f.studio.bindRuntime();
    expect(f.runtime.lanes.clockDriven).to.equal(true); expect(f.studio.transport.getState().playing).to.equal(true);
    expect(f.calls).to.have.length(0); f.enable(); f.studio.handlers.record(true); f.time(125);
    expect(f.calls.length).to.be.greaterThan(0); expect(f.calls[0].spec.outputId).to.equal(null);
    expect(f.studio.ports.getRecording().some(event => (event.data[0] & 0xf0) === 0x90)).to.equal(true);
    expect(f.positions).to.include(125); f.studio.dispose(); expect(f.view.disposed).to.equal(true);
  });

  it('hooks replacement routers so game events use the canonical hybrid lane engine', () => {
    const f = setup(); f.studio.bindRuntime(); f.enable();
    const fresh = { scheduler: f.runtime.view.midiPreviewRouter.scheduler, resetClock() {} };
    f.runtime.view.setMidiPreviewRouter(fresh);
    expect(fresh.workstationEventHandler).to.be.a('function');
    expect(fresh.workstationEventHandler({ laneIndex: 0, action: 'building' })).to.equal(true);
    expect(f.calls).to.have.length(0);
    f.runtime.world.soundEvents.onEvent.trigger({ laneIndex: 0, action: 'building' });
    expect(f.calls.some(call => call.meta.source === 'game')).to.equal(true); f.studio.dispose();
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
    let finishFirst;
    const old = f.studio.handlers.import({ text: () => new Promise(resolve => { finishFirst = resolve; }) });
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
    let finishRead;
    const pending = f.studio.handlers.import({ text: () => new Promise(resolve => { finishRead = resolve; }) });
    f.studio.dispose();
    finishRead('{invalid JSON');
    expect(await pending).to.equal(false);
    expect(f.restarts).to.have.length(0);
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

  it('keeps concurrent musical edits when a candidate world fails', async () => {
    const f = setup(); f.studio.bindRuntime(); const release = f.holdRestart(); f.failRestart();
    const pending = f.studio.handlers.addLane();
    f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 84 } });
    release(); expect(await pending).to.equal(false);
    expect(f.studio.getProject().procgen.lanes).to.have.length(1);
    expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(84);
    await f.studio.handlers.undo(); expect(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note).to.equal(60); f.studio.dispose();
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
    input.state = 'disconnected'; listeners.get('disconnected')();
    expect(f.studio.transport.getState().playing).to.equal(false);
    let attached = 0;
    webMidi.inputs = [{ ...input, state: 'connected', addListener() { attached++; } }]; listeners.get('connected')();
    expect(attached).to.be.greaterThan(0); expect(f.studio.transport.getState().playing).to.equal(false);
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
