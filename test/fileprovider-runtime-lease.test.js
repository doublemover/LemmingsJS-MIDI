import assert from 'node:assert/strict';
import { FileProvider } from '../js/data/FileProvider.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { createProcgenLaneRuntime } from '../js/app/procgen/ProcgenLaneRuntime.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const canvasFixture = () => {
  const context = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    drawImage() {}, putImageData() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  return { width: 320, height: 200, ownerDocument: { createElement: () => canvasFixture() },
    getContext: () => context, addEventListener() {}, removeEventListener() {} };
};

describe('FileProvider runtime lease transfer', () => {
  it('keeps prepared resources alive and releases the final lease after another retirement step fails', async () => {
    const masks = await loadProcgenMasks();
    const provider = new FileProvider('/', { indexedDB: null, localStorage: null });
    const resourceLease = provider.acquireLease(), world = new ProcgenLaneWorld({ masks, laneCount: 1 });
    const windowRef = { performance, devicePixelRatio: 1,
      document: { hidden: false, addEventListener() {}, removeEventListener() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
    const runtime = createProcgenLaneRuntime({ initialWorld: world, canvas: canvasFixture(), resources: { fileProvider: provider },
      resourceLease, masks, assets: { groundPieces: [] }, windowRef });
    provider.dispose();
    assert.equal(provider._disposed, false); assert.equal(provider.getCacheStats().resourceLeases, 1);
    const originalDispose = world.dispose.bind(world);
    world.dispose = () => { originalDispose(); throw new Error('Injected sibling cleanup failure'); };
    const receipt = runtime.stop();
    await receipt.completion;
    assert.equal(receipt.resources.find(resource => resource.name === 'world').status, 'failed');
    assert.equal(receipt.resources.find(resource => resource.name === 'asset-provider-lease').status, 'completed');
    assert.equal(provider._disposed, true); assert.equal(provider.getCacheStats().resourceLeases, 0);
    assert.equal(runtime.stop(), receipt);
  });
});
