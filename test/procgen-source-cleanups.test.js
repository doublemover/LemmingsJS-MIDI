import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { createProcgenLaneRuntime } from '../js/app/procgen/ProcgenLaneRuntime.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { Logger, BaseLogger } from '../js/util/LogHandler.js';
import { getDependency, setDependency } from '../js/core/dependencies.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

const canvasFixture = (width = 320, height = 200) => {
  const ownerDocument = { createElement: () => canvasFixture() };
  const context = { globalAlpha: 1, blits: 0,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    drawImage() { this.blits++; }, putImageData() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  return { width, height, ownerDocument, context, getContext: () => context, addEventListener() {}, removeEventListener() {} };
};

const walker = world => {
  const actor = world.actors[0]; actor.x = 36; actor.y = 72; actor.setAction(world.actions[State.WALKING]); return actor;
};

describe('source-level procgen work removal', function() {
  this.timeout(30000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });

  it('consumes the assisted walking column without querying its pixels a second time', () => {
    const world = new ProcgenLaneWorld({ masks }), actor = walker(world);
    world._assist(actor);
    const queries = world.stats.groundQueries;
    expect(queries).to.be.greaterThan(0);
    actor.process(world);
    expect(world.stats.groundQueries).to.equal(queries);
    expect([actor.x, actor.y, actor.frameIndex]).to.deep.equal([37, 72, 1]);
    expect(world._assistedColumn.valid).to.equal(false);
    world.dispose();
  });

  it('invalidates the assisted column for terrain edits made by a secondary action', () => {
    const world = new ProcgenLaneWorld({ masks }), actor = walker(world);
    world._assist(actor);
    const queries = world.stats.groundQueries;
    actor.countdownAction = { process(level) {
      for (let y = 65; y <= 72; y++) level.setGroundAt(37, y);
      return State.NO_STATE_TYPE;
    } };
    actor.process(world);
    expect(world.stats.groundQueries).to.equal(queries + 8);
    expect(actor.x).to.equal(36); expect(actor.lookRight).to.equal(false);
    world.dispose();
  });

  it('does not reuse an assisted column for a different direction, coordinate or generation', () => {
    const world = new ProcgenLaneWorld({ masks }), actor = walker(world);
    world._assist(actor); actor.lookRight = false;
    const queries = world.stats.groundQueries;
    actor.process(world);
    expect(world.stats.groundQueries).to.be.greaterThan(queries);
    expect(actor.x).to.equal(35);
    world._assist(actor); world._restart([]);
    expect(world._assistedColumn.valid).to.equal(false);
    world.dispose();
  });

  it('does not traverse decorative source pixels when composing collision alone', async () => {
    const terrain = await loadProcgenTerrain(), describe = terrain.describe.bind(terrain);
    let reads = 0;
    const frame = new Proxy([1], { get(target, key) { if (key === '0') reads++; return target[key]; } });
    const piece = { frame, image: { width: 1, height: 1, palette: { getColor: () => 0xff123456 } } };
    terrain.describe = (seed, chunk) => ({ ...describe(seed, chunk), placements: [{ piece, x: 1, y: 3, decor: true }] });
    const collision = terrain._compose(42, 0, false);
    expect(reads).to.equal(0);
    const raster = terrain._compose(42, 0, true);
    expect(reads).to.equal(1);
    expect(collision.solid).to.deep.equal(raster.solid); expect(collision.steel).to.deep.equal(raster.steel);
    expect(collision.topProfile).to.deep.equal(raster.topProfile);
    expect(raster.pixels[3 * terrain.chunkWidth + 1]).to.equal(0xff123456);
  });

  it('reuses unchanged frames while invalidating ticks, terrain, appearance, HUD, camera and size', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 8 }), canvas = canvasFixture();
    const windowRef = { devicePixelRatio: 1, performance };
    const renderer = new ProcgenLaneRenderer({ canvas, world, assets: { groundPieces: [] }, windowRef });
    let actors = 0, hud = 0;
    for (const actor of world.actors) actor.render = () => actors++;
    world.sprites = { activePreference: {} };
    renderer.hud = { sprites: {}, render: () => hud++ }; renderer.follow = false;
    expect(renderer.render(false)).to.equal(true);
    const drawn = actors, blits = canvas.context.blits;
    for (let i = 0; i < 10; i++) expect(renderer.render(false)).to.equal(false);
    expect(actors).to.equal(drawn); expect(hud).to.equal(1); expect(canvas.context.blits).to.equal(blits);
    renderer.cameraX = 0.2; expect(renderer.render(false)).to.equal(false);
    const changed = mutate => { mutate(); expect(renderer.render(false)).to.equal(true); expect(renderer.render(false)).to.equal(false); };
    changed(() => world.tickIndex++);
    changed(() => world.setGroundAt(2, 2));
    changed(() => world.frontierRevision++);
    changed(() => { world.sprites.activePreference = {}; });
    changed(() => { renderer.hud.sprites = {}; });
    let decorFrames = 0;
    changed(() => { renderer.decorationLayer = { draw: () => decorFrames++ }; });
    expect(decorFrames).to.equal(1);
    changed(() => { renderer.reducedMotion = { matches: true }; });
    expect(decorFrames).to.equal(2);
    changed(() => { renderer.hud = { sprites: {}, render: () => hud++ }; });
    changed(() => { renderer.cameraX += 10; });
    changed(() => { renderer.cameraY += 0.2; });
    changed(() => { renderer.scale = 1 / 256; });
    changed(() => { canvas.width += 1; });
    changed(() => { windowRef.devicePixelRatio = 2; });
    expect(renderer.image.data.length).to.be.at.most(canvas.width * canvas.height * 4);
    expect(renderer.render()).to.equal(true);
    renderer.resize(); expect(renderer.render(false)).to.equal(false);
    renderer.dispose(); world.dispose();
  });

  it('caches the follow leader per tick without freezing camera easing or explicit updates', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 4 }), canvas = canvasFixture();
    const renderer = new ProcgenLaneRenderer({ canvas, world, assets: { groundPieces: [] }, windowRef: { devicePixelRatio: 1, performance } });
    world.actors[0].x = 500;
    let visits = 0;
    world.actors[Symbol.iterator] = function* () { for (let i = 0; i < this.length; i++) { visits++; yield this[i]; } };
    renderer.camera.update(false, true); const firstX = renderer.cameraX;
    renderer.camera.update(false, true);
    expect(visits).to.equal(4); expect(renderer.cameraX).to.be.greaterThan(firstX);
    world.tickIndex++; renderer.camera.update(false, true); expect(visits).to.equal(8);
    world.actors[0].failureReason = 'test'; renderer.camera.update(); expect(visits).to.equal(12);
    world._spawn(0, false); renderer.camera.update(false, true); expect(visits).to.equal(17);
    renderer.camera.followFrontier(); expect(renderer.follow).to.equal(true);
    renderer.dispose(); world.dispose();
  });

  it('skips duplicate RAF frames while paused and resumes actual simulation rendering', async () => {
    const terrain = await loadProcgenTerrain(), callbacks = [], canvas = canvasFixture();
    const windowRef = { devicePixelRatio: 1, performance: { now: () => 5000 },
      document: { hidden: false, addEventListener() {}, removeEventListener() {} },
      requestAnimationFrame: callback => (callbacks.push(callback), callbacks.length), cancelAnimationFrame() {} };
    const runtime = createProcgenLaneRuntime({ canvas, masks, terrain, assets: { groundPieces: terrain.pieces }, laneCount: 1, seed: 42, windowRef });
    callbacks.shift()(0); const initial = canvas.context.blits;
    for (const time of [4, 8, 12, 16]) callbacks.shift()(time);
    expect(canvas.context.blits).to.equal(initial); expect(runtime.renderer.frameCacheHits).to.equal(4);
    callbacks.shift()(20); expect(runtime.world.tickIndex).to.equal(1); expect(canvas.context.blits).to.equal(initial + 1);
    runtime.pause(); callbacks.shift()(40); callbacks.shift()(60);
    expect(runtime.world.tickIndex).to.equal(1); expect(canvas.context.blits).to.equal(initial + 1);
    runtime.renderer.camera.pan(12, 0); expect(canvas.context.blits).to.equal(initial + 2);
    runtime.resume(); callbacks.shift()(80); callbacks.shift()(100);
    expect(runtime.world.tickIndex).to.equal(2);
    runtime.step(); expect(runtime.world.tickIndex).to.equal(3);
    runtime.stop();
  });
});

