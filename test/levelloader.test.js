import { expect } from 'chai';
import { readFileSync } from 'fs';
import { createHash } from 'node:crypto';
import { Lemmings, setDependency, useGlobalLemmings } from './helpers/lemmings.js';
import '../js/LemmingsBootstrap.js';
import { __test__ as LevelLoaderTest } from '../js/level/LevelLoader.js';
import { FileProvider } from '../js/data/FileProvider.js';
import { ResourceLoadError } from '../js/data/file-provider/ResourceLoadError.js';
import assert from 'node:assert/strict';

// Silence debug output


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

const countMaskPixels = (mask) => {
  if (!mask || !Array.isArray(mask) && !mask.length) return 0;
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) count += 1;
  }
  return count;
};

const makeProvider = (oddLoader) => class Provider {
  loadBinary(path, file) {
    if (file === 'ODDTABLE.DAT' && oddLoader) {
      return oddLoader();
    }
    const data = readFileSync(new URL(`../${path}/${file}`, import.meta.url));
    return Promise.resolve(
      new Lemmings.BinaryReader(new Uint8Array(data), 0, data.length, file, path)
    );
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
  useGlobalLemmings({ game: { showDebug: false } });

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
      () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    );
    const level = await withSteelSpritesStub(async () => {
      const loader = new Lemmings.LevelLoader(new Provider(), config);
      return loader.getLevel(0, 0);
    });

    expectLevelProperties(level, baseProps);
  });

  it('does not hide a failed present odd table as an absent optional file', async function() {
    const Provider = makeProvider(() => Promise.reject(new Error('corrupt odd table')));
    await withSteelSpritesStub(async () => {
      try { await new Lemmings.LevelLoader(new Provider(), makeConfig()).getLevel(0, 0); throw new Error('Expected odd-table rejection'); }
      catch (error) { expect(error.message).to.equal('corrupt odd table'); }
    });
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

  it('falls back to seasonal resource packs when local terrain files are missing', async function () {
    const calls = [];
    class Provider {
      loadBinary(path, file) {
        calls.push(`${path}/${file}`);
        const data = readFileSync(new URL(`../${path}/${file}`, import.meta.url));
        return Promise.resolve(
          new Lemmings.BinaryReader(new Uint8Array(data), 0, data.length, file, path)
        );
      }
    }

    const config = makeConfig({
      path: 'xmas92',
      gametype: Lemmings.GameTypes.XMAS92,
      level: {
        filePrefix: 'LEVEL',
        useOddTable: false,
        order: [[4]]
      }
    });

    const loader = new Lemmings.LevelLoader(new Provider(), config);
    const level = await loader.getLevel(0, 0);

    expect(level).to.be.instanceOf(Lemmings.Level);
    expect(calls).to.include('xmas92/GROUND0O.DAT');
    expect(calls).to.include('xmas91/GROUND0O.DAT');
    expect(level.resourceSources.ground).to.deep.equal({ root: 'xmas91', filename: 'GROUND0O.DAT' });
  });

  it('uses HTTP 404 for seasonal fallback but never substitutes on a server failure', async function() {
    const config = makeConfig({ path: 'xmas92', gametype: Lemmings.GameTypes.XMAS92,
      level: { filePrefix: 'LEVEL', useOddTable: false, order: [[4]] } });
    const makeHttpProvider = (groundStatus = 404) => {
      const requests = [];
      class Xhr {
        open(method, url) { this.url = url; }
        getResponseHeader() { return null; }
        send() {
          const path = this.url.slice(1); requests.push(path);
          queueMicrotask(() => {
            if (path === 'xmas92/GROUND0O.DAT') this.status = groundStatus;
            else {
              try {
                const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
                this.response = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                this.status = 200;
              } catch (error) { this.status = error.code === 'ENOENT' ? 404 : 500; }
            }
            this.onload();
          });
        }
      }
      return { provider: new FileProvider('/', { indexedDB: null, localStorage: null, createXMLHttpRequest: () => new Xhr() }), requests };
    };
    await withSteelSpritesStub(async () => {
      const found = makeHttpProvider(), level = await new Lemmings.LevelLoader(found.provider, config).getLevel(0, 0);
      expect(level).to.be.instanceOf(Lemmings.Level);
      expect(found.requests).to.include('xmas91/GROUND0O.DAT');
      expect(level.resourceSources.ground.root).to.equal('xmas91');
      const failed = makeHttpProvider(500);
      try { await new Lemmings.LevelLoader(failed.provider, config).getLevel(0, 0); throw new Error('Expected HTTP 500 rejection'); }
      catch (error) { expect(error.kind).to.equal('server'); expect(error.status).to.equal(500); }
      expect(failed.requests).not.to.include('xmas91/GROUND0O.DAT');
    });
  });

  it('uses ordered explicit nested fallback roots once and records their source', async function() {
    const calls = [];
    class Provider {
      loadBinary(root, file) {
        calls.push(`${root}/${file}`);
        const folder = root === 'packs/shared/xmas91' ? 'xmas91' : root;
        const data = readFileSync(new URL(`../${folder}/${file}`, import.meta.url));
        return Promise.resolve(new Lemmings.BinaryReader(new Uint8Array(data), 0, data.length, file, root));
      }
    }
    const config = makeConfig({ path: 'xmas92', gametype: Lemmings.GameTypes.XMAS92,
      resourceFallbackPaths: ['missing', 'packs/shared/xmas91', 'packs/shared/xmas91'],
      level: { filePrefix: 'LEVEL', useOddTable: false, order: [[4]] } });
    const loader = new Lemmings.LevelLoader(new Provider(), config);
    const level = await loader.getLevel(0, 0);
    expect(loader.resourceFallbackPaths).to.deep.equal(['xmas92', 'missing', 'packs/shared/xmas91', 'xmas91']);
    expect(level.resourceSources.ground).to.deep.equal({ root: 'packs/shared/xmas91', filename: 'GROUND0O.DAT' });
    expect(calls.filter(call => call.endsWith('/GROUND0O.DAT'))).to.deep.equal([
      'xmas92/GROUND0O.DAT', 'missing/GROUND0O.DAT', 'packs/shared/xmas91/GROUND0O.DAT'
    ]);
  });

  it('reports all attempted fallback roots and preserves nonabsence failures', async function() {
    const config = makeConfig({ path: 'xmas92', gametype: Lemmings.GameTypes.XMAS92,
      resourceFallbackPaths: ['missing'], level: { filePrefix: 'LEVEL', useOddTable: false, order: [[4]] } });
    class MissingProvider {
      loadBinary(root, file) {
        if (file === 'GROUND0O.DAT') throw new ResourceLoadError('not-found', `${root}/${file}`, { status: 404 });
        const data = readFileSync(new URL(`../${root}/${file}`, import.meta.url));
        return Promise.resolve(new Lemmings.BinaryReader(new Uint8Array(data), 0, data.length, file, root));
      }
    }
    try { await new Lemmings.LevelLoader(new MissingProvider(), config).getLevel(0, 0); expect.fail('Expected exhausted roots'); }
    catch (error) { expect(error.kind).to.equal('not-found'); expect(error.attemptedRoots).to.deep.equal(['xmas92', 'missing', 'xmas91']); }
    for (const kind of ['denied', 'cancelled', 'integrity', 'server']) {
      const calls = [];
      class FailingProvider extends MissingProvider {
        loadBinary(root, file) {
          calls.push(`${root}/${file}`);
          if (file === 'GROUND0O.DAT') throw new ResourceLoadError(kind, `${root}/${file}`);
          return super.loadBinary(root, file);
        }
      }
      try { await new Lemmings.LevelLoader(new FailingProvider(), config).getLevel(0, 0); expect.fail('Expected terminal failure'); }
      catch (error) { expect(error.kind).to.equal(kind); expect(error.attemptedRoots).to.deep.equal(['xmas92']); }
      expect(calls).not.to.include('xmas91/GROUND0O.DAT');
    }
  });

  it('verifies pinned resource bytes and never substitutes a different root for a pin', async function() {
    const digest = createHash('sha256').update(readFileSync(new URL('../xmas91/GROUND0O.DAT', import.meta.url))).digest('hex');
    const config = makeConfig({ path: 'xmas92', gametype: Lemmings.GameTypes.XMAS92,
      resourcePins: { 'GROUND0O.DAT': { root: 'xmas91', sha256: digest } },
      level: { filePrefix: 'LEVEL', useOddTable: false, order: [[4]] } });
    const Provider = makeProvider();
    const level = await new Lemmings.LevelLoader(new Provider(), config).getLevel(0, 0);
    expect(level.resourceSources.ground).to.deep.equal({ root: 'xmas91', filename: 'GROUND0O.DAT', sha256: digest });
    config.resourcePins['GROUND0O.DAT'].sha256 = '0'.repeat(64);
    const invalid = new Lemmings.LevelLoader(new Provider(), config);
    try { await invalid.getLevel(0, 0); expect.fail('Expected integrity rejection'); }
    catch (error) { expect(error.kind).to.equal('integrity'); expect(error.attemptedRoots).to.deep.equal(['xmas91']); }
    config.resourcePins['GROUND0O.DAT'] = { root: 'xmas92', sha256: digest };
    const missing = new Lemmings.LevelLoader(new Provider(), config);
    try { await missing.getLevel(0, 0); expect.fail('Expected pinned absence'); }
    catch (error) { expect(error.kind).to.equal('not-found'); expect(error.attemptedRoots).to.deep.equal(['xmas92']); }
  });

  it('requires an explicitly strict odd table without hiding absent or empty declared entries', async function() {
    const config = makeConfig({ level: { oddTableRequired: true } });
    const missing = makeProvider(() => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })));
    try { await new Lemmings.LevelLoader(new missing(), config).getLevel(0, 0); expect.fail('Expected required table'); }
    catch (error) { expect(error.code).to.equal('ENOENT'); }
    const empty = makeProvider(() => Promise.resolve(new Lemmings.BinaryReader(new Uint8Array(0))));
    try { await new Lemmings.LevelLoader(new empty(), config).getLevel(0, 0); expect.fail('Expected required table entry'); }
    catch (error) { expect(error.kind).to.equal('decode'); }
    const pinned = makeConfig({ resourcePins: { 'ODDTABLE.DAT': { root: 'lemmings', sha256: '0'.repeat(64) } } });
    try { await new Lemmings.LevelLoader(new missing(), pinned).getLevel(0, 0); expect.fail('Expected pinned table absence'); }
    catch (error) { expect(error.code).to.equal('ENOENT'); }
  });

  it('applies seasonal steel sprite mappings to generate steel masks', async function () {
    const Provider = makeProvider();
    const seasonalCases = [
      {
        path: 'xmas91',
        gametype: Lemmings.GameTypes.XMAS91,
        level: { filePrefix: 'LEVEL', useOddTable: false, order: [[3]] }
      },
      {
        path: 'xmas92',
        gametype: Lemmings.GameTypes.XMAS92,
        level: { filePrefix: 'LEVEL', useOddTable: false, order: [[3]] }
      },
      {
        path: 'holiday93',
        gametype: Lemmings.GameTypes.HOLIDAY93,
        level: { filePrefix: 'LEVEL', useOddTable: false, order: [[1]] }
      },
      {
        path: 'holiday94',
        gametype: Lemmings.GameTypes.HOLIDAY94,
        level: { filePrefix: 'LEVEL', useOddTable: false, order: [[1]] }
      }
    ];

    for (let i = 0; i < seasonalCases.length; i += 1) {
      const config = makeConfig(seasonalCases[i]);
      const loader = new Lemmings.LevelLoader(new Provider(), config);
      const level = await loader.getLevel(0, 0);
      const steelPixels = countMaskPixels(level?.steelMask?.mask);
      expect(steelPixels, `expected steel mask pixels for ${config.path}`).to.be.greaterThan(0);
    }
  });

  it('aborts failed graphics siblings and releases a late result without publishing a level', async function() {
    const readers = [], signals = []; let finishLate;
    const provider = { loadBinary(root, file, options) {
      signals.push(options.signal);
      if (file.startsWith('VGAGR')) return new Promise(resolve => { finishLate = resolve; });
      if (file.startsWith('GROUND')) return Promise.reject(new ResourceLoadError('server', file, { status: 500 }));
      const bytes = readFileSync(new URL(`../${root}/${file}`, import.meta.url));
      const reader = new Lemmings.BinaryReader(new Uint8Array(bytes), 0, bytes.length, file, root);
      readers.push(reader); return Promise.resolve(reader);
    } };
    const loader = new Lemmings.LevelLoader(provider, makeConfig({ level: { useOddTable: false, order: [[0]] } }));
    await assert.rejects(loader.getLevel(0, 0), error => error.kind === 'server');
    assert.equal(signals.every(signal => signal.aborted), true);
    assert.equal(readers.every(reader => reader.length === 0), true);
    const late = new Lemmings.BinaryReader(Uint8Array.of(1)); finishLate(late);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(late.length, 0);
  });

  it('rejects cancellation before reading or falling back to another root', async function() {
    let loads = 0; const controller = new AbortController(); controller.abort();
    const loader = new Lemmings.LevelLoader({ loadBinary() { loads++; } }, makeConfig());
    await assert.rejects(loader.getLevel(0, 0, { signal: controller.signal, operationId: 99 }), error => error.kind === 'cancelled' && error.operationId === 99);
    assert.equal(loads, 0);
  });
});
