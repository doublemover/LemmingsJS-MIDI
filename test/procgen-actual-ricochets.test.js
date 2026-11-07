import { expect } from 'chai';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { createActualScoredWorldFactory } from './helpers/actualScoredWorld.js';
import { qualifyActualRicochets } from './helpers/actualRicochets.js';

describe('actual blocker ricochet acceptance corpus', function() {
  this.timeout(120000);
  it('preserves paired contacts, blocker-local transforms, release/re-entry, restore and 100-actor admission', async () => {
    const masks = await loadProcgenMasks(), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'actual-ricochet-fixture' }) });
    try { const result = await qualifyActualRicochets({ createWorld: await createActualScoredWorldFactory({ masks, jobs, maxActors: 128 }) }); expect(result.dense.contacts).to.equal(100); }
    finally { jobs.dispose(); }
  });
});
