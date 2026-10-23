import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenSoundEventBus } from '../js/app/procgen/ProcgenSoundEventBus.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

describe('completed physical event batches', () => {
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });

  it('publishes two builder strikes after both actors and lane counts complete', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 2, assists: false });
    for (const actor of world.actors) { actor.setAction(world.actions[State.BUILDING]); actor.frameIndex = 8; }
    const observed = [], batches = [];
    world.soundEvents.onEvent.on(event => {
      if (event.type !== 'builder-step') return;
      observed.push({ frames: world.actors.map(actor => actor.frameIndex), counts: world.stall.lanes.map(lane => lane.buildingCount), completed: world._musicCompletedTick });
    });
    world.soundEvents.onBatch.on(batch => { batches.push(batch); expect(() => world.step()).to.throw('reentered'); });
    world.step();
    expect(observed).to.deep.equal([
      { frames: [9, 9], counts: [1, 1], completed: 1 },
      { frames: [9, 9], counts: [1, 1], completed: 1 }
    ]);
    expect(batches).to.have.length(1);
    expect(batches[0]).to.include({ version: 1, generation: 1, tick: 1 });
    expect(batches[0].facts.filter(fact => fact.type === 'builder-step').map(fact => fact.lemmingId)).to.deep.equal(world.actors.map(actor => actor.id));
    expect(batches[0].snapshot.lanes.map(lane => lane.buildingCount)).to.deep.equal([1, 1]);
    expect(Object.isFrozen(batches[0].facts)).to.equal(true);
    world.dispose();
  });

  it('isolates throwing musical listeners and does not publish an incomplete physics tick', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 2, assists: false });
    for (const actor of world.actors) { actor.setAction(world.actions[State.BUILDING]); actor.frameIndex = 8; }
    const events = [], batches = [];
    world.soundEvents.onEvent.on(() => { throw new Error('output failed'); });
    world.soundEvents.onEvent.on(event => events.push(event));
    world.soundEvents.onBatch.on(batch => batches.push(batch));
    world.step();
    expect(world.actors.map(actor => actor.frameIndex)).to.deep.equal([9, 9]);
    expect(events.filter(event => event.type === 'builder-step')).to.have.length(2);
    expect(batches).to.have.length(1);
    expect(world.soundEvents.deliveryErrors).to.equal(events.length);
    world.dispose();

    const broken = new ProcgenLaneWorld({ masks, assists: false });
    const brokenBatches = []; broken.soundEvents.onBatch.on(batch => brokenBatches.push(batch));
    broken.actors[0].process = () => { throw new Error('physics failed'); };
    expect(() => broken.step()).to.throw('physics failed');
    expect(brokenBatches).to.have.length(0);
    expect(() => broken.step()).to.throw('incomplete');
    broken.dispose();
  });

  it('seals old generation facts before a distinct new generation boundary', () => {
    const bus = new ProcgenSoundEventBus({ getGameTicks: () => 5, frameTime: 60 }, 1);
    const batches = []; bus.onBatch.on(batch => batches.push(batch));
    bus.beginTick({ worldId: 'scene', generation: 2, tick: 5, terrainRevisionBefore: 8 });
    bus.emit({ type: 'builder-step', lemmingId: 7, x: 10, y: 20 });
    bus.sealGeneration(Object.freeze({ revision: '2:5' }), 9, 3);
    bus.emit({ type: 'lemming-spawn', lemmingId: 8, x: 0, y: 0 });
    bus.commitTick(Object.freeze({ revision: '3:5' }), 10);
    expect(batches.map(batch => batch.generation)).to.deep.equal([2, 3]);
    expect(batches[0].terminalGenerationTransition).to.deep.equal({ from: 2, to: 3 });
    expect(batches[0].facts[0].causalSequence).to.be.lessThan(batches[1].facts[0].causalSequence);
    expect(batches[0].snapshot.revision).to.equal('2:5');
    expect(batches[1].snapshot.revision).to.equal('3:5');
    bus.dispose();
  });

  it('bounds facts, preserves terminal causes, and copies nested event data', () => {
    const bus = new ProcgenSoundEventBus({ getGameTicks: () => 1, frameTime: 60 }, 1);
    bus._maxFacts = 1;
    const batches = []; bus.onBatch.on(batch => batches.push(batch));
    const stages = ['build'];
    bus.beginTick({ worldId: 'scene', generation: 1, tick: 1, terrainRevisionBefore: 0 });
    bus.emit({ type: 'builder-step', chainStages: stages });
    stages.push('dig');
    bus.emit({ type: 'builder-warning' });
    bus.emit({ type: 'lemming-splat', lemmingId: 7 });
    bus.commitTick(Object.freeze({ revision: '1:1' }), 1);
    expect(batches[0].facts.map(fact => fact.type)).to.deep.equal(['builder-step', 'lemming-splat']);
    expect(batches[0].facts[0].chainStages).to.deep.equal(['build']);
    expect(batches[0].completeness).to.deep.equal({ status: 'incomplete', dropped: 1 });
    bus.dispose();
  });
});
