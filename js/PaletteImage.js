import { Lemmings } from './LemmingsNamespace.js';

class PaletteImage {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.pixBuf = new Uint8Array(width * height); // one‑time allocation
    }

    getImageBuffer() { return this.pixBuf; }

    createFrame(palette, offsetX = 0, offsetY = 0) {
        const frame = new Lemmings.Frame(this.width, this.height, offsetX, offsetY);
        if (palette) frame.drawPaletteImage(this.pixBuf, this.width, this.height, palette, 0, 0);
        return frame;
    }

    /** Decode planar bitmap into indexed buffer. */
    processImage(src, bpp = 3, startPos) {
        if (startPos != null) src.setOffset(startPos);
        const pixCount = this.pixBuf.length;
        let bitBuf = 0, bitLen = 0;
        // read planes MSB first – matches Amiga/PC98 format used by Lemmings assets
        for (let plane = 0; plane < bpp; plane++) {
            for (let p = 0; p < pixCount; p++) {
                if (bitLen === 0) { bitBuf = src.readByte(); bitLen = 8; }
                this.pixBuf[p] |= ((bitBuf & 0x80) >> (7 - plane));
                bitBuf <<= 1; bitLen--;
            }
        }
    }

    /** Mark a color index as transparent by setting the high bit. */
    processTransparentByColorIndex(transIdx) {
        const buf = this.pixBuf;
        for (let i = 0, n = buf.length; i < n; i++) if (buf[i] === transIdx) buf[i] |= 0x80;
    }

    /** Apply 1‑bit transparency plane (0 = transparent). */
    processTransparentData(src, startPos = 0) {
        if (startPos != null) src.setOffset(startPos);
        const buf = this.pixBuf;
        let bitBuf = 0, bitLen = 0;
        for (let p = 0, n = buf.length; p < n; p++) {
            if (bitLen === 0) { bitBuf = src.readByte(); bitLen = 8; }
            if ((bitBuf & 0x80) === 0) buf[p] |= 0x80;
            bitBuf <<= 1; bitLen--;
        }
    }
}
Lemmings.PaletteImage = PaletteImage;
export { PaletteImage };