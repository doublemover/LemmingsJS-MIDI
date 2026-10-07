import { Animation } from '../render/Animation.js';
import { Frame } from '../render/Frame.js';
import { ColorPalette } from '../render/ColorPalette.js';
import { SpriteTypes } from './SpriteTypes.js';

const CONTRACT = [
  ['WALKING', 1, 16, 10, -8, -10, 8],
  ['JUMPING', 1, 16, 10, -8, -10, 1],
  ['WALKING', -1, 16, 10, -8, -10, 8],
  ['JUMPING', -1, 16, 10, -8, -10, 1],
  ['DIGGING', 0, 16, 14, -8, -12, 16],
  ['CLIMBING', 1, 16, 12, -8, -12, 8],
  ['CLIMBING', -1, 16, 12, -8, -12, 8],
  ['DROWNING', 0, 16, 10, -8, -10, 16],
  ['POSTCLIMBING', 1, 16, 12, -8, -12, 8],
  ['POSTCLIMBING', -1, 16, 12, -8, -12, 8],
  ['BUILDING', 1, 16, 13, -8, -13, 16],
  ['BUILDING', -1, 16, 13, -8, -13, 16],
  ['BASHING', 1, 16, 10, -8, -10, 32],
  ['BASHING', -1, 16, 10, -8, -10, 32],
  ['MINING', 1, 16, 13, -8, -12, 24],
  ['MINING', -1, 16, 13, -8, -12, 24],
  ['FALLING', 1, 16, 10, -8, -10, 4],
  ['FALLING', -1, 16, 10, -8, -10, 4],
  ['UMBRELLA', 1, 16, 16, -8, -16, 8],
  ['UMBRELLA', -1, 16, 16, -8, -16, 8],
  ['SPLATTING', 0, 16, 10, -8, -10, 16],
  ['EXITING', 0, 16, 13, -8, -13, 8],
  ['FRYING', 0, 16, 14, -8, -10, 14],
  ['BLOCKING', 0, 16, 10, -8, -10, 16],
  ['SHRUGGING', 1, 16, 10, -8, -10, 8],
  ['SHRUGGING', -1, 16, 10, -8, -10, 8],
  ['OHNO', 0, 16, 10, -8, -10, 16],
  ['EXPLODING', 0, 32, 32, -8, -10, 1]
];

