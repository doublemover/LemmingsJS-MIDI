import { Lemmings } from './LemmingsNamespace.js';

class Mask {
        constructor(fr, width, height, offsetX, offsetY) {
            this.offsetX = offsetX;
            this.offsetY = offsetY;
            if (fr != null) {
                this.loadFromFile(fr, width, height);
            }
        }
        getMask() {
            return this.data;
        }
        /** return true if the given position (x,y) of the mask is set */
        at(x, y) {
            return (this.data[y * this.width + x] == 0);
        }
        /** load a mask from a file stream */
        loadFromFile(fr, width, height) {
            this.width = width;
            this.height = height;
            let pixCount = width * height;
            let pixBuf = new Int8Array(pixCount);
            let bitBuffer = 0;
            let bitBufferLen = 0;
            for (let i = 0; i < pixCount; i++) {
                if (bitBufferLen <= 0) {
                    bitBuffer = fr.readByte();
                    bitBufferLen = 8;
                }
                pixBuf[i] = (bitBuffer & 0x80);
                bitBuffer = (bitBuffer << 1);
                bitBufferLen--;
            }
            this.data = pixBuf;
        }
    }
    Lemmings.Mask = Mask;

export { Mask };
