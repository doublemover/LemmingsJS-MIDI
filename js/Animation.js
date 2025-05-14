import { Lemmings } from './LemmingsNamespace.js';

class Animation {
        constructor(frames, loop = true) {
            this.frames = [];
            this.loop = loop;
            this.firstFrameIndex = 0;
            this.objectImg = null;
            this.isFinished = false;
        }
        restart(startTick = 0) {
            this.firstFrameIndex = startTick;    // treat current global tick as t=0
            this.finished        = false;        // allow getFrame() to advance again
        }
        getFrame(globalTick) {
            if (this.finished) {
                return this.frames.at(-1);   // stay on last frame
            }

            let localTick = globalTick - this.firstFrameIndex;
            let idx = this.loop ? localTick % this.frames.length : Math.min(localTick, this.frames.length - 1);

            if (!this.loop && idx === this.frames.length - 1) {
                this.finished = true;
            }
            return this.frames[idx];
        }
        /** load all images for this animation from a file */
        loadFromFile(fr, bitsPerPixel, width, height, frames, palette, offsetX = null, offsetY = null) {
            for (let f = 0; f < frames; f++) {
                let paletteImg = new Lemmings.PaletteImage(width, height);
                paletteImg.processImage(fr, bitsPerPixel);
                paletteImg.processTransparentByColorIndex(0);
                this.frames.push(paletteImg.createFrame(palette, offsetX, offsetY));
            }
        }
    }
    Lemmings.Animation = Animation;

export { Animation };
