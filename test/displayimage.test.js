import { expect } from 'chai';
import { DisplayImage } from '../js/DisplayImage.js';
import { Frame } from '../js/Frame.js';

class StubStage {
  createImage() {
    return { width: 0, height: 0, data: new Uint8ClampedArray(0) };
  }
  setGameViewPointPosition() {}
  redraw() {}
}

describe('DisplayImage drawing and scaling', function() {
  let stage;
  beforeEach(function() {
    stage = new StubStage();
  });

  it('drawVerticalLine clamps to bounds', function() {
    const disp = new DisplayImage(stage);
    disp.initSize(4, 4);
    disp.drawVerticalLine(-1, -1, 5, 1, 2, 3);
    const color = 0xFF030201;
    for (let y=0; y<4; y++) {
      expect(disp.buffer32[y*4]).to.equal(color);
    }
  });

  it('blits frames with nearest scaling', function() {
    const disp = new DisplayImage(stage);
    disp.initSize(4, 4);
    const frame = new Frame(2,2);
    frame.setPixel(0,0,0xFF0000FF);
    frame.setPixel(1,0,0xFF00FF00);
    frame.setPixel(0,1,0xFFFF0000);
    frame.setPixel(1,1,0xFFFFFFFF);
    disp._blit(frame,0,0,{size:{width:4,height:4}});
    expect(Array.from(disp.buffer32)).to.eql([
      0xFF0000FF,0xFF0000FF,0xFF00FF00,0xFF00FF00,
      0xFF0000FF,0xFF0000FF,0xFF00FF00,0xFF00FF00,
      0xFFFF0000,0xFFFF0000,0xFFFFFFFF,0xFFFFFFFF,
      0xFFFF0000,0xFFFF0000,0xFFFFFFFF,0xFFFFFFFF
    ]);
  });
});
