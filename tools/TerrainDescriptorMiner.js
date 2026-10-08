import { createHash } from 'node:crypto';

const LIMITS = Object.freeze({ groups: 2048, retainedGroups: 12, widthSources: 4, placements: 8, assets: 256, retainedAssets: 24, retainedPairs: 24, width: 4096, height: 4096 });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rank = map => [...map.values()].sort((a, b) => b.count - a.count || JSON.stringify(a).localeCompare(JSON.stringify(b)));
const sample = level => ({ level: level.id, title: level.title.trim() });

/** Offline measurements of configured classic tile levels; aliases never multiply observations. */
const createTerrainDescriptorMiner = (configs = []) => {
  const packs = new Map(configs.map(config => [config.path, hash(config)]));
  const entries = new Map();
  const beginLevel = (level, theme) => {
    if (level.format !== 'classic-dat' || !Array.isArray(level.aliases) || !level.aliases.length || typeof level.id !== 'string' || !packs.has(level.pack) || level.graphicSet2 || level.generated ||
        !level.id.startsWith(level.pack + '/') || !/^(?:LEVEL|DLVEL)\d+\.DAT#\d+$/i.test(level.id.slice(level.pack.length + 1))) return null;
    if (![level.width, level.height].every(value => Number.isInteger(value) && value > 0) || level.width > LIMITS.width || level.height > LIMITS.height) throw new RangeError('Canonical descriptor dimensions exceed bounds');
    if (!Number.isInteger(level.groundSet) || level.groundSet < 0 || level.groundSet > 15) throw new RangeError('Canonical ground set exceeds bounds');
    if (theme.catalog.length > LIMITS.assets) throw new RangeError('Canonical asset catalog exceeds descriptor bounds');
    const key = level.pack + '/' + level.groundSet;
    let entry = entries.get(key);
    if (!entry) {
      entry = { pack: level.pack, groundSet: level.groundSet, themeId: theme.id, assetSha256: theme.assetSha256,
        levels: [], levelIds: new Set(), widths: new Map(), assets: new Map(), pairs: new Map(), groups: new Map(), omittedGroups: 0 };
      entries.set(key, entry);
    }
    if (entry.assetSha256 !== theme.assetSha256) throw new Error('Canonical scope mixes decoded source art');
    if (entry.levelIds.has(level.id)) return null;
    entry.levelIds.add(level.id);
    const source = sample(level);
    entry.levels.push({ id: level.id, sha256: level.sha256, aliases: level.aliases, width: level.width, height: level.height });
    const observedWidth = entry.widths.get(level.width);
    if (observedWidth) observedWidth.count++;
    else entry.widths.set(level.width, { width: level.width, count: 1, source });
    const available = new Set(theme.catalog.map(asset => asset.id));
    const ids = [...new Set(level.placements.filter(p => available.has(p.id)).map(p => p.id))].sort((a, b) => a - b);
    const add = (map, key, value) => { const previous = map.get(key); if (previous) previous.count++; else map.set(key, { ...value, count: 1, source }); };
    for (const id of ids) add(entry.assets, id, { id });
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) add(entry.pairs, ids[a] + '/' + ids[b], { a: ids[a], b: ids[b] });
    const groupsSeen = new Set();
    return { record(role, placements, groupSource, extra = {}) {
      if (!placements.length || placements.length > LIMITS.placements || placements.some(p => !available.has(p.id))) return;
      const x = Math.min(...placements.map(p => p.x)), y = Math.min(...placements.map(p => p.y));
      const ordered = placements.map(p => ({ id: p.id, x: p.x - x, y: p.y - y, f: p.f }));
      if (ordered.some(p => ![p.x, p.y, p.f].every(Number.isInteger) || p.x > 256 || p.y > 128)) return;
      const groupKey = role + '/' + JSON.stringify([ordered, extra.period || null]);
      if (groupsSeen.has(groupKey)) return;
      groupsSeen.add(groupKey);
      const previous = entry.groups.get(groupKey);
      if (previous) { previous.count++; return; }
      if (entry.groups.size >= LIMITS.groups) { entry.omittedGroups++; return; }
      entry.groups.set(groupKey, { role, placements: ordered, ...(extra.period ? { period: extra.period } : {}),
        source: { ...source, terrainIndices: (groupSource.terrainIndices || []).slice(0, LIMITS.placements) }, count: 1 });
    } };
  };
  const finish = () => [...entries.values()].sort((a, b) => a.pack.localeCompare(b.pack) || a.groundSet - b.groundSet).map(entry => {
    const histogram = [...entry.widths.values()].sort((a, b) => a.width - b.width);
    let cumulative = 0;
    const median = histogram.find(item => (cumulative += item.count) >= Math.ceil(entry.levels.length / 2)).width;
    const groups = [];
    for (const role of ['route', 'repeat', 'erase', 'decoration', 'join', 'overlap']) groups.push(...rank(new Map([...entry.groups].filter(([, group]) => group.role === role))).slice(0, 2));
    const sourceRevision = hash({ config: packs.get(entry.pack), assets: entry.assetSha256, levels: entry.levels });
    return { id: entry.pack + '/' + entry.groundSet + '/' + sourceRevision.slice(0, 12), pack: entry.pack, groundSet: entry.groundSet,
      themeId: entry.themeId, assetSha256: entry.assetSha256, sourceRevision, normalLevelCount: entry.levels.length,
      sourceLevelIds: entry.levels.map(level => level.id),
      widths: { min: histogram[0].width, median, max: histogram.at(-1).width, histogram,
        maxSourceCount: histogram.at(-1).count,
        maxSources: entry.levels.filter(level => level.width === histogram.at(-1).width).slice(0, LIMITS.widthSources).map(level => ({ level: level.id, width: level.width })) },
      assetOccurrence: rank(entry.assets).slice(0, LIMITS.retainedAssets), assetPairs: rank(entry.pairs).slice(0, LIMITS.retainedPairs),
      groups, omittedGroups: entry.omittedGroups };
  });
  return { beginLevel, finish };
};

export { createTerrainDescriptorMiner, LIMITS as TERRAIN_DESCRIPTOR_LIMITS };
