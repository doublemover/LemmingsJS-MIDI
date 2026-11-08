import { createNativeOscillatorBackend } from '../../js/app/midi-ui/nativeOscillatorBackend.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
import { environment as performanceEnvironment, turn as performanceTurn } from '../helpers/performance-lease.js';
import { expect } from 'chai';
import { EventHandler } from '../../js/util/EventHandler.js';
import { readFileSync } from 'node:fs';
import { BrowserNotePreview, createBrowserNotePreview } from '../../js/app/midi-ui/browserNotePreview.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createProcgenPhysicalPlayback } from '../../js/app/procgen/workstation/ProcgenPhysicalPlayback.js';
import { createProcgenPhysicalScoreClock } from '../../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { createCausalMusicEngine } from '../../js/app/procgen/workstation/CausalMusicEngine.js';


const fixtureBackends = new WeakMap(); let fixtureVoiceSequence = 0;
const admitFixtureTone = async (owner, note, { rawAttack = 100, time } = {}) => {
  let backend = fixtureBackends.get(owner);
  if (!backend) {
    backend = owner.createInstrumentBackend ? owner.createInstrumentBackend() : owner._registerInstrumentBackend(createNativeOscillatorBackend(owner, null), null);
    const patch = { id: 'lifecycle-fixture', revision: 1, engineId: 'native-oscillator', engineVersion: 1, parameters: {}, sampleRefs: [], voicePolicy: { maxVoices: 64 }, mix: { gain01: 0.7, pan01: 0 } };
    const result = await backend.prepare({ status: 'ready', patch, receipt: { patchId: patch.id, revision: 1 } });
    if (result.status !== 'ready') throw new Error(result.reason);
    fixtureBackends.set(owner, backend);
  }
  const context = owner.getAudioContext(), now = owner._nowMs?.() ?? performance.now(), start = context ? context.currentTime + (time == null ? 0 : (time - now) / 1000) : 0;
  const voiceId = 'lifecycle-' + (++fixtureVoiceSequence);
  return backend.begin({ version: 1, kind: 'begin', voiceId, onsetId: voiceId, generation: 1, pitch: { cents: note * 100 }, velocity01: rawAttack / 127, expression: {}, sourceEventIds: ['fixture:physical-onset'] }, Math.max(0, Math.round(start * (context?.sampleRate || 48000)))).status === 'accepted';
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('separate cue workload and graph admission', () => {
  it('exposes only existing shared-mix and owner-effect latency without creating a context to inspect it', async () => {
    let created = 0; const preview = new BrowserNotePreview({ createAudioContext: () => { created++; return new FakeContext(); } }), session = preview.createSession('latency-readout');
    expect(preview.getAudioRuntimeSettingsState().masterLookaheadMs).to.equal(null); expect(created).to.equal(0);
    expect(session.getEffectLatencyState()).to.deep.equal({ latencyFrames: 0, routes: 0, unresolved: false });
    await session.enable(); expect(preview.getAudioRuntimeSettingsState().masterLookaheadMs).to.equal(6); expect(created).to.equal(1);
    await session.dispose(); expect(session.getEffectLatencyState()).to.include({ latencyFrames: null, unresolved: true }); await preview.dispose();
  });
  it('reconciles retired lane source declarations only after the previous producer acknowledges retirement', async () => {
    const context = new FakeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context });
    const live = preview.createSession('source-restart'), neighbor = preview.createSession('source-neighbor');
    await live.enable(); await neighbor.enable(); live.configureLaneSources(['lane-1']);
    const owner = live.getState().ownerId, prior = preview._laneSourcesFor(owner, context), entry = preview._laneSourceBuses.get(owner);
    const gate = deferred(), scope = createProcgenRetirementScope();
    entry.buses = { ...prior, dispose: () => scope.retire([{ name: 'source-buses', run: () => prior.dispose() }, { name: 'producer', run: () => gate.promise }]) };
    const stopped = live.stop();
    expect(() => live.configureLaneSources(['lane-1'])).to.throw('retirement is unresolved');
    expect(preview._laneSourceBuses.get(owner)).to.equal(entry);
    gate.resolve(); await stopped.completion;
    expect(stopped.outcome).to.equal('complete'); expect(await live.enable()).to.equal(true);
    expect(() => live.configureLaneSources(['lane-1'])).not.to.throw();
    expect(preview._laneSourceBuses.get(owner)).not.to.equal(entry);
    expect(neighbor.getState().enabled).to.equal(true);
    await preview.dispose();
  });
  it('keeps a refused source retirement blocked without retiring another owner', async () => {
    const context = new FakeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context });
    const live = preview.createSession('source-fault'), neighbor = preview.createSession('source-fault-neighbor');
    await live.enable(); await neighbor.enable();
    const owner = live.getState().ownerId, prior = preview._laneSourcesFor(owner, context), entry = preview._laneSourceBuses.get(owner);
    entry.buses = { ...prior, dispose() { throw new Error('Native source retirement refused'); } };
    const stopped = live.stop(); await stopped.completion;
    expect(stopped.outcome).to.equal('partial'); expect(await live.enable()).to.equal(false);
    expect(preview._laneSourceBuses.get(owner)).to.equal(entry); expect(neighbor.getState().enabled).to.equal(true);
    entry.buses = prior; await preview.dispose();
  });
  it('publishes bounded master provenance independently of display observers and excludes separate cue', async () => {
    const context = new FakeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, cueVoices: 1 });
    const live = preview.createSession('capture-live'), cue = preview.createSession('capture-cue', { workloadClass: 'cue' });
    await live.enable(); await cue.enable(); const rows = [];
    const release = preview.subscribeCaptureProvenance(row => rows.push(row));
    expect(() => preview.subscribeCaptureProvenance(() => {})).to.throw('unavailable');
    const scoreMapping = Object.freeze({ scoreEpoch: 'score', executionEpoch: 'execution', beat: 2, bpm: 120,
      hostMs: 0, contextSeconds: 0, correlationHostMs: 0, uncertaintyMs: 0, presentationDelayMs: 12 });
    expect(live.setCaptureContext({ worldId: 'world', graphRevision: 3, routeRevision: 2, scoreMapping })).to.equal(true);
    expect(live.setCaptureContext({ worldId: 'world', graphRevision: 3, routeRevision: 2, scoreMapping })).to.equal(false);
    expect(rows).to.have.length(1); expect(rows[0].owners).to.have.length(1);
    expect(rows[0].owners[0].graph.scoreMapping).to.deep.equal(scoreMapping);
    expect(rows[0].owners[0].ownerId).to.equal(live.getState().ownerId);
    release(); live.setCaptureContext({ worldId: 'world', graphRevision: 4, routeRevision: 2, scoreMapping });
    expect(rows).to.have.length(1); await preview.dispose();
  });
  it('rejects an earlier onset that would overlap a committed future note in a one-voice workload', async () => {
    const context = new FakeContext(); context.currentTime = 0;
    const preview = new BrowserNotePreview({ createAudioContext: () => context, nowMs: () => 0, maxVoices: 1 }); await preview.enable();
    expect(await admitFixtureTone(preview, 60, { rawAttack: 100, time: 2000 })).to.equal(true);
    expect(await admitFixtureTone(preview, 64, { rawAttack: 100, time: 1000 })).to.equal(false);
    expect([...preview._voices].map(value => value.note)).to.deep.equal([60]); expect(preview.getState().voiceSteals).to.equal(0); await preview.dispose();
  });
  it('cannot use a one-voice live workload for cue without an explicit additional quota', async () => {
    const context = new FakeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, maxVoices: 1 });
    await preview.enable(); await admitFixtureTone(preview, 60, { rawAttack: 100 });
    const live = [...preview._voices][0], cue = preview.createSession('cue', { workloadClass: 'cue' });
    expect(await cue.enable()).to.equal(false); expect(await admitFixtureTone(cue, 60, { rawAttack: 100 })).to.equal(false);
    expect(preview._voices.has(live)).to.equal(true); expect(preview.getState().voiceSteals).to.equal(0); await preview.dispose();
  });
  it('partitions explicit cue capacity, preserves same-pitch live ownership and stops cue independently', async () => {
    const context = new FakeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, maxVoices: 1, cueVoices: 1 });
    await preview.enable(); await admitFixtureTone(preview, 60, { rawAttack: 100 }); const live = [...preview._voices][0];
    await preview.prepareCueRoute({ mode: 'rehearsal' }); const cue = preview.createSession('cue', { workloadClass: 'cue' });
    expect(await cue.enable()).to.equal(true); await admitFixtureTone(cue, 60, { rawAttack: 100 });
    expect([...preview._voices].filter(voice => voice.workloadClass === 'cue')).to.have.length(1);
    await admitFixtureTone(cue, 61, { rawAttack: 100 }); expect(preview._voices.has(live)).to.equal(true);
    expect(live.stolen).not.to.equal(true); preview.stopCue(); expect(preview._voices.has(live)).to.equal(true);
    expect(preview.getMonitorRouteState()).to.include({ muted: true, mode: 'rehearsal', cueIncludedInMasterCapture: true });
    await preview.dispose();
  });
});

describe('live owner source taps and effect epochs (API fixtures; execution deferred)', () => {
  const sourceGraph = tap => ({ schema: 'lemmings-effect-graph/v1', id: 'fixture.owner-source.' + tap, revision: 1, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 0,
    nodes: [{ id: 'source', kind: 'bus-in', parameters: {} }, { id: 'quiet', kind: 'gain', parameters: { gain01: 0, gainMaximum01: 0 } },
      { id: 'donor', kind: 'sidechain-in', parameters: { sourceBusId: 'owner', tap } }, { id: 'return', kind: 'gain', parameters: { gain01: 0.2, gainMaximum01: 0.2 } }, { id: 'output', kind: 'bus-out', parameters: {} }],
    edges: [['source', 'quiet'], ['quiet', 'output'], ['donor', 'return'], ['return', 'output']].map(([from, to]) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01: 1 })) });
  for (const tap of ['pre-fader', 'post-fader']) it('pins the actual ' + tap + ' source upstream of effects without replacing the dry source route', async () => {
    const context = new FakeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context }), session = preview.createSession('source-tap'); await session.enable();
    const channel = preview._channel(0, session.ownerId || [...preview._sessions.keys()][0]);
    expect(channel.sourceInput.connections).to.deep.equal([channel.gain]); expect(channel.gain.connections).to.deep.equal([channel.pan]);
    const state = await session.prepareEffectGraph(sourceGraph(tap)); expect(state.activeGraph.sidechains[0]).to.include({ sourceBusId: 'owner', tap, connected: true, status: 'connected' });
    const source = tap === 'pre-fader' ? channel.sourceInput : channel.effectInput; expect(source.connections.length).to.be.greaterThan(1);
    const donor = source.connections.at(-1);
    session.setEffectBypass('neutral'); expect(source.connections).not.to.include(donor); expect(channel.sourceInput.connections).to.deep.equal([channel.gain]);
    await session.dispose(); expect(channel.sourceInput.disconnected).to.equal(true); await preview.dispose();
  });
  it('retires an earlier host epoch before preparing new owner sources after stop/re-enable', async () => {
    const context = new FakeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context }), session = preview.createSession('source-epoch'); await session.enable();
    const first = await session.prepareEffectGraph(sourceGraph('pre-fader')); await session.stop()?.completion; await session.enable();
    const second = await session.prepareEffectGraph(sourceGraph('post-fader')); expect(second.generation).to.be.greaterThan(first.generation); expect(second.activeGraph.sidechains[0].tap).to.equal('post-fader');
    await session.dispose(); await preview.dispose();
  });
});

