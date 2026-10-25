import { expect } from 'chai';
import { EnvelopeFollowerKernel } from '../../js/app/midi-ui/worklet/EnvelopeFollowerKernel.js';
import { EnvelopeMappingKernel } from '../../js/app/midi-ui/worklet/EnvelopeMappingKernel.js';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';
import { createQuarryDuck } from '../../js/midi/content/DubQuarryRack.js';

const route = (from, fromPort, to, toPort) => ({ from: { nodeId: from, port: fromPort }, to: { nodeId: to, port: toPort }, gain01: 1 });
const externalGraph = () => ({ schema: 'lemmings-effect-graph/v1', id: 'test.sidechain', revision: 1, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 4,
  nodes: [{ id: 'source', kind: 'bus-in', parameters: {} }, { id: 'donor', kind: 'sidechain-in', parameters: { sourceBusId: 'lane:diggers', tap: 'pre-fader', inputLayout: 'audioStereo' } },
    { id: 'follow', kind: 'envelope-detector', parameters: { attackSeconds: 0, releaseSeconds: 0.01 } },
    { id: 'map', kind: 'envelope-mapping', parameters: { mapping: 'linear-amplitude', neutral01: 1, depth01: 1, polarity: -1 } },
    { id: 'target', kind: 'modulated-gain', parameters: {} }, { id: 'output', kind: 'bus-out', parameters: {} }],
  edges: [route('source', 'audio', 'target', 'audio'), route('donor', 'audio', 'follow', 'audio'), route('follow', 'envelope', 'map', 'envelope'), route('map', 'modulation', 'target', 'gain'), route('target', 'audio', 'output', 'audio')] });

describe('typed signal-rate sidechains (authored; qualification deferred)', () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    it('uses amplitude 1/e timing and releases missing input at ' + sampleRate, () => {
      const kernel = new EnvelopeFollowerKernel({ sampleRate, parameters: { attackSeconds: 0.01, releaseSeconds: 0.02 } });
      for (let i = 0; i < Math.round(sampleRate * 0.01); i++) kernel.sample(1, -1);
      expect(kernel.output).to.be.closeTo(1 - Math.exp(-1), 1e-10);
      const peak = kernel.output;
      for (let i = 0; i < Math.round(sampleRate * 0.02); i++) kernel.sample(1, 1, false);
      expect(kernel.output).to.be.closeTo(peak * Math.exp(-1), 1e-10); expect(kernel.sourceAvailable).to.equal(false);
      for (let i = 0; i < sampleRate; i++) kernel.sample(0, 0, false);
      expect(kernel.output).to.equal(0); expect(kernel.faults).to.equal(0);
    });
    it('keeps antiphase stereo energy and drains the exact trailing RMS window at ' + sampleRate, () => {
      const kernel = new EnvelopeFollowerKernel({ sampleRate, parameters: { kind: 'rms', windowFrames: 8, attackSeconds: 0, releaseSeconds: 0, stereoLink: 'mean-power' } });
      kernel.sample(1, -1); expect(kernel.output).to.equal(Math.sqrt(1 / 8));
      for (let i = 1; i < 8; i++) kernel.sample(0, 0); expect(kernel.output).to.equal(Math.sqrt(1 / 8));
      kernel.sample(0, 0); expect(kernel.output).to.equal(0); expect(kernel.powerSum).to.equal(0);
    });
    it('restores nontrivial RMS history and release exactly at ' + sampleRate, () => {
      const options = { sampleRate, parameters: { kind: 'rms', windowFrames: 31, attackSeconds: 0.004, releaseSeconds: 0.08 } };
      const source = new EnvelopeFollowerKernel(options), restored = new EnvelopeFollowerKernel(options);
      for (let i = 0; i < 119; i++) source.sample(Math.sin(i) * 0.3, Math.cos(i) * 0.7);
      const bytes = new Uint8Array(source.stateByteLength()); source.snapshotInto(bytes); restored.restoreFrom(bytes);
      for (let i = 0; i < 1000; i++) { const value = i < 39 ? 0.2 : 0; source.sample(value, -value); restored.sample(value, -value); expect(restored.output).to.equal(source.output); }
    });
    it('keeps donor audio inaudible, shares a detector, and releases toward neutral at ' + sampleRate, async () => {
      const graph = externalGraph(); graph.nodes.push({ id: 'second-map', kind: 'envelope-mapping', parameters: { mapping: 'linear-amplitude', neutral01: 0, depth01: 0.2, polarity: 1 } }, { id: 'second-target', kind: 'modulated-gain', parameters: {} });
      graph.edges.push(route('follow', 'envelope', 'second-map', 'envelope'), route('source', 'audio', 'second-target', 'audio'), route('second-map', 'modulation', 'second-target', 'gain'), route('second-target', 'audio', 'output', 'audio'));
      const render = await createOwnedEffectGraphKernel({ definition: graph, sampleRate }), donor = new Float32Array([1, -1]);
      render.sample(0, 0, donor); expect(render.leftSample).to.equal(0); expect(render.rightSample).to.equal(0);
      render.sample(0.5, -0.5, donor); expect(render.leftSample).to.be.closeTo(0.1, 1e-7);
      for (let i = 0; i < sampleRate; i++) render.sample(0.5, -0.5);
      expect(render.leftSample).to.be.closeTo(0.5, 1e-7); expect(render.plan.nodes.filter(node => node.detector)).to.have.length(1);
    });
  }
  it('maps depth and polarity in declared units with bounded dB interpolation error', () => {
    for (const polarity of [-1, 1]) {
      const map = new EnvelopeMappingKernel({ parameters: { mapping: 'decibel-attenuation', neutralDb: -17, depthDb: 60, polarity } });
      for (let i = 0; i <= 10000; i++) { const envelope = i / 10000; map.sample(envelope); expect(map.output).to.be.closeTo(Math.min(1, 10 ** ((-17 + polarity * 60 * envelope) / 20)), 0.00002); }
    }
    expect(() => new EnvelopeMappingKernel({ parameters: { mapping: 'linear-amplitude', depthDb: 12 } })).to.throw();
  });
  it('rejects implicit audio/control casts, control summation, master feedback and cycles', () => {
    const badPort = externalGraph(); badPort.edges.find(edge => edge.to.nodeId === 'map').from = { nodeId: 'source', port: 'audio' };
    expect(() => prepareEffectGraphRevision(badPort)).to.throw('typed ports');
    const master = externalGraph(); master.nodes.find(node => node.id === 'donor').parameters.sourceBusId = 'master'; expect(() => prepareEffectGraphRevision(master)).to.throw('source identity');
    const cycle = externalGraph(); cycle.edges.push(route('output', 'audio', 'follow', 'audio')); expect(() => prepareEffectGraphRevision(cycle)).to.throw();
    const mixed = externalGraph(); mixed.edges.push(route('map', 'modulation', 'target', 'audio')); expect(() => prepareEffectGraphRevision(mixed)).to.throw();
  });
  it('authors return-only ducking with a separate unattenuated dry route', () => {
    const graph = createQuarryDuck({ send01: 0.3 }), plan = prepareEffectGraphRevision(graph);
    expect(graph.edges.some(edge => edge.from.nodeId === 'dry' && edge.to.nodeId === 'output')).to.equal(true);
    expect(graph.edges.some(edge => edge.from.nodeId === 'duck-return' && edge.to.nodeId === 'dry')).to.equal(false);
    expect(plan.latencyFrames).to.equal(0); expect(plan.nodes.find(node => node.detector).detector.lookaheadFrames).to.equal(0);
  });
});
