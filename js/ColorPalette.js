import { Lemmings } from './LemmingsNamespace.js';

class ColorPalette {
  constructor(size = 16) {
    this.data = new Uint32Array(size);
    this.data.fill(0);
  }
  /** set color from Int-Value e.g. 0xFF00FF00 */
  setColorInt(index, colorValue) {
    this.data[index] = colorValue;
  }
  /** return a int-color value e.g. 0xFF00FF00 */
  getColor(index) {
    return this.data[index];
  }
  getR(index) {
    return this.data[index] & 0xFF;
  }
  getG(index) {
    return (this.data[index] >> 8) & 0xFF;
  }
  getB(index) {
    return (this.data[index] >> 16) & 0xFF;
  }
  get length() {
    return this.data.length;
  }
  /** set color from R,G,B */
  setColorRGB(index, r, g, b) {
    this.setColorInt(index, ColorPalette.colorFromRGB(r, g, b));
  }
  static colorFromRGB(r, g, b) {
    const value = (0xff << 24) | (b << 16) | (g << 8) | r;
    return value >>> 0;
  }
  static get black() {
    return 0xFF000000;
  }
  static get debugColor() {
    return 0xFFFF00FF;
  }
}
Lemmings.ColorPalette = ColorPalette;

export { ColorPalette };
