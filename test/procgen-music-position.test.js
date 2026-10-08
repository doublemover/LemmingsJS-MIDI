import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

describe('completed-tick procgen actor music positions', function() {
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('publishes cached coordinates only after the full actor pass and reuses bounded observation slots', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 2, assists: false }), a = world.actors[0], b = world.actors[1];
    world.step(); const previous = { ...world.getLaneMusicActorPosition(a.id, 0) };
    const before = a.process.bind(a); let during, callback;
    a.process = level => { const result = before(level); during = { ...world.getLaneMusicActorPosition(a.id, 0) }; return result; };
    world.timer.onGameTick.on(() => { callback = { ...world.getLaneMusicActorPosition(a.id, 0) }; });
    world.step(); expect(during).to.deep.equal(previous); expect(callback).to.deep.equal({ x: a.x, y: a.y, tick: 2 });
    expect(world.getLaneMusicActorPosition(b.id, 0)).to.equal(null);
    const cached = world.getLaneMusicActorPosition(a.id, 0); expect(world.getLaneMusicActorPosition(a.id, 0)).to.equal(cached);
    const record = world._musicActorPositions.get(a.id); for (let tick = 0; tick < 6; tick++) world.step();
    expect(world._musicActorPositions.get(a.id)).to.equal(record); expect(record.positions).to.have.length(2); world.dispose();
  });
  it('rejects removed, failed, wrong-generation and missing actors and clears on reset/dispose', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 3, assists: false }); world.step();
    const [a,b,c] = world.actors, id = a.id; a.remove(); b.failureReason = 'fixture';
    expect(world.getLaneMusicActorPosition(id, 0)).to.equal(null); expect(world.getLaneMusicActorPosition(b.id, 1)).to.equal(null);
    world.step(); expect(world._musicActorPositions.size).to.equal(1);
    expect(world.getLaneMusicActorPosition(9999, 0)).to.equal(null); world.generation++;
    expect(world.getLaneMusicActorPosition(c.id, 2)).to.equal(null); world._restart([]); expect(world._musicActorPositions.size).to.equal(0);
    const next = world._spawn(0); world.step(); expect(world.getLaneMusicActorPosition(next.id, 0)).to.include({ tick: world.tickIndex });
    world.dispose(); expect(world._musicActorPositions.size).to.equal(0);
  });
  it('caps live cache admission at maxActors while missing observations remain explicit', () => {
    const world = new ProcgenLaneWorld({ masks, maxActors: 1, assists: false }), extra = world._spawn(0); world.step();
    expect(world._musicActorPositions.size).to.equal(1); expect(world.getLaneMusicActorPosition(extra.id, 0)).to.equal(null);
    world.actors[0].failureReason = 'fixture'; world.step(); expect(world._musicActorPositions.size).to.equal(1);
    expect(world.getLaneMusicActorPosition(extra.id, 0)).to.deep.equal({ x: extra.x, y: extra.y, tick: world.tickIndex });
    extra.setAction(world.actions[State.WALKING]); world.dispose();
  });
});