describe('renderer owners and explicit cue source costs', () => {
  it('waits for only the stopped owner and prevents enable from racing its producer retirement', async () => {
    const context = new FakeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context }), stopped = preview.createSession('stopped'), continuing = preview.createSession('continuing');
    await stopped.enable(); await continuing.enable();
    await admitFixtureTone(stopped, 60); await admitFixtureTone(continuing, 64);
    const stoppedId = stopped.getState().ownerId, continuingId = continuing.getState().ownerId, channel = [...preview._channels.values()].find(value => value.owner === stoppedId), release = deferred(), scope = createProcgenRetirementScope(); let disposed = 0;
    channel.effects = { panic() {}, dispose() { disposed++; return scope.retire([{ name: 'latched-body-producer', run: () => release.promise }]); } };
    const receipt = stopped.stop(); expect(receipt.outcome).to.equal('pending'); expect(disposed).to.equal(1); expect([...preview._voices].some(voice => voice.owner === continuingId)).to.equal(true);
    const enabling = stopped.enable(); await Promise.resolve(); expect(stopped.getState().enabled).to.equal(false);
    release.resolve(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(await enabling).to.equal(true); expect(channel.effects).to.equal(null);
    await stopped.dispose(); await continuing.dispose(); await preview.dispose();
  });

  it('retains enough bounded backend owners for the lane router, two candidates and one cue', async () => {
    const preview = new BrowserNotePreview({ createAudioContext: () => new FakeContext() }), session = preview.createSession('renderers');
    const backends = Array.from({ length: 20 }, () => session.createInstrumentBackend());
    expect(() => session.createInstrumentBackend()).to.throw('backend limit'); expect(preview.getState().instrumentBackends).to.equal(20);
    await Promise.all(backends.map(backend => backend.dispose().completion));
    expect(preview.getState().instrumentBackends).to.equal(0); await preview.dispose();
  });
  it('admits one 16-unit cue cloud while enforcing four logical cue gates', async () => {
    const preview = new BrowserNotePreview({ createAudioContext: () => new FakeContext(), maxVoices: 32, cueVoices: 4, cueCostUnits: 16 });
    await preview.enable(); await preview.prepareCueRoute({ mode: 'rehearsal' }); preview.createSession('cloud-cue', { workloadClass: 'cue' });
    const owner = [...preview._sessions.values()].find(session => session.workloadClass === 'cue').id;
    const request = { start: 1, releaseAt: 2, end: 3, cost: 16 };
    expect(preview._inspectVoiceInterval(owner, request).accepted).to.equal(true);
    expect(preview._inspectVoiceInterval(owner, { ...request, cost: 17 }).accepted).to.equal(false);
    for (let index = 0; index < 4; index++) preview._voices.add({ owner, workloadClass: 'cue', start: 1, releaseAt: 2, end: 3, renderCost: 1 });
    expect(preview._inspectVoiceInterval(owner, { ...request, cost: 1 }).accepted).to.equal(false);
    preview._voices.clear(); await preview.dispose();
  });
});

class FakeParam {
  constructor() { this.value = 1; this.events = []; }
  setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); }
  linearRampToValueAtTime(value, time) { this.events.push({ type: 'ramp', value, time }); }
  cancelScheduledValues(time) {
    this.events = this.events.filter(event => event.time < time);
  }
}

class FakeNode {
  constructor() { this.connections = []; this.disconnected = false; }
  connect(target) { this.connections.push(target); }
  disconnect(target) { if (arguments.length) this.connections = this.connections.filter(value => value !== target); else { this.disconnected = true; this.connections = []; } }
}

class FakeOscillator extends FakeNode {
  constructor() {
    super();
    this.frequency = new FakeParam();
    this.detune = new FakeParam();
    this.starts = [];
    this.stops = [];
    this.onended = null;
  }
  start(time) { this.starts.push(time); }
  stop(time) { this.stops.push(time); }
  end() { this.onended?.(); }
}

class FakeContext {
  constructor(state = 'running') {
    this.state = state;
    this.currentTime = 2;
    this.sampleRate = 48000;
    this.destination = {};
    this.oscillators = [];
    this.gains = [];
    this.panners = [];
    this.limiters = [];
    this.compressors = [];
    this.listeners = new Set();
    this.listenerTypes = new Map();
    this.resumeCalls = 0;
    this.closeCalls = 0;
    this.resumeResult = null;
  }
  createGain() {
    const node = new FakeNode();
    node.gain = new FakeParam();
    this.gains.push(node);
    return node;
  }
  createWaveShaper() {
    const node = new FakeNode();
    this.limiters.push(node);
    return node;
  }
  createDynamicsCompressor() {
    const node = new FakeNode();
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new FakeParam();
    node.reduction = 0; this.compressors.push(node); return node;
  }
  createStereoPanner() {
    const node = new FakeNode();
    node.pan = new FakeParam();
    this.panners.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }
  addEventListener(name, callback) { this.listeners.add(callback); this.listenerTypes.set(callback, name); }
  removeEventListener(name, callback) { this.listeners.delete(callback); this.listenerTypes.delete(callback); }
  resume() {
    this.resumeCalls += 1;
    if (this.resumeResult) return this.resumeResult;
    this.state = 'running';
    return Promise.resolve();
  }
  close() { this.closeCalls += 1; this.state = 'closed'; return Promise.resolve(); }
  emit(name) { for (const callback of this.listeners) if (this.listenerTypes.get(callback) === name) callback(); }
  suspend() { this.state = 'suspended'; this.emit('statechange'); }
}

const setup = (options = {}, context = new FakeContext()) => {
  let creations = 0;
  const preview = createBrowserNotePreview({
    createAudioContext: () => { creations += 1; return context; },
    nowMs: () => 1000,
    ...options
  });
  return { preview, context, creations: () => creations };
};

describe('browser audio cross-context performance boundaries', () => {
  it('reports cue and live roles from enabled owners and reacquires after a completed local stop', async () => {
    const f = performanceEnvironment(), a = f.make(), { preview } = setup({ performanceCoordinator: a.lease, cueVoices: 1 });
    const live = preview.createSession('owned-live'); expect(await live.enable()).to.equal(true);
    await preview.prepareCueRoute({ mode: 'rehearsal' }); const cue = preview.createSession('owned-cue', { workloadClass: 'cue' });
    expect(await cue.enable()).to.equal(true); expect(a.lease.state().roles).to.deep.equal(['cue', 'live']);
    await live.stop().completion; expect(a.lease.state().roles).to.deep.equal(['cue']);
    const stopped = preview.stop(); await stopped.completion;
    expect(await preview.enable()).to.equal(true); expect(a.lease.state().roles).to.deep.equal(['live']);
    await preview.dispose(); await a.lease.dispose();
  });
  it('unlocks within the gesture but admits notes and capture only for the winning page', async () => {
    const f = performanceEnvironment(), a = f.make(), b = f.make(), first = setup({ performanceCoordinator: a.lease }, new FakeContext('suspended')),
      second = setup({ performanceCoordinator: b.lease }, new FakeContext('suspended'));
    const enabling = first.preview.enable(); expect(first.context.resumeCalls).to.equal(1); expect(await enabling).to.equal(true);
    const denied = second.preview.enable(); expect(second.context.resumeCalls).to.equal(1); expect(await denied).to.equal(false);
    expect(await admitFixtureTone(second.preview, 60, { rawAttack: 100 })).to.equal(false); expect(second.context.oscillators).to.have.length(0);
    expect(() => second.preview.acquireMasterCaptureTap({ context: second.context, contextEpoch: second.preview.getState().contextEpoch, node: second.context.createGain(), onRetire() {} })).to.throw('unavailable');
    expect(await admitFixtureTone(first.preview, 60, { rawAttack: 100 })).not.to.equal(false);
    await first.preview.dispose(); await second.preview.dispose(); await a.lease.dispose(); await b.lease.dispose();
  });
  it('waits for the actual capture and context stop frontiers before enabling a takeover', async () => {
    const f = performanceEnvironment(), a = f.make(), b = f.make(), first = setup({ performanceCoordinator: a.lease }), second = setup({ performanceCoordinator: b.lease });
    await first.preview.enable(); const captured = deferred(), suspended = deferred(); let tap, suspending = false;
    tap = first.preview.acquireMasterCaptureTap({ context: first.context, contextEpoch: first.preview.getState().contextEpoch, node: first.context.createGain(),
      onRetire: () => captured.promise.then(() => tap.release()) });
    first.context.suspend = () => { suspending = true; return suspended.promise.then(() => { first.context.state = 'suspended'; }); };
    expect(a.lease.state().roles).to.include('capture');
    const incoming = second.preview.takeOverPerformance(); await performanceTurn();
    expect(first.preview.getState().enabled).to.equal(false); expect(second.preview.getState().enabled).to.equal(false); expect(suspending).to.equal(false);
    expect(await admitFixtureTone(first.preview, 62, { rawAttack: 100 })).to.equal(false);
    captured.resolve(); await performanceTurn(); expect(suspending).to.equal(true); expect(second.preview.getState().enabled).to.equal(false);
    suspended.resolve(); expect(await incoming).to.equal(true); expect(first.context.state).to.equal('suspended'); expect(first.preview._pcmCaptureTaps.size).to.equal(0);
    expect(await admitFixtureTone(second.preview, 65, { rawAttack: 100 })).not.to.equal(false);
    await first.preview.dispose(); await second.preview.dispose(); await a.lease.dispose(); await b.lease.dispose();
  });
  it('stays silent and retains the native lock when the old context cannot acknowledge suspension', async () => {
    const f = performanceEnvironment(), a = f.make(), b = f.make(), first = setup({ performanceCoordinator: a.lease }), second = setup({ performanceCoordinator: b.lease });
    await first.preview.enable(); first.context.suspend = () => Promise.reject(new Error('Native suspension refused'));
    expect(await second.preview.takeOverPerformance()).to.equal(false); expect(a.lease.state().status).to.equal('blocked'); expect(f.owned()).to.equal(true);
    expect(second.preview.getState().enabled).to.equal(false); expect(await admitFixtureTone(second.preview, 65, { rawAttack: 100 })).to.equal(false);
    await first.preview.dispose(); await second.preview.dispose(); await a.lease.dispose(); await b.lease.dispose();
  });
  it('refuses handoff when a capture callback settles without detaching its actual tap', async () => {
    const f = performanceEnvironment(), a = f.make(), b = f.make(), first = setup({ performanceCoordinator: a.lease }), second = setup({ performanceCoordinator: b.lease });
    await first.preview.enable(); const tap = first.preview.acquireMasterCaptureTap({ context: first.context, contextEpoch: first.preview.getState().contextEpoch, node: first.context.createGain(), onRetire: async () => {} });
    expect(await second.preview.takeOverPerformance()).to.equal(false); expect(a.lease.state().status).to.equal('blocked'); expect(second.preview.getState().enabled).to.equal(false);
    tap.release(); await first.preview.dispose(); await second.preview.dispose(); await a.lease.dispose(); await b.lease.dispose();
  });
});

