import { expect } from 'chai';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { createActualScoredWorldFactory } from './helpers/actualScoredWorld.js';
import { qualifyActualCrowdIntervals } from './helpers/actualCrowdIntervals.js';

describe('actual crowd arrival interpretation', function() {
  this.timeout(120000);
  it('preserves real gaps and opposing streams while folding or delaying only explicitly selected responses', async () => {
    const masks = await loadProcgenMasks(), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'actual-crowd-fixture' }) });
    try {
      const result = await qualifyActualCrowdIntervals({ createWorld: await createActualScoredWorldFactory({ masks, jobs, maxActors: 128 }) });
      expect(result.reference.restored.equal).to.equal(true); expect(result.reference.restored.pendingAtCheckpoint).to.be.greaterThan(0);
    } finally { jobs.dispose(); }
  });
});
