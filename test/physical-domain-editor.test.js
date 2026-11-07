import { expect } from 'chai';
import { TestDocument } from './helpers/test-dom.js';
import { createPhysicalDomainEditor } from '../js/app/procgen/workstation/PhysicalDomainEditor.js';
describe('physical scene cargo authoring surface', () => {
  it('stages a real typed courier graph without publishing or arming it, then saves one revision', () => {
    const document = new TestDocument(), saved = [], errors = []; let owner = 1, graph = { version: 1, revision: 1, instruments: [] };
    const view = createPhysicalDomainEditor({ document, getOwner: () => owner, getGraph: () => graph, saveGraph: value => { saved.push(value); graph = value; }, getInspection: () => ({ tokens: [] }), onStatus: value => errors.push(value) });
    view.open(); const dialog = document.body.children.at(-1), click = text => dialog.children.find(value => value.textContent === text).dispatchEvent({ type: 'click' }); click('Insert courier chord example'); expect(saved).to.have.length(0); click('Save scene revision'); expect(saved).to.have.length(1); expect(saved[0].cargoStations).to.have.length(2); expect(saved[0].instruments[0].sourceKind).to.equal('CargoDelivery'); expect(saved[0]).not.to.have.property('runtimeTokens'); owner++; click('Save scene revision'); expect(saved).to.have.length(1); expect(errors.at(-1)).to.include('earlier document'); view.dispose();
  });
});