describe('main audio runtime replacement and route ownership', () => {
  const turn = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
  const runtimeContext = () => { const context = new FakeContext(); context.sinkId = ''; context.setSinkId = async id => { context.sinkId = id; context.emit('sinkchange'); }; return context; };
  const availability = () => { const listeners = new Map(); return { listeners, addEventListener(type, listener) { listeners.set(type, listener); }, removeEventListener(type) { listeners.delete(type); }, emit(type) { listeners.get(type)?.(); } }; };
  it('stops output and invalidates clocks on a device signal without any sink or context error event', async () => {
    const mediaDevices = availability(), contexts = [], preview = new BrowserNotePreview({ mediaDevices, permissions: null, performanceCoordinator: null, createAudioContext: () => { const context = runtimeContext(); contexts.push(context); return context; } });
    await preview.enable(); const epoch = preview.getState().contextEpoch; await admitFixtureTone(preview, 60, { rawAttack: 90, time: 10000 });
    mediaDevices.emit('devicechange'); expect(preview.getState()).to.include({ enabled: false, activeVoices: 0, status: 'interrupted' }); expect(preview.getState().contextEpoch).to.be.greaterThan(epoch);
    expect(contexts).to.have.length(1); expect(await preview.enable()).to.equal(true); expect(contexts).to.have.length(1);
    expect((await preview.configureAudioRuntime({ latencyProfile: 'balanced' })).status).to.equal('rebuild-ready'); expect(mediaDevices.listeners.size).to.equal(0);
    await preview.enable(); expect(mediaDevices.listeners.size).to.equal(1); await preview.dispose(); expect(mediaDevices.listeners.size).to.equal(0);
  });
  it('cancels a pending native selector on device change while retaining its ownership slot through settlement', async () => {
    const mediaDevices = availability(), context = runtimeContext(), native = deferred(), preview = new BrowserNotePreview({ mediaDevices, permissions: null, performanceCoordinator: null, createAudioContext: () => context }); await preview.enable();
    context.setSinkId = async id => { await native.promise; context.sinkId = id; };
    const pending = preview.configureAudioRuntime({ sinkPreference: 'later-device' }); await turn(); mediaDevices.emit('devicechange');
    expect(preview.getState().audioRuntimeTransition.pending).to.equal(true); expect(await preview.enable()).to.equal(false);
    native.resolve(); expect((await pending).status).to.equal('canceled'); expect(preview.getAudioRuntimeConfig().sinkPreference).to.equal(''); expect(await preview.enable()).to.equal(false); await preview.dispose();
  });
  it('keeps the current browser chooser authoritative across an availability signal while stopping the old output', async () => {
    const mediaDevices = availability(), selection = deferred(), context = runtimeContext(); mediaDevices.selectAudioOutput = () => selection.promise;
    const preview = new BrowserNotePreview({ mediaDevices, permissions: null, performanceCoordinator: null, createAudioContext: () => context }); await preview.enable();
    const pending = preview.chooseAudioOutput(); mediaDevices.emit('devicechange'); expect(preview.getState().enabled).to.equal(false); expect(preview.getState().audioRuntimeTransition.phase).to.equal('selecting');
    selection.resolve({ deviceId: 'fresh-choice' }); expect((await pending).status).to.equal('configured'); expect(preview.getAudioRuntimeConfig().sinkPreference).to.equal('fresh-choice');
    expect(preview.getState().enabled).to.equal(false); expect(await preview.enable()).to.equal(true); await preview.dispose();
  });
  it('does not confuse speaker permission changes with loss of the permitted default output', async () => {
    const status = Object.assign(availability(), { state: 'granted' }), context = runtimeContext(), preview = new BrowserNotePreview({ mediaDevices: availability(), permissions: { query: async () => status }, performanceCoordinator: null, createAudioContext: () => context }); await preview.enable(); await turn();
    status.state = 'denied'; status.emit('change'); expect(preview.getState().enabled).to.equal(true);
    status.state = 'granted'; status.emit('change'); await preview.configureAudioRuntime({ sinkPreference: 'explicit-speaker' }); await preview.enable();
    const epoch = preview.getState().contextEpoch; status.state = 'prompt'; status.emit('change'); expect(preview.getState().enabled).to.equal(false); expect(preview.getState().contextEpoch).to.be.greaterThan(epoch);
    expect(preview.getAudioRuntimeConfig().sinkPreference).to.equal('explicit-speaker'); expect(await preview.enable()).to.equal(false);
    status.state = 'granted'; status.emit('change'); expect(await preview.enable()).to.equal(true); await preview.dispose(); expect(status.listeners.size).to.equal(0);
  });
  it('retires the old graph before a profile/rate commit and rebuilds only on explicit enable', async () => {
    const contexts = [], requests = []; let close;
    const preview = new BrowserNotePreview({ performanceCoordinator: null, createAudioContext: options => { const context = runtimeContext(); contexts.push(context); requests.push(options); return context; } });
    await preview.enable(); const original = contexts[0], oldEpoch = preview.getState().contextEpoch;
    await admitFixtureTone(preview, 60, { rawAttack: 90, time: 10000 });
    original.close = () => { original.closeCalls++; return new Promise(resolve => { close = () => { original.state = 'closed'; resolve(); }; }); };
    const pending = preview.configureAudioRuntime({ latencyProfile: 'robust', preferredSampleRate: 96000 }); await turn();
    expect(preview.getState().audioRuntimeTransition.phase).to.equal('closing'); expect(contexts).to.have.length(1); expect(await preview.enable()).to.equal(false);
    expect(await admitFixtureTone(preview, 64, { rawAttack: 90 })).to.equal(false); expect(preview.getAudioRuntimeConfig().latencyProfile).to.equal('performance');
    close(); expect(await pending).to.include({ status: 'rebuild-ready', requiresEnable: true });
    expect(preview.getAudioContext()).to.equal(null); expect(preview.getState().activeVoices).to.equal(0); expect(original.closeCalls).to.equal(1); expect(original.listeners.size).to.equal(0);
    expect(await preview.enable()).to.equal(true); expect(contexts).to.have.length(2); expect(requests[1]).to.deep.equal({ latencyHint: 'playback', sampleRate: 96000 });
    const state = preview.getState(); expect(state.contextEpoch).to.be.greaterThan(oldEpoch); expect(state.audioRuntime.actualSampleRate).to.equal(48000); expect(state.audioRuntime.config.preferredSampleRate).to.equal(96000);
    expect(state.activeVoices).to.equal(0); await preview.dispose();
  });
  it('commits an acknowledged sink on the existing context and requires fresh admission', async () => {
    const context = runtimeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, performanceCoordinator: null }); await preview.enable();
    const epoch = preview.getState().contextEpoch; expect(await preview.configureAudioRuntime({ sinkPreference: 'selected-private-id' })).to.include({ status: 'configured' });
    expect(preview.getAudioContext()).to.equal(context); expect(context.closeCalls).to.equal(0); expect(preview.getState().enabled).to.equal(false);
    expect(preview.getState().contextEpoch).to.be.greaterThan(epoch); expect(preview.getState().audioRuntime.outputSelection.preferenceObserved).to.equal(true);
    expect(JSON.stringify(preview.getAudioRuntimeSettingsState())).not.to.include('selected-private-id'); expect(await preview.enable()).to.equal(true); await preview.dispose();
  });
  it('keeps denied switches muted on the prior preference without constructing another context', async () => {
    const context = runtimeContext(); context.setSinkId = async () => { throw Object.assign(new Error('device'), { name: 'NotAllowedError' }); };
    const preview = new BrowserNotePreview({ createAudioContext: () => context, performanceCoordinator: null }); await preview.enable();
    expect(await preview.configureAudioRuntime({ sinkPreference: 'denied' })).to.include({ status: 'failed', errorCode: 'NotAllowedError' });
    expect(preview.getState().enabled).to.equal(false); expect(preview.getAudioRuntimeConfig().sinkPreference).to.equal(''); expect(context.closeCalls).to.equal(0);
    expect(await preview.enable()).to.equal(true); await preview.dispose();
  });
  it('retains failed native closure and denies new graph admission until an explicit successful retry', async () => {
    const context = runtimeContext(); context.close = async () => { context.closeCalls++; throw new Error('native close refused'); };
    const preview = new BrowserNotePreview({ createAudioContext: () => context, performanceCoordinator: null }); await preview.enable();
    expect(await preview.configureAudioRuntime({ latencyProfile: 'balanced' })).to.include({ status: 'failed', errorCode: 'ContextRetirementUnconfirmed' });
    expect(preview.getAudioContext()).to.equal(context); expect(await preview.enable()).to.equal(false); expect(preview.getAudioRuntimeConfig().latencyProfile).to.equal('performance');
    context.close = async () => { context.closeCalls++; context.state = 'closed'; };
    expect((await preview.configureAudioRuntime({ latencyProfile: 'balanced' })).status).to.equal('rebuild-ready'); expect(context.closeCalls).to.equal(2); await preview.dispose();
  });
  for (const name of ['sinkchange', 'error']) it('stops owned queues and invalidates calibration after a native ' + name, async () => {
    const context = runtimeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, performanceCoordinator: null }); await preview.enable();
    const epoch = preview.getState().contextEpoch; await admitFixtureTone(preview, 60, { rawAttack: 90, time: 10000 });
    context.emit(name); expect(preview.getState().enabled).to.equal(false); expect(preview.getState().contextEpoch).to.be.greaterThan(epoch); expect(preview.getState().activeVoices).to.equal(0);
    expect(preview.getState().status).to.equal('interrupted'); await preview.dispose(); expect(context.listeners.size).to.equal(0);
  });
  it('keeps native sink ownership through disposal and suppresses late configuration publication', async () => {
    let complete; const context = runtimeContext(); context.setSinkId = id => new Promise(resolve => { complete = () => { context.sinkId = id; resolve(); }; });
    const preview = new BrowserNotePreview({ createAudioContext: () => context, performanceCoordinator: null }); await preview.enable();
    const pending = preview.configureAudioRuntime({ sinkPreference: 'late' }); await turn(); let disposed = false;
    const retirement = preview.dispose().then(() => { disposed = true; }); await turn(); expect(disposed).to.equal(false); expect(context.closeCalls).to.equal(1);
    complete(); expect((await pending).status).to.equal('canceled'); await retirement; expect(disposed).to.equal(true); expect(preview.getAudioRuntimeConfig().sinkPreference).to.equal('');
  });
  it('allows its synchronous controller cleanup to stop again without canceling its own configuration', async () => {
    const context = runtimeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, performanceCoordinator: null }); await preview.enable();
    let stops = 0; preview.registerPerformanceStop(() => { stops++; preview.stop(); });
    expect((await preview.configureAudioRuntime({ latencyProfile: 'balanced' })).status).to.equal('rebuild-ready'); expect(stops).to.equal(1); await preview.dispose();
  });
  it('keeps existing audio enabled while an output chooser is pending and preserves it on denial', async () => {
    let deny; const context = runtimeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, performanceCoordinator: null,
      mediaDevices: { selectAudioOutput: () => new Promise((_yes, no) => { deny = no; }) } }); await preview.enable();
    const epoch = preview.getState().contextEpoch, pending = preview.chooseAudioOutput(); expect(preview.getState().enabled).to.equal(true);
    deny(Object.assign(new Error('selection denied'), { name: 'NotAllowedError' })); expect((await pending).status).to.equal('failed');
    expect(preview.getState().enabled).to.equal(true); expect(preview.getState().contextEpoch).to.equal(epoch); await preview.dispose();
  });
  it('lets an external Stop cancel configuration publication while native closure remains owned', async () => {
    let close; const context = runtimeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, performanceCoordinator: null }); await preview.enable();
    context.close = () => new Promise(resolve => { close = () => { context.state = 'closed'; resolve(); }; });
    const pending = preview.configureAudioRuntime({ latencyProfile: 'balanced' }); await turn(); preview.stop(); close();
    expect((await pending).status).to.equal('canceled'); expect(preview.getAudioRuntimeConfig().latencyProfile).to.equal('performance'); await preview.dispose();
  });
  it('rebuilds a refused native default route without creating another context before explicit enable', async () => {
    const contexts = [], preview = new BrowserNotePreview({ performanceCoordinator: null, createAudioContext: () => { const context = runtimeContext(); contexts.push(context); return context; } }); await preview.enable();
    const old = contexts[0]; old.sinkId = { type: 'none' }; old.emit('sinkchange'); old.setSinkId = async () => { old.emit('error'); throw Object.assign(new Error('missing default'), { name: 'NotFoundError' }); };
    expect((await preview.configureAudioRuntime({})).status).to.equal('rebuild-ready'); expect(old.closeCalls).to.equal(1); expect(contexts).to.have.length(1); expect(preview.getAudioContext()).to.equal(null);
    expect(await preview.enable()).to.equal(true); expect(contexts).to.have.length(2); expect(preview.getState().audioRuntime.outputSelection.preferenceObserved).to.equal(true); await preview.dispose();
  });
  it('rejects fresh admission on a known silent or mismatched route while keeping default-only contexts usable', async () => {
    const context = runtimeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, performanceCoordinator: null }); await preview.enable();
    for (const sink of [{ type: 'none' }, 'foreign-device']) { context.sinkId = sink; context.emit('sinkchange'); expect(await preview.enable()).to.equal(false); expect(preview.getState().enabled).to.equal(false); }
    context.sinkId = ''; expect(await preview.enable()).to.equal(true); await preview.dispose();
    const legacy = new BrowserNotePreview({ createAudioContext: () => new FakeContext(), performanceCoordinator: null }); expect(await legacy.enable()).to.equal(true); await legacy.dispose();
  });
  it('retains the old preference after a partial native refusal and blocks an unintended output', async () => {
    const context = runtimeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, performanceCoordinator: null }); await preview.enable();
    context.setSinkId = async () => { context.sinkId = 'unexpected'; throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); };
    expect((await preview.configureAudioRuntime({ sinkPreference: 'requested' })).status).to.equal('failed'); expect(preview.getAudioRuntimeConfig().sinkPreference).to.equal(''); expect(await preview.enable()).to.equal(false);
    expect(preview.getState().message).to.include('Confirm an available'); await preview.dispose();
  });
  it('returns cancellation during profile closure on disposal and shares the native close', async () => {
    let close; const context = runtimeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, performanceCoordinator: null }); await preview.enable();
    context.close = () => { context.closeCalls++; return new Promise(resolve => { close = () => { context.state = 'closed'; resolve(); }; }); };
    const pending = preview.configureAudioRuntime({ latencyProfile: 'balanced' }); await turn(); const disposed = preview.dispose(); close();
    expect((await pending).status).to.equal('canceled'); await disposed; expect(context.closeCalls).to.equal(1); expect(preview.getAudioRuntimeConfig().latencyProfile).to.equal('performance');
  });
});

