import { expect } from 'chai';
import { createMasterCaptureProvenance } from '../../js/app/midi-ui/MasterCaptureProvenance.js';

const snapshot = (observedFrame, routeRevision = 1, graphRevision = 3) => ({ contextEpoch: 4, sampleRate: 48000,
  observedFrame, routeRevision, owners: [{ ownerId: 'physical#1', generation: 2, enabled: true,
    graph: { worldId: 'world', graphRevision, routeRevision: 5, scoreMapping: { beat: 8, bpm: 120,
      executionEpoch: 'execution', scoreEpoch: 'score', contextSeconds: 0, correlationHostMs: 20, hostMs: 20,
      uncertaintyMs: 0.5, presentationDelayMs: 12 } } }], unscoredMasterSourcesPossible: true });

describe('bounded browser-master capture provenance', () => {
  it('retains owner-scoped score anchors and route changes without inventing applied frames', () => {
    const owner = createMasterCaptureProvenance({ contextEpoch: 4, sampleRate: 48000 });
    const initial = snapshot(10); owner.observe(initial); initial.owners[0].graph.graphRevision = 999;
    expect(owner.observe(snapshot(15))).to.equal(false);
    owner.observe(snapshot(20, 2, 4));
    const result = owner.finish({ sourceStartFrame: 12, endFrameExclusive: 40, terminationReason: 'user-stop' });
    expect(result.graphRevisionHistory).to.have.length(2);
    expect(result.graphRevisionHistory[0].owners[0].graph.graphRevision).to.equal(3);
    expect(result.graphRevisionHistory[1]).to.include({ observedFrame: 20, appliedFrame: null });
    expect(result.segments[0]).to.include({ sourceStartFrame: 12, frameCount: 28, sampleRate: 48000,
      layout: 'audioStereo', contextEpoch: 4, routeRevision: 1, terminationReason: 'user-stop' });
    expect(result.segments[0].scoreMapping.exactApplicationFrames).to.equal(false);
    expect(owner.observe(snapshot(50))).to.equal(false);
  });
  it('refuses another context, rate or backwards clock instead of concatenating domains', () => {
    for (const change of [{ contextEpoch: 5 }, { sampleRate: 44100 }, { observedFrame: 9 }]) {
      const owner = createMasterCaptureProvenance({ contextEpoch: 4, sampleRate: 48000 }); owner.observe(snapshot(10));
      expect(() => owner.observe({ ...snapshot(11), ...change })).to.throw('changed frame domain');
    }
  });
  it('refuses metadata growth and preserves the admitted prefix as incomplete', () => {
    const owner = createMasterCaptureProvenance({ contextEpoch: 4, sampleRate: 48000 });
    let refused = false;
    for (let index = 0; index < 100; index++) {
      try { owner.observe(snapshot(index, index)); } catch (error) { expect(error.message).to.include('capacity'); refused = true; break; }
    }
    expect(refused).to.equal(true);
    const result = owner.finish({ sourceStartFrame: 0, endFrameExclusive: 100, terminationReason: 'provenance-unavailable' });
    expect(result.complete).to.equal(false); expect(result.graphRevisionHistory.length).to.be.at.most(64);
    expect(result.retainedTextBytes).to.be.at.most(result.maximumTextBytes);
  });
  it('reports unavailable mapping honestly for a legacy tap and emits no empty segment', () => {
    const result = createMasterCaptureProvenance({ contextEpoch: 4, sampleRate: 48000 }).finish({
      sourceStartFrame: null, endFrameExclusive: null, terminationReason: 'capture-start-failed' });
    expect(result).to.include({ status: 'unavailable', complete: false }); expect(result.segments).to.deep.equal([]);
  });
});
