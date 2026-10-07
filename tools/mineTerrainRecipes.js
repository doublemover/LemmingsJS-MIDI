import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { NodeFileProvider } from './NodeFileProvider.js';
import { FileContainer } from '../js/data/FileContainer.js';
import { LevelReader } from '../js/level/LevelReader.js';
import { LevelIndexResolve } from '../js/level/LevelIndexResolve.js';
import { GroundReader, loadSteelSprites } from '../js/level/GroundReader.js';
import { NxlvParser } from '../js/editor/NxlvParser.js';
import { getStyle, resolveTerrainId } from '../js/editor/StyleRegistry.js';
import { ERASE, FLIP_Y, NO_OVERWRITE, FLIP_X, stampRecipePlacements, getRecipeTopProfile, validateTerrainRecipeBook } from '../js/app/procgen/ProcgenTerrainRecipes.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LIMITS = { files: 20000, levels: 4096, terrainPerLevel: 4096, pixelsPerLevel: 4000000, representatives: 8 };
const SKIP = new Set(['.git', 'node_modules', 'exports', 'temp', 'dist', 'coverage', '.agents', '.codex']);
const names = { lemmings: ['dirt', 'fire', 'squasher', 'pillar', 'crystal'], lemmings_ohNo: ['brick', 'rock', 'snow', 'bubble'] };
const round = n => Math.round(n * 1000) / 1000;
const add = (map, key, value, amount = 1) => { const entry = map.get(key); if (entry) entry.count += amount; else map.set(key, { ...value, count: amount }); };
const top = (map, count = 8) => [...map.values()].sort((a, b) => b.count - a.count || JSON.stringify(a).localeCompare(JSON.stringify(b))).slice(0, count);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const flags = p => (p.isErase ? ERASE : 0) | (p.isUpsideDown ? FLIP_Y : 0) | (p.noOverwrite ? NO_OVERWRITE : 0) | (p.isFlippedHorizontally ? FLIP_X : 0);
const placement = t => ({ id: t.id, x: t.x, y: t.y, f: flags(t.drawProperties || {}) });

