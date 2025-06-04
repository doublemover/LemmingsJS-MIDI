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
    this.frames     = arr;
    this._lastFrame = arr[frames-1];
    this.isFinished = false;
  }

  /**
   * Load animation frames while applying a simple palette swap.
   *
   * A few colour indices are replaced with different ones from the
   * supplied palette before the frames are generated.  The indices are
   * defined by the const arrays PALETTE_SRC and PALETTE_DST below.
   *
   * @param {Lemmings.BinaryReader} fr - Frame data source
   * @param {number} bitsPerPixel     - Bits per pixel of the source data
   * @param {number} width            - Frame width
   * @param {number} height           - Frame height
   * @param {number} frames           - Number of frames to read
   * @param {any}    palette          - Base colour palette
   * @param {number} [offsetX=null]   - Optional X offset
   * @param {number} [offsetY=null]   - Optional Y offset
   */
  loadFromFileWithPaletteSwap (fr, bitsPerPixel, width, height, frames, palette,
                               offsetX = null, offsetY = null) {
    const newPal = new Lemmings.ColorPalette();
    // Copy existing palette colours
    for (let i = 0; i < 16; i++) {
      newPal.setColorInt(i, palette.getColor(i));
    }

    // Replace selected indices with colours from different indices
    for (let i = 0; i < PALETTE_SRC.length; i++) {
      const src = PALETTE_SRC[i];
      const dst = PALETTE_DST[i];
      newPal.setColorInt(src, palette.getColor(dst));
    }

    this.loadFromFile(fr, bitsPerPixel, width, height, frames,
                      newPal, offsetX, offsetY);
  }
}
Lemmings.Animation = Animation;
export { Animation };

// Indices to swap when calling loadFromFileWithPaletteSwap().
// Chosen arbitrarily from 1..16 as an example mapping.
const PALETTE_SRC = Object.freeze([1, 2, 3]);
const PALETTE_DST = Object.freeze([14, 15, 16]);
