import { expect } from 'chai';
import { TestDocument } from './helpers/test-dom.js';
import { createReleaseGestureView } from '../js/app/procgen/workstation/ReleaseGestureView.js';
import { createProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
describe('release performance surface fences', () => {
  it('separates recipe saves from performance and refuses stale document commands', async () => {
    const document = new TestDocument(), project = createProcgenWorkstationProject(), saved = [], performed = [], statuses = []; let owner = 1;
    const view = createReleaseGestureView({ document, getProject: () => project, getOwner: () => owner, getState: () => null, save: value => saved.push(value), perform: value => performed.push(value), cancel: () => {}, onStatus: value => statuses.push(value) });
    view.open(); const dialog = document.body.children.at(-1), button = name => dialog.children.find(value => value.textContent === name), click = name => button(name).dispatchEvent({ type: 'click' });
    click('Save recipe'); await Promise.resolve(); expect(saved).to.have.length(1); expect(performed).to.have.length(0);
    click('Perform release'); await Promise.resolve(); expect(performed).to.have.length(1);
    owner++; click('Perform release'); await Promise.resolve(); expect(performed).to.have.length(1); expect(statuses.at(-1)).to.include('earlier document'); click('Close'); await Promise.resolve(); expect(document.body.children).not.to.include(dialog); view.dispose();
  });
});
