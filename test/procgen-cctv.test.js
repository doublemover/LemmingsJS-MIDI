import { expect } from 'chai';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { selectCctvLanes, cctvLayout } from '../js/app/procgen/ProcgenCctv.js';
const fixture = (count = 64, enabled = true) => {
  let now = 0;
  const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, drawImage() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, save() {}, restore() {} };
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  const canvas = { width: 900, height: 600, clientWidth: 900, clientHeight: 600, ownerDocument: document, getContext: () => context, addEventListener() {}, removeEventListener() {} };
  const world = { laneCount: count, height: count * 96, generation: 1, tickIndex: 0, terrainRevision: 0, frontierRevision: 0, laneSeeds: new Uint32Array(count), groundColorAt: () => 0,
    stall: { lanes: Array.from({ length: count }, (_, i) => ({ maxX: 36 + i * 100, previousDistance: 0 })) }, actors: [] };
  world.actors = Array.from({ length: count }, (_, laneIndex) => ({ id: laneIndex, laneIndex, x: 36 + laneIndex * 100, y: laneIndex * 96 + 64, render() {} }));
  const renderer = new ProcgenLaneRenderer({ canvas, world, assets: { groundPieces: [] }, windowRef: { devicePixelRatio: 1, performance: { now: () => now } } });
  if (enabled) renderer.cctv.setEnabled(true);
  return { renderer, world, canvas, advance: ms => { now += ms; } };
};
describe('bounded live procgen CCTV', () => {
  it('starts disabled and avoids overview scans while retaining deliberate pins', () => {
    const { renderer } = fixture(64, false); renderer.camera.setZoom(0);
    expect(renderer.cctv.getState().enabled).to.equal(false); expect(renderer.overviewBandHeight).to.equal(0);
    expect(renderer.cctv.actorScans).to.equal(0); expect(renderer.cctv.views.size).to.equal(0);
    renderer.cctv.setPins([3]); renderer.cctv.setEnabled(true); expect(renderer.cctv.views.size).to.equal(8);
    renderer.cctv.setEnabled(false); expect(renderer.overviewBandHeight).to.equal(0); expect(renderer.cctv.getState().pins).to.deep.equal([3]); renderer.dispose();
  });
  it('keeps deterministic ranks and stable slots until an outsider establishes a lead', () => {
    const { world, renderer } = fixture(10);
    const initial = selectCctvLanes(world); expect(initial).to.deep.equal([9, 8, 7, 6, 5, 4, 3, 2]);
    world.stall.lanes[1].maxX = world.stall.lanes[2].maxX + 1; expect(selectCctvLanes(world, initial)).to.deep.equal(initial);
    world.stall.lanes[1].maxX += 24; expect(selectCctvLanes(world, initial)).to.deep.equal([9, 8, 7, 6, 5, 4, 3, 1]);
    renderer.dispose();
  });
  it('reserves the lower band, caps buffers and refresh cadence, and never advances the world', () => {
    const { renderer, world, advance } = fixture(); renderer.camera.setZoom(0);
    expect(renderer.overviewActive).to.equal(true); expect(renderer.cctv.views.size).to.equal(8);
    expect(renderer.camera.viewport().height).to.be.closeTo(world.height, 1e-7);
    expect(renderer.buffer.height).to.equal(Math.ceil(600 - renderer.cctv.layout.bandHeight)); expect(renderer.cctv.refreshes).to.equal(1);
    for (const view of renderer.cctv.views.values()) { expect(view.buffer.width).to.equal(128); expect(view.buffer.height).to.be.at.most(64); expect(view.drawn).to.equal(1); }
    expect(world.tickIndex).to.equal(0); const scans = renderer.cctv.actorScans;
    renderer.render(false); expect(renderer.cctv.actorScans).to.equal(scans);
    world.tickIndex++; advance(50); renderer.render(false); expect(renderer.cctv.refreshes).to.equal(1);
    advance(50); renderer.render(false); expect(renderer.cctv.refreshes).to.equal(2); expect(world.tickIndex).to.equal(1);
    advance(500); renderer.render(false); expect(renderer.cctv.refreshes).to.equal(2);
    renderer.camera.setZoom(renderer.scale * 1.1); expect(renderer.overviewActive).to.equal(false); expect(renderer.overviewBandHeight).to.equal(0); renderer.dispose();
  });
  it('handles fewer lanes, no live actors, resize, generation resets and disposal', () => {
    const { renderer, world, canvas, advance } = fixture(3); world.actors = []; renderer.camera.setZoom(0);
    expect(renderer.cctv.slots).to.have.length(3); expect([...renderer.cctv.views.values()].every(view => view.leaderId == null)).to.equal(true);
    canvas.width = canvas.clientWidth = 390; renderer.resize(); expect(renderer.cctv.layout.columns).to.equal(2);
    world.generation++; advance(100); renderer.render(false); expect(renderer.cctv.generation).to.equal(2);
    renderer.dispose(); expect(renderer.cctv.views.size).to.equal(0);
  });
  it('provides a true eight-leader override and keeps Director pins across the mode change', () => {
    const { renderer } = fixture(); renderer.camera.setZoom(0);
    renderer.cctv.setMode('director'); renderer.cctv.togglePin(0);
    expect(renderer.cctv.slots).to.include(0);
    renderer.cctv.setMode('leaders'); expect(renderer.cctv.slots).to.deep.equal([63, 62, 61, 60, 59, 58, 57, 56]);
    expect(renderer.cctv.getState().pins).to.deep.equal([0]);
    renderer.cctv.setMode('director'); expect(renderer.cctv.slots).to.include(0); renderer.dispose();
  });
  it('draws actual buffers at one uniform scale and follows the live leader independently of primary zoom', () => {
    const { renderer, world, canvas, advance } = fixture();
    canvas.width = canvas.clientWidth = 1440; canvas.height = canvas.clientHeight = 960; renderer.resize(); renderer.camera.setZoom(0);
    expect(renderer.cctv.layout.bandHeight).to.equal(436);
    expect(renderer.cctv.layout.tileHeight - 30).to.equal(176);
    const draws = [], context = { save() {}, restore() {}, fillRect() {}, fillText() {},
      drawImage(buffer, x, y, width, height) { draws.push({ buffer, x, y, width, height }); } };
    renderer.cctv.draw(context, 1);
    expect(draws).to.have.length(8);
    for (const draw of draws) {
      expect(draw.width / draw.buffer.width).to.equal(draw.height / draw.buffer.height);
      expect(draw.width / draw.height).to.equal(draw.buffer.width / draw.buffer.height);
      expect(draw.height).to.equal(176); expect(draw.buffer.height).to.equal(64);
      expect(draw.y + draw.height).to.be.at.most(960);
    }
    const lane = renderer.cctv.slots[0], actor = world.actors[lane], view = renderer.cctv.views.get(lane);
    actor.x += 100; world.stall.lanes[lane].maxX = actor.x; world.tickIndex++; advance(100); renderer.render(false);
    expect(view.leaderId).to.equal(actor.id); expect(actor.x).to.be.within(view.originX, view.originX + view.viewWidth);
    expect(actor.y).to.be.within(view.originY, view.originY + view.viewHeight);
    renderer.camera.setZoom(6); renderer.camera.followFrontier();
    const primary = renderer.camera.viewport();
    expect(renderer.overviewActive).to.equal(false);
    expect(actor.x).to.be.within(renderer.cameraX, renderer.cameraX + primary.width);
    expect(actor.y).to.be.within(renderer.cameraY, renderer.cameraY + primary.height);
    renderer.camera.setZoom(0); expect(renderer.overviewActive).to.equal(true);
    expect(renderer.cctv.views.size).to.equal(8); renderer.dispose();
  });
  it('contains rounded or capped rasters without distortion and preserves paused buffer reuse', () => {
    const { renderer, canvas, advance } = fixture(); renderer.camera.setZoom(0);
    for (const [width, height, dpr] of [[390, 600, 1], [901, 603, 1], [1441, 959, 2]]) {
      renderer.window.devicePixelRatio = dpr;
      canvas.clientWidth = width; canvas.clientHeight = height; canvas.width = width * dpr; canvas.height = height * dpr;
      advance(100); renderer.resize(); renderer.camera.setZoom(0);
      const layout = renderer.cctv.layout, draws = [];
      renderer.cctv.draw({ save() {}, restore() {}, fillRect() {}, fillText() {}, drawImage(...args) { draws.push(args); } }, dpr);
      for (const [buffer, , , drawWidth, drawHeight] of draws) {
        expect(drawWidth / buffer.width).to.be.closeTo(drawHeight / buffer.height, 1e-10);
        expect(drawWidth).to.be.at.most((layout.tileWidth - 8) * dpr + 1e-10);
        expect(drawHeight).to.be.at.most((layout.tileHeight - 30) * dpr + 1e-10);
        expect(buffer.width).to.equal(128); expect(buffer.height).to.be.within(32, 64);
      }
      const refreshes = renderer.cctv.refreshes, scans = renderer.cctv.actorScans;
      advance(500); renderer.render(false);
      expect(renderer.cctv.refreshes).to.equal(refreshes); expect(renderer.cctv.actorScans).to.equal(scans);
    }
    renderer.dispose();
  });
  it('fits responsive tiles within the reserved area', () => {
    for (const width of [390, 900]) for (const count of [1, 3, 8]) {
      const layout = cctvLayout(width, 600, count); expect(layout.bandHeight).to.be.at.most(312);
      expect(layout.tileHeight * layout.rows + 24).to.equal(layout.bandHeight);
    }
  });
});
