import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Frame } from '../js/Frame.js';
import { DisplayImage, scaleNearest, scaleXbrz, scaleHqx } from '../js/DisplayImage.js';
import '../js/ColorPalette.js';

globalThis.lemmings = { game: { showDebug: false } };

class StubStage {
  createImage(owner, width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  setGameViewPointPosition() {}
  redraw() {}
}

describe('DisplayImage scaling helpers', function() {
  describe('scale functions', function() {
    let frame;
    beforeEach(function() {
      frame = new Frame(2, 2);
      frame.data.set([1, 2, 3, 4]);
      frame.mask.fill(1);
    });

    it('scaleNearest 2x writes expected pattern', function() {
      const dest = new Uint32Array(16);
      scaleNearest(frame, 4, 4, { dest32: dest, destW: 4, destH: 4, baseX: 0, baseY: 0 });
      expect(Array.from(dest)).to.eql([
        1, 1, 2, 2,
        1, 1, 2, 2,
        3, 3, 4, 4,
        3, 3, 4, 4
      ]);
    });

    it('scaleXbrz 2x writes expected pattern', function() {
      const dest = new Uint32Array(16);
      scaleXbrz(frame, 4, 4, { dest32: dest, destW: 4, destH: 4, baseX: 0, baseY: 0 });
      expect(Array.from(dest)).to.eql([
        1, 1, 2, 2,
        1, 0xFF000001, 2, 2,
        3, 3, 0xFF000003, 4,
        3, 3, 4, 4
      ]);
    });

    it('scaleHqx 2x writes expected pattern', function() {
      const dest = new Uint32Array(16);
      scaleHqx(frame, 4, 4, { dest32: dest, destW: 4, destH: 4, baseX: 0, baseY: 0 });
      expect(Array.from(dest)).to.eql([
        1, 1, 1, 2,
        1, 1, 2, 2,
        2, 2, 3, 3,
        3, 3, 3, 4
      ]);
    });

    it('scaleXbrz falls back to nearest for non-integer scale', function() {
      const exp = new Uint32Array(9);
      scaleNearest(frame, 3, 3, { dest32: exp, destW: 3, destH: 3, baseX: 0, baseY: 0 });
      const dest = new Uint32Array(9);
      scaleXbrz(frame, 3, 3, { dest32: dest, destW: 3, destH: 3, baseX: 0, baseY: 0 });
      expect(Array.from(dest)).to.eql(Array.from(exp));
    });

    it('scaleHqx falls back to nearest for non-integer scale', function() {
      const exp = new Uint32Array(9);
      scaleNearest(frame, 3, 3, { dest32: exp, destW: 3, destH: 3, baseX: 0, baseY: 0 });
      const dest = new Uint32Array(9);
      scaleHqx(frame, 3, 3, { dest32: dest, destW: 3, destH: 3, baseX: 0, baseY: 0 });
      expect(Array.from(dest)).to.eql(Array.from(exp));
    });
  });

  describe('draw rect helpers', function() {
    let stage, disp;
    beforeEach(function() {
      stage = new StubStage();
      disp = new DisplayImage(stage);
      disp.initSize(3, 3);
      disp.clear(0);
    });

    it('drawMarchingAntRect paints alternating border', function() {
      disp.drawMarchingAntRect(0, 0, 2, 2, 1, 0, 1, 2);
      expect(Array.from(disp.buffer32)).to.eql([
        1, 2, 1,
        2, 0, 2,
        1, 2, 1
      ]);
    });

    it('drawDashedRect respects offset', function() {
      disp.drawDashedRect(0, 0, 2, 2, 1, 1, 2, 1);
      expect(Array.from(disp.buffer32)).to.eql([
        1, 2, 1,
        2, 0, 2,
        1, 2, 1
      ]);
    });
  });
});
