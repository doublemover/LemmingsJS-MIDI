import { FileContainer } from '../data/FileContainer.js';
import { GroundReader, loadSteelSprites } from './GroundReader.js';
import { GroundRenderer } from '../render/GroundRenderer.js';
import { Level } from './Level.js';
import { LevelIndexResolve } from './LevelIndexResolve.js';
import { LevelReader } from './LevelReader.js';
import { OddTableReader } from '../data/OddTableReader.js';
import { SolidLayer } from '../render/SolidLayer.js';
import { VGASpecReader } from '../data/VGASpecReader.js';

const PACK_RESOURCE_FALLBACKS = Object.freeze({
  xmas92: Object.freeze(['xmas91'])
});

const isMissingResourceError = (error) => {
  if (!error) return false;
  if (error.code === 'ENOENT') return true;
  const message = String(error.message || '');
  return message.includes('ENOENT');
};

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
    this.resourceFallbackPaths = this.#buildResourceFallbackPaths();
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
  async #loadBinaryWithFallback(filename) {
    let lastMissing = null;
    const roots = this.resourceFallbackPaths;
    for (let i = 0; i < roots.length; i += 1) {
      const root = roots[i];
      try {
        return await this.fileProvider.loadBinary(root, filename);
      } catch (error) {
        if (isMissingResourceError(error)) {
          lastMissing = error;
          continue;
        }
        throw error;
      }
    }
    if (lastMissing) throw lastMissing;
    throw new Error(`Unable to load resource: ${filename}`);
  }

  async getLevel (levelMode, levelIndex) {
    let level, levelReader;

    // ----------------------------------------------------------------------- //
    // 1 · Resolve the level-table entry and download the core .DAT             //
    // ----------------------------------------------------------------------- //
    const levelInfo = this.levelIndexResolve.resolve(levelMode, levelIndex);
    if (levelInfo == null) return null;

    const useOddTable   = levelInfo.useOddTable && this.config.level.useOddTable;
    const paddedFileId  = ('0000' + levelInfo.fileId).slice(-3);

    const baseLevel     = this.fileProvider.loadBinary(
      this.config.path,
      this.config.level.filePrefix + paddedFileId + '.DAT');

    const oddTableBuf = useOddTable
      ? this.fileProvider
        .loadBinary(this.config.path, 'ODDTABLE.DAT')
        .catch(() => null)
      : null;

    const [levelDat, oddBuf] = await Promise.all([baseLevel, oddTableBuf]);

    // ----------------------------------------------------------------------- //
    // 2 · Parse header and build Level shell                                  //
    // ----------------------------------------------------------------------- //
    const levelsContainer = new FileContainer(levelDat);
    levelReader           = new LevelReader(
      levelsContainer.getPart(levelInfo.partIndex));

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
    const vgagrFile    = this.#loadBinaryWithFallback(`VGAGR${levelReader.graphicSet1}.DAT`);
    const groundFile   = this.#loadBinaryWithFallback(`GROUND${levelReader.graphicSet1}O.DAT`);
    const vgaspecFile  = (levelReader.graphicSet2 !== 0)
      ? this.#loadBinaryWithFallback(`VGASPEC${levelReader.graphicSet2 - 1}.DAT`)
      : null;

    const [vgagrBuf, groundBuf, vgaspecBuf] =
      await Promise.all([vgagrFile, groundFile, vgaspecFile]);

    // ----------------------------------------------------------------------- //
    // 4 · Decode terrain / objects and render background                      //
    // ----------------------------------------------------------------------- //
    const vgaContainer = new FileContainer(vgagrBuf);
    const groundReader = new GroundReader(
      groundBuf,
      vgaContainer.getPart(0),
      vgaContainer.getPart(1));

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
  }
}

const __test__ = {
  mergeLevelProperties
};

export { LevelLoader, __test__ };
