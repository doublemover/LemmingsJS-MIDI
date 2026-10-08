import { expect } from 'chai';
import { ProcgenCctvDirector } from '../js/app/procgen/ProcgenCctvDirector.js';
const fixture = (count = 16) => {
  const lanes = Array.from({ length: count }, (_, lane) => ({ maxX: 36 + (count - lane) * 100, alive: 8, peakAlive: 8, buildingCount: 0, bashingCount: 0 }));
  return { generation: 1, tickIndex: 0, laneCount: count, stall: { lanes }, getLaneMusicSignals: lane => lanes[lane] };
};
const ranks = world => Array.from({ length: world.laneCount }, (_, lane) => lane).sort((a, b) => world.stall.lanes[b].maxX - world.stall.lanes[a].maxX || a - b);
describe('CCTV activity director', () => {
  it('selects actual construction and established sparse crews without interpreting startup as collapse', () => {
    const world = fixture(), director = new ProcgenCctvDirector();
    world.stall.lanes[9].buildingCount = 2; world.stall.lanes[10].alive = 2;
    world.stall.lanes[11].alive = world.stall.lanes[11].peakAlive = 1;
    const selected = director.select(world, ranks(world), [], 0);
    expect(selected).to.include(9).and.include(10); expect(selected).not.to.include(11);
    expect(director.reasons.get(9)).to.equal('Building'); expect(director.reasons.get(10)).to.equal('Small surviving crew');
  });
  it('keeps pins, enforces four pins and uses dwell before replacing an activity view', () => {
    const world = fixture(), director = new ProcgenCctvDirector();
    director.setPins([0, 1, 2, 3, 4, -1, 99], world.laneCount);
    expect([...director.pins]).to.deep.equal([0, 1, 2, 3]); expect(director.togglePin(4, 16)).to.equal(false);
    let selected = director.select(world, ranks(world), [], 0);
    world.stall.lanes[9].buildingCount = 1; world.tickIndex++;
    expect(director.select(world, ranks(world), selected, 2999)).to.deep.equal(selected);
    world.tickIndex++; selected = director.select(world, ranks(world), selected, 3000);
    expect(selected).to.include(9); expect(selected.slice(0, 4)).to.deep.equal([0, 1, 2, 3]);
    director.togglePin(0, 16); expect(director.togglePin(15, 16)).to.equal(true);
    selected = director.select(world, ranks(world), selected, 3001); expect(selected).to.include(15);
  });
  it('rotates less-seen lanes fairly only while ticks advance and leaves pause static', () => {
    const world = fixture(), director = new ProcgenCctvDirector();
    let selected = director.select(world, ranks(world), [], 0), visited = new Set(selected);
    for (let time = 6000; time <= 48000; time += 6000) {
      expect(director.select(world, ranks(world), selected, time - 1)).to.deep.equal(selected);
      world.tickIndex++; selected = director.select(world, ranks(world), selected, time);
      for (const lane of selected) visited.add(lane);
    }
    expect(visited.size).to.equal(world.laneCount);
  });
  it('reports observed lead changes and resets transient state on restart/rewind', () => {
    const world = fixture(), director = new ProcgenCctvDirector();
    let selected = director.select(world, ranks(world), [], 0);
    world.tickIndex = 10; world.stall.lanes[12].maxX = 9999;
    selected = director.select(world, ranks(world), selected, 4000);
    expect(selected).to.include(12); expect(director.reasons.get(12)).to.equal('New distance leader');
    world.generation++; world.tickIndex = 0; director.select(world, ranks(world), [], 5000);
    expect(director.leadTick).to.equal(-Infinity);
    world.tickIndex = 20; director.select(world, ranks(world), [], 6000);
    world.tickIndex = 1; director.select(world, ranks(world), [], 7000); expect(director.leadTick).to.equal(-Infinity);
  });
});
