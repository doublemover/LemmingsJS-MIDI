import { expect } from 'chai';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

describe('seeded readable terrain challenges', function() {
  this.timeout(15000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  for (const [seed, chunk, kind, skill] of [[3, 3, 'ledge', 'builds'], [1, 3, 'tunnel', 'bashes'], [1, 5, 'gap', 'builds'], [5, 3, 'terraces', null]]) {
    it(`crosses the generated ${kind} with ${skill || 'ordinary walking'} and keeps real skill accounting`, async () => {
      const terrain = await loadProcgenTerrain('lemmings', 0), world = new ProcgenLaneWorld({ terrain, masks, seed, assists: true, populationPolicy: { scoutsEvery: 0 } });
      try {
        const descriptor = terrain.describe(world.laneSeeds[0], chunk), challenge = descriptor.challenge, origin = chunk * 128;
        expect(challenge.kind).to.equal(kind);
        for (const x of [origin + 24, origin + 110]) world.terrainGrowth.ensureLocal(0, x, { through: world.generatedThrough, frontiers: world.frontiers, prepare: world._prepareGrowthChunk, reveal: world._revealGrowth });
        const actor = world.actors[0]; Object.assign(actor, { x: origin + 24, y: challenge.floor, canClimb: false, hasParachute: false, scout: false }); actor.setAction(world.actions[State.WALKING]);
        const events = []; world.soundEvents.onEvent.on(event => events.push(event));
        while (actor.x < origin + 104 && world.tickIndex < 500 && !actor.failureReason) world.step();
        expect(actor.x).to.be.at.least(origin + 104); expect(actor.failureReason).to.equal(null); expect(world.stats.failures).to.equal(0);
        expect(world.stats.builds).to.equal(skill === 'builds' ? 1 : 0); expect(world.stats.bashes).to.equal(skill === 'bashes' ? 1 : 0);
        expect(world.stats.digs + world.stats.mines).to.equal(0); expect(world.hazards.stats.contacts).to.equal(0);
        expect(world.hazardPlanner.admission.lanes[0].probes).to.be.at.most(1024);
        if (skill === 'bashes') expect(world.stats.removedPixels).to.be.greaterThan(0);
        else expect(world.stats.removedPixels).to.equal(0);
        if (skill === 'builds') expect(events.filter(event => event.type === 'builder-step')).to.have.length(12);
      } finally { world.dispose(); }
    });
  }
  it('keeps seed, query order, eviction, height translation and materialization collision/color in agreement', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 0);
    for (const height of [96, 144, 256]) {
      terrain.configure(1, 16, { laneHeight: height });
      const seed = 573154070, before = [3, 5, 7].map(chunk => terrain.getChunk(seed, chunk, true)); terrain.reset();
      for (const chunk of [7, 5, 3]) {
        const d = terrain.describe(seed, chunk), raster = terrain.getChunk(seed, chunk, true), prior = before[[3, 5, 7].indexOf(chunk)];
        expect(raster.pixels).to.deep.equal(prior.pixels); expect(raster.solid).to.deep.equal(prior.solid); expect(d.challenge).to.deep.equal(prior.challenge);
        expect(d.placements).to.have.length(0); expect(d.objects).to.have.length(0);
        const plan = terrain.growthPlan(seed, chunk), state = { plan, active: new Uint8Array(plan.jobs.length).fill(1), complete: false };
        for (let x = 0; x < 128; x++) {
          expect(terrain._surface(seed, chunk, x, d)).to.be.within(0, height - 1);
          for (let y = 0; y < height; y++) {
            const at = y * 128 + x;
            expect(terrain.solidSample(seed, chunk, x, y, d, state)).to.equal(!!(raster.solid[at >>> 5] & 1 << (at & 31)));
            expect(terrain.rasterSample(seed, chunk, x, y, d, state)).to.equal(raster.pixels[at]);
          }
        }
        expect(terrain._surface(seed, chunk, 0, d)).to.equal(d.left); expect(terrain._surface(seed, chunk, 127, d)).to.equal(d.right);
      }
    }
  });
});
