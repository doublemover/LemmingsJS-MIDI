import { createProcgenLaneRuntime } from '../js/app/procgen/ProcgenLaneRuntime.js';
import { expect } from 'chai';
import { CharacterParticles } from '../js/lemmings/CharacterParticles.js';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { hashProcgenPhysicsCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpointProvenance.js';
import { createProcgenLaneProjection } from '../js/app/procgen/workstation/ProcgenLaneProjection.js';
const canvasFixture = () => {
  const pixels = [];
  const context = { globalAlpha: 1, fillRect(x, y, w, h) { pixels.push({ x, y, w, h, color: this.fillStyle, alpha: this.globalAlpha }); }, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {}, drawImage() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const ownerDocument = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) };
  const listeners = new Map();
  return { width: 900, height: 450, ownerDocument, pixels, getContext: () => context,
    addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event), listeners };
};

describe('read-only runtime throughput observation', () => {
  it('reports paused throughput without adding diagnostic fields to the physical timer or changing its checkpoint hash', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), laneCount: 1 }), callbacks = new Map(), metrics = []; let serial = 0, time = 0;
    const windowRef = { document: { hidden: false, addEventListener() {}, removeEventListener() {} }, performance: { now: () => time }, devicePixelRatio: 1,
      requestAnimationFrame(callback) { callbacks.set(++serial, callback); return serial; }, cancelAnimationFrame(id) { callbacks.delete(id); } };
    const runtime = createProcgenLaneRuntime({ canvas: canvasFixture(), initialWorld: world, assets: { groundPieces: [] }, windowRef, onMetrics: value => metrics.push(value) });
    try {
      runtime.pause(); const before = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world));
      for (const timestamp of [0, 1000, 2000]) { const callback = callbacks.values().next().value; callbacks.clear(); time = timestamp; callback(timestamp); }
      expect(world.tickIndex).to.equal(0); expect(Object.hasOwn(world.timer, 'achievedTicksPerSecond')).to.equal(false);
      expect(metrics.at(-1).achievedTicksPerSecond).to.equal(0); expect(runtime.getDebugState().achievedTicksPerSecond).to.equal(0);
      expect(await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world))).to.equal(before);
    } finally { await runtime.stop().completion; }
  });
});
describe('bounded shared-lane renderer', () => {
  it('rasterizes arbitrary physical rows with bounded pooled surfaces and retires them on contiguous return', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), laneCount: 8 }), renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: { groundPieces: [] }, windowRef: { devicePixelRatio: 1, performance } });
    const before = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world));
    renderer.workstationLayout = createProcgenLaneProjection({ laneCount: 8, height: 450, laneIndices: [7, 0, 6, 1] }); expect(renderer.render(true), renderer.getDisplayState().reason).to.equal(true);
    expect(renderer.workstationRows.map(row => row.lane)).to.deep.equal([7, 0, 6, 1]); expect(renderer.projectedRows.views).to.have.length(4); expect(renderer.resources.bytes).to.be.at.most(renderer.resources.budgetBytes);
    expect(await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world))).to.equal(before);
    renderer.workstationLayout = createProcgenLaneProjection({ laneCount: 8, height: 450 }); expect(renderer.render(true)).to.equal(true); expect(renderer.projectedRows.views).to.have.length(0);
    renderer.dispose(); expect(renderer.resources.bytes).to.equal(0);
  });
  it('publishes a completed actor index before drawing without running sprite bounds in the physical tick', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), laneCount: 8 });
    const renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: { groundPieces: [] }, windowRef: { devicePixelRatio: 1, performance } });
    const before = renderer.actorVisibility.getStats();
    world.step();
    const published = renderer.actorVisibility.getStats();
    expect(published.publications).to.equal(before.publications + 1);
    expect(published.rebuilds).to.equal(before.rebuilds);
    renderer.render(false);
    expect(renderer.actorVisibility.getStats().rebuilds).to.equal(before.rebuilds + 1);
    renderer.dispose(); world.dispose();
  });
  it('allocates only a visible buffer and does not draw 1024 offscreen actors', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), laneCount: 1024 });
    const canvas = canvasFixture();
    const renderer = new ProcgenLaneRenderer({ canvas, world, assets: { groundPieces: [] }, windowRef: { devicePixelRatio: 1, performance } });
    renderer.render();
    expect(renderer.image.data.length).to.equal(300 * 150 * 4);
    expect(renderer.renderedActors).to.equal(2);
    renderer.cameraY = 1000000; renderer.render(); expect(renderer.renderedActors).to.be.lessThan(4);
    renderer.dispose(); expect(canvas.listeners.size).to.equal(0);
  });
  it('reuses visibility buckets while panning a paused high-lane world and invalidates after real actor motion', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), laneCount: 1024, laneHeight: 144 });
    const canvas = canvasFixture(), renderer = new ProcgenLaneRenderer({ canvas, world, assets: { groundPieces: [] }, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false; renderer.render(false); const builds = renderer.actorVisibility.rebuilds;
    for (let row = 1; row < 40; row++) renderer.camera.pan(0, 144 * 3);
    expect(renderer.actorVisibility.rebuilds).to.equal(builds); expect(renderer.actorVisibility.candidates.length).to.be.lessThan(5);
    world.actors[0].y = renderer.originY + 40; world.tickIndex++; renderer.render(false);
    expect(renderer.actorVisibility.rebuilds).to.equal(builds + 1); expect(renderer.actorVisibility.candidates).to.include(world.actors[0]);
    renderer.dispose(); expect(renderer.actorVisibility.bounds.size).to.equal(0); world.dispose();
  });
  it('draws uncached particle colors and opacity after actors vanish with world-coordinate culling', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), laneCount: 2 });
    world.actors.length = 0;
    world.characterParticles = new CharacterParticles();
    const canvas = canvasFixture();
    const renderer = new ProcgenLaneRenderer({ canvas, world, assets: { groundPieces: [] }, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false; renderer.cameraX = 100;
    const red = world.characterParticles._spawn(1, 'terrain');
    Object.assign(red, { x: 110, y: 40, color: 0xff0000ff, age: 17 });
    const blue = world.characterParticles._spawn(2, 'terrain');
    Object.assign(blue, { x: 120, y: 40, color: 0xffff0000 });
    const hidden = world.characterParticles._spawn(3, 'terrain');
    Object.assign(hidden, { x: 100000, y: 40, color: 0xff00ff00 });
    renderer.render();
    expect(canvas.pixels).to.have.length(2);
    expect(canvas.pixels.map(p => p.color)).to.have.members(['rgb(255,0,0)', 'rgb(0,0,255)']);
    expect(canvas.pixels.find(p => p.x === 10).alpha).to.be.greaterThan(0).and.lessThan(1);
    expect(canvas.pixels.find(p => p.x === 20).alpha).to.equal(1);
    expect(renderer.bufferContext.globalAlpha).to.equal(1);
    expect(world.characterParticles.frame).to.equal(0);
    renderer.dispose(); world.dispose();
  });
  it('keeps cross-stripe cosmetic presentations visible once without allocating unbounded row memberships', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), laneCount: 64, laneHeight: 144 }), canvas = canvasFixture();
    const renderer = new ProcgenLaneRenderer({ canvas, world, assets: { groundPieces: [] }, windowRef: { devicePixelRatio: 1, performance } }); renderer.follow = false;
    const actor = world.actors[63]; actor.x = 10000; let draws = 0;
    actor.action = { spriteProvider: { getActorDrawBounds: () => ({ x: 10, y: 10, width: 16, height: 22 }) } }; actor.render = () => draws++;
    renderer.render(); expect(draws).to.equal(1); expect(renderer.actorVisibility.wide).to.include(actor);
    renderer.actorVisibility.query(0, world.height); expect(renderer.actorVisibility.candidates.filter(value => value === actor)).to.have.length(1);
    actor.removed = true; world.tickIndex++; renderer.render(false); expect(draws).to.equal(1); expect(renderer.actorVisibility.bounds.has(actor)).to.equal(false); renderer.dispose(); world.dispose();
  });
  it('retains visible cosmetic bounds outside the cheap simulation-position gate', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks() }), canvas = canvasFixture();
    const renderer = new ProcgenLaneRenderer({ canvas, world, assets: { groundPieces: [] }, windowRef: { devicePixelRatio: 1, performance } });
    renderer.follow = false;
    const actor = world.actors[0]; actor.x = 10000;
    let bounds = { x: 10, y: 10, width: 16, height: 22 }, draws = 0;
    actor.action = { spriteProvider: { getActorDrawBounds: () => bounds } }; actor.render = () => draws++;
    renderer.render(); expect(draws).to.equal(1);
    bounds = { x: 20000, y: 10, width: 16, height: 22 }; world.tickIndex++; renderer.render(); expect(draws).to.equal(1);
    bounds = null; world.tickIndex++; renderer.render(); expect(draws).to.equal(1);
    renderer.dispose(); world.dispose();
  });

  it('draws prior-run distance as screen-space black/white ants with paused and reduced-motion stability', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), laneCount: 2, previousDistances: [100, 0] });
    const canvas = canvasFixture(), context = canvas.getContext('2d'), strokes = [], paths = [];
    context.save = () => {}; context.restore = () => {};
    context.moveTo = (x, y) => paths.push(['start', x, y]); context.lineTo = (x, y) => paths.push(['end', x, y]);
    context.setLineDash = dash => { context.dash = dash.slice(); };
    context.stroke = () => strokes.push({ color: context.strokeStyle, width: context.lineWidth, dash: context.dash, offset: context.lineDashOffset || 0 });
    const renderer = new ProcgenLaneRenderer({ canvas, world, assets: {}, windowRef: { devicePixelRatio: 1, performance } });
    renderer.viewWidth = 300; renderer.viewHeight = 150; renderer.originX = renderer.originY = 0;
    world.tickIndex = 4; const dash = renderer.markerDash;
    renderer._drawPreviousDistances(1);
    expect(paths).to.deep.equal([['start', 408, 0], ['end', 408, 288]]);
    expect(strokes[0]).to.include({ color: '#000', width: 2 }); expect(strokes[0].dash).to.deep.equal([]);
    expect(strokes[1]).to.include({ color: '#fff', width: 1, offset: -2 }); expect(strokes[1].dash).to.deep.equal([4, 4]);
    renderer._drawPreviousDistances(1); expect(strokes[3].offset).to.equal(-2);
    world.tickIndex = 6; renderer._drawPreviousDistances(1); expect(strokes[5].offset).to.equal(-3);
    renderer.reducedMotion = { matches: true }; renderer._drawPreviousDistances(2);
    expect(strokes[7]).to.include({ width: 2, offset: 0 }); expect(strokes[7].dash).to.deep.equal([8, 8]);
    expect(renderer.markerDash).to.equal(dash); expect(world.stall.lanes[0].previousDistance).to.equal(100);
    renderer.dispose(); world.dispose();
  });

});


