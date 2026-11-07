import { expect } from 'chai';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { createActualScoredWorldFactory } from './helpers/actualScoredWorld.js';
import { qualifyActualRouteCircuits } from './helpers/actualRouteCircuits.js';
import { qualifyRouteStateRefusals } from './helpers/routeStateCorpus.js';

describe('actual route circuit and saved history acceptance', function() {
  this.timeout(120000);
  it('observes real 120/160 and 100/140 circuits, terrain drift, incomplete shortcuts and transactional history refusal', async () => {
    const masks = await loadProcgenMasks(), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'actual-route-fixture' }) });
    try {
      const result = await qualifyActualRouteCircuits({ createWorld: await createActualScoredWorldFactory({ masks, jobs }) });
      const refusal = await qualifyRouteStateRefusals({ graph: result.reference.initialSnapshot.graph, source: result.reference.initialSnapshot.domain.routes });
      expect(refusal.rejected).to.equal(41); expect(refusal.sourceUnchanged).to.equal(true);
    } finally { jobs.dispose(); }
  });
});
