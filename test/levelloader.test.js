import { expect } from 'chai';
import { readFileSync } from 'fs';
import { Lemmings, setDependency, useGlobalLemmings } from './helpers/lemmings.js';
import '../js/LemmingsBootstrap.js';
import { __test__ as LevelLoaderTest } from '../js/level/LevelLoader.js';

// Silence debug output
useGlobalLemmings({ game: { showDebug: false } });

const readLevelProperties = (config, levelMode, levelIndex) => {
  const resolver = new Lemmings.LevelIndexResolve(config);
  const info = resolver.resolve(levelMode, levelIndex);
  const paddedFileId = ('0000' + info.fileId).slice(-3);
  const buf = readFileSync(
    new URL(
      `../${config.path}/${config.level.filePrefix}${paddedFileId}.DAT`,
      import.meta.url
    )
  );
  const br = new Lemmings.BinaryReader(new Uint8Array(buf));
  const fc = new Lemmings.FileContainer(br);
  const lr = new Lemmings.LevelReader(fc.getPart(info.partIndex));
  return lr.levelProperties;
};

const makeConfig = (overrides = {}) => ({
  path: 'lemmings',
  gametype: Lemmings.GameTypes.LEMMINGS,
  mechanics: {},
  ...overrides,
  level: {
    filePrefix: 'LEVEL',
    useOddTable: true,
    order: [[-1]],
    ...overrides.level
  }
});

const expectLevelProperties = (level, props) => {
  expect(level.name).to.equal(props.levelName);
  expect(level.releaseRate).to.equal(props.releaseRate);
  expect(level.releaseCount).to.equal(props.releaseCount);
  expect(level.needCount).to.equal(props.needCount);
  expect(level.timeLimit).to.equal(props.timeLimit);
  expect(level.skills).to.deep.equal(props.skills);
};

const makeProvider = (oddLoader) => class Provider {
  loadBinary(path, file) {
    if (file === 'ODDTABLE.DAT' && oddLoader) {
      return oddLoader();
    }
    const data = readFileSync(new URL(`../${path}/${file}`, import.meta.url));
    return Promise.resolve(new Lemmings.BinaryReader(new Uint8Array(data)));
  }
};

const withSteelSpritesStub = async (fn) => {
  const origLoad = Lemmings.loadSteelSprites;
  setDependency('loadSteelSprites', async () => []);
  try {
    return await fn();
  } finally {
    setDependency('loadSteelSprites', origLoad);
  }
};

describe('LevelLoader', function () {
  it('builds a level from LEVEL000.DAT', async function () {
    const buf = readFileSync(new URL('../lemmings/LEVEL000.DAT', import.meta.url));
    const br = new Lemmings.BinaryReader(new Uint8Array(buf));
    const fc = new Lemmings.FileContainer(br);
    const lr = new Lemmings.LevelReader(fc.getPart(0));

    const config = makeConfig({
      mechanics: { gravity: 9.8 },
      level: { order: [[0]] }
    });

    const level = await withSteelSpritesStub(async () => {
      const Provider = makeProvider();
      const loader = new Lemmings.LevelLoader(new Provider(), config);
      return loader.getLevel(0, 0);
    });

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

    const config = makeConfig({
      path: 'pack',
      level: { useOddTable: false, order: [[0]] }
    });

    const loader = new Lemmings.LevelLoader(new StubProvider(), config);
    const res1 = await loader.getLevel(1, 0);
    const res2 = await loader.getLevel(0, 2);

    expect(res1).to.be.null;
    expect(res2).to.be.null;
    expect(called).to.equal(0);
  });

  it('loads odd table data and vgaspec levels when configured', async function () {
    const oddBuf = new Uint8Array(56);
    const dv = new DataView(oddBuf.buffer);
    let pos = 0;
    dv.setUint16(pos, 12); pos += 2;
    dv.setUint16(pos, 34); pos += 2;
    dv.setUint16(pos, 5); pos += 2;
    dv.setUint16(pos, 9); pos += 2;
    for (let i = 0; i < 8; i++) {
      dv.setUint16(pos, i + 1);
      pos += 2;
    }
    const name = 'OddTable';
    for (let i = 0; i < name.length; i++) {
      oddBuf[pos + i] = name.charCodeAt(i);
    }

    const config = makeConfig();

    const level = await withSteelSpritesStub(async () => {
      const Provider = makeProvider(
        () => Promise.resolve(new Lemmings.BinaryReader(oddBuf))
      );
      const loader = new Lemmings.LevelLoader(new Provider(), config);
      return loader.getLevel(0, 0);
    });

    expect(level.releaseRate).to.equal(12);
    expect(level.releaseCount).to.equal(34);
    expect(level.needCount).to.equal(5);
    expect(level.timeLimit).to.equal(9);
    expect(level.name.startsWith('OddTable')).to.equal(true);
  });

  it('falls back to base properties when odd table is missing', async function () {
    const config = makeConfig();
    const baseProps = readLevelProperties(config, 0, 0);
    const Provider = makeProvider(
      () => Promise.reject(new Error('missing'))
    );
    const level = await withSteelSpritesStub(async () => {
      const loader = new Lemmings.LevelLoader(new Provider(), config);
      return loader.getLevel(0, 0);
    });

    expectLevelProperties(level, baseProps);
  });

  it('falls back to base properties when odd table is empty', async function () {
    const config = makeConfig();
    const baseProps = readLevelProperties(config, 0, 0);
    const Provider = makeProvider(
      () => Promise.resolve(new Lemmings.BinaryReader(new Uint8Array(0)))
    );
    const level = await withSteelSpritesStub(async () => {
      const loader = new Lemmings.LevelLoader(new Provider(), config);
      return loader.getLevel(0, 0);
    });

    expectLevelProperties(level, baseProps);
  });

  it('falls back to base properties when odd table entry is missing', async function () {
    const config = makeConfig({ level: { order: [[-1], [-1]] } });
    const baseProps = readLevelProperties(config, 1, 0);
    const oddBuf = new Uint8Array(56);
    const Provider = makeProvider(
      () => Promise.resolve(new Lemmings.BinaryReader(oddBuf))
    );
    const level = await withSteelSpritesStub(async () => {
      const loader = new Lemmings.LevelLoader(new Provider(), config);
      return loader.getLevel(1, 0);
    });

    expectLevelProperties(level, baseProps);
  });

  it('merges odd table properties and expands skill lists', function () {
    const base = {
      levelName: 'Base',
      releaseRate: 1,
      releaseCount: 2,
      needCount: 3,
      timeLimit: 4,
      skills: [1]
    };
    const odd = { skills: [9, 8, 7] };
    const merged = LevelLoaderTest.mergeLevelProperties(base, odd);
    expect(merged.skills).to.eql([9, 8, 7]);

    const mergedNoSkills = LevelLoaderTest.mergeLevelProperties(
      { ...base, skills: null },
      { skills: [5, 6] }
    );
    expect(mergedNoSkills.skills).to.eql([5, 6]);
  });

});
