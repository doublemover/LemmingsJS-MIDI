import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { normalizeWorkerLimits } from '../js/app/procgen/ProcgenWorkerLimits.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { TriggerTypes as Types } from '../js/level/TriggerTypes.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

const flatTerrain = ({ steel = false } = {}) => {
  const collision = new Map();
  const solidSample = (seed, chunk, x, y) => y >= 72;
  return { recipe: { id: 'flat-fixture' }, chunkWidth: 128, collision, objects: [], configure() {}, reset() { collision.clear(); }, surface: () => 72,
    solidSample, rasterSample: (seed, chunk, x, y) => solidSample(seed, chunk, x, y) ? 0xff775544 : 0,
    describe: () => ({ objects: [] }), sample: () => 0xff775544,
    getChunk(seed, chunk) {
      const key = `${seed}:${chunk}`;
      if (!collision.has(key)) {
        const solid = new Uint32Array(384), metal = new Uint32Array(384), pixels = new Uint32Array(128 * 96);
        for (let y = 72; y < 96; y++) for (let x = 0; x < 128; x++) { const bit = y * 128 + x; solid[bit >>> 5] |= 1 << (bit & 31); if (steel) metal[bit >>> 5] |= 1 << (bit & 31); pixels[bit] = 0xff775544; }
        collision.set(key, { solid, steel: metal, pixels, topProfile: new Uint8Array(128), barrierWidth: 0, gapWidth: 0 });
      }
      return collision.get(key);
    }
  };
};
const canvasFixture = () => {
  const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    clearRect() {}, putImageData() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const ownerDocument = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) };
  return { width: 900, height: 288, ownerDocument, getContext: () => context, addEventListener() {}, removeEventListener() {} };
};
const walker = (world, x, lane = 0) => {
  const actor = world._spawn(lane); Object.assign(actor, { x, y: lane * 96 + 72, scout: false }); actor.setAction(world.actions[State.WALKING]); return actor;
};
describe('procgen visible edge and configured worker crews', function() {
  this.timeout(30000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });

  it('retains ordinary left walking through the former invisible x36 return wall', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: flatTerrain() }), actor = world.actors[0];
    Object.assign(actor, { x: 37, y: 72, lookRight: false }); actor.setAction(world.actions[State.WALKING]);
    world.step(); expect(actor.x).to.equal(36); expect(actor.lookRight).to.equal(false);
    world.step(); expect(actor.x).to.equal(35); expect(actor.lookRight).to.equal(false);
    expect(world.stats.turns).to.equal(0); expect(world.stats.blockers).to.equal(0); world.dispose();
  });

  it('renders the actual source edge exactly like collision and permits real construction in its empty pixels', async () => {
    for (const terrain of [flatTerrain(), await loadProcgenTerrain('lemmings', 3)]) {
      const world = new ProcgenLaneWorld({ masks, terrain, assists: false }), renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: {}, windowRef: { devicePixelRatio: 1, performance } });
      renderer.follow = false; renderer.render();
      for (let x = 0; x < world.leftEdgeX; x++) {
        expect(world.hasGroundAt(x, 80)).to.equal(false); expect(world.basePixelAt(x, 80)).to.equal(0);
        expect(world.getColumnStepHeight(x, 73, 8)).to.equal(0); expect(world.getColumnGapDepth(x, 73, 8)).to.equal(9);
        expect(renderer.pixels[80 * renderer.buffer.width + x]).to.equal(0xff0e0807);
      }
      expect(world.hasGroundAt(world.leftEdgeX, 80)).to.equal(true);
      world.setGroundAt(4, 80); renderer.render(); expect(world.hasGroundAt(4, 80)).to.equal(true);
      expect(renderer.pixels[80 * renderer.buffer.width + 4]).to.equal(0xff86cbea);
      renderer.dispose(); world.dispose();
    }
  });

  it('places one visible real blocker at the edge and turns followers only through directional contacts', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: flatTerrain() }), blocker = world.actors[0], events = [];
    Object.assign(blocker, { x: 20, y: 72, lookRight: false }); blocker.setAction(world.actions[State.WALKING]);
    const follower = walker(world, 26); follower.lookRight = false;
    world.soundEvents.onEvent.on(event => events.push(event)); world.step();
    expect(blocker.action).to.equal(world.actions[State.BLOCKING]); expect(blocker.lookRight).to.equal(false);
    expect(world.edgeBlockers[0]).to.equal(blocker); expect(world.triggerManager.byOwner.size).to.equal(1);
    const triggers = world.triggerManager.byOwner.get(blocker);
    expect(triggers.map(trigger => trigger.type)).to.deep.equal([Types.BLOCKER_LEFT, Types.BLOCKER_RIGHT]);
    expect(triggers.every(trigger => trigger.owner === blocker)).to.equal(true);
    expect(triggers[1]).to.include({ x1: 24, x2: 27, y1: 62, y2: 76 });
    expect(follower.x).to.equal(25); expect(follower.lookRight).to.equal(true);
    expect(world.getLaneMusicSignals(0).blockingCount).to.equal(1); expect(world.stats.blockers).to.equal(1);
    const turns = events.filter(event => event.type === 'blocker-turn');
    expect(turns).to.have.length(1); expect(turns[0]).to.include({ lemmingId: follower.id, blockerId: blocker.id, laneIndex: 0, laneCount: 1 });
    world.step(); expect(follower.x).to.equal(26); expect(events.filter(event => event.type === 'blocker-turn')).to.have.length(1);
    world.dispose();
  });

  it('removes blocker-owned triggers on falling, reassignment, removal, reset, and disposal', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: flatTerrain() }), actor = world.actors[0];
    Object.assign(actor, { x: 20, y: 72, lookRight: false }); actor.setAction(world.actions[State.WALKING]); world.step();
    world.clearGroundAt(20, 73); world.step(); expect(actor.action).to.equal(world.actions[State.FALLING]);
    expect(world.triggerManager.byOwner.size).to.equal(0); expect(world.edgeBlockers[0]).to.equal(null);
    world.setGroundAt(20, 73); actor.y = 72; actor.setAction(world.actions[State.BLOCKING]); world.edgeBlockers[0] = actor; world.step();
    expect(world.triggerManager.byOwner.size).to.equal(1); expect(world.assignWorker(actor, 'diggers')).to.equal(true);
    expect(world.triggerManager.byOwner.size).to.equal(0); expect(world.edgeBlockers[0]).to.equal(null);
    actor.setAction(world.actions[State.BLOCKING]); world.step(); actor.remove(); world.step(); expect(world.triggerManager.byOwner.size).to.equal(0);
    world._restart([]); expect(world.edgeBlockers.every(value => value === null)).to.equal(true); expect(world.triggerManager.byOwner.size).to.equal(0);
    const next = walker(world, 20); next.lookRight = false; world.step(); expect(world.triggerManager.byOwner.size).to.equal(1);
    world.dispose(); expect(world.triggerManager.byOwner.size).to.equal(0);
  });

  it('normalizes an editable copied policy and lets existing jobs finish after a limit is lowered', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: flatTerrain(), assists: false, workerLimits: { bashers: 3, diggers: 2 } });
    expect(world.workerLimits).to.deep.equal({ bashers: 3, diggers: 2, builders: 8 });
    const a = walker(world, 70), b = walker(world, 95), c = walker(world, 110);
    expect(world.assignWorker(a, 'diggers')).to.equal(true); expect(world.assignWorker(b, 'diggers')).to.equal(true);
    const policy = world.setWorkerLimits({ diggers: 0, bashers: 99, builders: -1 });
    expect(policy).to.deep.equal({ bashers: 16, diggers: 0, builders: 0 }); policy.diggers = 16;
    expect(world.workerLimits.diggers).to.equal(0); expect(world.assignWorker(c, 'diggers')).to.equal(false);
    world.step(); expect(a.action).to.equal(world.actions[State.DIGGING]); expect(b.action).to.equal(world.actions[State.DIGGING]);
    expect(world.getLaneMusicSignals(0).diggingCount).to.equal(2);
    expect(normalizeWorkerLimits({ bashers: Infinity, builders: '4.9' })).to.deep.equal({ bashers: 4, diggers: 4, builders: 4 });
    expect(world.getDebugState().workerLimits).to.deep.equal(world.workerLimits); world.dispose();
  });

  it('shares one excavation cap between real digging and mining while retaining active owners after lowering it', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: flatTerrain(), assists: false, workerLimits: { diggers: 2 } });
    const digger = walker(world, 70), miner = walker(world, 110), waiting = walker(world, 150);
    expect(world.assignWorker(digger, 'diggers')).to.equal(true); expect(world.assignWorker(miner, 'miners')).to.equal(true);
    expect(world.assignWorker(waiting, 'miners')).to.equal(false); expect(world.assignWorker(waiting, 'diggers')).to.equal(false);
    expect(world.stats.digs).to.equal(1); expect(world.stats.mines).to.equal(1);
    world.setWorkerLimits({ diggers: 0 }); world.step();
    expect(digger.action).to.equal(world.actions[State.DIGGING]); expect(miner.action).to.equal(world.actions[State.MINING]);
    expect(world.getLaneMusicSignals(0).diggingCount).to.equal(2); expect(world.getLaneMusicSignals(0).miningCount).to.equal(1);
    expect(world.accessTasks[0].filter(task => task.owner)).to.have.length(2); expect(world.assignWorker(waiting, 'miners')).to.equal(false);
    world.dispose();
  });

  it('permits independent bash/dig/build tasks within their own limits and excludes overlapping builder footprints', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: flatTerrain(), assists: false, workerLimits: { bashers: 2, diggers: 2, builders: 2 } }), actors = Array.from({ length: 10 }, (_, index) => walker(world, 70 + index * 20));
    expect(world.assignWorker(actors[0], 'bashers')).to.equal(true); expect(world.assignWorker(actors[1], 'bashers')).to.equal(true);
    expect(world.assignWorker(actors[2], 'bashers')).to.equal(false);
    expect(world.assignWorker(actors[3], 'diggers')).to.equal(true); expect(world.assignWorker(actors[4], 'diggers')).to.equal(true);
    expect(world.assignWorker(actors[5], 'diggers')).to.equal(false);
    expect(world.assignWorker(actors[6], 'builders', 240)).to.equal(true);
    expect(world.assignWorker(actors[7], 'builders', 245)).to.equal(false);
    expect(world.assignWorker(actors[7], 'builders', 270)).to.equal(false);
    expect(world.assignWorker(actors[8], 'builders', 270)).to.equal(true);
    expect(world.assignWorker(actors[9], 'builders', 300)).to.equal(false);
    expect(world.accessTasks[0].filter(task => task.owner)).to.have.length(6); world.dispose();
  });

  it('admits the raised default crews while retaining exact local exclusion and configured bounds', () => {
    for (const [kind, limit] of [['bashers', 4], ['diggers', 4], ['builders', 8]]) {
      const world = new ProcgenLaneWorld({ masks, terrain: flatTerrain(), assists: false });
      expect(world.workerLimits[kind]).to.equal(limit);
      for (let index = 0; index < limit; index++) {
        const actor = walker(world, 64 + index * 64);
        expect(world.assignWorker(actor, kind, actor.x + 24)).to.equal(true);
        if (index === 0) expect(world.assignWorker(walker(world, actor.x), kind, actor.x + 24)).to.equal(false);
      }
      const excess = walker(world, 64 + limit * 64);
      expect(world.assignWorker(excess, kind, excess.x + 24)).to.equal(false);
      expect(world.accessTasks[0].filter(task => task.owner)).to.have.length(limit); world.dispose();
    }
  });

  it('runs actual concurrent dig rows, steel stops, lane bounds, terrain accounting and source sound payloads', () => {
    const world = new ProcgenLaneWorld({ masks, terrain: flatTerrain(), assists: false, laneCount: 2 }), events = [];
    const a = walker(world, 70), b = walker(world, 100);
    world.soundEvents.onEvent.on(event => events.push(event));
    world.assignWorker(a, 'diggers'); world.assignWorker(b, 'diggers'); world.step();
    expect(world.stats.removedPixels).to.equal(18); expect(world.stats.digs).to.equal(2);
    for (const actor of [a,b]) for (let x = actor.x - 4; x <= actor.x + 4; x++) expect(world.hasGroundAt(x, 72)).to.equal(false);
    expect(events.filter(event => event.type === 'lemming-dig')).to.have.length(2);
    expect(events.filter(event => event.type === 'lemming-dig').every(event => event.removed === 9 && event.laneIndex === 0 && event.laneCount === 2)).to.equal(true);
    a.y = 95; world.step(); while (a.action === world.actions[State.DIGGING] && world.tickIndex < 20) world.step();
    expect(a.action).not.to.equal(world.actions[State.DIGGING]); expect(world.hasGroundAt(a.x, 96 + 72)).to.equal(true);
    world.dispose();
    const metal = new ProcgenLaneWorld({ masks, terrain: flatTerrain({ steel: true }), assists: false }), worker = walker(metal, 70), steelEvents = [];
    metal.soundEvents.onEvent.on(event => steelEvents.push(event)); expect(metal.assignWorker(worker, 'diggers')).to.equal(true); metal.step();
    expect(worker.action).to.equal(metal.actions[State.SHRUG]); expect(metal.stats.removedPixels).to.equal(0);
    expect(steelEvents.filter(event => event.type === 'steel-hit')).to.have.length(1); expect(metal.hasGroundAt(worker.x, 72)).to.equal(true); metal.dispose();
  });
});
