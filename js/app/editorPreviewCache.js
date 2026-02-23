import { getRuntimeDependency } from '../core/dependencies.js';

const CACHE_PREFIX = 'lemmings.editor.preview';
const CACHE_VERSION = 1;
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
  for (let i = 0; i < frame.length; i++) {
    hash = hashStep(hash, frame[i]);
  }
  return hash;
};

const pickFrame = (image) => {
  const frames = image?.frames || [];
  const previewIndex = Number.isFinite(image?.preview_image_index)
    ? image.preview_image_index
    : 0;
  return frames[previewIndex] || frames[0] || null;
};

const buildPreviewDataUrl = (image, palette, document) => {
  if (!image || !palette || !document) return null;
  const width = Math.max(0, image.width || 0);
  const height = Math.max(0, image.height || 0);
  const frame = pickFrame(image);
  if (!frame || width === 0 || height === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!ctx) return null;
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  for (let i = 0; i < frame.length; i++) {
    const idx = frame[i];
    const out = i * 4;
    if (idx & 0x80) {
      data[out + 3] = 0;
      continue;
    }
    const color = palette.getColor(idx & 0x7f) >>> 0;
    data[out] = color & 0xff;
    data[out + 1] = (color >> 8) & 0xff;
    data[out + 2] = (color >> 16) & 0xff;
    data[out + 3] = (color >> 24) & 0xff;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
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

  getPreviewUrl({ type, id, image }) {
    if (!type || !image) return null;
    const palette = image.palette || null;
    const frame = pickFrame(image);
    if (!frame || !palette) return null;

    let signature = image._previewHash;
    if (!signature) {
      let hash = 2166136261;
      hash = hashStep(hash, image.width || 0);
      hash = hashStep(hash, image.height || 0);
      hash = hashPalette(hash, palette);
      hash = hashFrame(hash, frame);
      signature = hash.toString(16);
      image._previewHash = signature;
    }

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
