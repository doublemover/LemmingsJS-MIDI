import { Frame } from '../render/Frame.js';
import { getSourceImageGeometry } from '../render/SourceImageGeometry.js';
import { getRuntimeDependency } from '../core/dependencies.js';

const CACHE_PREFIX = 'lemmings.editor.preview';
const CACHE_VERSION = 2;
const DEFAULT_MAX_MEMORY_ENTRIES = 512;

const hashStep = (hash, value) => (((hash ^ value) >>> 0) * 16777619) >>> 0;

const hashPalette = (hash, palette) => {
  if (!palette) return hash;
  const data = palette.data;
  if (data && data.length) {
    for (const color of data) {
      hash = hashStep(hash, color & 0xff);
      hash = hashStep(hash, (color >> 8) & 0xff);
      hash = hashStep(hash, (color >> 16) & 0xff);
      hash = hashStep(hash, (color >> 24) & 0xff);
    }
    return hash;
  }
  if (typeof palette.getColor === 'function') {
    for (let i = 0; i < 16; i++) {
      const color = palette.getColor(i) >>> 0;
      hash = hashStep(hash, color & 0xff);
      hash = hashStep(hash, (color >> 8) & 0xff);
      hash = hashStep(hash, (color >> 16) & 0xff);
      hash = hashStep(hash, (color >> 24) & 0xff);
    }
  }
  return hash;
};

const hashFrame = (hash, frame) => {
  if (!frame) return hash;
  if (frame instanceof Frame) {
    for (const color of frame.getBuffer()) hash = hashStep(hash, color);
    for (const bit of frame.getMask()) hash = hashStep(hash, bit);
    return hash;
  }
  for (let i = 0; i < frame.length; i++) {
    hash = hashStep(hash, frame[i]);
  }
  return hash;
};

const resolveVersion = (value) => {
  const version = value?._previewHashVersion ?? value?.previewVersion ?? value?.version ?? (value instanceof Frame ? value._version : null);
  return Number.isFinite(version) ? version : null;
};

const pickFrame = (image) => {
  const frames = image?.frames || [];
  const previewIndex = Number.isFinite(image?.preview_image_index)
    ? image.preview_image_index
    : 0;
  return frames[previewIndex] || frames[0] || null;
};

const getPreviewIndex = (image) => {
  return Number.isFinite(image?.preview_image_index) ? image.preview_image_index : 0;
};

const buildPreviewDataUrl = (image, palette, document) => {
  const frame = pickFrame(image), rgba = frame instanceof Frame;
  if (!image || !document || !frame || !rgba && !palette) return null;
  const { width, height, sourceWidth, scaleX, scaleY } = getSourceImageGeometry(image, frame);
  if (!width || !height) return null;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true }); if (!ctx) return null;
  const imageData = ctx.createImageData(width, height), data = imageData.data;
  const colors = rgba ? frame.getBuffer() : null, mask = rgba ? frame.getMask() : null;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * scaleY * sourceWidth + x * scaleX, out = (y * width + x) * 4;
    if (rgba ? !mask[at] : frame[at] & 0x80) continue;
    const color = rgba ? colors[at] : palette.getColor(frame[at] & 0x7f) >>> 0;
    data[out] = color & 0xff; data[out + 1] = (color >> 8) & 0xff;
    data[out + 2] = (color >> 16) & 0xff; data[out + 3] = (color >> 24) & 0xff;
  }
  ctx.putImageData(imageData, 0, 0); return canvas.toDataURL('image/png');
};
const keyPrefixForType = (version, type) => `${CACHE_PREFIX}:v${version}:${type}:`;

const getEntryIdFromKey = (key) => {
  if (typeof key !== 'string') return null;
  const parts = key.split(':');
  if (parts.length < 5) return null;
  return parts[3] || null;
};

class EditorPreviewCache {
  constructor(options = {}) {
    this.document = options.document || getRuntimeDependency('document', null);
    this.storage = options.storage || getRuntimeDependency('localStorage', null);
    this.version = Number.isFinite(options.version) ? options.version : CACHE_VERSION;
    this.maxMemoryEntries = Number.isFinite(options.maxMemoryEntries) && options.maxMemoryEntries > 0
      ? Math.floor(options.maxMemoryEntries)
      : DEFAULT_MAX_MEMORY_ENTRIES;
    this.memory = new Map();
    this._hashCache = new WeakMap();
  }

  _remember(key, value) {
    if (!key || typeof value !== 'string') return;
    if (this.memory.has(key)) {
      this.memory.delete(key);
    }
    this.memory.set(key, value);
    while (this.memory.size > this.maxMemoryEntries) {
      const oldestKey = this.memory.keys().next().value;
      this.memory.delete(oldestKey);
    }
  }

