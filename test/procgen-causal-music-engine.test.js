import { expect } from 'chai';
import { createCausalMusicEngine, validateCausalInstrumentGraph } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const instrument = (id, sourceKind, extra = {}) => ({ id, sourceKind, pitchCents: 6000, velocity01: 0.75,
  role: 'percussion', route: 'local', ...extra });
const graph = instruments => ({ version: 1, revision: 1, instruments });
const batch = (tick, facts, generation = 1, completeness = { status: 'complete', dropped: 0 }) => ({
  version: 1, worldId: 'scene', generation, tick, batchId: `scene:${generation}:${tick}:0`, completeness,
  facts: facts.map((fact, index) => ({ causalSequence: tick * 10000 + index + 1, eventId: `scene:${generation}:${tick}:${index + 1}`,
    subTick: 0, precision: 'tick', ...fact }))
});

describe('causal musical intent engine', () => {
  it('captures copied performer controls and measured work inputs without changing onset truth', () => {
    const current = graph([instrument('brick', 'TerrainWorkCommitted')]), controls = { macros: { hardness: 0.7 }, variationSeed: 91 };
    const engine = createCausalMusicEngine({ getGraph: () => current, getOnsetControls: () => controls });
    const physical = batch(1, [{ kind: 'TerrainWorkCommitted', actorId: 7, laneId: 0, physicalPayload: { changedSolidCells: 6, pressure: 99 } }]);
    const intents = engine.processBatch(physical); controls.macros.hardness = 0;
    expect(intents.map(intent => intent.kind)).to.deep.equal(['begin', 'end']); expect(intents[0].performanceControls.macros.hardness).to.equal(0.7);
    expect(intents[0].performanceCause.values).to.deep.equal({ changedSolidCells: { value: 6, unit: 'cells' } });
    expect(intents[0].sourceEventIds).to.deep.equal([physical.facts[0].eventId]); expect(intents[1].performanceControls).to.equal(undefined);
  });
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });

  it('plays a real builder work operation from a completed world batch', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false });
    const actor = world.actors[0], delivered = [];
    actor.setAction(world.actions[State.BUILDING]); actor.frameIndex = 8;
    const current = graph([instrument('brick', 'TerrainWorkCommitted', { operationKind: 'build' })]);
    const engine = createCausalMusicEngine({ getGraph: () => current, deliver: intents => delivered.push(intents) });
    world.soundEvents.onBatch.on(batch => engine.processBatch(batch));
    world.step();
    expect(delivered[0].map(intent => intent.kind)).to.deep.equal(['begin', 'end']);
    expect(delivered[0][0].actorId).to.equal(actor.id);
    expect(delivered[0][0].sourceEventIds).to.have.length(1);
    world.dispose();
  });

  it('derives work and contact notes from physical facts without step cells or a grid', () => {
    const delivered = [], current = graph([
      instrument('brick', 'TerrainWorkCommitted', { operationKind: 'build', changedOnly: true }),
      instrument('wall', 'ContactResolved', { causeKind: 'wall' })
    ]);
    const engine = createCausalMusicEngine({ getGraph: () => current, deliver: intents => delivered.push(intents) });
    const intents = engine.processBatch(batch(1, [
      { kind: 'TerrainWorkCommitted', actorId: 7, laneId: 0, operationKind: 'build', physicalPayload: { changedSolidCells: 6 } },
      { kind: 'TerrainWorkCommitted', actorId: 7, laneId: 0, operationKind: 'build', physicalPayload: { changedSolidCells: 0 } },
      { kind: 'ContactResolved', actorId: 8, laneId: 0, causeKind: 'wall' }
    ]));
    expect(intents.map(intent => intent.kind)).to.deep.equal(['begin', 'end', 'begin', 'end']);
    expect(intents[0]).to.include({ actorId: 7, batchId: 'scene:1:1:0', velocity01: 0.75 });
    expect(intents[0].sourceEventIds).to.deep.equal(['scene:1:1:1']);
    expect(intents[0].pitch).to.deep.equal({ cents: 6000, referenceHz: 440 });
    expect(delivered[0]).to.equal(intents);
    expect(engine.snapshot().active).to.have.length(0);
  });

  it('triggers three endpoint-evidenced gates once each across ordered motion batches', () => {
    const current = graph([10, 20, 30].map(gateX => instrument(`gate-${gateX}`, 'MotionCommitted', { gateX, crossingDirection: 'positive' })));
    const engine = createCausalMusicEngine({ getGraph: () => current });
    const crossed = [[0, 15], [15, 25], [25, 35]].flatMap(([from, to], index) => engine.processBatch(batch(index + 1, [
      { kind: 'MotionCommitted', actorId: 7, laneId: 0, positionBefore: { x: from, y: 10 },
        positionAfter: { x: to, y: 10 }, precision: 'endpoint' }
    ])).filter(intent => intent.kind === 'begin'));
    expect(crossed).to.have.length(3);
    expect(crossed.map(intent => intent.scoreTime.precision)).to.deep.equal(['endpoint', 'endpoint', 'endpoint']);
    expect(new Set(crossed.map(intent => intent.voiceId)).size).to.equal(3);
    expect(engine.processBatch(batch(4, [{ kind: 'MotionCommitted', actorId: 7,
      positionBefore: { x: 35 }, positionAfter: { x: 36 }, precision: 'endpoint' }])).filter(intent => intent.kind === 'begin')).to.have.length(0);
  });

  it('keeps same-pitch action voices separate and releases each exactly once', () => {
    const current = graph([instrument('builder', 'ActionEntered', { action: 'building' })]);
    const engine = createCausalMusicEngine({ getGraph: () => current });
    const first = engine.processBatch(batch(1, [
      { kind: 'ActionEntered', actorId: 7, laneId: 0, action: 'building', actionInstanceId: '7:action:2' },
      { kind: 'ActionEntered', actorId: 8, laneId: 0, action: 'building', actionInstanceId: '8:action:2' }
    ]));
    expect(first).to.have.length(2);
    expect(first[0].voiceId).not.to.equal(first[1].voiceId);
    const second = engine.processBatch(batch(2, [
      { kind: 'ActionExited', actorId: 8, laneId: 0, actionInstanceId: '8:action:2' },
      { kind: 'ActorTerminated', actorId: 8, laneId: 0, terminationReason: 'out-of-world' }
    ]));
    expect(second).to.have.length(1);
    expect(second[0]).to.include({ kind: 'end', voiceId: first[1].voiceId, terminationReason: 'action-exited' });
    expect(engine.snapshot().active.map(voice => voice.voiceId)).to.deep.equal([first[0].voiceId]);
    const third = engine.processBatch(batch(3, [{ kind: 'ActorTerminated', actorId: 7, laneId: 0, terminationReason: 'cohort-reset' }]));
    expect(third).to.have.length(1);
    expect(third[0].terminationReason).to.equal('cohort-reset');
    expect(engine.snapshot().active).to.have.length(0);
  });

  it('ends owned voices on incomplete source and generation change', () => {
    const current = graph([instrument('hold', 'ActionEntered', { action: 'blocking' })]);
    const engine = createCausalMusicEngine({ getGraph: () => current });
    engine.processBatch(batch(1, [{ kind: 'ActionEntered', actorId: 1, action: 'blocking', actionInstanceId: '1:action:1' }]));
    const incomplete = engine.processBatch(batch(2, [{ kind: 'ActionEntered', actorId: 2, action: 'blocking', actionInstanceId: '2:action:1' }], 1, { status: 'incomplete', dropped: 3 }));
    expect(incomplete.map(intent => intent.kind)).to.deep.equal(['end']);
    expect(incomplete[0].terminationReason).to.equal('incomplete-source');
    engine.processBatch(batch(3, [{ kind: 'ActionEntered', actorId: 1, action: 'blocking', actionInstanceId: '1:action:2' }]));
    const boundary = engine.processBatch(batch(4, [], 2));
    expect(boundary.map(intent => intent.terminationReason)).to.deep.equal(['generation-change']);
    expect(boundary[0].generation).to.equal(1);
  });

  it('rejects malformed content and restores checkpoints transactionally', () => {
    const current = graph([instrument('hold', 'ActionEntered', { action: 'building' })]);
    expect(() => validateCausalInstrumentGraph(graph([instrument('x', 'ActionEntered')]))).to.throw('needs an action');
    const engine = createCausalMusicEngine({ getGraph: () => current });
    const empty = engine.snapshot();
    expect(empty).to.include({ generation: null, graphRevision: 1 });
    engine.restore(empty);
    const source = batch(1, [{ kind: 'ActionEntered', actorId: 7, action: 'building', actionInstanceId: '7:action:1' }]);
    const first = engine.processBatch(source);
    expect(engine.processBatch(source)).to.have.length(0);
    const saved = engine.snapshot();
    expect(() => engine.restore({ ...saved, active: [...saved.active, { ...saved.active[0], instrumentId: 'missing' }] })).to.throw();
    expect(engine.snapshot()).to.deep.equal(saved);
    const repeated = createCausalMusicEngine({ getGraph: () => current });
    expect(JSON.stringify(repeated.processBatch(source))).to.equal(JSON.stringify(first));
    repeated.restore(saved);
    expect(repeated.snapshot()).to.deep.equal(saved);
  });

  it('releases held voices when a graph revision mutes their instrument', () => {
    let current = graph([instrument('hold', 'ActionEntered', { action: 'building' })]);
    const engine = createCausalMusicEngine({ getGraph: () => current });
    const started = engine.processBatch(batch(1, [{ kind: 'ActionEntered', actorId: 3, action: 'building', actionInstanceId: '3:action:1' }]));
    current = { version: 1, revision: 2, instruments: [instrument('hold', 'ActionEntered', { action: 'building', mute: true })] };
    const stopped = engine.processBatch(batch(2, []));
    expect(stopped).to.have.length(1);
    expect(stopped[0]).to.include({ voiceId: started[0].voiceId, kind: 'end', terminationReason: 'mapping-changed' });
    expect(engine.snapshot().active).to.have.length(0);
  });

  it('rejects a changed graph that reuses the old revision without losing a voice', () => {
    let current = graph([instrument('hold', 'ActionEntered', { action: 'building' })]);
    const engine = createCausalMusicEngine({ getGraph: () => current });
    engine.processBatch(batch(1, [{ kind: 'ActionEntered', actorId: 3, action: 'building', actionInstanceId: '3:action:1' }]));
    const saved = engine.snapshot();
    const original = current;
    current = graph([instrument('hold', 'ActionEntered', { action: 'building', pitchCents: 6100 })]);
    expect(() => engine.processBatch(batch(2, []))).to.throw('without a new revision');
    current = original;
    expect(engine.snapshot()).to.deep.equal(saved);
  });

  it('rejects stale batches after bounded duplicate history eviction and restores its source cursor', () => {
    const current = graph([]), engine = createCausalMusicEngine({ getGraph: () => current });
    for (let tick = 1; tick <= 1030; tick++) engine.processBatch(batch(tick, []));
    expect(() => engine.processBatch(batch(1, []))).to.throw('Stale physical batch');
    const saved = engine.snapshot(), restored = createCausalMusicEngine({ getGraph: () => current });
    restored.restore(saved);
    expect(restored.processBatch(batch(1030, []))).to.have.length(0);
    expect(() => restored.processBatch(batch(1, []))).to.throw('Stale physical batch');
    expect(restored.snapshot()).to.deep.equal(saved);
  });
});