describe('deferred candidate presentation', () => {
  it('owns a prepared world without drawing, ticking, binding canvas gestures or scheduling animation', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), laneCount: 4 }), canvas = canvasFixture(), callbacks = new Map(), visible = new Set(); let next = 0;
    const windowRef = { document: { hidden: false, addEventListener: (event, fn) => visible.add(fn), removeEventListener: (event, fn) => visible.delete(fn) }, performance, devicePixelRatio: 1,
      requestAnimationFrame: fn => { callbacks.set(++next, fn); return next; }, cancelAnimationFrame: id => callbacks.delete(id) };
    const runtime = createProcgenLaneRuntime({ canvas, initialWorld: world, assets: { groundPieces: [] }, windowRef, initiallySuspended: true });
    expect(runtime.getOperationalState()).to.deep.equal({ paused: true, activated: false, running: true, clockDriven: false });
    const initial = { tick: world.tickIndex, width: canvas.width, height: canvas.height };
    expect(runtime.isActivated()).to.equal(false); expect(callbacks.size).to.equal(0); expect(canvas.listeners.size).to.equal(0); expect(visible.size).to.equal(0);
    runtime.setClockDriven(true); runtime.pump(1000); world.render(); runtime.resize(); expect(runtime.resume()).to.equal(false); expect(() => runtime.step()).to.throw('before publication');
    expect(world.tickIndex).to.equal(initial.tick); expect(canvas.pixels).to.have.length(0); expect(canvas.width).to.equal(initial.width); expect(canvas.height).to.equal(initial.height);
    expect(runtime.activate()).to.equal(true); expect(runtime.activate()).to.equal(true); expect(callbacks.size).to.equal(1); expect(canvas.listeners.has('pointerdown')).to.equal(true); expect(visible.size).to.equal(1);
    runtime.pump(1000); runtime.pump(1100); expect(world.tickIndex).to.equal(initial.tick); runtime.resume();
    expect(runtime.getOperationalState()).to.deep.equal({ paused: false, activated: true, running: true, clockDriven: true });
    runtime.pump(1200); runtime.pump(1300); expect(world.tickIndex).to.be.greaterThan(initial.tick);
    const receipt = runtime.stop(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(callbacks.size).to.equal(0); expect(canvas.listeners.size).to.equal(0); expect(visible.size).to.equal(0);
  });
  it('cancels an unpublished candidate without changing the live canvas backing size', async () => {
    const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), laneCount: 4 }), canvas = canvasFixture();
    const runtime = createProcgenLaneRuntime({ canvas, initialWorld: world, assets: { groundPieces: [] }, initiallySuspended: true,
      windowRef: { document: { hidden: false }, performance, devicePixelRatio: 1, requestAnimationFrame() { throw new Error('Candidate scheduled animation.'); }, cancelAnimationFrame() {} } });
    const size = [canvas.width, canvas.height], receipt = runtime.stop(); await receipt.completion;
    expect(receipt.outcome).to.equal('complete'); expect([canvas.width, canvas.height]).to.deep.equal(size); expect(canvas.pixels).to.have.length(0); expect(canvas.listeners.size).to.equal(0);
  });
});
