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
export function createResourceBudget({ limitBytes = DEFAULT_LIMIT_BYTES, costFactors = COST_FACTORS, now = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
  if (typeof now !== 'function' || !Number.isSafeInteger(limitBytes) || limitBytes < 4096) throw new RangeError('Invalid resource budget.');
  const entries = new Map(), evictors = new Map(), categoryCurrent = new Map(), categoryPeaks = new Map();
  let accountedBytes = 0, residentBytes = 0, estimatedOverheadBytes = 0, peakAccountedBytes = 0;
  let reservations = 0, denials = 0, evictions = 0, retired = false, evicting = false, revision = 0, evictionTurn = 0;
  let admissionDurationMs = 0, peakAdmissionDurationMs = 0, categoryPeakCoverage = 'complete';
  const categoryChange = (category, bytes) => { const next = (categoryCurrent.get(category) || 0) + bytes; if (next) categoryCurrent.set(category, next); else categoryCurrent.delete(category);
    if (categoryPeaks.has(category) || categoryPeaks.size < 256) categoryPeaks.set(category, Math.max(categoryPeaks.get(category) || 0, next)); else categoryPeakCoverage = 'truncated-at-256-categories'; };
  const nextRevision = () => { if (!Number.isSafeInteger(revision + 1)) throw new Error('Resource lease revision exhausted.'); return ++revision; };
  const costFor = (bytes, category) => {
    const factor = Object.hasOwn(costFactors, category) ? costFactors[category] : costFactors.other ?? 1;
    if (!Number.isFinite(factor) || factor < 1 || factor > 16) throw new RangeError('Invalid resource estimate factor.');
    const cost = Math.ceil(bytes * factor); if (!Number.isSafeInteger(cost)) throw new RangeError('Resource estimate exceeds exact accounting range.'); return cost;
  };
  const reserveInternal = ({ token, owner, generation = 0, kind = 'other', category = kind, bytes,
    previousBytes = null, cache = false, pinned = !cache, reloadable = cache, unreleased = false } = {}) => {
    if (retired) throw new Error('Resource budget is retired.');
    if (token == null || typeof owner !== 'string' || !owner || !Number.isSafeInteger(generation) || generation < 0 ||
        typeof category !== 'string' || !category || category.length > 64 || !Number.isSafeInteger(bytes) || bytes < 0 ||
        previousBytes != null && (!Number.isSafeInteger(previousBytes) || previousBytes < 0)) throw new TypeError('Invalid resource reservation.');
    let old = entries.get(token);
    if (old && (old.owner !== owner || old.generation !== generation)) throw new Error('Resource token belongs to another owner or generation.');
    const expected = old;
    const revalidate = () => { if (retired) throw new Error('Resource budget retired during eviction.'); if (entries.get(token) !== expected) throw new Error('Resource target lease changed during eviction.'); };
    if (old && previousBytes != null && old.bytes !== previousBytes) throw new Error('Stale resource replacement size.');
    const cost = costFor(bytes, category);
    let delta = cost - (old?.cost || 0);
    if (delta > 0 && accountedBytes + delta > limitBytes && !evicting) {
      evicting = true;
      try {
        const ordered = [...evictors.values()].sort((a, b) => a.priority - b.priority || a.lastTurn - b.lastTurn || a.order - b.order);
        for (const entry of ordered) {
          if (evictors.get(entry.owner) !== entry) continue;
          const beforeEntries = entries.size, beforeBytes = accountedBytes; entry.calls++; entry.lastTurn = ++evictionTurn;
          try { entry.callback({ neededBytes: accountedBytes + delta - limitBytes, category, owner, targetRevision: expected?.revision ?? null, evictionPriority: entry.priority }); }
          catch { entry.failures++; }
          const removed = Math.max(0, beforeEntries - entries.size), reclaimed = Math.max(0, beforeBytes - accountedBytes);
          evictions += removed; entry.evictions += removed; entry.reclaimedBytes += reclaimed; if (!reclaimed) entry.misses++;
          revalidate(); old = entries.get(token); delta = cost - (old?.cost || 0);
          if (accountedBytes + delta <= limitBytes) break;
        }
      } finally { evicting = false; }
    }
    revalidate();
    if (previousBytes != null && (old?.bytes ?? 0) !== previousBytes) throw new Error('Stale resource replacement size after eviction.');
    if (accountedBytes + delta > limitBytes) {
      denials++;
      throw new ResourceBudgetError(category, cost, Math.max(0, limitBytes - (accountedBytes - (old?.cost || 0))));
    }
    const leaseRevision = nextRevision();
    if (old) { categoryChange(old.category, -old.cost); accountedBytes -= old.cost; residentBytes -= old.bytes; estimatedOverheadBytes -= old.cost - old.bytes; }
    if (bytes) {
      entries.set(token, { token, owner, generation, revision: leaseRevision, category, bytes, cost, pinned: !!pinned,
        reloadable: !!reloadable, unreleased: !!unreleased });
      categoryChange(category, cost); accountedBytes += cost; residentBytes += bytes; estimatedOverheadBytes += cost - bytes;
    } else entries.delete(token);
    peakAccountedBytes = Math.max(peakAccountedBytes, accountedBytes); reservations++;
    return Object.freeze({ token, owner, generation, revision: leaseRevision, category, bytes, accountedBytes: cost,
      estimatedOverheadBytes: cost - bytes, pinned: !!pinned, reloadable: !!reloadable,
      unreleased: !!unreleased });
  };
  const clock = () => { try { const value = now(); return Number.isFinite(value) ? value : 0; } catch { return 0; } };
  const reserve = input => { const start = clock(); try { return reserveInternal(input); } finally { const elapsed = Math.max(0, clock() - start); if (Number.isFinite(elapsed)) { admissionDurationMs += elapsed; peakAdmissionDurationMs = Math.max(peakAdmissionDurationMs, elapsed); } } };
  const release = ({ token, owner, generation = null, revision: expectedRevision = null } = {}) => {
    const entry = entries.get(token);
    if (!entry || owner != null && owner !== entry.owner || generation != null && generation !== entry.generation || expectedRevision != null && expectedRevision !== entry.revision) return false;
    entries.delete(token); categoryChange(entry.category, -entry.cost); accountedBytes -= entry.cost; residentBytes -= entry.bytes;
    estimatedOverheadBytes -= entry.cost - entry.bytes;
    return true;
  };
  const transfer = ({ token, owner, generation, toOwner, toGeneration = generation, revision: expectedRevision = null } = {}) => {
    const entry = entries.get(token);
    if (!entry || entry.owner !== owner || entry.generation !== generation || expectedRevision != null && expectedRevision !== entry.revision ||
        typeof toOwner !== 'string' || !toOwner || !Number.isSafeInteger(toGeneration) || toGeneration < 0) throw new Error('Invalid resource lease transfer.');
    const leaseRevision = nextRevision(); entries.set(token, { ...entry, owner: toOwner, generation: toGeneration, revision: leaseRevision });
    return Object.freeze({ token, owner: toOwner, generation: toGeneration, revision: leaseRevision, category: entry.category,
      bytes: entry.bytes, accountedBytes: entry.cost });
  };
  const registerEvictor = (owner, callback, { priority = 0 } = {}) => {
    if (retired || typeof owner !== 'string' || !owner || owner.length > 256 || typeof callback !== 'function' || evictors.has(owner) || evictors.size >= 1024 || !Number.isSafeInteger(priority) || Math.abs(priority) > 16) throw new TypeError('Invalid resource evictor.');
    const entry = { owner, callback, priority, order: ++evictionTurn, lastTurn: 0, calls: 0, failures: 0, misses: 0, evictions: 0, reclaimedBytes: 0 }; evictors.set(owner, entry);
    return () => { if (evictors.get(owner) === entry) evictors.delete(owner); };
  };
  const diagnostics = () => {
    const categories = Object.create(null);
    let unreleasedEstimatedBytes = 0;
    for (const entry of entries.values()) {
      const group = categories[entry.category] || { residentBytes: 0, accountedBytes: 0, entries: 0, pinned: 0, reloadable: 0 };
      group.residentBytes += entry.bytes; group.accountedBytes += entry.cost; group.entries++;
      if (entry.pinned) group.pinned++; if (entry.reloadable) group.reloadable++;
      if (entry.unreleased) unreleasedEstimatedBytes += entry.cost;
      categories[entry.category] = group;
    }
    return Object.freeze({ limitBytes, accountedBytes, residentBytes, estimatedOverheadBytes, unreleasedEstimatedBytes,
      peakAccountedBytes, reservations, denials, evictions, retired, admissionDurationMs, peakAdmissionDurationMs, queueWaitMs: 0, admissionPolicy: 'synchronous-reject-or-admit',
      categoryPeakCoverage, categoryPeaks: Object.freeze(Object.fromEntries(categoryPeaks)), evictionPolicy: 'priority-then-least-recently-served',
      evictionOwners: Object.freeze([...evictors.values()].map(entry => Object.freeze({ owner: entry.owner, priority: entry.priority, calls: entry.calls, failures: entry.failures, misses: entry.misses, evictions: entry.evictions, reclaimedBytes: entry.reclaimedBytes }))), categories: Object.freeze(categories) });
  };
  const inspectOwners = ({ maximum = 64 } = {}) => {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 256) throw new RangeError('Invalid resource owner inspection bound.');
    const owners = new Map(); let omittedEntries = 0, omittedAccountedBytes = 0;
    for (const entry of entries.values()) { const key = entry.owner + ':' + entry.generation; let value = owners.get(key);
      if (!value && owners.size >= maximum) { omittedEntries++; omittedAccountedBytes += entry.cost; continue; }
      if (!value) { value = { owner: entry.owner, generation: entry.generation, entries: 0, residentBytes: 0, accountedBytes: 0, pinned: 0, unreleased: 0 }; owners.set(key, value); }
      value.entries++; value.residentBytes += entry.bytes; value.accountedBytes += entry.cost; value.pinned += Number(entry.pinned); value.unreleased += Number(entry.unreleased);
    }
    const ordered = [...owners.values()].sort((a, b) => b.accountedBytes - a.accountedBytes || a.owner.localeCompare(b.owner) || a.generation - b.generation);
    return Object.freeze({ status: omittedEntries ? 'truncated' : 'complete', omittedEntries, omittedAccountedBytes, owners: Object.freeze(ordered.map(Object.freeze)) });
  };
  const retire = () => { retired = true; evictors.clear(); return diagnostics(); };
  return { reserve, release, transfer, registerEvictor, diagnostics, inspectOwners, retire };
}
