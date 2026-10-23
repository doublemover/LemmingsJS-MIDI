const DEFAULT_LIMIT_BYTES = 512 * 1024 * 1024;
const COST_FACTORS = Object.freeze({ canvas: 1.5, pixels: 1, asset: 1, audio: 1.25,
  checkpoint: 1, export: 2, candidate: 1.25, other: 1 });

export class ResourceBudgetError extends Error {
  constructor(category, requestedBytes, availableBytes) {
    super(`${category} needs ${requestedBytes} accounted bytes; ${availableBytes} are available.`);
    this.name = 'ResourceBudgetError'; this.category = category;
    this.requestedBytes = requestedBytes; this.availableBytes = availableBytes;
  }
}

// Synchronous admission makes a reservation visible before the caller starts
// allocating. Native/GPU overhead remains an estimate and is reported as such.
export function createResourceBudget({ limitBytes = DEFAULT_LIMIT_BYTES, costFactors = COST_FACTORS } = {}) {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 4096) throw new RangeError('Invalid resource budget.');
  const entries = new Map(), evictors = new Map();
  let accountedBytes = 0, residentBytes = 0, estimatedOverheadBytes = 0, peakAccountedBytes = 0;
  let reservations = 0, denials = 0, evictions = 0, retired = false, evicting = false;
  const costFor = (bytes, category) => {
    const factor = costFactors[category] ?? costFactors.other ?? 1;
    if (!Number.isFinite(factor) || factor < 1 || factor > 16) throw new RangeError('Invalid resource estimate factor.');
    return Math.ceil(bytes * factor);
  };
  const reserve = ({ token, owner, generation = 0, kind = 'other', category = kind, bytes,
    previousBytes = null, cache = false, pinned = !cache, reloadable = cache, unreleased = false } = {}) => {
    if (retired) throw new Error('Resource budget is retired.');
    if (token == null || typeof owner !== 'string' || !owner || !Number.isSafeInteger(generation) || generation < 0 ||
        typeof category !== 'string' || !category || !Number.isSafeInteger(bytes) || bytes < 0 ||
        previousBytes != null && (!Number.isSafeInteger(previousBytes) || previousBytes < 0)) throw new TypeError('Invalid resource reservation.');
    let old = entries.get(token);
    if (old && old.owner !== owner) throw new Error('Resource token belongs to another owner.');
    if (old && previousBytes != null && old.bytes !== previousBytes) throw new Error('Stale resource replacement size.');
    const cost = costFor(bytes, category);
    let delta = cost - (old?.cost || 0);
    if (delta > 0 && accountedBytes + delta > limitBytes && !evicting) {
      evicting = true;
      try {
        for (const callback of evictors.values()) {
          const before = entries.size;
          try { callback({ neededBytes: accountedBytes + delta - limitBytes, category, owner }); } catch { /* An evictor cannot admit an allocation. */ }
          evictions += Math.max(0, before - entries.size);
          old = entries.get(token);
          delta = cost - (old?.cost || 0);
          if (accountedBytes + delta <= limitBytes) break;
        }
      } finally { evicting = false; }
    }
    if (accountedBytes + delta > limitBytes) {
      denials++;
      throw new ResourceBudgetError(category, cost, Math.max(0, limitBytes - (accountedBytes - (old?.cost || 0))));
    }
    if (old) { accountedBytes -= old.cost; residentBytes -= old.bytes; estimatedOverheadBytes -= old.cost - old.bytes; }
    if (bytes) {
      entries.set(token, { token, owner, generation, category, bytes, cost, pinned: !!pinned,
        reloadable: !!reloadable, unreleased: !!unreleased });
      accountedBytes += cost; residentBytes += bytes; estimatedOverheadBytes += cost - bytes;
    } else entries.delete(token);
    peakAccountedBytes = Math.max(peakAccountedBytes, accountedBytes); reservations++;
    return Object.freeze({ token, owner, generation, category, bytes, accountedBytes: cost,
      estimatedOverheadBytes: cost - bytes, pinned: !!pinned, reloadable: !!reloadable,
      unreleased: !!unreleased });
  };
  const release = ({ token, owner } = {}) => {
    const entry = entries.get(token);
    if (!entry || owner != null && owner !== entry.owner) return false;
    entries.delete(token); accountedBytes -= entry.cost; residentBytes -= entry.bytes;
    estimatedOverheadBytes -= entry.cost - entry.bytes;
    return true;
  };
  const transfer = ({ token, owner, generation, toOwner, toGeneration = generation } = {}) => {
    const entry = entries.get(token);
    if (!entry || entry.owner !== owner || entry.generation !== generation ||
        typeof toOwner !== 'string' || !toOwner || !Number.isSafeInteger(toGeneration) || toGeneration < 0) throw new Error('Invalid resource lease transfer.');
    entries.set(token, { ...entry, owner: toOwner, generation: toGeneration });
    return Object.freeze({ token, owner: toOwner, generation: toGeneration, category: entry.category,
      bytes: entry.bytes, accountedBytes: entry.cost });
  };
  const registerEvictor = (owner, callback) => {
    if (typeof owner !== 'string' || !owner || typeof callback !== 'function' || evictors.has(owner)) throw new TypeError('Invalid resource evictor.');
    evictors.set(owner, callback);
    return () => { if (evictors.get(owner) === callback) evictors.delete(owner); };
  };
  const diagnostics = () => {
    const categories = {};
    let unreleasedEstimatedBytes = 0;
    for (const entry of entries.values()) {
      const group = categories[entry.category] || { residentBytes: 0, accountedBytes: 0, entries: 0, pinned: 0, reloadable: 0 };
      group.residentBytes += entry.bytes; group.accountedBytes += entry.cost; group.entries++;
      if (entry.pinned) group.pinned++; if (entry.reloadable) group.reloadable++;
      if (entry.unreleased) unreleasedEstimatedBytes += entry.cost;
      categories[entry.category] = group;
    }
    return Object.freeze({ limitBytes, accountedBytes, residentBytes, estimatedOverheadBytes, unreleasedEstimatedBytes,
      peakAccountedBytes, reservations, denials, evictions, retired, categories: Object.freeze(categories) });
  };
  const retire = () => { retired = true; evictors.clear(); return diagnostics(); };
  return { reserve, release, transfer, registerEvictor, diagnostics, retire };
}
