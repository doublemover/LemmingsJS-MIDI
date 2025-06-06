import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/Frame.js';
import '../js/ColorPalette.js';
import { createCrosshairFrame } from '../js/CrosshairCursor.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('createCrosshairFrame', function () {
  it('creates a transparent frame with crosshair lines', function () {
    const size = 6;
    const frame = createCrosshairFrame(size);
    const center = Math.floor(size / 2);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        const onLine = x === center || x === center - 1 || y === center || y === center - 1;
        if (onLine) {
          expect(frame.data[idx]).to.not.equal(0);
        } else {
          expect(frame.data[idx]).to.equal(0);
        }
      }
    }
  });
});
