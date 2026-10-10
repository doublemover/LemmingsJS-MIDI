import { expect } from 'chai';
import { loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { PROCGEN_WORD_POOL, createProcgenWordPlanner, hasBlockedReadableRun } from '../js/app/procgen/ProcgenWords.js';

const letters = (text, start = 0, baseline = 30) => [...text].map((letter, index) => ({ letter, x: start + index * 15, right: start + index * 15 + 10, baseline }));

describe('sourced procgen words', function() {
  this.timeout(30000);
  it('uses the verified normal fire alphabet only and reserves every glyph from generic decoration', async () => {
    const fire = await loadProcgenTerrain('lemmings', 1), pillar = await loadProcgenTerrain('lemmings', 3);
    expect(fire.wordPlanner.glyphs.size).to.equal(26); expect(pillar.wordPlanner).to.equal(null);
    expect(fire.wordPlanner.glyphs.get('M').piece.width).to.equal(64); expect(fire.wordPlanner.glyphs.get('W').piece.width).to.equal(64);
    expect(fire.wordPlanner.glyphs.get('Q').piece.width).to.equal(64);
    expect(fire.ingredients.some(piece => piece.id >= 31 && piece.id <= 57)).to.equal(false);
    expect(createProcgenWordPlanner({ ...fire.recipe, assetSha256: 'changed' }, fire.pieces)).to.equal(null);
    const partial = createProcgenWordPlanner(fire.recipe, fire.pieces.filter(piece => piece.id !== 36));
    expect(partial.choices.some(word => word.text.includes('F'))).to.equal(false);
    expect(PROCGEN_WORD_POOL).to.include.members(['FUCK', 'SHIT', 'FUN']);
  });
  it('stamps deterministic complete physical words only on actual supported components', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 1); terrain.configure(1, 16, { laneHeight: 144 });
    const admitted = [];
    for (let chunk = 0; chunk < 32; chunk++) {
      const descriptor = terrain.describe(42, chunk), word = descriptor.word;
      if (!word) continue;
      admitted.push(word.text); expect(PROCGEN_WORD_POOL).to.include(word.text);
      expect(terrain.describe(42, chunk).word).to.deep.equal(word); expect(word.physical).to.equal(true);
      expect(word.x).to.be.at.least(8); expect(word.x + word.width).to.be.at.most(120);
      expect(word.y).to.be.at.least(2); expect(hasBlockedReadableRun(word.readable)).to.equal(false);
      const base = { ...descriptor, placements: descriptor.placements.filter(p => !p.letter), objects: [] };
      for (const placement of word.placements) {
        const glyph = terrain.wordPlanner.glyphs.get(placement.letter);
        expect(placement.decor).to.equal(false); expect(placement.y + glyph.bottom).to.equal(word.baseline);
        for (const [x, y] of glyph.cells) expect(terrain.solidSample(42, chunk, placement.x + x, placement.y + y, descriptor)).to.equal(true);
        for (const feet of glyph.components) expect(feet.some(([x, y]) => terrain.solidSample(42, chunk, placement.x + x, placement.y + y, base))).to.equal(true);
      }
      const composed = terrain.getChunk(42, chunk, true), plan = terrain.growthPlan(42, chunk), active = new Uint8Array(plan.jobs.length);
      const job = plan.placementJobs[descriptor.placements.indexOf(word.placements[0])];
      expect(word.placements.every(p => plan.placementJobs[descriptor.placements.indexOf(p)] === job)).to.equal(true);
      for (const dependency of plan.jobs[job].dependencies) active[dependency] = 1;
      const p = word.placements[0], glyph = terrain.wordPlanner.glyphs.get(p.letter), [x, y] = glyph.cells[0];
      expect(terrain.solidSample(42, chunk, p.x + x, p.y + y, descriptor, { plan, active, complete: false })).to.equal(false);
      active[job] = 1;
      expect(terrain.solidSample(42, chunk, p.x + x, p.y + y, descriptor, { plan, active, complete: false })).to.equal(true);
      for (let y = 0; y < 144; y += 3) for (let x = 0; x < 128; x += 3) expect(terrain.rasterSample(42, chunk, x, y, descriptor)).to.equal(composed.pixels[y * 128 + x]);
    }
    expect(admitted.length).to.be.greaterThan(0);
    expect(terrain.wordPlanner.choices.map(choice => choice.text)).to.include.members(['BOP', 'WET', 'SHH', 'HOT', 'I GO']);
    expect(terrain.wordPlanner.plan(42, 9, 128, () => 120, () => false)).to.equal(null);
    expect(terrain.wordPlanner.plan(42, 9, 128, () => 120, () => true)).to.equal(null);
  });
  it('offers combinable musical, hydro, sneaky and non-graphic suggestive vocabulary using only available glyphs', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 1);
    expect(PROCGEN_WORD_POOL).to.include.members(['MIDI', 'BOP', 'WET', 'HUSH', 'TEASE', 'GO HI']);
    expect(terrain.wordPlanner.choices.every(choice => choice.letters.every(glyph => terrain.wordPlanner.glyphs.has(String.fromCharCode(glyph.piece.id - 31 + 65))))).to.equal(true);
    const combination = terrain.wordPlanner.choices.find(choice => choice.text.includes(' ')); expect(combination).to.exist;
  });
  it('rejects an actual adjacent readable slur run while retaining profanity and innocent longer runs', () => {
    expect(hasBlockedReadableRun(letters('FAG'))).to.equal(true);
    expect(hasBlockedReadableRun(letters('FUCK'))).to.equal(false);
    expect(hasBlockedReadableRun(letters('FAGUS'))).to.equal(false);
    expect(hasBlockedReadableRun([...letters('FA'), ...letters('G', 60)])).to.equal(false);
    expect(hasBlockedReadableRun([...letters('FA'), ...letters('G', 30, 70)])).to.equal(false);
    expect(hasBlockedReadableRun([...letters('FAG'), ...letters('FUN', 1, 80)])).to.equal(true);
  });
});
