import { expect } from 'chai';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { createActualScoredWorldFactory } from './helpers/actualScoredWorld.js';
import { qualifyActualFlightArcs } from './helpers/actualFlightArcs.js';

describe('actual flight arc acceptance corpus', function() {
  this.timeout(120000);
  it('preserves real ledge durations, parachute opening, safe/fatal/void outcomes, source filters and checkpoint continuity', async () => {
    const masks = await loadProcgenMasks(), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'actual-flight-fixture' }) });
    try { const result = await qualifyActualFlightArcs({ createWorld: await createActualScoredWorldFactory({ masks, jobs }) }); expect(result.cases).to.have.length(7); }
    finally { jobs.dispose(); }
  });
});
