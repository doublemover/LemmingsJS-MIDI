import { EditorAssetCache } from '../editor/EditorAssetCache.js';
import { TriggerTypes } from '../level/TriggerTypes.js';

const hazardTriggerIds = new Set([
  TriggerTypes.TRAP,
  TriggerTypes.DROWN,
  TriggerTypes.KILL,
  TriggerTypes.FRYING
]);

const getTerrainStats = (image) => {
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  const frame = image?.frames?.[0];
  if (!frame || width <= 0 || height <= 0) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let solid = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const ci = frame[row + x];
      if (ci & 0x80) continue;
      solid += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!solid) return null;
  return {
    width,
    height,
    frame,
    solidCount: solid,
    solidRatio: solid / (width * height),
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    }
  };
};

class ProcgenAssetManager {
  constructor({ styleName, config, fileProvider, random } = {}) {
    this.styleName = styleName || 'dirt';
    this.config = config || null;
    this.fileProvider = fileProvider || null;
    this.random = typeof random === 'function' ? random : Math.random;
    this.cache = new EditorAssetCache();
    this.assets = null;

    this.terrainPieces = [];
    this.groundPieces = [];
    this.decorPieces = [];
    this.gadgetDecor = [];
    this.gadgetHazards = [];
    this._pickCache = new WeakMap();
  }

  async load() {
    const assets = await this.cache.loadStyleAssets(
      this.styleName,
      this.config,
      this.fileProvider
    );
    this.assets = assets;
    this._buildTerrainCatalog(assets);
    this._buildGadgetCatalog(assets);
    return this;
  }

  _buildTerrainCatalog(assets) {
    const images = assets?.terrainImages || [];
    const entries = [];
    for (let id = 0; id < images.length; id++) {
      const image = images[id];
      const stats = getTerrainStats(image);
      if (!stats) continue;
      entries.push({
        id,
        image,
        frame: stats.frame,
        width: stats.width,
        height: stats.height,
        solidRatio: stats.solidRatio,
        bounds: stats.bounds,
        isSteel: !!image?.isSteel
      });
    }
    this.terrainPieces = entries;
    this.groundPieces = entries.filter(piece => {
      if (!piece.bounds || piece.bounds.width <= 0 || piece.bounds.height <= 0) {
        return false;
      }
      if (piece.isSteel) return false;
      return piece.solidRatio >= 0.2;
    });
    this.decorPieces = entries.filter(piece => {
      if (!piece.bounds || piece.bounds.width <= 0 || piece.bounds.height <= 0) {
        return false;
      }
      if (piece.isSteel) return false;
      return piece.solidRatio > 0 && piece.solidRatio < 0.2;
    });
    this._pickCache = new WeakMap();
  }

  _buildGadgetCatalog(assets) {
    const gadgets = assets?.gadgets || [];
    this.gadgetDecor = [];
    this.gadgetHazards = [];
    for (const gadget of gadgets) {
      const trigger = gadget?.triggerEffectId ?? 0;
      if (trigger === 0) {
        this.gadgetDecor.push(gadget);
      } else if (hazardTriggerIds.has(trigger)) {
        this.gadgetHazards.push(gadget);
      }
    }
  }

  _pickFromList(list, maxWidth, minHeight = 1, minWidth = 1) {
    if (!Array.isArray(list) || list.length === 0) return null;
    let listCache = this._pickCache.get(list);
    if (!listCache) {
      listCache = new Map();
      this._pickCache.set(list, listCache);
    }
    const key = `${Number.isFinite(maxWidth) ? maxWidth : 'inf'}:${Number.isFinite(minHeight) ? minHeight : 'inf'}:${Number.isFinite(minWidth) ? minWidth : 'inf'}`;
    let candidates = listCache.get(key);
    if (!candidates) {
      candidates = [];
      for (let i = 0; i < list.length; i += 1) {
        const piece = list[i];
        const bounds = piece?.bounds;
        if (!bounds) continue;
        if (Number.isFinite(maxWidth) && bounds.width > maxWidth) continue;
        if (Number.isFinite(minHeight) && bounds.height < minHeight) continue;
        if (Number.isFinite(minWidth) && bounds.width < minWidth) continue;
        candidates.push(piece);
      }
      if (listCache.size > 128) listCache.clear();
      listCache.set(key, candidates);
    }
    if (candidates.length) {
      const idx = Math.floor(this.random() * candidates.length);
      return candidates[idx];
    }
    const idx = Math.floor(this.random() * list.length);
    return list[idx];
  }

  pickGroundPiece(maxWidth, minHeight, minWidth) {
    return this._pickFromList(this.groundPieces, maxWidth, minHeight, minWidth);
  }

  pickDecorPiece(maxWidth) {
    return this._pickFromList(this.decorPieces, maxWidth);
  }
}

export { ProcgenAssetManager };
