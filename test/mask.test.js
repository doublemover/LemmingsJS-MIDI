import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Mask } from '../js/Mask.js';
import { MaskList } from '../js/MaskList.js';

globalThis.lemmings = { game: { showDebug: false } };

class StubReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.idx = 0;
  }
  readByte() {
    return this.bytes[this.idx++] || 0;
  }
}

describe('Mask', function() {
  it('reports solid pixels correctly via at()', function() {
    const reader = new StubReader(Uint8Array.from([0x69]));
    const mask = new Mask(reader, 4, 2);

    const expected = [
      [true, false, false, true],
      [false, true, true, false]
    ];

    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) {
        expect(mask.at(x, y)).to.equal(expected[y][x]);
      }
    }
    expect(mask.at(-1, 0)).to.equal(false);
    expect(mask.at(4, 0)).to.equal(false);
    expect(mask.at(0, 2)).to.equal(false);
  });

  it('MaskList.GetMask returns masks with expected data', function() {
    const bytes = Uint8Array.from([0x60, 0x90]);
    const reader = new StubReader(bytes);
    const list = new MaskList(reader, 2, 2, 2, 0, 0);

    expect(list.length).to.equal(2);
    const m0 = list.GetMask(0);
    const m1 = list.GetMask(1);
    expect(m0).to.be.instanceOf(Mask);
    expect(m1).to.be.instanceOf(Mask);

    // first mask pattern: [0,1;1,0]
    expect(m0.at(0, 0)).to.equal(true);
    expect(m0.at(1, 0)).to.equal(false);
    expect(m0.at(0, 1)).to.equal(false);
    expect(m0.at(1, 1)).to.equal(true);

    // second mask pattern: [1,0;0,1]
    expect(m1.at(0, 0)).to.equal(false);
    expect(m1.at(1, 0)).to.equal(true);
    expect(m1.at(0, 1)).to.equal(true);
    expect(m1.at(1, 1)).to.equal(false);
  });
});
