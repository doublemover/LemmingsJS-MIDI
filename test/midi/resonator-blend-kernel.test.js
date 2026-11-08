import { createResonatorMorphGraph } from '../../js/midi/content/ResonatorMorphGraph.js';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';
import { PairedModalBodyKernel } from '../../js/app/midi-ui/worklet/PairedModalBodyKernel.js';
import { expect } from 'chai';
import { createOriginalResonatorMorphProof } from '../../js/midi/content/OriginalResonatorMorphProof.js';
import { createResonatorMorphMap } from '../../js/midi/content/ResonatorMorph.js';
import { prepareResonatorBlendKernelProfile, inspectResonatorBlendKernelProfile, verifyResonatorBlendKernelProfile } from '../../js/midi/content/ResonatorBlendProfile.js';
import { ResonatorBlendKernel } from '../../js/app/midi-ui/worklet/ResonatorBlendKernel.js';
import { renderResonatorMorphReference } from '../../js/app/resources/ResonatorMorphReference.js';

const fixture = async (rate = 48000, policy = 'prepared-dual-body-blend') => { const { a, b, map: original } = await createOriginalResonatorMorphProof(), map = await createResonatorMorphMap({ a, b, pairs: original.pairs, siteCorrespondence: original.siteCorrespondence, reviewed: true, transitionPolicy: policy }); return { a, b, map, profile: policy === 'prepared-dual-body-blend' ? await prepareResonatorBlendKernelProfile(map, a, b, rate) : null }; };
const refusal = async operation => { try { await operation(); } catch (caught) { return caught; } throw new Error('Expected refusal.'); };

