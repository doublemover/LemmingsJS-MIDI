import { expect } from 'chai';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { selectCctvLanes, cctvLayout } from '../js/app/procgen/ProcgenCctv.js';
const fixture = (count = 64) => {
  let now = 0;
  const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, drawImage() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, save() {}, restore() {} };
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  const canvas = { width: 900, height: 600, clientWidth: 900, clientHeight: 600, ownerDocument: document, getContext: () => context, addEventListener() {}, removeEventListener() {} };
  const world = { laneCount: count, height: count * 96, generation: 1, tickIndex: 0, terrainRevision: 0, frontierRevision: 0, laneSeeds: new Uint32Array(count), groundColorAt: () => 0,
    stall: { lanes: Array.from({ length: count }, (_, i) => ({ maxX: 36 + i * 100, previousDistance: 0 })) }, actors: [] };
  world.actors = Array.from({ length: count }, (_, laneIndex) => ({ id: laneIndex, laneIndex, x: 36 + laneIndex * 100, y: laneIndex * 96 + 64, render() {} }));
  const renderer = new ProcgenLaneRenderer({ canvas, world, assets: { groundPieces: [] }, windowRef: { devicePixelRatio: 1, performance: { now: () => now } } });
  return { renderer, world, canvas, advance: ms => { now += ms; } };
};
describe('bounded live procgen CCTV', () => {
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
    expect(renderer.buffer.height).to.equal(372); expect(renderer.cctv.refreshes).to.equal(1);
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
  it('fits responsive tiles within the reserved area', () => {
    for (const width of [390, 900]) for (const count of [1, 3, 8]) {
      const layout = cctvLayout(width, 600, count); expect(layout.bandHeight).to.be.at.most(228);
      expect(layout.tileHeight * layout.rows + 24).to.equal(layout.bandHeight);
    }
  });
});
