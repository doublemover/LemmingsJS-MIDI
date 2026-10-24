import { expect } from 'chai';
import { createQuarryEcho, createQuarryTapeSpring, validateOwnerEffectRack } from '../../js/midi/content/DubQuarryRack.js';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';
import { createProcgenWorkstationProject, reduceCanonicalProcgenProject, sanitizeProcgenWorkstation } from '../../js/app/procgen/workstation/ProcgenWorkstationProject.js';

describe('original Quarry Echo defaults and project ownership (deferred)', () => {
  it('authors a shared original Tape + Spring with one nonlinear preamp, one delay, one body and a combined return', () => {
    const graph = createQuarryTapeSpring({ send01: 0.3, springBlend01: 0.15 });
    expect(graph.edges.find(edge => edge.to.nodeId === 'spring').gain01).to.equal(1 / graph.nodes.find(node => node.id === 'spring').impulse.maximumLinearGain);
    expect(graph.id).to.equal('dub-quarry.tape-spring'); expect(graph.latencyPolicy).to.equal('uncompensated-native');
    expect(graph.nodes.filter(node => node.kind === 'nonlinear-chain')).to.have.length(1);
    expect(graph.nodes.filter(node => node.kind === 'feedback-delay')).to.have.length(1);
    expect(graph.nodes.filter(node => node.kind === 'convolution-native')).to.have.length(1);
    expect(graph.edges.filter(edge => edge.to.nodeId === 'wet-sum').map(edge => edge.gain01).sort()).to.deep.equal([0.15, 0.85]);
    expect(() => createQuarryTapeSpring({ springBlend01: 0.31 })).to.throw('spring blend');
  });
  it('keeps dry, source send and wet return independent within declared worst-case headroom', () => {
    const graph = createQuarryEcho(), plan = prepareEffectGraphRevision(graph), get = id => graph.nodes.find(node => node.id === id);
    expect(get('dry').parameters).to.include({ gain01: 1, gainMaximum01: 1 }); expect(get('send').parameters.gain01).to.equal(0);
    expect(get('return').parameters.gain01).to.equal(0.2); expect(get('echo').parameters.wet01).to.equal(1);
    expect(plan.maximumGraphGainBound).to.be.lessThan(3); expect(plan.maximumTailFrames).to.be.at.most(30 * 48000);
    expect(graph.edges.some(edge => edge.from.nodeId === 'echo' && edge.to.nodeId === 'send')).to.equal(false);
  });
  it('roundtrips bounded saved defaults without changing physical mapping, lane or source identities', () => {
    const project = createProcgenWorkstationProject({}), graph = createQuarryEcho(), rack = validateOwnerEffectRack({ schema: 'lemmings-owner-effect-rack/v1', graph, bypass: 'active' });
    const next = reduceCanonicalProcgenProject(project, { type: 'procgen/effectRack', rack });
    expect(next.procgen.physicalGraph).to.equal(project.procgen.physicalGraph); expect(next.procgen.lanes).to.equal(project.procgen.lanes);
    const restored = sanitizeProcgenWorkstation(JSON.parse(JSON.stringify(next.procgen))); expect(restored.effectRack).to.deep.equal(rack);
    expect(reduceCanonicalProcgenProject(next, { type: 'procgen/effectRack', rack })).to.equal(next);
    expect(() => reduceCanonicalProcgenProject(next, { type: 'procgen/effectRack', rack: { ...rack, graph: createQuarryEcho({ delaySeconds: 0.5 }) } })).to.throw('newer graph revision');
    const removed = reduceCanonicalProcgenProject(next, { type: 'procgen/effectRack', rack: null }); expect(removed.procgen.effectRack).to.equal(undefined);
  });
  it('rejects invalid sends, feedback, graph cycles and bypass states before saving defaults', () => {
    expect(() => createQuarryEcho({ send01: 0.7 })).to.throw(); expect(() => createQuarryEcho({ feedback: 0.71 })).to.throw();
    expect(() => validateOwnerEffectRack({ schema: 'lemmings-owner-effect-rack/v1', graph: createQuarryEcho(), bypass: 'unknown' })).to.throw();
  });
});
