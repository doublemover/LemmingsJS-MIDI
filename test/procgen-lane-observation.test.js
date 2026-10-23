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
});
