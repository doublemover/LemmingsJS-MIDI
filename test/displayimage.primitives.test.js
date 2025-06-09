import { expect } from 'chai';
import { DisplayImage } from '../js/DisplayImage.js';
import { Frame } from '../js/Frame.js';

class StubStage {
  constructor() { this.calls = []; }
  createImage(owner, width, height) {
    this.calls.push({ width, height });
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  setGameViewPointPosition() {}
  redraw() {}
}

describe('DisplayImage primitives', function() {
  let stage;
  beforeEach(function() {
    stage = new StubStage();
  });

  it('starts with null imgData and buffer32', function() {
    const disp = new DisplayImage(stage);
    expect(disp.imgData).to.equal(null);
    expect(disp.buffer32).to.equal(null);
  });

  it('initSize allocates image once', function() {
    const disp = new DisplayImage(stage);
    disp.initSize(2, 3);
    expect(stage.calls).to.have.lengthOf(1);
    expect(disp.imgData.width).to.equal(2);
    expect(disp.imgData.height).to.equal(3);
    const first = disp.imgData.data;
    disp.initSize(2, 3);
    expect(stage.calls).to.have.lengthOf(1);
    expect(disp.imgData.data).to.equal(first);
  });

  it('initSize creates Uint32Array buffer and clear uses default color', function() {
    const disp = new DisplayImage(stage);
    disp.initSize(2, 1);
    expect(disp.buffer32).to.be.instanceof(Uint32Array);
    disp.clear();
    expect(Array.from(disp.buffer32)).to.eql([0xFF00FF00, 0xFF00FF00]);
  });

  it('setBackground copies Uint8ClampedArray data', function() {
    const disp = new DisplayImage(stage);
    disp.initSize(2, 1);
    const src = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
    disp.setBackground(src);
    expect(Array.from(disp.buffer32)).to.eql([0xFF030201, 0xFF060504]);
  });

  it('setBackground copies Uint32Array data', function() {
    const disp = new DisplayImage(stage);
    disp.initSize(2, 1);
    const src = new Uint32Array([0xFF112233, 0xFF445566]);
    disp.setBackground(src);
    expect(Array.from(disp.buffer32)).to.eql([0xFF112233, 0xFF445566]);
  });

  it('setBackground logs error for other array types', function() {
    globalThis.lemmings = { game: { showDebug: true } };
    const disp = new DisplayImage(stage);
    disp.initSize(1, 1);
    disp.clear(0);
    const errors = [];
    const origErr = console.error;
    console.error = msg => errors.push(String(msg));
    disp.setBackground(new Uint8Array([1, 2, 3, 4]));
    console.error = origErr;
    delete globalThis.lemmings;
    expect(errors[0]).to.match(/setBackground fallback/);
    expect(Array.from(disp.buffer32)).to.eql([0]);
  });

  it('drawRect draws outlines and fills', function() {
    const disp = new DisplayImage(stage);
    disp.initSize(5, 5);
    disp.clear(0);
    disp.drawRect(1, 1, 3, 3, 1, 2, 3);
    const c = 0xFF030201;
    // top and bottom
    for (let x=1; x<=4; x++) {
      expect(disp.buffer32[1*5 + x]).to.equal(c);
      expect(disp.buffer32[4*5 + x]).to.equal(c);
    }
    // sides
    for (let y=1; y<=4; y++) {
      expect(disp.buffer32[y*5 + 1]).to.equal(c);
      expect(disp.buffer32[y*5 + 4]).to.equal(c);
    }
  });

  it('drawDashedRect draws dashed pattern', function() {
    const disp = new DisplayImage(stage);
    disp.initSize(5, 5);
    disp.clear(0);
    disp.drawDashedRect(1, 1, 3, 3, 1, 2, 3, 1);
    const c = 0xFF030201;
    const drawn = [];
    for (let dx=1; dx<=4; dx+=2) drawn.push([dx,1],[dx,4]);
    for (let dy=1; dy<=4; dy+=2) drawn.push([1,dy],[4,dy]);
    for (const [x,y] of drawn) {
      expect(disp.buffer32[y*5 + x]).to.equal(c);
    }
  });

  it('drawVerticalLine and drawHorizontalLine write pixels', function() {
    const disp = new DisplayImage(stage);
    disp.initSize(3, 3);
    disp.clear(0);
    disp.drawVerticalLine(1, 0, 2, 9, 8, 7);
    disp.drawHorizontalLine(0, 2, 2, 1, 2, 3);
    const cv = 0xFF070809;
    const ch = 0xFF030201;
    for (let y=0; y<3; y++) expect(disp.buffer32[y*3 + 1]).to.equal(cv);
    for (let x=0; x<3; x++) expect(disp.buffer32[2*3 + x]).to.equal(ch);
  });

  it('drawMask writes white for set mask pixels', function() {
    const disp = new DisplayImage(stage);
    disp.initSize(3, 2);
    disp.clear(0);
    const mask = {
      width: 2,
      height: 2,
      offsetX: 0,
      offsetY: 0,
      getMask() {
        return Int8Array.from([1, 0, 0, 1]);
      }
    };
    disp.drawMask(mask, 1, 0);
    const WHITE = 0xFFFFFFFF;
    expect(disp.buffer32[0*3 + 1]).to.equal(WHITE);
    expect(disp.buffer32[0*3 + 2]).to.equal(0);
    expect(disp.buffer32[1*3 + 1]).to.equal(0);
    expect(disp.buffer32[1*3 + 2]).to.equal(WHITE);
  });

  it('drawCornerRect draws corners and midlines correctly', function() {
    const disp = new DisplayImage(stage);
    disp.initSize(7, 7);
    disp.clear(0);
    disp.drawCornerRect(1, 1, { width: 5, height: 5 }, 1, 2, 3, 2, true, 3);
    const c = 0xFF030201;
    const expected = new Set();
    for (let x = 1; x <= 5; x++) {
      expected.add(`${x},1`);
      expected.add(`${x},5`);
    }
    for (let y = 1; y <= 5; y++) {
      expected.add(`1,${y}`);
      expected.add(`5,${y}`);
    }
    const seen = new Set();
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        if (disp.buffer32[y * 7 + x] === c) seen.add(`${x},${y}`);
        else expect(disp.buffer32[y * 7 + x]).to.equal(0);
      }
    }
    expect(seen).to.eql(expected);
  });

  it('_blit writes pixels without scaling', function() {
    const disp = new DisplayImage(stage);
    disp.initSize(3, 2);
    disp.clear(0);
    const frame = new Frame(2, 2);
    frame.data.set([1, 2, 3, 4]);
    frame.mask.set([1, 0, 0, 1]);
    disp._blit(frame, 1, 0, { nullColor32: 9 });
    expect(Array.from(disp.buffer32)).to.eql([
      0, 1, 9,
      0, 9, 4
    ]);
  });

  it('_blit flips vertically when upsideDown is true', function() {
    const disp = new DisplayImage(stage);
    disp.initSize(2, 2);
    disp.clear(0);
    const frame = new Frame(2, 2);
    frame.data.set([1, 2, 3, 4]);
    frame.mask.fill(1);
    disp._blit(frame, 0, 0, { upsideDown: true });
    expect(Array.from(disp.buffer32)).to.eql([3, 4, 1, 2]);
  });
});
