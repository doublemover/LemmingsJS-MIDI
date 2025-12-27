import { expect } from 'chai';
import { EditorAssetCache } from '../../js/editor/EditorAssetCache.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';
import { resetStyleRegistry, registerStyle, registerClassicStyles } from '../../js/editor/StyleRegistry.js';

describe('EditorAssetCache', () => {
  beforeEach(() => {
    resetStyleRegistry();
    registerStyle('dirt', { groundSet: 0 });
  });

  after(() => {
    resetStyleRegistry();
    registerClassicStyles();
  });

  it('returns empty defaults without providers', async () => {
    const cache = new EditorAssetCache();
    const assets = await cache.loadStyleAssets('dirt', null, null);
    expect(assets.styleName).to.equal('dirt');
    expect(assets.terrain).to.deep.equal([]);
    expect(assets.gadgets).to.deep.equal([]);
    expect(assets.triggers).to.deep.equal([]);
    expect(assets.entranceId).to.equal(1);
    expect(assets.exitId).to.equal(null);
    expect(assets.terrainById).to.be.instanceOf(Map);
    expect(assets.gadgetById).to.be.instanceOf(Map);

    const unknownAssets = await cache.loadStyleAssets(null, null, null);
    expect(unknownAssets.styleName).to.equal('unknown');
  });

  it('loads assets, detects triggers, and caches by ground set', async () => {
    const calls = [];
    const fileProvider = {
      loadBinary: (path, file) => {
        calls.push({ path, file });
        return Promise.resolve(new Uint8Array([1, 2, 3]));
      }
    };

    const terrainImages = [
      { width: 12, height: 14, isSteel: true },
      { width: 6, height: 8, isSteel: false }
    ];
    const objectImages = [
      {
        width: 10,
        height: 12,
        trigger_effect_id: TriggerTypes.EXIT_LEVEL,
        trigger_width: 4,
        trigger_height: 6
      },
      {
        width: 9,
        height: 9,
        trigger_effect_id: 0,
        trigger_width: 0,
        trigger_height: 0
      }
    ];

    class FakeFileContainer {
      constructor(buffer) {
        this.buffer = buffer;
      }
      getPart(index) {
        return { index, buffer: this.buffer };
      }
    }

    class FakeGroundReader {
      constructor(groundFile, part0, part1) {
        this.groundFile = groundFile;
        this.part0 = part0;
        this.part1 = part1;
      }
      getTerrainImages() {
        return terrainImages;
      }
      getObjectImages() {
        return objectImages;
      }
    }

    const cache = new EditorAssetCache({
      FileContainer: FakeFileContainer,
      GroundReader: FakeGroundReader
    });
    const config = { path: 'lemmings', gametype: 1 };

    const assets = await cache.loadStyleAssets('dirt', config, fileProvider);
    expect(assets.styleName).to.equal('dirt');
    expect(assets.terrain).to.have.length(2);
    expect(assets.gadgets).to.have.length(2);
    expect(assets.triggers).to.have.length(1);
    expect(assets.entranceId).to.equal(1);
    expect(assets.exitId).to.equal(0);
    expect(assets.terrainById.get(0).isSteel).to.equal(true);
    expect(assets.gadgetById.get(0).triggerEffectId).to.equal(TriggerTypes.EXIT_LEVEL);
    expect(calls).to.have.length(2);

    await cache.loadStyleAssets('dirt', config, fileProvider);
    expect(calls).to.have.length(2);
  });

  it('falls back to generic names and entrance ids without registry entries', async () => {
    registerStyle('plain', { groundSet: 2, terrainPieces: [], gadgetPieces: [] });
    const calls = [];
    const fileProvider = {
      loadBinary: (path, file) => {
        calls.push({ path, file });
        return Promise.resolve(new Uint8Array([9, 9, 9]));
      }
    };

    const terrainImages = [{ width: 5, height: 5 }];
    const objectImages = [{ width: 4, height: 4, trigger_effect_id: 0 }];

    class FakeFileContainer {
      constructor(buffer) {
        this.buffer = buffer;
      }
      getPart(index) {
        return { index, buffer: this.buffer };
      }
    }

    class FakeGroundReader {
      constructor(groundFile, part0, part1) {
        this.groundFile = groundFile;
        this.part0 = part0;
        this.part1 = part1;
      }
      getTerrainImages() {
        return terrainImages;
      }
      getObjectImages() {
        return objectImages;
      }
    }

    const cache = new EditorAssetCache({
      FileContainer: FakeFileContainer,
      GroundReader: FakeGroundReader
    });
    const config = { path: 'lemmings', gametype: 1 };

    const assets = await cache.loadStyleAssets('plain', config, fileProvider);
    expect(assets.terrain[0].name).to.equal('terrain_0');
    expect(assets.gadgets[0].name).to.equal('object_0');
    expect(assets.entranceId).to.equal(0);

    cache.clear();
    await cache.loadStyleAssets('plain', config, fileProvider);
    expect(calls).to.have.length(4);
  });

  it('handles zero-sized images and empty gadget lists', async () => {
    registerStyle('void', { groundSet: 3, terrainPieces: [], gadgetPieces: [] });
    registerStyle('void-empty', { groundSet: 4, terrainPieces: [], gadgetPieces: [] });
    const calls = [];
    const fileProvider = {
      loadBinary: (path, file) => {
        calls.push({ path, file });
        return Promise.resolve(new Uint8Array([0]));
      }
    };

    const terrainImages = [{ width: 0, height: 0, isSteel: false }];
    const objectImages = [{ width: 0, height: 0, trigger_effect_id: 0 }];

    class FakeFileContainer {
      constructor(buffer) {
        this.buffer = buffer;
      }
      getPart(index) {
        return { index, buffer: this.buffer };
      }
    }

    class FakeGroundReader {
      constructor(groundFile, part0, part1) {
        this.groundFile = groundFile;
        this.part0 = part0;
        this.part1 = part1;
      }
      getTerrainImages() {
        return terrainImages;
      }
      getObjectImages() {
        return objectImages;
      }
    }

    class EmptyObjectGroundReader extends FakeGroundReader {
      getObjectImages() {
        return [];
      }
    }

    const cache = new EditorAssetCache({
      FileContainer: FakeFileContainer,
      GroundReader: FakeGroundReader
    });
    const config = { path: 'lemmings', gametype: 1 };
    const assets = await cache.loadStyleAssets('void', config, fileProvider);
    expect(assets.terrain[0].width).to.equal(0);
    expect(assets.gadgets[0].height).to.equal(0);

    const emptyCache = new EditorAssetCache({
      FileContainer: FakeFileContainer,
      GroundReader: EmptyObjectGroundReader
    });
    const emptyAssets = await emptyCache.loadStyleAssets('void-empty', config, fileProvider);
    expect(emptyAssets.gadgets).to.deep.equal([]);
    expect(emptyAssets.entranceId).to.equal(null);
  });

  it('falls back to default styles and empty image arrays', async () => {
    resetStyleRegistry();
    registerStyle('base', { groundSet: 1 });
    const fileProvider = {
      loadBinary: () => Promise.resolve(new Uint8Array([7]))
    };

    class FakeFileContainer {
      constructor(buffer) {
        this.buffer = buffer;
      }
      getPart(index) {
        return { index, buffer: this.buffer };
      }
    }

    class NullGroundReader {
      getTerrainImages() {
        return null;
      }
      getObjectImages() {
        return null;
      }
    }

    const cache = new EditorAssetCache({
      FileContainer: FakeFileContainer,
      GroundReader: NullGroundReader
    });
    const config = { path: 'lemmings', gametype: 1 };

    const assets = await cache.loadStyleAssets('missing-style', config, fileProvider);
    expect(assets.styleName).to.equal('base');
    expect(assets.terrain).to.deep.equal([]);
    expect(assets.gadgets).to.deep.equal([]);

    resetStyleRegistry();
    const emptyStyleAssets = await cache.loadStyleAssets(undefined, config, fileProvider);
    expect(emptyStyleAssets.styleName).to.equal('dirt');
    expect(emptyStyleAssets.groundSet).to.equal(0);
  });
});
