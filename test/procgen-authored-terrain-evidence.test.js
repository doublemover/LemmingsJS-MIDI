import { expect } from 'chai';
import { loadProcgenTerrain, loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenPackTerrain } from '../js/app/procgen/ProcgenPackTerrain.js';
import { captureGeneratedTerrainEvidence } from '../js/app/procgen/ProcgenTerrainCacheEvidence.js';
import { hashSurveyValue } from '../js/app/procgen/survey/ProcgenSurveyCanonical.js';
import { createSurveyTrial } from '../js/app/procgen/survey/ProcgenSurveyCore.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';

const layout = { schema: 'lemmings-scene-terrain/v1', id: 'score.evidence-source', revision: 1, width: 256, laneHeight: 96,
  lanes: [{ laneId: 0, regions: [{ kind: 'solid', x1: 0, x2: 256, y1: 88, y2: 96, color: 0xff526f74 }, { kind: 'steel', x1: 80, x2: 88, y1: 80, y2: 88, color: 0xffaaaaaa }] }] };
const reject = (action, code) => { let failure; try { action(); } catch (error) { failure = error; } expect(failure?.code).to.equal(code); return failure; };
const make = async () => {
  const source = await loadProcgenTerrain(), base = new ProcgenPackTerrain([{ familyId: 'brick', styleName: 'brick', terrain: source }]); base.setLaneAssignments(['brick']);
  const budget = createResourceBudget(), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'controlled-test-worker' }) });
  const terrain = new ProcgenScoredTerrain(base, layout, { resourceBudget: budget, jobs });
  return { terrain, base, source, budget, jobs, hash: () => hashSurveyValue(captureGeneratedTerrainEvidence(terrain)),
    async close() { const receipt = terrain.dispose(); await receipt.completion; jobs.dispose(); expect(receipt.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0); } };
};

describe('authored terrain source and binding evidence', function() {
  this.timeout(30000);
  it('binds verified compiled source, exact seed lanes and fallback terrain while omitting read/query warmth', async () => {
    const f = await make();
    try {
      reject(f.hash, 'unverified-generated-terrain-cache'); await f.terrain.prepare(); f.hash();
      f.terrain.configure(1, 8, { laneHeight: 96, workstation: true }); f.terrain.registerLanes(Uint32Array.of(42), 42, 1); const before = f.hash();
      for (const chunk of [0, 1, 4, 40]) { f.terrain.getChunk(42, chunk, true); f.terrain.surface(42, chunk * 128); }
      expect(f.hash()).to.equal(before); expect(Object.isFrozen(f.terrain.records)).to.equal(true);
      expect(captureGeneratedTerrainEvidence(f.terrain)).to.include({ kind: 'authored-scene-v1', layoutHash: f.terrain.sceneTerrainLayoutHash, storageHash: f.terrain.views.storageHash });
    } finally { await f.close(); }
  });
  it('refuses changed compiled masks, pixels and profiles, replaced views, missing bindings and unbound remaps, then recovers', async () => {
    const f = await make();
    try {
      await f.terrain.prepare(); f.terrain.configure(1, 8, { laneHeight: 96, workstation: true }); f.terrain.registerLanes(Uint32Array.of(42), 42, 1); const before = f.hash(), chunk = f.terrain.getChunk(42, 0);
      for (const field of ['solid', 'steel', 'pixels', 'topProfile']) {
        chunk[field][0] ^= 1; expect(reject(f.hash, 'changed-generated-terrain-cache').cacheKind).to.equal('authored-source');
        chunk[field][0] ^= 1; expect(f.hash()).to.equal(before);
      }
      const views = f.terrain.views; f.terrain.views = Object.freeze({ ...views }); reject(f.hash, 'unverified-generated-terrain-cache'); f.terrain.views = views;
      const records = f.terrain.records; f.terrain.records = []; reject(f.hash, 'unverified-generated-terrain-cache'); f.terrain.records = Object.freeze([...records]); reject(f.hash, 'unverified-generated-terrain-cache'); f.terrain.records = records;
      f.terrain.seedToLane = new Map([[43, 0]]); reject(f.hash, 'changed-generated-terrain-cache'); f.terrain.seedToLane = new Map([[42, 0]]); expect(f.hash()).to.equal(before);
      const source = f.base.themes[0].terrain; f.base.themes[0].terrain = { ...source }; reject(f.hash, 'unsupported-terrain-evidence-source'); f.base.themes[0].terrain = source; expect(f.hash()).to.equal(before);
    } finally { await f.close(); }
  });
  it('includes authored source in actual survey identity and refuses unknown providers before executing physical work', async () => {
    const f = await make(), masks = await loadProcgenMasks(); let trial;
    try {
      await f.terrain.prepare(); trial = createSurveyTrial({ masks, terrain: f.terrain, scenario: { id: 'authored-source-evidence', mode: 'generated', physicalLaneCount: 1, laneHeight: 96, horizonTicks: 32 } });
      const before = trial.snapshot().physicalStateHash; trial.world.terrain.getChunk(trial.world.laneSeeds[0], 4, true); expect(trial.snapshot().physicalStateHash).to.equal(before);
      f.terrain.restoreAssignments(f.terrain.exportAssignments()); expect(trial.snapshot().physicalStateHash).to.equal(before);
      trial.world.hasGroundAt(36, 88); expect(trial.snapshot().physicalStateHash).to.equal(before);
      const held = trial.world._laneChunk[0]; trial.world._laneChunk[0] = Object.freeze({ ...held });
      reject(() => trial.snapshot(), 'unverified-world-cache-binding'); trial.world._laneChunk[0] = held;
      f.terrain.views.chunks[0].solid[0] ^= 1; reject(() => trial.snapshot(), 'changed-generated-terrain-cache'); f.terrain.views.chunks[0].solid[0] ^= 1; expect(trial.snapshot().physicalStateHash).to.equal(before);
      const original = trial.world.terrain; trial.world.terrain = { collision: new Map(), descriptions: new Map(), growthPlans: new Map() };
      reject(() => trial.snapshot(), 'unsupported-terrain-evidence-source'); trial.world.terrain = original;
    } finally { trial?.dispose(); await f.close(); }
  });
});
