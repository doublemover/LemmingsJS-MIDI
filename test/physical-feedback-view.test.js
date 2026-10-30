import { expect } from 'chai';
import { TestDocument } from './helpers/test-dom.js';
import { createPhysicalFeedbackView } from '../js/app/procgen/workstation/PhysicalFeedbackView.js';
describe('explicit feedback arming surface', () => {
  it('loading and inspecting definitions never arms, and replaced documents cannot publish controls', async () => {
    const document = new TestDocument(), graph = { version: 1, revision: 1, instruments: [] }; let owner = 1, arms = 0, saves = 0; const errors = [];
    const view = createPhysicalFeedbackView({ document, getOwner: () => owner, getGraph: () => graph, getState: () => ({ armed: false }), save: () => saves++, arm: () => arms++, disarm: () => {}, mute: () => {}, capture: () => {}, onStatus: value => errors.push(value) });
    view.open(); expect(arms).to.equal(0); const dialog = document.body.children.at(-1), click = text => dialog.children.find(node => node.textContent === text).dispatchEvent({ type: 'click' });
    click('Plan / qualify definitions'); await Promise.resolve(); expect(arms).to.equal(0); click('Save definitions'); await Promise.resolve(); expect(saves).to.equal(1); expect(arms).to.equal(0);
    click('Arm live feedback'); await Promise.resolve(); expect(arms).to.equal(1); owner++; click('Arm live feedback'); await Promise.resolve(); expect(arms).to.equal(1); expect(errors.at(-1)).to.include('earlier document'); view.dispose();
  });
});
