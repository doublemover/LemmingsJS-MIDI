import { expect } from 'chai';
import { createOwnedEffectGraphKernel, prepareOwnedEffectGraphPlan } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';
import { createQuarryEcho, createQuarryBody } from '../../js/midi/content/DubQuarryRack.js';
import { renderCausalOwnedTake } from '../../js/app/midi-ui/CausalOwnedRender.js';
import { CAUSAL_RENDER_SINE } from '../../js/app/midi-ui/CausalTakeAudioRender.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';

const edge = (from, to) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01: 1 });
const driveGraph = () => ({ schema: 'lemmings-effect-graph/v1', id: 'fixture.shared-drive', revision: 1, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 1,
  nodes: [{ id: 'source', kind: 'bus-in', parameters: {} }, { id: 'drive', kind: 'nonlinear-chain', parameters: { stages: [{ shape: 'cubic', driveDb: 0, bias: 0 }], antialiasMode: 'direct', oversample: 1, inputHighpassHz: 0, outputDcBlockHz: 0 } }, { id: 'output', kind: 'bus-out', parameters: {} }], edges: [edge('source', 'drive'), edge('drive', 'output')] });
const pcm = file => { const view = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength); for (let at = 12; at < file.bytes.length;) { const id = String.fromCharCode(...file.bytes.subarray(at, at + 4)), length = view.getUint32(at + 4, true); if (id === 'data') return file.bytes.subarray(at + 8, at + 8 + length); at += 8 + length + length % 2; } };
describe('one full owned effect graph and simultaneous return taps (deferred)', () => {
  it('keeps dry impulses separate from admitted shared delayed returns without inventing later source input', async () => {
    const graph = await createOwnedEffectGraphKernel({ definition: createQuarryEcho({ delaySeconds: 10 / 48000, send01: 0.5, return01: 0.2, feedback: 0 }), returnNodeIds: ['return'] });
    for (let frame = 0; frame < 64; frame++) {
      graph.sample(frame === 0 ? 1 : 0, frame === 7 ? -1 : 0);
      expect(graph.leftSample).to.be.closeTo(frame === 0 ? 1 : frame === 10 ? 0.1 : 0, 1e-7);
      expect(graph.rightSample).to.be.closeTo(frame === 7 ? -1 : frame === 17 ? -0.1 : 0, 1e-7);
      expect(graph.tapSamples[0]).to.be.closeTo(frame === 10 ? 0.1 : 0, 1e-7);
    }
    expect(() => graph.sample(NaN, 0)).to.throw('input'); graph.sample(1, 1); expect(graph.leftSample).to.equal(0);
  });
  it('processes a summed nonlinear interaction once, rather than summing separately distorted lanes', async () => {
    const shared = await createOwnedEffectGraphKernel({ definition: driveGraph(), returnNodeIds: ['drive'] }), a = await createOwnedEffectGraphKernel({ definition: driveGraph() }), b = await createOwnedEffectGraphKernel({ definition: driveGraph() });
    shared.sample(0.7, 0.7); a.sample(0.4, 0.4); b.sample(0.3, 0.3);
    expect(Math.abs(shared.leftSample - a.leftSample - b.leftSample)).to.be.greaterThan(0.01); expect(shared.tapSamples[0]).to.equal(shared.leftSample);
    expect(() => shared.sample(NaN, 0)).to.throw('input'); shared.sample(1, 1); expect(shared.leftSample).to.equal(0); expect(() => shared.update('drive', { driveDb: 2 })).to.throw('cleared');
    expect(() => prepareOwnedEffectGraphPlan(createQuarryBody())).to.throw('native convolution');
  });
  it('renders two actual causal lanes with simultaneous dry/shared taps and retains complete effect preroll across crops', async () => {
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-sine', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    const intents = [0, 1].flatMap(laneId => ['begin', 'end'].map((kind, i) => ({ version: 1, kind, worldId: 'fixture.world', generation: 1, actorId: laneId, voiceId: 'voice-' + laneId, onsetId: 'onset-' + laneId, intentId: 'intent-' + laneId + '-' + i,
      laneId, sourceEventIds: ['cause-' + laneId + '-' + i], scoreTime: { sourceTimeMs: i ? 600 : 100, subTick: 0, simTick: i ? 60 : 10 }, pitch: { cents: 6000, referenceHz: 440 }, velocity01: 0.8, expression: {} }))).sort((a, b) => a.scoreTime.sourceTimeMs - b.scoreTime.sourceTimeMs);
    const revoice = { operation: 'sound-only-revoice', version: 1, takeId: 'fixture.fx-take', takeRevision: 1, sourceCanonicalHash: 'b'.repeat(64), sourceState: 'finalized', nextSequence: null, sourceVersions: { physical: 1, intent: 1 }, coverage: { status: 'known-covered' },
      boundary: { status: 'captured-initial-state', state: { sourceTimeMs: 0, voices: [] } }, finalBoundaryState: { sourceTimeMs: 1000 }, intents };
    const base = { revoice, definition: CAUSAL_RENDER_SINE, descriptor, sampleRate: 48000, endSeconds: 1, stemLaneIds: ['0', '1'] }, options = { yieldControl: async () => {} };
    const dry = await renderCausalOwnedTake(base, options), full = await renderCausalOwnedTake({ ...base, effectGraph: driveGraph(), effectReturnNodeIds: ['drive'] }, options);
    expect(full.files).to.have.length(4); expect(pcm(full.files[0])).to.deep.equal(pcm(full.files[3]));
    expect(pcm(full.files[1])).to.deep.equal(pcm(dry.files[1])); expect(pcm(full.files[2])).to.deep.equal(pcm(dry.files[2])); expect(pcm(full.files[0])).not.to.deep.equal(pcm(dry.files[0]));
    const cropped = await renderCausalOwnedTake({ ...base, startSeconds: 0.303, effectGraph: driveGraph(), effectReturnNodeIds: ['drive'] }, options);
    expect(pcm(cropped.files[0])).to.deep.equal(pcm(full.files[0]).subarray(14544 * 8)); expect(pcm(cropped.files[3])).to.deep.equal(pcm(full.files[3]).subarray(14544 * 8));
    expect(full.manifest.effectGraph.controls).to.equal('explicit-authored-defaults-not-replayed-live-gestures'); expect(full.files[3].manifest).to.include({ tap: 'shared-effect-node-output', returnNodeId: 'drive', laneId: null });
  });
});
