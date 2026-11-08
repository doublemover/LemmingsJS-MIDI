import { expect } from 'chai';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { createActualScoredWorldFactory } from './helpers/actualScoredWorld.js';
import { qualifyActualActivityWindows, qualifyActualCrewCadences } from './helpers/actualActivityWindows.js';
import { createProcgenCausalJournal } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';

describe('actual source-time rests and crew cadences', function() {
  this.timeout(120000);
  let jobs, createWorld;
  before(async () => { jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'actual-activity-fixture' }) }); createWorld = await createActualScoredWorldFactory({ masks: await loadProcgenMasks(), jobs, maxActors: 128 }); });
  after(() => jobs?.dispose());
  it('preserves real arrival gaps held drones silence reasons and immutable take boundaries', async () => {
    const store = createMemoryCausalStore(), journal = createProcgenCausalJournal({ storage: store.storage });
    const result = await qualifyActualActivityWindows({ createWorld, journal });
    expect(result.reference.nativeTake.changedWindowRefused).to.equal(true); expect(result.reference.restored.equal).to.equal(true); expect(result.empty.facts.some(fact => fact.kind === 'ActorBorn')).to.equal(false); expect(result.refusals).to.have.length(9);
  });
  it('joins actual crew completion prerequisites and refuses blocked and dead crew success', async () => {
    const result = await qualifyActualCrewCadences({ createWorld }); expect(result.results.map(row => row.completed)).to.deep.equal([1, 0, 0]); expect(result.results[0].restoredCompletion.count).to.equal(1);
  });
});
