import { expect } from 'chai';
import { createProcgenWorkstation } from '../js/app/procgen/workstation/ProcgenWorkstation.js';
import { createProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createMidiProject } from '../js/midi/project/MidiProject.js';
import { EventHandler } from '../js/util/EventHandler.js';

function target() {
  const events = new Map();
  return { addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); }, emit(type, event = {}) { for (const fn of events.get(type) || []) fn(event); } };
}
function setup({ lookaheadMs = 0, webMidi } = {}) {
  let time = 0, paused = false, enabled = false;
  const elements = new Map(['procgenPause', 'procgenPanic', 'procgenSpeed', 'procgenSpeedUp', 'procgenSpeedDown', 'procgenSpeedReadout'].map(id => [id, target()]));
  const document = { ...target(), getElementById: id => elements.get(id) || null };
  const values = new Map(), stored = new Map(), calls = [], positions = [], statuses = [], restarts = [];
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
    local: { getState: () => ({ enabled, selectedBackend: 'synth' }) } };
  let viewProps;
  const view = { render() {}, renderInspector() {}, transport() {}, recording() {}, status: value => statuses.push(value), showProjects() {}, dispose() { this.disposed = true; } };
  const storage = { async save(id, session) { stored.set(id, session); }, async load(id) { return stored.get(id); }, async list() { return [...stored.keys()].map(id => ({ id })); }, close() {} };
  let rejectRestart = false, restartGate = null;
  const studio = createProcgenWorkstation({ document, window, legacy, getRuntime: () => runtime,
    restart: async request => { restarts.push(request); if (restartGate) await restartGate; if (rejectRestart) throw new Error('Assets unavailable'); runtime = makeRuntime(); runtime.world.laneCount = request.session?.world.laneCount || legacy.settings.laneCount; runtime.world.seed = request.session?.world.seed ?? legacy.settings.seed; },
    createView: props => { viewProps = props; return view; }, storage,
    captureCheckpoint: world => ({ version: 1, laneCount: world.laneCount, seed: world.seed, clock: { ...world.timer } }),
    transportOptions: { driver: { start() {}, stop() {} }, lookaheadMs }
  });
  return { studio, legacy, view, calls, positions, statuses, restarts, stored, elements, window, get runtime() { return runtime; }, get viewProps() { return viewProps; },
    enable() { enabled = true; }, time(value) { time = value; studio.transport.pump(); }, failRestart() { rejectRestart = true; },
    holdRestart() { let release; restartGate = new Promise(resolve => { release = resolve; }); return release; } };
}

describe('ProcGen workstation orchestration', () => {
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

  it('quantizes consecutive recorded notes into different cells and captures simultaneous notes as a chord', () => {
    const f = setup(); f.studio.bindRuntime(); f.studio.handlers.record(true);
    f.studio.ports.receiveMidi([0x90, 60, 90], 0); f.studio.ports.receiveMidi([0x90, 64, 90], 0);
    f.time(100); f.studio.ports.receiveMidi([0x80, 60, 0], 100); f.studio.ports.receiveMidi([0x80, 64, 0], 100);
    f.time(150); f.studio.ports.receiveMidi([0x90, 72, 95], 150); f.time(200); f.studio.ports.receiveMidi([0x80, 72, 0], 200);
    const steps = f.studio.getProject().procgen.lanes[0].patterns[0].steps;
    expect(steps[0]).to.include({ note: 60, duration: 0.2 }); expect(steps[0].chord.degrees).to.deep.equal([0, 4]);
    expect(steps[1]).to.include({ note: 72, velocity: 95 }); expect(steps[1].duration).to.be.closeTo(0.1, 1e-8); f.studio.dispose();
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
