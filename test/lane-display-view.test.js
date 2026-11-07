import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createLaneDisplayView } from '../js/app/procgen/workstation/LaneDisplayView.js';
describe('stable lane display DOM', () => {
  it('updates only retained text nodes and exposes full text without a live announcement stream', async () => {
    const dom = new JSDOM('<body></body>'), document = dom.window.document, view = createLaneDisplayView({ document, laneId: 'lane-1' });
    try {
      document.body.append(view.element); const nodes = [...view.element.querySelectorAll('span')].map(row => row.firstChild), mutations = [];
      const observer = new dom.window.MutationObserver(records => mutations.push(...records)); observer.observe(view.element, { childList: true, subtree: true, characterData: true });
      const snapshot = { laneId: 'lane-1', name: 'A long complete name that must remain accessible', top: 'World paused', bottom: 'No event observed', displayPage: 'identity', priority: 'ordinary', evidenceClass: 'unknown', completeness: 'unrecorded', stale: false };
      view.update(snapshot); view.update({ ...snapshot, bottom: 'Sustain request 127' }); await Promise.resolve();
      expect(mutations.filter(value => value.type === 'childList')).to.have.length(0); expect(mutations.some(value => value.type === 'characterData')).to.equal(true);
      expect([...view.element.querySelectorAll('span')].map(row => row.firstChild)).to.deep.equal(nodes); expect(view.element.getAttribute('aria-label')).to.include(snapshot.name).and.include('Sustain request 127'); expect(view.element.hasAttribute('aria-live')).to.equal(false);
      observer.disconnect(); view.dispose(); expect(view.snapshot()).to.equal(null); expect(view.element.isConnected).to.equal(false);
    } finally { dom.window.close(); }
  });
});
