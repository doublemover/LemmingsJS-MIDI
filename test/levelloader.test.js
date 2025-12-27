import { expect } from 'chai';
import { readFileSync } from 'fs';
import { Lemmings, setDependency } from './helpers/lemmings.js';
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
    setDependency('loadSteelSprites', async () => []);

    const config = {
      path: 'lemmings',
      gametype: Lemmings.GameTypes.LEMMINGS,
      mechanics: { gravity: 9.8 },
      level: { filePrefix: 'LEVEL', useOddTable: true, order: [[0]] }
    };

    const loader = new Lemmings.LevelLoader(new Provider(), config);
    const level = await loader.getLevel(0, 0);
    setDependency('loadSteelSprites', origLoad);

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

    class Provider {
      loadBinary(path, file) {
        if (file === 'ODDTABLE.DAT') {
          return Promise.resolve(new Lemmings.BinaryReader(oddBuf));
        }
        const data = readFileSync(new URL(`../${path}/${file}`, import.meta.url));
        return Promise.resolve(new Lemmings.BinaryReader(new Uint8Array(data)));
      }
    }

    const origLoad = Lemmings.loadSteelSprites;
    setDependency('loadSteelSprites', async () => []);

    const config = {
      path: 'lemmings',
      gametype: Lemmings.GameTypes.LEMMINGS,
      mechanics: {},
      level: { filePrefix: 'LEVEL', useOddTable: true, order: [[-1]] }
    };

    const loader = new Lemmings.LevelLoader(new Provider(), config);
    const level = await loader.getLevel(0, 0);
    setDependency('loadSteelSprites', origLoad);

    expect(level.releaseRate).to.equal(12);
    expect(level.releaseCount).to.equal(34);
    expect(level.needCount).to.equal(5);
    expect(level.timeLimit).to.equal(9);
    expect(level.name.startsWith('OddTable')).to.equal(true);
  });

});
