import { expect } from 'chai';
import { TestDocument } from './helpers/test-dom.js';
import { createProcgenShareView } from '../js/app/procgen/ProcgenShareView.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const fixture = ({ clipboard, prepareExport } = {}) => {
  const document = new TestDocument(), create = document.createElement.bind(document);
  document.createElement = tag => { const element = create(tag); if (tag === 'dialog') { element.showModal = () => { element.open = true; }; element.close = () => { element.open = false; element.dispatchEvent({ type: 'close' }); }; } return element; };
  const opener = create('button'); document.body.append(opener); opener.focus();
  let identity = 'recipe:one', unavailable = false, prepared = 0;
  const view = createProcgenShareView({ document, window: { navigator: { clipboard } },
    getDescriptor: ({ includeCamera }) => { if (unavailable) throw new Error('Authored scene requires its performance artifact.'); return { url: `https://example.test/procgen.html?recipe=${identity}${includeCamera ? '&zoom=2' : ''}`,
      recipeIdentity: identity, worldOptions: { laneCount: 3 }, omitted: ['edits', 'takes', 'devices'] }; },
    getExportDescriptor: () => ({ kind: 'project', sourceToken: 'document:1', available: true, title: 'Current project checkpoint', scope: 'Captures the current world.', omitted: 'Recorded takes are excluded.' }),
    prepareExport, onPrepared: () => { prepared++; } });
  const dialog = () => document.body.children.find(element => element.tagName === 'DIALOG');
  const element = label => document._all.find(item => dialog().contains(item) && (item.textContent === label || item.id === label));
  return { document, view, opener, dialog, element, change() { identity = 'recipe:two'; }, unsupported() { unavailable = true; }, get prepared() { return prepared; } };
};
const click = element => element.dispatchEvent({ type: 'click' });

describe('owned ProcGen sharing sheet', () => {
  it('reviews scope before copying, includes camera only on request and reports actual acknowledgement', async () => {
    const copied = [], gate = deferred(), f = fixture({ clipboard: { writeText: url => { copied.push(url); return gate.promise; } } });
    expect(f.view.open()).to.equal(true); expect(copied).to.have.length(0);
    expect(f.element('procgenShareUrl').readOnly).to.equal(true); expect(f.element('procgenShareCamera').checked).to.equal(false);
    f.element('procgenShareCamera').checked = true; f.element('procgenShareCamera').dispatchEvent({ type: 'change' });
    expect(f.element('procgenShareUrl').value).to.include('&zoom=2');
    click(f.element('Copy link')); expect(copied).to.deep.equal([f.element('procgenShareUrl').value]);
    expect(f.element('Copy link').disabled).to.equal(true); expect(f.element('procgenShareStatus').textContent).to.include('Copying');
    gate.resolve(); await flush(); expect(f.element('procgenShareStatus').textContent).to.include('link copied');
    click(f.element('Close')); expect(f.dialog()).to.equal(undefined); expect(f.document.activeElement).to.equal(f.opener); f.view.dispose();
  });
  for (const mode of ['missing', 'rejected']) it(`keeps a selectable URL and manual instructions when clipboard is ${mode}`, async () => {
    const f = fixture({ clipboard: mode === 'rejected' ? { writeText: async () => { throw new Error('denied'); } } : undefined });
    f.view.open(); const url = f.element('procgenShareUrl'); let selections = 0; url.select = () => { selections++; };
    click(f.element('Copy link')); await flush();
    expect(f.document.activeElement).to.equal(url); expect(selections).to.equal(1); expect(url.hidden).to.equal(false);
    expect(f.element('procgenShareStatus').textContent).to.include('Ctrl+C').and.not.include('link copied'); f.view.dispose();
  });
  it('requires another review if a pending replacement commits a different recipe', async () => {
    const copied = [], f = fixture({ clipboard: { writeText: async url => { copied.push(url); } } }); f.view.open();
    f.change(); click(f.element('Copy link')); await flush(); expect(copied).to.have.length(0);
    expect(f.element('procgenShareStatus').textContent).to.include('committed world changed');
    click(f.element('Copy link')); await flush(); expect(copied).to.have.length(1); expect(copied[0]).to.include('recipe:two'); f.view.dispose();
  });
  it('does not publish a late clipboard completion into a reopened sheet', async () => {
    const gate = deferred(), f = fixture({ clipboard: { writeText: () => gate.promise } }); f.view.open(); click(f.element('Copy link'));
    const oldStatus = f.element('procgenShareStatus'); click(f.element('Close')); f.view.open(); const newStatus = f.element('procgenShareStatus');
    gate.resolve(); await flush(); expect(oldStatus.textContent).to.include('Copying'); expect(newStatus.textContent).to.equal(''); f.view.dispose();
  });
  it('refuses an unsupported scene recipe while keeping the performance handoff available', () => {
    const f = fixture(); f.unsupported(); f.view.open(); expect(f.element('Copy link').disabled).to.equal(true);
    expect(f.element('procgenShareUrl').hidden).to.equal(true); expect(f.element('Prepare performance file').disabled).to.equal(false); f.view.dispose();
  });
  it('prepares the reviewed source, then closes before revealing delivery controls', async () => {
    let reviewed, signal; const gate = deferred(), f = fixture({ prepareExport: (source, options) => { reviewed = source; signal = options.signal; return gate.promise; } });
    f.view.open(); click(f.element('Prepare performance file')); expect(reviewed).to.include({ kind: 'project', sourceToken: 'document:1' });
    expect(signal.aborted).to.equal(false); expect(f.prepared).to.equal(0); gate.resolve({ retained: true }); await flush();
    expect(f.dialog()).to.equal(undefined); expect(f.prepared).to.equal(1); expect(signal.aborted).to.equal(true); f.view.dispose();
  });
  it('aborts preparation on Escape without late focus, publication or replacement-sheet updates', async () => {
    let signal; const gate = deferred(), f = fixture({ prepareExport: (_source, options) => { signal = options.signal; return gate.promise; } });
    f.view.open(); click(f.element('Prepare performance file')); f.dialog().dispatchEvent({ type: 'cancel', preventDefault() {} });
    expect(signal.aborted).to.equal(true); f.view.open(); gate.resolve({ retained: true }); await flush();
    expect(f.prepared).to.equal(0); expect(f.element('procgenShareStatus').textContent).to.equal(''); f.view.dispose();
  });
  it('keeps the sheet usable after a changed-source preparation rejection', async () => {
    const f = fixture({ prepareExport: async () => { throw new Error('Reviewed source changed'); } }); f.view.open(); click(f.element('Prepare performance file')); await flush();
    expect(f.element('procgenShareStatus').textContent).to.include('Reviewed source changed'); expect(f.element('Prepare performance file').disabled).to.equal(false); f.view.dispose();
  });
  it('reuses its single dialog and disposes an outstanding clipboard owner', async () => {
    const gate = deferred(), f = fixture({ clipboard: { writeText: () => gate.promise } }); f.view.open(); const dialog = f.dialog();
    f.view.open(); expect(f.dialog()).to.equal(dialog); click(f.element('Copy link')); f.view.dispose(); gate.resolve(); await flush();
    expect(f.dialog()).to.equal(undefined); expect(f.view.open()).to.equal(false);
  });
});
