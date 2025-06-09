import { expect } from 'chai';
import { alphaBlend } from '../js/xbrz/scalers/Blender.js';
import Scaler2x from '../js/xbrz/scalers/Scaler2x.js';

globalThis.lemmings = { game: { showDebug: false } };

function color32(r, g, b) {
  return (0xFF000000 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF)) >>> 0;
}

function makeOut(buf) {
  return {
    ref(i, j) {
      const idx = i * 2 + j;
      return {
        get() { return buf[idx]; },
        set(v) { buf[idx] = v; }
      };
    }
  };
}

describe('Scaler2x individual blend functions', function() {
  const COL = color32(10, 20, 30);
  let scaler;

  beforeEach(function() {
    scaler = new Scaler2x();
  });

  it('scale() returns the configured factor', function() {
    const s = new Scaler2x();
    const result = Scaler2x.prototype.scale.call(s);
    expect(result).to.equal(2);
  });

  function expectArray(actual, expected) {
    expect(Array.from(actual)).to.eql(Array.from(expected));
  }

  it('blendLineShallow produces expected pixels', function() {
    const dest = new Uint32Array(4);
    const out = makeOut(dest);
    scaler.blendLineShallow(COL, out);

    const exp = new Uint32Array(4);
    const eo = makeOut(exp);
    alphaBlend(1, 4, eo.ref(1, 0), COL);
    alphaBlend(3, 4, eo.ref(1, 1), COL);

    expectArray(dest, exp);
  });

  it('blendLineSteep produces expected pixels', function() {
    const dest = new Uint32Array(4);
    const out = makeOut(dest);
    scaler.blendLineSteep(COL, out);

    const exp = new Uint32Array(4);
    const eo = makeOut(exp);
    alphaBlend(1, 4, eo.ref(0, 1), COL);
    alphaBlend(3, 4, eo.ref(1, 1), COL);

    expectArray(dest, exp);
  });

  it('blendLineSteepAndShallow produces expected pixels', function() {
    const dest = new Uint32Array(4);
    const out = makeOut(dest);
    scaler.blendLineSteepAndShallow(COL, out);

    const exp = new Uint32Array(4);
    const eo = makeOut(exp);
    alphaBlend(1, 4, eo.ref(1, 0), COL);
    alphaBlend(1, 4, eo.ref(0, 1), COL);
    alphaBlend(5, 6, eo.ref(1, 1), COL);

    expectArray(dest, exp);
  });

  it('blendLineDiagonal produces expected pixels', function() {
    const dest = new Uint32Array(4);
    const out = makeOut(dest);
    scaler.blendLineDiagonal(COL, out);

    const exp = new Uint32Array(4);
    const eo = makeOut(exp);
    alphaBlend(1, 2, eo.ref(1, 1), COL);

    expectArray(dest, exp);
  });

  it('blendCorner produces expected pixels', function() {
    const dest = new Uint32Array(4);
    const out = makeOut(dest);
    scaler.blendCorner(COL, out);

    const exp = new Uint32Array(4);
    const eo = makeOut(exp);
    alphaBlend(21, 100, eo.ref(1, 1), COL);

    expectArray(dest, exp);
  });
});
