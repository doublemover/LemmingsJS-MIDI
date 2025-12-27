import { expect } from 'chai';
import { EditorLevel } from '../../js/editor/EditorLevel.js';
import { createClassicLevelData, loadEditorLevel } from '../../js/editor/EditorLevelLoader.js';
import { resetStyleRegistry, registerClassicStyles, registerStyle } from '../../js/editor/StyleRegistry.js';

const buildEntry = (props) => ({ props, order: Object.keys(props), unknownLines: [] });

const buildLevel = () => {
  const level = new EditorLevel();
  level.setHeader('TITLE', 'Preview');
  level.setHeader('STYLE', 'preview');
  level.setHeader('WIDTH', 800);
  level.setHeader('HEIGHT', 200);
  level.setHeader('LEMMINGS', 12);
  level.setHeader('SAVE_REQUIREMENT', 8);
  level.setHeader('TIME_LIMIT', 'INFINITE');
  level.setHeader('MAX_SPAWN_INTERVAL', 40);
  level.setHeader('START_X', 16);
  level.setSkill('CLIMBER', 2);
  level.terrains = [
    buildEntry({
      STYLE: 'preview',
      PIECE: 'block',
      X: 10,
      Y: 20,
      FLIP_VERTICAL: 'true',
      NO_OVERWRITE: '0',
      ERASE: 1
    })
  ];
  level.gadgets = [
    buildEntry({
      STYLE: 'preview',
      PIECE: 3,
      X: 30,
      Y: 40,
      NO_OVERWRITE: true
    })
  ];
  level.steel = [
    buildEntry({
      X: 2,
      Y: 4,
      WIDTH: 6,
      HEIGHT: 8
    })
  ];
  return level;
};

const createFakeDeps = () => {
  const calls = {
    loadBinary: [],
    loadSteelSprites: 0
  };

  class FakeLevel {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.steelAreas = [];
      this.setGroundImageCalled = false;
      this.setGroundMaskCalled = false;
      this.setMapObjectsArgs = null;
      this.setPalettesArgs = null;
      this.newSetSteelAreasArgs = null;
    }

    setGroundImage(data) {
      this.groundImage = data;
      this.setGroundImageCalled = true;
    }

    setGroundMaskLayer(layer) {
      this.groundMask = layer;
      this.setGroundMaskCalled = true;
    }

    setMapObjects(objects, images) {
      this.setMapObjectsArgs = [objects, images];
    }

    setPalettes(colorPalette, groundPalette) {
      this.setPalettesArgs = [colorPalette, groundPalette];
    }

    setSteelAreas(areas) {
      this.steelAreas = areas;
    }

    newSetSteelAreas(levelReader, terrainImages) {
      this.newSetSteelAreasArgs = [levelReader, terrainImages];
    }
  }

  class FakeContainer {
    constructor(buf) {
      this.buf = buf;
    }

    getPart(index) {
      return { index, buf: this.buf };
    }
  }

  class FakeGroundReader {
    constructor(ground, terrain, objects) {
      this.ground = ground;
      this.terrain = terrain;
      this.objects = objects;
      this.colorPalette = { name: 'color' };
      this.groundPalette = { name: 'ground' };
      this.terrainImages = [{ id: 0 }];
      this.objectImages = [{ id: 0 }];
    }

    getTerrainImages() {
      return this.terrainImages;
    }

    getObjectImages() {
      return this.objectImages;
    }
  }

  class FakeGroundRenderer {
    createGroundMap() {
      this.img = {
        getData: () => new Uint8ClampedArray([0, 0, 0, 255]),
        mask: new Uint8ClampedArray([0])
      };
    }
  }

  class FakeSolidLayer {
    constructor(width, height, mask) {
      this.width = width;
      this.height = height;
      this.mask = mask;
    }
  }

  const fakeFileProvider = {
    loadBinary: (path, filename) => {
      calls.loadBinary.push({ path, filename });
      return Promise.resolve({ path, filename });
    }
  };

  const loadSteelSprites = async () => {
    calls.loadSteelSprites += 1;
  };

  return {
    calls,
    deps: {
      Level: FakeLevel,
      FileContainer: FakeContainer,
      GroundReader: FakeGroundReader,
      GroundRenderer: FakeGroundRenderer,
      SolidLayer: FakeSolidLayer,
      loadSteelSprites
    },
    fileProvider: fakeFileProvider
  };
};

