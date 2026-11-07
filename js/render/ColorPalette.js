const rgbaLookupCache = new WeakMap();

class ColorPalette {
  constructor() {
    this.data = new Uint32Array(16); //- 16 colors
    this.data.fill(0);
  }
  /** set color from Int-Value e.g. 0xFF00FF00 */
  setColorInt(index, colorValue) {
    this.data[index] = colorValue;
    rgbaLookupCache.delete(this);
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
  /** set color from R,G,B */
  setColorRGB(index, r, g, b) {
    this.setColorInt(index, ColorPalette.colorFromRGB(r, g, b));
  }
  static colorFromRGB(r, g, b) {
    const value = (0xff << 24) | (b << 16) | (g << 8) | r;
    return value >>> 0;
  }
  static getRgbaLookup(palette) {
    let lookup = rgbaLookupCache.get(palette);
    if (!lookup) {
      lookup = Uint32Array.from({ length: 128 }, (_, index) => palette.getColor(index));
      rgbaLookupCache.set(palette, lookup);
    }
    return lookup;
  }
  static get black() {
    return 0xFF000000;
  }
  static get debugColor() {
    return 0xFFFF00FF;
  }
}
export { ColorPalette };
