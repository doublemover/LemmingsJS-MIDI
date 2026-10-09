const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
const ROLES = ['route', 'decoration', 'join', 'overlap', 'repeat', 'erase'];
const choose = (items, code) => {
  if (!items.length) return null;
  const total = items.reduce((sum, item) => sum + item.count, 0);
  let position = code % total;
  for (const item of items) { position -= item.count; if (position < 0) return item; }
  return items.at(-1);
};

// Compiled once per exact source revision. Plans reference small measured groups;
// applying a role to gameplay still requires alpha, clearance and seam screening.
class ProcgenTerrainZonePlanner {
  constructor({ descriptor, availableIds, excludedIds = new Set(), eligibleGroups = null, packWidthLimit = descriptor?.widths.max, chunkWidth = 128, cacheLimit = 128 }) {
    if (!descriptor || !Number.isInteger(chunkWidth) || chunkWidth < 1 || !Number.isInteger(packWidthLimit) || packWidthLimit < chunkWidth) throw new TypeError('Canonical zones require measured widths and source art');
    this.descriptor = descriptor; this.chunkWidth = chunkWidth;
    this.widthLimit = Math.min(packWidthLimit, descriptor.widths.max);
    if (!Number.isInteger(this.widthLimit) || this.widthLimit < chunkWidth) throw new TypeError('Canonical width is smaller than one collision chunk');
    this.maximumChunks = Math.floor(this.widthLimit / chunkWidth);
    this.minimumChunks = Math.min(this.maximumChunks, Math.max(1, Math.ceil(descriptor.widths.median / chunkWidth / 2)));
    const available = new Set(availableIds), eligible = id => available.has(id) && !excludedIds.has(id);
    this.groups = descriptor.groups.filter(group => (!eligibleGroups || eligibleGroups.has(group)) && group.placements.every(placement => eligible(placement.id)));
    this.groupsByRole = new Map(ROLES.map(role => [role, this.groups.filter(group => group.role === role)]));
    this.pairs = descriptor.assetPairs.filter(pair => eligible(pair.a) && eligible(pair.b));
    this.revisionCode = parseInt(descriptor.sourceRevision.slice(0, 8), 16) >>> 0;
    this.cacheLimit = Math.max(1, Math.min(256, Math.trunc(cacheLimit) || 128)); this.cache = new Map();
  }
  widthFor(seed) {
    const chunks = this.minimumChunks + mix(seed ^ this.revisionCode) % (this.maximumChunks - this.minimumChunks + 1);
    return chunks * this.chunkWidth;
  }
  zoneAt(seed, worldX) {
    if (!Number.isFinite(worldX)) throw new RangeError('Canonical zone coordinates must be finite');
    const width = this.widthFor(seed), index = Math.max(0, Math.floor(worldX / width)), key = seed + ':' + index;
    let zone = this.cache.get(key); if (zone) return zone;
    const code = mix(seed ^ this.revisionCode ^ Math.imul(index + 1, 0x9e3779b1)), pair = choose(this.pairs, code);
    const groups = [];
    const roleOffset = mix(code ^ 0x51ed270b) % ROLES.length;
    for (let slot = 0; slot < ROLES.length && groups.length < 4; slot++) {
      const roleIndex = (slot + roleOffset) % ROLES.length, candidates = this.groupsByRole.get(ROLES[roleIndex]);
      if (!candidates.length) continue;
      let related = candidates;
      if (pair) {
        const score = group => Number(group.placements.some(p => p.id === pair.a)) + Number(group.placements.some(p => p.id === pair.b));
        const best = Math.max(...candidates.map(score));
        if (best) related = candidates.filter(group => score(group) === best);
      }
      const group = choose(related, mix(code ^ Math.imul(roleIndex + 1, 0x85ebca6b)));
      if (group) groups.push(group);
    }
    zone = { id: this.descriptor.id + ':' + seed + ':' + index, index, start: index * width, end: (index + 1) * width, width,
      maximumAuthoredWidth: this.widthLimit, descriptorId: this.descriptor.id, sourceRevision: this.descriptor.sourceRevision,
      pack: this.descriptor.pack, groundSet: this.descriptor.groundSet, themeId: this.descriptor.themeId, anchorPair: pair, groups };
    if (this.cache.size >= this.cacheLimit) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, zone); return zone;
  }
  reset() { this.cache.clear(); }
}
export { ProcgenTerrainZonePlanner };
