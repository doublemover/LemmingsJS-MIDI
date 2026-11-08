import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { EventHandler } from '../js/util/EventHandler.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { createProcgenSimulationCore } from '../js/app/procgen/ProcgenSimulationCore.js';
import { prepareProcgenSimulationRealm } from '../js/app/procgen/ProcgenSimulationRealm.js';
import { createProcgenRetirementScope } from '../js/app/procgen/ProcgenRetirement.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { captureCausalPerformanceState, createCausalPerformanceState } from '../js/app/procgen/workstation/CausalPerformanceState.js';
import { createProcgenPhysicalScoreClock } from '../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { captureProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { hashProcgenContinuationCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpointProvenance.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const boundaryWorld = () => ({
  worldId: 'protocol-boundary', generation: 1, tickIndex: 10, timer: { speedFactor: 1 }, soundEvents: { onBatch: new EventHandler() },
  step() {
    this.tickIndex++;
    for (let index = 0; index < 2; index++) {
      const snapshot = { tick: this.tickIndex, generation: this.generation };
      this.soundEvents.onBatch.trigger({ version: 1, worldId: this.worldId, ...snapshot, snapshot, facts: [] });
      if (!index) this.generation++;
    }
  }
});
const retirement = world => {
  const scope = createProcgenRetirementScope();
  return () => scope.retire([{ name: 'fixture-world', run: () => world.dispose() }]);
};
const retired = async core => { const receipt = core.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); };

describe('authoritative simulation generation delivery', () => {
  it('admits the sealed predecessor after the real world has advanced generation and keeps the clock ordered (#1267)', async () => {
    const world = { worldId: 'sealed-generation', generation: 1, tickIndex: 10, timer: { speedFactor: 1 }, soundEvents: { onBatch: new EventHandler() },
        step() {
          this.tickIndex++; const previous = this.generation; if (this.tickIndex === 11) this.generation++;
          const emit = (generation, terminalGenerationTransition = null) => this.soundEvents.onBatch.trigger({ version: 1, worldId: this.worldId, generation, tick: this.tickIndex, sourceTimeMs: this.tickIndex * 60, tickDurationMs: 60, facts: [], snapshot: { tick: this.tickIndex, generation }, terminalGenerationTransition });
          if (previous !== this.generation) emit(previous, { from: previous, to: this.generation });
          emit(this.generation);
        } }, clock = createProcgenPhysicalScoreClock(), received = [];
    const core = createProcgenSimulationCore({ world, clock, scoreTimeline: true, requiredConsumer: packet => { received.push(packet.batch.generation); return { accepted: true }; } });
    try {
      core.step(100); core.step(160);
      expect(received).to.deep.equal([1, 2, 2]); expect(core.state()).to.include({ tick: 12, generation: 2, pendingCausalBatches: 0, failure: null });
      expect(clock.snapshot()).to.include({ generation: 2, lastTick: 12 }); expect(clock.snapshot().timeline.epochs).to.have.length(2);
    } finally { await retired(core); }
  });
  it('rejects an undeclared predecessor instead of treating every stale generation as a reset (#1267)', async () => {
    const world = boundaryWorld(); world.step = function() { this.tickIndex++; this.generation++;
      this.soundEvents.onBatch.trigger({ version: 1, worldId: this.worldId, generation: this.generation - 1, tick: this.tickIndex, facts: [], snapshot: {} }); };
    const received = [], core = createProcgenSimulationCore({ world, requiredConsumer: packet => { received.push(packet); return { accepted: true }; } });
    try { expect(() => core.step(100)).to.throw('outside its host-owned completed step'); expect(received).to.have.length(0); expect(core.state()).to.include({ phase: 'failed-paused', paused: true }); }
    finally { await retired(core); }
  });
  it('delivers both completed batches once and refuses reentrant physics while the consumer runs', async () => {
    const world = boundaryWorld(), received = [];
    const core = createProcgenSimulationCore({ world, requiredConsumer(packet) {
      received.push([packet.sequence, packet.batch.tick, packet.batch.generation]);
      expect(() => core.step()).to.throw('required causal acknowledgment');
      return { accepted: true };
    } });
    try {
      const final = core.step(100);
      expect(received).to.deep.equal([[1, 11, 1], [2, 11, 2]]);
      expect(final.sequence).to.equal(2); expect(core.state()).to.include({ tick: 11, generation: 2, ticks: 1, pendingCausalBatches: 0 });
    } finally { await retired(core); }
  });
  it('waits for the terminal ACK before sending the new generation, and for its ACK before advancing', async () => {
    const world = boundaryWorld(), received = [], acknowledgments = [];
    let nextDelivered; const second = new Promise(resolve => { nextDelivered = resolve; });
    const core = createProcgenSimulationCore({ world, requiredConsumer(packet) {
      received.push(packet.batch.generation);
      if (received.length === 2) nextDelivered();
      return new Promise(resolve => acknowledgments.push(resolve));
    } });
    try {
      const pending = core.step(100); expect(received).to.deep.equal([1]); expect(core.state().pendingCausalBatches).to.equal(2);
      expect(() => core.step()).to.throw('required causal acknowledgment');
      acknowledgments[0]({ accepted: true }); await second;
      expect(received).to.deep.equal([1, 2]); expect(core.state().pendingCausalBatches).to.equal(1);
      expect(world.tickIndex).to.equal(11);
      let checkpointFailure; try { await core.checkpoint(); } catch (error) { checkpointFailure = error; }
      expect(checkpointFailure.code).to.equal('host-unavailable');
      acknowledgments[1]({ accepted: true }); expect((await pending).batch.generation).to.equal(2);
      expect(core.state().pendingCausalBatches).to.equal(0);
    } finally { for (const resolve of acknowledgments) resolve({ accepted: true }); await retired(core); }
  });
  it('pauses on a refused terminal ACK without dispatching the following generation', async () => {
    const world = boundaryWorld(), received = [];
    const core = createProcgenSimulationCore({ world, requiredConsumer: packet => { received.push(packet.batch.generation); return Promise.resolve({ accepted: false }); } });
    try {
      let failure; try { await core.step(100); } catch (error) { failure = error; }
      expect(failure.code).to.equal('causal-consumer-refused'); expect(received).to.deep.equal([1]);
      expect(core.state()).to.include({ paused: true, phase: 'failed-paused', pendingCausalBatches: 2 });
      expect(() => core.resume()).to.throw('refused');
    } finally { await retired(core); }
  });
});

