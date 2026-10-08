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
  it('aligns deterministic words by visible alpha bounds and a common baseline above actual terrain', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 1), chunks = [3, 6, 9, 13];
    for (const chunk of chunks) {
      const descriptor = terrain.describe(42, chunk), word = descriptor.word;
      expect(word).to.exist; expect(PROCGEN_WORD_POOL).to.include(word.text);
      expect(terrain.describe(42, chunk).word).to.deep.equal(word);
      expect(word.x).to.be.at.least(8); expect(word.x + word.width).to.be.at.most(120);
      expect(word.y).to.be.at.least(2); expect(hasBlockedReadableRun(word.readable)).to.equal(false);
      for (const placement of descriptor.placements) if (placement.piece.id >= 31 && placement.piece.id <= 57) expect(placement.letter).to.be.a('string');
      for (const placement of word.placements) {
        const glyph = terrain.wordPlanner.glyphs.get(placement.letter);
        expect(placement.y + glyph.bottom).to.equal(word.baseline);
        for (let y = 0; y < placement.piece.height; y++) for (let x = 0; x < placement.piece.width; x++) if (!(placement.piece.frame[y * placement.piece.width + x] & 128)) {
          expect(terrain.solidSample(42, chunk, placement.x + x, placement.y + y, descriptor)).to.equal(false);
        }
      }
      const composed = terrain.getChunk(42, chunk, true);
      for (let y = 0; y < 96; y += 3) for (let x = 0; x < 128; x += 3) expect(terrain.rasterSample(42, chunk, x, y, descriptor)).to.equal(composed.pixels[y * 128 + x]);
    }
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
