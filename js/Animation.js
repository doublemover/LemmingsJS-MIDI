import { Lemmings } from './LemmingsNamespace.js';

class Animation {
  constructor (_compat = null, loop = true) {
    this.frames = [];
    this._lastFrame = null;
    this.loop   = loop;

    this.firstFrameIndex = 0;  // global tick when playback starts
    this.isFinished      = false;
    this.objectImg       = null;  // left for external access (DisplayImage, etc.)

    // Legacy readonly alias so external code can still read .frameCount.
    Object.defineProperty(this, 'frameCount', {
      enumerable: true,
      get: () => this.frames.length,
    });
  }

  /** Resets playback so the next call to getFrame() starts over. */
  restart (startTick = 0) {
    this.firstFrameIndex = startTick;
    this.isFinished      = false;
  }

  getFrame (globalTick) {
    const count = this.frames.length;
    if (count === 0) return null;

    if (this.isFinished && this._lastFrame) {
      return this._lastFrame;
    }

    const local = globalTick - this.firstFrameIndex;

    let idx;
    if (this.loop) {
      idx = ((local % count) + count) % count;  // positive remainder
    } else {
      if (local >= count - 1) {
        idx = count - 1;
        if (!this._lastFrame) {
          this._lastFrame = this.frames[idx];
        }
        this.isFinished = true;
        return this._lastFrame;
      } else if (local < 0) {
        idx = 0;
      } else {
        idx = local;
      }
    }
    return this.frames[idx];
  }

  loadFromFile (fr, bitsPerPixel, width, height, frames, palette,
                offsetX = null, offsetY = null) {
    const arr = new Array(frames);
    for (let i = 0; i < frames; ++i) {
      const paletteImg = new Lemmings.PaletteImage(width, height);
      paletteImg.processImage(fr, bitsPerPixel);
      paletteImg.processTransparentByColorIndex(0);
      arr[i] = paletteImg.createFrame(palette, offsetX, offsetY);
    }
    this.frames     = arr;   // one atomic swap – great for sharing/caching
    this._lastFrame = arr[frames-1];
    this.isFinished = false;
  }
}
Lemmings.Animation = Animation;
export { Animation };