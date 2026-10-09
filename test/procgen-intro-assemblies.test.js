import { expect } from 'chai';
import { introAssemblyEligible, PROCGEN_RECOVERY_GAP_END } from '../js/app/procgen/ProcgenTerrainProgression.js';
import { MAX_LOCAL_ROUTE_DISTANCE } from '../js/app/procgen/ProcgenHazardPlanner.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

const field = rectangles => {
  const mask = new Uint8Array(128 * 96); mask.fill(1, 72 * 128);
  for (const { x, y, width, height } of rectangles) for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) mask[(y + dy) * 128 + x + dx] = 1;
  return (x, y) => x >= 0 && x < 128 && y >= 0 && y < 96 && !!mask[y * 128 + x];
};
const eligible = (solid, extra = {}) => introAssemblyEligible({ origin: 256, left: 16, right: 112, surface: () => 72, solid, ...extra });
const transforms = placements => {
  const left = Math.min(...placements.map(p => p.x)), top = Math.min(...placements.map(p => p.y));
  return placements.map(p => [p.piece.id, p.x - left, p.y - top, p.flip, p.flipY]);
};
const ids = ['lemmings_ohNo/0/dc7ebedf118235c3', 'lemmings_ohNo/0/0a61e14be8aa5be2'];

describe('conservative early complete source assembly eligibility', function() {
  this.timeout(30000);
  it('uses actual walking-height columns rather than rejecting wide overhead roofs', () => {
    expect(eligible(field([{ x: 16, y: 48, width: 96, height: 16 }]))).to.equal(true);
    expect(eligible(field([{ x: 16, y: 67, width: 96, height: 4 }]))).to.equal(true);
    expect(eligible(field([{ x: 16, y: 24, width: 64, height: 48 }]))).to.equal(false);
    expect(eligible(field([{ x: 16, y: 48, width: 96, height: 24 }]))).to.equal(false);
    expect(eligible(field([{ x: 16, y: 48, width: 8, height: 16 }, { x: 79, y: 64, width: 1, height: 8 }]))).to.equal(true);
  });
  it('reserves the observed exit/continuation margin within the unchanged local budget and leaves later admission intact', () => {
    const limit = MAX_LOCAL_ROUTE_DISTANCE - 13;
    expect(eligible(field([{ x: 16, y: 56, width: limit, height: 16 }]))).to.equal(true);
    expect(eligible(field([{ x: 16, y: 56, width: limit + 1, height: 16 }]))).to.equal(false);
    expect(eligible(field([{ x: 16, y: 56, width: 8, height: 16 }]), { steel: (x, y) => x === 18 && y === 66 })).to.equal(false);
    expect(eligible(() => { throw new Error('Later admission must not sample geometry'); }, { origin: PROCGEN_RECOVERY_GAP_END })).to.equal(true);
    expect(eligible(() => false)).to.equal(false);
  });
  it('defers the two actual early Brick walls as whole groups and ordinary crews walk past their prior bounds', async () => {
    const masks = await loadProcgenMasks(), before = await loadProcgenTerrain('lemmings_ohNo', 0), after = await loadProcgenTerrain('lemmings_ohNo', 0);
    // This test-only control restores the previous selection boundary. Shared
    // actions, terrain pieces and ordinary ability state are identical.
    before._introAssemblyEligible = () => true;
    const config = { masks, laneCount: 8, seed: 42, assists: false, populationPolicy: { scoutsEvery: 1000000, scoutDelayTicks: 1000000 } };
    const control = new ProcgenLaneWorld({ ...config, terrain: before }), world = new ProcgenLaneWorld({ ...config, terrain: after });
    const previous = [];
    for (const lane of [1, 2]) {
      const seed = world.laneSeeds[lane], old = before.describe(seed, 2), descriptor = after.describe(seed, 2), id = ids[lane - 1];
      const assembly = old.assemblies.find(a => a.id === id); expect(assembly).to.exist; previous.push({ assembly, placements: old.placements.filter(p => p.assembly === assembly) });
      expect(descriptor.deferredAssemblies).to.deep.include({ id, sourceRevision: assembly.sourceRevision, reason: 'early-local-route-envelope' });
      expect(descriptor.placements.some(p => p.assembly?.id === id)).to.equal(false);
      expect(descriptor.objects.some(p => p.assembly?.id === id)).to.equal(false);
      expect(descriptor.assemblies.some(a => a.id === id)).to.equal(false);
      expect(after.compiledAssemblies.some(group => group.entry.id === id)).to.equal(true);
      for (const owner of [control, world]) for (let ordinal = 0; ordinal < 8; ordinal++) {
        const actor = ordinal ? owner._spawn(lane, false) : owner.actors[lane];
        Object.assign(actor, { x: 250 - ordinal % 4, y: lane * 96 + 72, lookRight: true }); actor.setAction(owner.actions[State.WALKING]);
      }
    }
    const roof = after.describe(world.laneSeeds[7], 2);
    expect(roof.assemblies.map(a => a.id)).to.include('lemmings_ohNo/0/18a98e990ecae891'); expect(roof.deferredAssemblies).to.have.length(0);
    for (let tick = 0; tick < 180; tick++) { control.step(); world.step(); }
    for (const lane of [1, 2]) {
      const old = previous[lane - 1].assembly, crew = world.actors.filter(a => a.spawnLaneIndex === lane), stalled = control.actors.filter(a => a.spawnLaneIndex === lane);
      expect(crew).to.have.length(8); expect(stalled).to.have.length(8);
      expect(crew.every(a => a.furthestX > old.bounds.x2 + 16 && !a.failureReason && !a.canClimb && !a.hasParachute)).to.equal(true);
      const wallX = lane === 1 ? 278 : 276;
      expect(stalled.every(a => a.furthestX < wallX && !a.canClimb && !a.hasParachute)).to.equal(true);
    }
    expect(world.spawnedTotal).to.equal(22); expect(world.activeCount).to.equal(22); expect(world.stats.failures).to.equal(0);
    expect(world.stats.removedPixels).to.equal(0); expect(world.stats.builds + world.stats.bashes + world.stats.digs + world.stats.mines).to.equal(0);
    control.dispose(); world.dispose();
    for (const [index, chunk] of [[0, 9], [1, 8]]) {
      const terrain = await loadProcgenTerrain('lemmings_ohNo', 0), group = terrain.compiledAssemblies.find(g => g.entry.id === ids[index]);
      // Isolate the same complete sourced group, without changing its members,
      // offsets, support variants or later physical placement requirements.
      terrain.compiledAssemblies = [group];
      const descriptor = terrain.describe([3893677218, 2786763120][index], chunk), assembly = descriptor.assemblies.find(a => a.id === ids[index]);
      expect(assembly).to.exist; expect(assembly.bounds.x1).to.be.at.least(PROCGEN_RECOVERY_GAP_END); expect(descriptor.deferredAssemblies).to.have.length(0);
      expect(assembly.sourceRevision).to.equal(previous[index].assembly.sourceRevision);
      const placements = descriptor.placements.filter(p => p.assembly === assembly);
      expect(transforms(placements)).to.deep.equal(transforms(previous[index].placements));
      expect(placements.every(p => p.piece === terrain.pieces.find(piece => piece.id === p.piece.id))).to.equal(true);
    }
  });
  it('uses final gap-void semantics for the full candidate instead of re-adding cleared source pixels', async () => {
    const terrain = await loadProcgenTerrain('lemmings_ohNo', 0); terrain._introAssemblyEligible = () => true;
    const seed = 3893677218, original = terrain.describe(seed, 2), assembly = original.assemblies.find(a => a.id === ids[0]);
    const members = original.placements.filter(p => p.assembly === assembly), descriptor = { ...original, placements: [], objects: [],
      gapX: assembly.bounds.x1, gapWidth: assembly.bounds.x2 - assembly.bounds.x1, gapFloor: 75 };
    const check = Object.getPrototypeOf(terrain)._introAssemblyEligible;
    let calls = 0; const sampled = new Set(), sample = terrain.solidSample.bind(terrain);
    terrain.solidSample = (...args) => { calls++; sampled.add(`${args[2]}:${args[3]}`); return sample(...args); };
    expect(check.call(terrain, seed, 2, descriptor, assembly, members, () => 72)).to.equal(true);
    expect(calls).to.equal(sampled.size); expect(calls).to.be.lessThan(2300);
  });
});
