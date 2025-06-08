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

  it('handles n, m and l counters across planes', function () {
    const width = 16;
    const height = 2;
    const header = new Uint8Array([
      0x00, width,
      0x00, height,
      0x00, 0x00, 0x00, 0x14, // pointer plane 0
      0x00, 0x00, 0x00, 0x18, // pointer plane 1
      0x00, 0x00, 0x00, 0x1d, // pointer plane 2
      0x00, 0x00, 0x00, 0x20  // pointer plane 3
    ]);
    const plane0 = new Uint8Array([
      0x20, // n = 2 -> two pixels then newline
      PAL_DIFF + 1,
      PAL_DIFF + 2,
      0xff
    ]);
    const plane1 = new Uint8Array([
      0x39, // m = 3 with xAdd = 1
      PAL_DIFF + 3,
      PAL_DIFF + 4,
      PAL_DIFF + 5,
      0xff
    ]);
    const plane2 = new Uint8Array([
      0x81, // l = 1
      PAL_DIFF + 6,
      0xff
    ]);
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

    const getPx = (x, y) => {
      const idx = (y * width + x) * 3;
      return Array.from(frame.pixels.slice(idx, idx + 3));
    };

    expect(getPx(0, 0)).to.eql([1, 1, 1]);
    expect(getPx(4, 0)).to.eql([2, 2, 2]);

    expect(getPx(1, 0)).to.eql([3, 3, 3]);
    expect(getPx(5, 0)).to.eql([4, 4, 4]);
    expect(getPx(9, 0)).to.eql([5, 5, 5]);

    expect(getPx(2, 0)).to.eql([6, 6, 6]);
  });

  it('exercises remindL branch and special opcodes', function () {
    const width = 8;
    const height = 1;
    const header = new Uint8Array([
      0x00, width,
      0x00, height,
      0x00, 0x00, 0x00, 0x14, // pointer plane 0
      0x00, 0x00, 0x00, 0x17, // pointer plane 1
      0x00, 0x00, 0x00, 0x19, // pointer plane 2
      0x00, 0x00, 0x00, 0x1a  // pointer plane 3
    ]);
    const plane0 = new Uint8Array([
      PAL_DIFF + 7, // draw one pixel
      0x00, // newline
      0xff
    ]);
    const plane1 = new Uint8Array([
      0xe8, // x offset opcode
      0xff
    ]);
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
    const debug = [{ l: 1, remindL: true }, null, null, null];
    const frame = decodeFrame(data, 0, 0, palette, debug);
    const px0 = Array.from(frame.pixels.slice(0, 3));
    expect(px0).to.eql([7, 7, 7]);
  });
});
