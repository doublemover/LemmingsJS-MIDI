import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createProcgenCausalJournal } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { authoredCausalTape } from './helpers/authoredCausalTape.js';

describe('explicitly authored durable causal tape', function() {
  this.timeout(30000);
  it('replays every required physical fact and control through checkpoint reuse and an immutable branch', async () => {
    const masks = await loadProcgenMasks(), storage = createMemoryCausalStore(), journal = createProcgenCausalJournal({ storage: storage.storage });
    const result = await authoredCausalTape({ journal, createWorld: () => new ProcgenLaneWorld({ masks, laneCount: 2, seed: 42, assists: false }), ticks: 128 });
    expect(result.full.comparedBatches).to.equal(128); expect(result.sourceUnchanged).to.equal(true); expect(result.repeated.ticksExecuted).to.equal(0);
    expect(result.counts.ActorBorn).to.be.greaterThan(0); expect(result.counts.ActorLaneTransferred).to.be.greaterThan(0); expect(result.counts.TerrainWorkCommitted).to.be.greaterThan(0);
    expect(result.controls.map(value => value.input.kind)).to.include.members(['tempo', 'world-speed', 'external-observation', 'mapping', 'instrument-performance', 'intervention-cancel', 'transport-state']);
  });
});
