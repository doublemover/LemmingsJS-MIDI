import { expect } from 'chai';
import { StageImageProperties } from '../../js/render/StageImageProperties.js';

describe('StageImageProperties', function() {
  let originalDocument;

  beforeEach(function() {
    originalDocument = globalThis.document;
    globalThis.document = {
      createElement(tag) {
        expect(tag).to.equal('canvas');
        return {
          width: 0,
          height: 0,
          getContext(type, options) {
            expect(type).to.equal('2d');
            expect(options).to.include.keys('willReadFrequently', 'desynchronized', 'alpha');
            return {
              createImageData(width, height) {
                return {
                  width,
                  height,
                  data: new Uint8ClampedArray(width * height * 4)
                };
              }
            };
          }
        };
      }
    };
  });

  afterEach(function() {
    globalThis.document = originalDocument;
  });

  it('stores viewport size and creates image data', function() {
    const props = new StageImageProperties();
    props.canvasViewportSize = { width: 320, height: 200 };
    expect(props.canvasViewportSize).to.eql({ width: 320, height: 200 });

    const data = props.createImage(4, 3);
    expect(props.cav.width).to.equal(4);
    expect(props.cav.height).to.equal(3);
    expect(data.width).to.equal(4);
    expect(data.height).to.equal(3);
  });
});
