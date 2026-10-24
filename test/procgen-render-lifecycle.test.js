import { expect } from 'chai';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { createProcgenLaneRuntime } from '../js/app/procgen/ProcgenLaneRuntime.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { ProcgenRenderResources } from '../js/app/procgen/ProcgenRenderResources.js';

const fixture = (options = {}) => {
  let now = 0;
  const canvases = [], callbacks = new Map(), documentListeners = new Map();
  const document = { hidden: false, createElement() {
    if (options.creationFailure || options.creationFailureAt === canvases.length) throw new Error('Injected canvas creation failure');
    const listeners = new Map(), context = { globalAlpha: 1, createImageData(w, h) {
      if (options.allocationFailure || w > (options.maxImageWidth || Infinity)) throw new Error('Injected image allocation failure');
      return { data: new Uint8ClampedArray(w * h * 4) };
    }, putImageData() {}, drawImage() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
    const canvas = { width: 600, height: 300, ownerDocument: document, dataset: {}, context, listeners,
      getContext: () => options.nullContext === canvases.indexOf(canvas) ? null : context,
      addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
    canvases.push(canvas); return canvas;
  }, addEventListener: (type, fn) => documentListeners.set(type, fn), removeEventListener: type => documentListeners.delete(type) };
  const canvas = document.createElement('canvas');
  const windowRef = { document, devicePixelRatio: 1, performance: { now: () => now }, requestAnimationFrame(fn) {
    if (options.rafFailure) throw new Error('Injected frame registration failure');
    const id = callbacks.size + 1; callbacks.set(id, fn); return id;
  }, cancelAnimationFrame: id => callbacks.delete(id) };
  const world = { laneCount: 1, laneHeight: 96, height: 96, tickIndex: 0, generation: 1, terrainRevision: 0, frontierRevision: 0,
    laneSeeds: [1], generatedThrough: [128], actors: [], activeCount: 0, groundColorAt: () => 0, timer: { speedFactor: 1 },
    stall: { lanes: [{ maxX: 36, previousDistance: 0 }] }, getDebugState: () => ({}), step() { this.tickIndex++; }, dispose() { this.disposals = (this.disposals || 0) + 1; } };
  const renderer = options.runtime ? null : new ProcgenLaneRenderer({ canvas, world, assets: { groundPieces: [] }, windowRef, renderBudget: options.renderBudget });
  return { renderer, canvas, canvases, callbacks, documentListeners, world, windowRef, advance: time => { now += time; } };
};

describe('ProcGen display resource lifecycle', () => {
  it('contains null contexts in every initial surface and retires even before a first frame', () => {
    for (let index = 0; index < 4; index++) {
      const options = { nullContext: index }, { renderer, canvases } = fixture(options);
      expect(renderer.getDisplayState().state).to.equal('recovering');
      expect(renderer.render()).to.equal(false);
      options.nullContext = -1; expect(renderer.recover()).to.equal(true); expect(renderer.render()).to.equal(true);
      const lateRestore = renderer.contextListeners.find(([type]) => type === 'contextrestored')[1];
      renderer.dispose(); renderer.dispose(); lateRestore();
      expect(renderer.render()).to.equal(false); expect(renderer.resize()).to.equal(false); expect(renderer.recover()).to.equal(false);
      expect(renderer.getDisplayState()).to.include({ state: 'disposed', estimatedBytes: 0, backingStores: 0 });
      expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0 && canvas.listeners.size === 0)).to.equal(true);
      expect(renderer.world).to.equal(null); expect(renderer.assets).to.equal(null); expect(renderer.onWorkstationFrame).to.equal(null);
    }
  });

  it('reduces raster allocation after a failure without changing physical state', () => {
    const options = { maxImageWidth: 150 }, { renderer, world, advance } = fixture(options);
    expect(renderer.render()).to.equal(false); expect(renderer.getDisplayState().state).to.equal('recovering');
    advance(250); expect(renderer.render(false)).to.equal(true);
    expect(renderer.buffer.width).to.equal(96); expect(renderer.getDisplayState()).to.include({ state: 'ready', attempts: 1, qualityDivisor: 2 });
    expect(world.tickIndex).to.equal(0); expect(world.actors).to.deep.equal([]); renderer.dispose();
  });

  it('bounds retries, handles context loss, and requires an explicit retry after exhaustion', () => {
    const options = { allocationFailure: true }, { renderer, canvas, advance } = fixture(options);
    renderer.render();
    for (let attempt = 0; attempt < 3; attempt++) { advance(5000); renderer.render(); }
    expect(renderer.getDisplayState().state).to.equal('unavailable');
    options.allocationFailure = false; advance(5000); expect(renderer.render()).to.equal(false);
    expect(renderer.recover()).to.equal(true); expect(renderer.render()).to.equal(true);
    let prevented = false; canvas.listeners.get('contextlost')({ preventDefault: () => { prevented = true; } });
    expect(prevented).to.equal(true); expect(renderer.getDisplayState()).to.include({ state: 'lost', estimatedBytes: 0 });
    canvas.listeners.get('contextrestored')(); expect(renderer.render()).to.equal(true); renderer.dispose();
  });

  it('contains a workstation callback failure while the runtime continues requesting frames', () => {
    const { canvas, world, windowRef, callbacks } = fixture({ runtime: true });
    const runtime = createProcgenLaneRuntime({ canvas, assets: { groundPieces: [] }, initialWorld: world, windowRef });
    runtime.renderer.workstationLayout = { firstLane: 0, count: 1, rowHeight: 96, stripHeight: 0 };
    runtime.renderer.onWorkstationFrame = () => { throw new Error('Injected frame callback failure'); };
    expect(() => callbacks.get(1)(0)).not.to.throw();
    expect(callbacks.size).to.equal(2); expect(runtime.renderer.getDisplayState().state).to.equal('recovering');
    expect(world.tickIndex).to.equal(0); runtime.stop();
  });

  it('releases construction resources and provider leases when initial frame registration throws', () => {
    const { canvas, canvases, world, windowRef, documentListeners } = fixture({ runtime: true, rafFailure: true });
    let releases = 0;
    expect(() => createProcgenLaneRuntime({ canvas, assets: { groundPieces: [] }, initialWorld: world, windowRef,
      resourceLease: { release: () => releases++ } })).to.throw('Injected frame registration failure');
    expect(world.disposals).to.equal(1); expect(releases).to.equal(1); expect(documentListeners.size).to.equal(0);
    expect(canvases.every(surface => surface.width === 0 && surface.height === 0 && surface.listeners.size === 0)).to.equal(true);
  });

  it('preserves accounted visual profile intent through display loss while retiring effect histories', () => {
    const { renderer, canvas } = fixture(); renderer.actorEffects.setProfile({ version: 1, enabled: true, bindings: [] }); renderer.render();
    const profile = renderer.actorEffects.getConfiguration(); canvas.listeners.get('contextlost')({ preventDefault() {} });
    expect(renderer.actorEffects.getConfiguration()).to.deep.equal(profile); expect(renderer.getDisplayState().estimatedBytes).to.equal(4096);
    expect(renderer.actorEffects.visible).to.equal(false); renderer.recover(); renderer.render();
    expect(renderer.actorEffects.getConfiguration()).to.deep.equal(profile); expect(renderer.actorEffects.visible).to.equal(true);
    renderer.dispose(); expect(renderer.getDisplayState().estimatedBytes).to.equal(0);
  });
  it('keeps live backing estimates bounded through 100 resize and retirement cycles', () => {
    for (let cycle = 0; cycle < 100; cycle++) {
      const { renderer, canvas, canvases, world } = fixture({ renderBudget: { budgetBytes: 512 * 1024, cacheBytes: 128 * 1024 } });
      canvas.width = 1200; canvas.height = 800; renderer.render();
      expect(renderer.getDisplayState().estimatedBytes).to.be.at.most(512 * 1024);
      expect(canvas.width).to.be.lessThan(1200);
      expect(world.tickIndex).to.equal(0); renderer.dispose();
      expect(renderer.getDisplayState().estimatedBytes).to.equal(0);
      expect(canvases.every(surface => surface.width === 0 && surface.height === 0)).to.equal(true);
    }
  });

  it('retires the least recently used sprite backing store and forwards shared accounting hooks', () => {
    const { canvas } = fixture(), reservations = new Map();
    const resources = new ProcgenRenderResources(canvas.ownerDocument, { budgetBytes: 4096, cacheBytes: 1024,
      budgetAdapter: { reserve: ({ token, bytes }) => reservations.set(token, bytes), release: ({ token }) => reservations.delete(token) } });
    const first = resources.canvas(), second = resources.canvas();
    resources.resize(first, 16, 16, { cache: true }); resources.resize(second, 16, 16, { cache: true });
    expect(first.width).to.equal(0); expect(second.width).to.equal(16); expect(resources.getStats().evictions).to.equal(1);
    resources.dispose(); expect(second.width).to.equal(0); expect(reservations.size).to.equal(0);
  });

  it('keeps strict shared replacement accounting after uncertain canvas retirement and reuse', () => {
    const { canvas } = fixture(), budget = createResourceBudget({ limitBytes: 16384, costFactors: { other: 1 } });
    const resources = new ProcgenRenderResources(canvas.ownerDocument, { budgetAdapter: budget }), backing = resources.canvas();
    resources.resize(backing, 16, 16); let reject = true, width = 16, height = 16;
    Object.defineProperty(backing, 'width', { get: () => width, set: value => { if (reject) throw new Error('Width unavailable'); width = value; } });
    Object.defineProperty(backing, 'height', { get: () => height, set: value => { if (reject) throw new Error('Height unavailable'); height = value; } });
    resources.release(backing); expect(budget.diagnostics().residentBytes).to.equal(1024);
    reject = false; resources.resize(backing, 8, 8);
    expect(budget.diagnostics().residentBytes).to.equal(256); expect(resources.getStats().estimatedBytes).to.equal(256);
    resources.dispose(); expect(budget.diagnostics().residentBytes).to.equal(0);
  });

  it('protects the current cache token when shared admission reenters the renderer evictor', () => {
    const { canvas } = fixture(), budget = createResourceBudget({ limitBytes: 4096, costFactors: { other: 1 } });
    const resources = new ProcgenRenderResources(canvas.ownerDocument, { budgetBytes: 16384, budgetAdapter: budget });
    const first = resources.canvas(), second = resources.canvas();
    resources.resize(first, 16, 16, { cache: true }); resources.resize(second, 16, 16, { cache: true });
    const other = {}; budget.reserve({ token: other, owner: 'assets', bytes: 1300 });
    const unregister = budget.registerEvictor('renderer-test', () => resources.clearCaches());
    resources.resize(first, 32, 16, { cache: true });
    expect(first.width).to.equal(32); expect(second.width).to.equal(0);
    expect(resources.getStats()).to.include({ estimatedBytes: 2048, cachedBitmapBytes: 2048 });
    expect(budget.diagnostics().residentBytes).to.equal(3348);
    resources.dispose(); unregister(); budget.release({ token: other, owner: 'assets' }); expect(budget.diagnostics().residentBytes).to.equal(0);
  });

  it('attempts both dimensions and every remaining surface when one retirement setter rejects zero', () => {
    const { renderer, canvases } = fixture(); renderer.render();
    const width = renderer.buffer.width;
    Object.defineProperty(renderer.buffer, 'width', { get: () => width, set: () => { throw new Error('Injected retirement setter failure'); } });
    expect(() => renderer.dispose()).not.to.throw();
    expect(renderer.getDisplayState()).to.include({ state: 'disposed', estimatedBytes: 0, unreleasedEstimatedBytes: 0 });
    expect(renderer.getDisplayState().retirementFailures).to.be.greaterThan(0);
    expect(canvases.every(surface => surface.width === 0 || surface.height === 0)).to.equal(true);
    expect(canvases.every(surface => surface.listeners.size === 0)).to.equal(true); expect(renderer.world).to.equal(null);
  });

  it('reports a backing store whose browser refuses both retirement dimensions', () => {
    const { canvas } = fixture(), reservations = new Map(), updates = [];
    const resources = new ProcgenRenderResources(canvas.ownerDocument, { budgetAdapter: {
        reserve: receipt => { reservations.set(receipt.token, receipt.bytes); updates.push(receipt); }, release: ({ token }) => reservations.delete(token)
      } }), backing = resources.canvas();
    resources.resize(backing, 16, 16);
    for (const dimension of ['width', 'height']) Object.defineProperty(backing, dimension, { get: () => 16, set: () => { throw new Error('Injected total retirement failure'); } });
    expect(() => resources.dispose()).not.to.throw();
    expect(resources.getStats()).to.include({ estimatedBytes: 1024, unreleasedEstimatedBytes: 1024, backingStores: 0, retirementFailures: 2 });
    expect(reservations.get(backing)).to.equal(1024); expect(updates.at(-1).unreleased).to.equal(true);
  });

  it('cleans partial renderer construction after an owned canvas cannot be created', () => {
    const { canvas, canvases, world, windowRef } = fixture({ runtime: true, creationFailureAt: 2 });
    let released = 0;
    expect(() => createProcgenLaneRuntime({ canvas, assets: { groundPieces: [] }, initialWorld: world, windowRef,
      resourceLease: { release: () => released++ } })).to.throw('Injected canvas creation failure');
    expect(world.disposals).to.equal(1); expect(released).to.equal(1);
    expect(canvases.every(surface => surface.width === 0 && surface.height === 0 && surface.listeners.size === 0)).to.equal(true);
  });

  it('passes shared render reservations through runtime creation and retires them on stop', () => {
    const { canvas, world, windowRef } = fixture({ runtime: true }), reservations = new Map();
    const runtime = createProcgenLaneRuntime({ canvas, assets: { groundPieces: [] }, initialWorld: world, windowRef, renderBudget: {
      budgetAdapter: { reserve: ({ token, bytes }) => reservations.set(token, bytes), release: ({ token }) => reservations.delete(token) }
    } });
    runtime.renderer.render(); expect([...reservations.values()].reduce((sum, bytes) => sum + bytes, 0)).to.be.greaterThan(0);
    runtime.stop(); expect(reservations.size).to.equal(0);
  });

  it('preserves the last presented frame until a physical tick finishes', () => {
    const { renderer, world } = fixture(); renderer.render(); const frame = renderer.lastFrameKey, allocations = renderer.resources.allocations;
    world._musicCompletedTick = world.tickIndex; world.tickIndex++; world._stepping = true;
    expect(renderer.render()).to.equal(false); expect(renderer.lastFrameKey).to.equal(frame); expect(renderer.resources.allocations).to.equal(allocations);
    world._musicCompletedTick = world.tickIndex; expect(renderer.render()).to.equal(true); renderer.dispose();
  });
});
