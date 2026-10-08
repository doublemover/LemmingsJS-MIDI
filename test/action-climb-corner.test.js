import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

const fixture = (masks, ceiling = false, canClimb = true, lookRight = true) => {
  const world = new ProcgenLaneWorld({ masks, assists: false });
  world.baseGroundAt = (x, y) => y >= 72 || (x >= 65 && x < 90 && y >= 50) || (ceiling && x >= 36 && x < 90 && y >= 44 && y < 50) ? 1 : 0;
  const actor = world.actors[0]; Object.assign(actor, { x: lookRight ? 64 : 90, y: 72, canClimb, lookRight, furthestX: 90 });
  actor.setAction(world.actions[State.WALKING]);
  return { world, actor };
};

describe('real wall and tunnel climb transitions', function() {
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('enters the actual wall column in both directions and keeps climbing before hoisting', () => {
    for (const right of [true, false]) {
      const { world, actor } = fixture(masks, false, true, right);
      world.step(); expect(actor.action).to.equal(world.actions[State.CLIMBING]); expect(actor.x).to.equal(right ? 65 : 89);
      world.step(); expect(actor.action).to.equal(world.actions[State.CLIMBING]); expect(actor.y).to.equal(72);
      let hoisted = false;
      for (let tick = 0; tick < 80; tick++) {
        world.step(); if (actor.action === world.actions[State.HOISTING]) hoisted = true;
        if (hoisted && actor.action === world.actions[State.WALKING]) { world.step(); break; }
      }
      expect(hoisted).to.equal(true); expect(actor.y).to.equal(50);
      world.dispose();
    }
  });
  it('turns and falls from the tunnel ceiling instead of repeatedly hoisting through its underside', () => {
    const { world, actor } = fixture(masks, true);
    let hoisted = false, fellLeft = false;
    for (let tick = 0; tick < 120; tick++) {
      world.step();
      if (actor.action === world.actions[State.HOISTING]) hoisted = true;
      if (actor.action === world.actions[State.FALLING] && !actor.lookRight) { fellLeft = true; break; }
    }
    expect(hoisted).to.equal(false); expect(fellLeft).to.equal(true); expect(actor.x).to.equal(63);
    expect(actor.y).to.be.greaterThan(50);
    world.dispose();
  });
  it('retains non-climber turning and leaves manual ability assignment unchanged', () => {
    for (const right of [true, false]) {
      const { world, actor } = fixture(masks, false, false, right), originalX = actor.x;
      world.step(); expect(actor.x).to.equal(originalX); expect(actor.lookRight).to.equal(!right);
      expect(actor.action).to.equal(world.actions[State.WALKING]); expect(actor.canClimb).to.equal(false);
      world.dispose();
    }
  });
});