function validateSkin(manifest) {
  const fail = message => { throw new Error(`Invalid sprite skin: ${message}`); };
  if (!manifest || manifest.format !== 'hydro-lemmings-skin-v1' || manifest.pixelFormat !== 'indexed-rows-rgba') fail('unsupported format');
  if (!Array.isArray(manifest.palette) || manifest.palette.length < 2 || manifest.palette.length > 16) fail('palette size');
  if (manifest.transparentIndex !== 0) fail('transparent index must be zero');
  if (typeof manifest.symbols !== 'string' || manifest.symbols.length !== manifest.palette.length || new Set(manifest.symbols).size !== manifest.symbols.length) fail('palette symbols');
  manifest.palette.forEach((rgba, index) => {
    if (!Array.isArray(rgba) || rgba.length !== 4 || rgba.some(v => !Number.isInteger(v) || v < 0 || v > 255)) fail(`palette ${index}`);
    if (rgba[3] !== (index === 0 ? 0 : 255)) fail('alpha must be binary with only index zero transparent');
  });
  if (!Array.isArray(manifest.animations) || manifest.animations.length !== CONTRACT.length) fail('all 28 strips are required');
  const padding = manifest.renderPaddingTop ?? 0;
  if (!Number.isInteger(padding) || padding < 0 || padding > 8) fail('cosmetic padding');
  const required = new Map(CONTRACT.map(c => [`${c[0]}:${c[1]}`, c]));
  const seen = new Set();
  for (const record of manifest.animations) {
    if (!record || typeof record !== 'object') fail('invalid strip');
    const key = `${record.state}:${record.direction}`;
    const original = required.get(key);
    const contract = original && [...original];
    if (contract) { contract[3] += padding; contract[5] -= padding; }
    if (!contract || seen.has(key)) fail(`unknown or duplicate strip ${key}`);
    seen.add(key);
    const actual = [record.state, record.direction, record.width, record.height, record.offsetX, record.offsetY, record.frameCount];
    if (actual.some((v, i) => v !== contract[i])) fail(`geometry or timing differs for ${key}`);
    if (!Array.isArray(record.frames) || record.frames.length !== record.frameCount) fail(`frame count for ${key}`);
    for (const rows of record.frames) {
      if (!Array.isArray(rows) || rows.length !== record.height) fail(`frame height for ${key}`);
      for (const row of rows) {
        if (typeof row !== 'string' || row.length !== record.width || [...row].some(c => !manifest.symbols.includes(c))) fail(`pixel row for ${key}`);
      }
    }
  }
  const landing = manifest.cosmetics?.beretLanding;
  if (manifest.cosmetics != null && !landing) fail('missing beret landing cosmetic');
  if (landing) {
    for (const [key, value] of Object.entries({ width: 16, height: 16 + padding, offsetX: -8, offsetY: -16 - padding, frameCount: 7 })) {
      if (landing[key] !== value) fail(`landing ${key}`);
    }
    if (!Array.isArray(landing.variants) || landing.variants.length !== 6) fail('landing variants');
    const variants = new Set();
    for (const variant of landing.variants) {
      if (!variant || ![-1, 1].includes(variant.direction) || ![-1, 0, 1].includes(variant.startSway)) fail('landing direction or sway');
      const key = `${variant.direction}:${variant.startSway}`;
      if (variants.has(key)) fail('duplicate landing variant');
      variants.add(key);
      if (!Array.isArray(variant.frames) || variant.frames.length !== 7) fail('landing frame count');
      for (const rows of variant.frames) {
        if (!Array.isArray(rows) || rows.length !== 16 + padding) fail('landing frame height');
        for (const row of rows) {
          if (typeof row !== 'string' || row.length !== 16 || [...row].some(c => !manifest.symbols.includes(c))) fail('landing pixel row');
        }
      }
    }
  }
  if (manifest.particleParts != null) {
    if (!Array.isArray(manifest.particleParts) || manifest.particleParts.length !== 2) fail('particle parts');
    const directions = new Set();
    for (const parts of manifest.particleParts) {
      if (!parts || ![-1, 1].includes(parts.direction) || directions.has(parts.direction)) fail('particle direction');
      directions.add(parts.direction);
      if (parts.width !== 16 || parts.height !== 10 + padding || parts.offsetX !== -8 || parts.offsetY !== -10 - padding) fail('particle geometry');
      for (const part of ['body', 'accessory', 'eyewear']) {
        if (!Array.isArray(parts[part]) || parts[part].length !== parts.height) fail('particle layer');
        for (const row of parts[part]) if (typeof row !== 'string' || row.length !== parts.width || [...row].some(symbol => !manifest.symbols.includes(symbol))) fail('particle pixels');
      }
    }
  }
  return manifest;
}

function decodeFrame(rows, width, height, offsetX, offsetY, pixels, indexedFrames) {
  const frame = new Frame(width, height, offsetX, offsetY);
  const rgba = frame.getData();
  const indices = new Uint8Array(width * height);
  const symbols = [...pixels.keys()];
  let pixelIndex = 0;
  for (const row of rows) {
    for (const symbol of row) {
      const color = pixels.get(symbol);
      rgba.set(color, pixelIndex * 4);
      indices[pixelIndex] = symbols.indexOf(symbol);
      frame.mask[pixelIndex++] = color[3] === 255 ? 1 : 0;
    }
  }
  frame.enableSpanCache();
  indexedFrames.set(frame, indices);
  return frame;
}

class PixelSpriteSkin {
  #animations = [];
  #palette;
  #landing = null;
  #transitions = new WeakMap();
  #indexedFrames = new WeakMap();
  #paletteSize = 0;
  #particleParts = new Map();