describe('EditorLevelLoader', () => {
  afterEach(() => {
    resetStyleRegistry();
    registerClassicStyles();
  });

  it('returns null when editor level data is missing', () => {
    expect(createClassicLevelData(null)).to.equal(null);
  });

  it('maps editor headers, skills, and pieces into classic data', () => {
    resetStyleRegistry();
    registerStyle('preview', {
      groundSet: 2,
      terrainPieces: [{ id: 4, name: 'block' }],
      gadgetPieces: [{ id: 3, name: 'exit' }]
    });
    const level = buildLevel();
    const data = createClassicLevelData(level, { styleName: 'preview' });
    const reader = data.levelReader;
    expect(data.styleName).to.equal('preview');
    expect(data.groundSet).to.equal(2);
    expect(reader.levelWidth).to.equal(800);
    expect(reader.levelHeight).to.equal(200);
    expect(reader.screenPositionX).to.equal(16);
    expect(reader.levelProperties.levelName).to.equal('Preview');
    expect(reader.levelProperties.releaseRate).to.equal(40);
    expect(reader.levelProperties.releaseCount).to.equal(12);
    expect(reader.levelProperties.needCount).to.equal(8);
    expect(reader.levelProperties.timeLimit).to.equal(0);
    expect(reader.levelProperties.skills[1]).to.equal(2);
    expect(reader.terrains[0].id).to.equal(4);
    expect(reader.terrains[0].drawProperties.isUpsideDown).to.equal(true);
    expect(reader.terrains[0].drawProperties.isErase).to.equal(true);
    expect(reader.objects[0].id).to.equal(3);
    expect(reader.objects[0].drawProperties.noOverwrite).to.equal(true);
    expect(reader.steel).to.have.length(1);
    expect(reader.steel[0].width).to.equal(6);
  });

  it('falls back to default style values and ignores unknown skills', () => {
    resetStyleRegistry();
    registerStyle('alpha', { groundSet: 5 });
    const level = new EditorLevel();
    level.setHeader('TITLE', 'Fallback');
    level.setHeader('WIDTH', NaN);
    level.setHeader('HEIGHT', null);
    level.setHeader('TIME_LIMIT', 120);
    level.setSkill('UNKNOWN', 5);
    const data = createClassicLevelData(level);
    expect(data.styleName).to.equal('alpha');
    expect(data.groundSet).to.equal(5);
    expect(data.levelReader.levelWidth).to.equal(1600);
    expect(data.levelReader.levelHeight).to.equal(160);
    expect(data.levelReader.levelProperties.timeLimit).to.equal(120);
    expect(data.levelReader.levelProperties.skills[0]).to.equal(0);
  });

  it('uses the header style when present', () => {
    resetStyleRegistry();
    registerStyle('header', { groundSet: 6 });
    const level = new EditorLevel();
    level.setHeader('STYLE', 'header');
    const data = createClassicLevelData(level);
    expect(data.styleName).to.equal('header');
    expect(data.groundSet).to.equal(6);
  });

  it('uses dirt when no styles are available and pieces cannot resolve', () => {
    resetStyleRegistry();
    const level = new EditorLevel();
    level.skillset = null;
    level.gadgets = null;
    level.terrains = [buildEntry({ STYLE: 'missing', PIECE: 'unknown', X: 1, Y: 2 })];
    level.steel = null;
    const data = createClassicLevelData(level);
    expect(data.styleName).to.equal('dirt');
    expect(data.groundSet).to.equal(0);
    expect(data.levelReader.terrains[0].id).to.equal(0);
  });

  it('filters invalid steel entries', () => {
    resetStyleRegistry();
    registerStyle('preview', { groundSet: 1 });
    const level = new EditorLevel();
    level.setHeader('STYLE', 'preview');
    level.steel = [buildEntry({ X: 1, Y: 2, WIDTH: 0, HEIGHT: 3 })];
    const data = createClassicLevelData(level);
    expect(data.levelReader.steel).to.have.length(0);
  });

  it('handles steel entries without props', () => {
    resetStyleRegistry();
    registerStyle('preview', { groundSet: 1 });
    const level = new EditorLevel();
    level.setHeader('STYLE', 'preview');
    level.steel = [null];
    const data = createClassicLevelData(level);
    expect(data.levelReader.steel).to.deep.equal([]);
  });

  it('treats unknown flag values as false', () => {
    resetStyleRegistry();
    registerStyle('preview', { groundSet: 1, terrainPieces: [{ id: 0, name: 'block' }] });
    const level = new EditorLevel();
    level.setHeader('STYLE', 'preview');
    level.terrains = [
      buildEntry({ STYLE: 'preview', PIECE: 'block', X: 2, Y: 3, ERASE: 'maybe' })
    ];
    const data = createClassicLevelData(level);
    expect(data.levelReader.terrains[0].drawProperties.isErase).to.equal(false);
  });

  it('handles entries without props', () => {
    resetStyleRegistry();
    registerStyle('preview', { groundSet: 1 });
    const level = new EditorLevel();
    level.setHeader('STYLE', 'preview');
    level.terrains = [null];
    const data = createClassicLevelData(level);
    expect(data.levelReader.terrains[0].id).to.equal(0);
  });

  it('treats non-string flag values outside 0/1 as false', () => {
    resetStyleRegistry();
    registerStyle('preview', { groundSet: 1, terrainPieces: [{ id: 0, name: 'block' }] });
    const level = new EditorLevel();
    level.setHeader('STYLE', 'preview');
    level.terrains = [
      buildEntry({ STYLE: 'preview', PIECE: 'block', X: 2, Y: 3, ERASE: 2 })
    ];
    const data = createClassicLevelData(level);
    expect(data.levelReader.terrains[0].drawProperties.isErase).to.equal(false);
  });

  it('loads a preview level using injected dependencies', async () => {
    resetStyleRegistry();
    registerStyle('preview', { groundSet: 3 });
    const level = buildLevel();
    const { deps, calls, fileProvider } = createFakeDeps();
    const config = { gametype: 1, path: 'game', mechanics: { test: true } };
    const runtime = await loadEditorLevel(level, config, fileProvider, {
      ...deps,
      levelGroupIndex: 2,
      levelIndex: 4,
      steelRanges: [{ x: 1, y: 2, width: 3, height: 4 }]
    });
    expect(runtime.gameType).to.equal(1);
    expect(runtime.levelMode).to.equal(2);
    expect(runtime.levelIndex).to.equal(4);
    expect(runtime.mechanics.test).to.equal(true);
    expect(runtime.setGroundImageCalled).to.equal(true);
    expect(runtime.setGroundMaskCalled).to.equal(true);
    expect(runtime.setMapObjectsArgs[0]).to.have.length(1);
    expect(runtime.setPalettesArgs[0].name).to.equal('color');
    expect(runtime.steelAreas).to.have.length(1);
    expect(runtime.newSetSteelAreasArgs).to.not.equal(null);
    expect(calls.loadSteelSprites).to.equal(1);
    expect(calls.loadBinary[0]).to.deep.equal({ path: 'game', filename: 'VGAGR3.DAT' });
    expect(calls.loadBinary[1]).to.deep.equal({ path: 'game', filename: 'GROUND3O.DAT' });
  });

  it('handles missing newSetSteelAreas when steel ranges exist', async () => {
    resetStyleRegistry();
    registerStyle('preview', { groundSet: 3 });
    const level = buildLevel();
    const { deps, fileProvider } = createFakeDeps();
    const config = { gametype: 1, path: 'game', mechanics: {} };
    const LevelWithoutSteel = class extends deps.Level {
      newSetSteelAreas() {}
    };
    LevelWithoutSteel.prototype.newSetSteelAreas = undefined;
    const runtime = await loadEditorLevel(level, config, fileProvider, {
      ...deps,
      Level: LevelWithoutSteel,
      steelRanges: [{ x: 0, y: 0, width: 1, height: 1 }]
    });
    expect(runtime.newSetSteelAreasArgs).to.equal(null);
  });

  it('skips steel processing when no steel ranges are provided', async () => {
    resetStyleRegistry();
    registerStyle('preview', { groundSet: 1 });
    const level = buildLevel();
    level.steel = [];
    const { deps, fileProvider } = createFakeDeps();
    const config = { gametype: 2, path: 'game' };
    const runtime = await loadEditorLevel(level, config, fileProvider, deps);
    expect(runtime.mechanics).to.deep.equal({});
    expect(runtime.levelMode).to.equal(0);
    expect(runtime.levelIndex).to.equal(0);
    expect(runtime.steelAreas).to.have.length(0);
    expect(runtime.newSetSteelAreasArgs).to.equal(null);
  });

  it('returns null when loadEditorLevel inputs are missing', async () => {
    const level = buildLevel();
    const { deps } = createFakeDeps();
    const config = { gametype: 1, path: 'game', mechanics: {} };
    expect(await loadEditorLevel(null, config, deps)).to.equal(null);
    expect(await loadEditorLevel(level, null, deps)).to.equal(null);
    expect(await loadEditorLevel(level, config, null)).to.equal(null);
  });
});
