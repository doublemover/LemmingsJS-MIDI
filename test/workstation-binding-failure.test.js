import { expect } from 'chai';
import { setup } from './helpers/workstation-fixture.js';

describe('committed workstation binding after presentation failure', () => {
  for (const historyRestore of [false, true]) for (const fault of ['camera', 'display', 'recording', 'render']) it('keeps canonical physical lane edits and retirement after ' + fault + ' fails, historyRestore=' + historyRestore, async () => {
    const f = setup({ physicalOnly: true }); f.studio.bindRuntime();
    f.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.75 } });
    const saved = f.studio.capture(), oldWorld = f.runtime.world;
    let calls = 0;
    if (fault === 'camera') f.failCamera();
    else f.view[fault === 'display' ? 'displayState' : fault] = () => { if (fault === 'recording' && f.runtime.world === oldWorld) return; calls++; if (calls === 1 || fault === 'recording') throw new Error('Controlled ' + fault + ' presentation failure'); };
    try {
      let failure; try { await f.studio.loadSession(saved, null, { historyRestore }); } catch (error) { failure = error; }
      expect(failure?.message).to.include(fault === 'camera' ? 'Camera unavailable' : 'Controlled ' + fault);
      expect(f.runtime.world).not.to.equal(oldWorld);
      expect(f.studio.transport.getState().playing).to.equal(false);
      expect(f.studio.handlers.historyState()).to.include({ undo: historyRestore ? 1 : 0, redo: 0 });
      f.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.25 } });
      expect(f.studio.getProject().procgen.lanes[0].gain).to.equal(0.25);
      expect(f.studio.laneMixView('lane-1').baseGain).to.equal(0.25);
      expect(f.studio.capture().project.procgen.lanes[0].gain).to.equal(0.25);
      expect(f.studio.getOperationState()).to.equal(null);
      const bus = f.runtime.world.soundEvents;
      await f.studio.dispose().completion;
      expect(bus.onEvent.handlers.size).to.equal(0);
      expect(bus.onBatch.handlers.size).to.equal(0);
    } finally { await f.studio.dispose().completion; }
  });
});
