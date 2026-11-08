import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { isAdmittedPerformanceScene } from './PerformanceScene.js';

const LIMIT = 128 * 1048576, WORKSPACE = 16 * 1048576;
let sequence = 0;
/** @param {string} key @param {unknown} value */
const estimate = (key, value) => {
  const seen = new WeakSet(), pending = [key, value]; let bytes = 2048, nodes = 0;
  while (pending.length) {
    const item = pending.pop();
    if (++nodes > 65536) throw new RangeError('Scene catalog value exceeds its bounded metadata graph.');
    if (item == null || typeof item === 'boolean' || typeof item === 'number') bytes += 16;
    else if (typeof item === 'string') bytes += 64 + item.length * 2;
    else if (typeof item === 'object') {
      if (seen.has(item)) continue; seen.add(item);
      if (isAdmittedPerformanceScene(item)) { bytes += 256; continue; }
      if (item instanceof ArrayBuffer) bytes += 128 + item.byteLength;
      else if (ArrayBuffer.isView(item)) { bytes += 128; pending.push(item.buffer); }
      else if (typeof Blob === 'function' && item instanceof Blob) bytes += 256 + item.size;
      else {
        if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new TypeError('Catalog cache values must be bounded data, buffers, blobs or separately owned admitted scenes.');
        const keys = Object.keys(item); bytes += 256 + keys.length * 32;
        if (keys.length > 65536 || pending.length + keys.length * 2 > 131072) throw new RangeError('Scene catalog metadata graph exceeds its work bound.');
        for (const name of keys) pending.push(name, item[name]);
      }
    } else throw new TypeError('Executable or unsupported catalog metadata cannot be retained.');
    if (bytes > 32 * 1048576) throw new RangeError('One scene catalog value exceeds its retained byte bound.');
  }
  return bytes;
};
/** @param {{ resourceBudget?: import('../../resources/ResourceBudgetContracts.js').ResourceBudgetAdapter | null }} [options] */
export function createSceneCatalogStorage({ resourceBudget = null } = {}) {
  const owner = 'scene-catalog-' + (++sequence), metadata = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'scene-catalog-auxiliary-data', bytes: 4096, maxBytes: LIMIT });
  let construction;
  try { construction = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'scene-catalog-construction', category: 'candidate', bytes: WORKSPACE }); }
  catch (error) { metadata.release(); throw error; }
  const stores = new Set(), funding = [], pending = new Set(), unknown = new Set(), windows = new Map();
  let residentBytes = 4096, creditBytes = 0, closed = false, disposal = null;
  const check = () => { if (closed || unknown.size) throw new Error('The scene catalog storage has retired or retains unknown ownership.'); };
  const resize = (resident, credit) => metadata.resize(Math.max(4096, resident + credit));
  const spend = amount => {
    let left = amount;
    for (const entry of funding) { const take = Math.min(left, entry.remaining); entry.remaining -= take; left -= take; if (!left) break; }
    creditBytes -= amount - left;
    return left;
  };
  /** @extends {Map<string, unknown>} */
  class CatalogMap extends Map {
    constructor() { super(); this.costs = new Map(); stores.add(this); }
    estimate(key, value) { return estimate(key, value); }
    /** @param {string} key @param {unknown} value */
    set(key, value) {
      check(); const bytes = estimate(key, value), previous = this.costs.get(key) || 0, delta = bytes - previous;
      const covered = Math.min(Math.max(0, delta), creditBytes), next = residentBytes + delta, credit = creditBytes - covered;
      resize(next, credit); spend(covered);
      super.set(key, value); this.costs.set(key, bytes); residentBytes = next; return this;
    }
    get(key) { check(); return super.get(key); }
    has(key) { check(); return super.has(key); }
    delete(key) { check(); const cost = this.costs.get(key) || 0; resize(residentBytes - cost, creditBytes); const deleted = super.delete(key); this.costs.delete(key); residentBytes -= cost; return deleted; }
    clear() { check(); let cost = 0; for (const bytes of this.costs.values()) cost += bytes; resize(residentBytes - cost, creditBytes); super.clear(); this.costs.clear(); residentBytes -= cost; }
  }
  const makeMap = () => { check(); return new CatalogMap(); }, roots = makeMap();
  /** @param {ReadonlyArray<readonly [CatalogMap, string, unknown]>} writes */
  const prepay = writes => {
    check(); let bytes = 0;
    for (const [store, key, value] of writes) { if (!stores.has(store)) throw new TypeError('Fund only this catalog’s cache publication.'); bytes += estimate(key, value); if (bytes > LIMIT) throw new RangeError('Scene publication exceeds the auxiliary metadata limit.'); }
    resize(residentBytes, creditBytes + bytes);
    const entry = { remaining: bytes, released: false }; creditBytes += bytes; funding.push(entry);
    return Object.freeze({ release() { if (entry.released) return false; const remainder = entry.remaining; resize(residentBytes, creditBytes - remainder);
      entry.released = true; entry.remaining = 0; creditBytes -= remainder; funding.splice(funding.indexOf(entry), 1); return true; } });
  };
  /**
   * @template {unknown[]} Args
   * @template Result
   * @param {(workspace: import('../../resources/OwnedResourceReservationContracts.js').OwnedResourceReservation, ...args: Args) => Result | PromiseLike<Result>} operation
   * @returns {(...args: Args) => Promise<Result>}
   */
  const trackFactory = operation => async (...args) => {
    check(); if (pending.size >= 2) throw new Error('At most two scene factory operations may own preparation workspace.');
    const workspace = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'scene-factory-workspace', category: 'candidate', bytes: 1048576 });
    const task = Promise.resolve().then(() => { check(); return operation(workspace, ...args); }).then(value => { check(); return value; }).finally(() => {
      try { workspace.release(); } catch (error) { unknown.add(workspace); throw error; }
    });
    pending.add(task);
    try { return await task; } finally { pending.delete(task); }
  };
  const finishConstruction = retainedRoots => {
    check(); if (retainedRoots) roots.set('retained-factory-inputs', retainedRoots);
    if (construction) { const workspace = construction; construction = null; try { workspace.release(); } catch (error) { unknown.add(workspace); throw error; } }
  };
  const retain = (key, value) => roots.set(key, value);
  const retainWindow = (name, bytes, category = 'candidate') => {
    check(); if (windows.has(name)) return windows.get(name).receipt();
    if (typeof name !== 'string' || !name || name.length > 64 || windows.size >= 8 || !Number.isSafeInteger(bytes) || bytes < 4096 || bytes > WORKSPACE) throw new RangeError('Invalid bounded catalog observation window.');
    const storage = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: name, category, bytes }); windows.set(name, storage); return storage.receipt();
  };
  const closeAdmission = () => { closed = true; };
  const settled = async () => { await Promise.allSettled([...pending]); if (unknown.size) throw new Error('Scene factory workspace retirement remains unknown.'); };
  const dispose = () => {
    if (disposal) return disposal; closeAdmission();
    disposal = (async () => {
      await settled();
      if (construction) { const workspace = construction; construction = null; try { workspace.release(); } catch (error) { unknown.add(workspace); throw error; } }
      for (const store of stores) { Map.prototype.clear.call(store); store.costs.clear(); }
      for (const entry of funding) { entry.remaining = 0; entry.released = true; } funding.length = 0; residentBytes = 4096; creditBytes = 0;
      for (const [name, window] of windows) { try { window.release(); windows.delete(name); } catch (error) { unknown.add(window); } }
      if (unknown.size) throw new Error('A scene catalog observation window has unknown retirement.');
      metadata.release();
    })(); return disposal;
  };
  return Object.freeze({ makeMap, retain, retainWindow, prepay, trackFactory, finishConstruction, closeAdmission, settled, dispose,
    diagnostics: () => Object.freeze({ owner, closed, residentBytes, prepaidBytes: creditBytes, maps: stores.size,
      retainedWindows: windows.size, windowBytes: [...windows.values()].reduce((sum, item) => sum + item.receipt().declaredBytes, 0), pendingFactories: pending.size, unknownWorkspaces: unknown.size, constructionWorkspace: !!construction,
      reservation: metadata.receipt(), estimate: 'conservative-referenced-data-and-buffer-inventory;admitted-scenes-owned-by-registry' }) });
}
