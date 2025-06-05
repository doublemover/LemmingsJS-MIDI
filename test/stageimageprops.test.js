import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/ViewPoint.js';
import { StageImageProperties } from '../js/StageImageProperties.js';

function createDocumentStub() {
  return {
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
        getContext() { ctx.canvas = this; return ctx; }
      };
    }
  };
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
});
