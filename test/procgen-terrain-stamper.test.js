import { expect } from 'chai';
import { ProcgenTerrainStamper } from '../js/app/procgenTerrainStamper.js';

const createLevel = (width, height) => ({
  width,
  height,
  groundImage: new Uint8ClampedArray(width * height * 4),
  groundMask: {
    mask: new Uint8Array(width * height)
  },
  applyGroundBulkChange() {}
});

describe('ProcgenTerrainStamper', function () {
  it('clips partially offscreen stamps and reuses cached destination views', function () {
    const level = createLevel(4, 4);
    const bulkCalls = [];
    level.applyGroundBulkChange = (...args) => bulkCalls.push(args);
    const stamper = new ProcgenTerrainStamper(level);
    const piece = {
      image: {
        width: 2,
        height: 2,
        palette: {
          getColor(i) { return i + 1000; }
        }
      },
      frame: new Uint8Array([
        1, 2,
        3, 4
      ])
    };

    stamper.stamp(piece, -1, 1);
    const firstView = stamper._dest32;

    const idxA = (1 * level.width) + 0;
    const idxB = (2 * level.width) + 0;
    expect(level.groundMask.mask[idxA]).to.equal(1);
    expect(level.groundMask.mask[idxB]).to.equal(1);
    expect(firstView[idxA]).to.equal(1002);
    expect(firstView[idxB]).to.equal(1004);
    expect(bulkCalls.length).to.equal(1);
    expect(bulkCalls[0][0]).to.equal(0);
    expect(bulkCalls[0][1]).to.equal(1);

    stamper.stamp(piece, 1, 1);
    expect(stamper._dest32).to.equal(firstView);
  });

  it('respects noOverwrite during clipped writes', function () {
    const level = createLevel(3, 3);
    const stamper = new ProcgenTerrainStamper(level);
    const piece = {
      image: {
        width: 1,
        height: 1,
        palette: {
          getColor(i) { return i + 2000; }
        }
      },
      frame: new Uint8Array([7])
    };
    const idx = (1 * level.width) + 1;
    level.groundMask.mask[idx] = 1;
    const before = new Uint32Array(level.groundImage.buffer);
    before[idx] = 999;

    stamper.stamp(piece, 1, 1, { noOverwrite: true });

    const after = new Uint32Array(level.groundImage.buffer);
    expect(level.groundMask.mask[idx]).to.equal(1);
    expect(after[idx]).to.equal(999);
  });
});
