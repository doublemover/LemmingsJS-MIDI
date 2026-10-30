import { expect } from 'chai';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';
import { prepareEffectSourceBindings, validateEffectSourceBindings, createEffectSourceSampler } from '../../js/app/midi-ui/EffectSourceBindings.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';

const edge = (from, fromPort, to, toPort) => ({ from: { nodeId: from, port: fromPort }, to: { nodeId: to, port: toPort }, gain01: 1 });
const graph = () => ({ schema: 'lemmings-effect-graph/v1', id: 'fixture.bound-donor', revision: 1, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 30,
  nodes: [{ id: 'source', kind: 'bus-in', parameters: {} }, { id: 'donor', kind: 'sidechain-in', parameters: { sourceBusId: 'lane:tools', tap: 'post-fader', inputLayout: 'audioStereo' } },
    { id: 'mono', kind: 'stereo-to-mono', parameters: {} }, { id: 'bank', kind: 'multiband-vocoder', parameters: { bands: 12, donorLayout: 'audioMono' } }, { id: 'output', kind: 'bus-out', parameters: {} }],
  edges: [edge('donor', 'audio', 'mono', 'audio'), edge('mono', 'audio', 'bank', 'donorAudio'), edge('source', 'audio', 'bank', 'carrierAudio'), edge('bank', 'audio', 'output', 'audio')] });

describe('simultaneous render donor binding (execution deferred)', () => {
  it('samples the declared donor slot independently of capture/export order', () => {
    const plan = prepareEffectGraphRevision(graph()), bindings = prepareEffectSourceBindings(plan, ['choir', 'tools']);
    const channels = [[new Float32Array([0.2]), new Float32Array([0.3])], [new Float32Array([0.7]), new Float32Array([-0.4])]];
    const sampler = createEffectSourceSampler(bindings, ['choir', 'tools'], channels); sampler.fill(0.9, 0.9, 0);
    expect(sampler.samples).to.deep.equal(new Float32Array([0.7, -0.4])); expect(sampler.present).to.deep.equal(new Uint8Array([1]));
    expect(bindings.faderPolicy).to.equal('new-realization-unity-owner-fader-pre-and-post-equivalent'); expect(validateEffectSourceBindings(plan, bindings)).to.deep.equal(bindings);
    expect(() => createEffectSourceSampler(bindings, ['choir'], [channels[0]])).to.throw('every declared donor');
    const wrong = structuredClone(bindings); wrong.routes[0].tap = 'pre-fader'; expect(() => validateEffectSourceBindings(plan, wrong)).to.throw('receipt');
  });
  it('marks missing source separately from a connected silent lane and feeds exact zero', async () => {
    const plan = prepareEffectGraphRevision(graph()), absent = prepareEffectSourceBindings(plan, ['choir']), silent = prepareEffectSourceBindings(plan, ['choir', 'tools']);
    const channels = [[new Float32Array(1), new Float32Array(1)]], missingSampler = createEffectSourceSampler(absent, ['tools'], channels), silentSampler = createEffectSourceSampler(silent, ['tools'], channels);
    const missingGraph = await createOwnedEffectGraphKernel({ definition: graph() }), silentGraph = await createOwnedEffectGraphKernel({ definition: graph() });
    missingGraph.sample(0.1, 0.1, missingSampler.fill(0.1, 0.1, 0), missingSampler.present); silentGraph.sample(0.1, 0.1, silentSampler.fill(0.1, 0.1, 0), silentSampler.present);
    expect(missingGraph.diagnostics().vocoderBanks[0].donorAvailable).to.equal(false); expect(silentGraph.diagnostics().vocoderBanks[0].donorAvailable).to.equal(true);
    expect(missingGraph.leftSample).to.equal(silentGraph.leftSample); expect(missingSampler.samples.every(value => value === 0)).to.equal(true);
  });
  it('makes stereo-to-mono conversion explicit and preserves linked-stereo behavior without it', async () => {
    const render = await createOwnedEffectGraphKernel({ definition: graph() }), donor = new Float32Array([1, -1]), present = new Uint8Array([1]);
    for (let i = 0; i < 512; i++) render.sample(0.2, -0.2, donor, present);
    expect(render.diagnostics().vocoderBanks[0].envelopePeak).to.equal(0);
    const implicit = graph(); implicit.nodes.find(node => node.id === 'donor').parameters.inputLayout = 'audioMono'; expect(() => prepareEffectGraphRevision(implicit)).to.throw('typed ports');
    const monoSource = graph(); monoSource.nodes = monoSource.nodes.filter(node => node.id !== 'mono'); monoSource.nodes.find(node => node.id === 'donor').parameters.inputLayout = 'audioMono';
    monoSource.edges = monoSource.edges.filter(value => value.from.nodeId !== 'mono' && value.to.nodeId !== 'mono'); monoSource.edges.push(edge('donor', 'audio', 'bank', 'donorAudio'));
    expect(() => prepareEffectSourceBindings(prepareEffectGraphRevision(monoSource), ['tools'])).to.throw('explicit stereo-to-mono');
  });
});
