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

  it('advances a real walking contact articulation only while completed support remains', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false, scoutsEvery: 0 }), actor = world.actors[0], batches = [], output = [];
    world.actors = [actor]; world.baseGroundAt = (_x, y) => y >= 80 ? 1 : 0; actor.x = 40; actor.y = 79; actor.setAction(world.actions[State.WALKING]);
    const graph = { version: 1, revision: 1, instruments: [{ id: 'scrape', sourceKind: 'MotionCommitted', pitchCents: 6000, velocity01: 0.5, role: 'texture', route: 'local',
      articulation: { spacingPixels: 1, metric: 'endpoint-chord', lifetimeScope: 'contactSpan', phaseMode: 'contact-stroke', sustain: true } }] };
    const engine = createCausalMusicEngine({ getGraph: () => graph }); world.soundEvents.onBatch.on(value => { batches.push(value); output.push(...engine.processBatch(value)); });
    for (let tick = 0; tick < 4; tick++) world.step();
    expect(batches.slice(1).flatMap(value => value.facts).filter(fact => fact.kind === 'MotionCommitted').every(fact => fact.physicalPayload.contactObserved)).to.equal(true);
    expect(output.some(intent => intent.kind === 'begin')).to.equal(true); const before = output.filter(intent => intent.kind === 'begin').length;
    world.hasGroundAt = () => false; world.step();
    expect(output.filter(intent => intent.kind === 'begin')).to.have.length(before); expect(engine.snapshot().travel.entries).to.have.length(0); world.dispose();
  });

  it('holds a resting damper without repeated attacks and releases on loss of support', () => {
    const { world, actor, batches, intents, engine } = setup();
    world.step(); world.step();
    expect(intents.map(intent => intent.kind)).to.deep.equal(['begin', 'update']);
    expect(intents[0].articulationState.contactAnchor).to.deep.equal({ x: actor.x, y: actor.y + 1 });
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
