import { createNeonCabaretGroundSet } from '../decorations/NeonCabaretGroundSet.js';
import { FileContainer } from '../data/FileContainer.js';
import { GroundReader, loadSteelSprites } from '../level/GroundReader.js';
import { getSourceImageGeometry } from '../render/SourceImageGeometry.js';
import { TriggerTypes } from '../level/TriggerTypes.js';
import { ResourceLoadError } from '../data/file-provider/ResourceLoadError.js';
import { acquireSharedGroundAssets } from '../app/resources/GroundAssetRegistry.js';
import { createProcgenRetirementScope } from '../app/procgen/ProcgenRetirement.js';
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
    this.pending = new Map();
    this.resourceLeases = new Map();
    this.epoch = 0;
    this.providerKeys = new WeakMap();
    this.nextProviderKey = 0;
  }

  clear() {
    this.epoch++;
    for (const record of this.pending.values()) record.controller.abort();
    this.pending.clear();
    this.cache.clear();
    const leases = [...this.resourceLeases.values()].flatMap(value => [...value]); this.resourceLeases.clear();
    return createProcgenRetirementScope().retire(leases.map((lease, index) => ({ name: 'decoded-ground-' + index, run: () => lease.release() })));
  }

  loadStyleAssets(styleName, config, fileProvider, options = {}) {
    if (options.signal?.aborted) return Promise.reject(new ResourceLoadError('cancelled', styleName));
    if (!fileProvider || !config) return this._loadStyleAssets(styleName, config, fileProvider, options);
    const style = getStyleForName(styleName), resolvedStyle = style?.name || styleName || 'dirt';
    const groundSet = Number.isInteger(options.groundSet) && options.groundSet >= 0 ? options.groundSet : Number.isFinite(style?.groundSet) ? style.groundSet | 0 : 0;
    if (!this.providerKeys.has(fileProvider)) this.providerKeys.set(fileProvider, ++this.nextProviderKey);
    const key = JSON.stringify([this.providerKeys.get(fileProvider), fileProvider._cacheEpoch ?? 0, fileProvider.rootPath ?? null, config.path,
      resolvedStyle, groundSet, config.resourcePins || null, fileProvider._cacheBustRevision ?? null, options.sourceRevision ?? config.sourceRevision ?? null]);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve({ ...cached });
    let record = this.pending.get(key);
    if (!record) {
      record = { controller: new AbortController(), consumers: 0, epoch: this.epoch, promise: null, leases: new Set() };
      const canceled = new Promise((resolve, reject) => record.controller.signal.addEventListener('abort', () =>
        reject(new ResourceLoadError('cancelled', resolvedStyle)), { once: true }));
      const retainDecodedLease = lease => {
        if (record.controller.signal.aborted || record.epoch !== this.epoch) { lease.release(); throw new ResourceLoadError('cancelled', resolvedStyle); }
        record.leases.add(lease);
      };
      record.promise = Promise.race([this._loadStyleAssets(styleName, config, fileProvider, { ...options, signal: record.controller.signal, retainDecodedLease }), canceled])
        .then(assets => {
          if (record.controller.signal.aborted || record.epoch !== this.epoch) throw new ResourceLoadError('cancelled', resolvedStyle);
          this.cache.set(key, assets);
          this.resourceLeases.set(key, record.leases);
          return assets;
        }).catch(error => {
          record.controller.abort();
          createProcgenRetirementScope().retire([...record.leases].map((lease, index) => ({ name: 'decoded-ground-' + index, run: () => lease.release() })));
          record.leases.clear(); throw error;
        }).finally(() => { if (this.pending.get(key) === record) this.pending.delete(key); });
      this.pending.set(key, record);
    }
    record.consumers++;
    return new Promise((resolve, reject) => {
      let released = false;
      const release = canceled => {
        if (released) return;
        released = true;
        options.signal?.removeEventListener('abort', abort);
        if (--record.consumers === 0 && canceled) record.controller.abort();
      };
      const abort = () => { release(true); reject(new ResourceLoadError('cancelled', resolvedStyle)); };
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      record.promise.then(value => { if (!released) { release(false); resolve({ ...value }); } }, error => {
        if (!released) { release(false); reject(error); }
      });
    });
  }

  async _loadStyleAssets(styleName, config, fileProvider, options = {}) {
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
    const groundSet = Number.isInteger(options.groundSet) && options.groundSet >= 0 ? options.groundSet : Number.isFinite(style?.groundSet) ? style.groundSet | 0 : 0;

    const assertLive = () => { if (options.signal?.aborted) throw new ResourceLoadError('cancelled', resolvedStyle); };
    let groundReader, decodedAssets = null, resourceSources = null;
    const rawReaders = new Set();
    let readersRetired = false;
    const retainReader = reader => {
      if (readersRetired) { reader.release?.(); throw new ResourceLoadError('cancelled', resolvedStyle); }
      rawReaders.add(reader); return reader;
    };
    const loadBinary = async filename => {
      const pin = config.resourcePins?.[filename], root = pin?.root || config.path;
      if (pin && (typeof pin.root !== 'string' || !pin.root || !/^[a-f0-9]{64}$/i.test(pin.sha256 || ''))) throw new ResourceLoadError('integrity', filename);
      assertLive();
      if (typeof fileProvider.resolveAsset === 'function' && (pin || typeof fileProvider.canVerifyContent !== 'function' || fileProvider.canVerifyContent())) {
        const handle = await fileProvider.resolveAsset({ path: root, filename }, { signal: options.signal, expectedHash: pin?.sha256, operationId: options.operationId });
        try {
          assertLive();
          return { reader: retainReader(handle.createReader({ filename, foldername: root })), source: Object.freeze({ root, filename, sha256: handle.identity.contentHash }) };
        } finally { handle.release?.(); }
      }
      const reader = await fileProvider.loadBinary(root, filename, { signal: options.signal, expectedHash: pin?.sha256, operationId: options.operationId });
      retainReader(reader);
      assertLive();
      if (pin) {
        if (!globalThis.crypto?.subtle || !reader?.copyBytes) throw new ResourceLoadError('unavailable', filename);
        const digest = await globalThis.crypto.subtle.digest('SHA-256', reader.copyBytes());
        const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        assertLive();
        if (actual !== pin.sha256.toLowerCase()) throw new ResourceLoadError('integrity', filename);
      }
      return { reader, source: Object.freeze({ root, filename, ...(pin ? { sha256: pin.sha256.toLowerCase() } : {}) }) };
    };
    if (resolvedStyle === 'neon-cabaret') {
      groundReader = createNeonCabaretGroundSet();
    } else {
      let container, terrainReader, objectReader, decodeError = null;
      try {
        const steelSprites = await loadSteelSprites();
        assertLive();
        const [vgagr, ground] = await Promise.all([loadBinary(`VGAGR${groundSet}.DAT`), loadBinary(`GROUND${groundSet}O.DAT`)]);
        assertLive();
        if (this.FileContainer === FileContainer && this.GroundReader === GroundReader && options.retainDecodedLease &&
            globalThis.crypto?.subtle && ground.source.sha256 && vgagr.source.sha256) {
          const lease = await acquireSharedGroundAssets({ ground, vgagr, steelIds: steelSprites[ground.source.root]?.[ground.source.filename] || [],
            signal: options.signal, budgetAdapter: fileProvider._budgetAdapter, onProgress: options.onProgress });
          options.retainDecodedLease(lease); decodedAssets = lease.value;
          groundReader = { getTerrainImages: () => decodedAssets.terrainImages, getObjectImages: () => decodedAssets.gadgetImages };
        } else {
          container = new this.FileContainer(vgagr.reader);
          terrainReader = container.getPart(0); objectReader = container.getPart(1);
          groundReader = new this.GroundReader(ground.reader, terrainReader, objectReader);
        }
        resourceSources = Object.freeze({ vgagr: vgagr.source, ground: ground.source });
      } catch (error) { decodeError = error; throw error; }
      finally {
        readersRetired = true;
        const retirement = createProcgenRetirementScope().retire([
          ...[...rawReaders].map((reader, index) => ({ name: 'raw-ground-source-' + index, run: () => reader.release?.() })),
          { name: 'decoded-terrain-source', run: () => terrainReader?.release?.() },
          { name: 'decoded-object-source', run: () => objectReader?.release?.() },
          { name: 'ground-source-container', run: () => container?.dispose?.() }
        ]);
        if (retirement.outcome !== 'complete') {
          if (decodeError) decodeError.retirement = retirement;
          else throw Object.assign(new Error('Terrain source retirement was incomplete.'), { retirement });
        }
      }
    }

    assertLive();
    const terrainImages = groundReader.getTerrainImages() || [];
    const objectImages = groundReader.getObjectImages() || [];

    const terrainById = new Map();
    const gadgetById = new Map();

    const terrain = terrainImages.map((img, id) => {
      const geometry = getSourceImageGeometry(img);
      const name = buildPieceName(resolveTerrainName(resolvedStyle, id), 'terrain_', id);
      const entry = {
        id,
        name,
        width: geometry.width,
        height: geometry.height,
        isSteel: !!img?.isSteel,
        steelWidth: img?.steelWidth || 0,
        steelHeight: img?.steelHeight || 0
      };
      terrainById.set(id, entry);
      return entry;
    });

    let exitId = null;
    const gadgets = objectImages.map((img, id) => {
      const geometry = getSourceImageGeometry(img);
      const name = buildPieceName(resolveGadgetName(resolvedStyle, id), 'object_', id);
      const entry = {
        id,
        name,
        width: geometry.width,
        height: geometry.height,
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
      resourceSources,
      ...(decodedAssets ? { assetSha256: decodedAssets.assetSha256, objectSha256: decodedAssets.objectSha256 } : {}),
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

    return { ...payload };
  }
}

export { EditorAssetCache };
