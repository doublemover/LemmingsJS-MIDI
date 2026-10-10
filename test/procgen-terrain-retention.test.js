import { expect } from 'chai';
import { ProcgenTerrainEdits, ProcgenTerrainRevisions, procgenTileRevision } from '../js/app/procgen/ProcgenTerrainRetention.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

const dense = (length, entries = []) => { const data = new Uint8Array(length); for (const [at, value] of entries) data[at] = value; return data; };

describe('lossless interest-based procgen terrain retention', function() {
  this.timeout(30000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('bounds dense storage while preserving sparse runs, fragmented raw patches and Map-compatible reads', () => {
    const retired = [], store = new ProcgenTerrainEdits(64, 2, key => retired.push(key));
    const sparse = dense(64, [[3, 1], [4, 1], [5, 1], [60, 4]]), fragmented = Uint8Array.from({ length: 64 }, (_, index) => index % 2 ? 4 : 1);
    store.set(1, sparse); store.set(2, fragmented); store.set(3, dense(64, [[32, 4]]));
    expect(store.has(1)).to.equal(true); expect(store.size).to.equal(3); expect(store.snapshot()).to.include({ residentChunks: 2, coldChunks: 1, coldBytes: 10 });
    expect(store.get(1)).to.deep.equal(sparse); expect(store.cold.get(2).raw).to.deep.equal(fragmented);
    expect(store.get(2)).to.deep.equal(fragmented);
    expect(store.snapshot().residentChunks).to.equal(2); expect(store.snapshot().totalBytes).to.equal(store.snapshot().residentBytes + store.snapshot().coldBytes);
    expect([...store.keys()].sort()).to.deep.equal([1, 2, 3]); expect(new Map(store).get(1)).to.deep.equal(sparse);
    expect([...store.values()].every(data => data instanceof Uint8Array && data.length === 64)).to.equal(true);
    const seen = []; store.forEach((value, key, owner) => { expect(owner).to.equal(store); seen.push(key); }); expect(seen.sort()).to.deep.equal([1, 2, 3]);
    store.compactExcept(new Set(), 1); expect(store.snapshot().residentChunks).to.equal(0);
    expect(store.get(999)).to.equal(undefined); expect(store.delete(999)).to.equal(false);
    expect(store.delete(1)).to.equal(true); store.get(2); expect(store.delete(2)).to.equal(true);
    expect(() => store.set(9, new Uint8Array(3))).to.throw('edit patch');
    store.set(3, dense(64, [[12, 1]])); expect(store.get(3)[12]).to.equal(1);
    expect(retired).to.include(1); store.clear(); expect(store.size).to.equal(0); expect(store.snapshot().totalBytes).to.equal(0);
  });
  it('retires unused revision keys without reviving stale identities or invalidating pinned distant lanes', () => {
    const revisions = new ProcgenTerrainRevisions(2, 128), rear = 0, lane1 = 0x800000;
    const before = revisions.read(rear); revisions.retain(new Set([rear, lane1]));
    for (let chunk = 1; chunk < 1000; chunk++) revisions.set(chunk, chunk);
    expect(revisions.size).to.be.at.most(revisions.maxEntries); expect(revisions.read(rear)).to.equal(before);
    const retiredKey = 1, retiredIdentity = revisions.read(retiredKey);
    expect(retiredIdentity).not.to.equal(1);
    revisions.set(retiredKey, 1001); const changedIdentity = revisions.read(retiredKey);
    for (let chunk = 1002; chunk < 1400; chunk++) revisions.set(chunk, chunk);
    expect(revisions.read(retiredKey)).not.to.equal(changedIdentity); expect(revisions.read(retiredKey)).not.to.equal(retiredIdentity);
    expect(revisions.read(lane1)).to.equal(0);
    revisions.retain(new Set([rear, lane1])); expect(revisions.size).to.be.at.most(2 + 2 * 16);
    expect(procgenTileRevision({ terrainTileRevisions: new Map([[4, 8]]) }, 4)).to.equal(8);
    expect(procgenTileRevision({}, 4)).to.equal(0);
    revisions.clear(); expect(revisions.size).to.equal(0); expect([...revisions.epochs]).to.deep.equal([0, 0]);
  });
  it('keeps real rear blocker contacts and active worker footprints dense without retaining the whole corridor', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false, laneCount: 2 });
    const rear = world.actors[0]; Object.assign(rear, { x: 20, y: 71 }); rear.setAction(world.actions[State.BLOCKING]);
    world.actions[State.BLOCKING].process(world, rear);
    const forward = world.actors[1]; Object.assign(forward, { x: 2000, y: 99 });
    world.setGroundAt(20, 72);
    for (let x = 64; x < 2000; x += 32) world.setGroundAt(x, 80);
    world.setGroundAt(2000, 95); world.setGroundAt(800, 95); world.setGroundAt(800, 116); world.setGroundAt(800, 117);
    const worker = world._spawn(1, false); Object.assign(worker, { x: 800, y: 116 }); worker.setAction(world.actions[State.WALKING]);
    const footprint = { x1: 790, x2: 850, y1: 92, y2: 120 };
    expect(world.assignWorker(worker, 'builders', 840, footprint)).to.equal(true);
    expect(world.hasGroundAt(800, 95)).to.equal(true);
    world._pruneEdits();
    const snapshot = world.editChunks.snapshot(); expect(snapshot.coldChunks).to.be.greaterThan(40);
    expect(snapshot.residentChunks).to.be.lessThan(15); expect(snapshot.residentChunks).to.be.at.most(snapshot.maxResidentChunks);
    expect(world.editChunks.cold.has(world._editKey(20, 72))).to.equal(false);
    expect(world.editChunks.cold.has(world._editKey(800, 95))).to.equal(false);
    expect(world.editChunks.cold.has(world._editKey(2000, 95))).to.equal(false);
    expect(world.triggerManager.byOwner.get(rear)).to.have.length(2);
    expect(world.actions[State.BLOCKING].process(world, rear)).to.equal(State.NO_STATE_TYPE);
    expect(world.hasGroundAt(20, 72)).to.equal(true);
    expect(world.hasGroundAt(640, 80)).to.equal(true); expect(world.editChunks.stats.restored).to.be.greaterThan(0);
    worker.setAction(world.actions[State.WALKING]); world._pruneEdits();
    expect(world.editChunks.cold.has(world._editKey(800, 95))).to.equal(true);
    world.dispose(); expect(world.editChunks.snapshot().totalBytes).to.equal(0); expect(world.terrainTileRevisions.size).to.equal(0);
  });
  it('preserves real source alpha/color/protected steel and shared walker motion after cold revisit and new admission', async () => {
    const scene = async () => {
      const terrain = await loadProcgenTerrain('lemmings', 0), describe = terrain.describe.bind(terrain), steel = terrain.pieces.find(piece => piece.isSteel);
      expect(steel).to.exist;
      terrain.describe = (seed, chunk) => {
        const descriptor = describe(seed, chunk);
        return chunk === 0 ? { ...descriptor, placements: [...descriptor.placements, { piece: steel, x: 64, y: 101, decor: false, sourceRevision: terrain.recipe.assetSha256 }] } : descriptor;
      };
      const world = new ProcgenLaneWorld({ masks, terrain, laneHeight: 144, assists: false, seed: 42 });
      world.setGroundAt(40, 32); world.clearGroundAt(44, 120);
      world.actors[0].x = 2000;
      return world;
    };
    const cold = await scene(), reference = await scene(), materialRevision = cold.terrainRevision;
    // This controlled source fixture uses an unchanged loaded steel tile, not a
    // claim that the generator places this early obstacle or that it is solved.
    const read = world => {
      const result = []; let steel = 0;
      for (let y = 0; y < 144; y++) for (let x = 8; x < 128; x++) {
        const metal = world.hasSteelAt(x, y); if (metal) steel++;
        result.push(world.groundColorAt(x, y), world.groundPixelAt(x, y), metal);
      }
      expect(steel).to.be.greaterThan(0); return result;
    };
    const before = read(reference); cold._pruneEdits();
    expect(cold.editChunks.snapshot()).to.include({ residentChunks: 0, coldChunks: 1 });
    expect(cold.terrainRevision).to.equal(materialRevision); expect(read(cold)).to.deep.equal(before);
    expect(cold.groundPixelAt(40, 32)).to.equal(0xff86cbea); expect(cold.hasGroundAt(44, 120)).to.equal(false);
    for (const world of [cold, reference]) {
      const actor = world._spawn(0, false); world.actors[0].removed = true;
      Object.assign(actor, { x: 100, y: 120, lookRight: false, canClimb: false, hasParachute: false }); actor.setAction(world.actions[State.WALKING]);
    }
    for (let tick = 0; tick < 25; tick++) { cold.step(); reference.step(); }
    const actorState = world => world.actors.map(actor => [actor.id, actor.x, actor.y, actor.lookRight, actor.action?.actionName, actor.failureReason]);
    expect(actorState(cold)).to.deep.equal(actorState(reference)); expect(cold.stats.failures).to.equal(0);
    expect(cold.getDebugState().terrainEditStorage.totalBytes).to.equal(cold.editChunks.snapshot().totalBytes);
    cold._restart([]); expect(cold.editChunks.size).to.equal(0); expect(cold.editChunks.cold.size).to.equal(0); expect(cold.terrainTileRevisions.epochs[0]).to.equal(0);
    cold.dispose(); reference.dispose();
  });
  it('bounds unedited growth revision metadata and refreshes retired source identities on revisit', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false }); const rear = world.actors[0]; Object.assign(rear, { x: 20, y: 72 });
    world._pruneEdits(); const rearIdentity = world.getTerrainTileRevision(0);
    for (let chunk = 1; chunk <= 1500; chunk++) world._revealGrowth(0, 0, 0, chunk, { kind: 'foundation' });
    const before = world.getTerrainTileRevision(1500); world._pruneEdits();
    expect(world.terrainTileRevisions.size).to.be.at.most(world.terrainTileRevisions.maxEntries);
    expect(world.terrainTileRevisions.size).to.be.lessThan(25);
    expect(world.getTerrainTileRevision(0)).to.equal(rearIdentity);
    expect(world.getTerrainTileRevision(1)).not.to.equal(1);
    for (let chunk = 1501; chunk <= 1800; chunk++) world._revealGrowth(0, 0, 0, chunk, { kind: 'foundation' });
    world._pruneEdits(); expect(world.getTerrainTileRevision(1500)).not.to.equal(before);
    world.dispose();
  });
});