  constructor(manifest, source = null) {
    if (!source) validateSkin(manifest);
    this.#paletteSize = manifest.palette.length;
    this.#palette = new ColorPalette();
    manifest.palette.forEach(([r, g, b], i) => this.#palette.setColorRGB(i, r, g, b));
    if (source) {
      const colors = Uint32Array.from(manifest.palette, ([r, g, b, a]) => a ? ColorPalette.colorFromRGB(r, g, b) : 0);
      const frames = new WeakMap();
      const remap = original => {
        if (frames.has(original)) return frames.get(original);
        const frame = new Frame(original.width, original.height, original.offsetX, original.offsetY);
        const indices = source.#indexedFrames.get(original);
        for (let i = 0; i < indices.length; i++) frame.data[i] = colors[indices[i]];
        frame.mask = original.mask;
        const spans = original.getSpanCache();
        frame._spanCacheEnabled = true; frame._spanRows = spans.rows; frame._spanBounds = spans.bounds;
        this.#indexedFrames.set(frame, indices);
        frames.set(original, frame);
        return frame;
      };
      const lazyFrames = originals => {
        const result = new Array(originals.length);
        originals.forEach((original, i) => Object.defineProperty(result, i, { enumerable: true, get: () => remap(original) }));
        return result;
      };
      const animations = new Map();
      this.#animations = new Array(source.#animations.length);
      source.#animations.forEach((original, index) => Object.defineProperty(this.#animations, index, {
        enumerable: true,
        get: () => {
          if (!animations.has(original)) {
            const animation = new Animation();
            animation.frames = lazyFrames(original.frames);
            animations.set(original, animation);
          }
          return animations.get(original);
        }
      }));
      this.#particleParts = new Map([...source.#particleParts].map(([direction, parts]) => [direction,
        Object.fromEntries(Object.entries(parts).map(([part, frame]) => [part, frame ? remap(frame) : null]))]));
      if (source.#landing) this.#landing = new Map([...source.#landing].map(([key, frames]) => [key, lazyFrames(frames)]));
      return;
    }
    const pixels = new Map([...manifest.symbols].map((symbol, i) => [symbol, manifest.palette[i]]));
    for (const record of manifest.animations) {
      const animation = new Animation();
      animation.frames = record.frames.map(rows => decodeFrame(rows, record.width, record.height, record.offsetX, record.offsetY, pixels, this.#indexedFrames));
      animation._lastFrame = animation.frames[animation.frames.length - 1];
      const state = SpriteTypes[record.state];
      if (record.direction >= 0) this.#animations[state * 2] = animation;
      if (record.direction <= 0) this.#animations[state * 2 + 1] = animation;
    }
    for (const parts of manifest.particleParts || []) {
      this.#particleParts.set(parts.direction, Object.fromEntries(['body', 'accessory', 'eyewear'].map(part => [part,
        parts[part].some(row => /[^0]/.test(row)) ? decodeFrame(parts[part], parts.width, parts.height, parts.offsetX, parts.offsetY, pixels, this.#indexedFrames) : null])));
    }
    const landing = manifest.cosmetics?.beretLanding;
    if (landing) {
      this.#landing = new Map(landing.variants.map(variant => [
        `${variant.direction}:${variant.startSway}`,
        variant.frames.map(rows => decodeFrame(rows, landing.width, landing.height, landing.offsetX, landing.offsetY, pixels, this.#indexedFrames))
      ]));
    }
  }

  withPalette(palette) {
    if (!Array.isArray(palette) || palette.length !== this.#paletteSize || palette.some((rgba, i) =>
      !Array.isArray(rgba) || rgba.length !== 4 || rgba.some(value => !Number.isInteger(value) || value < 0 || value > 255) ||
      rgba[3] !== (i === 0 ? 0 : 255))) throw new Error('Invalid sprite skin: variant palette');
    // Decode geometry once; materialize each requested palette frame at most once.
    return new PixelSpriteSkin({ palette }, this);
  }

  resetActor(lem) {
    this.#transitions.delete(lem);
  }

  onActionChange(lem, previousAction, previousFrameIndex) {
    this.resetActor(lem);
    if (!this.#landing || previousAction?.spriteProvider !== this ||
        previousAction?.getActionName?.() !== 'floating' || lem.action?.getActionName?.() !== 'walk') return;
    const floatFrame = [0, 1, 3, 5, 5, 5, 5, 5, 5, 6, 7, 7, 6, 5, 4, 4][previousFrameIndex];
    const startSway = floatFrame === 4 ? -1 : floatFrame === 6 ? 1 : 0;
    this.#transitions.set(lem, { startSway, lastFrameIndex: -1 });
  }

  drawCosmeticTransition(gameDisplay, lem) {
    const transition = this.#transitions.get(lem);
    if (!transition) return false;
    const index = lem.frameIndex;
    if (lem.action?.getActionName?.() !== 'walk' || !Number.isInteger(index) ||
        index < 0 || index >= 7 || index < transition.lastFrameIndex) {
      this.resetActor(lem);
      return false;
    }
    transition.lastFrameIndex = index;
    const direction = lem.getDirection() === 'right' ? 1 : -1;
    const frame = this.#landing.get(`${direction}:${transition.startSway}`)[index];
    gameDisplay.drawFrame(frame, lem.x, lem.y);
    return true;
  }

  getParticleParts(right = true) { return this.#particleParts.get(right ? 1 : -1) || null; }

  getAnimation(state, right) {
    return this.#animations[state * 2 + (right ? 0 : 1)];
  }

  get colorPalette() { return this.#palette; }
  get lemmingAnimation() { return this.#animations.slice(); }
}

export { PixelSpriteSkin, validateSkin };
