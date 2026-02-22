import { expect } from 'chai';
import { useGlobalLemmings } from './helpers/lemmings.js';
import { DisplayImage } from '../js/render/DisplayImage.js';

class SimpleImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class MockStage {
  createImage(_display, width, height) {
    return new SimpleImageData(width, height);
  }
}

describe('DisplayImage dirty rect tracking', function () {
  useGlobalLemmings({});

  it('coalesces touching dirty rects into one update region', function () {
    const display = new DisplayImage(new MockStage());
    display.initSize(20, 10);

    display.consumeDirtyRects();
    display.markDirtyRect(1, 1, 2, 2);
    display.markDirtyRect(3, 1, 2, 2);

    const rects = display.consumeDirtyRects();
    expect(rects).to.deep.equal([{ x: 1, y: 1, width: 4, height: 2 }]);
  });

  it('switches to full dirty mode when merged region covers the full surface', function () {
    const display = new DisplayImage(new MockStage());
    display.initSize(20, 10);

    display.consumeDirtyRects();
    display.markDirtyRect(0, 0, 20, 10);

    expect(display.consumeDirtyRects()).to.equal(null);
  });

  it('reuses consumed dirty-rect list buffers after release', function () {
    const display = new DisplayImage(new MockStage());
    display.initSize(20, 10);

    display.consumeDirtyRects();
    display.markDirtyRect(1, 1, 2, 2);
    const first = display.consumeDirtyRects();
    expect(first).to.have.length(1);
    display.releaseConsumedDirtyRects(first);
    expect(display._dirtyRectListPool.includes(first)).to.equal(true);

    display.markDirtyRect(3, 3, 2, 2);
    const second = display.consumeDirtyRects();
    expect(second).to.deep.equal([{ x: 3, y: 3, width: 2, height: 2 }]);
    expect(display._dirtyRects).to.equal(first);
  });
});