describe('BrowserNotePreview', function() {
  for (const boundary of ['channel-release', 'channel-disconnect', 'backend-stop', 'backend-dispose', 'observer-revoke'])
    it(`retires every independent session leaf after ${boundary} fails`, async () => {
      const context = new FakeContext(), ledger = new Map(); let refused = false, releaseAttempts = 0;
      const resourceBudget = { reserve(record) { ledger.set(record.token, record); return { accountedBytes: record.bytes }; },
        release({ token }) {
          if (boundary === 'channel-release' && ledger.get(token)?.kind === 'channel-graph' && !refused) { refused = true; releaseAttempts++; throw new Error('release refused'); }
          ledger.delete(token); return true;
        } };
      const preview = new BrowserNotePreview({ createAudioContext: () => context, resourceBudget });
      const owner = preview.createSession('retired'), cue = preview.createSession('cue'); await owner.enable(); await cue.enable();
      const pcm = owner.reserveDecodedBuffer({ frames: 48000, channels: 2, sampleRate: 48000 });
      preview._channel(0, owner.getState().ownerId);
      const ownerId = owner.getState().ownerId, channel = [...preview._channels.values()].find(value => value.owner === ownerId);
      if (boundary === 'channel-disconnect') channel.gain.disconnect = () => { throw new Error('disconnect refused'); };
      if (boundary.startsWith('backend')) preview._registerInstrumentBackend({
        onOwnerStop() { if (boundary === 'backend-stop') throw new Error('stop refused'); },
        dispose() { if (boundary === 'backend-dispose') throw new Error('backend disposal refused'); }
      }, ownerId);
      if (boundary === 'observer-revoke') preview._observers.revokeOwner = () => { throw new Error('observer revoke refused'); };
      const first = owner.dispose(); expect(owner.dispose()).to.equal(first);
      const receipt = await first;
      expect(receipt.outcome).to.equal('partial'); expect(pcm.isActive()).to.equal(false);
      expect(cue.getState().enabled).to.equal(true); expect(owner.getState().status).to.equal('disposed');
      expect(owner.getState().retirement.outcome).to.equal('partial');
      if (boundary === 'channel-release') {
        expect(releaseAttempts).to.equal(1);
        expect(preview.getState().resourceAccounting.unreconciledReservations).to.equal(1);
        expect([...ledger.values()].some(value => value.kind === 'channel-graph')).to.equal(true);
      }
      await preview.dispose();
      if (boundary === 'channel-release') expect(releaseAttempts).to.equal(1);
    });

  it('retains a shared root receipt and closes unrelated leaves when context close rejects', async () => {
    const context = new FakeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context });
    const owner = preview.createSession('owner'); await owner.enable();
    const pcm = owner.reserveDecodedBuffer({ frames: 48000, channels: 2 });
    context.close = () => { context.closeCalls++; return Promise.reject(new Error('close refused')); };
    const first = preview.dispose(); expect(preview.dispose()).to.equal(first);
    const receipt = await first;
    expect(receipt.outcome).to.equal('partial'); expect(pcm.isActive()).to.equal(false);
    expect(context.closeCalls).to.equal(1); expect(preview.getState()).to.include({ status: 'disposed', unclosedContext: true });
    expect(receipt.resources.find(resource => resource.name === 'context')).to.include({ status: 'failed', error: 'close refused' });
  });
  it('publishes an enable lease before session observers can reenter or cancel activation', async () => {
    const { preview } = setup(); await preview.enable();
    const session = preview.createSession('reentrant-enable'); let nested, reports = 0;
    session.subscribe(() => { reports++; if (!nested) nested = session.enable(); });
    const pending = session.enable();
    expect(nested).to.equal(pending); expect(await pending).to.equal(true); expect(reports).to.equal(3);
    const cancelled = preview.createSession('cancel-enable');
    cancelled.subscribe(state => { if (state.status === 'unlocking') cancelled.stop(); });
    expect(await cancelled.enable()).to.equal(false); expect(cancelled.getState().enabled).to.equal(false);
    expect(session.getState().enabled).to.equal(true); await preview.dispose();
  });

  it('arms the real physical session once and leaves a stopped owner off during root notifications', async () => {
    const { preview } = setup(); await preview.enable(); let reports = 0;
    const release = preview.subscribe(() => { reports++; });
    const playback = createProcgenPhysicalPlayback({ audio: preview, now: () => 1000,
      getGraph: () => ({ version: 1, revision: 1, instruments: [] }), scoreTimeline: createProcgenPhysicalScoreClock() });
    expect(await playback.ready()).to.equal(true); await Promise.resolve();
    expect(playback.diagnostics().enabled).to.equal(true); expect(reports).to.be.lessThan(8);
    playback.stop(); preview.setMasterVolume(0.5); await Promise.resolve();
    expect(playback.diagnostics().enabled).to.equal(false); expect(preview.getState().enabled).to.equal(true);
    expect(reports).to.be.lessThan(12); release(); await playback.dispose(); await preview.dispose();
  });

  const nativePatch = (revision = 1) => ({ status: 'ready', patch: { id: 'native-lifecycle', revision,
    engineId: 'native-oscillator', engineVersion: 1, parameters: { gain01: 0.8, sustain01: 0.6, pan01: 0 },
    sampleRefs: [], voicePolicy: { maxVoices: 8 }, mix: { gain01: 0.7, pan01: 0.1 } },
  receipt: { patchId: 'native-lifecycle', revision } });
  const nativeIntent = (voiceId, generation = 1) => ({ version: 1, kind: 'begin', voiceId, generation,
    pitch: { cents: 6000.001, referenceHz: 440 }, velocity01: 0.7501, expression: {},
    sourceEventIds: ['physical:1'], onsetId: 'onset:' + voiceId, actorId: 'actor:' + voiceId });

  it('moves a queued native release earlier without restarting its onset and ignores later repeats', async () => {
    const { preview, context } = setup({ maxVoices: 8 }), session = preview.createSession('early-end'), backend = session.createInstrumentBackend();
    await backend.prepare(nativePatch()); await session.enable(); context.currentTime = 0;
    expect(backend.begin(nativeIntent('earlier'), 4800).status).to.equal('accepted');
    expect(backend.end('earlier', { seconds: 0.04 }, 19200).status).to.equal('accepted');
    const voice = [...preview._voices][0], source = voice.oscillator;
    expect(voice.releaseAt).to.equal(0.4);
    expect(backend.end('earlier', { seconds: 0.04 }, 9600).status).to.equal('accepted');
    expect(voice.releaseAt).to.equal(0.2); expect(voice.end).to.be.closeTo(0.24, 1e-12); expect(voice.oscillator).to.equal(source);
    expect(backend.end('earlier', { seconds: 0.5 }, 14400).reason).to.equal('already-releasing');
    expect(voice.releaseAt).to.equal(0.2); expect(voice.release).to.equal(0.04); await preview.dispose();
  });

  it('schedules actual travel-derived voices through the strict expression adapter', async () => {
    const { preview, context } = setup({ maxVoices: 8 }), session = preview.createSession('travel'), backend = session.createInstrumentBackend({ gateMode: 'owned' });
    expect((await backend.prepare(nativePatch())).status).to.equal('ready'); await session.enable();
    const execution = backend.registerExecution({ executionEpoch: 'travel:strict', generation: 1 }).execution;
    expect(backend.renewExecutionLease(1, execution, 336000).status).to.equal('accepted');
    const engine = createCausalMusicEngine({ getGraph: () => ({ version: 1, revision: 1, instruments: [{ id: 'spacing', sourceKind: 'MotionCommitted',
      articulation: { spacingPixels: 4, metric: 'endpoint-chord', orientation: 'signedX', lifetimeScope: 'actorJourney' }, pitchCents: 6000, velocity01: 0.6, role: 'texture', route: 'local' }] }) });
    const intents = engine.processBatch({ version: 1, worldId: 'travel', generation: 1, tick: 1, batchId: 'travel:1:1:0', completeness: { status: 'complete', dropped: 0 },
      facts: [{ kind: 'MotionCommitted', actorId: 7, laneId: 0, eventId: 'motion:1', causalSequence: 1, actionInstanceId: '7:action:1',
        positionBefore: { x: 0, y: 10 }, positionAfter: { x: 24, y: 10 }, precision: 'endpoint' }] });
    const attacks = intents.filter(intent => intent.kind === 'begin'); expect(attacks).to.have.length(6);
    expect(attacks.map(intent => backend.begin(intent, 98000, execution).status)).to.deep.equal(Array(6).fill('accepted'));
    expect(context.oscillators).to.have.length(6); expect(attacks.map(intent => intent.articulationState.crossing.position.x)).to.deep.equal([4, 8, 12, 16, 20, 24]);
    await preview.dispose();
  });

  it('owns native FM children under independent same-pitch voices and charges all operator intervals', async () => {
    const budget = createResourceBudget(), { preview, context } = setup({ resourceBudget: budget, maxVoices: 4 });
    const game = preview.createSession('fm'), backend = game.createInstrumentBackend({ engineId: 'native-fm', gateMode: 'owned' });
    const resolution = nativePatch(); resolution.patch = { ...resolution.patch, engineId: 'native-fm', parameters: { modulatorRatio: 2.71, indexStart: 3.5, indexEnd: 0.15 } };
    expect((await backend.prepare(resolution)).status).to.equal('ready'); await game.enable();
    const execution = backend.registerExecution({ executionEpoch: 'fm:independent', generation: 1 }).execution;
    expect(backend.renewExecutionLease(1, execution, 336000).status).to.equal('accepted');
    expect(backend.begin(nativeIntent('a'), 96000, execution)).to.include({ status: 'accepted', sourceCost: 2 });
    expect(backend.begin(nativeIntent('b'), 96000, execution).status).to.equal('accepted'); expect(context.oscillators).to.have.length(4);
    expect(backend.begin(nativeIntent('over-capacity'), 96000, execution).status).to.equal('rejected'); expect(context.oscillators).to.have.length(4);
    expect(backend.update('a', { pitchOffsetCents: 100.001, pressure01: 0.1234 }, 97000, execution).status).to.equal('accepted');
    expect(context.oscillators[0].detune.events.some(event => event.value === 100.001)).to.equal(true);
    expect(context.oscillators[1].detune.events.some(event => event.value === 100.001)).to.equal(true);
    expect(context.oscillators[2].detune.events.some(event => event.value === 100.001)).to.equal(false);
    expect(backend.update('a', { pitchOffsetCents: 300 }, 98000, execution).reason).to.equal('fm-bend-profile-exceeded');
    game.stop(); expect(context.oscillators.every(node => node.disconnected)).to.equal(true); await preview.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('denies a graph before creating an AudioContext when the shared memory budget is full', async () => {
    const budget = createResourceBudget({ limitBytes: 4096 }), { preview, creations } = setup({ resourceBudget: budget });
    expect(await preview.enable()).to.equal(false); expect(creations()).to.equal(0);
    expect(preview.getState().status).to.equal('resource-limited');
    expect(budget.diagnostics().accountedBytes).to.equal(0); await preview.dispose();
  });

  it('denies semantic voice memory before allocation or stealing an already playing voice', async () => {
    const budget = createResourceBudget({ limitBytes: 1024 * 1024 }), { preview, context } = setup({ resourceBudget: budget, maxVoices: 2 });
    const game = preview.createSession('game'), backend = game.createInstrumentBackend();
    await backend.prepare(nativePatch()); await game.enable();
    expect(backend.begin(nativeIntent('first'), 96000).status).to.equal('accepted');
    const first = [...preview._voices][0], token = {};
    budget.reserve({ token, owner: 'competing-renderer', category: 'audio', bytes: Math.floor((1024 * 1024 - budget.diagnostics().accountedBytes - 4096) / 1.25) });
    expect(backend.begin(nativeIntent('second'), 96000).reason).to.equal('audio-resource-budget');
    expect(context.oscillators).to.have.length(1); expect(first.stolen).not.to.equal(true);
    expect(preview._voices.has(first)).to.equal(true);
    budget.release({ token, owner: 'competing-renderer' });
    await preview.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('denies a required channel before allocating semantic oscillators and releases the voice reservation', async () => {
    const budget = createResourceBudget({ limitBytes: 128 * 1024 }), { preview, context } = setup({ resourceBudget: budget });
    const game = preview.createSession('game'), backend = game.createInstrumentBackend();
    await backend.prepare(nativePatch()); await game.enable(); const before = budget.diagnostics().accountedBytes;
    expect(backend.begin(nativeIntent('denied'), 96000).reason).to.equal('audio-resource-budget');
    expect(context.oscillators).to.have.length(0); expect(budget.diagnostics().accountedBytes).to.equal(before);
    await preview.dispose();
  });

  it('revokes decoded buffer leases only when their owning session is disposed', async () => {
    const budget = createResourceBudget(), { preview } = setup({ resourceBudget: budget });
    const game = preview.createSession('game'), cue = preview.createSession('cue');
    const a = game.reserveDecodedBuffer({ frames: 1000, channels: 1 }), b = cue.reserveDecodedBuffer({ frames: 1000, channels: 2 });
    await game.dispose(); expect(a.isActive()).to.equal(false); expect(b.isActive()).to.equal(true);
    await preview.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('keeps semantic pressure independent from its envelope and MIDI compatibility controls', async () => {
    const { preview, context } = setup(), game = preview.createSession('game'), backend = game.createInstrumentBackend();
    await backend.prepare(nativePatch()); await game.enable();
    backend.begin(nativeIntent('a'), 96000);
    const voice = [...preview._voices][0], envelope = [...voice.gain.gain.events];
    expect(backend.update('a', { pressure01: 0.5001, pitchOffsetCents: 100.001, pan01: -0.2 }, 98400).status).to.equal('accepted');
    expect(voice.gain.gain.events).to.deep.equal(envelope);
    expect(voice.pressureGain.gain.events.at(-1)).to.include({ type: 'ramp', value: 0.5001 });
    expect(voice.pressureGain.gain.events.at(-1).time).to.be.closeTo(2.058, 1e-12);
    const pitch = [...voice.oscillator.detune.events];
    expect(game).not.to.have.property('output');
    expect(voice.oscillator.detune.events).to.deep.equal(pitch);
    expect(voice.pan.pan.events.at(-1).value).to.be.closeTo(-0.1, 1e-12);
    expect(backend.end('a', { seconds: 0.04 }, 100800).status).to.equal('accepted');
    expect(voice.gain.gain.events.at(-1)).to.include({ type: 'ramp', value: 0 });
    expect(context.oscillators[0].stops.at(-1)).to.be.closeTo(2.14, 1e-12);
    await preview.dispose();
  });

  it('rejects an overflowing expression batch without applying its other controls', async () => {
    const { preview } = setup(), game = preview.createSession('game'), backend = game.createInstrumentBackend({ maxControlEvents: 1 });
    await backend.prepare(nativePatch()); await game.enable(); backend.begin(nativeIntent('a'), 96000);
    backend.update('a', { pressure01: 0.5 }, 98400);
    const voice = [...preview._voices][0], pitch = [...voice.oscillator.detune.events];
    expect(backend.update('a', { pressure01: 0.25, pitchOffsetCents: 20 }, 100800).reason).to.equal('expression-queue-full');
    expect(voice.oscillator.detune.events).to.deep.equal(pitch);
    expect(backend.end('a', { seconds: 0.04 }, 100800).status).to.equal('accepted');
    await preview.dispose();
  });

  it('holds a stationary owned voice for 60 seconds using authoritative liveness without expression updates', async () => {
    const { preview, context } = setup(), game = preview.createSession('game'), backend = game.createInstrumentBackend({ gateMode: 'owned' });
    await backend.prepare(nativePatch()); await game.enable();
    expect(backend.begin(nativeIntent('drone'), 96000).reason).to.equal('execution-lease-required');
    expect(backend.renewExecutionLease(1, 'live', 70 * 48000).status).to.equal('accepted');
    expect(backend.begin(nativeIntent('drone'), 96000).status).to.equal('accepted');
    const voice = [...preview._voices][0]; context.currentTime = 62;
    expect(preview._voiceFinished(voice)).to.equal(false);
    expect(backend.renderDiagnostics({ includeVoices: true }).voices[0]).to.include({ state: 'held', voiceId: 'drone', modeledParameters: true });
    expect(backend.end('drone', { seconds: 0.04 }, 62 * 48000).status).to.equal('accepted');
    voice.oscillator.end(); expect(backend.renderDiagnostics().activeVoices).to.equal(0);
    expect(voice.pressureGain.disconnected).to.equal(true);
    await preview.dispose();
  });

  it('renews only the matching owner execution lease and reports watchdog termination as a sink outcome', async () => {
    const { preview, context } = setup(), game = preview.createSession('game'), backend = game.createInstrumentBackend({ gateMode: 'owned' });
    await backend.prepare(nativePatch()); await game.enable();
    backend.renewExecutionLease(1, 'live', 4 * 48000); backend.renewExecutionLease(1, 'cue', 5 * 48000);
    backend.begin(nativeIntent('same'), 96000, 'live'); backend.begin(nativeIntent('same'), 96000, 'cue');
    context.currentTime = 3; backend.renewExecutionLease(1, 'live', 70 * 48000);
    const voices = [...preview._voices]; expect(voices.map(voice => voice.end)).to.deep.equal([70, 5]);
    context.currentTime = 5; voices[1].oscillator.end();
    expect(backend.renderDiagnostics().activeVoices).to.equal(1);
    expect(backend.renderDiagnostics({ includeTraces: true }).traces.at(-1)).to.include({ executionEpoch: 'cue', reason: 'owner-lease-expired' });
    await preview.dispose();
  });

  it('snapshots patch revisions, cancels stale preparations and retains the previous sound', async () => {
    const { preview } = setup(), game = preview.createSession('game'), backend = game.createInstrumentBackend();
    const resolution = nativePatch(); await backend.prepare(resolution); resolution.patch.mix.gain01 = 0;
    await game.enable(); backend.begin(nativeIntent('old'), 96000);
    expect([...preview._voices][0].basePeak).to.be.closeTo(0.7501 * 0.7, 1e-12);
    const replacement = backend.prepare(nativePatch(2)); game.stop();
    expect((await replacement).reason).to.equal('preparation-cancelled');
    expect(backend.renderDiagnostics().patchRevision).to.equal(1);
    await preview.dispose();
  });

  it('bounds semantic traces and keeps scheduled cancellation separate from rendering acknowledgment', async () => {
    const { preview } = setup(), game = preview.createSession('game'), backend = game.createInstrumentBackend({ traceLimit: 2 });
    await backend.prepare(nativePatch()); await game.enable(); backend.begin(nativeIntent('a'), 100800);
    backend.update('a', { pressure01: 0.7 }, 101280);
    const cancellation = backend.cancelGenerationWithReceipt(1, 'live');
    expect(cancellation.outcomes[0]).to.include({ stage: 'scheduled-cancellation-requested', beforeOnset: true,
      appliedFrame: null, renderedStatus: 'unknown', acousticReceipt: false });
    const diagnostics = backend.renderDiagnostics({ includeTraces: true });
    expect(diagnostics.traceCount).to.equal(2); expect(diagnostics.truncatedTraces).to.be.greaterThan(0);
    expect(diagnostics.activeVoices).to.equal(0);
    await preview.dispose();
  });

  it('keeps a cancelled generation immutable while a separate execution can replay its historical intent', async () => {
    const { preview } = setup(), game = preview.createSession('game'), backend = game.createInstrumentBackend();
    await backend.prepare(nativePatch()); await game.enable();
    expect(preview.getAudioContext()).to.equal(preview._context);
    backend.begin(nativeIntent('a'), 100800, 'live'); backend.cancelGeneration(1, 'live');
    expect(backend.begin(nativeIntent('a'), 100800, 'live').reason).to.equal('generation-cancelled');
    expect(backend.renewExecutionLease(1, 'live', 70 * 48000).reason).to.equal('generation-cancelled');
    expect(backend.begin(nativeIntent('a'), 100800, 'replay').status).to.equal('accepted');
    await preview.dispose();
  });

  it('keeps owner capture leases private while a separate mix observer sees both owners', async () => {
    const { preview } = setup(), game = preview.createSession('game'), cue = preview.createSession('cue');
    const a = [], b = [], mix = []; let project = 'A';
    game.setCapture({ record(stage, fields) { a.push({ stage, ...fields }); } }, () => ({ projectId: project }));
    cue.setCapture({ record(stage, fields) { b.push({ stage, ...fields }); } }, { projectId: 'B' });
    const detachMix = preview.observeMix({ record(stage, fields) { mix.push({ stage, ...fields }); } });
    await game.enable(); await cue.enable(); await admitFixtureTone(game, 60, { voiceToken: 1 });
    project = 'replacement'; cue.setCapture(null);
    const voice = [...preview._voices][0]; voice.oscillator.end();
    expect(a.filter(record => record.stage === 'synth-end')[0]).to.include({ projectId: 'A', owner: game.getState().ownerId });
    expect(b).to.have.length(0); expect(mix.map(record => record.stage)).to.include('synth-end');
    expect(a.every(record => record.projectId === 'A')).to.equal(true);
    detachMix(); await game.dispose(); expect(preview._observers.diagnostics().leases).to.equal(0);
    await preview.dispose();
  });

  it('replaces a closed context on the next explicit enable and invalidates old execution leases', async () => {
    const first = new FakeContext(), second = new FakeContext(), contexts = [first, second];
    first.resume = () => Promise.reject(new Error('A closed context cannot resume.'));
    const preview = createBrowserNotePreview({ createAudioContext: () => contexts.shift(), nowMs: () => 1000 });
    const game = preview.createSession('game'), backend = game.createInstrumentBackend({ gateMode: 'owned' });
    await backend.prepare(nativePatch()); expect(await game.enable()).to.equal(true);
    backend.renewExecutionLease(1, 'live', 70 * 48000); backend.begin(nativeIntent('old'), 96000);
    await first.close(); expect(await game.enable()).to.equal(true);
    expect(preview.getState().contextEpoch).to.equal(2); expect(first.oscillators[0].disconnected).to.equal(true);
    expect(backend.begin(nativeIntent('new'), 96000).reason).to.equal('execution-lease-required');
    expect(backend.renewExecutionLease(1, 'live', 70 * 48000).status).to.equal('accepted');
    expect(backend.begin(nativeIntent('new'), 96000).status).to.equal('accepted');
    expect(second.oscillators).to.have.length(1);
    await preview.dispose();
  });

  it('does not renew an owned gate after its safety release has already started', async () => {
    const { preview, context } = setup(), game = preview.createSession('game'), backend = game.createInstrumentBackend({ gateMode: 'owned' });
    await backend.prepare(nativePatch()); await game.enable(); backend.renewExecutionLease(1, 'live', 3 * 48000);
    backend.begin(nativeIntent('held'), 96000); context.currentTime = 2.99;
    expect(backend.renewExecutionLease(1, 'live', 70 * 48000).reason).to.equal('execution-lease-too-late');
    expect([...preview._voices][0].end).to.equal(3);
    await preview.dispose();
  });

  it('cleans every partially initialized semantic component when scheduling fails before registration', async () => {
    const { preview, context } = setup(), game = preview.createSession('game'), backend = game.createInstrumentBackend();
    await backend.prepare(nativePatch()); await game.enable();
    const create = context.createOscillator.bind(context);
    context.createOscillator = () => {
      const oscillator = create(); oscillator.frequency.setValueAtTime = () => { throw new Error('AudioParam failure'); }; return oscillator;
    };
    preview._channel(0, game.getState().ownerId);
    const firstGain = context.gains.length;
    expect(backend.begin(nativeIntent('failed'), 96000).reason).to.equal('backend-failure');
    expect(preview._voices.size).to.equal(0); expect(context.oscillators[0].disconnected).to.equal(true);
    expect(context.gains.slice(firstGain).every(gain => gain.disconnected)).to.equal(true);
    expect(backend.renderDiagnostics().deliveryErrors).to.equal(1);
    await preview.dispose();
  });

  it('terminates only the failed admitted voice when continuous automation throws', async () => {
    const { preview } = setup(), game = preview.createSession('game'), backend = game.createInstrumentBackend();
    await backend.prepare(nativePatch()); await game.enable(); backend.begin(nativeIntent('a'), 96000); backend.begin(nativeIntent('b'), 96000);
    const [a, b] = [...preview._voices];
    a.pressureGain.gain.setValueAtTime = () => { throw new Error('AudioParam failure'); };
    expect(backend.update('a', { pressure01: 0.5 }, 98400).reason).to.equal('backend-failure-after-acceptance');
    expect(preview._voices.has(a)).to.equal(false); expect(preview._voices.has(b)).to.equal(true);
    expect(backend.renderDiagnostics().activeVoices).to.equal(1);
    expect(backend.renderDiagnostics({ includeTraces: true }).traces.some(trace => trace.reason === 'backend-failure-after-acceptance')).to.equal(true);
    await preview.dispose();
  });

  it('plays independent same-pitch semantic voices with precise per-voice expression in the shared mix', async () => {
    const { preview, context } = setup();
    const game = preview.createSession('game'), backend = game.createInstrumentBackend();
    const resolution = { status: 'ready', patch: { id: 'native-test', revision: 1, engineId: 'native-oscillator', engineVersion: 1,
      parameters: { waveform: 2, gain01: 0.8, pan01: 0 }, sampleRefs: [], voicePolicy: { maxVoices: 8 },
      mix: { gain01: 0.6, pan01: 0 } }, receipt: { patchId: 'native-test', revision: 1 } };
    const intent = (voiceId, cents = 6000.123) => ({ version: 1, kind: 'begin', voiceId, generation: 1,
      laneId: 0, pitch: { cents, referenceHz: 440 }, velocity01: 0.7001, expression: {}, role: 'lead', sourceEventIds: ['source:1'] });
    expect(backend.begin(intent('same'), 96000).reason).to.equal('patch-unprepared');
    expect((await backend.prepare(resolution)).status).to.equal('ready');
    expect(backend.begin(intent('same'), 96000).reason).to.equal('audio-not-ready');
    await game.enable();
    expect(backend.begin(intent('same'), 96000, 'live').status).to.equal('accepted');
    expect(backend.begin(intent('same'), 96000, 'cue').status).to.equal('accepted');
    const secondBackend = game.createInstrumentBackend(); await secondBackend.prepare(resolution);
    expect(secondBackend.begin(intent('same'), 96000, 'live').reason).to.equal('duplicate-owner-voice');
    expect(context.oscillators).to.have.length(2);
    expect(context.oscillators[0].frequency.events[0].value).to.be.closeTo(440 * 2 ** ((6000.123 - 6900) / 1200), 1e-10);
    expect(backend.update('same', { pitchOffsetCents: 0.001, pressure01: 0.5001, pan01: -0.25 }, 96000, 'cue').status).to.equal('accepted');
    expect(context.oscillators[1].detune.events.at(-1).value).to.equal(0.001);
    expect(context.oscillators[0].detune.events.at(-1).value).to.equal(0);
    expect(backend.end('same', { seconds: 0.05 }, 96000, 'cue').status).to.equal('accepted');
    expect(backend.renderDiagnostics().activeVoices).to.equal(1);
    expect(backend.end('same', { seconds: 0.05 }, 96000, 'live').status).to.equal('accepted');
    expect(backend.renderDiagnostics().activeVoices).to.equal(0);
    expect(backend.begin(intent('strike'), 96000, 'live').status).to.equal('accepted');
    expect(backend.end('strike', { mode: 'one-shot', tailSeconds: 0.08, seconds: 0.04 }, 96000, 'live').status).to.equal('accepted');
    const strike = [...preview._voices].find(voice => voice.playback?.voiceId === 'strike');
    expect(strike.releaseAt).to.be.closeTo(2.08, 1e-10);
    backend.dispose(); secondBackend.dispose(); await preview.dispose();
  });

  it('keeps the prepared native patch after a failed replacement and isolates owner Stop', async () => {
    const { preview } = setup(), game = preview.createSession('game'), audition = preview.createSession('audition');
    const backend = game.createInstrumentBackend();
    const resolution = { status: 'ready', patch: { id: 'native-test', revision: 1, engineId: 'native-oscillator', engineVersion: 1,
      parameters: { waveform: 1 }, sampleRefs: [], voicePolicy: { maxVoices: 8 }, mix: { gain01: 1, pan01: 0 } },
    receipt: { patchId: 'native-test', revision: 1 } };
    expect((await backend.prepare(resolution)).status).to.equal('ready');
    expect((await backend.prepare({ ...resolution, patch: { ...resolution.patch, parameters: { unsupported: 1 } } })).status).to.equal('rejected');
    await game.enable(); await audition.enable();
    expect(backend.begin({ version: 1, kind: 'begin', voiceId: 'a', generation: 1, laneId: 0,
      pitch: { cents: 6000, referenceHz: 440 }, velocity01: 0.5, expression: {}, sourceEventIds: [] }, 96000).status).to.equal('accepted');
    expect(await admitFixtureTone(audition, 60)).to.equal(true);
    expect(preview._voices.size).to.equal(2);
    game.stop();
    expect(backend.renderDiagnostics().activeVoices).to.equal(0);
    expect(preview._voices.size).to.equal(1);
    backend.dispose(); await preview.dispose();
  });

  it('reports late semantic attacks instead of silently clamping their render time', async () => {
    const { preview, context } = setup(), game = preview.createSession('game'), backend = game.createInstrumentBackend();
    const resolution = { status: 'ready', patch: { id: 'late-test', revision: 1, engineId: 'native-oscillator', engineVersion: 1,
      parameters: {}, sampleRefs: [], voicePolicy: { maxVoices: 8 }, mix: { gain01: 1, pan01: 0 } },
    receipt: { patchId: 'late-test', revision: 1 } };
    await backend.prepare(resolution); await game.enable();
    const intent = voiceId => ({ version: 1, kind: 'begin', voiceId, generation: 1, laneId: 0,
      pitch: { cents: 6000, referenceHz: 440 }, velocity01: 0.5, expression: {}, sourceEventIds: [] });
    expect(backend.begin(intent('expired'), 90000).reason).to.equal('late-attack');
    expect(context.oscillators).to.have.length(0);
    expect(backend.begin(intent('held'), 96000).status).to.equal('accepted');
    context.currentTime = 2.1;
    expect(backend.update('held', { pressure01: 0.5 }, 96000).reason).to.equal('stale-expression');
    expect(backend.end('held', { seconds: 0.04 }, 96000)).to.include({ status: 'accepted', repair: 'late-release' });
    backend.dispose(); await preview.dispose();
  });

  it('cancels only the selected semantic execution generation and reports unsupported expression', async () => {
    const { preview } = setup(), game = preview.createSession('game'), backend = game.createInstrumentBackend();
    const resolution = { status: 'ready', patch: { id: 'native-test', revision: 1, engineId: 'native-oscillator', engineVersion: 1,
      parameters: {}, sampleRefs: [], voicePolicy: { maxVoices: 8 }, mix: { gain01: 1, pan01: 0 } },
    receipt: { patchId: 'native-test', revision: 1 } };
    await backend.prepare(resolution); await game.enable();
    const intent = voiceId => ({ version: 1, kind: 'begin', voiceId, generation: 1, laneId: 0,
      pitch: { cents: 6000, referenceHz: 440 }, velocity01: 0.5, expression: {}, sourceEventIds: [] });
    expect(backend.begin(intent('voice'), 96000, 'live').status).to.equal('accepted');
    expect(backend.begin(intent('voice'), 96000, 'cue').status).to.equal('accepted');
    expect(backend.update('voice', { timbre01: 0.5 }, 96000, 'live')).to.include({ status: 'degraded', reason: 'unsupported-expression' });
    expect(backend.cancelGeneration(1, 'cue')).to.equal(1);
    expect(backend.renderDiagnostics().activeVoices).to.equal(1);
    expect(backend.end('voice', { seconds: 0.04 }, 96000, 'live').status).to.equal('accepted');
    backend.dispose(); await preview.dispose();
  });

  it('coalesces owner unlock requests and cancels replaced requests while another owner is waiting', async () => {
    const context = new FakeContext('suspended'), pending = deferred(); context.resumeResult = pending.promise;
    const { preview } = setup({}, context), game = preview.createSession('game'), audition = preview.createSession('audition');
    const gameReady = game.enable(); expect(game.enable()).to.equal(gameReady);
    const replaced = [];
    for (let i = 0; i < 12; i++) {
      replaced.push(audition.enable()); expect(preview._pendingEnables.size).to.equal(2);
      audition.stop(); expect(preview._pendingEnables.size).to.equal(1);
    }
    expect((await Promise.all(replaced)).every(value => value === false)).to.equal(true);
    context.state = 'running'; pending.resolve(); expect(await gameReady).to.equal(true);
    expect(context.resumeCalls).to.equal(1); expect(preview._pendingEnables.size).to.equal(0); await preview.dispose();
  });

  it('shares one graph and budget while isolating semantic same-pitch owners and Stop', async function() {

    const { preview, context } = setup({ maxVoices: 2 }), game = preview.createSession('game'), audition = preview.createSession('audition');
    const a = game.createInstrumentBackend(), b = audition.createInstrumentBackend(); await a.prepare(nativePatch()); await b.prepare(nativePatch()); await game.enable(); await audition.enable();
    expect(a.begin({ ...nativeIntent('same'), expression: { pan01: -0.5 } }, 96000).status).to.equal('accepted');
    expect(b.begin({ ...nativeIntent('same'), expression: { pan01: 0.5 } }, 96000).status).to.equal('accepted');
    expect(context.oscillators).to.have.length(2); const voices = [...preview._voices];
    expect(b.update('same', { pitchOffsetCents: 1200, pressure01: 0.25 }, 96000).status).to.equal('accepted'); expect(context.oscillators[0].detune.events.at(-1).value).to.equal(0); expect(context.oscillators[1].detune.events.at(-1).value).to.equal(1200);
    expect(b.begin(nativeIntent('overflow'), 96000).status).to.equal('rejected'); expect([...preview._voices]).to.deep.equal(voices);
    await audition.stop().completion; expect(a.renderDiagnostics().activeVoices).to.equal(1); expect(b.renderDiagnostics().activeVoices).to.equal(0); await preview.dispose();

  });

  it('cancels one pending owner unlock without canceling or resurrecting the other owner', async () => {
    const context = new FakeContext('suspended'), pending = deferred(); context.resumeResult = pending.promise;
    const { preview } = setup({}, context);
    const game = preview.createSession('game'), audition = preview.createSession('audition');
    const gameReady = game.enable(), auditionReady = audition.enable();
    audition.stop(); expect(await auditionReady).to.equal(false);
    context.state = 'running'; pending.resolve(); expect(await gameReady).to.equal(true);
    expect(context.resumeCalls).to.equal(1); expect(game.getState().enabled).to.equal(true); expect(audition.getState().enabled).to.equal(false);
    await audition.dispose(); expect(game.getState().enabled).to.equal(true); await preview.dispose();
  });

  it('reports semantic admission, exact release frames and owner panic without invalid voices', async function() {

    const { preview, context } = setup(), game = preview.createSession('reporting'), backend = game.createInstrumentBackend(); await backend.prepare(nativePatch());
    expect(backend.begin(nativeIntent('off'), 96000).status).to.equal('rejected'); await game.enable();
    expect(backend.begin({ ...nativeIntent('invalid'), pitch: { cents: NaN } }, 96000).status).to.equal('rejected'); expect(context.oscillators).to.have.length(0);
    expect(backend.begin(nativeIntent('valid'), 100800)).to.include({ status: 'accepted', targetFrame: 100800 });
    expect(backend.end('valid', { seconds: 0.04 }, 108000).status).to.equal('accepted'); expect(context.oscillators[0].stops.at(-1)).to.equal(2.29);
    await game.stop().completion; expect(preview._voices.size).to.equal(0); await preview.dispose();

  });
  it('offers an explicit 12 dB local boost through a bounded output ceiling without changing semantic source gain', async function() {

    const { preview, context } = setup({ masterVolume: 4 });
    await preview.enable();
    expect(context.gains[0].gain.value).to.equal(0.6);
    const limiter = context.limiters[0];
    expect(context.gains[0].connections).to.deep.equal([context.compressors[0]]);
    expect(context.compressors[0].connections).to.deep.equal([context.gains[1]]);
    expect(context.gains[1].gain.value).to.equal(0.647);
    expect(context.gains[1].connections).to.deep.equal([limiter]);
    expect(context.compressors[0].threshold.value).to.equal(-9);
    expect(context.compressors[0].ratio.value).to.equal(12);
    expect(context.compressors[0].attack.value).to.equal(0.001);
    expect(context.compressors[0].release.value).to.equal(0.08);
    expect(limiter.connections).to.deep.equal([context.destination]);
    expect(Math.max(...limiter.curve.map(Math.abs))).to.be.lessThan(0.9);
    expect(limiter.curve[2048 + 512]).to.equal(0.25);
    expect(await admitFixtureTone(preview, 60, { rawAttack: 127 })).to.equal(true);
    expect([...preview._voices][0].peak).to.equal(0.7);
    await preview.dispose();
    expect(limiter.disconnected).to.equal(true);
    expect(context.compressors[0].disconnected).to.equal(true);
    expect(context.gains[1].disconnected).to.equal(true);

  });
  it('mutes the compressor lookahead on Panic and reopens only after its bounded delay', async function() {

    const { preview, context } = setup(); await preview.enable();
    const fixed = context.gains[1].gain;
    expect(await admitFixtureTone(preview, 60)).to.equal(true);
    context.currentTime = 2.1; preview.panic();
    expect(fixed.events.at(-1)).to.deep.equal({ type: 'set', value: 0, time: 2.1 });
    expect(preview._voices.size).to.equal(0);
    expect(preview.getState()).to.include({ masterVolume: 0.7, mixLatencyMs: 6 });
    await preview.enable();
    expect(fixed.events.at(-1)).to.deep.equal({ type: 'set', value: 0.647, time: 2.106 });
    await preview.dispose();

  });

  it('retains the output ceiling on a backend without mix compression capability', async () => {
    const context = new FakeContext(); context.createDynamicsCompressor = undefined;
    const { preview } = setup({}, context); expect(await preview.enable()).to.equal(true);
    expect(context.gains[0].connections).to.deep.equal([context.limiters[0]]);
    expect(preview.getState().mixCompression).to.equal(false); await preview.dispose();
  });

  it('keeps master volume changes inert until enabled and applies the 70% default below the safe gain cap', async function() {
    const { preview, context, creations } = setup();
    expect(preview.getState().masterVolume).to.equal(0.7);
    expect(preview.setMasterVolume(0.4)).to.equal(0.4);
    expect(creations()).to.equal(0);
    expect(await preview.enable()).to.equal(true);
    expect(context.gains[0].gain.value).to.be.closeTo(0.15 * 0.4, 0.000001);
    await preview.dispose();
    const defaults = setup();
    await defaults.preview.enable();
    expect(defaults.context.gains[0].gain.value).to.be.closeTo(0.15 * 0.7, 0.000001);
    await defaults.preview.dispose();
  });

  it('ramps master gain to mute without changing semantic voice envelopes or expression', async function() {

    const { preview, context } = setup(); await preview.enable(); expect(await admitFixtureTone(preview, 60)).to.equal(true);
    const voice = [...preview._voices][0], envelope = [...voice.gain.gain.events], pressure = voice.pressureAutomation.valueAt(context.currentTime), master = context.gains[0].gain;
    expect(preview.setMasterVolume(0)).to.equal(0); expect(master.events.at(-1)).to.deep.equal({ type: 'ramp', value: 0, time: context.currentTime + 0.015 }); expect(preview.getState()).to.include({ enabled: true, masterVolume: 0, activeVoices: 1 });
    expect(preview.setMasterVolume(1)).to.equal(1); expect(master.events.filter(event => event.type === 'ramp')).to.have.length(1); expect(master.events.at(-1).value).to.equal(0.15);
    expect(voice.gain.gain.events).to.deep.equal(envelope); expect(voice.pressureAutomation.valueAt(context.currentTime)).to.equal(pressure); expect(preview.getState().activeVoices).to.equal(1); await preview.dispose();

  });

  it('holds an in-progress master ramp when the browser supports cancelAndHoldAtTime', async function() {
    const { preview, context } = setup();
    await preview.enable();
    const master = context.gains[0].gain;
    const held = [];
    master.cancelAndHoldAtTime = time => held.push(time);
    preview.setMasterVolume(0.2);
    preview.setMasterVolume(0.8);
    expect(held).to.deep.equal([context.currentTime, context.currentTime]);
    expect(master.events.at(-1).value).to.equal(0.15 * 0.8);
    await preview.dispose();
  });

  it('applies mute before a pending unlock completes and preserves it across stop and restart', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview } = setup({}, context);
    const enabling = preview.enable();
    preview.setMasterVolume(0);
    expect(context.gains[0].gain.events.at(-1)).to.deep.equal({ type: 'set', value: 0, time: context.currentTime });
    context.state = 'running';
    pending.resolve();
    expect(await enabling).to.equal(true);
    preview.stop();
    expect(await preview.enable()).to.equal(true);
    expect(preview.getState().masterVolume).to.equal(0);
    await preview.dispose();
  });

  it('clamps master volume, ignores invalid values and leaves disposed audio untouched', async function() {
    const { preview, context, creations } = setup({ masterVolume: Infinity });
    expect(preview.getState().masterVolume).to.equal(0.7);
    expect(preview.setMasterVolume(-1)).to.equal(0);
    expect(preview.setMasterVolume(5)).to.equal(4);
    expect(preview.setMasterVolume(NaN)).to.equal(4);
    expect(preview.setMasterVolume('0.5')).to.equal(4);
    expect(creations()).to.equal(0);
    await preview.enable();
    await preview.dispose();
    expect(preview.setMasterVolume(0)).to.equal(4);
    expect(context.gains[0].gain.events).to.deep.equal([]);
  });

  it('is completely inert until a user-triggered enable and never depends on MIDI access', async function() {
    const { preview, context, creations } = setup();
    expect(preview).to.be.instanceOf(BrowserNotePreview);
    expect(preview.getState()).to.include({ status: 'idle', enabled: false, activeVoices: 0 });
    expect(preview).not.to.have.property('output');
    expect(creations()).to.equal(0);
    const source = readFileSync(new URL('../../js/app/midi-ui/browserNotePreview.js', import.meta.url), 'utf8');
    expect(source).not.to.match(/requestMIDIAccess|WebMidi|MidiScheduler|MidiEventRouter/m);
    expect(await preview.enable()).to.equal(true);
    expect(creations()).to.equal(1);
    expect(context.oscillators).to.have.length(0);
    await preview.dispose();
  });

  it('creates and resumes synchronously before yielding for the browser gesture', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview, creations } = setup({}, context);
    const enabling = preview.enable();
    expect(creations()).to.equal(1);
    expect(context.resumeCalls).to.equal(1);
    expect(preview.getState().status).to.equal('unlocking');
    expect(preview.getState().enabled).to.equal(false);
    context.state = 'running';
    pending.resolve();
    expect(await enabling).to.equal(true);
    await preview.dispose();
  });

  it('reports unsupported audio without creating anything', async function() {
    const preview = createBrowserNotePreview({ createAudioContext: null });
    expect(await preview.enable()).to.equal(false);
    expect(preview.getState()).to.include({ status: 'unsupported', enabled: false });
    await preview.dispose();
  });

  it('handles resume rejection and retries on the next explicit enable', async function() {
    const context = new FakeContext('suspended');
    context.resumeResult = Promise.reject(new Error('permission denied'));
    const { preview, creations } = setup({}, context);
    expect(await preview.enable()).to.equal(false);
    expect(preview.getState().status).to.equal('error');
    expect(context.oscillators).to.have.length(0);
    context.resumeResult = null;
    expect(await preview.enable()).to.equal(true);
    expect(creations()).to.equal(1);
    expect(context.resumeCalls).to.equal(2);
    await preview.dispose();
  });

  it('does not accept a resolved resume while audio remains suspended', async function() {
    const context = new FakeContext('suspended');
    context.resumeResult = Promise.resolve();
    const { preview } = setup({}, context);
    expect(await preview.enable()).to.equal(false);
    expect(preview.getState().status).to.equal('error');
    await preview.dispose();
  });

  it('cancels a pending unlock with stop and permits a later explicit enable', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview } = setup({}, context);
    const enabling = preview.enable();
    preview.stop();
    context.state = 'running';
    pending.resolve();
    expect(await enabling).to.equal(false);
    expect(preview.getState()).to.include({ status: 'idle', enabled: false });
    expect(await preview.enable()).to.equal(true);
    await preview.dispose();
  });

  it('disposes a pending semantic owner unlock once and prevents late revival', async function() {

    const context = new FakeContext('suspended'), pending = deferred(); context.resumeResult = pending.promise;
    const { preview } = setup({}, context), game = preview.createSession('pending'), backend = game.createInstrumentBackend(); await backend.prepare(nativePatch()); const enabling = game.enable();
    const first = preview.dispose(); expect(preview.dispose()).to.equal(first); pending.resolve(); expect(await enabling).to.equal(false); expect(await preview.enable()).to.equal(false); expect(backend.begin(nativeIntent('late'), 96000).status).to.equal('rejected'); await first;
    expect(context.closeCalls).to.equal(1); expect(context.listeners.size).to.equal(0); expect(context.gains.every(node => node.disconnected)).to.equal(true); expect(context.oscillators).to.have.length(0); expect(preview.getState().status).to.equal('disposed');

  });

  it('schedules semantic target frames and a soft envelope without MIDI timestamp lowering', async function() {

    const { preview, context } = setup(), game = preview.createSession('frame-clock'), backend = game.createInstrumentBackend(); await backend.prepare(nativePatch()); await game.enable();
    expect(backend.begin({ ...nativeIntent('A'), pitch: { cents: 6900, referenceHz: 440 } }, 108000).status).to.equal('accepted'); expect(backend.end('A', { seconds: 0.04 }, 120000).status).to.equal('accepted');
    const oscillator = context.oscillators[0], voice = [...preview._voices][0]; expect(oscillator.starts).to.deep.equal([2.25]); expect(oscillator.frequency.events[0]).to.deep.equal({ type: 'set', value: 440, time: 2.25 }); expect(oscillator.stops.at(-1)).to.equal(2.54);
    expect(voice.gain.gain.events.some(event => event.type === 'ramp' && event.value > 0)).to.equal(true); expect(voice.gain.gain.events.at(-1)).to.include({ type: 'ramp', value: 0, time: 2.54 });
    oscillator.end(); expect(preview.getState().activeVoices).to.equal(0); expect(oscillator.onended).to.equal(null); expect(oscillator.disconnected).to.equal(true); await preview.dispose();

  });

  it('bounds native note lifetime and rejects invalid semantic values before allocation', async function() {

    const { preview, context } = setup({ maxNoteSeconds: 3 }), game = preview.createSession('bounded'), backend = game.createInstrumentBackend(); await backend.prepare(nativePatch()); await game.enable();
    for (const cents of [NaN, Infinity, -Infinity, 25000]) expect(backend.begin({ ...nativeIntent('bad'), pitch: { cents } }, 96000).status).to.equal('rejected');
    for (const velocity01 of [-0.1, 1.1, NaN]) expect(backend.begin({ ...nativeIntent('bad'), velocity01 }, 96000).status).to.equal('rejected'); expect(context.oscillators).to.have.length(0);
    expect(backend.begin(nativeIntent('future'), 288000).reason).to.equal('target-frame-out-of-range'); expect(backend.begin(nativeIntent('A'), 96000).status).to.equal('accepted'); expect(context.oscillators[0].stops.at(-1)).to.be.at.most(5); expect(context.oscillators[0].stops.at(-1)).to.be.greaterThan(2); await preview.dispose();

  });

  it('refuses unprepared and GM-only phrase payloads without allocating local audio', async function() {

    const { preview, creations } = setup(); for (const notes of [[60], [{ note: 60 }], [{ note: 60, instrument: { program: 29 } }]]) expect(await preview.preview(notes)).to.equal(false);
    expect(creations()).to.equal(0); expect(preview.getState().message).to.include('Choose a local instrument'); await preview.dispose();

  });

  it('keeps nominal headroom independent of the configured voice capacity', async () => {
    const small = setup({ maxVoices: 2, masterVolume: 1 }), full = setup({ maxVoices: 32, masterVolume: 1 });
    await small.preview.enable(); await full.preview.enable();
    expect(small.context.gains[0].gain.value).to.equal(0.15);
    expect(full.context.gains[0].gain.value).to.equal(0.15);
    expect(Math.max(...full.context.limiters[0].curve.map(Math.abs))).to.be.lessThan(0.9);
    await small.preview.dispose(); await full.preview.dispose();
  });

  it('clears future semantic voices and prevents late ended callbacks from reviving them', async function() {

    const { preview, context } = setup(), game = preview.createSession('future'), backend = game.createInstrumentBackend(); await backend.prepare(nativePatch()); await game.enable(); expect(backend.begin(nativeIntent('A'), 144000).status).to.equal('accepted');
    const oscillator = context.oscillators[0], ended = oscillator.onended; await game.stop().completion; expect(oscillator.disconnected).to.equal(true); expect(oscillator.onended).to.equal(null); ended(); expect(preview.getState().activeVoices).to.equal(0); expect(backend.begin(nativeIntent('late'), 144000).status).to.equal('rejected'); await preview.dispose();

  });

  it('requires explicit re-enable after Stop and admits a fresh semantic owner', async function() {

    const { preview, context } = setup(); await preview.enable(); expect(await admitFixtureTone(preview, 60)).to.equal(true); await preview.stop().completion; expect(context.oscillators[0].disconnected).to.equal(true); expect(preview.getState().enabled).to.equal(false);
    expect(await preview.enable()).to.equal(true); expect(await admitFixtureTone(preview, 62)).to.equal(true); await preview.dispose();

  });

  it('cleans up semantic voices when the browser interrupts the audio context', async function() {

    const { preview, context } = setup(); await preview.enable(); expect(await admitFixtureTone(preview, 60)).to.equal(true); context.state = 'interrupted'; context.emit('statechange'); expect(preview.getState().enabled).to.equal(false); expect(preview._voices.size).to.equal(0); expect(context.oscillators[0].disconnected).to.equal(true); await preview.dispose();

  });

  it('admits a neutral semantic voice without panning and contains status observer exceptions', async function() {

    const context = new FakeContext(); context.createStereoPanner = undefined; const { preview } = setup({ onStateChange: () => { throw new Error('UI failed'); } }, context); expect(await preview.enable()).to.equal(true); expect(await admitFixtureTone(preview, 60)).to.equal(true); expect(preview._voices.size).to.equal(1); await preview.dispose();

  });

  it('closes a context after partial initialization failure and permits a clean retry', async function() {
    const failed = new FakeContext();
    failed.createGain = () => { throw new Error('No audio nodes'); };
    const valid = new FakeContext();
    let next = failed;
    const preview = createBrowserNotePreview({ createAudioContext: () => next });
    expect(await preview.enable()).to.equal(false);
    expect(failed.closeCalls).to.equal(1);
    next = valid;
    expect(await preview.enable()).to.equal(true);
    await preview.dispose();
    expect(valid.closeCalls).to.equal(1);
    expect(failed.closeCalls).to.equal(1);
  });

  it('retires partially constructed native voices after node and panner failures', async function() {

    const { preview, context } = setup(), game = preview.createSession('construction'), backend = game.createInstrumentBackend(); await backend.prepare(nativePatch()); await game.enable();
    const createGain = context.createGain.bind(context); context.createGain = () => { throw new Error('Resource exhausted'); }; expect(backend.begin(nativeIntent('gain'), 96000).status).to.equal('rejected'); expect(context.oscillators.every(node => node.disconnected)).to.equal(true); expect(preview.getState().activeVoices).to.equal(0);
    context.createGain = createGain; context.createStereoPanner = () => { throw new Error('Panner failed'); }; expect(backend.begin(nativeIntent('pan'), 96000).status).to.equal('rejected'); expect(context.oscillators.every(node => node.disconnected)).to.equal(true); expect(preview.getState().activeVoices).to.equal(0); await preview.dispose();

  });

  it('reports actual semantic voice completion without stale active listening state', async function() {

    const { preview, context } = setup(); await preview.enable(); expect(await admitFixtureTone(preview, 60)).to.equal(true); expect(preview.getState().activeVoices).to.equal(1); context.oscillators[0].end(); expect(preview.getState().activeVoices).to.equal(0); await preview.dispose();

  });

  it('allows subscriber removal and handles close rejection without leaked listeners', async function() {
    const { preview, context } = setup();
    let updates = 0;
    const unsubscribe = preview.subscribe(() => { updates += 1; });
    await preview.enable();
    expect(updates).to.equal(1);
    unsubscribe();
    preview.stop();
    expect(updates).to.equal(1);
    context.close = () => { context.closeCalls += 1; return Promise.reject(new Error('Already closed')); };
    await preview.dispose();
    expect(context.listeners.size).to.equal(0);
    expect(context.closeCalls).to.equal(1);
    preview.subscribe(() => { throw new Error('Disposed subscription'); });
    expect(await preview.enable()).to.equal(false);
  });


  it('settles cancelled enables immediately even when the browser resume never settles', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview } = setup({}, context);
    const starting = preview.enable();
    preview.stop();
    expect(await starting).to.equal(false);
    context.resumeResult = null;
    expect(await preview.enable()).to.equal(true);
    expect(context.resumeCalls).to.equal(2);
    await preview.dispose();
    pending.reject(new Error('Late abort'));
    await Promise.resolve();
    expect(preview.getState().status).to.equal('disposed');
  });

  it('shares one resume for concurrent enable calls that have not been cancelled', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview } = setup({}, context);
    const first = preview.enable();
    const second = preview.enable();
    expect(context.resumeCalls).to.equal(1);
    context.state = 'running';
    pending.resolve();
    expect(await first).to.equal(true);
    expect(await second).to.equal(true);
    await preview.dispose();
  });

});

