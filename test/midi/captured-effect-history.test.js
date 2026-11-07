import { expect } from 'chai';
import { capturedEffectHistoryFixture } from '../helpers/capturedEffectHistory.js';
import { prepareCapturedEffectReplay } from '../../js/app/midi-ui/CapturedEffectReplay.js';
import { createCapturedEffectHistoryDriver } from '../../js/app/midi-ui/CapturedEffectHistoryDriver.js';
import { validateEffectPerformance } from '../../js/midi/content/EffectPerformance.js';
import { capturedEffectHistoryReceipt } from '../../js/app/midi-ui/CapturedEffectHistory.js';
import { CAUSAL_RENDER_SINE } from '../../js/app/midi-ui/CausalTakeAudioRender.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { renderCausalSineTake } from '../../js/app/midi-ui/CausalSineRender.js';
import { createQuarryEcho } from '../../js/midi/content/DubQuarryRack.js';
import { effectGraphHash, prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';

const denied = async (work, code) => { let error; try { await work(); } catch (caught) { error = caught; } expect(error?.code).to.equal(code); };
const run = async (driver, end, checkpoints = []) => {
  const samples = new Map();
  for (let frame = 0; frame < end; frame++) { if (frame === driver.nextBoundary) await driver.advance(frame); driver.sample(0.1, -0.1, frame); if (checkpoints.includes(frame)) samples.set(frame, driver.leftSample); }
  return samples;
};
describe('captured changing-graph command revoice', () => {
  for (const sampleRate of [44100, 48000, 96000]) it('preserves source deltas and bounded predecessor deadlines at ' + sampleRate + ' Hz', async () => {
    const source = await capturedEffectHistoryFixture(), original = JSON.stringify(source), replay = await prepareCapturedEffectReplay(source, sampleRate, sampleRate);
    expect(replay.schema).to.equal('lemmings-captured-effect-history/v1'); expect(replay.graphs.map(graph => graph.startFrame)).to.deep.equal([2000, 12000, 24000].map(frame => Math.round(frame * sampleRate / 48000)));
    expect(replay.graphs[0].retireFrame).to.equal(Math.round(12960 * sampleRate / 48000)); expect(replay.maximumConcurrentGraphs).to.equal(2); expect(replay.peakStateBytes).to.equal(0);
    expect(JSON.stringify(source)).to.equal(original); expect(capturedEffectHistoryReceipt(replay).graphs).to.have.length(3);
  });
  it('keeps one dry path, crossfades sustained input and retires both old realizations', async () => {
    const replay = await prepareCapturedEffectReplay(await capturedEffectHistoryFixture(), 48000, 48000), driver = createCapturedEffectHistoryDriver(replay, ['return']);
    const samples = await run(driver, 30000, [1000, 4000, 12000, 12480, 14000, 26000]);
    for (const [frame, expected] of [[1000, 0.1], [4000, 0.02], [12000, 0.02], [12480, 0.04], [14000, 0.06], [26000, 0.09]]) expect(samples.get(frame), 'frame ' + frame).to.be.closeTo(expected, 1e-7);
    expect(driver.tapSamples[0]).to.be.closeTo(0.09, 1e-7); expect(driver.diagnostics()).to.include({ peakGraphs: 2, sourceRealizations: 1, exactLiveDspState: false }); expect(driver.diagnostics().completed).to.have.length(2); driver.assertHealthy();
  });
  it('retains signed context/source origins without shifting controls on bodies with no analysis grid', async () => {
    const source = await capturedEffectHistoryFixture(); for (const packet of source.effectEvents) packet.clockAnchor.sourceTargetFrame = 1000;
    const replay = await prepareCapturedEffectReplay(source, 48000, 48000); expect(replay.capturedFrameOrigin).to.equal(-3800); expect(replay.frameOrigin).to.equal(0);
    expect(replay.graphs.map(graph => graph.startFrame)).to.deep.equal([5800, 15800, 27800]);
    const driver = createCapturedEffectHistoryDriver(replay); await run(driver, 30000); expect(driver.leftSample).to.be.closeTo(0.09, 1e-7);
  });
  it('holds the actual partial input gain when a replacement interrupts an opening ramp', async () => {
    const replay = await prepareCapturedEffectReplay(await capturedEffectHistoryFixture({ frames: [2000, 2480, 24000] }), 48000, 48000), driver = createCapturedEffectHistoryDriver(replay);
    const samples = await run(driver, 3000, [2480, 2720]);
    expect(samples.get(2480)).to.be.closeTo(0.06, 1e-7);
    expect(samples.get(2720)).to.be.closeTo(0.0475, 1e-7);
  });
  it('retains real delayed energy after the old graph input has finished detaching', async () => {
    const source = await capturedEffectHistoryFixture(); source.effectEvents.length = 2;
    const graph = source.effectEvents[0]; graph.definition = createQuarryEcho({ send01: 0.5 }); const plan = prepareEffectGraphRevision(graph.definition);
    graph.graphDefinitionHash = await effectGraphHash(plan); source.effectEvents[1].routeTransition.previous.graphDefinitionHash = graph.graphDefinitionHash;
    source.effectEvents[1].routeTransition.previous.retireAtFrame += plan.maximumTailFrames;
    const replay = await prepareCapturedEffectReplay(source, 48000, 48000), driver = createCapturedEffectHistoryDriver(replay, ['return']); let retainedPeak = 0;
    for (let frame = 0; frame < 40000; frame++) { if (frame === driver.nextBoundary) await driver.advance(frame); driver.sample(frame === 5000 ? 0.1 : 0, 0, frame); if (frame > 12960) retainedPeak = Math.max(retainedPeak, Math.abs(driver.leftSample)); }
    expect(retainedPeak).to.be.greaterThan(1e-6); expect(replay.peakStateBytes).to.equal(plan.stateBytes); expect(driver.diagnostics().peakGraphs).to.equal(2); driver.assertHealthy();
  });
  it('renders one held note across three graphs and preserves crop PCM and dry stem exactly', async () => {
    const source = await capturedEffectHistoryFixture(), replay = await prepareCapturedEffectReplay(source, 48000, 48000), descriptor = (await describeNativeInstrumentEngines([{ engineId: 'worklet-sine', engineVersion: 1, artifactHash: 'b'.repeat(64) }]))[0];
    const input = { revoice: source, definition: CAUSAL_RENDER_SINE, descriptor, sampleRate: 48000, endSeconds: 1, capturedEffects: true, effectReplayHash: replay.hash, effectGraph: replay.definition, effectReturnNodeIds: ['return'], stemLaneIds: ['0'] };
    const full = await renderCausalSineTake(input, { yieldControl: async () => {} }), crop = await renderCausalSineTake({ ...input, startSeconds: 0.35 }, { yieldControl: async () => {} });
    expect(full.manifest.commands.capturedBegins).to.equal(1); expect(full.manifest.commands.capturedEnds).to.equal(1); expect(full.manifest.effectGraph.commandReplay.history.graphs).to.have.length(3); expect(full.manifest.effectGraph.realization.peakGraphs).to.equal(2); expect(full.files[0].manifest.statistics.peak).to.be.greaterThan(0);
    const data = file => { const bytes = file.bytes; return bytes.subarray(56, 56 + new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(52, true)); };
    for (let file = 0; file < full.files.length; file++) expect(Buffer.from(data(crop.files[file]))).to.deep.equal(Buffer.from(data(full.files[file]).subarray(16800 * 8)));
    expect(source.intents).to.have.length(2);
  });
  for (const [name, mutate, code] of [
    ['missing transition evidence', source => { delete source.effectEvents[1].routeTransition; }, 'effect-transition-evidence-unavailable'],
    ['wrong predecessor', source => { source.effectEvents[2].routeTransition.previous.graphDefinitionHash = 'c'.repeat(64); }, 'effect-transition-predecessor'],
    ['invented tail deadline', source => { source.effectEvents[1].routeTransition.previous.retireAtFrame += 128; }, 'effect-transition-tail-identity'],
    ['mixed epochs', source => { source.effectEvents[1].executionEpoch = source.effectEvents[1].clockAnchor.executionEpoch = 'other'; }, 'effect-history-order'],
    ['duplicate route', source => { source.effectEvents[1].ownerRouteRevision = 1; source.effectEvents[1].routeTransition.previous = null; }, 'effect-transition-evidence-unavailable'],
    ['third overlapping revision', source => { source.effectEvents[2].targetFrame = source.effectEvents[2].routeTransition.startFrame = 12480; source.effectEvents[2].routeTransition.previous.retireAtFrame = 13440; }, 'effect-transition-capacity'],
    ['unsupported body-only stop', source => { source.effectEvents.push({ ...source.effectEvents[2], definition: undefined, routeTransition: undefined, operation: 'body-panic', nodeId: 'body', sequence: 4 }); }, 'effect-transition-replay-unavailable']
  ]) it('refuses ' + name + ' before any PCM publication', async () => { const source = await capturedEffectHistoryFixture(); mutate(source); await denied(() => prepareCapturedEffectReplay(source, 48000, 48000), code); });
  it('validates transition shape and forbids carrying publication metadata on controls', async () => {
    const source = await capturedEffectHistoryFixture(), packet = source.effectEvents[1];
    for (const value of [NaN, -1, 1, 96001]) expect(() => validateEffectPerformance({ ...packet, routeTransition: { ...packet.routeTransition, transitionFrames: value } })).to.throw();
    expect(() => validateEffectPerformance({ ...packet, operation: 'control', definition: undefined, nodeId: 'return', values: { gain01: 0.2 } })).to.throw();
  });
  it('rejects controls outside their retained route and keeps the original capture unchanged', async () => {
    const source = await capturedEffectHistoryFixture(); source.effectEvents.push({ ...source.effectEvents[0], definition: undefined, routeTransition: undefined, operation: 'control', nodeId: 'return', values: { gain01: 0.4 }, targetFrame: 12960, sequence: 4 });
    const original = JSON.stringify(source); await denied(() => prepareCapturedEffectReplay(source, 48000, 48000), 'effect-transition-command-after-retirement'); expect(JSON.stringify(source)).to.equal(original);
  });
});
