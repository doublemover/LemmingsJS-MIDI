import { searchProcgenGoal } from '../js/solver/ProcgenGoalSearch.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenRecipeTerrain } from '../js/app/procgen/ProcgenRecipeTerrain.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { expect } from 'chai';
import { ProcgenSolverAdapter, replayProcgenGoal } from '../js/solver/ProcgenSolverAdapter.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

import { factoryFor } from './support/procgen-route-fixtures.js';

describe('independent procgen real actor physical goals', function() {
  this.timeout(30000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('replays one complete inventory through a 96-pixel real wall for all sixteen ordinary actors', () => {
    const factory = factoryFor(masks, { wall: true, crewCount: 16 }), script = [{ tick: 0, target: 0, skillType: 'basher' }];
    const result = replayProcgenGoal(factory, script, { maxTicks: 1200, maxNodes: 1200, maxActions: 1 });
    expect(result.resultType).to.equal('solved'); expect(result.replaySummary.verified).to.equal(true);
    expect(result.replaySummary).to.include({ goalKind: 'physical-region', exitRescues: false, goalReachedCount: 16, deadCount: 0 });
    expect(result.replaySummary.skills).to.include({ basher: 0, builder: 0, digger: 0, miner: 0 });
    expect(result.replaySummary.lemmings.every(actor => !actor.dead)).to.equal(true);
    const second = replayProcgenGoal(factory, script, { maxTicks: 1200, maxNodes: 1200, maxActions: 1 });
    expect(second.replaySummary.stateHash).to.equal(result.replaySummary.stateHash);
  });
  it('independently replays the exact sourced Brick support/roof with original art and attachment provenance', async () => {
    const source = await loadProcgenTerrain('lemmings_ohNo', 0), lane = 5, floor = lane * 96 + 72;
    let sourceAssembly = null;
    const factory = () => new ProcgenSolverAdapter({ id: 'sourced-brick-tunnel', bounds: { x: 224, y: lane * 96, width: 160, height: 96 },
      goal: { x: 329, y: floor - 4, width: 32, height: 12 }, skills: { basher: 1 }, createWorld() {
        const terrain = new ProcgenRecipeTerrain({ recipe: source.recipe, terrainPieces: source.pieces, objectPieces: source.objects,
          sourceDescriptor: source.sourceDescriptor, assemblyCatalog: source.assemblyCatalog });
        const world = new ProcgenLaneWorld({ terrain, masks, assists: false, laneCount: 8, seed: 42, cohorts: true, maxActors: 8 });
        world.terrainGrowth.ensureLocal(lane, 383, { through: world.generatedThrough, frontiers: world.frontiers, prepare: world._prepareGrowthChunk, reveal: world._revealGrowth });
        const descriptor = terrain.describe(world.laneSeeds[lane], 2), pillar = descriptor.placements.find(p => p.piece.id === 28), roof = descriptor.placements.find(p => p.piece.id === 27);
        expect(pillar.assembly).to.equal(roof.assembly); sourceAssembly = pillar.assembly;
        const wallX = descriptor.origin + pillar.x;
        for (let y = floor - 24; y <= floor; y++) world.setGroundAt(228, y);
        for (let index = 0; index < 8; index++) {
          const actor = world._spawn(lane, false), x = index === 0 ? wallX - 1 : 240 + index;
          Object.assign(actor, { x, y: floor, lookRight: true, furthestX: x, scout: false }); actor.setAction(world.actions[State.WALKING]);
        }
        return world;
      }
    });
    const result = searchProcgenGoal(factory, { maxTicks: 600, maxNodes: 8, maxActions: 1 });
    expect(sourceAssembly.sourceRevision).to.equal(source.assemblyCatalog.sourceRevision);
    expect(result.resultType).to.equal('solved'); expect(result.replaySummary).to.include({ goalReachedCount: 8, deadCount: 0, hazardContacts: 0, protectedTerrainUnchanged: true });
  });  it('does not qualify wall-only walking or a rejected protected-terrain assignment', () => {
    const walking = replayProcgenGoal(factoryFor(masks, { wall: true }), [], { maxTicks: 450, maxNodes: 450 });
    expect(walking.resultType).not.to.equal('solved');
    const protectedWall = replayProcgenGoal(factoryFor(masks, { wall: true, steelWall: true }), [{ tick: 0, target: 0, skillType: 'basher' }]);
    expect(protectedWall.resultType).to.equal('failed'); expect(protectedWall.replaySummary.skills.basher).to.equal(1);
  });
  it('counts arrivals once, never counts lost actors and disables cohorts without disabling physical movement', () => {
    const adapter = factoryFor(masks, { skills: {} })();
    adapter.step(170); expect(adapter.getSavedCount()).to.equal(8); expect(adapter.world.spawnedTotal).to.equal(8);
    expect(adapter.world.cohorts).to.equal(false); expect(adapter.world.actors.every(actor => actor.x > 180)).to.equal(true);
    adapter.initialActors[0].failureReason = 'unsafe-fall';
    expect(adapter.getSavedCount()).to.equal(7); expect(adapter.isTerminal()).to.equal(true); adapter.dispose();
  });
  it('bounds snapshots before invoking the factory and rejects changed replay authority or step bounds', () => {
    let calls = 0;
    expect(() => new ProcgenSolverAdapter({ bounds: { x: 0, y: 0, width: 4194305, height: 1 }, goal: { x: 0, y: 0, width: 1, height: 1 }, createWorld() { calls++; } })).to.throw('budget');
    expect(calls).to.equal(0);
    const adapter = factoryFor(masks)(), snapshot = adapter.snapshot();
    expect(snapshot.groundMask).to.have.length(248 * 96); expect(snapshot).to.include({ kind: 'procgen', goalKind: 'physical-region' });
    for (const count of [0, -1, Infinity, 4097]) expect(() => adapter.step(count)).to.throw('step count');
    adapter.world.assists = true; expect(() => adapter.step()).to.throw('assistance'); adapter.world.assists = false;
    adapter.world.cohorts = true; expect(() => adapter.step()).to.throw('admissions'); adapter.world.cohorts = false;
    adapter.world._spawn(0, false); expect(() => adapter.step()).to.throw('admissions'); adapter.dispose();
  });
});
