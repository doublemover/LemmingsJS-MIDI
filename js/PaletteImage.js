import { Lemmings } from './LemmingsNamespace.js';

class PaletteImage {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixBuf = new Uint8Array(width * height);
    this.bytesPerPixel = 1;       // 1 = indexed, 4 = RGBA
  }

  getImageBuffer() { return this.pixBuf; }

  createFrame(palette, offsetX = 0, offsetY = 0) {
    const frame = new Lemmings.Frame(this.width, this.height, offsetX, offsetY);
    if (this.bytesPerPixel === 4) {
      frame.getBuffer().set(this.pixBuf);
      const mask = frame.getMask();
      for (let i = 0; i < mask.length; i++) {
        mask[i] = (this.pixBuf[i] >>> 24) ? 1 : 0;
      }
    } else if (palette) {
      frame.drawPaletteImage(this.pixBuf, this.width, this.height, palette, 0, 0);
    }
    return frame;
  }

  /** Decode bitmap data into internal buffer. */
  processImage(src, bpp = 8, startPos) {
    const pixCount = this.width * this.height;

    if (bpp === 32) {
      this.pixBuf = new Uint32Array(pixCount);
      this.bytesPerPixel = 4;
      if (src instanceof Uint32Array) {
        this.pixBuf.set(src.subarray(startPos ?? 0, (startPos ?? 0) + pixCount));
      } else if (src instanceof Uint8Array || src instanceof Uint8ClampedArray) {
        const view = new Uint32Array(src.buffer, src.byteOffset + ((startPos ?? 0) * 4), pixCount);
        this.pixBuf.set(view);
      } else if (src.readByte) {
        if (startPos != null) src.setOffset(startPos);
        for (let i = 0; i < pixCount; i++) {
          const r = src.readByte();
          const g = src.readByte();
          const b = src.readByte();
          const a = src.readByte();
          this.pixBuf[i] = (a << 24) | (b << 16) | (g << 8) | r;
        }
      }
      return;
    }

    this.pixBuf = new Uint8Array(pixCount);
    this.bytesPerPixel = 1;

    if (bpp === 8) {
      if (src instanceof Uint8Array || src instanceof Uint8ClampedArray) {
        this.pixBuf.set(src.subarray(startPos ?? 0, (startPos ?? 0) + pixCount));
      } else if (src.readByte) {
        if (startPos != null) src.setOffset(startPos);
        for (let i = 0; i < pixCount; i++) this.pixBuf[i] = src.readByte();
      }
      return;
    }

    if (startPos != null && src.setOffset) src.setOffset(startPos);
    let bitBuf = 0, bitLen = 0;
    for (let plane = 0; plane < bpp; plane++) {
      for (let p = 0; p < pixCount; p++) {
        if (bitLen === 0) { bitBuf = src.readByte(); bitLen = 8; }
        this.pixBuf[p] |= ((bitBuf & 0x80) >> (7 - plane));
        bitBuf <<= 1; bitLen--;
      }
    }
  }

  /** Mark a color index or RGBA value as transparent. */
  processTransparentByColorIndex(transIdx) {
    const buf = this.pixBuf;
    if (this.bytesPerPixel === 4) {
      for (let i = 0, n = buf.length; i < n; i++) if (buf[i] === transIdx) buf[i] &= 0x00FFFFFF;
    } else {
      for (let i = 0, n = buf.length; i < n; i++) if (buf[i] === transIdx) buf[i] |= 0x80;
    }
  }

  /** Apply 1‑bit transparency plane (0 = transparent). */
  processTransparentData(src, startPos = 0) {
    if (startPos != null && src.setOffset) src.setOffset(startPos);
    const buf = this.pixBuf;
    let bitBuf = 0, bitLen = 0;
    for (let p = 0, n = buf.length; p < n; p++) {
      if (bitLen === 0) { bitBuf = src.readByte(); bitLen = 8; }
      if ((bitBuf & 0x80) === 0) {
        if (this.bytesPerPixel === 4) buf[p] &= 0x00FFFFFF; else buf[p] |= 0x80;
      }
      bitBuf <<= 1; bitLen--;
    }
  }
}
Lemmings.PaletteImage = PaletteImage;
export { PaletteImage };
