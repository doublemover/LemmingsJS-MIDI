import { expect } from 'chai';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { createActualScoredWorldFactory } from './helpers/actualScoredWorld.js';
import { qualifyActualTerrainTopology, qualifyIncrementalTerrainTopology } from './helpers/actualTerrainTopology.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { createProcgenCausalJournal } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';

describe('actual chamber topology source and saved history', function() {
  this.timeout(120000);
  it('qualifies collision cavities, real worker revisions, held handover and refused stale interpretations', async () => {
    const masks = await loadProcgenMasks(), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'actual-topology-fixture' }) }), store = createMemoryCausalStore();
    try { const result = await qualifyActualTerrainTopology({ createWorld: await createActualScoredWorldFactory({ masks, jobs, maxActors: 128 }), journal: createProcgenCausalJournal({ storage: store.storage }) }); expect(result.chambers.refusals).to.have.length(7); expect(result.workerRuns.find(row => row.kind === 'dig').work).to.have.length(6); expect(result.generation.staleRefused).to.equal(true); }
    finally { jobs.dispose(); }
  });
  it('matches full reference analysis across regional edits, authoring, halo changes and restored bounded stress', async () => {
    const masks = await loadProcgenMasks(), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'incremental-topology-fixture' }) });
    try { const result = await qualifyIncrementalTerrainTopology({ createWorld: await createActualScoredWorldFactory({ masks, jobs, maxActors: 128 }) }); expect(result.fullReferenceComparisons).to.be.greaterThan(140); expect(result.analyzedCells).to.be.lessThan(result.fullReferenceCells / 2); expect(result.restoredCompleteCheckpointEqual).to.equal(true); }
    finally { jobs.dispose(); }
  });
});
