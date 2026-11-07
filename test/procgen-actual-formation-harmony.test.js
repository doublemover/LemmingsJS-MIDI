import { expect } from 'chai';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { createActualScoredWorldFactory } from './helpers/actualScoredWorld.js';
import { qualifyActualFormationHarmony } from './helpers/actualFormationHarmony.js';

describe('actual crowd formation harmony', function() {
  this.timeout(120000);
  it('derives stable sustained and pickup voicing from real spread removal rosters and qualified routes', async () => {
    const masks = await loadProcgenMasks(), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'actual-formation-fixture' }) });
    try {
      const result = await qualifyActualFormationHarmony({ createWorld: await createActualScoredWorldFactory({ masks, jobs, maxActors: 128 }) });
      expect(result.span.final).to.be.greaterThan(result.span.initial); expect(result.reference.restored.equal).to.equal(true); expect(result.removed.minimumMotion).to.have.length(3);
    } finally { jobs.dispose(); }
  });
});
