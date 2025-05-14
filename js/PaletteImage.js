import { Lemmings } from './LemmingsNamespace.js';

class PaletteImage {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            let pixCount = this.width * this.height;
            this.pixBuf = new Uint8Array(pixCount);
        }
        /** return the image buffer */
        getImageBuffer() {
            return this.pixBuf;
        }
        /** convert to frame (colored image) */
        createFrame(palette, offsetX, offsetY) {
            /// convert color-index data to pixel image
            let resultFrame = new Lemmings.Frame(this.width, this.height, offsetX, offsetY);
            if (palette != null) {
                resultFrame.drawPaletteImage(this.pixBuf, this.width, this.height, palette, 0, 0);
            }
            return resultFrame;
        }
        /** convert the multi-bit-plain image to image */
        processImage(src, bitsPerPixel = 3, startPos) {
            let pixBuf = this.pixBuf;
            let pixCount = pixBuf.length;
            let bitBufLen = 0;
            let bitBuf = 0;
            if (startPos != null) {
                src.setOffset(startPos);
            }
            /// read image
            //- bits of a byte are stored separately
            for (var i = 0; i < bitsPerPixel; i++) {
                for (var p = 0; p < pixCount; p++) {
                    if (bitBufLen <= 0) {
                        bitBuf = src.readByte();
                        bitBufLen = 8;
                    }
                    pixBuf[p] = pixBuf[p] | ((bitBuf & 0x80) >> (7 - i));
                    bitBuf = (bitBuf << 1);
                    bitBufLen--;
                }
            }
            this.pixBuf = pixBuf;
        }
        /** use a color-index for the transparency in the image */
        processTransparentByColorIndex(transparentColorIndex) {
            let pixBuf = this.pixBuf;
            let pixCount = pixBuf.length;
            for (let i = 0; i < pixCount; i++) {
                if (pixBuf[i] == transparentColorIndex) {
                    /// Sets the highest bit to indicate the transparency.
                    pixBuf[i] = 0x80 | pixBuf[i];
                }
            }
        }
        /** use a bit plain for the transparency in the image */
        processTransparentData(src, startPos = 0) {
            let pixBuf = this.pixBuf;
            let pixCount = pixBuf.length;
            let bitBufLen = 0;
            let bitBuf = 0;
            if (startPos != null) {
                src.setOffset(startPos);
            }
            /// read image mask
            for (var p = 0; p < pixCount; p++) {
                if (bitBufLen <= 0) {
                    bitBuf = src.readByte();
                    bitBufLen = 8;
                }
                if ((bitBuf & 0x80) == 0) {
                    /// Sets the highest bit to indicate the transparency.
                    pixBuf[p] = 0x80 | pixBuf[p];
                }
                bitBuf = (bitBuf << 1);
                bitBufLen--;
            }
        }
    }
    Lemmings.PaletteImage = PaletteImage;

export { PaletteImage };
