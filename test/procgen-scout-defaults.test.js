import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

describe('default ordinary crews and sparse permanent abilities', function() {
  this.timeout(30000);
  let masks, terrain;
  before(async () => { masks = await loadProcgenMasks(); terrain = await loadProcgenTerrain('lemmings', 3); });
  it('starts every new/default and restarted actor ordinary, then floats only delayed scouts with a floating role', () => {
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 2 });
    for (let ordinal = 1; ordinal < 16; ordinal++) world._spawn(0, false);
    const crew = world.actors.filter(a => a.laneIndex === 0);
    expect(crew.filter(a => a.scout)).to.have.length(2);
    expect(crew.every(a => !a.canClimb && !a.hasParachute)).to.equal(true);
    world.baseGroundAt = (_x, y) => y % 96 >= 80 ? 1 : 0;
    world.tickIndex = 179;
    for (const actor of crew) { Object.assign(actor, { x: 64, y: 10, state: 18 }); world._assist(actor); }
    expect(crew.some(a => a.hasParachute)).to.equal(false);
    world.tickIndex = 180;
    for (const actor of crew) world._assist(actor);
    expect(crew.filter(a => a.hasParachute)).to.have.length(crew.filter(a => a.scoutAbilities & 2).length);
    expect(crew.every(a => a.hasParachute === !!(a.scoutAbilities & 2) && !a.canClimb)).to.equal(true);
    const scout = crew.find(a => a.scoutAbilities & 2), ordinary = crew.find(a => !a.scout);
    scout.y = 100; world._synchronizeLane(scout);
    expect(scout.laneIndex).to.equal(1); expect(scout.spawnLaneIndex).to.equal(0); expect(scout.hasParachute).to.equal(true);
    expect(ordinary.hasParachute).to.equal(false);
    const savedInterval = world.population.settings.scoutsEvery;
    world._restart([]); world._spawn(0, false);
    expect(world.population.settings.scoutsEvery).to.equal(savedInterval);
    expect(world.actors.every(a => !a.canClimb && !a.hasParachute)).to.equal(true);
    expect(world.population.settings.scoutDelayTicks).to.equal(180); world.dispose();
  });
  it('assigns climb only to default eligible scouts and preserves an explicit manual ordinary ability', () => {
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 1 });
    for (let ordinal = 1; ordinal < 16; ordinal++) world._spawn(0, false);
    world.hasGroundAt = (x, y) => y >= 72 || x >= 65 && x < 90 && y >= 44;
    world.getColumnStepHeight = (x, y, height) => { for (let i = 0; i < height; i++) if (!world.hasGroundAt(x, y + height - 1 - i)) return i; return height; };
    world.hasSteelAt = () => false; world.hazardPlanner.plan = () => null; world.tickIndex = 180;
    for (const actor of world.actors) { Object.assign(actor, { x: 64, y: 72 }); actor.setAction(world.actions[State.WALKING]); world._assist(actor); }
    expect(world.actors.filter(a => a.canClimb)).to.have.length(world.actors.filter(a => a.scoutAbilities & 1).length);
    expect(world.actors.every(a => a.canClimb === !!(a.scoutAbilities & 1) && !a.hasParachute)).to.equal(true);
    const manual = world.actors.find(a => !a.scout); manual.hasParachute = true; manual.canClimb = true;
    manual.y = 100; world._synchronizeLane(manual);
    expect(manual.hasParachute).to.equal(true); expect(manual.canClimb).to.equal(true); world.dispose();
  });
});
