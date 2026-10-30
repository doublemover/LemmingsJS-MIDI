import { expect } from 'chai';
import { loadProcgenTerrain, loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createSurveyTrial } from '../js/app/procgen/survey/ProcgenSurveyCore.js';
import { hashSurveyValue, SURVEY_STATE_SCHEMA } from '../js/app/procgen/survey/ProcgenSurveyCanonical.js';
import { ProcgenPackTerrain } from '../js/app/procgen/ProcgenPackTerrain.js';
import { captureGeneratedTerrainEvidence } from '../js/app/procgen/ProcgenTerrainCacheEvidence.js';
import { surveyProjectionContinuations } from './helpers/surveyProjectionContinuations.js';

describe('generated terrain cache evidence ownership', function() {
  this.timeout(30000); let terrain, masks;
  before(async () => { terrain = await loadProcgenTerrain(); masks = await loadProcgenMasks(); });
  beforeEach(() => { terrain.reset(); terrain.configure(2, 128, { laneHeight: 144, workstation: true }); });
  const identity = () => hashSurveyValue(captureGeneratedTerrainEvidence(terrain));
  const rejection = (code, action = () => identity()) => { let failure; try { action(); } catch (error) { failure = error; } expect(failure?.code).to.equal(code); return failure; };
  const warm = () => { for (const chunk of [40, 4, 0, 17, 23, 41]) { terrain.getChunk(42, chunk, true); terrain.growthPlan(42, chunk); } };
  it('omits pristine descriptor, collision, growth and zone residency while preserving source configuration', () => {
    const cold = identity(); warm(); const before = [...terrain.descriptions], collisions = [...terrain.collision], zones = [...terrain.zonePlanner.cache];
    expect(identity()).to.equal(cold); expect([...terrain.descriptions]).to.deep.equal(before); expect([...terrain.collision]).to.deep.equal(collisions); expect([...terrain.zonePlanner.cache]).to.deep.equal(zones);
    terrain.reset(); expect(identity()).to.equal(cold); terrain.configure(2, 128, { laneHeight: 192, workstation: true }); expect(identity()).not.to.equal(cold);
  });
  it('refuses actual collision masks and surface mutation even when the mutated cache is nested in a pack', () => {
    const pack = new ProcgenPackTerrain([{ styleName: 'rock', familyId: 'rock', terrain }]); pack.registerLanes(Uint32Array.of(42), 7);
    const cold = hashSurveyValue(captureGeneratedTerrainEvidence(pack)), chunk = pack.getChunk(42, 4);
    expect(hashSurveyValue(captureGeneratedTerrainEvidence(pack))).to.equal(cold);
    for (const field of ['solid', 'steel', 'topProfile']) {
      chunk[field][0] ^= 1; const failure = rejection('changed-generated-terrain-cache', () => captureGeneratedTerrainEvidence(pack)); expect(failure.cacheKind).to.equal('collision');
      chunk[field][0] ^= 1; expect(hashSurveyValue(captureGeneratedTerrainEvidence(pack))).to.equal(cold);
    }
  });
  it('checks descriptor and growth-plan content rather than trusting the stored object identity', () => {
    warm(); const descriptor = terrain.describe(42, 4), plan = terrain.growthPlan(42, 4), before = identity();
    descriptor.left++; rejection('changed-generated-terrain-cache'); descriptor.left--; expect(identity()).to.equal(before);
    plan.foundationByColumn[0] ^= 1; expect(rejection('changed-generated-terrain-cache').cacheKind).to.equal('growth-plan');
    plan.foundationByColumn[0] ^= 1; expect(identity()).to.equal(before);
  });
  it('refuses injected, cross-key, cross-owner, stale-configuration and last-pointer cache authority', async () => {
    const chunk = terrain.getChunk(42, 4), key = '42:4';
    terrain.collision.set(key, { ...chunk }); rejection('unverified-generated-terrain-cache'); terrain.collision.set(key, chunk);
    terrain.collision.set('42:9', chunk); rejection('unverified-generated-terrain-cache'); terrain.collision.delete('42:9');
    const other = await loadProcgenTerrain(); other.configure(2, 128, { laneHeight: 144, workstation: true }); other.collision.set(key, chunk);
    rejection('unverified-generated-terrain-cache', () => captureGeneratedTerrainEvidence(other)); other.reset();
    terrain.hazardSpacing++; rejection('changed-generated-terrain-cache'); terrain.hazardSpacing--;
    terrain._lastChunk = { ...chunk }; expect(rejection('unverified-generated-terrain-cache').cacheKind).to.equal('last-collision'); terrain._lastChunk = chunk;
    expect(identity()).to.be.a('string');
  });
  it('validates zone ownership independently of descriptor references', () => {
    const planner = terrain.zonePlanner, zone = planner.zoneAt(42, 5000), key = [...planner.cache.keys()][0];
    const before = identity(); planner.cache.set(key, { ...zone }); expect(rejection('unverified-generated-terrain-cache').cacheKind).to.equal('zone');
    planner.cache.set(key, zone); expect(identity()).to.equal(before);
  });
  it('never invokes overridden cache access, typed view metadata or descriptor accessors', () => {
    const chunk = terrain.getChunk(42, 4), descriptor = terrain.describe(42, 4), before = identity(); let touched = 0;
    const getter = () => { touched++; throw new Error('Unexpected evidence side effect'); };
    for (const field of ['constructor', 'length', 'byteOffset', 'byteLength', 'buffer', Symbol.iterator]) Object.defineProperty(chunk.solid, field, { configurable: true, get: getter });
    for (const cache of [terrain.collision, terrain.descriptions, terrain.growthPlans]) for (const field of ['get', 'entries', Symbol.iterator]) Object.defineProperty(cache, field, { configurable: true, get: getter });
    try {
      expect(identity()).to.equal(before); const previous = descriptor.left;
      Object.defineProperty(descriptor, 'left', { configurable: true, get: getter }); rejection('accessor-terrain-evidence');
      Object.defineProperty(descriptor, 'left', { configurable: true, enumerable: true, writable: true, value: previous }); expect(touched).to.equal(0);
    } finally {
      for (const cache of [terrain.collision, terrain.descriptions, terrain.growthPlans]) for (const field of ['get', 'entries', Symbol.iterator]) delete cache[field];
    }
  });
  it('normalizes actual generated survey projection across passive cache warmth and rejects its mutated source', () => {
    const trial = createSurveyTrial({ masks, terrain, scenario: { id: 'generated-cache-evidence', mode: 'generated', pack: 'lemmings_ohNo', groundSet: 0, laneHeight: 144, horizonTicks: 96 } });
    try {
      const before = trial.snapshot().physicalStateHash, seed = trial.world.laneSeeds[0];
      for (const chunk of [40, 4, 17]) { terrain.getChunk(seed, chunk, true); terrain.growthPlan(seed, chunk); }
      expect(trial.snapshot().physicalStateHash).to.equal(before); const chunk = terrain.getChunk(seed, 4); chunk.solid[0] ^= 1;
      rejection('changed-generated-terrain-cache', () => trial.snapshot()); chunk.solid[0] ^= 1; expect(trial.snapshot().physicalStateHash).to.equal(before);
      expect(SURVEY_STATE_SCHEMA).to.equal(7);
    } finally { trial.dispose(); }
  });
  it('distinguishes actual speed, command and contact futures while refusing nested accessors without evaluating them', async () => {
    const results = await surveyProjectionContinuations(scenario => createSurveyTrial({ masks, scenario }));
    expect(results.map(result => result.kind)).to.deep.equal(['speed', 'intervention', 'contact', 'intrinsic-and-accessor']);
  });
});