describe('shared default actor logging', () => {
  let previous;
  beforeEach(() => { previous = getDependency('LogHandler', Logger); setDependency('LogHandler', Logger); });
  afterEach(() => setDependency('LogHandler', previous));
  it('shares only the default logger for actors, retaining normal BaseLogger ownership', () => {
    const a = new Lemming(0, 0, 1), b = new Lemming(0, 0, 2);
    expect(a.log).to.equal(b.log); expect(a.log._moduleName).to.equal('Lemming');
    expect(new BaseLogger().log).not.to.equal(new BaseLogger().log);
    const log = a.log; a.reset(1, 1, 3); expect(a.log).to.equal(log);
  });
  it('constructs independent injected handlers and respects dependency changes', () => {
    const standard = new Lemming().log;
    class StatefulHandler { constructor(name) { this.name = name; this.messages = []; } }
    setDependency('LogHandler', StatefulHandler);
    const a = new Lemming(), b = new Lemming();
    expect(a.log).to.be.instanceOf(StatefulHandler); expect(a.log.name).to.equal('Lemming');
    expect(a.log).not.to.equal(b.log); a.log.messages.push('one'); expect(b.log.messages).to.deep.equal([]);
    setDependency('LogHandler', Logger); expect(new Lemming().log).to.equal(standard);
  });
});
