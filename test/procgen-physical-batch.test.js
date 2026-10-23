import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenSoundEventBus } from '../js/app/procgen/ProcgenSoundEventBus.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { lemmingManagerInteractionMethods } from '../js/lemmings/lemming-manager/LemmingManagerInteraction.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
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

  it('records a zero-displacement wall contact and one direction change', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false });
    const actor = world.actors[0];
    actor.setAction(world.actions[State.WALKING]); actor.x = 20; actor.y = 20;
    world.getColumnStepHeight = () => 8;
    const batches = []; world.soundEvents.onBatch.on(batch => batches.push(batch));
    world.step();
    const facts = batches[0].facts;
    const contact = facts.find(fact => fact.kind === 'ContactResolved');
    const turn = facts.find(fact => fact.kind === 'DirectionChanged');
    expect(contact).to.include({ actorId: actor.id, causeKind: 'wall' });
    expect(contact.positionBefore).to.deep.equal(contact.positionAfter);
    expect(turn.contactId).to.equal(contact.contactId);
    expect(facts.filter(fact => fact.kind === 'MotionCommitted')).to.have.length(0);
    world.dispose();
  });

  it('captures action instance endings and actor identity before removal', () => {
    const bus = new ProcgenSoundEventBus({ getGameTicks: () => 1, frameTime: 60 }, 1);
    const batches = [], legacy = [];
    bus.onBatch.on(batch => batches.push(batch)); bus.onEvent.on(event => legacy.push(event));
    const actor = new Lemming(10, 20, 7, { physicalFacts: { enabled: () => true, emit: fact => bus.emitPhysicalFact(fact) } });
    actor.laneIndex = 0;
    bus.beginTick({ worldId: 'scene', generation: 1, tick: 1, terrainRevisionBefore: 0 });
    actor.setAction({ actionName: 'building' });
    actor.setAction({ actionName: 'digging' });
    actor.remove();
    bus.commitTick(Object.freeze({ revision: '1:1' }), 0);
    expect(batches[0].facts.map(fact => fact.kind)).to.deep.equal(['ActionEntered', 'ActionExited', 'ActionEntered', 'ActionExited', 'ActorTerminated']);
    expect(batches[0].facts.filter(fact => fact.kind === 'ActionEntered').map(fact => fact.actionInstanceId)).to.deep.equal(['7:action:1', '7:action:2']);
    expect(batches[0].facts.at(-1)).to.include({ actorId: 7, terminationReason: 'removed' });
    expect(legacy).to.have.length(0);
    bus.dispose();
  });

  it('gives both blocker participants one contact root and one walker turn', () => {
    const bus = new ProcgenSoundEventBus({ getGameTicks: () => 4, frameTime: 60 }, 1);
    const batches = []; bus.onBatch.on(batch => batches.push(batch));
    const runtime = { physicalFacts: { enabled: () => true, emit: fact => bus.emitPhysicalFact(fact) }, soundEvents: bus };
    const blocker = new Lemming(100, 50, 1, runtime), walker = new Lemming(96, 50, 2, runtime);
    blocker.laneIndex = walker.laneIndex = 0;
    const manager = { triggerManager: { trigger: () => {
      blocker.onTrigger(4, walker, { type: TriggerTypes.BLOCKER_LEFT });
      return TriggerTypes.BLOCKER_LEFT;
    } } };
    bus.beginTick({ worldId: 'scene', generation: 1, tick: 4, terrainRevisionBefore: 0 });
    lemmingManagerInteractionMethods.runTrigger.call(manager, walker, 4);
    bus.commitTick(Object.freeze({ revision: '1:4' }), 0);
    const physical = batches[0].facts.filter(fact => fact.kind);
    expect(physical.map(fact => fact.kind)).to.deep.equal(['ContactResolved', 'DirectionChanged']);
    expect(physical[0]).to.include({ actorId: 2, otherActorId: 1, causeKind: 'blocker' });
    expect(physical[1].contactId).to.equal(physical[0].contactId);
    expect(walker.lookRight).to.equal(false);
    bus.dispose();
  });

  it('records accepted and rejected commands without inventing rejected action transitions', () => {
    const bus = new ProcgenSoundEventBus({ getGameTicks: () => 1, frameTime: 60 }, 1);
    const batches = []; bus.onBatch.on(batch => batches.push(batch));
    const actor = new Lemming(10, 20, 7, { physicalFacts: { enabled: () => true, emit: fact => bus.emitPhysicalFact(fact) } });
    actor.laneIndex = 0;
    const building = { actionName: 'building' }, digging = { actionName: 'digging' };
    const manager = { actions: [], skillActions: { dig: { triggerLemAction: lem => { lem.setAction(digging); return true; } } },
      logging: { log: () => {} } };
    bus.beginTick({ worldId: 'scene', generation: 1, tick: 1, terrainRevisionBefore: 0 });
    actor.setAction(building);
    expect(lemmingManagerInteractionMethods.doLemmingAction.call(manager, actor, 'dig')).to.equal(true);
    expect(lemmingManagerInteractionMethods.doLemmingAction.call(manager, actor, 'missing')).to.equal(false);
    bus.commitTick(Object.freeze({ revision: '1:1' }), 0);
    const kinds = batches[0].facts.map(fact => fact.kind);
    expect(kinds).to.deep.equal(['ActionEntered', 'ActionExited', 'ActionEntered', 'CommandApplied', 'CommandRejected']);
    expect(batches[0].facts.at(-1)).to.include({ actorId: 7, reason: 'unknown-skill' });
    expect(batches[0].facts.filter(fact => fact.kind === 'ActionEntered')).to.have.length(2);
    bus.dispose();
  });

  it('records endpoint motion and terminal failure from the world pass', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false });
    const actor = world.actors[0];
    const batches = []; world.soundEvents.onBatch.on(batch => batches.push(batch));
    world.step();
    expect(batches[0].facts.some(fact => fact.kind === 'MotionCommitted' && fact.actorId === actor.id)).to.equal(true);
    actor.y = world.height + 7;
    world.step();
    const terminal = batches[1].facts.find(fact => fact.kind === 'ActorTerminated');
    expect(terminal).to.include({ actorId: actor.id, terminationReason: 'out-of-world' });
    world.dispose();
  });

  it('publishes between-tick action changes and excludes speculative clone actions', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false });
    const actor = world.actors[0], batches = [];
    world.soundEvents.onBatch.on(batch => batches.push(batch));
    actor.setAction(world.actions[State.BUILDING]); actor.frameIndex = 8;
    world.step();
    expect(batches[0].facts.filter(fact => fact.kind === 'ActionEntered').map(fact => fact.action)).to.include('building');
    actor.setAction(world.actions[State.DIGGING]);
    world.step();
    const transitions = batches[1].facts.filter(fact => ['ActionExited', 'ActionEntered'].includes(fact.kind));
    expect(transitions.slice(0, 2).map(fact => [fact.kind, fact.action])).to.deep.equal([
      ['ActionExited', 'building'], ['ActionEntered', 'digging']
    ]);
    const clone = new Lemming(actor.x, actor.y, actor.id, world.runtime);
    world.soundEvents.beginTick({ worldId: world.worldId, generation: world.generation, tick: world.tickIndex + 1,
      terrainRevisionBefore: world.terrainRevision });
    clone.setAction(world.actions[State.BUILDING]);
    world.soundEvents.commitTick(world._physicalSnapshot(), world.terrainRevision);
    expect(batches.at(-1).facts).to.have.length(0);
    world.dispose();
  });

  it('keeps distinct sequential dig operations and builder no-change work', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false });
    const actor = world.actors[0], batches = [];
    world.soundEvents.onBatch.on(batch => batches.push(batch));
    actor.setAction(world.actions[State.DIGGING]); actor.frameIndex = 0;
    world.step();
    const digs = batches[0].facts.filter(fact => fact.kind === 'TerrainWorkCommitted' && fact.operationKind === 'dig');
    expect(digs).to.have.length(3);
    expect(digs.map(fact => fact.operationOrdinal)).to.deep.equal([1, 2, 3]);
    expect(digs.map(fact => fact.physicalPayload.targetY)).to.deep.equal([actor.y - 3, actor.y - 2, actor.y - 1]);
    expect(digs[0].causalSequence).to.be.lessThan(digs[1].causalSequence);
    actor.setAction(world.actions[State.BUILDING]); actor.frameIndex = 8;
    world.step();
    actor.frameIndex = 8;
    world.step();
    const builds = batches.slice(1).flatMap(batch => batch.facts.filter(fact => fact.kind === 'TerrainWorkCommitted' && fact.operationKind === 'build'));
    expect(builds).to.have.length(2);
    expect(builds[0].actionInstanceId).to.equal(builds[1].actionInstanceId);
    expect(builds[1].outcome).to.equal('no-change');
    expect(builds[1].physicalPayload.changedAppearanceCells).to.equal(0);
    world.dispose();
  });

  it('closes every actor on explicit disposal with a unique terminal batch', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 2, assists: false });
    const batches = []; world.soundEvents.onBatch.on(batch => batches.push(batch));
    world.step();
    const actorIds = world.actors.map(actor => actor.id);
    world.dispose();
    const finalBatch = batches.at(-1);
    expect(finalBatch.batchId).not.to.equal(batches[0].batchId);
    expect(finalBatch.facts.filter(fact => fact.kind === 'ActorTerminated').map(fact => fact.actorId)).to.deep.equal(actorIds);
    expect(finalBatch.snapshot.actors).to.have.length(0);
  });
});
