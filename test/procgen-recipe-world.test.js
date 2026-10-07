import { expect } from 'chai';
import fs from 'node:fs';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks, loadProcgenTerrain, runLaneBenchmark } from '../scripts/bench-procgen-lanes.js';
const book = JSON.parse(fs.readFileSync('assets/procgen/terrain-recipes.json', 'utf8'));
describe('source-art shared world routes', function () {
  this.timeout(30000);
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  for (const theme of book.themes) it(`runs 32 independent evolving ${theme.family} routes with real skills for 5000 ticks`, async () => {
    const source = theme.sources[0], terrain = await loadProcgenTerrain(source.pack, source.groundSet);
    const result = runLaneBenchmark({ masks, terrain, lanes: 32, ticks: 5000, seed: 42 });
    expect(result.alive).to.equal(32);
    expect(result.distance.min).to.be.greaterThan(500); expect(result.recipeMemoryMB).to.be.lessThan(8);
    expect(result.builds).to.be.greaterThan(0);
    expect(result.terrainGeneration.terrainVocabularyUsed).to.equal(result.terrainGeneration.terrainVocabularyAvailable);
    expect(result.terrainGeneration.objectVocabularyUsed).to.equal(result.terrainGeneration.objectVocabularyAvailable);
  });
  it('retains all 96 sourced foundation ingredients in the new evolving generator', async () => {
    let checked = 0;
    for (const theme of book.themes) {
      const source = theme.sources[0], terrain = await loadProcgenTerrain(source.pack, source.groundSet);
      const patterns = terrain.patterns;
      for (const pattern of patterns) {
        terrain.patterns = [pattern];
        terrain.reset();
        const chunk = terrain.getChunk(42, 0, true);
        expect(chunk.solid.some(value => value !== 0), pattern.routeId).to.equal(true);
        for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
          const index = y * 128 + x;
          if (chunk.solid[index >>> 5] & (1 << (index & 31))) expect(chunk.pixels[index], pattern.routeId).not.to.equal(0);
        }
        checked++;
      }
    }
    expect(checked).to.equal(96);
  });
  it('keeps source pixels and collision identical, including shared edits', async () => {
    const terrain = await loadProcgenTerrain(), world = new ProcgenLaneWorld({ masks, terrain, laneCount: 3, seed: 42 });
    for (let y = 0; y < world.height; y++) for (let x = 0; x < 256; x++) expect(!!world.groundPixelAt(x, y)).to.equal(world.hasGroundAt(x, y));
    world.setGroundAt(100, 20); expect(world.groundPixelAt(100, 20)).to.equal(0xff86cbea);
  });
  it('uses deterministic integer-tick spawn waves and reports actual admissions', async () => {
    const terrain = await loadProcgenTerrain(), world = new ProcgenLaneWorld({ masks, terrain, laneCount: 32, cohorts: true, spawnSpreadTicks: 12 });
    const events = []; world.soundEvents.onEvent.on(event => { if (event.type === 'lemming-spawn') events.push(event); });
    for (let tick = 0; tick < 12; tick++) world.step();
    expect(world.spawnedTotal).to.equal(32); expect(new Set(events.map(e => e.tick)).size).to.equal(12);
    expect(events.every(e => Number.isInteger(e.tick))).to.equal(true);
    expect(world.actors.map(a => a.appearanceIndex)).to.deep.equal(Array.from({ length: 32 }, (_, i) => i));
  });
});
