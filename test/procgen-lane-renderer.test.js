import { expect } from 'chai';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
const canvasFixture = () => {
  const context = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {}, drawImage() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const ownerDocument = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) };
  const listeners = new Map();
  return { width: 900, height: 450, ownerDocument, getContext: () => context,
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
});
