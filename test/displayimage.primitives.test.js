import { expect } from 'chai';
import { DisplayImage } from '../js/DisplayImage.js';

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
});