async function discover(root) {
  const files = [], pending = [''];
  while (pending.length) {
    const directory = pending.shift();
    for (const entry of (await fs.readdir(path.join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || SKIP.has(entry.name)) continue;
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(relative);
      else if (entry.isFile()) files.push(relative);
      if (files.length > LIMITS.files) throw new Error(`Source inventory exceeds ${LIMITS.files} files`);
    }
  }
  return files.sort();
}

const summarizeImage = (image, id) => {
  let solid = 0;
  for (const pixel of image.frames[0]) if (!(pixel & 128)) solid++;
  return { id, width: image.width, height: image.height, solidRatio: round(solid / (image.width * image.height)), isSteel: !!image.isSteel };
};

const sourceRef = (level, indices = []) => ({ level: level.id, title: level.title, ...(indices.length ? { terrainIndices: indices } : {}) });

function makeTheme(id, family, hash, images) {
  return { id, family, assetSha256: hash, sources: [], counts: { physicalLevels: 0, configuredAliases: 0, terrainPlacements: 0,
    erasers: 0, noOverwrite: 0, upsideDown: 0, horizontalFlip: 0, bboxJoins: 0, bboxOverlaps: 0, repeatedVectors: 0, repeatedGroups: 0,
    emptyColumnGaps: 0, surfaceLedges: 0, decorationCandidates: 0 }, catalog: images.filter(p => p.width && p.height).map(p => summarizeImage(p, p.id)),
  routes: [], motifs: { joins: [], overlaps: [], repeats: [], repeatingGroups: [], erasers: [], gaps: [], ledges: [], decoration: [] },
  _images: images, _pieces: new Map(images.map(p => [p.id, p])), _joins: new Map(), _overlaps: new Map(), _repeats: new Map(), _groups: new Map(),
  _gaps: new Map(), _ledges: new Map(), _routes: new Map(), _decor: new Map(), _erasers: new Map(), _usage: new Map() };
}

function routeCandidate(theme, a, dx, source, observedCount, group = [a]) {
  const image = theme._pieces.get(a.id);
  if (!image || group.some(p => theme._pieces.get(p.id).isSteel || (p.f & ERASE)) || dx < 2 || dx > 256) return;
  const minX = Math.min(...group.map(p => p.x)), minY = Math.min(...group.map(p => p.y));
  const unit = group.map(p => ({ id: p.id, x: p.x - minX, y: p.y - minY, f: p.f }));
  const extent = Math.max(...unit.map(p => p.x + theme._pieces.get(p.id).width));
  if (dx > extent) return;
  const key = `${dx}/${JSON.stringify(unit)}`;
  if (theme._routes.has(key)) { theme._routes.get(key).count += observedCount; return; }
  const width = dx * 3, height = Math.max(...unit.map(p => p.y + theme._pieces.get(p.id).height));
  const placements = [];
  for (let repeat = Math.floor(-extent / dx); repeat <= Math.ceil((width + extent) / dx); repeat++) {
    for (const p of unit) placements.push({ ...p, x: repeat * dx + p.x });
  }
  const { mask } = stampRecipePlacements({ placements, terrainPieces: theme._pieces, width, height });
  const profile = [...getRecipeTopProfile(mask, width, height)].slice(dx, dx * 2);
  if (profile.some(y => y < 0)) return;
  let maxStep = 0, minThickness = height;
  for (let x = 0; x < dx; x++) {
    maxStep = Math.max(maxStep, Math.abs(profile[x] - profile[(x + 1) % dx]));
    let thickness = 0;
    while (profile[x] + thickness < height && mask[(profile[x] + thickness) * width + dx + x]) thickness++;
    minThickness = Math.min(minThickness, thickness);
  }
  const low = Math.min(...profile), high = Math.max(...profile);
  if (high - low > 10 || maxStep > 5 || minThickness < 3) return;
  theme._routes.set(key, { id: `${theme.id}/repeat-${a.id}-${a.f}-${dx}${unit.length > 1 ? `-${sha(JSON.stringify(unit)).slice(0, 6)}` : ''}`, period: dx, topOffset: high,
    profileRange: [low - high, 0], maxStep, minThickness, placements: unit,
    formula: `repeat ordered ${unit.length}-piece group at (n * ${dx}, baseline - ${high}), preserving offsets, alpha and flags`,
    source, count: observedCount });
}

function mineLevel(theme, level) {
  const placements = level.placements;
  if (placements.length > LIMITS.terrainPerLevel || level.width * level.height > LIMITS.pixelsPerLevel) throw new Error('Level exceeds bounded scan limits');
  theme.counts.physicalLevels++;
  theme.counts.configuredAliases += level.aliases.length;
  theme.counts.terrainPlacements += placements.length;
  const positioned = placements.map((p, index) => ({ ...p, index, image: theme._pieces.get(p.id) })).filter(p => p.image?.width && p.image?.height);
  for (const p of positioned) {
    add(theme._usage, String(p.id), { id: p.id });
    if (p.f & ERASE) theme.counts.erasers++;
    if (p.f & NO_OVERWRITE) theme.counts.noOverwrite++;
    if (p.f & FLIP_Y) theme.counts.upsideDown++;
    if (p.f & FLIP_X) theme.counts.horizontalFlip++;
  }
  for (let i = 0; i < positioned.length; i++) {
    const a = positioned[i];
    const eraserContext = [];
    for (let j = 0; j < i; j++) {
      const b = positioned[j];
      const overlapX = Math.min(a.x + a.image.width, b.x + b.image.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.image.height, b.y + b.image.height) - Math.max(a.y, b.y);
      const kind = overlapX > 0 && overlapY > 0 ? 'overlaps' : ((overlapX === 0 && overlapY > 0) || (overlapY === 0 && overlapX > 0)) ? 'joins' : null;
      if (!kind) continue;
      const countKey = kind === 'joins' ? 'bboxJoins' : 'bboxOverlaps';
      theme.counts[countKey]++;
      const value = { a: b.id, b: a.id, dx: a.x - b.x, dy: a.y - b.y, flags: [b.f, a.f], overlap: [Math.max(0, overlapX), Math.max(0, overlapY)], source: sourceRef(level, [b.index, a.index]) };
      add(kind === 'joins' ? theme._joins : theme._overlaps, `${value.a}/${value.b}/${value.dx}/${value.dy}/${b.f}/${a.f}`, value);
      if (a.f & ERASE) eraserContext.push(b);
    }
    if (a.f & ERASE && eraserContext.length) {
      const group = [...eraserContext.slice(-7), a];
      const x = Math.min(...group.map(p => p.x)), y = Math.min(...group.map(p => p.y));
      const value = { placements: group.map(p => ({ id: p.id, x: p.x - x, y: p.y - y, f: p.f })), source: sourceRef(level, group.map(p => p.index)) };
      add(theme._erasers, `${a.id}/${a.f}/${group.map(p => p.id).join(',')}`, value);
    }
  }
  const positionIndex = new Map(positioned.map(p => [`${p.id}/${p.f}/${p.x}/${p.y}`, p]));
  const samePieces = new Map();
  for (const p of positioned) { const key = `${p.id}/${p.f}`; if (!samePieces.has(key)) samePieces.set(key, []); samePieces.get(key).push(p); }
  for (const list of samePieces.values()) {
    list.sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index);
    const seen = new Set();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < Math.min(list.length, i + 9); j++) {
      const a = list[i], b = list[j], dx = b.x - a.x, dy = b.y - a.y;
      if ((!dx && !dy) || Math.abs(dx) > 192 || Math.abs(dy) > 96) continue;
      const c = list.find(p => p.x === b.x + dx && p.y === b.y + dy);
      if (!c) continue;
      const key = `${a.id}/${a.f}/${dx}/${dy}`;
      if (seen.has(key)) continue;
      seen.add(key); theme.counts.repeatedVectors++;
      let repetitions = 2, end = b;
      const group = [a, b];
      while (group.length < 64) {
        const next = list.find(p => p.x === end.x + dx && p.y === end.y + dy);
        if (!next || group.includes(next)) break;
        group.push(next); end = next; repetitions++;
      }
      const source = sourceRef(level, group.slice(0, 8).map(p => p.index));
      add(theme._repeats, key, { pieceId: a.id, flags: a.f, step: [dx, dy], repetitions,
        formula: `[x,y] + n * [${dx},${dy}]`, source });
      if (dy === 0 && dx > 0) {
        routeCandidate(theme, a, dx, source, repetitions);
        const companions = positioned.filter(p => p !== a && p.x >= a.x && p.x < a.x + dx && Math.abs(p.y - a.y) <= 32
          && positionIndex.has(`${p.id}/${p.f}/${p.x + dx}/${p.y}`) && positionIndex.has(`${p.id}/${p.f}/${p.x + 2 * dx}/${p.y}`)).slice(0, 5);
        if (companions.length) {
          const unit = [a, ...companions].sort((p, q) => p.index - q.index);
          const minX = Math.min(...unit.map(p => p.x)), minY = Math.min(...unit.map(p => p.y));
          const normalized = unit.map(p => ({ id: p.id, x: p.x - minX, y: p.y - minY, f: p.f }));
          const source = sourceRef(level, unit.map(p => p.index));
          const value = { period: dx, placements: normalized, repetitions: 3, source,
            formula: `repeat the ordered group at [x + n * ${dx}, y]` };
          add(theme._groups, `${dx}/${JSON.stringify(normalized)}`, value);
          theme.counts.repeatedGroups++;
          routeCandidate(theme, a, dx, source, 3, unit);
        }
      }
    }
  }
  const { mask } = stampRecipePlacements({ placements, terrainPieces: theme._pieces, width: level.width, height: level.height });
  const profile = getRecipeTopProfile(mask, level.width, level.height);
  for (let x = 1; x < level.width; x++) {
    if (profile[x] < 0 && profile[x - 1] >= 0) {
      let end = x;
      while (end < level.width && profile[end] < 0) end++;
      if (end < level.width) {
        const size = end - x; theme.counts.emptyColumnGaps++;
        add(theme._gaps, `${size}/${profile[end] - profile[x - 1]}`, { width: size, heightDelta: profile[end] - profile[x - 1],
          source: { ...sourceRef(level), x, y: profile[x - 1] } });
      }
      x = end;
    } else if (profile[x] >= 0 && profile[x - 1] >= 0 && Math.abs(profile[x] - profile[x - 1]) >= 3) {
      const delta = profile[x] - profile[x - 1]; theme.counts.surfaceLedges++;
      add(theme._ledges, String(delta), { heightDelta: delta, source: { ...sourceRef(level), x, y: profile[x - 1] } });
    }
  }
  for (const a of positioned) {
    const info = theme.catalog.find(p => p.id === a.id);
    if (a.f & ERASE || a.image.isSteel || info.solidRatio > 0.55 || a.image.width > 80 || a.image.height > 64) continue;
    const neighbors = positioned.filter(b => b !== a && !(b.f & ERASE) && !b.image.isSteel && Math.abs(b.x - a.x) < 36 && Math.abs(b.y - a.y) < 28).slice(0, 3);
    const group = [a, ...neighbors].sort((b, c) => b.index - c.index);
    const minX = Math.min(...group.map(p => p.x)), minY = Math.min(...group.map(p => p.y));
    const maxX = Math.max(...group.map(p => p.x + p.image.width)), maxY = Math.max(...group.map(p => p.y + p.image.height));
    if (maxX - minX > 112 || maxY - minY > 80) continue;
    theme.counts.decorationCandidates++;
    const value = { width: maxX - minX, height: maxY - minY,
      placements: group.map(p => ({ id: p.id, x: p.x - minX, y: p.y - minY, f: p.f })),
      interpretation: 'low-fill terrain cluster; decoration role is inferred, not an authored label', source: sourceRef(level, group.map(p => p.index)) };
    add(theme._decor, JSON.stringify(value.placements), value);
  }
}

