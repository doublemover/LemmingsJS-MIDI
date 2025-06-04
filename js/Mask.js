import { Lemmings } from './LemmingsNamespace.js';

class Mask {
  /**
     * @param {Object|null} fr - file reader for mask data, optional
     * @param {number} width
     * @param {number} height
     * @param {number} offsetX
     * @param {number} offsetY
     */
  constructor(fr, width = 0, height = 0, offsetX = 0, offsetY = 0) {
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.width = width;
    this.height = height;
    this.data = null;
    if (fr != null) {
      this.loadFromFile(fr, width, height);
    }
  }
  getMask() {
    return this.data;
  }

  /** Return true if the given position (x,y) of the mask is set (solid) */
  at(x, y) {
    if (!this.data || x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    return this.data[y * this.width + x] === 0;
  }

  /** load a mask from a file stream */
  loadFromFile(fr, width, height) {
    this.width = width;
    this.height = height;
    const pixCount = width * height;
    const pixBuf = new Int8Array(pixCount);
    let bitBuffer = 0;
    let bitBufferLen = 0;

    for (let i = 0; i < pixCount; i++) {
      if (bitBufferLen <= 0) {
        bitBuffer = fr.readByte();
        bitBufferLen = 8;
      }
      pixBuf[i] = (bitBuffer & 0x80) ? 1 : 0;
      bitBuffer <<= 1;
      bitBufferLen--;
    }
    this.data = pixBuf;
  }
}

Lemmings.Mask = Mask;
export { Mask };
