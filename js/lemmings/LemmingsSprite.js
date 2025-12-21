import { Animation } from '../render/Animation.js';
import { SpriteTypes } from './SpriteTypes.js';
import { getDependency } from '../core/dependencies.js';

/**
 * Represents a set of all possible Lemmings sprite animations for a color palette.
 * Handles efficient animation caching and lookup.
 * @class
 */
class LemmingsSprite {
  /**
   * @type {any} Palette object (for WeakMap cache)
   */
  #colorPalette;

  /**
   * Lookup table: ActionType x direction (left/right/neutral) -> Animation
   * @type {Animation[]}
   */
  #lemmingAnimation = [];

  /**
   * @param {any} fr - Frame/resource data (format-specific)
   * @param {any} colorPalette - Palette to use for sprites (WeakMap-cached)
   */
  constructor(fr, colorPalette) {
    this.#colorPalette = colorPalette;
    this._AnimationCtor = getDependency('Animation', Animation);

    // Ensure a palette entry exists in the cache (cost: one WeakMap lookup)
    let paletteCache = _animationCache.get(colorPalette);
    if (!paletteCache) {
      paletteCache = new Map();
      _animationCache.set(colorPalette, paletteCache);
    }

    // Register all known Lemmings animation types efficiently
    // Each line: state, dir, fr, bitsPerPixel, width, height, offsetX, offsetY, frames
    // This reduces overhead vs calling registerAnimation 30+ times by inlining the loop
    const ANIM_LIST = [
      // state, dir,  bits, w,  h, offX, offY, frames
      [SpriteTypes.WALKING,  1, 2, 16, 10, -8, -10, 8],
      [SpriteTypes.JUMPING,  1, 2, 16, 10, -8, -10, 1],
      [SpriteTypes.WALKING, -1, 2, 16, 10, -8, -10, 8],
      [SpriteTypes.JUMPING, -1, 2, 16, 10, -8, -10, 1],
      [SpriteTypes.DIGGING,  0, 3, 16, 14, -8, -12,16],
      [SpriteTypes.CLIMBING, 1, 2, 16, 12, -8, -12,8],
      [SpriteTypes.CLIMBING,-1, 2, 16, 12, -8, -12,8],
      [SpriteTypes.DROWNING, 0, 2, 16, 10, -8, -10,16],
      [SpriteTypes.POSTCLIMBING, 1, 2, 16, 12, -8, -12, 8],
      [SpriteTypes.POSTCLIMBING,-1,2,16,12,-8,-12,8],
      [SpriteTypes.BUILDING,  1, 3, 16, 13, -8, -13,16],
      [SpriteTypes.BUILDING, -1, 3, 16, 13, -8, -13,16],
      [SpriteTypes.BASHING,   1, 3, 16, 10, -8, -10,32],
      [SpriteTypes.BASHING,  -1, 3, 16, 10, -8, -10,32],
      [SpriteTypes.MINING,    1, 3, 16, 13, -8, -12,24],
      [SpriteTypes.MINING,   -1, 3, 16, 13, -8, -12,24],
      [SpriteTypes.FALLING,   1, 2, 16, 10, -8, -10,4],
      [SpriteTypes.FALLING,  -1, 2, 16, 10, -8, -10,4],
      [SpriteTypes.UMBRELLA,  1, 3, 16, 16, -8, -16,8],
      [SpriteTypes.UMBRELLA, -1, 3, 16, 16, -8, -16,8],
      [SpriteTypes.SPLATTING, 0, 2, 16, 10, -8, -10,16],
      [SpriteTypes.EXITING,   0, 2, 16, 13, -8, -13,8],
      [SpriteTypes.FRYING,    0, 4, 16, 14, -8, -10,14],
      [SpriteTypes.BLOCKING,  0, 2, 16, 10, -8, -10,16],
      [SpriteTypes.SHRUGGING, 1, 2, 16, 10, -8, -10,8],
      [SpriteTypes.SHRUGGING, 0, 2, 16, 10, -8, -10,8],
      [SpriteTypes.OHNO,      0, 2, 16, 10, -8, -10,16],
      [SpriteTypes.EXPLODING, 0, 3, 32, 32, -8, -10,1]
    ];

    for (const [state, dir, bits, w, h, offX, offY, frames] of ANIM_LIST) {
      this.#registerAnimation(state, dir, fr, bits, w, h, offX, offY, frames, paletteCache);
    }
  }

  /**
   * Returns the animation object for the given state/direction.
   * @param {number} state - SpriteTypes constant
   * @param {boolean|number} right - Rightward direction (true = right, false = left/neutral)
   * @returns {Animation}
   */
  getAnimation(state, right) {
    return this.#lemmingAnimation[this.#typeToIndex(state, right)];
  }

  /**
   * Maps (state, right) to an index in the animation array.
   * @param {number} state
   * @param {boolean|number} right
   * @returns {number}
   */
  #typeToIndex(state, right) {
    return state * 2 + (right ? 0 : 1);
  }

  /**
   * Registers and caches an animation for (state, dir), storing in both cache and local table.
   * 
   * @private
   * @param {number} state - Sprite type/state
   * @param {number} dir - Direction (-1=left, 0=neutral, 1=right)
   * @param {any} fr - Frame/resource
   * @param {number} bitsPerPixel
   * @param {number} width
   * @param {number} height
   * @param {number} offsetX
   * @param {number} offsetY
   * @param {number} frames
   * @param {Map} paletteCache - Palette->State->Dir cache for this palette
   */
  #registerAnimation(state, dir, fr, bitsPerPixel, width, height, offsetX, offsetY, frames, paletteCache) {
    // Get/create per-state cache
    let stateCache = paletteCache.get(state);
    if (!stateCache) {
      stateCache = new Map();
      paletteCache.set(state, stateCache);
    }
    // Only create animation if not cached for (dir)
    if (!stateCache.has(dir)) {
      let animation = new this._AnimationCtor();
      animation.loadFromFile(fr, bitsPerPixel, width, height, frames, this.#colorPalette, offsetX, offsetY);
      stateCache.set(dir, animation);
    }
    const animation = stateCache.get(dir);

    // Store in local animation table for both possible directions
    if (dir >= 0) {
      this.#lemmingAnimation[this.#typeToIndex(state, true)] = animation;
    }
    if (dir <= 0) {
      this.#lemmingAnimation[this.#typeToIndex(state, false)] = animation;
    }
  }

  /** @returns {any} The palette (for debugging or cache) */
  get colorPalette() { return this.#colorPalette; }

  /** @returns {Animation[]} The flat animation table (read-only) */
  get lemmingAnimation() { return this.#lemmingAnimation.slice(); }
}

// Global animation cache: WeakMap<palette, Map<state, Map<dir, Animation>>>
const _animationCache = new WeakMap();
export { LemmingsSprite };



