const DEFAULT_RENDER_BUDGET_BYTES = 64 * 1024 * 1024;
const DEFAULT_RENDER_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_RENDER_DIMENSION = 8192;

class ProcgenRenderAllocationError extends Error {}

// Estimates RGBA backing stores and explicitly retained pixel arrays. Browser
// driver copies and allocator overhead are not observable through this ledger.
class ProcgenRenderResources {
  constructor(document, { budgetBytes = DEFAULT_RENDER_BUDGET_BYTES, cacheBytes = DEFAULT_RENDER_CACHE_BYTES, budgetAdapter = null } = {}) {
    this.document = document; this.budgetBytes = Number.isFinite(budgetBytes) ? Math.max(4096, budgetBytes) : DEFAULT_RENDER_BUDGET_BYTES;
    this.cacheLimit = Math.min(this.budgetBytes / 4, Number.isFinite(cacheBytes) ? Math.max(0, cacheBytes) : DEFAULT_RENDER_CACHE_BYTES);
    this.entries = new Map(); this.bytes = 0; this.cacheBytes = 0; this.peakBytes = 0;
    this.evictions = 0; this.allocations = 0; this.failures = 0; this.disposed = false;
    this.contextListeners = new Map();
    this.budgetAdapter = budgetAdapter;
    this.adapterSizes = new WeakMap(); this.reservationsInFlight = new Set();
    this.retirementFailures = 0; this.unreleasedBytes = 0; this.unreleased = new WeakMap();
  }
  _size(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > MAX_RENDER_DIMENSION || height > MAX_RENDER_DIMENSION) {
      throw new ProcgenRenderAllocationError('Display dimensions exceed the supported raster size');
    }
    return width * height * 4;
  }
  _reserve(key, bytes, cache = false, retire = null, kind = typeof key.getContext === 'function' ? 'canvas' : 'pixels') {
    if (this.disposed) throw new ProcgenRenderAllocationError('Display resources have retired');
    const previous = this.entries.get(key), previousBytes = previous?.bytes || 0, unknownBytes = this.unreleased.get(key) || 0;
    if (previous && previousBytes === bytes && previous.cache === cache && previous.kind === kind && (!retire || retire === previous.retire)) { this.touch(key); return; }
    for (const [candidate, entry] of this.entries) {
      if (this.bytes + this.unreleasedBytes - unknownBytes - previousBytes + bytes <= this.budgetBytes && (!cache || this.cacheBytes - (previous?.cache ? previousBytes : 0) + bytes <= this.cacheLimit)) break;
      if (candidate !== key && entry.cache) { this.release(candidate); this.evictions++; }
    }
    if (this.bytes + this.unreleasedBytes - unknownBytes - previousBytes + bytes > this.budgetBytes || cache && this.cacheBytes - (previous?.cache ? previousBytes : 0) + bytes > this.cacheLimit) {
      this.failures++; throw new ProcgenRenderAllocationError('Display backing-store budget exhausted');
    }
    this.reservationsInFlight.add(key);
    try {
      this.budgetAdapter?.reserve?.({ token: key, owner: 'renderer', bytes, previousBytes: this.adapterSizes.get(key) || 0, kind, cache });
      this.adapterSizes.set(key, bytes);
    } finally { this.reservationsInFlight.delete(key); }
    if (unknownBytes) { this.unreleasedBytes -= unknownBytes; this.unreleased.delete(key); }
    this.bytes += bytes - previousBytes;
    this.cacheBytes += (cache ? bytes : 0) - (previous?.cache ? previousBytes : 0);
    this.entries.delete(key); this.entries.set(key, { bytes, cache, kind, retire: retire || previous?.retire });
    this.peakBytes = Math.max(this.peakBytes, this.bytes);
  }
  canvas() {
    const canvas = this.document.createElement('canvas'); this.retireCanvas(canvas);
    if (this.unreleased.get(canvas)) { this._retirementReservation(canvas, 0); throw new ProcgenRenderAllocationError('Canvas backing store cannot be initialized'); }
    this._reserve(canvas, 0);
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
    this._reserve(canvas, Math.max(bytes, old?.bytes || 0), cache, retire || old?.retire);
    if (observeContext) this._listen(canvas);
    try {
      // Shrink before grow: portrait-to-landscape must not temporarily allocate
      // newWidth × oldHeight, larger than either admitted endpoint.
      if (height < canvas.height && width > canvas.width) {
        if (canvas.height !== height) canvas.height = height;
        if (canvas.width !== width) canvas.width = width;
      } else {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
      }
      this._reserve(canvas, bytes, cache, retire || old?.retire);
    } catch (error) { this.release(canvas); this.failures++; throw error; }
    return canvas;
  }
  image(context, width, height, key) {
    if (this.entries.has(key)) throw new ProcgenRenderAllocationError('Image replacement requires an owned transition.');
    this._reserve(key, this._size(width, height));
    try { const image = context.createImageData(width, height); this.allocations++; return image; }
    catch (error) { this.release(key); this.failures++; throw error; }
  }
  replaceImage(context, width, height, previousKey, adopt) {
    const key = {}, image = this.image(context, width, height, key);
    let pixels;
    try { pixels = new Uint32Array(image.data.buffer, image.data.byteOffset, image.data.byteLength / 4); }
    catch (error) { this.release(key); throw error; }
    // The synchronous owner drops both old aliases before the old reservation
    // retires. If adoption throws, retain both leases conservatively for cleanup.
    adopt({ image, pixels, key }); this.release(previousKey); return image;
  }
  retain(key, bytes, kind = 'pixels') { this._reserve(key, bytes, false, null, kind); }
  touch(key) { const entry = this.entries.get(key); if (entry) { this.entries.delete(key); this.entries.set(key, entry); } }
  bytesFor(keys) { return keys.reduce((bytes, key) => bytes + (this.entries.get(key)?.bytes || 0), 0); }
  retireCanvas(canvas) {
    for (const dimension of ['width', 'height']) {
      try { canvas[dimension] = 0; } catch { this.retirementFailures++; }
    }
    const previous = this.unreleased.get(canvas) || 0, retained = Math.max(0, canvas.width * canvas.height * 4) || 0;
    this.unreleasedBytes += retained - previous;
    if (retained) this.unreleased.set(canvas, retained); else this.unreleased.delete(canvas);
  }
  _retirementReservation(key, previousBytes) {
    const retained = this.unreleased.get(key) || 0, sharedBytes = this.adapterSizes.get(key) || 0;
    try {
      if (retained) {
        const bytes = Math.max(previousBytes, sharedBytes, retained);
        this.budgetAdapter?.reserve?.({ token: key, owner: 'renderer', bytes, previousBytes: sharedBytes, kind: 'canvas', cache: false, unreleased: true });
        this.adapterSizes.set(key, bytes);
      } else { this.budgetAdapter?.release?.({ token: key, owner: 'renderer', bytes: sharedBytes }); this.adapterSizes.delete(key); }
    } catch { this.retirementFailures++; }
  }
  release(key) {
    const canvas = typeof key?.getContext === 'function', entry = this.entries.get(key);
    if (!entry) {
      if (canvas) { const previous = this.unreleased.get(key) || 0; this.retireCanvas(key); this._retirementReservation(key, previous); }
      return;
    }
    this.entries.delete(key); this.bytes -= entry.bytes; if (entry.cache) this.cacheBytes -= entry.bytes;
    const listeners = this.contextListeners.get(key);
    if (listeners) {
      try { key.removeEventListener?.('contextlost', listeners[0]); } catch { this.retirementFailures++; }
      try { key.removeEventListener?.('contextrestored', listeners[1]); } catch { this.retirementFailures++; }
      this.contextListeners.delete(key);
    }
    if (canvas) this.retireCanvas(key);
    try { entry.retire?.(); } catch { this.retirementFailures++; }
    this._retirementReservation(key, entry.bytes);
  }
  reclaim(neededBytes, { maximumEvictions = 512 } = {}) {
    if (!Number.isSafeInteger(neededBytes) || neededBytes < 0 || !Number.isSafeInteger(maximumEvictions) || maximumEvictions < 1 || maximumEvictions > 512) throw new Error('Invalid render reclamation request.');
    const accounted = () => this.budgetAdapter?.diagnostics?.().accountedBytes ?? this.bytes + this.unreleasedBytes;
    const before = accounted(); let attempted = 0;
    for (const [key, entry] of this.entries) {
      if (before - accounted() >= neededBytes || attempted >= maximumEvictions) break;
      if (!entry.cache || this.reservationsInFlight.has(key)) continue;
      attempted++; this.release(key); this.evictions++;
    }
    return Object.freeze({ attempted, reclaimedBytes: Math.max(0, before - accounted()), accounting: this.budgetAdapter?.diagnostics ? 'shared-accounted' : 'local-estimated', workLimited: attempted === maximumEvictions && before - accounted() < neededBytes });
  }
  clearCaches() { for (const [key, entry] of this.entries) if (entry.cache && !this.reservationsInFlight.has(key)) this.release(key); }
  clear({ preserveKinds = [] } = {}) { for (const [key, entry] of this.entries) if (!preserveKinds.includes(entry.kind)) this.release(key); }
  getStats() { return { estimatedBytes: this.bytes + this.unreleasedBytes, cachedBitmapBytes: this.cacheBytes, peakEstimatedBytes: this.peakBytes,
    budgetBytes: this.budgetBytes, cacheBudgetBytes: this.cacheLimit, backingStores: this.entries.size,
    allocations: this.allocations, evictions: this.evictions, failures: this.failures, retirementFailures: this.retirementFailures, unreleasedEstimatedBytes: this.unreleasedBytes }; }
  dispose() { if (this.disposed) return; this.clear(); this.document = this.budgetAdapter = this.onContextLost = this.onContextRestored = null; this.disposed = true; }
}

export { ProcgenRenderResources, ProcgenRenderAllocationError, DEFAULT_RENDER_BUDGET_BYTES, DEFAULT_RENDER_CACHE_BYTES, MAX_RENDER_DIMENSION };
