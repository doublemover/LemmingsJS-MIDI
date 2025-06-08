import { expect } from 'chai';
import { alphaBlend } from '../js/xbrz/scalers/Blender.js';
import Scaler4x from '../js/xbrz/scalers/Scaler4x.js';

globalThis.lemmings = { game: { showDebug: false } };

function color32(r, g, b) {
  return (0xFF000000 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF)) >>> 0;
}

function makeOut(buf) {
  return {
    ref(i, j) {
      const idx = i * 4 + j;
      return {
        get() { return buf[idx]; },
        set(v) { buf[idx] = v; }
      };
    }
  };
}

describe('Scaler4x individual blend functions', function() {
  const COL = color32(10, 20, 30);
  let scaler;

  beforeEach(function() {
    scaler = new Scaler4x();
  });

  function expectArray(actual, expected) {
    expect(Array.from(actual)).to.eql(Array.from(expected));
  }

  it('blendLineShallow produces expected pixels', function() {
    const dest = new Uint32Array(16);
    const out = makeOut(dest);
    scaler.blendLineShallow(COL, out);

    const exp = new Uint32Array(16);
    const eo = makeOut(exp);
    alphaBlend(1, 4, eo.ref(3, 0), COL);
    alphaBlend(3, 4, eo.ref(3, 1), COL);
    alphaBlend(1, 4, eo.ref(2, 2), COL);
    eo.ref(3, 2).set(COL);
    alphaBlend(3, 4, eo.ref(2, 3), COL);
    eo.ref(3, 3).set(COL);

    expectArray(dest, exp);
  });

  it('blendLineSteep produces expected pixels', function() {
    const dest = new Uint32Array(16);
    const out = makeOut(dest);
    scaler.blendLineSteep(COL, out);

    const exp = new Uint32Array(16);
    const eo = makeOut(exp);
    alphaBlend(1, 4, eo.ref(0, 3), COL);
    alphaBlend(3, 4, eo.ref(1, 3), COL);
    alphaBlend(1, 4, eo.ref(2, 2), COL);
    eo.ref(2, 3).set(COL);
    alphaBlend(3, 4, eo.ref(3, 2), COL);
    eo.ref(3, 3).set(COL);

    expectArray(dest, exp);
  });

  it('blendLineSteepAndShallow produces expected pixels', function() {
    const dest = new Uint32Array(16);
    const out = makeOut(dest);
    scaler.blendLineSteepAndShallow(COL, out);

    const exp = new Uint32Array(16);
    const eo = makeOut(exp);
    alphaBlend(3, 4, eo.ref(3, 1), COL);
    alphaBlend(3, 4, eo.ref(1, 3), COL);
    alphaBlend(1, 4, eo.ref(3, 0), COL);
    alphaBlend(1, 4, eo.ref(0, 3), COL);
    alphaBlend(1, 3, eo.ref(2, 2), COL);
    eo.ref(3, 3).set(COL);
    eo.ref(3, 2).set(COL);
    eo.ref(2, 3).set(COL);

    expectArray(dest, exp);
  });

  it('blendLineDiagonal produces expected pixels', function() {
    const dest = new Uint32Array(16);
    const out = makeOut(dest);
    scaler.blendLineDiagonal(COL, out);

    const exp = new Uint32Array(16);
    const eo = makeOut(exp);
    alphaBlend(1, 2, eo.ref(3, 2), COL);
    alphaBlend(1, 2, eo.ref(2, 3), COL);
    eo.ref(3, 3).set(COL);

    expectArray(dest, exp);
  });

  it('blendCorner produces expected pixels', function() {
    const dest = new Uint32Array(16);
    const out = makeOut(dest);
    scaler.blendCorner(COL, out);

    const exp = new Uint32Array(16);
    const eo = makeOut(exp);
    alphaBlend(68, 100, eo.ref(3, 3), COL);
    alphaBlend(9, 100, eo.ref(3, 2), COL);
    alphaBlend(9, 100, eo.ref(2, 3), COL);

    expectArray(dest, exp);
  });
});