  /**
   * Invalidates preview cache entries for one palette type while preserving any
   * IDs included in `validIds`. Called during style reload to avoid stale/bloated
   * caches when large packs swap palettes repeatedly.
   */
  invalidateTypeIds(type, validIds = []) {
    if (!type) return;
    const keepIds = new Set((Array.isArray(validIds) ? validIds : [])
      .filter(id => Number.isFinite(id))
      .map(id => String(id)));
    const prefix = keyPrefixForType(this.version, type);

    for (const key of Array.from(this.memory.keys())) {
      if (!key.startsWith(prefix)) continue;
      const entryId = getEntryIdFromKey(key);
      if (entryId != null && keepIds.has(entryId)) continue;
      this.memory.delete(key);
    }

    const storage = this.storage;
    if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') {
      return;
    }
    const staleKeys = [];
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        const entryId = getEntryIdFromKey(key);
        if (entryId != null && keepIds.has(entryId)) continue;
        staleKeys.push(key);
      }
      for (const key of staleKeys) {
        storage.removeItem?.(key);
      }
    } catch {
      // ignore storage enumeration errors
    }
  }

  _getImageSignature(image, palette, frame) {
    const previewIndex = getPreviewIndex(image);
    const geometry = getSourceImageGeometry(image, frame), width = geometry.width;
    const height = geometry.height, frameLength = frame instanceof Frame ? frame.getMask().length : frame.length;
    const frameVersion = resolveVersion(frame) ?? resolveVersion(image);
    const paletteVersion = resolveVersion(palette);
    let paletteHash = null;
    if (paletteVersion == null) {
      paletteHash = hashPalette(2166136261, palette).toString(16);
    }

    const cached = image && this._hashCache.get(image);
    const frameStable = cached
      && cached.frame === frame
      && cached.frameLength === frameLength
      && cached.frameVersion === frameVersion
      && cached.width === width
      && cached.height === height && cached.sourceWidth === geometry.sourceWidth && cached.sourceHeight === geometry.sourceHeight
      && cached.previewIndex === previewIndex && cached.scaleX === geometry.scaleX && cached.scaleY === geometry.scaleY;
    if (
      frameStable
      && cached.palette === palette
      && cached.paletteVersion === paletteVersion
      && cached.paletteHash === paletteHash
    ) {
      return cached.signature;
    }

    const frameHash = frameStable
      ? cached.frameHash
      : hashFrame(2166136261, frame).toString(16);
    let hash = 2166136261;
    hash = hashStep(hash, width);
    hash = hashStep(hash, height);
    hash = hashStep(hash, geometry.sourceWidth); hash = hashStep(hash, geometry.sourceHeight);
    hash = hashStep(hash, previewIndex);
    hash = hashStep(hash, geometry.scaleX); hash = hashStep(hash, geometry.scaleY);
    hash = hashStep(hash, frameLength);
    for (let i = 0; i < frameHash.length; i += 1) {
      hash = hashStep(hash, frameHash.charCodeAt(i));
    }
    const paletteKey = paletteVersion == null ? paletteHash : String(paletteVersion);
    for (let i = 0; i < paletteKey.length; i += 1) {
      hash = hashStep(hash, paletteKey.charCodeAt(i));
    }
    const signature = hash.toString(16);
    if (image) {
      this._hashCache.set(image, {
        frame,
        frameLength,
        frameVersion,
        width,
        height, sourceWidth: geometry.sourceWidth, sourceHeight: geometry.sourceHeight,
        previewIndex, scaleX: geometry.scaleX, scaleY: geometry.scaleY,
        palette,
        paletteVersion,
        paletteHash,
        frameHash,
        signature
      });
      image._previewHash = signature;
    }
    return signature;
  }

  getStats() {
    return {
      memoryEntries: this.memory.size,
      maxMemoryEntries: this.maxMemoryEntries,
      storageAvailable: !!this.storage
    };
  }

  dispose() {
    this.memory.clear();
    this._hashCache = new WeakMap();
  }

  getPreviewUrl({ type, id, image }) {
    if (!type || !image) return null;
    const palette = image.palette || null;
    const frame = pickFrame(image);
    if (!frame || !(frame instanceof Frame) && !palette) return null;

    const signature = this._getImageSignature(image, palette, frame);
    const key = `${CACHE_PREFIX}:v${this.version}:${type}:${id}:${signature}`;
    if (this.memory.has(key)) {
      const cachedMemory = this.memory.get(key);
      this._remember(key, cachedMemory);
      return cachedMemory;
    }

    let cached = null;
    try {
      cached = this.storage?.getItem?.(key) ?? null;
    } catch {
      cached = null;
    }

    if (cached) {
      this._remember(key, cached);
      return cached;
    }

    const url = buildPreviewDataUrl(image, palette, this.document);
    if (url) {
      this._remember(key, url);
      try {
        this.storage?.setItem?.(key, url);
      } catch {
        // ignore storage errors
      }
    }
    return url;
  }
}

export { EditorPreviewCache };
