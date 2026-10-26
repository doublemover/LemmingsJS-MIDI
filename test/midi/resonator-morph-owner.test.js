import { expect } from 'chai';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createResonatorMorphOwner } from '../../js/app/midi-ui/ResonatorMorphOwner.js';
import { createResonatorMorphView } from '../../js/app/midi-ui/ResonatorMorphView.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createTestBackgroundJobs } from '../helpers/background-worker.js';

const fixture = async () => JSON.parse(await fs.readFile(new URL('../../content/morphs/dry-bright-proof.json', import.meta.url), 'utf8'));
const identity = () => ({ activeExecution: 'bound', buildId: 'explicit-morph-test-build' });
const setup = (decorate = value => value) => { const budget = createResourceBudget({ limitBytes: 128 * 1048576 }), realJobs = createTestBackgroundJobs({ identity }), owner = createResonatorMorphOwner({ resourceBudget: budget, jobs: decorate(realJobs) }); return { budget, owner, jobs: realJobs, async close() { const receipt = owner.dispose(); await receipt.completion; realJobs.dispose(); return receipt; } }; };
const reviewed = input => ({ pairs: input.anchors, siteCorrespondence: input.siteCorrespondence, reviewed: true });
const settle = async ready => { for (let turn = 0; turn < 100; turn++) { if (ready()) return; await new Promise(resolve => setTimeout(resolve, 0)); } throw new Error('Fixture did not settle.'); };
describe('resonator correspondence review/ownership workflow (runtime/browser qualification deferred)', function() {
  this.timeout(60000);
  it('prepares exact worker candidates, explicit reviewed maps and independently owned export bytes', async () => {
    const f = setup(), proof = await fixture();
    try { f.owner.setEndpoints(proof.input.a, proof.input.b); await f.owner.analyze({ anchors: proof.input.anchors, siteCorrespondence: proof.input.siteCorrespondence }); expect(f.owner.state().phase).to.equal('candidate-needs-review'); expect(f.owner.state().map).to.equal(null); await f.owner.resolve(reviewed(proof.input)); expect(f.owner.preview(0.5).modes).to.have.length(6); expect(f.owner.state().continuousRendererQualified).to.equal(false); const artifact = f.owner.prepareExport(), loan = artifact.borrow(); try { expect(JSON.parse(await loan.blob.text()).hash).to.equal(f.owner.state().map.hash); } finally { loan.release(); artifact.discard(); await artifact.digest(); } }
    finally { expect((await f.close()).outcome).to.equal('complete'); expect(f.budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('retires map metadata while an independent export copy retains its own known reader lease', async () => {
    const f = setup(), { input } = await fixture(); f.owner.setEndpoints(input.a, input.b); await f.owner.resolve(reviewed(input)); const artifact = f.owner.prepareExport(), loan = artifact.borrow(); expect((await f.close()).outcome).to.equal('complete'); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0); expect(JSON.parse(await loan.blob.text()).schema).to.equal('lemmings-resonator-morph-map/v1'); loan.release(); await artifact.digest(); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retains the last reviewed map after a failed pair draft and invalidates it only on explicit edits', async () => {
    const f = setup(), { input } = await fixture();
    try { f.owner.setEndpoints(input.a, input.b); await f.owner.resolve(reviewed(input)); const oldHash = f.owner.state().map.hash; let error; try { await f.owner.resolve({ ...reviewed(input), pairs: [input.anchors[0], input.anchors[0]] }); } catch (value) { error = value; } expect(error).to.exist; expect(f.owner.state().map.hash).to.equal(oldHash); expect(f.owner.preview(0).modes[0].frequencyHz).to.equal(220); f.owner.invalidateMap(); expect(f.owner.state().map).to.equal(null); expect(() => f.owner.preview(0.5)).to.throw(); }
    finally { await f.close(); expect(f.budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('does not publish a completed old worker result after an endpoint replacement', async () => {
    let release, computed; const gate = new Promise(resolve => { release = resolve; }), f = setup(real => ({ ...real, async compute(options) { const result = await real.compute(options); computed = true; await gate; return result; } })), { input } = await fixture();
    try { f.owner.setEndpoints(input.a, input.b); const work = f.owner.analyze({ anchors: input.anchors }); const failed = work.catch(error => error); await settle(() => computed); const changed = structuredClone(input.a); changed.revision++; changed.modes[0].frequencyHz++; f.owner.setEndpoint(0, changed); release(); expect(await failed).to.be.instanceOf(Error); expect(f.owner.state().candidate).to.equal(null); expect(f.owner.state().endpoints[0].modes[0].frequencyHz).to.equal(221); }
    finally { release(); await f.close(); expect(f.budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('keeps unknown producer retirement charged, settles the operation and refuses publication', async () => {
    const f = setup(real => ({ ...real, async compute(options) { const result = await real.compute(options); return { ...result, release() { result.release(); return false; } }; } })), { input } = await fixture();
    f.owner.setEndpoints(input.a, input.b); try { await f.owner.analyze({ anchors: input.anchors }); } catch {} expect(f.owner.state().active).to.equal(false); expect(f.owner.state().unknownRetirement).to.equal(1); expect(f.owner.state().candidate).to.equal(null); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0); expect((await f.close()).outcome).not.to.equal('complete');
  });
  it('imports the bounded original source atomically and rejects bad source hashes without replacing endpoints', async () => {
    const f = setup(), proof = await fixture(); try { const control = await f.owner.importProof({ size: 65536, text: async () => JSON.stringify(proof) }); expect(control.anchors).to.have.length(4); const before = f.owner.state().endpoints; proof.sources[0].id = 'tampered'; let error; try { await f.owner.importProof({ size: 65536, text: async () => JSON.stringify(proof) }); } catch (value) { error = value; } expect(error?.message).to.include('hashes differ'); expect(f.owner.state().endpoints).to.deep.equal(before); }
    finally { await f.close(); expect(f.budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('authors the accessible proof→pair/site review→parameter preview workflow without starting audio', async () => {
    const dom = new JSDOM('<!doctype html><body></body>'), proof = await fixture(), jobs = createTestBackgroundJobs({ identity }), budget = createResourceBudget({ limitBytes: 128 * 1048576 }); dom.window.fetch = async () => new globalThis.Response(JSON.stringify(proof)); const view = createResonatorMorphView({ document: dom.window.document, window: dom.window, jobs, resourceBudget: budget }); dom.window.document.body.append(view.element);
    const click = text => [...view.element.querySelectorAll('button')].find(button => button.textContent === text).click(), change = value => value.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    try { click('Load original dry / bright proof'); await settle(() => view.state().endpoints.every(Boolean) && !view.state().active); const checks = view.element.querySelectorAll('input[type=checkbox]'); checks[0].checked = true; change(checks[0]); click('Analyze correspondence candidates'); await settle(() => !!view.state().candidate && !view.state().active); expect(view.element.querySelectorAll('select')).to.have.length(4); expect([...view.element.querySelectorAll('select')].every(value => value.hasAttribute('aria-label'))).to.equal(true); checks[1].checked = true; change(checks[1]); click('Prepare reviewed next-onset map'); await settle(() => !!view.state().map && !view.state().active); expect(view.element.textContent).to.include('Parameter preview only'); checks[1].checked = false; change(checks[1]); expect(view.state().map).to.equal(null); }
    finally { const receipt = view.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); jobs.dispose(); dom.window.close(); expect(budget.diagnostics().accountedBytes).to.equal(0); }
  });
});
