import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createProcgenNotices } from '../js/app/procgen/workstation/ProcgenNotices.js';
import { createProcgenNoticeView } from '../js/app/procgen/workstation/ProcgenNoticeView.js';

const fault = (code, priority = 100) => ({ code, priority, severity: 'error', message: code + ' failed', scope: code, target: 'one:' + code, actionId: 'export', actionLabel: 'Prepare a backup file' });
const snapshot = (conditions = [], extra = {}) => ({ documentIdentity: 'one', documentRevision: 1, identity: 'one:1', conditions, recoveryAction: { id: 'export' }, ...extra });

describe('bounded priority notices from canonical conditions', () => {
  it('keeps storage and output faults above 10000 informational MIDI messages with bounded history', () => {
    let time = 0; const owner = createProcgenNotices({ now: () => time }); owner.synchronize(snapshot([fault('storage', 110), fault('output', 98)]));
    for (let index = 0; index < 10000; index++) { time++; owner.publish({ message: 'Recorded note ' + index, target: 'one' }); }
    const state = owner.snapshot(); expect(state.entries).to.have.length(32); expect(state.headline.code).to.equal('storage'); expect(state.entries.some(entry => entry.code === 'output' && entry.active)).to.equal(true);
    expect(state.dropped).to.equal(9970); expect(state.entries.every(entry => entry.message.length <= 240)).to.equal(true);
    owner.synchronize(snapshot([fault('output', 98)])); expect(owner.snapshot().headline.code).to.equal('output');
    owner.publish({ message: 'Saved successfully', target: 'one' }); expect(owner.snapshot().headline.code).to.equal('output');
  });
  it('does not count polling as repeated errors or resurface a dismissed unresolved condition', () => {
    const owner = createProcgenNotices(), input = snapshot([fault('storage')]); owner.synchronize(input); const before = owner.snapshot(), id = before.headline.id;
    for (let index = 0; index < 1000; index++) owner.synchronize(input);
    expect(owner.snapshot().revision).to.equal(before.revision); expect(owner.snapshot().headline.count).to.equal(1);
    owner.dismiss(id); owner.synchronize(input); expect(owner.snapshot().headline).to.equal(null); expect(owner.snapshot().entries[0]).to.include({ active: true, dismissed: true });
    owner.synchronize(snapshot()); owner.synchronize(snapshot([fault('storage')], { identity: 'one:2' }));
    expect(owner.snapshot().headline).to.include({ id, dismissed: false, identity: 'one:2' });
  });
  it('coalesces identical events, preserves their original action identity and expires old document conditions', () => {
    const owner = createProcgenNotices(); owner.synchronize(snapshot([fault('output')])); const id = owner.snapshot().headline.id;
    owner.synchronize(snapshot([fault('output')], { identity: 'one:2' })); expect(owner.snapshot().headline.identity).to.equal('one:1');
    owner.publish({ message: 'Budget reached', severity: 'warning' }); owner.publish({ message: 'Budget reached', severity: 'warning' });
    expect(owner.snapshot().entries.find(entry => entry.message === 'Budget reached').count).to.equal(2);
    owner.synchronize(snapshot([], { documentIdentity: 'two', identity: 'two:1' })); expect(owner.snapshot().headline).to.equal(null); expect(owner.snapshot().entries.find(entry => entry.id === id).active).to.equal(false);
  });
  it('refuses low priority eviction of a full critical history and retains only bounded immutable data', () => {
    const owner = createProcgenNotices({ maxEntries: 4 }); for (let index = 0; index < 4; index++) owner.publish({ ...fault('fault-' + index), identity: 'x'.repeat(10000), message: 'm'.repeat(10000), detail: 'd'.repeat(10000), unused: new Uint8Array(1000000) });
    expect(owner.publish({ message: 'benign' })).to.equal(null); const state = owner.snapshot(); expect(state.entries).to.have.length(4); expect(state.dropped).to.equal(1);
    expect(JSON.stringify(state).length).to.be.lessThan(12000); expect(Object.isFrozen(state.entries[0])).to.equal(true); expect(state.entries[0]).not.to.have.property('unused');
    owner.dispose(); owner.publish({ message: 'late' }); owner.synchronize(snapshot([fault('late')])); expect(owner.snapshot().entries).to.have.length(0);
  });
});

describe('owned notice history DOM and recovery actions', () => {
  let dom, document, view, current, actions;
  beforeEach(() => {
    dom = new JSDOM('<body></body>'); document = dom.window.document; current = snapshot([fault('storage')]); actions = [];
    view = createProcgenNoticeView({ document, message: document.createElement('output'), readSnapshot: () => current, performAction: (...args) => actions.push(args) }); document.body.append(view.element); view.refresh(current);
  });
  afterEach(() => { view.dispose(); dom.window.close(); });
  const open = () => { const details = view.element.querySelector('details'); details.open = true; details.dispatchEvent(new dom.window.Event('toggle')); };
  it('announces only the unchanged highest-priority headline while informational events coalesce', async () => {
    const message = view.element.querySelector('output'), updates = [], observer = new dom.window.MutationObserver(() => updates.push(message.textContent)); observer.observe(message, { childList: true, subtree: true, characterData: true });
    for (let index = 0; index < 100; index++) view.status('Recorded note 60'); await Promise.resolve(); observer.disconnect();
    expect(message.textContent).to.equal('storage failed'); expect(updates).to.have.length(0); open(); expect(view.element.textContent).to.include('repeated 100 times');
    expect(view.element.querySelector('ol').getAttribute('aria-live')).to.equal('off');
  });
  it('never retargets an earlier retry after a revision change and preserves the current fault', async () => {
    open(); const row = view.element.querySelector('li'), retry = row.querySelector('button'); current = snapshot([fault('storage')], { identity: 'one:2' }); view.refresh(current); retry.click(); await Promise.resolve();
    expect(actions).to.have.length(0); expect(row.textContent).to.include('earlier state'); expect(view.element.querySelector('output').textContent).to.equal('storage failed');
    current = snapshot([fault('storage')]); retry.click(); await Promise.resolve(); expect(actions).to.deep.equal([['export', 'one:1']]);
  });
  it('dismisses presentation without changing canonical fault state and preserves keyed focused rows', () => {
    open(); const row = view.element.querySelector('li'), dismiss = [...row.querySelectorAll('button')].find(button => button.textContent === 'Dismiss notice'); dismiss.focus(); dismiss.click(); view.refresh(current);
    expect(view.element.querySelector('output').textContent).to.equal('Ready'); expect(current.conditions).to.have.length(1); expect(view.snapshot().entries[0]).to.include({ active: true, dismissed: true }); expect(document.activeElement).to.equal(dismiss);
    dismiss.click(); expect(view.element.querySelector('output').textContent).to.equal('storage failed');
  });
  it('settles an asynchronous recovery after disposal without retaining DOM or publishing late errors', async () => {
    let reject; view.dispose(); view = createProcgenNoticeView({ document, message: document.createElement('output'), readSnapshot: () => current, performAction: () => new Promise((_resolve, failed) => { reject = failed; }) }); document.body.append(view.element); view.refresh(current); open();
    const retry = view.element.querySelector('li button'); retry.click(); view.dispose(); reject(new Error('Late recovery failure')); await Promise.resolve(); await Promise.resolve(); expect(view.snapshot().entries).to.have.length(0); expect(view.element.isConnected).to.equal(false);
  });
});
