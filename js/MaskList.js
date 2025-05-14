import { Lemmings } from './LemmingsNamespace.js';

class MaskList {
        constructor(fr, width, height, count, offsetX, offsetY) {
            if (fr != null) {
                this.loadFromFile(fr, width, height, count, offsetX, offsetY);
            }
        }
        get length() {
            return frames.length;
        }
        GetMask(index) {
            return this.frames[index];
        }
        loadFromFile(fr, width, height, count, offsetX, offsetY) {
            this.frames = [];
            for (let i = 0; i < count; i++) {
                let mask = new Lemmings.Mask(fr, width, height, offsetX, offsetY);
                this.frames.push(mask);
            }
        }
    }
    Lemmings.MaskList = MaskList;

export { MaskList };
