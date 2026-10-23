const DEFAULT_RENDER_BUDGET_BYTES = 64 * 1024 * 1024;
const DEFAULT_RENDER_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_RENDER_DIMENSION = 8192;

class ProcgenRenderAllocationError extends Error {}

// Estimates RGBA backing stores and explicitly retained pixel arrays. Browser
// driver copies and allocator overhead are not observable through this ledger.
class ProcgenRenderResources {
  constructor(document, { budgetBytes = DEFAULT_RENDER_BUDGET_BYTES, cacheBytes = DEFAULT_RENDER_CACHE_BYTES, budgetAdapter = null } = {}) {
    this.document = document; this.budgetBytes = Math.max(4096, budgetBytes);
    this.cacheLimit = Math.min(this.budgetBytes / 4, Math.max(0, cacheBytes));
    this.entries = new Map(); this.bytes = 0; this.cacheBytes = 0; this.peakBytes = 0;
    this.evictions = 0; this.allocations = 0; this.failures = 0; this.disposed = false;
    this.contextListeners = new Map();
    this.budgetAdapter = budgetAdapter;
  }
  _size(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > MAX_RENDER_DIMENSION || height > MAX_RENDER_DIMENSION) {
      throw new ProcgenRenderAllocationError('Display dimensions exceed the supported raster size');
    }
    return width * height * 4;
  }
  _reserve(key, bytes, cache = false, retire = null) {
    if (this.disposed) throw new ProcgenRenderAllocationError('Display resources have retired');
    const previous = this.entries.get(key), previousBytes = previous?.bytes || 0;
    for (const [candidate, entry] of this.entries) {
      if (this.bytes - previousBytes + bytes <= this.budgetBytes && (!cache || this.cacheBytes - (previous?.cache ? previousBytes : 0) + bytes <= this.cacheLimit)) break;
      if (candidate !== key && entry.cache) { this.release(candidate); this.evictions++; }
    }
    if (this.bytes - previousBytes + bytes > this.budgetBytes || cache && this.cacheBytes - (previous?.cache ? previousBytes : 0) + bytes > this.cacheLimit) {
      this.failures++; throw new ProcgenRenderAllocationError('Display backing-store budget exhausted');
    }
    this.budgetAdapter?.reserve?.({ token: key, owner: 'renderer', bytes, previousBytes, kind: typeof key.getContext === 'function' ? 'canvas' : 'pixels', cache });
    this.bytes += bytes - previousBytes;
    this.cacheBytes += (cache ? bytes : 0) - (previous?.cache ? previousBytes : 0);
    this.entries.delete(key); this.entries.set(key, { bytes, cache, retire: retire || previous?.retire });
    this.peakBytes = Math.max(this.peakBytes, this.bytes);
  }
  canvas() {
    const canvas = this.document.createElement('canvas'); canvas.width = canvas.height = 0;
    this._reserve(canvas, 0, false, () => { canvas.width = canvas.height = 0; });
    this._listen(canvas);
    return canvas;
  }
  _listen(canvas) {
    if (this.contextListeners.has(canvas) || !this.onContextLost) return;
    const lost = event => this.onContextLost?.(event), restored = () => this.onContextRestored?.();
    canvas.addEventListener?.('contextlost', lost); canvas.addEventListener?.('contextrestored', restored);
    this.contextListeners.set(canvas, [lost, restored]);
  }
  resize(canvas, width, height, { cache = false, retire, observeContext = true } = {}) {
    const bytes = this._size(width, height);
    const old = this.entries.get(canvas);
    this._reserve(canvas, bytes, cache, retire || old?.retire || (() => { canvas.width = canvas.height = 0; }));
    if (observeContext) this._listen(canvas);
    try {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    } catch (error) { this.release(canvas); this.failures++; throw error; }
    return canvas;
  }
  image(context, width, height, key) {
    this._reserve(key, this._size(width, height));
    try { const image = context.createImageData(width, height); this.allocations++; return image; }
    catch (error) { this.release(key); this.failures++; throw error; }
  }
  retain(key, bytes) { this._reserve(key, bytes); }
  touch(key) { const entry = this.entries.get(key); if (entry) { this.entries.delete(key); this.entries.set(key, entry); } }
  bytesFor(keys) { return keys.reduce((bytes, key) => bytes + (this.entries.get(key)?.bytes || 0), 0); }
  release(key) {
    const entry = this.entries.get(key); if (!entry) return;
    this.entries.delete(key); this.bytes -= entry.bytes; if (entry.cache) this.cacheBytes -= entry.bytes;
    try { this.budgetAdapter?.release?.({ token: key, owner: 'renderer', bytes: entry.bytes }); } catch { /* Shared accounting cannot interrupt backing-store retirement. */ }
    const listeners = this.contextListeners.get(key);
    if (listeners) { key.removeEventListener?.('contextlost', listeners[0]); key.removeEventListener?.('contextrestored', listeners[1]); this.contextListeners.delete(key); }
    try { entry.retire?.(); } catch { /* Retirement continues through detached/failed browser surfaces. */ }
  }
  clearCaches() { for (const [key, entry] of this.entries) if (entry.cache) this.release(key); }
  getStats() { return { estimatedBytes: this.bytes, cachedBitmapBytes: this.cacheBytes, peakEstimatedBytes: this.peakBytes,
    budgetBytes: this.budgetBytes, cacheBudgetBytes: this.cacheLimit, backingStores: this.entries.size,
    allocations: this.allocations, evictions: this.evictions, failures: this.failures }; }
  dispose() { if (this.disposed) return; for (const key of this.entries.keys()) this.release(key); this.document = this.budgetAdapter = this.onContextLost = this.onContextRestored = null; this.disposed = true; }
}

export { ProcgenRenderResources, ProcgenRenderAllocationError, DEFAULT_RENDER_BUDGET_BYTES, DEFAULT_RENDER_CACHE_BYTES, MAX_RENDER_DIMENSION };
