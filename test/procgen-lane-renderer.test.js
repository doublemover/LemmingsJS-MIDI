import { expect } from 'chai';
import { CharacterParticles } from '../js/lemmings/CharacterParticles.js';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
const canvasFixture = () => {
  const pixels = [];
  const context = { globalAlpha: 1, fillRect(x, y, w, h) { pixels.push({ x, y, w, h, color: this.fillStyle, alpha: this.globalAlpha }); }, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {}, drawImage() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const ownerDocument = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) };
  const listeners = new Map();
  return { width: 900, height: 450, ownerDocument, pixels, getContext: () => context,
    addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event), listeners };
};
describe('bounded shared-lane renderer', () => {
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
});
