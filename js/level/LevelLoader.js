import { FileContainer } from '../data/FileContainer.js';
import { GroundReader, loadSteelSprites } from './GroundReader.js';
import { GroundRenderer } from '../render/GroundRenderer.js';
import { Level } from './Level.js';
import { LevelIndexResolve } from './LevelIndexResolve.js';
import { LevelReader } from './LevelReader.js';
import { OddTableReader } from '../data/OddTableReader.js';
import { SolidLayer } from '../render/SolidLayer.js';
import { VGASpecReader } from '../data/VGASpecReader.js';
import { ResourceLoadError, isMissingResourceError } from '../data/file-provider/ResourceLoadError.js';

const PACK_RESOURCE_FALLBACKS = Object.freeze({
  xmas92: Object.freeze(['xmas91'])
});

const mergeLevelProperties = (baseProperties, oddProperties) => {
  if (!oddProperties) return baseProperties;

  const merged = {
    levelName: baseProperties.levelName,
    releaseRate: baseProperties.releaseRate,
    releaseCount: baseProperties.releaseCount,
    needCount: baseProperties.needCount,
    timeLimit: baseProperties.timeLimit,
    skills: Array.isArray(baseProperties.skills)
      ? baseProperties.skills.slice()
      : []
  };

  if (typeof oddProperties.levelName === 'string' &&
      oddProperties.levelName.length > 0) {
    merged.levelName = oddProperties.levelName;
  }

  if (Number.isFinite(oddProperties.releaseRate)) {
    merged.releaseRate = oddProperties.releaseRate;
  }
  if (Number.isFinite(oddProperties.releaseCount)) {
    merged.releaseCount = oddProperties.releaseCount;
  }
  if (Number.isFinite(oddProperties.needCount)) {
    merged.needCount = oddProperties.needCount;
  }
  if (Number.isFinite(oddProperties.timeLimit)) {
    merged.timeLimit = oddProperties.timeLimit;
  }

  if (Array.isArray(oddProperties.skills)) {
    const maxLen = Math.max(merged.skills.length, oddProperties.skills.length);
    if (merged.skills.length < maxLen) merged.skills.length = maxLen;
    for (let i = 0; i < maxLen; i++) {
      const value = oddProperties.skills[i];
      if (Number.isFinite(value)) merged.skills[i] = value;
    }
  }

  return merged;
};

class LevelLoader {
  constructor(fileProvider, config) {
    this.fileProvider = fileProvider;
    this.config = config;
    this.levelIndexResolve = new LevelIndexResolve(config);
    this.resourceFallbackPaths = Object.freeze(this.#buildResourceFallbackPaths());
    const pins = config?.resourcePins || {};
    if (typeof pins !== 'object' || Array.isArray(pins)) throw new TypeError('resourcePins must be a filename map');
    this.resourcePins = Object.freeze(Object.setPrototypeOf(Object.fromEntries(Object.entries(pins).map(([filename, pin]) => {
      if (!filename || filename.includes('/') || filename.includes('\\') || typeof pin?.root !== 'string' || !pin.root ||
          !/^[a-f0-9]{64}$/i.test(pin.sha256 || '')) throw new TypeError('Invalid pinned resource identity');
      return [filename, Object.freeze({ root: pin.root, sha256: pin.sha256.toLowerCase() })];
    })), null));
  }

  async #loadExactBinary(root, filename, options = {}) {
    const pin = this.resourcePins[filename];
    if (pin && pin.root !== root) throw new ResourceLoadError('integrity', `${root}/${filename}`, {
      cause: new Error('Pinned resource root differs from requested root')
    });
    if (pin && typeof this.fileProvider.resolveAsset === 'function') {
      const handle = await this.fileProvider.resolveAsset({ path: root, filename }, { ...options, expectedHash: pin.sha256 });
      try {
        if (handle.identity.contentHash !== pin.sha256) throw new ResourceLoadError('integrity', `${root}/${filename}`);
        return { reader: handle.createReader({ filename, foldername: root }), root, filename, sha256: pin.sha256 };
      } finally { handle.release?.(); }
    }
    const reader = await this.fileProvider.loadBinary(root, filename, { ...options, ...(pin ? { expectedHash: pin.sha256 } : {}) });
    try {
      if (pin) {
        const subtle = globalThis.crypto?.subtle;
        const bytes = reader?.data;
        const start = reader?.hiddenOffset ?? 0, end = start + reader?.length;
        if (!subtle || !(bytes instanceof Uint8Array) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end > bytes.length) throw new ResourceLoadError('unavailable', `${root}/${filename}`, {
          cause: new Error('Pinned resource verification is unavailable')
        });
        const digest = await subtle.digest('SHA-256', bytes.subarray(start, end));
        const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (actual !== pin.sha256) throw new ResourceLoadError('integrity', `${root}/${filename}`);
      }
      return { reader, root, filename, ...(pin ? { sha256: pin.sha256 } : {}) };
    } catch (error) { reader?.release?.(); throw error; }
  }

