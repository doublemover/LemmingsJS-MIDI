import { expect } from 'chai';
import { setup } from './helpers/workstation-fixture.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
const turn = () => new Promise(resolve => setImmediate(resolve));
describe('world-change admission after causal take finalization (#1276)', function() {
  this.timeout(10000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  for (const kind of ['rebuild', 'load']) it('refuses a competing ' + kind + ' waiter without canceling the admitted world', async () => {
    const memory = createMemoryCausalStore(); let hold = false, releaseWrite, sawWrite;
    const gate = new Promise(resolve => { releaseWrite = resolve; }), entered = new Promise(resolve => { sawWrite = resolve; });
    const storage = { ...memory.storage, close() {}, async commitCausalTake(value) { if (hold) { sawWrite(); await gate; } return memory.storage.commitCausalTake(value); } };
    const f = setup({ storageOverride: storage, physicalOnly: true, worldFactory: () => new ProcgenLaneWorld({ masks, seed: 7, assists: false }) }), original = f.runtime.world;
    let releaseRestart, first, second;
    try {
      f.studio.bindRuntime(); f.studio.transport.pause(); const session = f.studio.capture(); expect(await f.studio.handlers.startCausalTake()).to.include({ state: 'recording' });
      releaseRestart = f.holdRestart(); hold = true; first = f.studio.handlers.new(); let settled = false, refused = null;
      second = (kind === 'load' ? f.studio.loadSession(session) : f.studio.handlers.replay()).then(value => { settled = true; return value; }, error => { settled = true; refused = error; return false; });
      await entered; expect(f.restarts).to.have.length(0); releaseWrite();
      for (let count = 0; count < 1000 && !f.restarts.length; count++) await turn(); await turn();
      expect(f.restarts).to.have.length(1); expect(settled).to.equal(true); expect(f.studio.getOperationState()).to.include({ generation: 1, aborted: false });
      if (kind === 'load') expect(refused.message).to.include('world change');
      releaseRestart(); expect(await first).to.equal(true); expect(await second).to.equal(false); expect(f.studio.getOperationState()).to.equal(null); expect(f.studio.transport.getState().playing).to.equal(false);
      expect(await f.studio.handlers.replay()).to.equal(true); expect(f.restarts).to.have.length(2); expect(f.studio.transport.getState().playing).to.equal(false);
    } finally { releaseWrite(); releaseRestart?.(); await Promise.allSettled([first, second].filter(Boolean)); await f.studio.dispose().completion; original.dispose(); f.runtime.world.dispose(); }
  });
});
