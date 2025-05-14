import { Lemmings } from './LemmingsNamespace.js';

class DisplayImage {
        constructor(stage) {
            this.stage = stage;
            this.onMouseUp = new Lemmings.EventHandler();
            this.onMouseDown = new Lemmings.EventHandler();
            this.onMouseMove = new Lemmings.EventHandler();
            this.onDoubleClick = new Lemmings.EventHandler();
            this.onMouseDown.on((e) => {
                //this.setDebugPixel(e.x, e.y);
            });
        }
        getWidth() {
            if (this.imgData == null)
                return 0;
            return this.imgData.width;
        }
        getHeight() {
            if (this.imgData == null)
                return 0;
            return this.imgData.height;
        }
        initSize(width, height) {
            /// create image data
            if ((this.imgData == null) || (this.imgData.width != width) || (this.imgData.height != height)) {
                this.imgData = this.stage.createImage(this, width, height);
                this.clear();
            }
        }
        clear() {
            if (this.imgData == null)
                return;
            let img = new Uint32Array(this.imgData.data);
            for (let i = 0; i < img.length; i++) {
                img[i] = 0xFF00FF00;
            }
        }
        /** render the level-background to an image */
        setBackground(groundImage, groundMask = null) {
            /// set pixels
            this.imgData.data.set(groundImage);
            this.groundMask = groundMask;
        }
        uint8ClampedColor(colorValue) {
            return colorValue & 0xFF;
        }
        /** draw a rect to the display */
        drawRect(x, y, width, height, red, green, blue) {
            let x2 = x + width;
            let y2 = y + height;
            this.drawHorizontalLine(x, y, x2, red, green, blue);
            this.drawHorizontalLine(x, y2, x2, red, green, blue);
            this.drawVerticalLine(x, y, y2, red, green, blue);
            this.drawVerticalLine(x2, y, y2, red, green, blue);
        }
        drawVerticalLine(x1, y1, y2, red, green, blue) {
            red = this.uint8ClampedColor(red);
            green = this.uint8ClampedColor(green);
            blue = this.uint8ClampedColor(blue);
            let destW = this.imgData.width;
            let destH = this.imgData.height;
            let destData = this.imgData.data;
            x1 = (x1 >= destW) ? (destW - 1) : (x1 < 0) ? 0 : x1;
            y1 = (y1 >= destH) ? (destH - 1) : (y1 < 0) ? 0 : y1;
            y2 = (y2 >= destH) ? (destH - 1) : (y2 < 0) ? 0 : y2;
            for (let y = y1; y <= y2; y += 1) {
                let destIndex = ((destW * y) + x1) * 4;
                destData[destIndex] = red;
                destData[destIndex + 1] = green;
                destData[destIndex + 2] = blue;
                destData[destIndex + 3] = 255;
            }
        }
        drawHorizontalLine(x1, y1, x2, red, green, blue) {
            red = this.uint8ClampedColor(red);
            green = this.uint8ClampedColor(green);
            blue = this.uint8ClampedColor(blue);
            let destW = this.imgData.width;
            let destH = this.imgData.height;
            let destData = this.imgData.data;
            x1 = (x1 >= destW) ? (destW - 1) : (x1 < 0) ? 0 : x1;
            y1 = (y1 >= destH) ? (destH - 1) : (y1 < 0) ? 0 : y1;
            x2 = (x2 >= destW) ? (destW - 1) : (x2 < 0) ? 0 : x2;
            for (let x = x1; x <= x2; x += 1) {
                let destIndex = ((destW * y1) + x) * 4;
                destData[destIndex] = red;
                destData[destIndex + 1] = green;
                destData[destIndex + 2] = blue;
                destData[destIndex + 3] = 255;
            }
        }
        /** copy a mask frame to the display */
        drawMask(mask, posX, posY) {
            let srcW = mask.width;
            let srcH = mask.height;
            let srcMask = mask.getMask();
            let destW = this.imgData.width;
            let destH = this.imgData.height;
            let destData = new Uint32Array(this.imgData.data.buffer);
            let destX = posX + mask.offsetX;
            let destY = posY + mask.offsetY;
            for (let y = 0; y < srcH; y++) {
                let outY = y + destY;
                if ((outY < 0) || (outY >= destH))
                    continue;
                for (let x = 0; x < srcW; x++) {
                    let srcIndex = ((srcW * y) + x);
                    /// ignore transparent pixels
                    if (srcMask[srcIndex] == 0)
                        continue;
                    let outX = x + destX;
                    if ((outX < 0) || (outX >= destW))
                        continue;
                    let destIndex = ((destW * outY) + outX);
                    destData[destIndex] = 0xFFFFFFFF;
                }
            }
        }
        /** copy a frame to the display - transparent color is changed to (r,g,b) */
        drawFrameCovered(frame, posX, posY, red, green, blue) {
            let srcW = frame.width;
            let srcH = frame.height;
            let srcBuffer = frame.getBuffer();
            let srcMask = frame.getMask();
            let nullCollor = 0xFF << 24 | blue << 16 | green << 8 | red;
            let destW = this.imgData.width;
            let destH = this.imgData.height;
            let destData = new Uint32Array(this.imgData.data.buffer);
            let destX = posX + frame.offsetX;
            let destY = posY + frame.offsetY;
            red = this.uint8ClampedColor(red);
            green = this.uint8ClampedColor(green);
            blue = this.uint8ClampedColor(blue);
            for (let y = 0; y < srcH; y++) {
                let outY = y + destY;
                if ((outY < 0) || (outY >= destH))
                    continue;
                for (let x = 0; x < srcW; x++) {
                    let srcIndex = ((srcW * y) + x);
                    let outX = x + destX;
                    if ((outX < 0) || (outX >= destW))
                        continue;
                    let destIndex = ((destW * outY) + outX);
                    if (srcMask[srcIndex] == 0) {
                        /// transparent pixel
                        destData[destIndex] = nullCollor;
                    } else {
                        destData[destIndex] = srcBuffer[srcIndex];
                    }
                }
            }
        }
        /** copy a frame to the display */
        drawFrame(frame, posX, posY) {
            let srcW = frame.width;
            let srcH = frame.height;
            let srcBuffer = frame.getBuffer();
            let srcMask = frame.getMask();
            let destW = this.imgData.width;
            let destH = this.imgData.height;
            let destData = new Uint32Array(this.imgData.data.buffer);
            let destX = posX + frame.offsetX;
            let destY = posY + frame.offsetY;
            for (let y = 0; y < srcH; y++) {
                let outY = y + destY;
                if ((outY < 0) || (outY >= destH))
                    continue;
                for (let x = 0; x < srcW; x++) {
                    let srcIndex = ((srcW * y) + x);
                    /// ignore transparent pixels
                    if (srcMask[srcIndex] == 0)
                        continue;
                    let outX = x + destX;
                    if ((outX < 0) || (outX >= destW))
                        continue;
                    let destIndex = ((destW * outY) + outX);
                    destData[destIndex] = srcBuffer[srcIndex];
                }
            }
        }
        /** copy a frame to the display */
        drawFrameFlags(frame, posX, posY, destConfig) {
            let srcW = frame.width;
            let srcH = frame.height;
            let srcBuffer = frame.getBuffer();
            let srcMask = frame.getMask();
            let destW = this.imgData.width;
            let destH = this.imgData.height;
            let destData = new Uint32Array(this.imgData.data.buffer);
            let destX = posX + frame.offsetX;
            let destY = posY + frame.offsetY;
            var upsideDown = destConfig.isUpsideDown;
            var noOverwrite = destConfig.noOverwrite;
            var onlyOverwrite = destConfig.onlyOverwrite;
            var mask = this.groundMask;
            for (let srcY = 0; srcY < srcH; srcY++) {
                let outY = srcY + destY;
                if ((outY < 0) || (outY >= destH))
                    continue;
                for (let srcX = 0; srcX < srcW; srcX++) {
                    let sourceY = upsideDown ? (srcH - srcY - 1) : srcY;
                    let srcIndex = ((srcW * sourceY) + srcX);
                    /// ignore transparent pixels
                    if (srcMask[srcIndex] == 0)
                        continue;
                    let outX = srcX + destX;
                    if ((outX < 0) || (outX >= destW))
                        continue;
                    /// check flags
                    if (noOverwrite) {
                        if (mask.hasGroundAt(outX, outY))
                            continue;
                    }
                    if (onlyOverwrite) {
                        if (!mask.hasGroundAt(outX, outY))
                            continue;
                    }
                    /// draw
                    let destIndex = ((destW * outY) + outX);
                    destData[destIndex] = srcBuffer[srcIndex];
                }
            }
        }
        setDebugPixel(x, y) {
            let pointIndex = (this.imgData.width * (y) + x) * 4;
            this.imgData.data[pointIndex] = 255;
            this.imgData.data[pointIndex + 1] = 0;
            this.imgData.data[pointIndex + 2] = 0;
        }
        setPixel(x, y, r, g, b) {
            let pointIndex = (this.imgData.width * (y) + x) * 4;
            this.imgData.data[pointIndex] = r;
            this.imgData.data[pointIndex + 1] = g;
            this.imgData.data[pointIndex + 2] = b;
        }
        setScreenPosition(x, y) {
            this.stage.setGameViewPointPosition(x, y);
        }
        getImageData() {
            return this.imgData;
        }
        redraw() {
            this.stage.redraw();
        }
    }
    Lemmings.DisplayImage = DisplayImage;

export { DisplayImage };
