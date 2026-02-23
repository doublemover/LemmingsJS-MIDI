import { expect } from 'chai';
import { useGlobalLemmings } from '../helpers/lemmings.js';
import { SolidLayer } from '../../js/render/SolidLayer.js';
import '../../js/util/LogHandler.js';

useGlobalLemmings({ game: { showDebug: false } });

describe('SolidLayer', function() {
  it('computes column gaps and counts mask regions', function() {
    const layer = new SolidLayer(4, 4);
    layer.setMaskAt(1, 2);
    layer.setMaskAt(2, 1);
    layer.setMaskAt(2, 2);
    layer.setMaskAt(3, 3);

    const sub = layer.getSubLayer(-1, -1, 2, 2);
    expect(sub.width).to.equal(2);
    expect(sub.height).to.equal(2);

    expect(layer.getColumnStepHeight(0, 0, 2)).to.equal(0);
    expect(layer.getColumnStepHeight(1, 3, 3)).to.equal(0);
    expect(layer.getColumnStepHeight(-1, 0, 2)).to.equal(0);

    expect(layer.getColumnGapDepth(1, 0, 4)).to.equal(3);
    expect(layer.getColumnGapDepth(2, 1, 3)).to.equal(1);
    expect(layer.getColumnGapDepth(0, 0, 2)).to.equal(3);
    expect(layer.getColumnGapDepth(-1, 0, 2)).to.equal(3);
    expect(layer.getColumnGapDepth(0, -1, 2)).to.equal(3);

    expect(layer.getColumnWallHeight(2, 3, 3)).to.equal(2);
    expect(layer.getColumnWallHeight(1, 3, 3)).to.equal(1);
    expect(layer.getColumnWallHeight(0, 3, 3)).to.equal(0);
    expect(layer.getColumnWallHeight(-1, 3, 3)).to.equal(0);
    expect(layer.getColumnWallHeight(2, 3, 0)).to.equal(0);
    expect(layer.getColumnWallHeight(2, 3, -4)).to.equal(0);
    const gapLayer = new SolidLayer(3, 4);
    gapLayer.setMaskAt(1, 2);
    gapLayer.setMaskAt(1, 0);
    expect(gapLayer.getColumnWallHeight(1, 3, 3)).to.equal(1);

    expect(layer.countMaskInRect(1, 1, 3, 3, 2)).to.equal(2);
    expect(layer.countMaskInRect(0, 0, 4, 4)).to.equal(4);
    expect(layer.countMaskInRect(0, 0, 0, 2)).to.equal(0);
    expect(layer.countMaskInRect(10, 10, 2, 2)).to.equal(0);

    const mask = {
      width: 1,
      height: 1,
      offsetX: 0,
      offsetY: 0,
      at() { return false; }
    };
    layer.setMaskAt(0, 0);
    expect(layer.clearGroundWithMask(mask, 0, 0, () => true)).to.equal(false);
    layer.setMaskAt(0, 0);
    expect(layer.clearGroundWithMask(mask, 0, 0, () => false)).to.equal(true);

    layer.clearGroundWithMasks([], []);
    layer.clearGroundWithMasks([null, mask], [[0, 0], null]);
  });
});
