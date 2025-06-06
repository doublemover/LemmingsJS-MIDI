import { expect } from 'chai';
import { decodeFrame, PAL_DIFF } from '../js/L2ssSpriteDecoder.js';

describe('L2ssSpriteDecoder', function () {
  it('decodes a simple frame', function () {
    const width = 8;
    const height = 1;
    const header = new Uint8Array([
      0x00, width,
      0x00, height,
      0x00, 0x00, 0x00, 0x14, // pointer plane 0
      0x00, 0x00, 0x00, 0x18, // pointer plane 1
      0x00, 0x00, 0x00, 0x19, // pointer plane 2
      0x00, 0x00, 0x00, 0x1a  // pointer plane 3
    ]);
    const plane0 = new Uint8Array([0x02, PAL_DIFF + 1, PAL_DIFF + 2, 0xff]);
    const plane1 = new Uint8Array([0xff]);
    const plane2 = new Uint8Array([0xff]);
    const plane3 = new Uint8Array([0xff]);
    const data = new Uint8Array([
      ...header,
      ...plane0,
      ...plane1,
      ...plane2,
      ...plane3
    ]);

    const palette = new Array(256).fill(null).map((_, i) => [i, i, i]);
    const frame = decodeFrame(data, 0, 0, palette);
    expect(frame.width).to.equal(width);
    expect(frame.height).to.equal(height);
    expect(frame.pixels.length).to.equal(width * height * 3);

    const px0 = frame.pixels.slice(0, 3);
    expect(Array.from(px0)).to.eql([1, 1, 1]);
    const px1 = frame.pixels.slice(12, 15);
    expect(Array.from(px1)).to.eql([2, 2, 2]);
  });
});
