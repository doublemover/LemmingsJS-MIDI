import { expect } from 'chai';
import { loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { MAX_MATERIALIZATION_JOBS } from '../js/app/procgen/ProcgenTerrainMaterialization.js';

const activate = (state, index) => { for (const dependency of state.plan.jobs[index].dependencies) activate(state, dependency); state.active[index] = 1; state.revision++; };

describe('source pieces and sections share materialized geometry', function() {
  this.timeout(30000);
  it('uses whole source motif spans, bounded cached plans and exact active foundation/alpha/steel samples', async () => {
    const terrain = await loadProcgenTerrain('lemmings_ohNo', 3), plan = terrain.growthPlan(42, 57), descriptor = plan.descriptor;
    expect(terrain.growthPlan(42, 57)).to.equal(plan); expect(Object.isFrozen(plan.jobs)).to.equal(true);
    expect(plan.jobs.length).to.be.at.most(MAX_MATERIALIZATION_JOBS);
    expect(plan.foundationSections.map(section => section.x2 - section.x1)).to.deep.equal([32, 32, 32, 32]);
    expect(plan.jobs[0]).to.include({ sourceSpan: 32, sourcePeriod: 32, sourceMotif: 'lemmings_ohNo-3/repeat-61-0-32' });
    expect(plan.jobs.every((job, index) => job.dependencies.every(dependency => dependency < index))).to.equal(true);
    const state = { plan, active: new Uint8Array(plan.jobs.length), complete: false, revision: 0 };
    for (let x = 0; x < 128; x++) {
      expect(terrain.solidSample(42, 57, x, 90, descriptor, state)).to.equal(false);
      expect(terrain.rasterSample(42, 57, x, 90, descriptor, { active: new Uint8Array(0), complete: false })).to.equal(0);
    }
    activate(state, 0);
    for (let x = 0; x < 128; x++) expect(terrain.solidSample(42, 57, x, 90, descriptor, state)).to.equal(x < 32);
    for (const job of plan.jobs) activate(state, job.index);
    const full = terrain.getChunk(42, 57, true);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
      const at = y * 128 + x;
      expect(terrain.solidSample(42, 57, x, y, descriptor, state)).to.equal(!!(full.solid[at >>> 5] & (1 << (at & 31))));
      expect(terrain.rasterSample(42, 57, x, y, descriptor, state)).to.equal(full.pixels[at]);
      expect(terrain.steelSample(42, 57, x, y, descriptor, state)).to.equal(!!(full.steel[at >>> 5] & (1 << (at & 31))));
    }
    const keys = plan.jobs.map(job => job.id); terrain.reset(); expect(terrain.growthPlans.size).to.equal(0);
    expect(terrain.growthPlan(42, 57).jobs.map(job => job.id)).to.deep.equal(keys);
  });
  it('roots attachment order in the admitted authored support: actual body before trap head', async () => {
    const terrain = await loadProcgenTerrain('lemmings_ohNo', 3), plan = terrain.growthPlan(42, 57), descriptor = plan.descriptor;
    const head = descriptor.objects.findIndex(o => o.piece.id === 8), body = descriptor.objects.findIndex(o => o.piece.id === 10);
    expect(head).to.be.at.least(0); expect(body).to.be.at.least(0);
    const headJob = plan.objectJobs[head], bodyJob = plan.objectJobs[body];
    expect(bodyJob).to.be.lessThan(headJob); expect(plan.jobs[headJob].dependencies).to.include(bodyJob);
    expect(plan.jobs[bodyJob].attachmentDepth).to.equal(0); expect(plan.jobs[headJob].attachmentDepth).to.equal(1);
    expect(plan.jobs[bodyJob].dependencies.some(index => plan.jobs[index].kind === 'terrain')).to.equal(true);
  });
  it('keeps complete words atomic and gates actual liquid cavities with their object job', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 1); terrain.configure(1, 16, { laneHeight: 144 });
    let wordPlan;
    for (let chunk = 0; chunk < 32 && !wordPlan; chunk++) { const plan = terrain.growthPlan(42, chunk); if (plan.descriptor.word) wordPlan = plan; }
    expect(wordPlan.descriptor.word.physical).to.equal(true);
    const wordIndices = wordPlan.descriptor.placements.flatMap((p, index) => p.letter ? [wordPlan.placementJobs[index]] : []);
    expect(new Set(wordIndices).size).to.equal(1);
    const liquid = await loadProcgenTerrain('lemmings', 3); let plan, chunk;
    for (let at = 2; at < 48 && !plan; at++) { const candidate = liquid.growthPlan(42, at); if (candidate.descriptor.objects.some(o => o.role === 'liquid')) { plan = candidate; chunk = at; } }
    expect(plan).to.exist; const descriptor = plan.descriptor, index = descriptor.objects.findIndex(o => o.role === 'liquid');
    const object = descriptor.objects[index], x = object.x - descriptor.origin + 1, y = object.y + 1;
    const state = { plan, active: new Uint8Array(plan.jobs.length), complete: false, revision: 0 };
    for (const section of plan.foundationSections) activate(state, section.index);
    expect(liquid.solidSample(42, chunk, x, y, descriptor, state)).to.equal(true);
    activate(state, plan.objectJobs[index]); expect(liquid.solidSample(42, chunk, x, y, descriptor, state)).to.equal(false);
    expect(liquid.rasterSample(42, chunk, x, y, descriptor, state)).to.equal(0);
  });
});
