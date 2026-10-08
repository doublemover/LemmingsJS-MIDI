const NORMAL_ROLES = new Set(['route', 'repeat', 'erase', 'decoration', 'join', 'overlap']);
const SHA256 = /^[a-f0-9]{64}$/;
const packName = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
const assetId = value => Number.isInteger(value) && value >= 0 && value < 256;

const validateTerrainDescriptors = descriptors => {
  if (!Array.isArray(descriptors) || descriptors.length > 256) throw new TypeError('Invalid canonical terrain descriptors');
  const identities = new Set();
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor.pack !== 'string' || !descriptor.pack || !Number.isInteger(descriptor.groundSet) || descriptor.groundSet < 0 || descriptor.groundSet > 15 ||
      !SHA256.test(descriptor.sourceRevision) || !SHA256.test(descriptor.assetSha256) || !Number.isInteger(descriptor.normalLevelCount) || descriptor.normalLevelCount < 1 || descriptor.normalLevelCount > 4096) throw new TypeError('Invalid canonical descriptor provenance');
    const identity = descriptor.pack + '/' + descriptor.groundSet;
    if (identities.has(identity)) throw new TypeError('Duplicate canonical descriptor scope');
    identities.add(identity);
    if (!Array.isArray(descriptor.sourceLevelIds) || descriptor.sourceLevelIds.length !== descriptor.normalLevelCount ||
      descriptor.sourceLevelIds.some(id => typeof id !== 'string' || !id.startsWith(descriptor.pack + '/') || !/^(?:LEVEL|DLVEL)\d+\.DAT#\d+$/i.test(id.slice(descriptor.pack.length + 1)))) throw new TypeError('Invalid canonical source levels');
    const sourceIds = new Set(descriptor.sourceLevelIds);
    if (sourceIds.size !== descriptor.normalLevelCount) throw new TypeError('Duplicate canonical source levels');
    const source = value => value && sourceIds.has(value.level);
    const widths = descriptor.widths;
    let cumulative = 0;
    const measuredMedian = Array.isArray(widths?.histogram) ? widths.histogram.find(item => (cumulative += item.count) >= Math.ceil(descriptor.normalLevelCount / 2))?.width : null;
    if (!widths || ![widths.min, widths.median, widths.max].every(width => Number.isInteger(width) && width > 0 && width <= 4096) || widths.min > widths.median || widths.median > widths.max || !Array.isArray(widths.histogram) || widths.histogram.length < 1 || widths.histogram.length > 4096 || widths.min !== widths.histogram[0].width || widths.max !== widths.histogram.at(-1).width || widths.median !== measuredMedian ||
      widths.histogram.reduce((sum, item) => sum + (Number.isInteger(item.count) && item.count > 0 ? item.count : NaN), 0) !== descriptor.normalLevelCount ||
      widths.histogram.some((item, index) => !Number.isInteger(item.width) || item.width < widths.min || item.width > widths.max || !source(item.source) || index > 0 && item.width <= widths.histogram[index - 1].width) ||
      widths.maxSourceCount !== widths.histogram.at(-1).count || !Array.isArray(widths.maxSources) || widths.maxSources.length < 1 || widths.maxSources.length > 4 || widths.maxSources.length > widths.maxSourceCount || new Set(widths.maxSources.map(item => item.level)).size !== widths.maxSources.length ||
      widths.maxSources.some(item => !source(item) || item.width !== widths.max)) throw new TypeError('Invalid canonical width measurements');
    if (!Array.isArray(descriptor.groups) || descriptor.groups.length > 12) throw new TypeError('Unbounded canonical descriptor groups');
    for (const group of descriptor.groups) {
      if (!NORMAL_ROLES.has(group.role) || !Number.isInteger(group.count) || group.count < 1 || group.count > descriptor.normalLevelCount || !Array.isArray(group.placements) || group.placements.length < 1 || group.placements.length > 8 ||
        !source(group.source) || !Array.isArray(group.source.terrainIndices) || group.source.terrainIndices.length > 8 || group.source.terrainIndices.some(index => !Number.isInteger(index) || index < 0 || index >= 4096) ||
        group.role === 'route' && group.period == null ||
        group.period != null && (!Number.isInteger(group.period) || group.period < 1 || group.period > 256) ||
        group.placements.some(p => ![p.id, p.x, p.y, p.f].every(Number.isInteger) || !assetId(p.id) || p.x < 0 || p.x > 256 || p.y < 0 || p.y > 128 || p.f < 0 || p.f > 31)) throw new TypeError('Invalid observed canonical group');
    }
    if (!Array.isArray(descriptor.assetOccurrence) || descriptor.assetOccurrence.length > 24 || !Array.isArray(descriptor.assetPairs) || descriptor.assetPairs.length > 24 ||
      [...descriptor.assetOccurrence, ...descriptor.assetPairs].some(item => !Number.isInteger(item.count) || item.count < 1 || item.count > descriptor.normalLevelCount || !source(item.source)) ||
      descriptor.assetOccurrence.some(item => !assetId(item.id)) || descriptor.assetPairs.some(item => !assetId(item.a) || !assetId(item.b) || item.a >= item.b)) throw new TypeError('Invalid canonical asset co-occurrence');
  }
  return descriptors;
};

// Call when a source book/art revision is loaded, never from a simulation frame.
const selectTerrainDescriptor = (book, { packPath = '', groundSet = 0, assetSha256 = null, sourceRevision = null } = {}) => {
  if (!SHA256.test(assetSha256)) return null;
  const pack = packName(packPath);
  return (book?.descriptors || []).find(descriptor => descriptor.pack === pack && descriptor.groundSet === groundSet &&
    descriptor.assetSha256 === assetSha256 && (!sourceRevision || descriptor.sourceRevision === sourceRevision)) || null;
};
const getPackTerrainWidthLimit = (book, packPath) => {
  const pack = packName(packPath);
  return (book?.descriptors || []).reduce((width, descriptor) => descriptor.pack === pack ? Math.max(width, descriptor.widths.max) : width, 0);
};

const fingerprintTerrainImages = async images => {
  if (!globalThis.crypto?.subtle) return null;
  const chunks = [];
  for (const image of images) chunks.push(Uint8Array.of(image.width, image.height), Uint8Array.from(image.frames[0]), new Uint8Array(image.palette.data.buffer));
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0)); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
};

export { fingerprintTerrainImages, getPackTerrainWidthLimit, selectTerrainDescriptor, validateTerrainDescriptors };
