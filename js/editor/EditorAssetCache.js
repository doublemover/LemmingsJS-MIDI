import { FileContainer } from '../data/FileContainer.js';
import { GroundReader, loadSteelSprites } from '../level/GroundReader.js';
import { TriggerTypes } from '../level/TriggerTypes.js';
import {
  getDefaultStyle,
  getStyle,
  resolveTerrainName,
  resolveGadgetName
} from './StyleRegistry.js';

const getStyleForName = (styleName) => {
  return getStyle(styleName) || getDefaultStyle();
};

const buildPieceName = (name, prefix, id) => {
  if (name) return name;
  return `${prefix}${id}`;
};

class EditorAssetCache {
  constructor(options = {}) {
    this.FileContainer = options.FileContainer || FileContainer;
    this.GroundReader = options.GroundReader || GroundReader;
    this.cache = new Map();
  }

  clear() {
    this.cache.clear();
  }

  async loadStyleAssets(styleName, config, fileProvider) {
    if (!fileProvider || !config) {
      return {
        styleName: styleName || 'unknown',
        groundSet: 0,
        terrain: [],
        gadgets: [],
        triggers: [],
        entranceId: 1,
        exitId: null,
        terrainImages: [],
        gadgetImages: [],
        terrainById: new Map(),
        gadgetById: new Map()
      };
    }

    const style = getStyleForName(styleName);
    const resolvedStyle = style?.name || styleName || 'dirt';
    const groundSet = Number.isFinite(style?.groundSet) ? style.groundSet | 0 : 0;
    const cacheKey = `${config.path || ''}|${resolvedStyle}|${groundSet}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return { ...cached, styleName: resolvedStyle };

    await loadSteelSprites();
    const vgagrFile = await fileProvider.loadBinary(config.path, `VGAGR${groundSet}.DAT`);
    const groundFile = await fileProvider.loadBinary(config.path, `GROUND${groundSet}O.DAT`);
    const container = new this.FileContainer(vgagrFile);
    const groundReader = new this.GroundReader(groundFile, container.getPart(0), container.getPart(1));

    const terrainImages = groundReader.getTerrainImages() || [];
    const objectImages = groundReader.getObjectImages() || [];

    const terrainById = new Map();
    const gadgetById = new Map();

    const terrain = terrainImages.map((img, id) => {
      const name = buildPieceName(resolveTerrainName(resolvedStyle, id), 'terrain_', id);
      const entry = {
        id,
        name,
        width: img?.width || 0,
        height: img?.height || 0,
        isSteel: !!img?.isSteel,
        steelWidth: img?.steelWidth || 0,
        steelHeight: img?.steelHeight || 0
      };
      terrainById.set(id, entry);
      return entry;
    });

    let exitId = null;
    const gadgets = objectImages.map((img, id) => {
      const name = buildPieceName(resolveGadgetName(resolvedStyle, id), 'object_', id);
      const entry = {
        id,
        name,
        width: img?.width || 0,
        height: img?.height || 0,
        triggerEffectId: img?.trigger_effect_id || 0,
        triggerWidth: img?.trigger_width || 0,
        triggerHeight: img?.trigger_height || 0
      };
      if (entry.triggerEffectId === TriggerTypes.EXIT_LEVEL && exitId == null) {
        exitId = id;
      }
      gadgetById.set(id, entry);
      return entry;
    });

    const triggers = gadgets.filter(gadget => gadget.triggerEffectId !== 0);
    const entranceId = gadgetById.has(1) ? 1 : (gadgets[0]?.id ?? null);

    const payload = {
      styleName: resolvedStyle,
      groundSet,
      terrain,
      gadgets,
      triggers,
      entranceId,
      exitId,
      terrainImages,
      gadgetImages: objectImages,
      terrainById,
      gadgetById
    };

    this.cache.set(cacheKey, payload);
    return { ...payload };
  }
}

export { EditorAssetCache };
