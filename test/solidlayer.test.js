import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { SolidLayer } from '../js/SolidLayer.js';
import { Mask } from '../js/Mask.js';

globalThis.lemmings = Lemmings;

describe('SolidLayer', function() {
  it('updates mask when setting and clearing ground', function() {
    const layer = new SolidLayer(3, 3);
    expect(layer.hasGroundAt(1, 1)).to.equal(false);
    layer.setGroundAt(1, 1);
    expect(layer.hasGroundAt(1, 1)).to.equal(true);
    expect(layer.mask[1 + 1 * 3]).to.equal(1);
    layer.clearGroundAt(1, 1);
    expect(layer.hasGroundAt(1, 1)).to.equal(false);
    expect(layer.mask[1 + 1 * 3]).to.equal(0);
  });

  it('returns cropped copy with getSubLayer', function() {
    const layer = new SolidLayer(4, 4);
    layer.setGroundAt(0, 0);
    layer.setGroundAt(3, 3);

    const sub = layer.getSubLayer(0, 0, 2, 2);
    expect(sub.width).to.equal(2);
    expect(sub.height).to.equal(2);
    expect(sub.hasGroundAt(0, 0)).to.equal(true);
    expect(sub.hasGroundAt(1, 1)).to.equal(false);

    sub.setGroundAt(1, 1);
    expect(layer.hasGroundAt(1, 1)).to.equal(false);
  });

  it('clears ground with a mask', function() {
    const layer = new SolidLayer(4, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) layer.setGroundAt(x, y);
    const mask = new Mask(null, 2, 2, 0, 0);
    mask.data = new Int8Array([1, 1, 1, 1]);

    layer.clearGroundWithMask(mask, 1, 1);
    expect(layer.hasGroundAt(1, 1)).to.equal(false);
    expect(layer.hasGroundAt(2, 1)).to.equal(false);
    expect(layer.hasGroundAt(1, 2)).to.equal(false);
    expect(layer.hasGroundAt(2, 2)).to.equal(false);
    expect(layer.hasGroundAt(0, 0)).to.equal(true);
  });

  it('clears ground with multiple masks', function() {
    const layer = new SolidLayer(4, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) layer.setGroundAt(x, y);
    const m1 = new Mask(null, 1, 1, 0, 0); m1.data = new Int8Array([1]);
    const m2 = new Mask(null, 1, 1, 0, 0); m2.data = new Int8Array([1]);

    layer.clearGroundWithMasks([m1, m2], [[0, 0], [3, 3]]);
    expect(layer.hasGroundAt(0, 0)).to.equal(false);
    expect(layer.hasGroundAt(3, 3)).to.equal(false);
    expect(layer.hasGroundAt(1, 1)).to.equal(true);
  });

  it('clips mask edges at level bounds', function() {
    const layer = new SolidLayer(3, 3);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) layer.setGroundAt(x, y);
    const mask = new Mask(null, 2, 2, 0, 0);
    mask.data = new Int8Array([1, 1, 1, 1]);

    layer.clearGroundWithMask(mask, -1, -1);
    expect(layer.hasGroundAt(0, 0)).to.equal(false);
    expect(layer.hasGroundAt(1, 0)).to.equal(true);
    expect(layer.hasGroundAt(0, 1)).to.equal(true);

    layer.clearGroundWithMask(mask, 2, 2);
    expect(layer.hasGroundAt(2, 2)).to.equal(false);
    expect(layer.hasGroundAt(1, 2)).to.equal(true);
    expect(layer.hasGroundAt(2, 1)).to.equal(true);
  });

  it('clears ground on a sublayer', function() {
    const layer = new SolidLayer(4, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) layer.setGroundAt(x, y);
    const sub = layer.getSubLayer(1, 1, 2, 2);
    const mask = new Mask(null, 2, 2, 0, 0);
    mask.data = new Int8Array([1, 1, 1, 1]);

    sub.clearGroundWithMask(mask, 0, 0);
    expect(sub.hasGroundAt(0, 0)).to.equal(false);
    expect(sub.hasGroundAt(1, 0)).to.equal(false);
    expect(sub.hasGroundAt(0, 1)).to.equal(false);
    expect(sub.hasGroundAt(1, 1)).to.equal(false);
    expect(layer.hasGroundAt(1, 1)).to.equal(true);
  });

  it('returns false for out-of-bounds queries', function() {
    const layer = new SolidLayer(2, 2);
    layer.setGroundAt(1, 1);
    expect(layer.hasGroundAt(-1, 0)).to.equal(false);
    expect(layer.hasGroundAt(2, 0)).to.equal(false);
    expect(layer.hasGroundAt(0, -1)).to.equal(false);
    expect(layer.hasGroundAt(0, 2)).to.equal(false);
  });
});
