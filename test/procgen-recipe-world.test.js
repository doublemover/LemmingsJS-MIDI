import { expect } from 'chai';
import fs from 'node:fs';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { MAX_COLUMN_PIECES } from '../js/app/procgen/ProcgenTerrainColumns.js';
import { PROCGEN_RECOVERY_GAP_END } from '../js/app/procgen/ProcgenTerrainProgression.js';
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
      expect(world.actors.map(actor => actor.spawnLaneIndex)).to.deep.equal(Array.from({ length: 32 }, (_, lane) => lane));
      expect(living.every(actor => actor.laneIndex === Math.floor(actor.y / 96))).to.equal(true);
      for (let lane = 0; lane < 32; lane++) {
        const signal = world.getLaneMusicSignals(lane), occupants = living.filter(actor => actor.laneIndex === lane);
        expect(signal.alive).to.equal(occupants.length);
        expect(signal.maxX).to.be.at.least(36); expect(world.actors[lane].spawnOrdinal).to.equal(0);
      }
      // A stationary real blocker and an actual hazard victim are valid outcomes;
      // this verifies observed route progress and exact accounting, not solvability.
      expect(result.distance.max).to.be.greaterThan(500); expect(result.builds + result.bashes).to.be.greaterThan(0);
      expect(result.recipeMemoryMB).to.be.lessThan(8); expect(result.terrainMemoryMB).to.be.lessThan(8); expect(result.residentCollisionMB).to.be.lessThan(64);
      expect(result.generatedHazards.cachedChunks).to.be.at.most(result.generatedHazards.maxChunks);
      // Only supported independent source geometry and complete assemblies are
      // eligible. Every catalogue sprite still receives the alpha/palette check.
      for (let chunk = 0; chunk < 128; chunk++) terrain.getChunk(42, chunk);
      expect(terrain.selectedTerrainIds.size).to.be.greaterThan(0);
      expect([...terrain.selectedTerrainIds].every(id => terrain.eligibleTerrainIds.has(id))).to.equal(true);
      expect([...terrain.selectedObjectIds].every(id => terrain.eligibleObjectIds.has(id))).to.equal(true);
      expect(result.terrainGeneration.terrainVocabularyAvailable).to.equal(terrain.eligibleTerrainIds.size);
      expect(result.terrainGeneration.terrainCatalogAvailable).to.equal(terrain.pieces.length);
      for (let chunk = 0; chunk < 128; chunk++) {
        const descriptor = terrain.describe(42, chunk);
        expect(descriptor.placements.every(p => p.assembly || p.canonicalGroup || p.letter || p.sourcedColumn)).to.equal(true);
        for (const column of new Set(descriptor.placements.filter(p => p.sourcedColumn).map(p => p.sourcedColumn))) {
          const members = descriptor.placements.filter(p => p.sourcedColumn === column), ingredient = terrain.columnLibrary.find(entry =>
            entry.piece.id === column.sourceId && entry.source.f === column.sourceFlags && entry.routeId === column.routeId);
          expect(descriptor.origin).to.be.at.least(PROCGEN_RECOVERY_GAP_END);
          expect(column.kind).to.equal('complete-source-column'); expect(column.sourceRevision).to.equal(terrain.recipe.assetSha256);
          expect(ingredient).to.exist; expect(column.provenance).to.deep.equal(ingredient.provenance);
          expect(members.length).to.be.within(2, MAX_COLUMN_PIECES);
          expect(members[0].y + ingredient.piece.height).to.equal(column.floor); expect(members.at(-1).y).to.equal(0);
          for (let index = 0; index < members.length; index++) {
            const member = members[index];
            expect(member.piece).to.equal(ingredient.piece); expect(member.f).to.equal(ingredient.source.f);
            expect(member.flip).to.equal(!!(ingredient.source.f & 8)); expect(member.flipY).to.equal(!!(ingredient.source.f & 2));
            expect(member.sourceRevision).to.equal(terrain.recipe.assetSha256); expect(member.decor).to.equal(false);
            expect(member.x).to.equal(column.x); expect(member.y).to.be.at.least(0); expect(member.y + member.piece.height).to.be.at.most(column.floor);
            expect(member.columnOrder).to.equal(index);
            if (index) { expect(member.y).to.be.lessThan(members[index - 1].y); expect(member.y + member.piece.height).to.be.greaterThan(members[index - 1].y); }
          }
        }
        expect(descriptor.objects.every(o => o.assembly || terrain._standaloneObjectEligible(o.piece))).to.equal(true);
      }
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
    expect([...world.actors.map(a => a.appearanceIndex)].sort((a, b) => a - b)).to.deep.equal(Array.from({ length: 32 }, (_, lane) => lane));
    expect(world.actors.every(actor => actor.appearanceIndex === actor.spawnLaneIndex)).to.equal(true);
    expect(new Set(events.map(event => event.laneIndex)).size).to.equal(32);
    for (const event of events) {
      const actor = world.actors.find(candidate => candidate.id === event.lemmingId);
      expect(actor.spawnLaneIndex).to.equal(event.laneIndex); expect(actor.spawnTick).to.equal(event.tick);
      expect(event.spawnTick).to.equal(event.tick); expect(event.spawnPhaseTicks).to.equal(actor.spawnPhaseTicks);
    }
    const order = events.map(event => [event.laneIndex, event.tick, event.spawnPhaseTicks]); world.dispose();
    const replay = new ProcgenLaneWorld({ masks, terrain, laneCount: 32, cohorts: true, spawnSpreadTicks: 12 }), repeated = [];
    try {
      replay.soundEvents.onEvent.on(event => { if (event.type === 'lemming-spawn') repeated.push([event.laneIndex, event.tick, event.spawnPhaseTicks]); });
      for (let tick = 0; tick < 12; tick++) replay.step();
      expect(repeated).to.deep.equal(order); expect(replay.spawnedTotal).to.equal(32);
    } finally { replay.dispose(); }
  });
});