export async function mineTerrainRecipes({ root = ROOT } = {}) {
  const files = await discover(root), configs = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
  const provider = new NodeFileProvider(root), assetCache = new Map(), themesByHash = new Map(), levels = [], failures = [], special = [];
  const aliases = new Map();
  let configuredAliases = 0;
  const packs = [];
  for (const config of configs) {
    const level = Object.fromEntries(Object.entries(config).filter(([key]) => key.startsWith('level.')).map(([key, value]) => [key.slice(6), value]));
    const resolver = new LevelIndexResolve({ ...config, level });
    let count = 0;
    for (let rank = 0; rank < level.order.length; rank++) for (let index = 0; index < level.order[rank].length; index++) {
      const resolved = resolver.resolve(rank, index), archive = `${level.filePrefix}${String(resolved.fileId).padStart(3, '0')}.DAT`;
      const id = `${config.path}/${archive}#${resolved.partIndex}`;
      if (!aliases.has(id)) aliases.set(id, []);
      aliases.get(id).push(`${config.path}/${rank + 1}/${index + 1}`); count++;
    }
    configuredAliases += count;
    packs.push({ path: config.path, configuredAliases: count, physicalLevels: 0, unconfiguredPhysicalLevels: 0, parsed: 0, tileAssemblies: 0, specialBitmaps: 0 });
  }
  await loadSteelSprites();
  const loadAssets = async (pack, groundSet) => {
    const key = `${pack}/${groundSet}`;
    if (assetCache.has(key)) return assetCache.get(key);
    const fallbackPaths = pack === 'xmas92' ? [pack, 'xmas91'] : [pack];
    const load = async filename => {
      let failure;
      for (const directory of fallbackPaths) try { return await provider.loadBinary(directory, filename); } catch (error) { failure = error; }
      throw failure;
    };
    const ground = await load(`GROUND${groundSet}O.DAT`), graphics = await load(`VGAGR${groundSet}.DAT`);
    const container = new FileContainer(graphics), reader = new GroundReader(ground, container.getPart(0), container.getPart(1));
    if (!reader.valid) throw new Error('Invalid GROUND metadata');
    const images = reader.getTerrainImages().map((image, id) => { image.id = id; return image; });
    // Fingerprint decoded palette and source-alpha art, independent of DAT compression.
    const fingerprint = createHash('sha256');
    for (const image of images) { fingerprint.update(Buffer.from([image.width, image.height])); fingerprint.update(Buffer.from(image.frames[0])); fingerprint.update(Buffer.from(image.palette.data.buffer)); }
    const digest = fingerprint.digest('hex');
    let theme = themesByHash.get(digest);
    if (!theme) {
      const family = names[pack]?.[groundSet] || (groundSet === 2 ? 'holiday-snow' : `${pack}-${groundSet}`);
      theme = makeTheme(`${pack}-${groundSet}`, family, digest, images); themesByHash.set(digest, theme);
    }
    if (names[pack]?.[groundSet]) theme.family = names[pack][groundSet];
    theme.sources.push({ pack, groundSet, ground: `GROUND${groundSet}O.DAT`, graphics: `VGAGR${groundSet}.DAT` });
    assetCache.set(key, theme);
    return theme;
  };
  for (const filename of files.filter(file => /(?:^|\/)(?:LEVEL|DLVEL)\d+\.DAT$/i.test(file))) {
    const pack = path.posix.dirname(filename), archive = path.posix.basename(filename);
    let packRecord = packs.find(p => p.path === pack);
    if (!packRecord) { packRecord = { path: pack, configuredAliases: 0, physicalLevels: 0, unconfiguredPhysicalLevels: 0, parsed: 0, tileAssemblies: 0, specialBitmaps: 0 }; packs.push(packRecord); }
    try {
      const container = new FileContainer(await provider.loadBinary(pack, archive));
      for (let part = 0; part < container.count(); part++) {
        const id = `${filename}#${part}`, levelAliases = aliases.get(id) || [];
        packRecord.physicalLevels++;
        if (!levelAliases.length) packRecord.unconfiguredPhysicalLevels++;
        try {
          const binary = container.getPart(part);
          if (binary.length !== 2048) throw new Error(`Expected classic 2048 bytes, got ${binary.length}`);
          const parsed = new LevelReader(binary);
          const level = { id, format: 'classic-dat', title: parsed.levelProperties.levelName, pack, groundSet: parsed.graphicSet1,
            aliases: levelAliases, width: parsed.levelWidth, height: parsed.levelHeight, placements: parsed.terrains.map(placement),
            sha256: sha(await fs.readFile(path.join(root, filename))) };
          packRecord.parsed++;
          if (parsed.graphicSet2) {
            special.push({ id, title: level.title, aliases: levelAliases, graphics: `${pack}/VGASPEC${parsed.graphicSet2 - 1}.DAT`,
              reason: 'Precomposed special bitmap; parsed but excluded from tile-assembly learning' });
            packRecord.specialBitmaps++; continue;
          }
          const theme = await loadAssets(pack, parsed.graphicSet1);
          mineLevel(theme, level); level.theme = theme.id; levels.push(level); packRecord.tileAssemblies++;
          if (levels.length > LIMITS.levels) throw new Error('Level count exceeds bounded scan limit');
        } catch (error) { failures.push({ source: id, error: error.message }); }
      }
    } catch (error) { failures.push({ source: filename, error: error.message }); }
  }
  const nonclassic = [];
  for (const filename of files.filter(file => /\.(?:nxlv|lvl)$/i.test(file))) {
    const entry = { source: filename, status: 'pending' }; nonclassic.push(entry);
    try {
      if (!filename.endsWith('.nxlv')) throw new Error('Standalone binary LVL needs explicit pack-to-style binding');
      const text = await fs.readFile(path.join(root, filename), 'utf8'), parsed = NxlvParser.parse(text);
      if (parsed.terrainGroups.length) throw new Error('Grouped NXLV transforms require flattening; not silently approximated');
      const style = parsed.getHeader('STYLE') || parsed.terrains[0]?.props.STYLE;
      const groundSet = getStyle(style)?.groundSet;
      if (groundSet == null || groundSet > 4) throw new Error(`NXLV style ${style} has no unambiguous source-art binding`);
      const placements = parsed.terrains.map(entry => {
        const p = entry.props;
        if ((p.STYLE && p.STYLE !== style) || p.ROTATE || p.WIDTH || p.HEIGHT) throw new Error('Mixed styles or resized/rotated NXLV terrain need explicit asset binding');
        const id = resolveTerrainId(style, p.PIECE);
        if (id == null) throw new Error(`Unknown piece ${p.PIECE}`);
        return { id, x: p.X || 0, y: p.Y || 0, f: (p.ERASE ? ERASE : 0) | (p.FLIP_VERTICAL ? FLIP_Y : 0) | (p.NO_OVERWRITE ? NO_OVERWRITE : 0) | (p.FLIP_HORIZONTAL ? FLIP_X : 0) };
      });
      const level = { id: filename, format: 'nxlv', title: parsed.getHeader('TITLE'), pack: 'lemmings', groundSet, aliases: [],
        width: parsed.getHeader('WIDTH'), height: parsed.getHeader('HEIGHT'), placements, sha256: sha(text) };
      const theme = await loadAssets('lemmings', groundSet);
      mineLevel(theme, level); level.theme = theme.id; levels.push(level);
      entry.status = 'analyzed'; entry.theme = theme.id; entry.placements = placements.length;
    } catch (error) { entry.status = 'failed'; entry.error = error.message; failures.push({ source: filename, error: error.message }); }
  }
  const archives = files.filter(file => /\.(?:nxp|zip|rar|tgz|tar|tar\.gz)$/i.test(file));
  for (const file of archives) failures.push({ source: file, error: 'Archive present in scan scope; unpack or supply explicit source directory before claiming coverage' });
  const themes = [...themesByHash.values()].map(theme => {
    theme.motifs.joins = top(theme._joins); theme.motifs.overlaps = top(theme._overlaps);
    theme.motifs.repeats = top(theme._repeats); theme.motifs.repeatingGroups = top(theme._groups, 4); theme.motifs.erasers = top(theme._erasers, 4);
    theme.motifs.gaps = top(theme._gaps); theme.motifs.ledges = top(theme._ledges);
    theme.motifs.decoration = top(theme._decor, 4); theme.routes = top(theme._routes, 8);
    for (const route of top(new Map([...theme._routes].filter(([, value]) => value.placements.length > 1)), 4)) {
      if (!theme.routes.includes(route)) theme.routes.push(route);
    }
    theme.pieceUsage = top(theme._usage, 12);
    for (const key of Object.keys(theme)) if (key.startsWith('_')) delete theme[key];
    return theme;
  }).sort((a, b) => a.id.localeCompare(b.id));
  const corpus = levels.map(({ id, format, title, theme, aliases, sha256 }) => ({ id, format, title, theme, aliases, sha256 }));
  const book = { schemaVersion: 1, generator: 'tools/mineTerrainRecipes.js', limits: LIMITS,
    methodology: { sampling: 'Every discovered DAT part and standalone NXLV/LVL is inventoried; configured aliases are not double-counted.',
      joins: 'Ordered piece bounding-box adjacency/overlap, not proof of solid-alpha contact.',
      gaps: 'Empty columns between occupied columns in the final ordered alpha composite; not route-solvability claims.',
      ledges: 'Adjacent topmost solid-column height changes of at least 3 pixels.',
      decoration: 'Heuristic low-fill terrain clusters, not authored semantic labels.',
      routes: 'Source-observed horizontal repeated pieces, alpha-composited and filtered for continuous support, max step5, range10, thickness3.',
      special: 'VGASPEC bitmaps are counted and parsed but excluded from tile-assembly formulas.',
      flags: { erase: ERASE, flipY: FLIP_Y, noOverwrite: NO_OVERWRITE, flipX: FLIP_X } },
    inventory: { scope: 'Repository source tree, excluding symlinks and generated/cache directories', configuredAliases,
      physicalClassicLevels: packs.reduce((sum, p) => sum + p.physicalLevels, 0), tileAssemblyLevels: levels.length,
      nonclassicLevels: nonclassic.length, packs, nonclassic, specialBitmaps: special, failures,
      sourceDigest: sha(JSON.stringify(corpus)), sourceFilesScanned: files.filter(file => /(?:config\.json|\.DAT|\.nxlv|\.lvl)$/i.test(file)).length, archiveFiles: archives }, themes, corpus };
  validateTerrainRecipeBook(book);
  return book;
}

