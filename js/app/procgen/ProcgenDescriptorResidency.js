const pairKey = key => {
  const split = key.lastIndexOf(':');
  return key.slice(0, split + 1) + (Number(key.slice(split + 1)) & ~1);
};
const pairKeys = key => [key, key.slice(0, key.lastIndexOf(':') + 1) + (Number(key.slice(key.lastIndexOf(':') + 1)) + 1)];
const IMMUTABLE_FIELDS = new Set(['piece', 'canonicalGroup', 'source', 'entry', 'image', 'frame', 'composite', 'zone', 'progression', 'pattern', 'group', 'route']);
class ProcgenDescriptorResidency {
  constructor(descriptions, plans) {
    this.descriptions = descriptions; this.plans = plans;
    this.pins = new Set(); this.recentEvictions = new Map(); this.pinLimit = 4096;
    this.stats = { descriptorCalls: 0, descriptorHits: 0, descriptorMisses: 0, descriptorRebuilds: 0, descriptorEvictions: 0, growthPlanHits: 0, growthPlanMisses: 0 };
  }
  read(key) {
    this.stats.descriptorCalls++;
    const descriptor = this.descriptions.get(key), pair = pairKey(key);
    if (!descriptor) {
      this.stats.descriptorMisses++;
      if (this.recentEvictions.has(pair)) this.stats.descriptorRebuilds++;
      return null;
    }
    this.stats.descriptorHits++;
    for (const sibling of pairKeys(pair)) {
      const value = this.descriptions.get(sibling);
      if (value) { this.descriptions.delete(sibling); this.descriptions.set(sibling, value); }
    }
    return descriptor;
  }
  retain(interests) {
    this.pins.clear();
    const lanes = [];
    for (const [seed, chunks] of interests) {
      const pairs = new Set();
      for (const chunk of chunks) if (Number.isInteger(chunk) && chunk >= 0) pairs.add(`${seed}:${chunk & ~1}`);
      if (pairs.size) lanes.push(pairs.values());
    }
    // One round per live seed prevents a long scattered lane taking all pins.
    let pending = true;
    while (pending && this.pins.size < this.pinLimit) {
      pending = false;
      for (const lane of lanes) {
        const next = lane.next();
        if (!next.done) { this.pins.add(next.value); pending = true; }
        if (this.pins.size >= this.pinLimit) break;
      }
    }
    return this.pins.size * 2 + 256;
  }
  trim(limit, incoming = 0) {
    while (this.descriptions.size + incoming > Math.max(2, limit)) {
      let oldest;
      for (const key of this.descriptions.keys()) if (!this.pins.has(pairKey(key))) { oldest = pairKey(key); break; }
      oldest ??= pairKey(this.descriptions.keys().next().value);
      for (const key of pairKeys(oldest)) { this.descriptions.delete(key); this.plans.delete(key); }
      this.stats.descriptorEvictions++;
      this.recentEvictions.delete(oldest); this.recentEvictions.set(oldest, true);
      while (this.recentEvictions.size > 128) this.recentEvictions.delete(this.recentEvictions.keys().next().value);
    }
  }
  clear() { this.pins.clear(); this.recentEvictions.clear(); }
  snapshot() {
    let typedPayloadBytes = 0, estimatedMetadataBytes = 0;
    const seen = new Set(), buffers = new Set();
    const visit = value => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (ArrayBuffer.isView(value)) {
        if (!buffers.has(value.buffer)) { buffers.add(value.buffer); typedPayloadBytes += value.buffer.byteLength; }
        return;
      }
      const entries = Object.entries(value); estimatedMetadataBytes += 32 + entries.length * 16;
      for (const [key, child] of entries) if (!IMMUTABLE_FIELDS.has(key)) visit(child);
    };
    for (const value of this.descriptions.values()) visit(value);
    for (const value of this.plans.values()) visit(value);
    return { ...this.stats, pinnedDescriptorPairs: this.pins.size, descriptorPinLimit: this.pinLimit,
      cachedGrowthPlans: this.plans.size, descriptorTypedPayloadBytes: typedPayloadBytes,
      descriptorEstimatedMetadataBytes: estimatedMetadataBytes, recentDescriptorEvictions: this.recentEvictions.size };
  }
}
export { ProcgenDescriptorResidency };
