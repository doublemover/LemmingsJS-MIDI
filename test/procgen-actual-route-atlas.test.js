import { expect } from 'chai';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { createActualScoredWorldFactory } from './helpers/actualScoredWorld.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { createProcgenCausalJournal } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { qualifyActualRouteAtlasJourneys } from './helpers/actualRouteAtlasJourneys.js';

describe('actual marker-bound route atlas journeys', function() {
  this.timeout(120000);
  it('separates U arms and crossing branches and reopens real route history without endpoint guessing', async () => {
    const masks = await loadProcgenMasks(), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'actual-route-atlas-fixture' }) }), { storage } = createMemoryCausalStore();
    try {
      const result = await qualifyActualRouteAtlasJourneys({ createWorld: await createActualScoredWorldFactory({ masks, jobs, maxActors: 128 }), journal: createProcgenCausalJournal({ storage }), reopenJournal: async () => createProcgenCausalJournal({ storage }) });
      expect(result.u.result.routeGapPixels).to.be.greaterThan(96); expect(result.nativeTake.equal).to.equal(true); expect(result.markers.edits).to.have.length(8);
    } finally { jobs.dispose(); }
  });
});
