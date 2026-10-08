import { expect } from 'chai';
import fs from 'node:fs';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { stampRecipePlacements } from '../js/app/procgen/ProcgenTerrainRecipes.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
const book = JSON.parse(fs.readFileSync('assets/procgen/terrain-recipes.json', 'utf8'));
describe('source-art shared world routes', function () {
  this.timeout(30000);
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  for (const theme of book.themes) it(`runs 32 independent evolving ${theme.family} routes with real skills for 5000 ticks`, async () => {
    const source = theme.sources[0], terrain = await loadProcgenTerrain(source.pack, source.groundSet);
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 32, seed: 42 });
    try {
      for (let tick = 0; tick < 5000; tick++) world.step();
      const result = world.getDebugState(), failures = {}, living = world.actors.filter(actor => !actor.failureReason && !actor.removed);
      for (const actor of world.actors) if (actor.failureReason) failures[actor.failureReason] = (failures[actor.failureReason] || 0) + 1;
      expect(result.spawnedTotal).to.equal(32); expect(world.actors).to.have.length(32);
      expect(result.alive).to.equal(living.length); expect(result.activeCount).to.equal(living.length);
      expect(result.failures).to.equal(world.actors.length - living.length);
      expect(result.alive + result.failures).to.equal(result.spawnedTotal);
      expect(result.failureReasons).to.deep.equal(failures); expect(result.survival).to.equal(living.length / 32);
      expect(world.actors.map(actor => actor.laneIndex)).to.deep.equal(Array.from({ length: 32 }, (_, lane) => lane));
      for (let lane = 0; lane < 32; lane++) {
        const actor = world.actors[lane], signal = world.getLaneMusicSignals(lane);
        expect(signal.alive).to.equal(actor.failureReason || actor.removed ? 0 : 1);
        expect(signal.maxX).to.equal(actor.furthestX); expect(actor.spawnOrdinal).to.equal(0);
      }
      // A stationary real blocker and an actual hazard victim are valid outcomes;
      // this verifies observed route progress and exact accounting, not solvability.
      expect(result.distance.max).to.be.greaterThan(500); expect(result.builds).to.be.greaterThan(0); expect(result.bashes).to.be.greaterThan(0);
      expect(result.recipeMemoryMB).to.be.lessThan(8); expect(result.terrainMemoryMB).to.be.lessThan(8); expect(result.residentCollisionMB).to.be.lessThan(64);
      expect(result.generatedHazards.cachedChunks).to.be.at.most(result.generatedHazards.maxChunks);
      // Real attrition can end exploration early. Check complete eligible source
      // coverage independently, with a fixed bounded generator probe.
      const eligible = new Set(terrain.ingredients.map(piece => piece.id));
      for (const word of terrain.wordPlanner?.choices || []) for (const glyph of word.letters) eligible.add(glyph.piece.id);
      for (let chunk = 0; chunk < 128; chunk++) terrain.getChunk(42, chunk);
      expect([...terrain.selectedTerrainIds].sort((a, b) => a - b)).to.deep.equal([...eligible].sort((a, b) => a - b));
      expect([...terrain.selectedObjectIds].sort((a, b) => a - b)).to.deep.equal(terrain.objects.map(piece => piece.id).sort((a, b) => a - b));
      expect(result.terrainGeneration.terrainVocabularyAvailable).to.equal(terrain.pieces.length);
      // Word mode deliberately excludes unused glyphs from generic decor. The
      // complete source catalogue still stamps with its exact alpha and palette.
      for (const piece of terrain.pieces) {
        const stamped = stampRecipePlacements({ placements: [{ id: piece.id, x: 0, y: 0, f: 0 }], terrainPieces: terrain.pieces, width: piece.width, height: piece.height });
        let opaque = 0;
        for (let index = 0; index < piece.frame.length; index++) {
          const solid = !(piece.frame[index] & 128); opaque += solid;
          expect(stamped.mask[index], `${theme.id}/${piece.id}/${index}`).to.equal(solid ? 1 : 0);
          if (solid) expect(stamped.pixels[index]).to.equal(piece.image.palette.getColor(piece.frame[index]) >>> 0);
        }
        expect(opaque, `${theme.id}/${piece.id}`).to.be.greaterThan(0);
      }
    } finally { world.dispose(); }
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