export function terrainRecipeReport(book) {
  const i = book.inventory;
  const lines = ['# Terrain assembly corpus analysis', '', 'Generated by `node tools/mineTerrainRecipes.js`. This is a measured corpus report, not a roadmap.', '',
    '## Coverage', '', `- ${i.configuredAliases} configured classic level aliases; ${i.physicalClassicLevels} physical DAT parts.`,
    `- ${i.tileAssemblyLevels} tile-assembly records analyzed, including ${i.nonclassicLevels} standalone nonclassic files.`,
    `- ${i.specialBitmaps.length} VGASPEC bitmap levels parsed and explicitly excluded from tile-recipe learning.`,
    `- ${i.failures.length} failures or unsupported inputs. No external pack collection was downloaded.`,
    `- Corpus digest: \`${i.sourceDigest}\`. Artifact: \`assets/procgen/terrain-recipes.json\`.`, '',
    '| Available pack | Configured aliases | Physical DAT parts | Unconfigured parts | Tile assemblies | Bitmap-only |',
    '| --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const p of i.packs) lines.push(`| ${p.path} | ${p.configuredAliases} | ${p.physicalLevels} | ${p.unconfiguredPhysicalLevels} | ${p.tileAssemblies} | ${p.specialBitmaps} |`);
  lines.push('', 'Nonclassic files are standalone authored examples, not a claim of coverage of all NeoLemmix packs:');
  for (const entry of i.nonclassic) lines.push(`- \`${entry.source}\`: ${entry.status}${entry.error ? `; ${entry.error}` : `; ${entry.placements} terrain placements`}.`);
  for (const failure of i.failures) lines.push(`- Failure: \`${failure.source}\`: ${failure.error}.`);
  lines.push('', '## Per-theme evidence', '', 'Decoded asset hashes deduplicate identical art across packs. Ground-set numbers are pack-local: OhNo set0 is brick, not original dirt. Source ordering and palette transparency are preserved.', '',
    '| Theme | Levels | Pieces | Joins | Overlaps | Erasers | Repeats | Gaps | Ledges | Safe repeat recipes |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const t of book.themes) { const c = t.counts; lines.push(`| ${t.id} (${t.family}) | ${c.physicalLevels} | ${c.terrainPlacements} | ${c.bboxJoins} | ${c.bboxOverlaps} | ${c.erasers} | ${c.repeatedVectors} | ${c.emptyColumnGaps} | ${c.surfaceLedges} | ${t.routes.length} |`); }
  lines.push('', '## What the measured patterns mean', '',
    '- Joins and overlaps record exact piece IDs, relative offsets, draw flags, occurrence counts and original terrain indices. Their counts use bounding boxes; transparent borders mean they are not equivalent to solid contact.',
    '- Repeat formulas require at least three source placements at the same vector. Multi-piece repeating groups require three translated copies with identical piece IDs, flags and offsets. Retained route recipes replay source-observed horizontal strides, including overlap, and test the real source alpha at the wrap seam. Route recipes reject steel, holes, steps above 5px, height ranges above 10px or support thinner than 3px.',
    '- Eraser examples keep earlier overlapping placements followed by the eraser, preserving original draw order. Runtime stamps honor erasure, upside-down/horizontal flips and no-overwrite. Masks and rendered pixels are produced in the same pass.',
    '- Gap widths and ledge heights come from final composited alpha. These describe visual structure, not reachable routes or complete-level solvability; overhead terrain can affect the topmost-column measurement.',
    '- Decoration clusters are inferred from low-fill terrain and nearby pieces. They are not assumed noncolliding. Runtime decoration is placed below the route with a clearance of 10px.',
    '- Special VGASPEC levels use precomposed pictures rather than ordinary terrain recipes; learning fabricated tile joins from them would be misleading.', '',
    '## Runtime consumption', '',
    '`ProcgenTerrainRecipes.js` loads and validates the artifact, selects an exact pack-local asset family and composes bounded chunks from real decoded art. It returns color pixels, solid mask, top profile and placed-piece provenance. Keep seed/variant stable for a lane and pass worldX so repeated assemblies join across chunk boundaries. A caller may select another variant at an explicitly checked seam.', '',
    'There is no generic-color geometry fallback. Missing art or a missing supported recipe fails clearly. Colors and collision come from the same source-alpha stamp. Gameplay challenge cuts and builder/destructive edits remain the runtime’s responsibility; recipe screening is not a gameplay solver.', '',
    '## Reproduction and bounds', '',
    'Run `node tools/mineTerrainRecipes.js` to regenerate the checked-in JSON and this report, or `node tools/mineTerrainRecipes.js --check` to verify exact reproducibility. No network access or new dependency is required. NodeFileProvider, FileContainer, LevelReader, GroundReader, NxlvParser and StyleRegistry are the existing decoders.', '',
    'The scan is bounded by file/level/pixel/placement caps recorded in the JSON. It skips symlinks and generated/cache directories, deduplicates assets by decoded pixel/palette hash, analyzes every physical source once and retains only small motif samples. The corpus index preserves level identities, alias mapping and source hashes. Unsupported standalone LVL bindings, complex NXLV transforms or archive inputs are reported rather than silently treated as covered.', '');
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const book = await mineTerrainRecipes();
  const outputs = [[path.join(ROOT, 'assets/procgen/terrain-recipes.json'), JSON.stringify(book) + '\n'],
    [path.join(ROOT, 'docs/procgen-terrain-analysis.md'), terrainRecipeReport(book)]];
  for (const [filename, contents] of outputs) {
    if (process.argv.includes('--check')) {
      if (await fs.readFile(filename, 'utf8') !== contents) throw new Error(`Stale generated artifact: ${path.relative(ROOT, filename)}`);
    } else { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, contents); }
  }
  console.log(JSON.stringify({ classicParts: book.inventory.physicalClassicLevels, configuredAliases: book.inventory.configuredAliases,
    analyzed: book.inventory.tileAssemblyLevels, nonclassic: book.inventory.nonclassic, themes: book.themes.map(t => ({ id: t.id, levels: t.counts.physicalLevels, routes: t.routes.length })), failures: book.inventory.failures }, null, 2));
}
