import { Lemmings } from './LemmingsNamespace.js';

class SolidLayer {
    /**
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array|Int8Array|null} mask - Optional initial ground mask
     */
    constructor(width, height, mask = null) {
        this.width = width;
        this.height = height;
        this.groundMask = mask ? new Uint8Array(mask) : new Uint8Array(width * height);
    }
    /** Check if a point is solid */
    hasGroundAt(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
        return this.groundMask[x + y * this.width] !== 0;
    }

    /** Clear a point */
    clearGroundAt(x, y) {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height)
            this.groundMask[x + y * this.width] = 0;
    }

    /** Set a point as solid */
    setGroundAt(x, y) {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height)
            this.groundMask[x + y * this.width] = 1;
    }

    /**
     * Clear ground using a mask at a given map position.
     * @param {Mask} mask
     * @param {number} x - top-left X position in map where mask will be applied (includes mask.offsetX)
     * @param {number} y - top-left Y position in map where mask will be applied (includes mask.offsetY)
     * @param {Function|null} skipTest - Optional (x, y) => true if pixel should not be cleared (e.g. steel check)
     */
    clearGroundWithMask(mask, x, y, skipTest = null) {
        const start = performance.now();
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
                        this.groundMask[mapX + mapY * this.width] = 0;
                    }
                }
            }
        }
        performance.measure("clearGroundWithMask Complete", { start, detail: { devtools: { track: "SolidLayer", trackGroup: "Game State", color: "primary-dark", properties: [["Position", `${x},${y}`],["skipTest"], `${skipTest}`], tooltipText: "clearGroundWithMask" } } });
    }

    /**
     * Clear ground using multiple masks and positions at once.
     * @param {Array<Mask>} masks
     * @param {Array<[number,number]>} positions - parallel array to masks; [x,y] positions for each mask
     * @param {Function|null} skipTest - Optional (x, y) => true if pixel should not be cleared (e.g. steel check)
     */
    clearGroundWithMasks(masks, positions, skipTest = null) {
        const start = performance.now();
        if (!Array.isArray(masks) || masks.length === 0) return;
        for (let i = 0; i < masks.length; ++i) {
            const mask = masks[i], pos = positions[i];
            if (!mask || !pos) continue;
            this.clearGroundWithMask(mask, pos[0], pos[1], skipTest);
        }
        performance.measure("clearGroundWithMasks Complete", { start, detail: { devtools: { track: "SolidLayer", trackGroup: "Game State", color: "primary-light", properties: [["Positions", `${positions}`],["skipTest"], `${skipTest}`], tooltipText: "clearGroundWithMasks" } } });
    }
}

Lemmings.SolidLayer = SolidLayer;
export { SolidLayer };
