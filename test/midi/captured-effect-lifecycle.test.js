import { expect } from 'chai';
import { prepareCapturedEffectReplay, createCapturedEffectReplayDriver } from '../../js/app/midi-ui/CapturedEffectReplay.js';
import { prepareCapturedEffectLifecycle } from '../../js/app/midi-ui/CapturedEffectLifecycle.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';
import { createOwnerEffectGraphHost } from '../../js/app/midi-ui/OwnerEffectGraphHost.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
import { effectGraphHash, prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';

const definition = { schema: 'lemmings-effect-graph/v1', id: 'test.lifecycle-gain', revision: 1, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 0, nodes: [{ id: 'source', kind: 'bus-in', parameters: {} }, { id: 'return', kind: 'gain', parameters: { gain01: 0.5, gainMaximum01: 1 } }, { id: 'output', kind: 'bus-out', parameters: {} }], edges: [{ from: { nodeId: 'source', port: 'audio' }, to: { nodeId: 'return', port: 'audio' }, gain01: 1 }, { from: { nodeId: 'return', port: 'audio' }, to: { nodeId: 'output', port: 'audio' }, gain01: 1 }] };
const fixture = async (mode, rate = 48000) => {
  const graphDefinitionHash = await effectGraphHash(prepareEffectGraphRevision(definition, { sampleRate: rate })), base = { schema: 'lemmings-effect-performance/v1', status: 'accepted', stage: 'effect-performance-captured', streamId: 'effect-lifecycle', ownerRouteRevision: 1, graphDefinitionHash, sampleRate: rate, executionEpoch: 'live', clockAnchor: { intentId: 'first', sourceTargetFrame: 0, executionEpoch: 'live' }, sourceEventIds: [], acousticReceipt: false };
  return { version: 1, operation: 'sound-only-revoice', sourceCanonicalHash: 'a'.repeat(64), nextSequence: null, effectCoverage: { captured: true, gaps: [] }, boundary: { state: { sourceTimeMs: 0 } }, finalBoundaryState: { sourceTimeMs: 1000 }, intents: [{ version: 1, intentId: 'first', scoreTime: { sourceTimeMs: 0, subTick: 0 } }], effectEvents: [{ ...base, operation: 'graph', sequence: 1, targetFrame: 0, definition }, { ...base, operation: 'bypass', sequence: 2, targetFrame: 3000, mode }] };
};
const param = () => {
  let events = [], sequence = 0;
  return { value: 1, setValueAtTime(value, at) { events.push({ kind: 'set', value, at, sequence: sequence++ }); }, linearRampToValueAtTime(value, at) { events.push({ kind: 'linear', value, at, sequence: sequence++ }); }, cancelScheduledValues(at) { events = events.filter(event => event.at < at); },
    at(time) { let previous = { at: 0, value: 1 }; for (const event of [...events].sort((a, b) => a.at - b.at || a.sequence - b.sequence)) { if (time < event.at) return event.kind === 'linear' && event.at > previous.at ? previous.value + (event.value - previous.value) * (time - previous.at) / (event.at - previous.at) : previous.value; previous = event; } return previous.value; } };
};
const node = () => ({ gain: param(), connect() {}, disconnect() {} });
describe('captured single-graph native API lifecycle revoice (runtime/browser qualification deferred)', function() {
  this.timeout(60000);
  for (const rate of [44100, 48000, 96000]) for (const mode of ['mute', 'tail', 'neutral', 'panic']) it('matches the actual owner scheduling through its ' + mode + ' frontier at ' + rate, async () => {
    const source = await fixture(mode, rate), replay = await prepareCapturedEffectReplay(source, rate, rate), graph = await createOwnedEffectGraphKernel({ definition, sampleRate: rate }), driver = createCapturedEffectReplayDriver(replay, graph), created = [], dry = node(), resources = createAudioResourceLeases(), context = { currentTime: 0, sampleRate: rate, state: 'running', createGain() { const value = node(); created.push(value); return value; } }; let clearedAt = Infinity;
    const host = createOwnerEffectGraphHost({ context, input: node(), dry, destination: node(), resources, owner: 'parity', prepareGraph: async () => ({ hash: replay.graphHash, plan: { inputs: ['source'], outputs: ['output'], maximumTailFrames: 0 }, diagnostics: () => ({}), confirmReady: async () => {}, checkPublication() {}, getInput: node, getOutput: node, panic() { clearedAt = context.currentTime; }, dispose: () => createProcgenRetirementScope().retire() }) });
    try { await host.prepare(definition); context.currentTime = 3000 / rate; host.bypass(mode); for (let frame = 0; frame < 6000; frame++) { driver.sample(0.1, -0.1, frame); const time = frame / rate, wet = time >= clearedAt ? 0 : 0.1 * 0.5 * created[0].gain.at(time) * created[1].gain.at(time), expected = wet + 0.1 * dry.gain.at(time); expect(driver.leftSample).to.be.closeTo(expected, 2e-7); expect(driver.rightSample).to.be.closeTo(-expected, 2e-7); } expect(replay.lifecycle.timing).to.include('not-observed'); expect(replay.lifecycle.returnTapScope).to.include('before-owner'); }
    finally { context.state = 'closed'; await host.dispose().completion; }
  });
  it('retains controls while muted, but refuses later commands after the graph detached', async () => {
    const source = await fixture('mute'), base = source.effectEvents[1], control = { ...base, operation: 'control', mode: undefined, sequence: 3, targetFrame: 4000, nodeId: 'return', values: { gain01: 0.8 } }; source.effectEvents.push(control); const replay = await prepareCapturedEffectReplay(source, 48000, 48000), graph = await createOwnedEffectGraphKernel({ definition, returnNodeIds: ['return'] }), driver = createCapturedEffectReplayDriver(replay, graph);
    for (let frame = 0; frame < 6000; frame++) driver.sample(0.1, 0.1, frame); expect(driver.leftSample).to.equal(0); expect(graph.tapSamples[0]).to.be.closeTo(0.08, 1e-6);
    source.effectEvents[1].mode = 'neutral'; let error; try { await prepareCapturedEffectReplay(source, 48000, 48000); } catch (value) { error = value; } expect(error?.code).to.equal('effect-lifecycle-after-detach');
  });
  it('distinguishes previously queued controls from commands submitted after detachment', async () => {
    for (const mode of ['neutral', 'panic', 'tail']) {
      const source = await fixture(mode), bypass = { ...source.effectEvents[1], sequence: 3 }, control = { ...source.effectEvents[1], operation: 'control', mode: undefined, sequence: 2, targetFrame: 3500, nodeId: 'return', values: { gain01: 0.8 } }; source.effectEvents = [source.effectEvents[0], control, bypass];
      const before = JSON.stringify(source), replay = await prepareCapturedEffectReplay(source, 48000, 48000); expect(JSON.stringify(source)).to.equal(before);
      if (mode === 'tail') { expect(replay.lifecycle.retainedTailControls).to.deep.equal([2]); expect(replay.events.some(event => event.sequence === 2)).to.equal(true); }
      else { expect(replay.lifecycle.canceledQueuedControls).to.deep.equal([2]); expect(replay.events.some(event => event.sequence === 2)).to.equal(false); }
    }
  });
  it('requires the exact lifecycle frame and validates events before mutating a graph', async () => {
    const replay = await prepareCapturedEffectReplay(await fixture('panic'), 48000, 48000), graph = await createOwnedEffectGraphKernel({ definition }); const driver = createCapturedEffectReplayDriver(replay, graph); expect(() => driver.sample(0.1, 0.1, 4000)).to.throw('exact revoice frontier'); expect(graph.frame).to.equal(0); const bad = { ...replay, events: [{ kind: 'lifecycle', mode: 'unknown', frame: 0 }] }; expect(() => createCapturedEffectReplayDriver(bad, graph)).to.throw(); expect(graph.frame).to.equal(0);
  });
  it('does not infer processor/body/owner-stop disposition from native API commands', () => { const event = { kind: 'lifecycle', mode: 'tail', frame: 100 }; for (const extra of [{ spectral: {} }, { membrane: {} }, { network: {} }]) expect(() => prepareCapturedEffectLifecycle({ nodes: [extra], maximumTailFrames: 1000 }, [event], 0, 960)).to.throw('applied lifecycle evidence'); expect(() => prepareCapturedEffectLifecycle({ nodes: [], maximumTailFrames: 0 }, [{ ...event, mode: 'owner-stop' }], 0, 960)).to.throw('tail disposition'); expect(() => prepareCapturedEffectLifecycle({ nodes: [], maximumTailFrames: 0 }, [{ ...event, frame: -1 }], 0, 960)).to.throw('precedes'); });
});
