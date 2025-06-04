import { Lemmings } from './LemmingsNamespace.js';
import './ColorPalette.js';

// Palette indices for the fire shooter trap that will be remapped when
// creating an ice version of the animation.  They cover the full gradient
// from the bright yellow core through orange to the darkest reds.
// Indices 2 and 3 are now included so the entire flame gets swapped.
const FIRE_INDICES = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

// Destination colours lifted from the object palette of the ONML ice
// set.  These values replace the warm tones of the fire trap with
// cooler shades to give the impression of an "ice" trap.
const ICE_COLORS = Object.freeze([
  Lemmings.ColorPalette.colorFromRGB(64, 160, 255),  // brightest blue core
  Lemmings.ColorPalette.colorFromRGB(56, 152, 240),
  Lemmings.ColorPalette.colorFromRGB(48, 144, 232),
  Lemmings.ColorPalette.colorFromRGB(40, 128, 216),
  Lemmings.ColorPalette.colorFromRGB(32, 112, 200),
  Lemmings.ColorPalette.colorFromRGB(24, 96, 184),
  Lemmings.ColorPalette.colorFromRGB(16, 80, 168),
  Lemmings.ColorPalette.colorFromRGB(8, 64, 152),
  Lemmings.ColorPalette.colorFromRGB(4, 48, 136),
  Lemmings.ColorPalette.colorFromRGB(2, 32, 120),
  Lemmings.ColorPalette.colorFromRGB(0, 16, 104)
]);

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
   * defined by the const arrays FIRE_INDICES and ICE_INDICES below.
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

    // Replace selected indices with icy colours pulled from the ONML
    // object palette.  The ICE_COLORS array mirrors FIRE_INDICES by
    // position rather than by colour index.
    for (let i = 0; i < FIRE_INDICES.length; i++) {
      newPal.setColorInt(FIRE_INDICES[i], ICE_COLORS[i]);
    }

    this.loadFromFile(fr, bitsPerPixel, width, height, frames,
      newPal, offsetX, offsetY);
  }
}
Lemmings.Animation = Animation;
export { Animation };
