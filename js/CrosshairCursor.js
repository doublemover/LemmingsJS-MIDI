import { ColorPalette } from './ColorPalette.js';
import { Frame } from './Frame.js';

function createCrosshairFrame(size = 24) {
  const frame = new Frame(size, size);
  frame.data.fill(0);        // transparent RGBA
  const center = Math.floor(size / 2);
  const cw = ColorPalette.colorFromRGB(144, 238, 144); // light green
  const ccw = ColorPalette.colorFromRGB(255, 255, 255); // white

  for (let y = 0; y < size; y++) {
    frame.setPixel(center, y, cw);
    frame.setPixel(center - 1, y, ccw);
  }

  for (let x = 0; x < size; x++) {
    frame.setPixel(x, center, cw);
    frame.setPixel(x, center - 1, ccw);
  }

  return frame;
}
export { createCrosshairFrame };
