import { Lemmings } from './LemmingsNamespace.js';

class Frame {
        constructor(width, height, offsetX, offsetY) {
            this.width = 0;
            this.height = 0;
            this.offsetX = 0;
            this.offsetY = 0;
            this.width = Math.trunc(width);
            this.height = Math.trunc(height);
            if (offsetX == null) {
                this.offsetX = 0;
            } else {
                this.offsetX = Math.trunc(offsetX);
            }
            if (offsetY == null) {
                this.offsetY = 0;
            } else {
                this.offsetY = Math.trunc(offsetY);
            }
            let pixCount = this.width * this.height;
            this.data = new Uint32Array(pixCount);
            this.mask = new Int8Array(pixCount);
            this.clear();
        }
        getData() {
            return new Uint8ClampedArray(this.data.buffer);
        }
        getBuffer() {
            return this.data;
        }
        /** Mask can be 0 or 1 */
        getMask() {
            return this.mask;
        }
        /** set the image to color=black / alpha=255 / mask=0 */
        clear() {
            //this.data.fill(ColorPalette.debugColor());
            this.data.fill(Lemmings.ColorPalette.black);
            this.mask.fill(0);
        }
        /** set the image to color=black / alpha=255 / mask=0 */
        fill(r, g, b) {
            this.data.fill(Lemmings.ColorPalette.colorFromRGB(r, g, b));
            this.mask.fill(1);
        }
        /** draw a palette Image to this frame */
        drawPaletteImage(srcImg, srcWidth, srcHeight, palette, left, top) {
            let pixIndex = 0;
            srcWidth = srcWidth | 0;
            srcHeight = srcHeight | 0;
            left = left | 0;
            top = top | 0;
            for (let y = 0; y < srcHeight; y++) {
                for (let x = 0; x < srcWidth; x++) {
                    let colorIndex = srcImg[pixIndex];
                    pixIndex++;
                    if ((colorIndex & 0x80) > 0) {
                        this.clearPixel(x + left, y + top);
                    } else {
                        this.setPixel(x + left, y + top, palette.getColor(colorIndex));
                    }
                }
            }
        }
        /** set the color of a pixel */
        setPixel(x, y, color, noOverwrite = false, onlyOverwrite = false) {
            if ((x < 0) || (x >= this.width))
                return;
            if ((y < 0) || (y >= this.height))
                return;
            let destPixelPos = y * this.width + x;
            if (noOverwrite) {
                /// if some data have been drawn here before
                if (this.mask[destPixelPos] != 0)
                    return;
            }
            if (onlyOverwrite) {
                /// if no data have been drawn here before
                if (this.mask[destPixelPos] == 0)
                    return;
            }
            this.data[destPixelPos] = color;
            this.mask[destPixelPos] = 1;
        }
        /** set a pixel to back */
        clearPixel(x, y) {
            if ((x < 0) || (x >= this.width))
                return;
            if ((y < 0) || (y >= this.height))
                return;
            let destPixelPos = y * this.width + x;
            this.data[destPixelPos] = Lemmings.ColorPalette.black;
            this.mask[destPixelPos] = 0;
        }
    }
    Lemmings.Frame = Frame;

export { Frame };
