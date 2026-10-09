import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { TriggerTypes as Types } from '../js/level/TriggerTypes.js';
import { PROCGEN_INTRO_SAFE_END, PROCGEN_HAZARD_RAMP_END, PROCGEN_RECOVERY_GAP_END, progressionAt } from '../js/app/procgen/ProcgenTerrainProgression.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

const lethal = new Set([Types.TRAP, Types.DROWN, Types.KILL, Types.FRYING]);
describe('source hazard introduction and bounded observations', function() {
  this.timeout(30000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('protects the full drop, landing and initial travel in real fire, pillar and snow source terrain', async () => {
    for (const [pack, ground] of [['lemmings', 1], ['lemmings', 3], ['lemmings_ohNo', 2]]) {
      const terrain = await loadProcgenTerrain(pack, ground), world = new ProcgenLaneWorld({ masks, terrain, laneCount: 8, seed: 42, assists: false });
      for (const seed of world.laneSeeds) for (const chunk of [0, 1]) {
        const descriptor = terrain.describe(seed, chunk), raster = terrain.getChunk(seed, chunk, true);
        expect(descriptor.gapWidth).to.equal(0); expect(descriptor.objects.some(object => lethal.has(object.piece.image.trigger_effect_id))).to.equal(false);
        for (let x = 8; x < 128; x++) expect(terrain.solidSample(seed, chunk, x, 72, descriptor)).to.equal(true);
        for (let y = 0; y < 96; y += 3) for (let x = 0; x < 128; x += 3) {
          const at = y * 128 + x; expect(terrain.solidSample(seed, chunk, x, y, descriptor)).to.equal(!!(raster.solid[at >>> 5] & (1 << (at & 31))));
          expect(terrain.rasterSample(seed, chunk, x, y, descriptor)).to.equal(raster.pixels[at]);
        }
      }
      for (let tick = 0; tick < 120; tick++) world.step();
      expect(world.activeCount).to.equal(8); expect(world.hazards.stats.contacts).to.equal(0);
      expect(world.actors.every(actor => !actor.failureReason && actor.x > 100 && actor.x < PROCGEN_INTRO_SAFE_END)).to.equal(true); world.dispose();
    }
  });
  it('ramps actual gaps/elevation/hazard eligibility with world distance while retaining later real hazards and deterministic caches', async () => {
    const intro = progressionAt(0), early = progressionAt(512), late = progressionAt(PROCGEN_HAZARD_RAMP_END);
    expect(intro.safeIntro).to.equal(true); expect(early.elevationRange).to.be.lessThan(late.elevationRange);
    expect(early.gapMaximum).to.be.lessThan(late.gapMaximum); expect(early.hazardThreshold).to.be.lessThan(late.hazardThreshold);
    const terrain = await loadProcgenTerrain('lemmings', 1); let hazards = 0;
    for (const chunk of [2, 3, 4, 8, 9, 10, 16, 20, 28]) {
      const descriptor = terrain.describe(42, chunk);
      expect(descriptor.gapWidth).to.be.at.most(descriptor.progression.gapMaximum);
      for (const object of descriptor.objects) if (lethal.has(object.piece.image.trigger_effect_id)) {
        hazards++; const image = object.piece.image;
        expect(Math.min(object.x, object.x + image.trigger_left)).to.be.at.least(PROCGEN_INTRO_SAFE_END);
        expect(object.x + image.trigger_left + image.trigger_width).to.be.at.most((chunk + 1) * 128 - 8);
        expect(object.y + image.trigger_top).to.be.at.least(0); expect(object.y + image.trigger_top + image.trigger_height).to.be.at.most(96);
      }
    }
    expect(hazards).to.be.greaterThan(0);
    const first = terrain.getChunk(42, 20, true); terrain.reset(); expect(terrain.getChunk(42, 20, true).pixels).to.deep.equal(first.pixels);
  });
  it('keeps the first sourced Brick gap open above a real materialized recovery floor, and ordinary crews traverse it', async () => {
    const terrain = await loadProcgenTerrain('lemmings_ohNo', 0), world = new ProcgenLaneWorld({ masks, terrain, seed: 42, assists: false });
    const seed = world.laneSeeds[0], descriptor = terrain.describe(seed, 2), x = descriptor.gapX - descriptor.origin;
    expect(descriptor).to.include({ gapWidth: 3, gapFloor: 75 });
    const plan = terrain.growthPlan(seed, 2), state = { plan, active: new Uint8Array(plan.jobs.length), complete: false, revision: 0 };
    expect(terrain.solidSample(seed, 2, x, descriptor.gapFloor, descriptor, state)).to.equal(false);
    expect(terrain.rasterSample(seed, 2, x, descriptor.gapFloor, descriptor, state)).to.equal(0);
    for (let index = 0; index <= plan.foundationByColumn[x]; index++) state.active[index] = 1;
    expect(terrain.solidSample(seed, 2, x, descriptor.gapFloor - 1, descriptor, state)).to.equal(false);
    expect(terrain.solidSample(seed, 2, x, descriptor.gapFloor, descriptor, state)).to.equal(true);
    expect(terrain.rasterSample(seed, 2, x, descriptor.gapFloor, descriptor, state)).to.be.greaterThan(0);
    state.active.fill(1); const full = terrain.getChunk(seed, 2, true);
    for (let y = 0; y < 96; y++) for (let atX = 0; atX < 128; atX++) {
      const at = y * 128 + atX;
      expect(terrain.solidSample(seed, 2, atX, y, descriptor, state)).to.equal(!!(full.solid[at >>> 5] & (1 << (at & 31))));
      expect(terrain.rasterSample(seed, 2, atX, y, descriptor, state)).to.equal(full.pixels[at]);
      expect(terrain.steelSample(seed, 2, atX, y, descriptor, state)).to.equal(!!(full.steel[at >>> 5] & (1 << (at & 31))));
    }
    const leader = world.actors[0];
    Object.assign(leader, { x: descriptor.gapX - 3, y: descriptor.right, lookRight: true }); leader.setAction(world.actions[State.WALKING]); world.step();
    expect(world.hazardPlanner.plan(leader)).to.include({ kind: 'builders', reason: 'supported-local-gap' });
    for (let ordinal = 0; ordinal < 8; ordinal++) {
      const actor = ordinal ? world._spawn(0, false) : world.actors[0];
      Object.assign(actor, { x: descriptor.gapX - 15 - ordinal % 4, y: 72, lookRight: true }); actor.setAction(world.actions[State.WALKING]);
    }
    for (let tick = 0; tick < 48; tick++) world.step();
    expect(world.spawnedTotal).to.equal(8); expect(world.activeCount).to.equal(8); expect(world.stats.failures).to.equal(0);
    expect(world.actors.every(actor => actor.x > descriptor.gapX + descriptor.gapWidth + 16 && !actor.failureReason && !actor.canClimb && !actor.hasParachute)).to.equal(true);
    expect(world.stats.builds + world.stats.bashes + world.stats.digs + world.stats.mines).to.equal(0); world.dispose();
    expect(progressionAt(PROCGEN_RECOVERY_GAP_END - 128).gapDepth).to.equal(6);
    expect(progressionAt(PROCGEN_RECOVERY_GAP_END).gapDepth).to.equal(null);
    const later = terrain.describe(seed, 16);
    expect(later.gapWidth).to.equal(7); expect(later.origin).to.be.at.least(PROCGEN_RECOVERY_GAP_END); expect(later.gapFloor).to.equal(null);
    expect(terrain.solidSample(seed, later.origin / 128, later.gapX - later.origin, 95, later)).to.equal(false);
  });
  it('exposes only bounded actual revealed/supported hazard owners and cooldown without contact or animation changes', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 0); terrain.supportsFineGrowth = false;
    const world = new ProcgenLaneWorld({ masks, terrain, assists: false, seed: 42 });
    terrain.objects = [terrain.objects.find(piece => piece.id === 6)]; terrain.compiledAssemblies = []; terrain.compiledAssemblies = []; terrain.reset();
    let placed;
    for (let chunk = 2; chunk < 48 && !placed; chunk++) { const descriptor = terrain.describe(world.laneSeeds[0], chunk); if (descriptor.objects.length) placed = { chunk, object: descriptor.objects[0] }; }
    const { chunk, object } = placed, image = object.piece.image, out = [];
    world.generatedThrough[0] = object.x + image.width - 1;
    expect(world.hazards.nearby(0, object.x, { ahead: 10000, behind: 10000 }, out)).to.equal(out); expect(out).to.have.length(0);
    world.generatedThrough[0] = (chunk + 1) * 128;
    const observed = world.hazards.nearby(0, object.x, {}, out); expect(observed).to.have.length(1);
    expect(observed[0]).to.include({ x1: object.x + image.trigger_left, x2: object.x + image.trigger_left + image.trigger_width, enabled: true, cooling: false });
    const entry = world.hazards.peek(0, chunk, 0); entry.trigger.disabledUntilTick = 17;
    expect(world.hazards.nearby(0, object.x, {}, out)[0]).to.include({ cooling: true, disabledUntilTick: 17 });
    expect(world.hazards.stats.contacts).to.equal(0); expect(entry.activated).to.equal(false);
    world.clearGroundAt(object.x, object.supportY); expect(world.hazards.nearby(0, object.x, {}, out)).to.have.length(0);
    expect(world.hazards.chunks.size).to.be.at.most(3); expect(world.hazards.nearby(-1, object.x, {}, out)).to.have.length(0);
    world._restart([]); expect(world.hazards.chunks.size).to.equal(0); world.dispose();
  });
});
