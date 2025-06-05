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
      level: { filePrefix: 'LEVEL', useOddTable: true, order: [[0]] }
    };

    const loader = new Lemmings.LevelLoader(new Provider(), config);
    const level = await loader.getLevel(0, 0);
    Lemmings.loadSteelSprites = origLoad;

    expect(level).to.be.instanceOf(Lemmings.Level);
    expect(level.objects.length).to.equal(lr.objects.length);
    expect(level.steelRanges.length / 4).to.equal(lr.steel.length);
    expect(level.groundImage.length).to.be.above(0);
  });
});
