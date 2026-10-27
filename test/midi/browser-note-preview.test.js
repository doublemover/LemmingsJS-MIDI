import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
import { expect } from 'chai';
import { EventHandler } from '../../js/util/EventHandler.js';
import { createMidiEventPlayback, getMidiEventPlaybackEnvelope } from '../../js/app/midi-ui/midiEventPlayback.js';
import { TestDocument } from '../helpers/test-dom.js';
import { readFileSync } from 'node:fs';
import { BrowserNotePreview, createBrowserNotePreview } from '../../js/app/midi-ui/browserNotePreview.js';
import { applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';
import { createMidiProject, projectToMidiConfig } from '../../js/midi/project/MidiProject.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { createMidiOutputCapture } from '../../js/midi/capture/MidiOutputCapture.js';
import { analyzeMidiOutputCapture } from '../../js/midi/capture/MidiCaptureAnalysis.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createProcgenPhysicalPlayback } from '../../js/app/procgen/workstation/ProcgenPhysicalPlayback.js';
import { createProcgenPhysicalScoreClock } from '../../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { createCausalMusicEngine } from '../../js/app/procgen/workstation/CausalMusicEngine.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('separate cue workload and graph admission', () => {
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
    expect(preview.output.channels[1].sendNoteOn(60, { rawAttack: 100, time: 2000 })).to.equal(true);
    expect(preview.output.channels[1].sendNoteOn(64, { rawAttack: 100, time: 1000 })).to.equal(false);
    expect([...preview._voices].map(value => value.note)).to.deep.equal([60]); expect(preview.getState().voiceSteals).to.equal(0); await preview.dispose();
  });
  it('cannot use a one-voice live workload for cue without an explicit additional quota', async () => {
    const context = new FakeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, maxVoices: 1 });
    await preview.enable(); preview.output.channels[1].sendNoteOn(60, { rawAttack: 100 });
    const live = [...preview._voices][0], cue = preview.createSession('cue', { workloadClass: 'cue' });
    expect(await cue.enable()).to.equal(false); expect(cue.output.channels[1].sendNoteOn(60, { rawAttack: 100 })).to.equal(false);
    expect(preview._voices.has(live)).to.equal(true); expect(preview.getState().voiceSteals).to.equal(0); await preview.dispose();
  });
  it('partitions explicit cue capacity, preserves same-pitch live ownership and stops cue independently', async () => {
    const context = new FakeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, maxVoices: 1, cueVoices: 1 });
    await preview.enable(); preview.output.channels[1].sendNoteOn(60, { rawAttack: 100 }); const live = [...preview._voices][0];
    await preview.prepareCueRoute({ mode: 'rehearsal' }); const cue = preview.createSession('cue', { workloadClass: 'cue' });
    expect(await cue.enable()).to.equal(true); cue.output.channels[1].sendNoteOn(60, { rawAttack: 100 });
    expect([...preview._voices].filter(voice => voice.workloadClass === 'cue')).to.have.length(1);
    cue.output.channels[1].sendNoteOn(61, { rawAttack: 100 }); expect(preview._voices.has(live)).to.equal(true);
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
  addEventListener(name, callback) { this.listeners.add(callback); }
  removeEventListener(name, callback) { this.listeners.delete(callback); }
  resume() {
    this.resumeCalls += 1;
    if (this.resumeResult) return this.resumeResult;
    this.state = 'running';
    return Promise.resolve();
  }
  close() { this.closeCalls += 1; this.state = 'closed'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; for (const callback of this.listeners) callback(); }
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
      owner.output.channels[1].sendProgramChange(8);
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
    game.output.channels[1].sendPitchBend(-1); game.output.channels[1].sendControlChange(11, 0);
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
    expect([...preview._voices][0].basePeak).to.be.closeTo(0.7501 * 0.8 * 0.7, 1e-12);
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
    await game.enable(); await cue.enable(); game.output.channels[1].sendNoteOn(60, { voiceToken: 1 });
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
    expect(audition.output.channels[1].sendNoteOn(60)).to.equal(true);
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

  it('resolves future volume and expression by event time regardless of submission order', async () => {
    const run = async reversed => {
      const { preview } = setup(); await preview.enable();
      const channel = preview.output.channels[1];
      const events = [{ control: 7, value: 63.5, time: 2000 }, { control: 11, value: 63.5, time: 1000 }];
      for (const event of reversed ? events.reverse() : events) expect(channel.sendControlChange(event.control, event.value, { time: event.time })).to.equal(true);
      const scheduled = preview._channels.get(1).gain.gain.events.filter(event => event.type === 'set' && event.time >= 2);
      await preview.dispose(); return scheduled;
    };
    const forward = await run(false), reverse = await run(true);
    expect(forward).to.deep.equal(reverse);
    expect(forward.slice(-2).map(event => [event.time, event.value])).to.deep.equal([[2, 0.5], [3, 0.25]]);
  });

  it('uses the program and bend effective at a future note onset even when controls arrive later', async () => {
    const { preview, context } = setup(); await preview.enable();
    const channel = preview.output.channels[1];
    channel.sendProgramChange(38, { time: 2000 });
    expect(channel.sendNoteOn(60, { time: 1000, instrument: { legacy: false } })).to.equal(true);
    expect(channel.sendNoteOn(62, { time: 2000, instrument: { legacy: false } })).to.equal(true);
    expect(context.oscillators[0].type).to.equal('triangle');
    expect(context.oscillators[1].type).to.equal('sine');
    channel.sendNoteOn(64, { time: 2000 });
    channel.sendPitchBend(1, { time: 1000 });
    expect(context.oscillators[2].detune.events[0]).to.deep.equal({ type: 'set', value: 200, time: 3 });
    await preview.dispose();
  });

  it('revises an already queued future note when an earlier program arrives afterward', async () => {
    const run = async noteFirst => {
      const { preview, context } = setup(); await preview.enable();
      const channel = preview.output.channels[1];
      const note = () => channel.sendNoteOn(60, { time: 2000, instrument: { legacy: false } });
      const program = () => channel.sendProgramChange(38, { time: 1000 });
      if (noteFirst) { note(); program(); } else { program(); note(); }
      const result = { waveform: context.oscillators[0].type,
        envelope: [...context.gains.at(-1).gain.events] };
      await preview.dispose(); return result;
    };
    expect(await run(true)).to.deep.equal(await run(false));
  });

  it('schedules future all-notes-off without cutting a voice at call time', async () => {
    const { preview, context } = setup(); await preview.enable();
    const channel = preview.output.channels[1];
    expect(channel.sendNoteOn(60, { time: 1000 })).to.equal(true);
    const first = [...preview._voices][0];
    expect(channel.sendControlChange(123, 0, { time: 2000 })).to.equal(true);
    expect(first.releaseAt).to.be.greaterThan(context.currentTime);
    expect(first.releaseAt).to.be.closeTo(3, 1e-9);
    expect(channel.sendNoteOn(62, { time: 1000 })).to.equal(true);
    expect([...preview._voices].find(voice => voice.note === 62).releaseAt).to.be.closeTo(3, 1e-9);
    await preview.dispose();
  });

  it('recomputes future bend events when bend range arrives out of order', async () => {
    const { preview, context } = setup(); await preview.enable();
    const channel = preview.output.channels[1];
    channel.sendNoteOn(60, { time: 2000 });
    channel.sendPitchBend(1, { time: 1000 });
    channel.sendPitchBendRange(3, 50, { time: 1500 });
    expect(context.oscillators[0].detune.events).to.deep.equal([{ type: 'set', value: 350, time: 3 }]);
    await preview.dispose();
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

  it('uses the audition bend range without retuning another owner on the same channel', async () => {
    const { preview, context } = setup();
    const game = preview.createSession('game'), audition = preview.createSession('audition');
    await game.enable(); game.output.channels[2].sendNoteOn(60, { voiceToken: 1 });
    expect(await audition.preview([{ note: 64, channel: 2, pitchBend: 0.25, pitchBendRange: 12.5 }])).to.equal(true);
    expect(context.oscillators[0].detune.events.at(-1).value).to.equal(0);
    expect(context.oscillators[1].detune.events.at(-1).value).to.equal(312.5);
    await preview.dispose();
  });

  it('shares one graph and total voice budget while isolating owner channels, same-pitch gates and Stop', async () => {
    const { preview, context, creations } = setup({ maxVoices: 2 });
    const game = preview.createSession('game'), audition = preview.createSession('audition');
    await game.enable(); await audition.enable();
    expect(creations()).to.equal(1); expect(context.compressors).to.have.length(1); expect(context.limiters).to.have.length(1);
    game.output.channels[1].sendProgramChange(38); audition.output.channels[1].sendProgramChange(81);
    game.output.channels[1].sendNoteOn(60, { voiceToken: 1, priority: 4, pan: -0.5 });
    audition.output.channels[1].sendNoteOn(60, { voiceToken: 1, priority: 4, pan: 0.5 });
    const [gameVoice, auditionVoice] = [...preview._voices];
    expect(context.oscillators.map(node => node.type)).to.deep.equal(['sine', 'sawtooth']);
    audition.output.channels[1].sendPitchBend(0.5);
    expect(gameVoice.oscillator.detune.events.at(-1).value).to.equal(0);
    expect(auditionVoice.oscillator.detune.events.at(-1).value).to.equal(100);
    audition.output.channels[1].sendControlChange(7, 32);
    const gameChannel = preview._channels.get(game.getState().ownerId + ':1');
    expect(gameChannel.volume).to.equal(1);
    expect(audition.output.channels[1].sendNoteOn(64, { voiceToken: 2, priority: 0 })).to.equal(false);
    expect(preview.getState().voiceDrops).to.equal(1); expect(preview.getState().activeVoices).to.equal(2);
    audition.stop(); expect(game.output.isVoiceActive(1)).to.equal(true); expect(audition.output.isVoiceActive(1)).to.equal(false);
    expect(preview.getState().enabled).to.equal(true); expect(game.getState().activeVoices).to.equal(1);
    await audition.dispose(); expect(context.closeCalls).to.equal(0);
    const replacement = preview.createSession('audition'); await replacement.enable();
    replacement.output.channels[1].sendNoteOn(60, { voiceToken: 1 });
    audition.output.clear(); expect(replacement.output.isVoiceActive(1)).to.equal(true);
    preview.panic(); expect(preview.getState().activeVoices).to.equal(0); expect(game.getState().enabled).to.equal(false);
    await preview.dispose(); expect(context.closeCalls).to.equal(1);
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

  it('retains all long audition cells on the shared bounded queue and stops only its future tail', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      Object.defineProperty(context, 'currentTime', { get: () => 2 + clock.now / 1000 });
      const game = preview.createSession('game'), audition = preview.createSession('audition');
      await game.enable(); game.output.channels[1].sendNoteOn(45, { voiceToken: 1 });
      expect(await audition.preview(Array.from({ length: 16 }, (_, i) => ({ note: 60 + i, offsetMs: i * 960, durationMs: 120 })))).to.equal(true);
      await clock.tickAsync(10500);
      expect(context.oscillators).to.have.length(17); expect(audition.getState().pendingNotes).to.equal(0);
      await audition.preview([{ note: 80, offsetMs: 14400 }]); expect(audition.getState().pendingNotes).to.equal(1);
      game.output.channels[1].sendNoteOn(48, { voiceToken: 2 });
      audition.stop(); expect(game.output.isVoiceActive(2)).to.equal(true);
      const count = context.oscillators.length; await clock.tickAsync(16000); expect(context.oscillators).to.have.length(count);
      expect(preview.getState().pendingNotes).to.equal(0); await preview.dispose();
    });
  });

  it('bounds reusable sessions and records distinct scopes at the shared render boundary', async () => {
    const { preview } = setup(), records = [];
    preview.setCapture({ isActive: () => true, record(stage, fields) { records.push({ stage, ...fields }); return records.length; } });
    const game = preview.createSession('game'), audition = preview.createSession('audition');
    preview.createSession('third'); preview.createSession('fourth');
    expect(() => preview.createSession('fifth')).to.throw(RangeError);
    await game.enable(); await audition.enable();
    game.output.channels[1].sendNoteOn(60, { voiceToken: 1 }); audition.output.channels[1].sendNoteOn(64, { voiceToken: 1 });
    expect(records.filter(item => item.stage === 'synth-scheduled').map(item => item.outputScope)).to.deep.equal([game.output.captureScope, audition.output.captureScope]);
    await audition.dispose(); expect(preview._channels.size).to.equal(1); expect(preview.createSession('fifth')).not.to.equal(null);
    await preview.dispose();
  });

  it('matches scheduler-observed future notes to their actual shared-session cancellation', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview } = setup({ nowMs: () => clock.now });
      const game = preview.createSession('game'), audition = preview.createSession('audition');
      const capture = createMidiOutputCapture(); capture.start(); preview.setCapture(capture);
      const scheduler = new MidiScheduler({ enabled: true, defaultChannel: 1 });
      scheduler.setCapture(capture); scheduler.setOutput(game.output);
      try {
        await game.enable(); await audition.enable();
        audition.output.channels[1].sendNoteOn(60, { voiceToken: 1 });
        await audition.preview([{ note: 64, offsetMs: 1200, durationMs: 200 }], { replace: false });
        // Exercise the real scheduler API boundary with an accepted future local schedule.
        const origin = { captureScope: scheduler._captureScope, token: 1, requestId: 1, laneIndex: 3,
          owner: audition.getState().ownerId, outputId: 'retained-origin-output', outputScope: 'retained-origin-scope' };
        expect(scheduler._sendOutput(game.output, 1, 'sendNoteOn', [60, { time: 1000, rawAttack: 96, voiceToken: 1 }], origin)).to.equal(true);
        scheduler.allNotesOff();
        expect(audition.output.isVoiceActive(1)).to.equal(true);
        const snapshot = capture.snapshot(), gameRecords = snapshot.records.filter(record => record.token === 1);
        expect(gameRecords.map(record => record.stage)).to.include.members(['api-dispatch', 'synth-scheduled', 'synth-end']);
        for (const record of gameRecords) expect(record).to.include({ captureScope: origin.captureScope,
          outputScope: game.output.captureScope, outputId: game.output.id, laneIndex: 3 });
        const auditionRecords = snapshot.records.filter(record => record.outputId === audition.output.id);
        expect(auditionRecords.map(record => record.stage)).to.include('request');
        expect(auditionRecords.every(record => record.outputScope === audition.output.captureScope)).to.equal(true);
        const note = analyzeMidiOutputCapture(snapshot).notes.find(entry => entry.outputId === game.output.id);
        expect(note).to.include({ startMs: 1000, synthEndReason: 'panic-or-stop', cancelledBeforeStart: true });
      } finally { scheduler.dispose(); await preview.dispose(); }
    });
  });

  it('emits every cell of a 14.4-second audition incrementally at its original timestamp', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      Object.defineProperty(context, 'currentTime', { get: () => 2 + clock.now / 1000 });
      const notes = Array.from({ length: 16 }, (_, index) => ({ note: 48 + index, offsetMs: index * 960, durationMs: 120 }));
      const calls = [], original = preview.output;
      preview.output = { ...original, channels: Object.fromEntries(Object.entries(original.channels).map(([id, channel]) => [id, { ...channel,
        sendNoteOn(note, options) { const accepted = channel.sendNoteOn(note, options); calls.push({ note, time: options.time, dispatch: clock.now, accepted }); return accepted; }
      }])) };
      expect(await preview.preview(notes)).to.equal(true); expect(calls).to.have.length(5); expect(preview.getState().pendingNotes).to.equal(11);
      await clock.tickAsync(16000); expect(calls).to.have.length(16); expect(calls.every(call => call.accepted)).to.equal(true);
      expect(calls.map(call => call.time)).to.deep.equal(notes.map(note => note.offsetMs));
      expect(calls.at(-1).time).to.equal(14400); expect(calls.at(-1).dispatch).to.equal(10400);
      context.oscillators.forEach((node, index) => expect(node.starts[0]).to.be.closeTo(2 + notes[index].offsetMs / 1000, 1e-9));
      expect(preview.getState().pendingNotes).to.equal(0); await preview.dispose();
    });
  });
  it('accepts a phrase whose only playable cell is beyond the current horizon and cancels it on Panic or replacement', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      expect(await preview.preview([{ note: 72, offsetMs: 14400 }])).to.equal(true); expect(context.oscillators).to.have.length(0);
      preview.panic(); await clock.tickAsync(16000); expect(context.oscillators).to.have.length(0); expect(preview.getState().pendingNotes).to.equal(0);
      await preview.preview([{ note: 72, offsetMs: 14400 }]); await preview.preview([60]); await clock.tickAsync(16000);
      expect(context.oscillators).to.have.length(1); expect(preview.getState().pendingNotes).to.equal(0); await preview.dispose();
    });
  });
  it('drops fully elapsed queued notes after a delayed timer instead of bursting them at resume', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      await preview.preview([{ note: 60, offsetMs: 6000, durationMs: 100 }]);
      clock.setSystemTime(10000);
      await clock.tickAsync(2001);
      expect(context.oscillators).to.have.length(0);
      expect(preview.getState().pendingNotes).to.equal(0);
      await preview.dispose();
    });
  });
  it('routes real ensemble game events into distinct local instruments and independent pan', async function() {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      await preview.enable();
      const project = applyGameEventMidiPreset(createMidiProject(), 'game-iron-ensemble');
      const router = new MidiEventRouter(projectToMidiConfig({ ...project, enabled: true }));
      router.setOutput(preview.output);
      for (let lemmingId = 0; lemmingId < 4; lemmingId += 1) router._onEvent({
        type: 'builder-step', sfxId: SoundEffectIds.BUILDER_STEP, tick: 0, lemmingId, laneIndex: 0, laneCount: 1
      });
      expect(context.oscillators.slice(0, 3).map(oscillator => oscillator.type)).to.deep.equal(['sine', 'square', 'sawtooth']);
      expect([...preview._voices].map(voice => voice.instrument.role)).to.deep.equal(['bass', 'rhythm', 'melody', 'percussion']);
      expect([...preview._voices].every(voice => !!voice.pan)).to.equal(true);
      clock.tick(400);
      router.dispose();
      expect(preview._voices.size).to.equal(0);
      await preview.dispose();
    });
  });

  it('applies workstation envelopes through the scheduler and resumes directly at sustain without another attack', async function() {
    await withFakeClockAndPerformance(async clock => {
      const { preview } = setup({ nowMs: () => clock.now });
      await preview.enable();
      const scheduler = new MidiScheduler({}); scheduler.setOutput(preview.output);
      const envelope = { attack: 0.7, decay: 0.2, sustain: 0.8, release: 0.4 };
      scheduler.sendNote({ note: 60, velocity: 100, channel: 1, durationTicks: 100, ensembleRole: 'texture', envelope });
      scheduler.sendNote({ note: 64, velocity: 100, channel: 1, durationTicks: 100, ensembleRole: 'texture', envelope, resumed: true });
      const [fresh, held] = [...preview._voices];
      expect(fresh).to.include({ attack: 0.7, decay: 0.2, sustain: 0.8, release: 0.4 });
      expect(fresh.gain.gain.events.find(event => event.type === 'ramp' && event.value === fresh.peak).time).to.equal(fresh.start + 0.7);
      expect(held).to.include({ attack: 0, decay: 0, sustain: 0.8, release: 0.4 });
      expect(held.gain.gain.events[0]).to.deep.equal({ type: 'set', value: held.peak * 0.8, time: held.start });
      expect(held.gain.gain.events.some(event => event.type === 'ramp' && event.value === held.peak)).to.equal(false);
      scheduler.dispose(); await preview.dispose();
    });
  });

  it('preserves triangle preview for older palettes with saved program and channel edits', async function() {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      await preview.enable();
      const router = new MidiEventRouter({ enabled: true, defaultChannel: 10, mpe: { enabled: false },
        sfx: { [SoundEffectIds.BUILDER_STEP]: { enabled: true, note: 69, channel: 10, program: 81 } } });
      router.setOutput(preview.output);
      router._onEvent({ type: 'builder-step', sfxId: SoundEffectIds.BUILDER_STEP, tick: 0, lemmingId: 0 });
      expect(context.oscillators).to.have.length(1);
      expect(context.oscillators[0].type).to.equal('triangle');
      router.dispose();
      await preview.dispose();
    });
  });

  it('plays distinct bounded ensemble timbres and keeps existing voice programs independent', async function() {
    const { preview, context } = setup();
    await preview.enable();
    preview.output.channels[2].sendProgramChange(38);
    preview.output.channels[2].sendNoteOn(45, { rawAttack: 100, instrument: { program: 38 } });
    preview.output.channels[3].sendNoteOn(57, { rawAttack: 100, instrument: { program: 29 } });
    preview.output.channels[4].sendNoteOn(69, { rawAttack: 100, instrument: { program: 81 } });
    preview.output.channels[10].sendNoteOn(36, { rawAttack: 100, instrument: { percussion: true } });
    expect(context.oscillators.map(oscillator => oscillator.type)).to.deep.equal(['sine', 'square', 'sawtooth', 'sine']);
    expect(context.oscillators[3].frequency.events).to.deep.include({ type: 'ramp', value: 45, time: 2.16 });
    preview.output.channels[2].sendProgramChange(29);
    expect(context.oscillators[0].type).to.equal('sine');
    expect(preview.getState().masterVolume).to.equal(0.7);
    expect(preview._voices.size).to.equal(4);
    expect([...preview._voices].every(voice => voice.peak <= 1 && voice.end <= voice.start + 8)).to.equal(true);
    preview.stop();
    expect(preview._voices.size).to.equal(0);
    await preview.dispose();
  });

  it('uses one cached bounded deterministic noise buffer for local percussion', async function() {
    const context = new FakeContext();
    context.sampleRate = 48000;
    const buffers = [], sources = [];
    context.createBuffer = (channels, length, sampleRate) => {
      const data = new Float32Array(length), buffer = { channels, length, sampleRate, getChannelData: () => data };
      buffers.push(buffer); return buffer;
    };
    context.createBufferSource = () => { const source = new FakeOscillator(); sources.push(source); return source; };
    const { preview } = setup({}, context);
    await preview.enable();
    for (let index = 0; index < 4; index += 1) preview.output.channels[10].sendNoteOn(42, { instrument: { percussion: true } });
    expect(buffers).to.have.length(1);
    expect(buffers[0].length).to.equal(9600);
    expect(sources).to.have.length(4);
    expect(sources.every(source => source.buffer === buffers[0] && source.loop)).to.equal(true);
    expect([...preview._voices].every(voice => voice.end - voice.start < 0.1)).to.equal(true);
    preview.stop();
    expect(sources.every(source => source.disconnected)).to.equal(true);
    await preview.dispose();
    expect(preview._noiseBuffer).to.equal(null);
  });

  it('reports successful local onset, scheduled release and panic, while rejecting invalid notes quietly', async function() {
    const events = [];
    const { preview, context } = setup({ onPlayback: event => events.push(event) });
    const metadata = { sfxId: 20, durationMs: 120 };
    expect(preview.output.channels[1].sendNoteOn(60, { playback: metadata })).to.equal(false);
    await preview.enable();
    expect(preview.output.channels[1].sendNoteOn(128, { playback: metadata })).to.equal(false);
    expect(events).to.have.length(0);
    preview.output.channels[1].sendNoteOn(60, { rawAttack: 127, time: 1100, playback: metadata });
    expect(events[0]).to.include({ phase: 'start', note: 60, sfxId: 20, startMs: 1100, attackMs: 8, decayMs: 0, sustain: 1 });
    preview.output.channels[1].sendNoteOff(60, { time: 1220 });
    expect(events[1].releaseMs).to.be.closeTo(1220, 0.0001);
    expect(events[1].endMs).to.be.closeTo(1260, 0.0001);
    expect(context.oscillators[0].stops.at(-1)).to.be.closeTo(2.26, 0.0001);
    preview.stop(); expect(events.at(-1).phase).to.equal('end');
    await preview.dispose();
  });

  it('publishes profile envelope and early-release amplitude only from actual admitted local voices', async function() {
    const events = [], { preview } = setup({ onPlayback: event => events.push(event) });
    try {
      await preview.enable();
      const options = { rawAttack: 100, time: 1100, voiceToken: 1, instrument: { program: 38, legacy: false }, playback: { sfxId: 20, durationMs: 120, stepIndex: 1, stepCount: 3 } };
      expect(preview.output.channels[1].sendNoteOn(48, options)).to.equal(true);
      const voice = [...preview._voices][0], onset = events[0];
      expect(onset).to.include({ phase: 'start', note: 48, attackMs: 6, decayMs: 50, sustain: 0.82, releaseDurationMs: 60, mixLatencyMs: 6, stepIndex: 1, stepCount: 3 });
      const gain = voice.gain.gain.events;
      expect(gain.find(event => event.type === 'ramp' && event.value === voice.peak).time - voice.start).to.be.closeTo(onset.attackMs / 1000, 0.000001);
      expect(gain.find(event => event.type === 'ramp' && event.value === voice.peak * onset.sustain).time - voice.start).to.be.closeTo((onset.attackMs + onset.decayMs) / 1000, 0.000001);
      expect(getMidiEventPlaybackEnvelope(onset).endMs).to.be.closeTo(1286, 0.000001);
      preview.output.channels[1].sendNoteOff(48, { time: 1104, voiceToken: 1 });
      const release = events[1]; expect(release.releaseLevel).to.be.closeTo(2 / 3, 0.000001);
      expect(getMidiEventPlaybackEnvelope(release).points[1].level).to.be.closeTo(voice.releaseLevel / voice.peak, 0.000001);
      expect(getMidiEventPlaybackEnvelope(release).endMs).to.be.closeTo(1170, 0.000001);
      preview.stop(); expect(events.at(-1).phase).to.equal('end');
    } finally { await preview.dispose(); }
  });
  it('emits playback only at scheduler dispatch and cancels a future note before it sounds', async function() {
    await withFakeClockAndPerformance(async clock => {
      const events = []; const { preview } = setup({ nowMs: () => clock.now, onPlayback: event => events.push(event) });
      await preview.enable();
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false } });
      scheduler.setOutput(preview.output); scheduler.setTickMs(60);
      scheduler.sendNote({ note: 60, durationTicks: 4, timeMs: 100 }, { sfxId: 20 });
      expect(events).to.have.length(0); clock.tick(100);
      expect(events[0]).to.include({ phase: 'start', sfxId: 20, durationMs: 240 });
      scheduler.sendNote({ note: 72, durationTicks: 4, timeMs: 200 }, { sfxId: 24 });
      scheduler.allNotesOff(); clock.tick(500);
      expect(events.filter(event => event.phase === 'start')).to.have.length(1);
      scheduler.dispose(); await preview.dispose();
    });
  });
  it('offers an explicit 12 dB local boost through a bounded output ceiling without changing MIDI attack', async function() {
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
    preview.output.channels[1].sendNoteOn(60, { rawAttack: 127 });
    expect([...preview._voices][0].peak).to.equal(1);
    await preview.dispose();
    expect(limiter.disconnected).to.equal(true);
    expect(context.compressors[0].disconnected).to.equal(true);
    expect(context.gains[1].disconnected).to.equal(true);
  });
  it('mutes the compressor lookahead on Panic and reopens only after its bounded delay', async () => {
    const { preview, context } = setup(); await preview.enable();
    const fixed = context.gains[1].gain;
    preview.output.channels[1].sendNoteOn(60, { voiceToken: 1 });
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

  it('ramps live master gain to exact mute and back without changing note velocity, channel volume or active voices', async function() {
    const { preview, context } = setup();
    await preview.enable();
    const channel = preview.output.channels[1];
    channel.sendControlChange(7, 80);
    channel.sendNoteOn(60, { rawAttack: 100 });
    const voice = [...preview._voices][0];
    const envelope = [...voice.gain.gain.events];
    const channelGain = [...preview._channels.get(1).gain.gain.events];
    const master = context.gains[0].gain;
    expect(preview.setMasterVolume(0)).to.equal(0);
    expect(master.events.at(-1)).to.deep.equal({ type: 'ramp', value: 0, time: context.currentTime + 0.015 });
    expect(preview.getState()).to.include({ enabled: true, masterVolume: 0, activeVoices: 1 });
    expect(preview.setMasterVolume(1)).to.equal(1);
    expect(master.events.filter(event => event.type === 'ramp')).to.have.length(1);
    expect(master.events.at(-1).value).to.equal(0.15);
    expect(voice.gain.gain.events).to.deep.equal(envelope);
    expect(preview._channels.get(1).gain.gain.events).to.deep.equal(channelGain);
    expect(preview.getState().activeVoices).to.equal(1);
    await preview.dispose();
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
    expect(Object.keys(preview.output.channels)).to.have.length(16);
    expect(preview.output.channels[1].sendNoteOn(60)).to.equal(false);
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
    expect(preview.output.channels[1].sendNoteOn(60)).to.equal(false);
    context.state = 'running';
    pending.resolve();
    expect(await enabling).to.equal(true);
    await preview.dispose();
  });

  it('reports unsupported audio without creating anything', async function() {
    const preview = createBrowserNotePreview({ createAudioContext: null });
    expect(await preview.enable()).to.equal(false);
    expect(await preview.preview([60])).to.equal(false);
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

  it('allows only the newest rapidly repeated preview after resume', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview, creations } = setup({}, context);
    const first = preview.preview([60]);
    const second = preview.preview([67]);
    expect(context.resumeCalls).to.equal(2);
    context.state = 'running';
    pending.resolve();
    expect(await first).to.equal(false);
    expect(await second).to.equal(true);
    expect(context.oscillators).to.have.length(1);
    expect(context.oscillators[0].frequency.events[0].value).to.be.closeTo(391.995, 0.001);
    expect(creations()).to.equal(1);
    await preview.dispose();
  });

  it('disposes pending unlock once and never revives or schedules notes afterward', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview } = setup({}, context);
    const playing = preview.preview([60]);
    const first = preview.dispose();
    expect(preview.dispose()).to.equal(first);
    pending.resolve();
    expect(await playing).to.equal(false);
    expect(await preview.enable()).to.equal(false);
    expect(await preview.preview([72])).to.equal(false);
    await first;
    expect(context.closeCalls).to.equal(1);
    expect(context.listeners.size).to.equal(0);
    expect(context.gains.every(node => node.disconnected)).to.equal(true);
    expect(context.oscillators).to.have.length(0);
    expect(preview.getState().status).to.equal('disposed');
  });

  it('maps absolute performance timestamps to audio time and schedules a soft envelope', async function() {
    const { preview, context } = setup();
    await preview.enable();
    const channel = preview.output.channels[2];
    expect(channel.sendNoteOn(69, { rawAttack: 100, time: 1250 })).to.equal(true);
    channel.sendNoteOff(69, { time: 1500 });
    const voice = context.oscillators[0];
    expect(voice.starts).to.eql([2.25]);
    expect(voice.frequency.events[0]).to.eql({ type: 'set', value: 440, time: 2.25 });
    expect(voice.stops.at(-1)).to.equal(2.54);
    const envelope = context.gains.at(-1).gain.events;
    expect(envelope[0]).to.eql({ type: 'set', value: 0, time: 2.25 });
    expect(envelope.some(event => event.type === 'ramp' && event.value > 0)).to.equal(true);
    expect(envelope.at(-1)).to.eql({ type: 'ramp', value: 0, time: 2.54 });
    voice.end();
    expect(preview.getState().activeVoices).to.equal(0);
    expect(voice.onended).to.equal(null);
    expect(voice.disconnected).to.equal(true);
    await preview.dispose();
  });

  it('has a hard note lifetime even without a note-off and bounds note inputs', async function() {
    const { preview, context } = setup({ maxNoteSeconds: 3 });
    await preview.enable();
    const channel = preview.output.channels[1];
    for (const note of [-1, 128, NaN, Infinity, 60.5, '60', null]) expect(channel.sendNoteOn(note)).to.equal(false);
    expect(channel.sendNoteOn(60, { time: 4100 })).to.equal(false);
    expect(channel.sendNoteOn(60, { rawAttack: 1000 })).to.equal(true);
    expect(context.oscillators[0].stops).to.eql([5]);
    expect(context.gains.at(-1).gain.events[1].value).to.equal(1);
    await preview.dispose();
  });

  it('supports bounded short phrases without changing any game clock', async function() {
    const { preview, context } = setup();
    expect(await preview.preview([
      { note: 60, offsetMs: 0, durationMs: 100 },
      { note: 64, offsetMs: 200, durationMs: 150 },
      { note: 67, offsetMs: 400, durationMs: 200 },
      { note: 72, offsetMs: 999999, durationMs: 100 }
    ])).to.equal(true);
    expect(context.oscillators.map(node => node.starts[0])).to.eql([2, 2.2, 2.4]);
    expect(context.oscillators.map(node => node.stops.at(-1))).to.eql([2.14, 2.39, 2.64]);
    await preview.dispose();
  });

  it('preserves independent local same-pitch gates until each scheduler token releases', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      Object.defineProperty(context, 'currentTime', { get: () => 2 + clock.now / 1000 });
      await preview.enable();
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false } });
      scheduler.setOutput(preview.output); scheduler.setTickMs(60);
      scheduler.sendNote({ note: 60, channel: 1, durationTicks: 8 });
      clock.tick(60);
      scheduler.sendNote({ note: 60, channel: 1, durationTicks: 4 });
      const [first, second] = [...preview._voices];
      expect(first.token).not.to.equal(second.token);
      expect(context.oscillators.every(node => !node.disconnected)).to.equal(true);
      expect(scheduler._activeNotes.size).to.equal(2);
      clock.tick(240);
      expect(second.released).to.equal(true); expect(first.released).to.equal(false);
      expect(scheduler._activeNotes.size).to.equal(1);
      clock.tick(180);
      expect(first.released).to.equal(true); expect(scheduler._activeNotes.size).to.equal(0);
      scheduler.allNotesOff(); expect(preview._voices.size).to.equal(0);
      expect(context.oscillators.every(node => node.disconnected)).to.equal(true);
      scheduler.dispose(); await preview.dispose();
    });
  });

  it('retains the hardware single-pitch retrigger policy when independent gates are absent', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now }); await preview.enable();
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false } });
      scheduler.setOutput({ ...preview.output, supportsIndependentNoteGates: false });
      scheduler.sendNote({ note: 60, channel: 1, durationTicks: 8 });
      scheduler.sendNote({ note: 60, channel: 1, durationTicks: 8 });
      expect(context.oscillators[0].disconnected).to.equal(true);
      expect(scheduler._activeNotes.size).to.equal(1);
      scheduler.dispose(); await preview.dispose();
    });
  });

  it('lets an owned immediate release replace an already scheduled future release', async () => {
    const { preview, context } = setup(); await preview.enable();
    preview.output.channels[1].sendNoteOn(60, { voiceToken: 1 });
    preview.output.channels[1].sendNoteOff(60, { time: 2000, voiceToken: 1 });
    const voice = [...preview._voices][0]; expect(voice.releaseAt).to.equal(3);
    context.currentTime = 2.1;
    expect(preview.output.channels[1].sendNoteOff(60, { voiceToken: 1, reason: 'local-voice-budget' })).to.equal(true);
    expect(voice.end).to.be.closeTo(2.14, 1e-9); expect(voice.oscillator.disconnected).to.equal(false);
    await preview.dispose();
  });

  it('protects higher-priority local gates from spawn overflow and balances equal-priority lanes', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      Object.defineProperty(context, 'currentTime', { get: () => 2 + clock.now / 1000 });
      await preview.enable();
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false }, limits: { maxActiveNotes: 8 } });
      scheduler.setOutput(preview.output);
      for (let index = 0; index < 8; index++) expect(scheduler.sendNote({ note: 48 + index, durationTicks: 0 }, { priority: 4, laneIndex: 0 })).to.equal(true);
      const originalTokens = [...scheduler._activeNotes.keys()];
      clock.tick(80);
      expect(scheduler.sendNote({ note: 72, durationTicks: 3 }, { priority: 0, laneIndex: 1 })).to.equal(false);
      expect([...scheduler._activeNotes.keys()]).to.deep.equal(originalTokens);
      expect(scheduler.getOutputPressure().reason).to.equal('local-voice-priority');
      expect(scheduler._noteOffs).to.have.length(0);
      for (let index = 0; index < 8; index++) scheduler.sendNote({ note: 60 + index, durationTicks: 0 }, { priority: 4, laneIndex: 1 });
      const lanes = [...scheduler._activeNotes.values()].map(voice => voice.laneIndex);
      expect(lanes.filter(lane => lane === 0)).to.have.length(4);
      expect(lanes.filter(lane => lane === 1)).to.have.length(4);
      expect(context.oscillators.slice(0, 4).every(node => !node.disconnected && node.stops.at(-1) > context.currentTime)).to.equal(true);
      expect(preview.getState().voiceSteals).to.equal(8);
      scheduler.allNotesOff(); expect(preview._voicesByToken.size).to.equal(0);
      scheduler.dispose(); await preview.dispose();
    });
  });

  it('rejects source-cap overflow before evicting an existing scheduler gate', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview } = setup({ nowMs: () => clock.now }); await preview.enable();
      let available = true;
      const output = { ...preview.output, canAllocateVoice: () => available };
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false }, limits: { maxActiveNotes: 1 } }); scheduler.setOutput(output);
      expect(scheduler.sendNote({ note: 60, durationTicks: 0 }, { priority: 0 })).to.equal(true);
      const existing = [...scheduler._activeNotes.keys()]; available = false;
      expect(scheduler.sendNote({ note: 72, durationTicks: 0 }, { priority: 4 })).to.equal(false);
      expect([...scheduler._activeNotes.keys()]).to.deep.equal(existing);
      expect([...preview._voices][0].released).to.equal(false);
      expect(scheduler.getOutputPressure().reason).to.equal('local-source-cap');
      scheduler.dispose(); await preview.dispose();
    }, { now: 60000 });
  });

  it('retains a decaying percussion note whose zero-level release is scheduled in the future', async () => {
    const { preview, context } = setup(); await preview.enable();
    preview.output.channels[1].sendNoteOn(36, { voiceToken: 1, instrument: { percussion: true } });
    preview.output.channels[1].sendNoteOff(36, { time: 2000, voiceToken: 1 });
    const percussion = [...preview._voices][0];
    expect(percussion.releaseLevel).to.equal(0); expect(percussion.releaseAt).to.be.greaterThan(context.currentTime);
    preview.output.channels[1].sendNoteOn(60, { voiceToken: 2 });
    expect(preview._voices.has(percussion)).to.equal(true); expect(percussion.oscillator.disconnected).to.equal(false);
    await preview.dispose();
  });

  it('reclaims finished or inaudible percussion gates without cutting a live high-priority note', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      Object.defineProperty(context, 'currentTime', { get: () => 2 + clock.now / 1000 });
      await preview.enable();
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false }, limits: { maxActiveNotes: 2 } });
      scheduler.setOutput(preview.output);
      scheduler.sendNote({ note: 60, durationTicks: 0 }, { priority: 4 });
      scheduler.sendNote({ note: 42, durationTicks: 0, percussion: true }, { priority: 4 });
      const melody = [...scheduler._activeNotes.keys()][0];
      clock.tick(70);
      expect(scheduler.sendNote({ note: 65, durationTicks: 0 }, { priority: 0 })).to.equal(true);
      expect(scheduler._activeNotes.has(melody)).to.equal(true);
      expect(scheduler._activeNotes.size).to.equal(2);
      expect(preview._voices.size).to.equal(2);
      scheduler.dispose(); await preview.dispose();
    });
  });

  it('bounds explicitly configured local sources at64 and scheduled sources plus tails at96', async () => {
    const { preview, context } = setup({ maxVoices: 1000 }); await preview.enable();
    for (let index = 0; index < 64; index++) preview.output.channels[1].sendNoteOn(48 + index % 24, { voiceToken: index + 1 });
    expect(preview.getState()).to.include({ maxVoices: 64, maxScheduledVoices: 96, activeVoices: 64 });
    context.currentTime = 2.1;
    for (let index = 0; index < 128; index++) preview.output.channels[1].sendNoteOn(60, { voiceToken: 100 + index });
    expect(preview._voices.size).to.be.at.most(96);
    expect([...preview._voices].filter(voice => !voice.stolen)).to.have.length.at.most(64);
    expect(preview.getState().voiceDrops).to.be.greaterThan(0);
    preview.panic(); expect(preview._voicesByToken.size).to.equal(0); await preview.dispose();
  });

  it('removes a rejected render gate without scheduling a phantom note-off or panicking other notes', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview } = setup({ nowMs: () => clock.now }); await preview.enable();
      const original = preview.output;
      const output = { ...original, channels: { ...original.channels, 1: { ...original.channels[1], sendNoteOn: () => false } } };
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false } }); scheduler.setOutput(output);
      expect(scheduler.sendNote({ note: 60, durationTicks: 4 })).to.equal(false);
      expect(scheduler._activeNotes.size).to.equal(0); expect(scheduler._noteOffs).to.have.length(0);
      expect(scheduler.getOutputPressure().reason).to.equal('local-render-rejected');
      scheduler.dispose(); await preview.dispose();
    });
  });

  it('permits all32 scheduler voices and fades only the overflow voice with bounded release tails', async () => {
    const { preview, context } = setup(); await preview.enable();
    for (let index = 0; index < 32; index++) preview.output.channels[1].sendNoteOn(48 + index);
    expect(preview._voices.size).to.equal(32);
    expect([...preview._voices].every(voice => !voice.stolen && !voice.released)).to.equal(true);
    const oldest = [...preview._voices][0]; context.currentTime = 2.1;
    preview.output.channels[1].sendNoteOn(84);
    expect(oldest.stolen).to.equal(true); expect(oldest.oscillator.disconnected).to.equal(false);
    expect(oldest.end).to.be.closeTo(2.14, 1e-9);
    expect([...preview._voices].filter(voice => !voice.stolen)).to.have.length(32);
    preview.panic(); expect(preview._voices.size).to.equal(0); await preview.dispose();
  });

  it('keeps nominal headroom independent of the configured voice capacity', async () => {
    const small = setup({ maxVoices: 2, masterVolume: 1 }), full = setup({ maxVoices: 32, masterVolume: 1 });
    await small.preview.enable(); await full.preview.enable();
    expect(small.context.gains[0].gain.value).to.equal(0.15);
    expect(full.context.gains[0].gain.value).to.equal(0.15);
    expect(Math.max(...full.context.limiters[0].curve.map(Math.abs))).to.be.lessThan(0.9);
    await small.preview.dispose(); await full.preview.dispose();
  });

  it('retains earlier non-overlapping notes while bounding polyphony and total queued voices', async function() {
    const { preview, context } = setup({ maxVoices: 2 });
    await preview.preview(Array.from({ length: 8 }, (_, index) => ({ note: 60 + index, offsetMs: index * 150, durationMs: 50 })));
    expect(context.oscillators.every(node => !node.disconnected)).to.equal(true);
    preview.output.clear();
    for (let index = 0; index < 100; index += 1) preview.output.channels[1].sendNoteOn(60 + index % 12);
    expect(preview.getState().activeVoices).to.be.at.most(64);
    expect(context.oscillators.filter(node => !node.disconnected && node.stops.at(-1) > 2.04)).to.have.length.at.most(2);
    await preview.dispose();
    expect(context.oscillators.every(node => node.disconnected && node.onended === null)).to.equal(true);
  });

  it('clears scheduled future voices and prevents zombie ended callbacks', async function() {
    const { preview, context } = setup();
    await preview.preview([{ note: 60, offsetMs: 600 }]);
    const node = context.oscillators[0];
    const ended = node.onended;
    preview.panic();
    expect(preview.getState()).to.include({ enabled: false, activeVoices: 0 });
    expect(node.disconnected).to.equal(true);
    expect(node.onended).to.equal(null);
    ended();
    expect(preview.getState().activeVoices).to.equal(0);
    expect(preview.output.channels[1].sendNoteOn(62)).to.equal(false);
    await preview.dispose();
  });

  it('keeps the enabled adapter usable after scheduler output.clear', async function() {
    const { preview, context } = setup();
    await preview.enable();
    preview.output.channels[1].sendNoteOn(60);
    preview.output.clear();
    expect(context.oscillators[0].disconnected).to.equal(true);
    expect(preview.getState().enabled).to.equal(true);
    expect(preview.output.channels[1].sendNoteOn(62)).to.equal(true);
    await preview.dispose();
  });

  it('cleans up when the browser interrupts a running audio context', async function() {
    const { preview, context } = setup();
    await preview.enable();
    preview.output.channels[1].sendNoteOn(60);
    context.suspend();
    expect(preview.getState()).to.include({ status: 'interrupted', enabled: false, activeVoices: 0 });
    expect(context.oscillators[0].disconnected).to.equal(true);
    expect(await preview.enable()).to.equal(true);
    await preview.dispose();
  });

  it('implements the scheduler surface including MPE, timestamped releases, pan and panic', async function() {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup();
      await preview.enable();
      const scheduler = new MidiScheduler({
        mpe: { enabled: true, masterChannel: 1, memberChannels: [2, 3], pitchBendRange: { semitones: 12, cents: 0 } },
        defaultChannel: 1
      });
      scheduler.setOutput(preview.output);
      scheduler.setTickMs(60);
      expect(scheduler.sendNote({ note: 60, velocity: 80, pitchBend: 0.5, pan: 127, timbre: 100, durationTicks: 4, timeMs: 1100 })).to.equal(true);
      expect(context.oscillators).to.have.length(0);
      clock.tick(100);
      expect(context.oscillators).to.have.length(1);
      expect(context.oscillators[0].detune.events[0].value).to.equal(600);
      expect([...preview._voices][0].pan.pan.events.at(-1).value).to.equal(1);
      scheduler.allNotesOff();
      expect(preview.getState().activeVoices).to.equal(0);
      expect(context.oscillators[0].disconnected).to.equal(true);
      expect(scheduler._noteOffTimerId).to.equal(0);
      scheduler.dispose();
      await preview.dispose();
    }, { now: 1000 });
  });

  it('pairs consecutive scheduled same-pitch notes independently', async function() {
    const { preview, context } = setup();
    await preview.enable();
    const channel = preview.output.channels[1];
    channel.sendNoteOn(60, { time: 1000 });
    channel.sendNoteOff(60, { time: 1100 });
    channel.sendNoteOn(60, { time: 1050 });
    channel.sendNoteOff(60, { time: 1250 });
    expect(context.oscillators.map(node => node.stops.at(-1))).to.eql([2.14, 2.29]);
    channel.sendNoteOff(60);
    expect(preview.getState().activeVoices).to.equal(0);
    await preview.dispose();
  });

  it('supports pitch bend automation for existing and later-created voices', async function() {
    const { preview, context } = setup();
    await preview.enable();
    const channel = preview.output.channels[3];
    channel.sendPitchBendRange(3, 50);
    channel.sendPitchBend(0.5, { time: 1100 });
    channel.sendPitchBend(0, { time: 1500 });
    channel.sendNoteOn(69, { time: 1200 });
    expect(context.oscillators[0].detune.events).to.eql([
      { type: 'set', value: 175, time: 2.2 },
      { type: 'set', value: 0, time: 2.5 }
    ]);
    channel.sendPitchBend(-1, { time: 1300 });
    expect(context.oscillators[0].detune.events).to.eql([
      { type: 'set', value: 175, time: 2.2 },
      { type: 'set', value: -350, time: 2.3 },
      { type: 'set', value: 0, time: 2.5 }
    ]);
    channel.sendControlChange(7, 100);
    channel.sendControlChange(11, 64);
    expect(preview._channels.get(3).gain.gain.events.at(-1).value).to.be.closeTo(100 * 64 / (127 * 127), 0.00001);
    channel.sendControlChange(120, 0);
    expect(preview.getState().activeVoices).to.equal(0);
    await preview.dispose();
  });

  it('keeps simultaneous voices on the same channel at their own pan positions', async function() {
    const { preview } = setup();
    await preview.enable();
    preview.output.channels[1].sendNoteOn(60, { pan: -1 });
    preview.output.channels[1].sendNoteOn(67, { pan: 1 });
    const voices = [...preview._voices];
    expect(voices.map(voice => voice.pan.pan.events.at(-1).value)).to.deep.equal([-1, 1]);
    preview.panic();
    expect(voices.every(voice => voice.pan.disconnected)).to.equal(true);
  });

  it('tolerates unavailable panning and exceptions in status consumers', async function() {
    const context = new FakeContext();
    context.createStereoPanner = undefined;
    const { preview } = setup({ onStateChange: () => { throw new Error('UI failed'); } }, context);
    expect(await preview.enable()).to.equal(true);
    preview.output.channels[1].sendControlChange(10, 0);
    expect(await preview.preview([60])).to.equal(true);
    await preview.dispose();
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

  it('disconnects partially constructed voices and failed channel graphs', async function() {
    const { preview, context } = setup();
    await preview.enable();
    preview.output.channels[1].sendControlChange(10, 64);
    const createGain = context.createGain.bind(context);
    context.createGain = () => { throw new Error('Resource exhausted'); };
    expect(preview.output.channels[1].sendNoteOn(60)).to.equal(false);
    expect(context.oscillators[0].disconnected).to.equal(true);
    expect(preview.getState().activeVoices).to.equal(0);
    context.createGain = createGain;
    context.createStereoPanner = () => { throw new Error('Panner failed'); };
    expect(preview.output.channels[2].sendPitchBend(0)).to.equal(false);
    expect(context.gains.at(-1).disconnected).to.equal(true);
    await preview.dispose();
  });

  it('reports note completion so local listening status cannot stay stale', async function() {
    const { preview, context } = setup();
    const counts = [];
    preview.subscribe(state => counts.push(state.activeVoices));
    await preview.preview([60]);
    expect(counts.at(-1)).to.equal(1);
    context.oscillators[0].end();
    expect(counts.at(-1)).to.equal(0);
    expect(preview.getState().activeVoices).to.equal(0);
    await preview.dispose();
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


describe('polyphonic clip dispatch to existing event-card playback feedback', function() {
  it('creates separate actual-pitch gate spans for voices/repeats and cleans all spans on Panic without a frame layout loop', async function() {
    await withFakeClockAndPerformance(async clock => {
      const context = new FakeContext(); context.currentTime = 0;
      const document = new TestDocument(), row = document.createElement('button'); row.dataset.gameEventId = '20';
      let reads = 0; row.getBoundingClientRect = () => { reads++; return { width: 240 }; };
      const create = document.createElement.bind(document), animations = [], emitted = [];
      document.createElement = tag => { const node = create(tag); node.isConnected = true; node.remove = () => node.parent?.removeChild(node);
        node.animate = (frames, options) => { const animation = { frames, options, cancel() {} }; animations.push(animation); return animation; }; return node; };
      const cells = Array.from({ length: 8 }, () => document.createElement('button')); let selectedSource = 'sfx-20';
      const feedback = createMidiEventPlayback({ document, window: { performance: { now: () => clock.now } }, getRows: () => [row],
        getCellTarget: event => event.clipId === 'poly' && event.sourceId === selectedSource ? cells[event.stepIndex] : null });
      const preview = new BrowserNotePreview({ createAudioContext: () => context, nowMs: () => clock.now,
        onPlayback: event => { emitted.push(event); feedback.onPlayback({ ...event, owner: 'game' }); } }); await preview.enable();
      const router = new MidiEventRouter({ enabled: true, mpe: { enabled: false }, density: { velocityBoost: 0, durationScale: 0 },
        scale: { name: 'chromatic', root: 0 }, noteRange: { min: 0, max: 127 }, velocityRange: { min: 1, max: 127, default: 80 },
        durationTicks: { min: 1, max: 960, default: 4 }, sfx: { 20: { note: 60, channel: 1, sourceId: 'sfx-20', sourceKind: 'sfx', sourceKey: '20', clipSequence: { id: 'poly', advance: 'game-tick', spacingTicks: 2,
          steps: [{ voices: [{ note: 60, velocity: 45, durationTicks: 5 }, { note: 64, velocity: 95, durationTicks: 2 }], transformLayers: [{ type: 'repeat', count: 2, spacingTicks: 2, transpose: 7 }] }, { note: null }, { note: 72, probability: 0 }] } } } });
      const timer = { tick: 0, frameTime: 60, onGameTick: new EventHandler(), getGameTicks() { return this.tick; }, get tps() { return 1000 / this.frameTime; } };
      router.setOutput(preview.output); router.attach({ onEvent: new EventHandler(), gameTimer: timer });
      try {
        router._onEvent({ sfxId: 20, tick: 0, frameMs: 60 });
        for (let index = 0; index < 2; index++) { context.currentTime += 0.06; clock.tick(60); timer.tick++; timer.onGameTick.trigger(); }
        const starts = emitted.filter(event => event.phase === 'start');
        expect(starts.map(event => [event.note, event.velocity])).to.deep.equal([[60, 45], [64, 95], [67, 45], [71, 95]]);
        starts.forEach((event, index) => expect(event.durationMs).to.be.closeTo(index % 2 ? 120 : 300, 0.000001));
        expect(new Set(starts.map(event => event.id)).size).to.equal(4); expect(row.children.map(node => node.textContent)).to.include.members(['C4', 'E4', 'G4', 'B4']);
        expect(starts.every(event => event.clipId === 'poly' && event.sourceId === 'sfx-20' && event.originTick === 0 && event.stepIndex === 0)).to.equal(true);
        expect(cells[0].children.map(node => node.textContent)).to.deep.equal(['C4', 'E4', 'G4', 'B4']); expect(cells.slice(1).every(cell => !cell.children.length)).to.equal(true);
        selectedSource = 'sfx-21'; feedback.render(); expect(cells.every(cell => !cell.children.length)).to.equal(true); expect(row.children).to.have.length(4);
        selectedSource = 'sfx-20'; feedback.render(); expect(cells[0].children).to.have.length(4);
        const before = reads; for (let index = 0; index < 5; index++) feedback.render(); expect(reads).to.equal(before);
        expect(animations.every(animation => animation.options.duration > 0 && animation.frames.at(-1).opacity === 0)).to.equal(true);
        router.scheduler.allNotesOff(); expect(row.children).to.have.length(0); expect(preview._voices.size).to.equal(0); expect(cells.every(cell => !cell.children.length)).to.equal(true);
      } finally { router.dispose(); preview.dispose(); feedback.dispose(); }
    });
  });
});


describe('owner Stop retires autonomous creative effects', () => {
  it('waits for only the stopped owner and prevents enable from racing its producer retirement', async () => {
    const context = new FakeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context }), stopped = preview.createSession('stopped'), continuing = preview.createSession('continuing');
    await stopped.enable(); await continuing.enable();
    stopped.output.channels[1].sendNoteOn(60, { rawAttack: 100 }); continuing.output.channels[1].sendNoteOn(64, { rawAttack: 100 });
    const stoppedId = stopped.getState().ownerId, continuingId = continuing.getState().ownerId, channel = [...preview._channels.values()].find(value => value.owner === stoppedId), release = deferred(), scope = createProcgenRetirementScope(); let disposed = 0;
    channel.effects = { panic() {}, dispose() { disposed++; return scope.retire([{ name: 'latched-body-producer', run: () => release.promise }]); } };
    const receipt = stopped.stop(); expect(receipt.outcome).to.equal('pending'); expect(disposed).to.equal(1); expect([...preview._voices].some(voice => voice.owner === continuingId)).to.equal(true);
    const enabling = stopped.enable(); await Promise.resolve(); expect(stopped.getState().enabled).to.equal(false);
    release.resolve(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(await enabling).to.equal(true); expect(channel.effects).to.equal(null);
    await stopped.dispose(); await continuing.dispose(); await preview.dispose();
  });
});
