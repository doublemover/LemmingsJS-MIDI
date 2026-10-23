import { expect } from 'chai';
import { createProcgenLaneObserver } from '../js/app/procgen/workstation/ProcgenLaneObservation.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { ProcgenActorVisibility, registerProcgenActorVisibility, getProcgenActorVisibility, publishProcgenActorVisibility } from '../js/app/procgen/ProcgenActorVisibility.js';

describe('ProcGen current lane conditions', () => {
  const fixture = () => {
    const actions = { [State.WALKING]: {}, [State.BUILDING]: {}, [State.MINING]: {} };
    let queries = 0;
    const world = { tickIndex: 1, generation: 0, terrainRevision: 0, laneCount: 2, width: 65535, leftEdgeX: 0,
      generatedThrough: [100, 100], terrain: { chunkWidth: 256 }, actions,
      actors: [{ x: 40, y: 100, lookRight: true, laneIndex: 0, action: actions[State.WALKING] }, { x: 30, y: 100, laneIndex: 0, action: actions[State.BUILDING] }],
      hasGroundAt(x, y) { queries++; return y >= 100 && x < 44 || y === 95 && x === 42; }, hasSteelAt: () => false,
      hazards: { chunks: new Map([[0, { entries: [{ enabled: true, trigger: { x1: 50, x2: 60, y1: 94, y2: 104 } }] }]]) } };
    return { world, observe: createProcgenLaneObserver(world), queries: () => queries };
  };
  it('observes action and contact state without depending on audio events and caches the completed tick', () => {
    const f = fixture(), first = f.observe(0);
    expect(first.action).to.equal('walk build'); expect(first.terrain).to.equal('ground gap wall hazard');
    expect(first).to.include({ x: 40, y: 100 });
    const count = f.queries(); expect(f.observe(0)).to.equal(first); expect(f.queries()).to.equal(count);
    f.world.actors[0].action = f.world.actions[State.MINING]; f.world.tickIndex++;
    expect(f.observe(0).action).to.equal('mine build');
  });
  it('does not infer gaps in unbuilt terrain, observes destination lanes, and ignores failed actors', () => {
    const f = fixture(); f.world.generatedThrough[0] = 42;
    expect(f.observe(0).terrain).not.to.include('gap');
    f.world.actors[0].laneIndex = 1; f.world.actors[1].failureReason = 'lost'; f.world.tickIndex++;
    expect(f.observe(0)).to.deep.equal({ action: '', terrain: '' }); expect(f.observe(1).action).to.equal('walk');
    expect(f.observe(-1)).to.deep.equal({ action: '', terrain: '' });
  });
  it('uses the published lane index and refreshes it once per completed tick', () => {
    const f = fixture(), index = new ProcgenActorVisibility(f.world);
    f.world.actors[0].id = 9; f.world.actors[1].id = 2; f.world.actors[1].x = 40;
    registerProcgenActorVisibility(f.world, index); publishProcgenActorVisibility(f.world);
    expect(index.getStats()).to.include({ publications: 1, rebuilds: 0, actorScans: 2, retainedActors: 2 });
    expect(index.physicalLeader(1, 2)).to.equal(f.world.actors[1]);
    expect(f.observe(0).action).to.equal('walk build');
    expect(f.observe(0).action).to.equal('walk build');
    expect(index.getStats().actorScans).to.equal(2);
    f.world.actors[0].laneIndex = 1; f.world.tickIndex++;
    publishProcgenActorVisibility(f.world);
    expect(index.getStats().actorScans).to.equal(4);
    expect(f.observe(1).action).to.equal('walk');
    expect(f.observe(0).action).to.equal('build');
    f.world.actors[0].removed = true; f.world.tickIndex++;
    publishProcgenActorVisibility(f.world);
    expect(f.observe(1)).to.deep.equal({ action: '', terrain: '' });
    index.dispose(); expect(getProcgenActorVisibility(f.world)).to.equal(null);
  });

  it('reads numeric completed action masks without walking lane buckets and reuses observation slots', () => {
    const f = fixture(), index = new ProcgenActorVisibility(f.world);
    registerProcgenActorVisibility(f.world, index); index.publish();
    const masks = index.actionMasks, counts = index.actionCounts;
    index.semanticActors = () => { throw new Error('Observers must use the completed action index'); };
    expect(f.observe(0).action).to.equal('walk build');
    expect(index.semanticActionCount(0, 'walk')).to.equal(1); expect(index.semanticActionCount(0, 'build')).to.equal(1);
    const reads = index.getStats().actorScans, slots = f.observe.getStats().observationAllocations;
    for (let tick = 0; tick < 20; tick++) {
      f.world.tickIndex++; index.publish(); expect(f.observe(0).action).to.equal('walk build');
    }
    expect(index.actionMasks).to.equal(masks); expect(index.actionCounts).to.equal(counts);
    expect(index.getStats().actorScans - reads).to.equal(40);
    expect(f.observe.getStats()).to.include({ actorVisits: 0, observationAllocations: slots, indexAllocations: 1 });
    const publications = index.getStats().publications; f.world.terrainRevision++; f.observe(0);
    expect(index.getStats().publications).to.equal(publications); index.dispose();
  });

  it('keeps the last completed immutable observation while a physical tick is unfinished', () => {
    const f = fixture(), index = new ProcgenActorVisibility(f.world);
    registerProcgenActorVisibility(f.world, index); index.publish(); const completed = f.observe(0), reads = f.queries();
    expect(Object.isFrozen(completed)).to.equal(true);
    f.world._musicCompletedTick = f.world.tickIndex; f.world.tickIndex++; f.world._stepping = true;
    f.world.actors[0].x = 90; f.world.actors[0].action = f.world.actions[State.MINING];
    expect(index.publish(true)).to.equal(false); expect(f.observe(0)).to.equal(completed);
    expect(f.observe(1)).to.deep.equal({ action: '', terrain: '' }); expect(f.queries()).to.equal(reads);
    f.world._musicCompletedTick = f.world.tickIndex; index.publish();
    expect(f.observe(0)).to.include({ x: 90, action: 'mine build' }); index.dispose();
  });

  it('avoids fallback reindexing for terrain-only edits and preserves first-seen label ordering', () => {
    const f = fixture(); expect(f.observe(0).action).to.equal('walk build');
    expect(f.observe.getStats()).to.include({ fallbackBuilds: 1, actorVisits: 2, indexAllocations: 1, observationAllocations: 1 });
    for (let revision = 1; revision <= 10; revision++) { f.world.terrainRevision = revision; f.observe(0); }
    expect(f.observe.getStats()).to.include({ fallbackBuilds: 1, actorVisits: 2, indexAllocations: 1, observationAllocations: 1 });
    f.world.actors[0].action = f.world.actions[State.MINING]; f.world.tickIndex++;
    expect(f.observe(0).action).to.equal('mine build');
  });
});
