import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';

class SolidLayer extends Lemmings.BaseLogger {
  /**
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array|Int8Array|null} mask - Optional initial ground mask
     */
  constructor(width, height, mask = null) {
    super();
    this.width = width;
    this.height = height;
    this.mask = mask ? new Uint8Array(mask) : new Uint8Array(width * height);
  }

  hasGroundAt(x, y) {
    return (this.hasMaskAt(x,y));
  }

  hasMaskAt(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    return this.mask[x + y * this.width] !== 0;
  }

  clearGroundAt(x, y) {
    this.clearMaskAt(x, y);
  }

  clearMaskAt(x, y) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.mask[x + y * this.width] = 0;
    }
  }

  /** Set a point as solid */
  setGroundAt(x, y) {
    this.setMaskAt(x, y);
  }

  setMaskAt(x, y) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.mask[x + y * this.width] = 1;
    }
  }

  /**
     * Clear ground using a mask at a given map position.
     * @param {Mask} mask
     * @param {number} x - top-left X position in map where mask will be applied (includes mask.offsetX)
     * @param {number} y - top-left Y position in map where mask will be applied (includes mask.offsetY)
     * @param {Function|null} skipTest - Optional (x, y) => true if pixel should not be cleared (e.g. steel check)
     */
  clearGroundWithMask(mask, x, y, skipTest = null) {
    Lemmings.withPerformance(
      'clearGroundWithMask',
      {
        track: 'SolidLayer',
        trackGroup: 'Game State',
        color: 'primary-dark',
        tooltipText: `clearGroundWithMask ${x},${y}`
      },
      () => {
        const mx = mask.offsetX || 0, my = mask.offsetY || 0;
        for (let dy = 0; dy < mask.height; ++dy) {
          const mapY = y + my + dy;
          if (mapY < 0 || mapY >= this.height) continue;
          for (let dx = 0; dx < mask.width; ++dx) {
            const mapX = x + mx + dx;
            if (mapX < 0 || mapX >= this.width) continue;
            // Only clear where mask pixel is **not** solid
            if (!mask.at(dx, dy)) {
              if (!skipTest || !skipTest(mapX, mapY)) {
                this.mask[mapX + mapY * this.width] = 0;
              }
            }
          }
        }
      })();
  }

  /**
     * Clear ground using multiple masks and positions at once.
     * @param {Array<Mask>} masks
     * @param {Array<[number,number]>} positions - parallel array to masks; [x,y] positions for each mask
     * @param {Function|null} skipTest - Optional (x, y) => true if pixel should not be cleared (e.g. steel check)
     */
  clearGroundWithMasks(masks, positions, skipTest = null) {
    Lemmings.withPerformance(
      'clearGroundWithMasks',
      {
        track: 'SolidLayer',
        trackGroup: 'Game State',
        color: 'primary-light',
        tooltipText: `clearGroundWithMasks ${masks.length}`
      },
      () => {
        if (!Array.isArray(masks) || masks.length === 0) return;
        for (let i = 0; i < masks.length; ++i) {
          const mask = masks[i], pos = positions[i];
          if (!mask || !pos) continue;
          this.clearGroundWithMask(mask, pos[0], pos[1], skipTest);
        }
      })();
  }
}

Lemmings.SolidLayer = SolidLayer;
export { SolidLayer };