describe('inactive hardware boundary', function() {
  it('retains the external hardware single-pitch retrigger policy', () => {
    withFakeClockAndPerformance(() => {
      const calls = [], scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false }, timing: { scheduleAheadMs: 0 } });
      scheduler.setOutput(makeOutput([1], calls, 'hardware'));
      expect(scheduler.sendNote({ note: 60, channel: 1, durationTicks: 4 })).to.equal(true);
      expect(scheduler.sendNote({ note: 60, channel: 1, durationTicks: 4 })).to.equal(true);
      expect(calls.filter(call => ['noteOn', 'noteOff'].includes(call.type)).map(call => call.type)).to.deep.equal(['noteOn', 'noteOff', 'noteOn']);
      expect(scheduler._activeNotes.size).to.equal(1); scheduler.dispose();
    });
  });
  it('does not configure MPE channels when the hardware mapping is disabled', function() {
    let messages = 0;
    const channel = { sendPitchBendRange() { messages += 1; }, sendPitchBend() { messages += 1; } };
    const output = { id: 'hardware', channels: { 1: channel, 2: channel } };
    const config = { enabled: false, mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } };
    const scheduler = new MidiScheduler(config);
    scheduler.setOutput(output);
    scheduler.setOutputs([output]);
    scheduler.setConfig({ ...config, sfx: { 24: { note: 72 } } });
    expect(messages).to.equal(0);
    scheduler.setConfig({ ...config, enabled: true });
    expect(messages).to.be.greaterThan(0);
    scheduler.output = null;
    scheduler._outputsById.clear();
    scheduler.dispose();
  });
});


describe('main runtime configuration factory integration', () => {
  it('passes a profile and optional rate to the real context owner and reports the factory actual rate', async () => {
    for (const runtimeConfig of [{}, { latencyProfile: 'robust', preferredSampleRate: 44100 }]) {
      const received = [], context = new FakeContext(), preview = new BrowserNotePreview({ runtimeConfig, createAudioContext: options => { received.push(options); return context; } });
      expect(await preview.enable()).to.equal(true);
      expect(received).to.deep.equal([runtimeConfig.preferredSampleRate ? { latencyHint: 'playback', sampleRate: 44100 } : { latencyHint: 'interactive' }]);
      expect(preview.getAudioRuntimeObservation()).to.include({ actualSampleRate: context.sampleRate, acousticMeasurement: false, estimatesAreAdditive: false });
      expect(preview.getState().audioRuntime.config.preferredSampleRate).to.equal(runtimeConfig.preferredSampleRate ?? null);
      await preview.dispose(); expect(preview.getAudioRuntimeObservation()).to.equal(null);
    }
  });
});
