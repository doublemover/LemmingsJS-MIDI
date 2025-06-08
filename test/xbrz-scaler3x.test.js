import { expect } from 'chai';
import { alphaBlend } from '../js/xbrz/scalers/Blender.js';
import Scaler3x from '../js/xbrz/scalers/Scaler3x.js';

// prevent debug logs
globalThis.lemmings = { game: { showDebug: false } };

function color32(r, g, b) {
  return (0xFF000000 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF)) >>> 0;
}

function makeOut(buf) {
  return {
    ref(i, j) {
      const idx = i * 3 + j;
      return {
        get() { return buf[idx]; },
        set(v) { buf[idx] = v; }
      };
    }
  };
}

describe('Scaler3x individual blend functions', function () {
  const COL = color32(10, 20, 30);
  let scaler;

  beforeEach(function () {
    scaler = new Scaler3x();
  });

  function expectArray(actual, expected) {
    expect(Array.from(actual)).to.eql(Array.from(expected));
  }

  it('blendLineShallow produces expected pixels', function () {
    const dest = new Uint32Array(9);
    const out = makeOut(dest);
    scaler.blendLineShallow(COL, out);

    const exp = new Uint32Array(9);
    const eo = makeOut(exp);
    alphaBlend(1, 4, eo.ref(2, 0), COL);
    alphaBlend(3, 4, eo.ref(2, 1), COL);
    alphaBlend(1, 4, eo.ref(1, 2), COL);
    eo.ref(2, 2).set(COL);

    expectArray(dest, exp);
  });

  it('blendLineSteep produces expected pixels', function () {
    const dest = new Uint32Array(9);
    const out = makeOut(dest);
    scaler.blendLineSteep(COL, out);

    const exp = new Uint32Array(9);
    const eo = makeOut(exp);
    alphaBlend(1, 4, eo.ref(0, 2), COL);
    alphaBlend(3, 4, eo.ref(1, 2), COL);
    alphaBlend(1, 4, eo.ref(2, 1), COL);
    eo.ref(2, 2).set(COL);

    expectArray(dest, exp);
  });

  it('blendLineSteepAndShallow produces expected pixels', function () {
    const dest = new Uint32Array(9);
    const out = makeOut(dest);
    scaler.blendLineSteepAndShallow(COL, out);

    const exp = new Uint32Array(9);
    const eo = makeOut(exp);
    alphaBlend(1, 4, eo.ref(2, 0), COL);
    alphaBlend(1, 4, eo.ref(0, 2), COL);
    alphaBlend(3, 4, eo.ref(2, 1), COL);
    alphaBlend(3, 4, eo.ref(1, 2), COL);
    eo.ref(2, 2).set(COL);

    expectArray(dest, exp);
  });

  it('blendLineDiagonal produces expected pixels', function () {
    const dest = new Uint32Array(9);
    const out = makeOut(dest);
    scaler.blendLineDiagonal(COL, out);

    const exp = new Uint32Array(9);
    const eo = makeOut(exp);
    alphaBlend(1, 8, eo.ref(1, 2), COL);
    alphaBlend(1, 8, eo.ref(2, 1), COL);
    alphaBlend(7, 8, eo.ref(2, 2), COL);

    expectArray(dest, exp);
  });

  it('blendCorner produces expected pixels', function () {
    const dest = new Uint32Array(9);
    const out = makeOut(dest);
    scaler.blendCorner(COL, out);

    const exp = new Uint32Array(9);
    const eo = makeOut(exp);
    alphaBlend(45, 100, eo.ref(2, 2), COL);

    expectArray(dest, exp);
  });
});
