import { Lemmings } from './LemmingsNamespace.js';

function createCrosshairFrame(size = 24) {
  const frame = new Lemmings.Frame(size, size);
  frame.data.fill(0);        // transparent RGBA
  frame.mask.fill(0);
  const center = Math.floor(size / 2);
  const cw = Lemmings.ColorPalette.colorFromRGB(144, 238, 144); // light green
  const ccw = Lemmings.ColorPalette.colorFromRGB(255, 255, 255); // white

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
Lemmings.createCrosshairFrame = createCrosshairFrame;
export { createCrosshairFrame };
