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
    this.transparentSpans = null;
    this.transparentOffsets = null;
    this.clearableCount = 0;
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
    this._buildTransparentMetrics();
  }

  getTransparentSpans() {
    if (!this.transparentSpans || !this.transparentOffsets) {
      this._buildTransparentMetrics();
    }
    return this.transparentSpans;
  }

  _buildTransparentMetrics() {
    const data = this.data;
    const width = this.width | 0;
    const height = this.height | 0;
    if (!data || width <= 0 || height <= 0) {
      this.transparentSpans = {
        rows: new Int16Array(0),
        starts: new Int16Array(0),
        lengths: new Int16Array(0),
        offsets: new Int32Array(0)
      };
      this.transparentOffsets = this.transparentSpans.offsets;
      this.clearableCount = 0;
      return;
    }

    const rows = [];
    const starts = [];
    const lengths = [];
    const offsets = [];
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let x = 0;
      while (x < width) {
        while (x < width && data[row + x] === 0) x += 1;
        if (x >= width) break;
        const start = x;
        while (x < width && data[row + x] !== 0) {
          offsets.push(row + x);
          x += 1;
        }
        rows.push(y);
        starts.push(start);
        lengths.push(x - start);
      }
    }
    this.transparentSpans = {
      rows: Int16Array.from(rows),
      starts: Int16Array.from(starts),
      lengths: Int16Array.from(lengths),
      offsets: Int32Array.from(offsets)
    };
    this.transparentOffsets = this.transparentSpans.offsets;
    this.clearableCount = this.transparentOffsets.length;
  }
}
export { Mask };
