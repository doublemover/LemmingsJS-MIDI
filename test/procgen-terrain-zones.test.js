import { expect } from 'chai';
import fs from 'node:fs';
import { ProcgenTerrainZonePlanner } from '../js/app/procgen/ProcgenTerrainZones.js';
import { getPackTerrainWidthLimit, selectTerrainDescriptor } from '../js/app/procgen/ProcgenTerrainDescriptors.js';

const book = JSON.parse(fs.readFileSync('assets/procgen/terrain-recipes.json', 'utf8'));
const descriptor = selectTerrainDescriptor(book, { packPath: 'lemmings', groundSet: 1, assetSha256: book.themes.find(theme => theme.id === 'lemmings-1').assetSha256 });
const ids = book.themes.find(theme => theme.id === 'lemmings-1').catalog.map(piece => piece.id);
const create = extra => new ProcgenTerrainZonePlanner({ descriptor, availableIds: ids, packWidthLimit: getPackTerrainWidthLimit(book, 'lemmings'), ...extra });

describe('bounded canonical co-occurrence zones', () => {
  it('uses exact selected-pack provenance and chunk-aligned widths capped by normal authored evidence', () => {
    const planner = create();
    for (const seed of [1, 42, 2026]) for (const index of [0, 1, 20, 10000]) {
      const zone = planner.zoneAt(seed, index * planner.widthFor(seed));
      expect(zone.width).to.be.at.most(1600); expect(zone.width % 128).to.equal(0);
      expect(zone.start).to.equal(index * zone.width); expect(zone.end).to.equal((index + 1) * zone.width);
      expect(zone.pack).to.equal('lemmings'); expect(zone.groundSet).to.equal(1); expect(zone.sourceRevision).to.equal(descriptor.sourceRevision);
      expect(zone.groups.length).to.be.at.most(4); expect(zone.anchorPair).to.equal(descriptor.assetPairs.find(pair => pair === zone.anchorPair));
      for (const group of zone.groups) { expect(descriptor.groups).to.include(group); expect(descriptor.sourceLevelIds).to.include(group.source.level); expect(group.placements.length).to.be.at.most(8); }
    }
  });
  it('recombines measured small roles and pairs deterministically across zones rather than copying a complete level', () => {
    const a = create(), b = create(), plans = [];
    for (let index = 0; index < 20; index++) {
      const plan = a.zoneAt(42, index * a.widthFor(42)); plans.push(plan);
      expect(plan).to.deep.equal(b.zoneAt(42, index * b.widthFor(42)));
      expect(plan.groups.reduce((sum, group) => sum + group.placements.length, 0)).to.be.at.most(32);
    }
    expect(new Set(plans.map(plan => plan.anchorPair.a + '/' + plan.anchorPair.b)).size).to.be.greaterThan(1);
  });
  it('excludes unavailable and word-owned glyphs before planning while preserving ordered flags and offsets', () => {
    const glyphs = new Set(Array.from({ length: 27 }, (_, index) => index + 31));
    const planner = create({ excludedIds: glyphs, availableIds: ids.filter(id => id !== 0) });
    for (let index = 0; index < 30; index++) {
      const zone = planner.zoneAt(3, index * planner.widthFor(3));
      if (zone.anchorPair) expect([zone.anchorPair.a, zone.anchorPair.b].every(id => !glyphs.has(id) && id !== 0)).to.equal(true);
      for (const group of zone.groups) {
        expect(group.placements.every(p => !glyphs.has(p.id) && p.id !== 0)).to.equal(true);
        expect(group.placements).to.equal(descriptor.groups.find(candidate => candidate === group).placements);
      }
    }
  });
  it('keeps a bounded revision-local cache and regenerates identical plans after eviction or reset', () => {
    const planner = create({ cacheLimit: 4 }), first = planner.zoneAt(42, 0);
    expect(planner.zoneAt(42, 1)).to.equal(first);
    for (let index = 1; index < 100; index++) planner.zoneAt(42, index * planner.widthFor(42));
    expect(planner.cache.size).to.equal(4); expect(planner.zoneAt(42, 0)).to.deep.equal(first);
    planner.reset(); expect(planner.cache.size).to.equal(0); expect(planner.zoneAt(42, 0)).to.deep.equal(first);
    expect(() => create({ packWidthLimit: 127 })).to.throw(TypeError);
  });
});