describe('prepared endpoint audio blend (runtime/device/listening qualification deferred)', function() {
  this.timeout(60000);
  for (const rate of [44100, 48000, 96000]) it('owns both fixed endpoint states and preserves their tails under readout reversals at ' + rate, async () => {
    const f = await fixture(rate), profile = f.profile; expect(profile.bodyCount).to.equal(2); expect(profile.slots).to.have.length(10); expect(await verifyResonatorBlendKernelProfile(profile)).to.equal(profile); const blend = new ResonatorBlendKernel(profile);
    for (let frame = 0; frame < 4096; frame++) { const u = frame < 128 ? 0 : (Math.sin(frame / 33) + 1) * 0.5, input = frame < 128 ? 0.25 * Math.sin(Math.PI * frame / 127) ** 2 : 0; blend.sample(input, frame, u); const b = u === 0 ? 0 : u === 1 ? 1 : Math.sin(Math.PI * u * 0.5) ** 2; expect(blend.leftSample).to.equal((1 - b) * blend.a.leftSample + b * blend.b.leftSample); expect(blend.a.state[1]).to.equal(0); expect(blend.b.state[1]).to.equal(0); }
    const before = blend.diagnostics(); expect(before).to.include({ bodyCount: 2, semanticOnsetsAdded: 0, faults: 0 }); expect(before.endpointA.energy).to.be.greaterThan(0); expect(before.endpointB.energy).to.be.greaterThan(0); expect(Math.abs(before.energy + before.positiveLoss - before.inputWork)).to.be.lessThan(1e-9 * (1 + before.inputWork)); blend.sample(0, 4096, 1); expect(blend.leftSample).to.equal(blend.b.leftSample); expect(blend.diagnostics().inputWork).to.equal(before.inputWork); blend.sample(0, 4097, 0); expect(blend.leftSample).to.equal(blend.a.leftSample); blend.panic(); expect(blend.a.state[2]).to.equal(0); expect(blend.b.state[2]).to.equal(0); blend.sample(0, 4098, 0.5); expect(blend.leftSample).to.equal(0);
  });
  for (const rate of [44100, 48000, 96000]) it('counts both live graph endpoints and matches its owned adapter at ' + rate, async () => {
    const f = await fixture(rate), model = await createResonatorMorphGraph(f, rate), plan = prepareEffectGraphRevision(model.graph, { sampleRate: rate }), entry = plan.nodes.find(node => node.blendBody), graph = await createOwnedEffectGraphKernel({ definition: model.graph, sampleRate: rate, returnNodeIds: ['morph-body'] }), direct = new PairedModalBodyKernel({ sampleRate: rate, parameters: entry.parameters, strategy: 'blend' }); expect(model.bodyCount).to.equal(2); expect(plan.processingCost).to.include({ preparedResonatorBodies: 2, blendModesPerFrame: 10, pairedModesPerFrame: 0 }); expect(entry.blendBody.stateBytes).to.be.greaterThan((48 + 10 * 7) * 8);
    for (let frame = 0; frame < 1024; frame++) { const u = (frame % 101) / 100, input = Math.fround(frame < 128 ? 0.2 * Math.sin(frame / 9) : 0); graph.update('morph-body', { morph01: u }); graph.sample(input, input); direct.sample(input, input, u); expect(graph.tapSamples[0]).to.equal(Math.fround(direct.leftSample)); expect(graph.tapSamples[1]).to.equal(Math.fround(direct.rightSample)); }
    expect(graph.diagnostics().blendBodyStates[0]).to.include({ bodyCount: 2, faults: 0 }); expect(() => prepareEffectGraphRevision(model.graph, { sampleRate: rate, maxStateBytes: plan.stateBytes - 1 })).to.throw('storage'); const forged = JSON.parse(JSON.stringify(model.graph)); forged.nodes.find(node => node.kind === 'resonator-blend-body').parameters.profile.identity = '0'.repeat(64); expect(await refusal(() => createOwnedEffectGraphKernel({ definition: forged, sampleRate: rate }))).to.be.instanceOf(Error); graph.sample(0, 0); expect(graph.diagnostics().muted).to.equal(false); graph.panic(); graph.sample(0, 0); expect(graph.leftSample).to.equal(0);
  });
  it('refuses an oversized endpoint without replacing an already prepared blend', async () => {
    const f = await fixture(), b = JSON.parse(JSON.stringify(f.b)); b.revision++; for (let index = 0; index < 3; index++) b.modes.push({ id: 'extra-' + index, frequencyHz: 3000 + index * 100, t60Seconds: 0.1, excitation: 0, pickupLeft: 0, pickupRight: 0 }); const map = await createResonatorMorphMap({ a: f.a, b, pairs: f.map.pairs, siteCorrespondence: f.map.siteCorrespondence, reviewed: true, transitionPolicy: 'prepared-dual-body-blend' }); expect(await refusal(() => prepareResonatorBlendKernelProfile(map, f.a, b))).to.be.instanceOf(Error); expect(f.profile.slots).to.have.length(10); expect(await verifyResonatorBlendKernelProfile(f.profile)).to.equal(f.profile);
  });
  it('does not create energy by blending silent bodies or upgrade another map policy', async () => {
    const f = await fixture(), body = new ResonatorBlendKernel(f.profile); for (let frame = 0; frame < 2048; frame++) body.sample(0, frame, (frame % 101) / 100); expect(body.state[2]).to.equal(0); expect(body.state[3]).to.equal(0); const onset = await fixture(48000, 'next-onset-only'); expect((await refusal(() => prepareResonatorBlendKernelProfile(onset.map, onset.a, onset.b))).message).to.include('explicit prepared blend');
    const forged = JSON.parse(JSON.stringify(f.profile)); forged.bodyA.slots[0].frequencyA++; expect(() => inspectResonatorBlendKernelProfile(forged)).to.throw('exact bounded endpoint');
    const stale = JSON.parse(JSON.stringify(f.profile)); stale.a.modes[0].frequencyHz++; expect(await refusal(() => verifyResonatorBlendKernelProfile(stale))).to.be.instanceOf(Error);
  });
  it('renders a labeled bounded two-body control WAV without semantic or acoustic evidence', async () => {
    const f = await fixture(), result = await renderResonatorMorphReference({ a: f.a, b: f.b, map: f.map, sampleRate: 48000, program: 'held-out-and-back-v1' }, { yieldControl: async () => {} }); expect(result.manifest).to.include({ bodyCount: 2, acousticQualification: false, physicalTakeEvidence: false, semanticIntentReplay: false }); expect(result.manifest.body).to.include({ bodyCount: 2, modes: 10, faults: 0, semanticOnsetsAdded: 0 }); expect(result.manifest.rendererRevision).to.equal(f.profile.revision); expect(result.manifest.statistics.peak).to.be.greaterThan(0); expect(result.bytes.byteLength).to.be.lessThan(3 * 1048576);
  });
});