  #buildResourceFallbackPaths() {
    const defaults = PACK_RESOURCE_FALLBACKS[this.config?.path] || [];
    const configured = Array.isArray(this.config?.resourceFallbackPaths)
      ? this.config.resourceFallbackPaths
      : [];
    const merged = [this.config?.path, ...configured, ...defaults];
    const unique = [];
    for (let i = 0; i < merged.length; i += 1) {
      const entry = merged[i];
      if (typeof entry !== 'string' || entry.length === 0) continue;
      if (unique.includes(entry)) continue;
      unique.push(entry);
    }
    return unique;
  }

  /**
   * Load a pack resource from the active pack first, then configured fallback
   * packs. This keeps runtime level logic unchanged while supporting packs
   * that intentionally reuse shared terrain/object files.
   */
  async #loadBinaryWithFallback(filename, options = {}) {
    let lastMissing = null;
    const pin = this.resourcePins[filename];
    const roots = pin ? [pin.root] : this.resourceFallbackPaths;
    const attemptedRoots = [];
    for (let i = 0; i < roots.length; i += 1) {
      const root = roots[i];
      if (options.signal?.aborted) throw new ResourceLoadError('cancelled', filename);
      attemptedRoots.push(root);
      try {
        return await this.#loadExactBinary(root, filename, options);
      } catch (error) {
        if (isMissingResourceError(error)) {
          lastMissing = error;
          continue;
        }
        if (error && typeof error === 'object' && Object.isExtensible(error)) error.attemptedRoots = Object.freeze([...attemptedRoots]);
        throw error;
      }
    }
    const error = new ResourceLoadError('not-found', filename, { cause: lastMissing });
    error.attemptedRoots = Object.freeze([...attemptedRoots]);
    throw error;
  }

  async getLevel (levelMode, levelIndex, options = {}) {
    let level, levelReader;
    const rawReaders = new Set(), containers = new Set(), decodedReaders = new Set();
    let retired = false;
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const requestOptions = { signal: controller.signal, operationId: options.operationId ?? null };
    const assertLive = () => { if (controller.signal.aborted) throw new ResourceLoadError('cancelled', this.config.path, { operationId: options.operationId ?? null }); };
    const holdSource = promise => promise.then(source => {
      if (retired || controller.signal.aborted) { source.reader.release?.(); throw new ResourceLoadError('cancelled', source.filename); }
      rawReaders.add(source.reader); return source;
    });
    const loadExact = (root, filename) => holdSource(this.#loadExactBinary(root, filename, requestOptions));
    const loadFallback = filename => holdSource(this.#loadBinaryWithFallback(filename, requestOptions));
    const openContainer = reader => { const container = new FileContainer(reader); containers.add(container); return container; };
    const openPart = (container, index) => { const reader = container.getPart(index); decodedReaders.add(reader); return reader; };
    try {
      assertLive();

      // ----------------------------------------------------------------------- //
      // 1 · Resolve the level-table entry and download the core .DAT             //
      // ----------------------------------------------------------------------- //
      const levelInfo = this.levelIndexResolve.resolve(levelMode, levelIndex);
      if (levelInfo == null) return null;

      const useOddTable   = levelInfo.useOddTable && this.config.level.useOddTable;
      const requireOddTable = useOddTable && this.config.level.oddTableRequired === true;
      const paddedFileId  = ('0000' + levelInfo.fileId).slice(-3);

      const baseFileName = this.config.level.filePrefix + paddedFileId + '.DAT';
      const baseLevel = loadExact(this.config.path, baseFileName);

      const oddTableBuf = useOddTable
        ? Promise.resolve().then(() => loadExact(this.config.path, 'ODDTABLE.DAT'))
          .catch(error => { if (isMissingResourceError(error) && !requireOddTable && !this.resourcePins['ODDTABLE.DAT']) return null; throw error; })
        : null;

      const [levelSource, oddSource] = await Promise.all([baseLevel, oddTableBuf]);
      assertLive();
      const levelDat = levelSource.reader, oddBuf = oddSource?.reader ?? null;

      // ----------------------------------------------------------------------- //
      // 2 · Parse header and build Level shell                                  //
      // ----------------------------------------------------------------------- //
      const levelsContainer = openContainer(levelDat);
      levelReader           = new LevelReader(
        openPart(levelsContainer, levelInfo.partIndex));

      level                      = new Level(
        levelReader.levelWidth,
        levelReader.levelHeight);
      level.gameType             = this.config.gametype;
      level.levelIndex           = levelIndex;
      level.levelMode            = levelMode;
      level.screenPositionX      = levelReader.screenPositionX;
      level.isSuperLemming       = levelReader.isSuperLemming;
      level.mechanics            = this.config.mechanics;

      const baseProperties       = levelReader.levelProperties;
      let oddProperties          = null;
      if (useOddTable && oddBuf && oddBuf.length > 0) {
        const oddTable           = new OddTableReader(oddBuf);
        oddProperties            = oddTable.getLevelProperties(levelInfo.levelNumber);
      }
      if (requireOddTable && !oddProperties) throw new ResourceLoadError('decode', `${this.config.path}/ODDTABLE.DAT`, {
        cause: new Error('Required odd-table entry is missing or empty')
      });
      const levelProperties      = mergeLevelProperties(baseProperties, oddProperties);

      level.name         = levelProperties.levelName;
      level.releaseRate  = levelProperties.releaseRate;
      level.releaseCount = levelProperties.releaseCount;
      level.needCount    = levelProperties.needCount;
      level.timeLimit    = levelProperties.timeLimit;
      level.skills       = levelProperties.skills;

      // ----------------------------------------------------------------------- //
      // 3 · Fetch graphics set(s) in parallel                                   //
      // ----------------------------------------------------------------------- //
      await loadSteelSprites();
      assertLive();
      const vgagrFile    = loadFallback(`VGAGR${levelReader.graphicSet1}.DAT`);
      const groundFile   = loadFallback(`GROUND${levelReader.graphicSet1}O.DAT`);
      const vgaspecFile  = (levelReader.graphicSet2 !== 0)
        ? loadFallback(`VGASPEC${levelReader.graphicSet2 - 1}.DAT`)
        : null;

      const [vgagrSource, groundSource, vgaspecSource] =
      await Promise.all([vgagrFile, groundFile, vgaspecFile]);
      assertLive();
      const vgagrBuf = vgagrSource.reader, groundBuf = groundSource.reader, vgaspecBuf = vgaspecSource?.reader ?? null;
      level.resourceSources = Object.freeze({
        level: Object.freeze({ root: levelSource.root, filename: levelSource.filename, ...(levelSource.sha256 ? { sha256: levelSource.sha256 } : {}) }),
        ...(useOddTable && oddBuf?.length ? { oddTable: Object.freeze({ root: oddSource.root, filename: oddSource.filename,
          ...(oddSource.sha256 ? { sha256: oddSource.sha256 } : {}) }) } : {}),
        vgagr: Object.freeze({ root: vgagrSource.root, filename: vgagrSource.filename, ...(vgagrSource.sha256 ? { sha256: vgagrSource.sha256 } : {}) }),
        ground: Object.freeze({ root: groundSource.root, filename: groundSource.filename, ...(groundSource.sha256 ? { sha256: groundSource.sha256 } : {}) }),
        ...(vgaspecSource ? { vgaspec: Object.freeze({ root: vgaspecSource.root, filename: vgaspecSource.filename,
          ...(vgaspecSource.sha256 ? { sha256: vgaspecSource.sha256 } : {}) }) } : {})
      });

      // ----------------------------------------------------------------------- //
      // 4 · Decode terrain / objects and render background                      //
      // ----------------------------------------------------------------------- //
      const vgaContainer = openContainer(vgagrBuf);
      const groundReader = new GroundReader(
        groundBuf,
        openPart(vgaContainer, 0),
        openPart(vgaContainer, 1));

      const render = new GroundRenderer();
      if (vgaspecBuf) {
        const spec = new VGASpecReader(
          vgaspecBuf, level.width, level.height);
        render.createVgaspecMap(levelReader, spec);
      } else {
        render.createGroundMap(levelReader, groundReader.getTerrainImages());
      }

      // ----------------------------------------------------------------------- //
      // 5 · Wire everything into the Level instance                             //
      // ----------------------------------------------------------------------- //
      level.setGroundImage(render.img.getData());
      level.setGroundMaskLayer(
        new SolidLayer(level.width, level.height, render.img.mask));

      level.setMapObjects(levelReader.objects, groundReader.getObjectImages());
      level.setPalettes(groundReader.colorPalette, groundReader.groundPalette);

      level.setSteelAreas(levelReader.steel);
      level.newSetSteelAreas(levelReader, groundReader.getTerrainImages());

      return level;
    } finally {
      retired = true; controller.abort(); options.signal?.removeEventListener('abort', abort);
      for (const reader of decodedReaders) reader.release?.();
      for (const container of containers) container.dispose();
      for (const reader of rawReaders) reader.release?.();
    }
  }
}

const __test__ = {
  mergeLevelProperties
};

export { LevelLoader, __test__ };
