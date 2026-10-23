import { expect } from 'chai';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';

const world = () => ({ laneCount: 1, laneHeight: 144, seed: 7, terrain: {}, actions: {}, timer: { speedFactor: 1, TIME_PER_FRAME_MS: 16 },
  actors: [], tickIndex: 0, laneSeeds: [], generation: 0, step() { return true; } });
const saved = () => JSON.parse(JSON.stringify(captureProcgenCheckpoint(world())));

describe('ProcGen checkpoint admission', () => {
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
  });
});
