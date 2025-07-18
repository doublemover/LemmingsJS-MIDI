import { Lemmings } from './LemmingsNamespace.js';

/**
 * Particle effect coordinate table and color assignment for Lemmings explosions.
 * Decodes and draws animation frames for particle effects.
 * @class
 */
class ParticleTable {
  /** @type {any} Palette object */
  #palette;
  /** @type {number[]} 16-entry color index table */
  #colorIndexTable;
  /** @type {Int8Array[]} Decoded coordinates for all frames */
  #particleData;

  /**
   * @param {any} palette - Color palette (with getR/G/B methods).
   */
  constructor(palette) {
    this.#palette = palette;
    this.#colorIndexTable = [4, 15, 14, 13, 12, 11, 10, 9, 8, 11, 10, 9, 8, 7, 6, 2];

    // Only decode the Base64 data once for all instances
    if (!ParticleTable._sharedParticleData) {
      ParticleTable._sharedParticleData = ParticleTable.#decodeBase64Frames(ParticleTable.particleDataBase64);
    }
    this.#particleData = ParticleTable._sharedParticleData;
  }

  /** @returns {any} The palette object */
  get palette() { return this.#palette; }

  /** @returns {number[]} The color index table (read-only) */
  get colorIndexTable() { return this.#colorIndexTable.slice(); }

  /** @returns {Int8Array[]} Decoded particle coordinate frames (read-only) */
  get particleData() { return this.#particleData; }

  /**
   * Draw the specified frame of the particle animation at (x, y) using the palette.
   * @param {any} gameDisplay - Display with setPixel(x, y, r, g, b)
   * @param {number} frameIndex - Which frame of the animation (0..50)
   * @param {number} x - Center x
   * @param {number} y - Center y
   */
  draw(gameDisplay, frameIndex, x, y) {
    const frameData = this.#particleData[frameIndex];
    if (!frameData || !gameDisplay) return;
    const table = this.#colorIndexTable;
    const palette = this.#palette;
    for (let i = 0; i < frameData.length; i += 2) {
      const dx = frameData[i];
      const dy = frameData[i + 1];
      if (dx === -128 || dy === -128) continue;
      const colorIndex = table[i % 16];
      gameDisplay.setPixel(
        x + dx,
        y + dy,
        palette.getR(colorIndex),
        palette.getG(colorIndex),
        palette.getB(colorIndex)
      );
    }
  }

  /**
   * Decode the base64 animation coordinate data into an array of Int8Arrays.
   * @private
   * @param {string} b64 - Base64-encoded coordinate frames (each frame: 80×2 bytes, 51 frames)
   * @returns {Int8Array[]} Array of 51 Int8Arrays, each of length 160
   */
  static #decodeBase64Frames(b64) {
    // Browsers: window.atob, Node: Buffer.from
    const bin = typeof window !== 'undefined' && window.atob
      ? window.atob(b64)
      : Buffer.from(b64, 'base64').toString('binary');
    const frames = [];
    let pos = 0;
    for (let f = 0; f < 51; f++) {
      const frameArray = new Int8Array(160);
      for (let p = 0; p < 80; p++) {
        frameArray[p * 2]     = bin.charCodeAt(pos++);
        frameArray[p * 2 + 1] = bin.charCodeAt(pos++);
      }
      frames.push(frameArray);
    }
    return frames;
  }
}

/**
 * Shared, lazily decoded particle animation frames for all instances.
 * @type {Int8Array[]|undefined}
 * @private
 */
ParticleTable._sharedParticleData = undefined;

// Static base64 string: coordinates for 51 frames (each 160 bytes)
ParticleTable.particleDataBase64 = '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' +
    'YjicQMlJC041MSJMJ0btUT1CC1JPTrlF+0fuWhpfIVhBZTteLWJEcA54yHgOaURt/3Dycg1w5WrTb+N68nYleg14CHyAgBJ6Kn4JfICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI6NlcGAgDPDwPPf4mLk9wm1HIstDwxXK2Q+mkbHTwtUNzcjUihM7Vg+SAxZUVS3S/tN7mEbZiJfQms8ZC5pRXeAgICAD29GdP938XkNeORx0naAgPF9gICAgICAgICAgICAgICAgICAgICAgICAgI' +
    'CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICMjpLEgIA0xr/33uZk6PcOtCGIMg8RWTFmRJhMxlULWjg9JFgpUu1eQE8MX1JbtlL7U+1oHG0iZkRyPmsvcICAgICAgA93R3uAgICAgIDkeNF9gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAipGQyICANcq+/N7qZuz2E7InhjgPFls3aEqWU8VcC2E5QyRfKlns' +
    'ZUFVDGZUYbRY+1rtbxx0I21FeT9yMHeAgICAgIAQfoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIeTjsyAgDbNvADd7mjx9hixLYM+EBxdPWtQk1nDYgxoOkklZStf7GxCXAxtVmizX/th7HYdeyN0gIBAeTJ+gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI' +
    'CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICFlovQgIA40bsF3PNq9fYdrzOBRBAhX0NtV5FgwmkMbztQJmwrZutzRGMMdFhwsWb7aOx9gIAke4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgpiJ1ICAOdW6C9v3bPr2I605gIAQJ2FJb16PZ8FwDHY9VyZzLG3rekVqDHtad69t+2+AgICA' +
    'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAh9iAgDrauBDa/G7/9SmsP4CAES1jUHJljW6/dwx9Pl0ney11gIBGcYCAXH6udft2gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
Lemmings.ParticleTable?.particleDataBase64 || ''; // use the existing one if set, otherwise set below

Lemmings.ParticleTable = ParticleTable;
export { ParticleTable };
