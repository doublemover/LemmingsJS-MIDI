import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import '../js/LevelIndexResolve.js';
import '../js/LevelIndexType.js';
import '../js/SolidLayer.js';
import { LevelLoader } from '../js/LevelLoader.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('LevelLoader.getLevel', function () {
  let orig = {};
  let fileProvider;
  let config;
  let oddProps;
  let lrProps;
  let loadCalls;

  beforeEach(function () {
    orig.FileContainer = Lemmings.FileContainer;
    orig.LevelReader = Lemmings.LevelReader;
    orig.Level = Lemmings.Level;
    orig.OddTableReader = Lemmings.OddTableReader;
    orig.GroundReader = Lemmings.GroundReader;
    orig.GroundRenderer = Lemmings.GroundRenderer;
    orig.VGASpecReader = Lemmings.VGASpecReader;
    orig.SolidLayer = Lemmings.SolidLayer;
    orig.loadSteelSprites = Lemmings.loadSteelSprites;

    loadCalls = [];
    fileProvider = {
      loadBinary(path, file) {
        loadCalls.push(file);
        return Promise.resolve(file);
      }
    };

    class FileContainerStub {
      constructor(data) { this.data = data; }
      getPart(i) { return { src: this.data, idx: i }; }
    }
    Lemmings.FileContainer = FileContainerStub;

    lrProps = {
      levelName: 'reader',
      releaseRate: 1,
      releaseCount: 2,
      needCount: 3,
      timeLimit: 4,
      skills: ['s']
    };
    class LevelReaderStub {
      constructor(part) {
        this.part = part;
        this.levelWidth = 100;
        this.levelHeight = 50;
        this.screenPositionX = 10;
        this.isSuperLemming = false;
        this.graphicSet1 = 0;
        this.graphicSet2 = 0;
        this.objects = [];
        this.steel = [];
        this.levelProperties = lrProps;
      }
    }
    Lemmings.LevelReader = LevelReaderStub;

    class LevelStub {
      constructor(w, h) {
        this.width = w;
        this.height = h;
      }
      setGroundImage(img) { this.groundImage = img; }
      setGroundMaskLayer(mask) { this.groundMask = mask; }
      setMapObjects(o, img) { this.objects = o; this.objectImages = img; }
      setPalettes(c, g) { this.colorPalette = c; this.groundPalette = g; }
      setSteelAreas(s) { this.steelAreas = s; }
      newSetSteelAreas(lr, t) { this.steelArgs = [lr, t]; }
    }
    Lemmings.Level = LevelStub;

    oddProps = {
      levelName: 'odd',
      releaseRate: 9,
      releaseCount: 8,
      needCount: 7,
      timeLimit: 6,
      skills: ['o']
    };
    class OddTableReaderStub {
      constructor(buf) { this.buf = buf; }
      getLevelProperties(num) { this.num = num; return oddProps; }
    }
    Lemmings.OddTableReader = OddTableReaderStub;

    class GroundReaderStub {
      constructor() {
        this.colorPalette = 'cp';
        this.groundPalette = 'gp';
      }
      getTerrainImages() { return 'terrain'; }
      getObjectImages() { return 'objects'; }
    }
    Lemmings.GroundReader = GroundReaderStub;

    class GroundRendererStub {
      constructor() { this.img = { getData: () => 'img', mask: 'mask' }; }
      createGroundMap() {}
      createVgaspecMap() {}
    }
    Lemmings.GroundRenderer = GroundRendererStub;

    class VGASpecReaderStub { constructor() {} }
    Lemmings.VGASpecReader = VGASpecReaderStub;


    Lemmings.loadSteelSprites = async () => {};

    config = {
      path: 'data',
      gametype: 'GT',
      level: { filePrefix: 'LEVEL', groups: [], useOddTable: false, order: [[23]] }
    };
  });

  afterEach(function () {
    Object.assign(Lemmings, orig);
  });

  it('resolves to a Level with reader properties', async function () {
    const loader = new LevelLoader(fileProvider, config);
    const level = await loader.getLevel(0, 0);
    expect(level).to.be.instanceOf(Lemmings.Level);
    expect(level.name).to.equal('reader');
    expect(level.releaseRate).to.equal(1);
    expect(level.releaseCount).to.equal(2);
    expect(level.needCount).to.equal(3);
    expect(level.timeLimit).to.equal(4);
    expect(level.skills).to.equal(lrProps.skills);
    expect(loadCalls).to.include('LEVEL002.DAT');
    expect(loadCalls).to.include('VGAGR0.DAT');
    expect(loadCalls).to.include('GROUND0O.DAT');
  });

  it('uses OddTable when enabled', async function () {
    config.level.useOddTable = true;
    config.level.order = [[-1]];
    const loader = new LevelLoader(fileProvider, config);
    const level = await loader.getLevel(0, 0);
    expect(level.name).to.equal('odd');
    expect(level.releaseRate).to.equal(9);
    expect(level.releaseCount).to.equal(8);
    expect(level.needCount).to.equal(7);
    expect(level.timeLimit).to.equal(6);
    expect(level.skills).to.equal(oddProps.skills);
    expect(loadCalls).to.include('ODDTABLE.DAT');
  });
});
