import { expect } from 'chai';
import { validateEffectPerformance } from '../../js/midi/content/EffectPerformance.js';
import { effectGraphHash, prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';
import { prepareCapturedEffectReplay, createCapturedEffectReplayDriver } from '../../js/app/midi-ui/CapturedEffectReplay.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';

const definition = { schema: 'lemmings-effect-graph/v1', id: 'test.performed-gain', revision: 1, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 0,
  nodes: [{ id: 'source', kind: 'bus-in', parameters: {} }, { id: 'return', kind: 'gain', parameters: { gain01: 0.5, gainMaximum01: 1 } }, { id: 'output', kind: 'bus-out', parameters: {} }],
  edges: [{ from: { nodeId: 'source', port: 'audio' }, to: { nodeId: 'return', port: 'audio' }, gain01: 1 }, { from: { nodeId: 'return', port: 'audio' }, to: { nodeId: 'output', port: 'audio' }, gain01: 1 }] };
async function fixture() {
  const graphDefinitionHash = await effectGraphHash(prepareEffectGraphRevision(definition)), anchor = { intentId: 'first-note', sourceTargetFrame: 4800, executionEpoch: 'live-epoch' };
  const base = { schema: 'lemmings-effect-performance/v1', status: 'accepted', stage: 'effect-performance-captured', streamId: 'effects-one', ownerRouteRevision: 1, graphDefinitionHash,
    sampleRate: 48000, executionEpoch: 'live-epoch', clockAnchor: anchor, sourceEventIds: [], acousticReceipt: false };
  const publication = { ...base, operation: 'graph', sequence: 1, targetFrame: 2000, definition };
  const control = { ...base, operation: 'control', sequence: 2, targetFrame: 6000, nodeId: 'return', values: { gain01: 1 } };
  return { version: 1, operation: 'sound-only-revoice', sourceCanonicalHash: 'a'.repeat(64), nextSequence: null, effectCoverage: { captured: true, gaps: [] },
    boundary: { state: { sourceTimeMs: 0 } }, finalBoundaryState: { sourceTimeMs: 2000 }, intents: [{ version: 1, intentId: 'first-note', scoreTime: { sourceTimeMs: 100, subTick: 0 } }], effectEvents: [publication, control] };
}
async function rejection(work) { try { await work(); } catch (error) { return error; } throw new Error('Expected effect preflight rejection.'); }
describe('captured effect command revoice', () => {
  it('projects original audio-frame deltas at the selected rate without mutating intent or source history', async () => {
    const source = await fixture(), before = JSON.stringify(source), replay = await prepareCapturedEffectReplay(source, 44100, 44100);
    expect(replay.events[0].frame).to.equal(5513); expect(replay.frameOrigin).to.equal(0); expect(replay.initialMemory).to.include('cleared'); expect(replay.evidence).to.include('not-processor'); expect(JSON.stringify(source)).to.equal(before);
  });
  it('keeps preparation silent and reproduces the declared owner fade before scheduled parameter changes', async () => {
    const source = await fixture(), replay = await prepareCapturedEffectReplay(source, 48000, 48000), graph = await createOwnedEffectGraphKernel({ definition, frameOrigin: replay.frameOrigin }), driver = createCapturedEffectReplayDriver(replay, graph);
    let before = 0, after = 0;
    for (let frame = 0; frame < 5000; frame++) { driver.sample(0.1, -0.1, frame); if (frame === 1000) before = driver.leftSample; if (frame === 4000) after = driver.leftSample; }
    expect(before).to.be.closeTo(0.1, 1e-7); expect(after).to.be.closeTo(0.05, 1e-7);
    for (let frame = 5000; frame < 7000; frame++) driver.sample(0.1, -0.1, frame);
    expect(driver.leftSample).to.be.closeTo(0.1, 1e-7); expect(driver.rightSample).to.be.closeTo(-0.1, 1e-7);
  });
  it('preserves same-frame insertion order and validates all control domains before rendering PCM', async () => {
    const source = await fixture(); source.effectEvents.push({ ...source.effectEvents[1], sequence: 3, values: { gain01: 0 } });
    const replay = await prepareCapturedEffectReplay(source, 48000, 48000), graph = await createOwnedEffectGraphKernel({ definition }), driver = createCapturedEffectReplayDriver(replay, graph);
    for (let frame = 0; frame < 7000; frame++) driver.sample(0.1, 0.1, frame); expect(driver.leftSample).to.be.closeTo(0, 1e-9);
    const invalid = { ...replay, events: [{ ...replay.events[0], values: { gain01: 2 } }] }, other = await createOwnedEffectGraphKernel({ definition });
    expect(() => createCapturedEffectReplayDriver(invalid, other)).to.throw(); other.sample(0.1, 0.1); expect(other.leftSample).to.be.closeTo(0.05, 1e-7);
  });
  it('rejects missing clocks, route changes, coverage gaps and unsupported lifecycle reconstruction', async () => {
    const source = await fixture(); source.effectEvents[1].clockAnchor = null;
    expect((await rejection(() => prepareCapturedEffectReplay(source, 48000, 48000))).code).to.equal('effect-clock-unavailable');
    source.effectEvents[1].clockAnchor = source.effectEvents[0].clockAnchor; source.effectEvents[1].ownerRouteRevision = 2;
    expect((await rejection(() => prepareCapturedEffectReplay(source, 48000, 48000))).code).to.equal('effect-history-order');
    source.effectEvents[1].ownerRouteRevision = 1; source.effectCoverage.gaps.push({ kind: 'effect-performance' });
    expect((await rejection(() => prepareCapturedEffectReplay(source, 48000, 48000))).code).to.equal('effect-history-unavailable');
    source.effectCoverage.gaps = []; source.effectEvents.push({ ...source.effectEvents[0], sequence: 3, operation: 'bypass', definition: undefined, targetFrame: 10000, mode: 'owner-stop' });
    expect((await rejection(() => prepareCapturedEffectReplay(source, 48000, 48000))).code).to.equal('effect-lifecycle-replay-unavailable');
  });
  it('does not treat requested causal identities or malformed numbers as rendered evidence', async () => {
    const source = await fixture(); expect(validateEffectPerformance(source.effectEvents[1]).acousticReceipt).to.equal(false);
    expect(() => validateEffectPerformance({ ...source.effectEvents[1], acousticReceipt: true })).to.throw();
    expect(() => validateEffectPerformance({ ...source.effectEvents[1], values: { gain01: NaN } })).to.throw();
  });
});
