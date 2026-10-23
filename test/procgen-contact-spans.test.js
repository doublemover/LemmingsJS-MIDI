import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

describe('qualified physical support contact spans', () => {
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const setup = () => {
    const world = new ProcgenLaneWorld({ masks, assists: false }), batches = [], intents = [];
    const actor = world.actors[0]; actor.x = 40; actor.y = world.surfaceAt(0, 40); actor.setAction(world.actions[State.BLOCKING]);
    const graph = { version: 1, revision: 1, instruments: [{ id: 'damper', sourceKind: 'ContactSpanBegan',
      causeKind: 'support', pitchCents: 6000, velocity01: 0.5, role: 'damper', route: 'local' }] };
    const engine = createCausalMusicEngine({ getGraph: () => graph, deliver: output => intents.push(...output) });
    world.soundEvents.onBatch.on(batch => { batches.push(batch); engine.processBatch(batch); });
    return { world, actor, batches, intents, engine };
  };

  it('holds a resting damper without repeated attacks and releases on loss of support', () => {
    const { world, actor, batches, intents, engine } = setup();
    world.step(); world.step();
    expect(intents.map(intent => intent.kind)).to.deep.equal(['begin', 'update']);
    expect(intents[0].expression.contactAnchor).to.deep.equal({ x: actor.x, y: actor.y + 1 });
    const begin = batches[0].facts.find(fact => fact.kind === 'ContactSpanBegan');
    expect(begin.physicalPayload).to.include({ evidence: 'completed-support-cell', pressure: null, normal: null });
    world.hasGroundAt = () => false;
    world.step();
    expect(intents.filter(intent => intent.kind === 'end')).to.have.length(1);
    expect(engine.snapshot().active).to.have.length(0);
    expect(batches[2].facts.find(fact => fact.kind === 'ContactSpanEnded').reason).to.equal('action-change');
    world.dispose();
  });

  it('ends a support span when a later terrain edit invalidates its historical anchor', () => {
    const { world, actor, batches, intents } = setup();
    world.step();
    const old = actor._physicalContactSpan, original = world.hasGroundAt.bind(world);
    actor.x++;
    world.terrainRevision++;
    world.hasGroundAt = (x, y) => x === old.anchor.x && y === old.anchor.y ? false : original(x, y);
    world.step();
    const facts = batches[1].facts.filter(fact => fact.kind?.startsWith('ContactSpan'));
    expect(facts.map(fact => fact.kind)).to.deep.equal(['ContactSpanEnded', 'ContactSpanBegan']);
    expect(facts[0]).to.include({ spanId: old.spanId, reason: 'support-topology-invalidated' });
    expect(facts[1].spanId).not.to.equal(old.spanId);
    expect(intents.map(intent => intent.kind)).to.deep.equal(['begin', 'end', 'begin']);
    world.dispose();
  });

  it('labels missing observation coverage and closes contacts before actor identity disappears', () => {
    const { world, actor, batches } = setup();
    world.step();
    actor._physicalContactSpan.lastObservedTick = -99;
    world.step();
    expect(batches[1].facts.find(fact => fact.kind === 'ContactSpanEnded').reason).to.equal('unknown-coverage');
    const actorId = actor.id;
    actor.remove();
    world.step();
    const facts = batches[2].facts;
    expect(facts.filter(fact => ['ContactSpanEnded', 'ActionExited', 'ActorTerminated'].includes(fact.kind)).map(fact => fact.kind))
      .to.deep.equal(['ContactSpanEnded', 'ActionExited', 'ActorTerminated']);
    expect(facts.find(fact => fact.kind === 'ContactSpanEnded').actorId).to.equal(actorId);
    world.dispose();
  });
});
