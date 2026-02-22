import { expect } from 'chai';
import { Frame } from '../js/render/Frame.js';
import { __test__ as displayImageTest } from '../js/render/DisplayImage.js';

describe('DisplayImage scale cache', function () {
  it('reuses scaled buffers for matching frame/version/size and invalidates on frame edits', function () {
    const frame = new Frame(2, 2);
    frame.setPixel(0, 0, 0xff00ffff);
    frame.setPixel(1, 0, 0xff0000ff);
    frame.setPixel(0, 1, 0xff00ff00);
    frame.setPixel(1, 1, 0xffffffff);

    const a = displayImageTest.getScaledFrameVariant(frame, 4, 4, 'xbrz');
    const b = displayImageTest.getScaledFrameVariant(frame, 4, 4, 'xbrz');
    expect(a).to.equal(b);
    expect(a.scaled).to.be.instanceof(Uint32Array);
    expect(a.scaledMask).to.be.instanceof(Uint8Array);
    expect(a.scaled.length).to.equal(16);
    expect(a.scaledMask.length).to.equal(16);

    frame.setPixel(0, 0, 0xff112233);
    const c = displayImageTest.getScaledFrameVariant(frame, 4, 4, 'xbrz');
    expect(c).to.not.equal(a);
  });

  it('returns null for unsupported target dimensions', function () {
    const frame = new Frame(2, 2);
    const variant = displayImageTest.getScaledFrameVariant(frame, 5, 5, 'xbrz');
    expect(variant).to.equal(null);
  });

  it('evicts by least-recently-used variant access', function () {
    const frame = new Frame(2, 2);
    const initial = new Map();

    for (let version = 1; version <= 8; version += 1) {
      frame._version = version;
      initial.set(version, displayImageTest.getScaledFrameVariant(frame, 4, 4, 'xbrz'));
    }

    frame._version = 1;
    const touched = displayImageTest.getScaledFrameVariant(frame, 4, 4, 'xbrz');
    expect(touched).to.equal(initial.get(1));

    frame._version = 9;
    displayImageTest.getScaledFrameVariant(frame, 4, 4, 'xbrz');

    frame._version = 1;
    const stillCached = displayImageTest.getScaledFrameVariant(frame, 4, 4, 'xbrz');
    expect(stillCached).to.equal(initial.get(1));

    frame._version = 2;
    const evicted = displayImageTest.getScaledFrameVariant(frame, 4, 4, 'xbrz');
    expect(evicted).to.not.equal(initial.get(2));
  });

  it('reuses nearest-coordinate maps and evicts old cache entries', function () {
    const first = displayImageTest.getNearestCoordinateMap(2, 4);
    const second = displayImageTest.getNearestCoordinateMap(2, 4);
    expect(first).to.equal(second);
    expect(Array.from(first)).to.eql([0, 0, 1, 1]);

    for (let i = 0; i < 300; i += 1) {
      displayImageTest.getNearestCoordinateMap(3 + i, 6 + i);
    }
    const refreshed = displayImageTest.getNearestCoordinateMap(2, 4);
    expect(refreshed).to.not.equal(null);
    expect(displayImageTest._nearestCoordinateCache.size).to.be.at.most(256);
  });
});
