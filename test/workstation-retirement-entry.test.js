import { expect } from 'chai';
import { setup } from './helpers/workstation-fixture.js';

const wrapLeaves = fixture => {
  const calls = [], ports = fixture.studio.ports.dispose, view = fixture.view.dispose;
  fixture.studio.ports.dispose = () => { calls.push('ports'); return ports(); };
  fixture.view.dispose = () => { calls.push('view'); return view.call(fixture.view); };
  fixture.storage.close = () => { calls.push('storage'); };
  return calls;
};

describe('workstation retirement entry ownership', () => {
  it('publishes one receipt before a reentrant input destructor throws and still attempts independent leaves', async () => {
    const fixture = setup(); fixture.studio.bindRuntime(); fixture.studio.transport.pause();
    expect(fixture.studio.handlers.learn()).to.equal(true); expect(fixture.studio.getInputEditLease()).not.to.equal(null);
    const calls = wrapLeaves(fixture); let nested;
    fixture.studio.ports.cancelLearn = () => { nested = fixture.studio.dispose(); throw new Error('Input cancellation refused'); };
    const receipt = fixture.studio.dispose(); await receipt.completion;
    expect(nested).to.equal(receipt); expect(fixture.studio.dispose()).to.equal(receipt); expect(fixture.studio.getInputEditLease()).to.equal(null);
    expect(calls).to.deep.equal(['ports', 'view', 'storage']); expect(fixture.physicalOwner).to.equal(null);
    expect(receipt.outcome).to.equal('partial'); expect(receipt.resources.find(value => value.name === 'input-edits')).to.include({ status: 'failed', error: 'Input cancellation refused' });
  });
  for (const target of ['persist-timer', 'recovery-timer']) it('contains ' + target + ' cancellation failure and does not re-enter canonical ownership', async () => {
    const timers = new Map(); let serial = 0;
    const fixture = setup({ windowTimers: { setTimeout(callback, delay) { const id = ++serial; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { const timer = timers.get(id); if (timer && (target === 'persist-timer' ? timer.delay === 250 : timer.delay === 2000)) throw new Error('Timer cancellation refused'); timers.delete(id); } } });
    fixture.studio.bindRuntime(); fixture.studio.transport.pause();
    fixture.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.625 } });
    const project = fixture.studio.getProject(), calls = wrapLeaves(fixture), receipt = fixture.studio.dispose(); await receipt.completion;
    expect(calls).to.deep.equal(['ports', 'view', 'storage']); expect(fixture.view.disposed).to.equal(true); expect(fixture.physicalOwner).to.equal(null);
    expect(receipt.resources.find(value => value.name === target)).to.include({ status: 'failed', error: 'Timer cancellation refused' });
    for (const timer of timers.values()) timer.callback();
    expect(fixture.studio.getProject()).to.equal(project); expect(fixture.studio.transport.getState().playing).to.equal(false); expect(fixture.studio.dispose()).to.equal(receipt);
  });
  it('keeps final synchronous preferences after invalidation while suppressing later ordinary writes', async () => {
    const fixture = setup(); fixture.studio.bindRuntime(); fixture.studio.transport.pause(); const writes = [];
    fixture.window.localStorage.setItem = (key, value) => writes.push({ key, value: JSON.parse(value) });
    fixture.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.375 } });
    const before = writes.length, receipt = fixture.studio.dispose(); await receipt.completion;
    expect(writes.length).to.equal(before + 1); expect(writes.at(-1).value.project.procgen.lanes[0].gain).to.equal(0.375);
    expect(writes.at(-1).value.ui).to.include({ recording: false, thru: false });
    fixture.document.emit('visibilitychange'); fixture.window.emit('pagehide');
    expect(writes.length).to.equal(before + 1); expect(receipt.resources.find(value => value.name === 'final-preferences').status).to.equal('completed');
  });
});
