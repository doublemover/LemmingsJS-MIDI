import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/ViewPoint.js';
import { StageImageProperties } from '../js/StageImageProperties.js';

function createDocumentStub() {
  const doc = {
    lastOpts: null,
    createElement() {
      const ctx = {
        canvas: {},
        fillRect() {},
        drawImage() {},
        putImageData() {},
        createImageData(w, h) {
          return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
        }
      };
      return {
        width: 0,
        height: 0,
        getContext(type, opts) { doc.lastOpts = opts; ctx.canvas = this; return ctx; }
      };
    }
  };
  return doc;
}

describe('StageImageProperties', function() {
  before(function() {
    globalThis.lemmings = { game: { showDebug: false } };
    global.document = createDocumentStub();
  });

  after(function() {
    delete global.document;
    delete globalThis.lemmings;
  });

  it('createImage returns ImageData of requested size', function() {
    const props = new StageImageProperties();
    const img = props.createImage(5, 7);
    expect(img.width).to.equal(5);
    expect(img.height).to.equal(7);
    expect(img.data).to.have.lengthOf(5 * 7 * 4);
  });

  it('createImage uses alpha context and clears data', function() {
    const doc = global.document;
    const props = new StageImageProperties();
    const img = props.createImage(2, 2);
    const allZero = Array.from(img.data).every(v => v === 0);
    expect(allZero).to.equal(true);
    expect(doc.lastOpts && doc.lastOpts.alpha).to.equal(true);
  });
});
