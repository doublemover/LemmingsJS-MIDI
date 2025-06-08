import { expect } from 'chai';
import { readFileSync } from 'fs';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LemmingsBootstrap.js';

// Silence debug output
globalThis.lemmings = { game: { showDebug: false } };

describe('LevelLoader', function () {
  it('builds a level from LEVEL000.DAT', async function () {
    const buf = readFileSync(new URL('../lemmings/LEVEL000.DAT', import.meta.url));
    const br = new Lemmings.BinaryReader(new Uint8Array(buf));
    const fc = new Lemmings.FileContainer(br);
    const lr = new Lemmings.LevelReader(fc.getPart(0));

    class Provider {
      loadBinary(path, file) {
        const data = readFileSync(new URL(`../${path}/${file}`, import.meta.url));
        return Promise.resolve(new Lemmings.BinaryReader(new Uint8Array(data)));
      }
    }

    // avoid fetch inside loadSteelSprites
    const origLoad = Lemmings.loadSteelSprites;
    Lemmings.loadSteelSprites = async () => [];

    const config = {
      path: 'lemmings',
      gametype: Lemmings.GameTypes.LEMMINGS,
      mechanics: { gravity: 9.8 },
      level: { filePrefix: 'LEVEL', useOddTable: true, order: [[0]] }
    };

    const loader = new Lemmings.LevelLoader(new Provider(), config);
    const level = await loader.getLevel(0, 0);
    Lemmings.loadSteelSprites = origLoad;

    expect(level).to.be.instanceOf(Lemmings.Level);
    expect(level.objects.length).to.equal(lr.objects.length);
    expect(level.steelRanges.length / 4).to.equal(lr.steel.length);
    expect(level.groundImage.length).to.be.above(0);
    expect(level.mechanics).to.deep.equal(config.mechanics);
  });

  it('returns null when mode or index are out of range', async function () {
    let called = 0;
    class StubProvider {
      loadBinary() {
        called++;
        return Promise.resolve(null);
      }
    }

    const config = {
      path: 'pack',
      gametype: Lemmings.GameTypes.LEMMINGS,
      mechanics: {},
      level: { filePrefix: 'LEVEL', useOddTable: false, order: [[0]] }
    };

    const loader = new Lemmings.LevelLoader(new StubProvider(), config);
    const res1 = await loader.getLevel(1, 0);
    const res2 = await loader.getLevel(0, 2);

    expect(res1).to.be.null;
    expect(res2).to.be.null;
    expect(called).to.equal(0);
  });

  it('uses OddTableReader when configured', async function () {
    let oddCalled = 0;
    class StubOddTable {
      constructor() { oddCalled++; }
      getLevelProperties() { return new Lemmings.LevelProperties(); }
    }

    const origClasses = {
      OddTableReader: Lemmings.OddTableReader,
      LevelReader: Lemmings.LevelReader,
      FileContainer: Lemmings.FileContainer,
      GroundReader: Lemmings.GroundReader,
      GroundRenderer: Lemmings.GroundRenderer,
      VGASpecReader: Lemmings.VGASpecReader,
      SolidLayer: Lemmings.SolidLayer,
      Level: Lemmings.Level
    };

    class FakeLevelReader {
      constructor() {
        this.levelWidth = 10;
        this.levelHeight = 10;
        this.screenPositionX = 0;
        this.isSuperLemming = false;
        this.graphicSet1 = 0;
        this.graphicSet2 = 0;
        this.objects = [];
        this.terrains = [];
        this.steel = [];
        this.levelProperties = new Lemmings.LevelProperties();
      }
    }

    class FakeFileContainer { getPart() { return {}; } }
    class FakeGroundReader { getObjectImages() { return []; } getTerrainImages() { return []; } get colorPalette() { return null; } get groundPalette() { return null; } }
    class FakeGroundRenderer { constructor() { this.img = { getData: () => new Uint8ClampedArray() }; } createGroundMap() {} createVgaspecMap() {} }
    class FakeVGASpecReader { constructor() { this.img = { getData: () => new Uint8ClampedArray() }; } }
    class FakeSolidLayer {}
    class FakeLevel { constructor() {} setGroundImage() {} setGroundMaskLayer() {} setMapObjects() {} setPalettes() {} setSteelAreas() {} newSetSteelAreas() {} }

    Object.assign(Lemmings, {
      OddTableReader: StubOddTable,
      LevelReader: FakeLevelReader,
      FileContainer: FakeFileContainer,
      GroundReader: FakeGroundReader,
      GroundRenderer: FakeGroundRenderer,
      VGASpecReader: FakeVGASpecReader,
      SolidLayer: FakeSolidLayer,
      Level: FakeLevel,
      loadSteelSprites: async () => []
    });

    class StubProvider {
      loadBinary() { return Promise.resolve(new Lemmings.BinaryReader(new Uint8Array(1))); }
    }

    const config = {
      path: 'pack',
      gametype: Lemmings.GameTypes.LEMMINGS,
      mechanics: {},
      level: { filePrefix: 'LEVEL', useOddTable: true, order: [[-1]] }
    };

    const loader = new Lemmings.LevelLoader(new StubProvider(), config);
    await loader.getLevel(0, 0);

    Object.assign(Lemmings, origClasses);

    expect(oddCalled).to.equal(1);
  });
});
