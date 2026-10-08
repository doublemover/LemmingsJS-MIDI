import { expect } from 'chai';
import fs from 'node:fs';
import { createTerrainDescriptorMiner } from '../tools/TerrainDescriptorMiner.js';
import { getPackTerrainWidthLimit, selectTerrainDescriptor, validateTerrainDescriptors } from '../js/app/procgen/ProcgenTerrainDescriptors.js';

const hash = 'a'.repeat(64), theme = { id: 'selected-0', assetSha256: hash, catalog: [{ id: 0 }, { id: 1 }] };
const level = extra => ({ id: 'selected/LEVEL000.DAT#0', format: 'classic-dat', pack: 'selected', groundSet: 0, title: 'Fixture',
  aliases: ['selected/1/1', 'selected/1/2'], width: 1600, height: 160, sha256: 'b'.repeat(64),
  placements: [{ id: 0, x: 10, y: 20, f: 0 }, { id: 1, x: 12, y: 20, f: 8 }], ...extra });
const derive = (config = { path: 'selected' }, extra = {}, art = theme) => {
  const miner = createTerrainDescriptorMiner([config]), source = level(extra), recorder = miner.beginLevel(source, art);
  if (recorder) { recorder.record('join', source.placements, { terrainIndices: [0, 1] }); recorder.record('join', source.placements, { terrainIndices: [0, 1] }); }
  return miner.finish();
};

describe('canonical normal-level terrain descriptors', () => {
  it('deduplicates aliases, source observations and groups while retaining width and exact source evidence', () => {
    const miner = createTerrainDescriptorMiner([{ path: 'selected' }]), first = level();
    const recorder = miner.beginLevel(first, theme);
    recorder.record('join', first.placements, { terrainIndices: [0, 1] }); recorder.record('join', first.placements, { terrainIndices: [0, 1] });
    expect(miner.beginLevel(first, theme)).to.equal(null);
    miner.beginLevel(level({ id: 'selected/LEVEL000.DAT#1', width: 800 }), theme);
    const [descriptor] = miner.finish(); validateTerrainDescriptors([descriptor]);
    expect(descriptor.normalLevelCount).to.equal(2); expect(descriptor.sourceLevelIds).to.have.length(2);
    expect(descriptor.widths).to.include({ min: 800, median: 800, max: 1600, maxSourceCount: 1 });
    expect(descriptor.widths.maxSources).to.deep.equal([{ level: first.id, width: 1600 }]);
    expect(descriptor.assetPairs[0]).to.include({ a: 0, b: 1, count: 2 }); expect(descriptor.groups[0].count).to.equal(1);
    expect(descriptor.groups[0].placements).to.deep.equal([{ id: 0, x: 0, y: 0, f: 0 }, { id: 1, x: 2, y: 0, f: 8 }]);
  });
  it('excludes unconfigured, generated, special, nonclassic and foreign-pack sources', () => {
    for (const extra of [{ aliases: [] }, { generated: true, width: 1000000000 }, { graphicSet2: 1 }, { format: 'nxlv' },
      { pack: 'foreign', id: 'foreign/LEVEL000.DAT#0' }, { id: 'examples/fixture.nxlv' }]) expect(derive({ path: 'selected' }, extra)).to.deep.equal([]);
    expect(() => derive({ path: 'selected' }, { width: 4097 })).to.throw(RangeError);
  });
  it('invalidates identity when the source config, source bytes or decoded art change', () => {
    const revision = derive()[0].sourceRevision;
    expect(derive({ path: 'selected', changed: true })[0].sourceRevision).not.to.equal(revision);
    expect(derive({ path: 'selected' }, { sha256: 'c'.repeat(64) })[0].sourceRevision).not.to.equal(revision);
    expect(derive({ path: 'selected' }, {}, { ...theme, assetSha256: 'd'.repeat(64) })[0].sourceRevision).not.to.equal(revision);
  });
  it('selects exact pack, ground set, art and optional revision with no foreign fallback', () => {
    const book = { descriptors: derive() }, descriptor = book.descriptors[0];
    expect(selectTerrainDescriptor(book, { packPath: 'C:\\game\\selected\\', groundSet: 0, assetSha256: hash, sourceRevision: descriptor.sourceRevision })).to.equal(descriptor);
    for (const extra of [{ packPath: 'missing' }, { groundSet: 1 }, { assetSha256: 'e'.repeat(64) }, { assetSha256: null }, { sourceRevision: 'f'.repeat(64) }]) {
      expect(selectTerrainDescriptor(book, { packPath: 'selected', groundSet: 0, assetSha256: hash, ...extra })).to.equal(null);
    }
    expect(getPackTerrainWidthLimit(book, 'selected')).to.equal(1600); expect(getPackTerrainWidthLimit(book, 'missing')).to.equal(0);
  });
  it('rejects ambiguous scope, foreign provenance and unbounded or impossible measurements', () => {
    const good = derive()[0], mutate = fn => { const value = structuredClone(good); fn(value); return value; };
    expect(() => validateTerrainDescriptors([good, good])).to.throw(/Duplicate/);
    for (const bad of [mutate(d => d.sourceLevelIds[0] = 'foreign/LEVEL000.DAT#0'), mutate(d => d.widths.maxSources[0].level = 'foreign/LEVEL000.DAT#0'),
      mutate(d => d.widths.max = 4097), mutate(d => d.widths.histogram[0].count = 2), mutate(d => d.groups[0].source.level = 'foreign/LEVEL000.DAT#0'),
      mutate(d => d.groups[0].placements[0].f = 32), mutate(d => d.assetPairs[0].a = d.assetPairs[0].b), mutate(d => d.assetOccurrence[0].count = 2)]) {
      expect(() => validateTerrainDescriptors([bad])).to.throw(TypeError);
    }
  });
  it('materializes only configured canonical level identities with bounded pack-local relationships', () => {
    const book = JSON.parse(fs.readFileSync('assets/procgen/terrain-recipes.json', 'utf8'));
    validateTerrainDescriptors(book.descriptors);
    expect(book.descriptors).to.have.length(16);
    expect(book.descriptors.reduce((sum, descriptor) => sum + descriptor.normalLevelCount, 0)).to.equal(280);
    const specials = new Set(book.inventory.specialBitmaps.map(level => level.id));
    for (const descriptor of book.descriptors) {
      expect(descriptor.widths.max).to.equal(1600); expect(descriptor.groups.length).to.be.at.most(12);
      for (const id of descriptor.sourceLevelIds) {
        const source = book.corpus.find(level => level.id === id);
        expect(source?.format).to.equal('classic-dat'); expect(source.aliases.length).to.be.greaterThan(0); expect(specials.has(id)).to.equal(false);
      }
    }
    expect(Buffer.byteLength(JSON.stringify(book.descriptors))).to.be.lessThan(150000);
  });
});