describe('real-world authoritative realm continuation', function() {
  this.timeout(120000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  for (const seed of [42, 1701]) it('matches 10,000 physical ticks and intents from a paused checkpoint, seed ' + seed, async () => {
    const make = () => new ProcgenLaneWorld({ masks, worldId: 'authoritative-parity-' + seed, seed, laneCount: 2, assists: false, cohorts: true,
      stallPolicy: { secondsWithoutProgress: 2, baseSpawnAllowance: 0, maxSpawnAllowance: 0, transitSafetyFactor: 0, workGraceSeconds: 0, pendingWorkGraceSeconds: 0, cascadeMinTicks: 1, cascadeMaxTicks: 1 } });
    const original = make(), clock = createProcgenPhysicalScoreClock(),
      performance = createCausalPerformanceState(captureCausalPerformanceState([{ id: 'lane-a' }, { id: 'lane-b' }]));
    original.configurePhysicalAuthoring({ version: 1, revision: 1, instruments: [
      { id: 'crossing', sourceKind: 'MotionCommitted', gateX: 40, pitchCents: 6012.345, velocity01: 0.75, role: 'travel', route: 'local' }
    ] });
    const engine = createCausalMusicEngine({ world: original, getGraph: () => original.physicalAuthoring.graph, scoreTimeline: clock, traceLimit: 0,
      getLaneState: source => performance.getLaneState(source), getPerformanceState: () => performance.snapshot(),
      getOnsetControls: (source, identity) => performance.getControls(source, identity), getTimeTransformPolicy: source => performance.getTimeTransformPolicy(source),
      getScoreContextPolicy: source => performance.getScoreContextPolicy(source), getPianoPolicy: source => performance.getPianoPolicy(source),
      getPianoControls: source => performance.getPianoControls(source), getOrchestralPolicy: source => performance.getOrchestralPolicy(source),
      getPercussionPolicy: source => performance.getPercussionPolicy(source), getPhysicalControlKinds: source => performance.getPhysicalControlKinds(source) });
    original.timer.speedFactor = 0;
    const manifest = { schema: 'lemmings-authoritative-simulation/v1', ownerId: 'parity-owner', ownerEpoch: 1, documentRevision: 1,
      resourceProfile: 'compact-v1', checkpoint: captureProcgenCheckpoint(original), semantic: engine.snapshot(), performance: performance.snapshot(),
      graph: original.physicalAuthoring.graph, rootPath: '/', timeline: clock.snapshot(), nominalSpeed: 1.5, bpm: 123, playing: true, scoreTimeline: true };
    const hashes = [createHash('sha256'), createHash('sha256')], counts = [0, 0], intentCounts = [0, 0];
    const consume = index => packet => { hashes[index].update(JSON.stringify(packet)); counts[index]++; intentCounts[index] += packet.intents.length; return { accepted: true }; };
    let reference, candidate;
    try {
      candidate = (await prepareProcgenSimulationRealm({ manifest, requiredConsumer: consume(1), createWorld: async () => {
        const world = make(); return { world, dispose: retirement(world) };
      } })).host;
      reference = createProcgenSimulationCore({ world: original, engine, clock, nominalSpeed: manifest.nominalSpeed, documentRevision: 1, scoreTimeline: true,
        bpm: manifest.bpm, requiredConsumer: consume(0), getPerformance: () => performance.snapshot(), disposeWorld: retirement(original) });
      for (const core of [reference, candidate]) {
        expect(core.state()).to.include({ paused: true, nominalSpeed: 1.5, effectiveSpeed: 0, tickDurationMs: 40 });
        core.resume();
      }
      let commandSequence = 0;
      for (let tick = 0; tick < 10000;) {
        if (tick === 0 || tick === 4992) {
          const state = reference.state(), intendedTick = state.tick + 1, command = { sequence: ++commandSequence, documentRevision: 1, generation: state.generation, intendedTick,
            command: { id: 'release-' + commandSequence, kind: 'set-release-policy', target: { generation: state.generation }, applyAtTick: intendedTick,
              parameters: { spawnBeatTicks: commandSequence === 1 ? 10 : 12, spawnSpreadTicks: 2 } } };
          const receipt = reference.submit(command); expect(candidate.submit(command)).to.deep.equal(receipt);
          expect(reference.submit(command)).to.equal(receipt);
        }
        const steps = Math.min(64, 10000 - tick), timestamp = tick * 40;
        await reference.advance({ steps, timestamp }); await candidate.advance({ steps, timestamp }); tick += steps;
      }
      expect(counts[0]).to.equal(counts[1]); expect(counts[0]).to.be.greaterThan(10000);
      expect(intentCounts[0]).to.equal(intentCounts[1]); expect(intentCounts[0]).to.be.greaterThan(0);
      expect(hashes[0].digest('hex')).to.equal(hashes[1].digest('hex'));
      reference.pause(); candidate.pause();
      const a = await reference.checkpoint(), b = await candidate.checkpoint();
      expect(await hashProcgenContinuationCheckpoint(a.world)).to.equal(await hashProcgenContinuationCheckpoint(b.world));
      expect(b.engine).to.deep.equal(a.engine); expect(b.timeline).to.deep.equal(a.timeline); expect(b.performance).to.deep.equal(a.performance);
      expect(candidate.state()).to.include({ tick: 10000, paused: true, nominalSpeed: 1.5, effectiveSpeed: 0 });
    } finally {
      if (candidate) await retired(candidate);
      if (reference) await retired(reference); else { engine.dispose(); original.dispose(); }
    }
  });
});
