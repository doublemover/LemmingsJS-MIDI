import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';

describe('simulation boundary intervention commands', () => {
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const ready = () => {
    const world = new ProcgenLaneWorld({ masks, assists: false });
    const actor = world.actors[0]; actor.y = world.surfaceAt(0, actor.x); actor.setAction(world.actions[State.WALKING]);
    return world;
  };
  const command = (world, id, extra = {}) => ({ id, kind: 'assign-worker', target: { generation: world.generation, actorId: world.actors[0].id },
    origin: 'manual', parameters: { workerKind: 'builders' }, ...extra });

  it('prepares commands without mutation and refuses stale publication after another writer', () => {
    const world = ready(), original = world.interventionState;
    const proposal = world.prepareIntervention(command(world, 'staged'));
    expect(world.interventionState).to.equal(original); expect(original.pending).to.have.length(0);
    world.enqueueIntervention(command(world, 'other'));
    expect(() => proposal.commit()).to.throw('stale'); expect(world.interventionState.pending.map(value => value.id)).to.deep.equal(['other']);
    world.dispose();
  });
  it('records nuke requests as future-boundary commands, not synchronous actor edits', () => {
    const world = ready(), actor = world.actors[0], before = actor.action, batches = [];
    world.soundEvents.onBatch.on(value => batches.push(value));
    world.prepareIntervention(command(world, 'nuke', { kind: 'nuke-lane', target: { generation: world.generation, laneId: 0 }, parameters: {} })).commit();
    expect(actor.action).to.equal(before); world.step();
    expect(batches[0].facts.find(fact => fact.commandId === 'nuke' && fact.kind === 'CommandApplied').status).to.equal('accepted');
    world.dispose();
  });

  it('applies an accepted builder at the boundary and preserves its cause on the first brick', () => {
    const world = ready(), batches = [], actor = world.actors[0];
    world.soundEvents.onBatch.on(batch => batches.push(batch));
    expect(world.enqueueIntervention(command(world, 'builder:1')).status).to.equal('queued');
    expect(actor.action).to.equal(world.actions[State.WALKING]);
    world.step();
    const applied = batches[0].facts.find(fact => fact.kind === 'CommandApplied');
    expect(applied).to.include({ commandId: 'builder:1', status: 'accepted', appliedTick: 1 });
    const begin = batches[0].facts.find(fact => fact.kind === 'ActionEntered' && fact.action === 'building');
    expect(begin.parentCauseIds).to.deep.equal(['builder:1']);
    expect(applied.physicalEventIds).to.include(begin.eventId);
    for (let tick = 0; tick < 8; tick++) world.step();
    const brick = batches.flatMap(batch => batch.facts).find(fact => fact.kind === 'TerrainWorkCommitted');
    expect(brick.parentCauseIds).to.deep.equal(['builder:1']);
    world.dispose();
  });
  it('starts canonical crew tracking only for an explicit accepted worker request', () => {
    for (const trackCrew of [false, true]) {
      const world = ready(), batches = []; world.soundEvents.onBatch.on(batch => batches.push(batch));
      world.enqueueIntervention(command(world, 'crew-skill:' + trackCrew, { parameters: { workerKind: 'builders', trackCrew } })); world.step();
      const facts = batches.flatMap(batch => batch.facts); expect(facts.some(fact => fact.kind === 'CommandApplied')).to.equal(true); expect(facts.some(fact => fact.kind === 'CrewRouteOpened')).to.equal(trackCrew);
      if (trackCrew) expect(facts.find(fact => fact.kind === 'CrewRouteOpened').admittedCrew).to.be.greaterThan(0); world.dispose();
    }
    const world = ready(); expect(() => world.prepareIntervention(command(world, 'invalid-crew', { parameters: { workerKind: 'builders', trackCrew: 'true' } }))).to.throw('Crew tracking'); world.dispose();
  });

  it('orders competing proposals by origin policy and stable ID, independent of enqueue order', () => {
    const run = reverse => {
      const world = ready(), batches = [];
      world.soundEvents.onBatch.on(batch => batches.push(batch));
      const proposals = [command(world, 'manual:a'), command(world, 'conductor:a', { origin: 'conductor', parameters: { workerKind: 'diggers' } })];
      for (const proposal of reverse ? proposals.reverse() : proposals) world.enqueueIntervention(proposal);
      world.step();
      const receipts = batches[0].facts.filter(fact => fact.kind?.startsWith('Command')).map(fact => ({
        commandId: fact.commandId, status: fact.status, reason: fact.reason, conflictCommandId: fact.conflictCommandId }));
      expect(world.stats.builds).to.equal(1); expect(world.stats.digs).to.equal(0);
      world.dispose(); return receipts;
    };
    expect(run(true)).to.deep.equal(run(false));
    expect(run(false)).to.deep.equal([
      { commandId: 'manual:a', status: 'accepted', reason: 'applied', conflictCommandId: null },
      { commandId: 'conductor:a', status: 'rejected', reason: 'conflicting-command', conflictCommandId: 'manual:a' }
    ]);
  });

  it('rejects removed targets, stale revisions and cancelled commands without choosing a replacement', () => {
    const world = ready(), batches = [];
    world.soundEvents.onBatch.on(batch => batches.push(batch));
    world.enqueueIntervention(command(world, 'cancelled:1'));
    expect(world.cancelIntervention('cancelled:1')).to.equal(true);
    world.enqueueIntervention(command(world, 'revision:1', { expectedStateRevision: '1:99' }));
    world.enqueueIntervention(command(world, 'missing:1', { target: { generation: 1, actorId: 99999 } }));
    world.step();
    const receipts = batches[0].facts.filter(fact => fact.kind === 'CommandRejected');
    expect(receipts.map(fact => fact.reason)).to.deep.equal(['stale-target', 'stale-state-revision']);
    expect(world.stats.builds).to.equal(0);
    expect(world.interventionState.receipts.find(item => item.commandId === 'cancelled:1').status).to.equal('cancelled');
    world.dispose();
  });

  it('does not leak a prepared work claim or success statistic on adapter rejection or exception', () => {
    for (const throws of [false, true]) {
      const world = ready(), batches = [];
      world.soundEvents.onBatch.on(batch => batches.push(batch));
      const action = world.actions[State.BUILDING];
      action.triggerLemAction = () => { if (throws) throw new Error('adapter rejected'); return false; };
      world.enqueueIntervention(command(world, `rejected:${throws}`));
      world.step();
      expect(world.accessTasks[0] || []).to.have.length(0);
      expect(world.stats.builds).to.equal(0);
      expect(batches[0].facts.some(fact => fact.kind === 'ActionEntered' && fact.action === 'building')).to.equal(false);
      expect(batches[0].facts.find(fact => fact.kind === 'CommandRejected').reason).to.equal(throws ? 'adapter-exception' : 'ineligible-command');
      world.dispose();
    }
  });

  it('halts an adapter that mutates before rejecting without publishing a completed tick', () => {
    const world = ready(), batches = [];
    world.soundEvents.onBatch.on(batch => batches.push(batch));
    world.actions[State.BUILDING].triggerLemAction = actor => { actor.setAction(world.actions[State.BUILDING]); return false; };
    world.enqueueIntervention(command(world, 'broken:1'));
    expect(() => world.step()).to.throw('Rejected intervention mutated');
    expect(batches).to.have.length(0);
    expect(() => world.step()).to.throw('incomplete');
    world.dispose();
  });

  it('queues output feedback for the next tick and rejects reentrant direct action changes', () => {
    const world = ready(), batches = [];
    world.soundEvents.onBatch.on(batch => {
      batches.push(batch);
      if (batch.tick === 1) {
        expect(() => world.actors[0].setAction(world.actions[State.BUILDING])).to.throw('future command boundary');
        expect(world.enqueueIntervention(command(world, 'feedback:1')).applyAtTick).to.equal(2);
      }
    });
    world.step();
    expect(batches[0].facts.some(fact => fact.kind === 'CommandApplied')).to.equal(false);
    world.step();
    expect(batches[1].facts.find(fact => fact.kind === 'CommandApplied')).to.include({ commandId: 'feedback:1', appliedTick: 2 });
    world.dispose();
  });

  it('uses the existing checkpoint graph for pending commands and keeps inspection disarmed', () => {
    const world = ready();
    world.enqueueIntervention(command(world, 'future:1', { applyAtTick: 5 }));
    const saved = captureProcgenCheckpoint(world), restored = ready();
    restoreProcgenCheckpoint(restored, JSON.parse(JSON.stringify(saved)));
    expect(restored.interventionState.pending).to.deep.equal(world.interventionState.pending);
    expect(restored.getCompletedPhysicalSnapshot()).to.equal(null);
    restored.dispose(); world.dispose();
  });

  it('coalesces 1000 same-boundary continuous samples with zero boundary error and preserves discrete commands', () => {
    const world = ready(), target = { generation: world.generation }, batches = [];
    world.soundEvents.onBatch.on(batch => batches.push(batch));
    for (let index = 0; index < 1000; index++) world.enqueueIntervention({ id: `sample:${index}`, kind: 'set-release-policy',
      target, origin: 'manual', transactionId: 'knob:1', coalesceKey: 'release-grid', parameters: { spawnBeatTicks: index } });
    expect(world.interventionState.pending).to.have.length(1);
    expect(world.interventionState.receipts).to.have.length(999);
    expect(world.interventionState.receipts.every(receipt => receipt.status === 'superseded' && receipt.errorBoundAtSimulationBoundaries === 0)).to.equal(true);
    world.enqueueIntervention(command(world, 'skill:1'));
    world.enqueueIntervention({ id: 'sample:last', kind: 'set-release-policy', target, transactionId: 'knob:1', coalesceKey: 'release-grid',
      parameters: { spawnBeatTicks: 1000 } });
    expect(world.interventionState.pending).to.have.length(3);
    world.step();
    expect(world.population.settings.spawnBeatTicks).to.equal(999);
    expect(world.stats.builds).to.equal(1);
    expect(batches[0].facts.filter(fact => fact.kind === 'CommandApplied').map(fact => fact.commandId)).to.deep.equal(['sample:999', 'skill:1']);
    world.dispose();
  });
});
