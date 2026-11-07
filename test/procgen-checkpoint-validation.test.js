import { expect } from 'chai';
import { captureProcgenCheckpoint, captureProcgenCheckpointCooperative, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { createPhysicalCrewEvidence } from '../js/app/procgen/PhysicalCrewEvidence.js';

const world = () => Object.defineProperty({ laneCount: 1, laneHeight: 144, seed: 7, terrain: {}, actions: {}, timer: { speedFactor: 1, TIME_PER_FRAME_MS: 16 },
  triggerManager: { rebuildIndex() {} }, terrainActivityTicks: new Float64Array([-Infinity]), actors: [], nextActorId: 0, stall: { settings: {} }, soundEvents: { snapshotIdentity: () => ({ version: 1, causalSequence: 0, legacySequence: 0, coverage: 'complete' }), restoreIdentity() {} }, tickIndex: 0, eventTimeMs: 0, simulationTimeMs: 0, laneSeeds: [0], generation: 0, physicalCrewEvidence: createPhysicalCrewEvidence(), actorBirthAbilities: null, _completedPhysicalSnapshot: null, step() { return true; } },
'_authoritativeActors', { value: new WeakSet(), writable: true });
const saved = () => JSON.parse(JSON.stringify(captureProcgenCheckpoint(world())));

describe('ProcGen checkpoint admission', () => {
  it('rejects exhausted counter frontiers before publication', () => {
    for (const field of ['tickIndex', 'nextActorId']) {
      const checkpoint = saved(), target = world(); checkpoint.graph.owners.find(owner => owner.name === 'world').props[field] = Number.MAX_SAFE_INTEGER;
      expect(() => restoreProcgenCheckpoint(target, checkpoint)).to.throw(); expect(target[field]).to.equal(0);
    }
  });

  it('refuses method-shadowing owner properties before changing the target', () => {
    const checkpoint = saved(), target = world();
    checkpoint.graph.owners.find(owner => owner.name === 'world').props.step = 'imported scalar';
    expect(() => restoreProcgenCheckpoint(target, checkpoint)).to.throw('shadow a runtime method');
    expect(typeof target.step).to.equal('function');
  });

  it('rejects scalar typed-array payloads and duplicate or missing owners', () => {
    const scalar = saved();
    scalar.graph.nodes.push({ type: 'Float64Array', values: 64 });
    scalar.graph.owners[0].props.payload = { ref: scalar.graph.nodes.length - 1 };
    expect(() => restoreProcgenCheckpoint(world(), scalar)).to.throw('typed-array payload');
    const duplicate = saved(); duplicate.graph.owners.push(duplicate.graph.owners[0]);
    expect(() => restoreProcgenCheckpoint(world(), duplicate)).to.throw('Invalid checkpoint graph');
    const missing = saved(); missing.graph.owners.length = 0;
    expect(() => restoreProcgenCheckpoint(world(), missing)).to.throw('owner or memory budget');
  });

  it('rejects a checkpoint whose graph or clock contradicts its world envelope', () => {
    const mismatch = saved();
    mismatch.graph.owners.find(owner => owner.name === 'world').props.laneCount = 2;
    expect(() => restoreProcgenCheckpoint(world(), mismatch)).to.throw('envelope');
    const clock = saved(); clock.clock.speedFactor = -1;
    expect(() => restoreProcgenCheckpoint(world(), clock)).to.throw('clock');
    const seed = saved(); seed.seed++;
    expect(() => restoreProcgenCheckpoint(world(), seed)).to.throw('Incompatible');
  });

  it('restores a long valid reference chain without recursive decoding', () => {
    const checkpoint = saved(), length = 5001;
    const first = checkpoint.graph.nodes.length;
    checkpoint.graph.nodes.push(...Array.from({ length }, (_, index) => ({ type: 'Object', props: index + 1 < length ? { next: { ref: first + index + 1 } } : { end: 1 } })));
    checkpoint.graph.owners.find(owner => owner.name === 'world').props.checkpointHazardFixture = { ref: first };
    const target = world(); restoreProcgenCheckpoint(target, checkpoint);
    let cursor = target.checkpointHazardFixture;
    for (let index = 1; index < length; index++) cursor = cursor.next;
    expect(cursor.end).to.equal(1);
    const captured = captureProcgenCheckpoint(target), again = world(); restoreProcgenCheckpoint(again, captured);
    let next = again.checkpointHazardFixture; for (let index = 1; index < length; index++) next = next.next;
    expect(next.end).to.equal(1);
  });

  it('rejects duplicate actor IDs, repeated active actors and non-actor references before publishing owners', () => {
    const source = world(); source.actors = [new Lemming(1, 2, 0), new Lemming(3, 4, 1)]; source.nextActorId = 2;
    const original = captureProcgenCheckpoint(source);
    for (const mutation of [checkpoint => { checkpoint.graph.nodes.filter(node => node.type === 'Lemming')[1].props.id = 0; },
      checkpoint => { const list = checkpoint.graph.nodes[checkpoint.graph.owners.find(owner => owner.name === 'world').props.actors.ref]; list.values[1] = list.values[0]; },
      checkpoint => { checkpoint.graph.nodes.find(node => node.type === 'Lemming').type = 'Object'; }]) {
      const checkpoint = structuredClone(original), target = world(); mutation(checkpoint);
      const actors = target.actors;
      expect(() => restoreProcgenCheckpoint(target, checkpoint)).to.throw(/actor|identit/); expect(target.actors).to.equal(actors); expect(target.nextActorId).to.equal(0);
    }
  });

  it('rejects imported class methods, resource redirection, invalid position and array reshaping before any target changes', () => {
    const source = world(); source.actors = [new Lemming(1, 2, 0)]; source.nextActorId = 1;
    const original = captureProcgenCheckpoint(source);
    for (const mutation of [node => { node.props.process = 'shadowed'; }, node => { node.props.runtime = { ref: 0 }; },
      node => { node.props.action = { ref: 0 }; }, node => { node.props.x = { special: 'NaN' }; }, node => { node.props.laneIndex = 1; }]) {
      const checkpoint = structuredClone(original), target = world(); let constructed = 0;
      target.runtime = { physicalFacts: { canMutate() { constructed++; return true; } } };
      mutation(checkpoint.graph.nodes.find(node => node.type === 'Lemming'));
      expect(() => restoreProcgenCheckpoint(target, checkpoint)).to.throw(); expect(target.nextActorId).to.equal(0); expect(target.actors).to.deep.equal([]);
      expect(constructed).to.equal(0);
    }
    for (const props of [{ length: 1000000000 }, { 0: null }, { map: 'shadowed' }]) {
      const checkpoint = structuredClone(original); checkpoint.graph.nodes.find(node => node.type === 'Array').props = props;
      expect(() => restoreProcgenCheckpoint(world(), checkpoint)).to.throw();
    }
  });

  it('checks aggregate string, collection work and decoded-byte budgets before allocating imported views', () => {
    const excessiveString = saved(), text = 'x'.repeat(1024);
    excessiveString.graph.nodes.push({ type: 'Array', values: Array(16385).fill(text) });
    expect(() => restoreProcgenCheckpoint(world(), excessiveString)).to.throw('string budget');
    const excessiveSlots = saved(); excessiveSlots.graph.nodes.push({ type: 'Array', values: Array(4000001).fill(null) });
    expect(() => restoreProcgenCheckpoint(world(), excessiveSlots)).to.throw('reference budget');
    const excessiveBytes = saved(), virtual = new Proxy([], { get: (target, key) => key === 'length' ? 16777217 : Reflect.get(target, key) });
    excessiveBytes.graph.nodes.push({ type: 'Float64Array', values: virtual });
    expect(() => restoreProcgenCheckpoint(world(), excessiveBytes)).to.throw('memory budget');
  });

  it('rejects lane arrays with a different length or storage type before publishing any owner', () => {
    for (const mutation of [entry => { entry.values = []; }, entry => { entry.type = 'Object'; entry.props = {}; delete entry.values; }]) {
      const checkpoint = saved(), target = world(), actors = target.actors;
      const props = checkpoint.graph.owners.find(owner => owner.name === 'world').props;
      mutation(checkpoint.graph.nodes[props.laneSeeds.ref]);
      expect(() => restoreProcgenCheckpoint(target, checkpoint)).to.throw('lane array'); expect(target.actors).to.equal(actors); expect(target.laneSeeds).to.deep.equal([0]);
    }
  });

  it('refuses redirection of original world resources and active actor runtimes before publishing owners', () => {
    for (const field of ['timer', 'soundEvents', 'stall', 'triggerManager']) {
      const checkpoint = saved(), target = world(), original = target[field];
      checkpoint.graph.owners.find(owner => owner.name === 'world').props[field] = { ref: 0 };
      expect(() => restoreProcgenCheckpoint(target, checkpoint)).to.throw('resource binding'); expect(target[field]).to.equal(original);
    }
    const source = world(); source.runtime = {}; source.actors = [new Lemming(1, 2, 0, source.runtime)]; source.nextActorId = 1;
    const checkpoint = captureProcgenCheckpoint(source), target = world(); target.runtime = {};
    checkpoint.graph.nodes.find(node => node.type === 'Lemming').props.runtime = null;
    expect(() => restoreProcgenCheckpoint(target, checkpoint)).to.throw('actor runtime binding'); expect(target.actors).to.deep.equal([]);
  });

  it('preserves finite signed zero positions while refusing nonfinite actor coordinates', () => {
    const source = world(); source.actors = [new Lemming(-0, -0, 0)]; source.nextActorId = 1;
    const target = world(); restoreProcgenCheckpoint(target, captureProcgenCheckpoint(source));
    expect(Object.is(target.actors[0].x, -0)).to.equal(true); expect(Object.is(target.actors[0].y, -0)).to.equal(true);
  });

  it('preserves capture traversal order and cyclic identity through iterative graph walking', () => {
    const source = world(), value = { number: 7 }; value.self = value; value.map = new Map([[value, new Set([value])]]); source.checkpointHazardFixture = value;
    const checkpoint = captureProcgenCheckpoint(source), target = world(); restoreProcgenCheckpoint(target, checkpoint);
    expect(target.checkpointHazardFixture.self).to.equal(target.checkpointHazardFixture);
    expect(target.checkpointHazardFixture.map.get(target.checkpointHazardFixture).has(target.checkpointHazardFixture)).to.equal(true);
    expect(captureProcgenCheckpoint(target).graph.nodes.slice(0, checkpoint.graph.nodes.length)).to.deep.equal(checkpoint.graph.nodes);
  });

  it('can cancel iterative capture of a deep accepted chain and recapture it under the same paused owner', async () => {
    const source = world(); let chain = source.checkpointHazardFixture = {};
    for (let index = 0; index < 6000; index++) { chain.next = {}; chain = chain.next; } chain.end = 1;
    const controller = new AbortController(); let clock = 0, slices = 0, error;
    try {
      await captureProcgenCheckpointCooperative(source, { signal: controller.signal, isCurrent: () => true, now: () => ++clock,
        yieldTask: async () => { slices++; controller.abort(); } });
    } catch (failure) { error = failure; }
    expect(error?.name).to.equal('AbortError'); expect(slices).to.equal(1);
    const checkpoint = await captureProcgenCheckpointCooperative(source, { isCurrent: () => true, now: () => ++clock, yieldTask: async () => { slices++; } });
    expect(checkpoint).to.deep.equal(captureProcgenCheckpoint(source)); expect(slices).to.be.greaterThan(1);
  });
});
