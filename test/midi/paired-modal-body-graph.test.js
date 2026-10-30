import { expect } from 'chai';
import fs from 'node:fs/promises';
import { createResonatorMorphMap } from '../../js/midi/content/ResonatorMorph.js';
import { createResonatorMorphGraph } from '../../js/midi/content/ResonatorMorphGraph.js';
import { preparePairedModalBodyProfile, verifyPairedModalBodyProfile, pairedModalBodyIdentity } from '../../js/midi/content/PairedModalBodyProfile.js';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';
import { PairedModalBodyKernel } from '../../js/app/midi-ui/worklet/PairedModalBodyKernel.js';
import { createTravelEffectMotion } from '../../js/app/procgen/workstation/TravelEffectMotion.js';
import { travelColorationValue } from '../../js/midi/content/TravelColorationRecipes.js';

const fixture = async (rate = 48000, policy = 'paired-synthetic-held') => { const { input } = JSON.parse(await fs.readFile(new URL('../../content/morphs/dry-bright-proof.json', import.meta.url), 'utf8')), map = await createResonatorMorphMap({ a: input.a, b: input.b, pairs: input.anchors, siteCorrespondence: input.siteCorrespondence, reviewed: true, transitionPolicy: policy }); return createResonatorMorphGraph({ map, a: input.a, b: input.b }, rate); };
const failure = async operation => { try { await operation(); } catch (caught) { return caught; } throw new Error('Expected refusal.'); };

describe('canonical paired modal body graph (live/device qualification deferred)', function() {
  this.timeout(60000);
  for (const rate of [44100, 48000, 96000]) it('reconstructs bounded profiles and renders one shared body at ' + rate, async () => {
    const model = await fixture(rate), plan = prepareEffectGraphRevision(model.graph, { sampleRate: rate }), entry = plan.nodes.find(node => node.pairedBody), profile = entry.pairedBody;
    expect(await verifyPairedModalBodyProfile(profile)).to.equal(profile); expect(profile.body.slots).to.have.length(6); expect(plan.processingCost.pairedModesPerFrame).to.equal(6); expect(plan.maximumTailFrames).to.equal(Math.ceil(4.2 * rate)); expect(profile.stateBytes).to.be.greaterThan((16 + 6 * 7) * 8); expect(pairedModalBodyIdentity(profile)).to.include(model.mapHash);
    const graph = await createOwnedEffectGraphKernel({ definition: model.graph, sampleRate: rate, returnNodeIds: ['morph-body'] }), direct = new PairedModalBodyKernel({ sampleRate: rate, parameters: entry.parameters });
    for (let frame = 0; frame < 4096; frame++) { const u = (Math.sin(frame / 111) + 1) * 0.5, x = Math.fround(frame < 128 ? Math.sin(frame / 9) * 0.2 : 0), y = Math.fround(frame >= 320 && frame < 448 ? Math.sin(frame / 7) * 0.1 : 0); graph.update('morph-body', { morph01: u }); graph.sample(x, y); direct.sample(x, y, u); expect(graph.tapSamples[0]).to.equal(Math.fround(direct.leftSample)); expect(graph.tapSamples[1]).to.equal(Math.fround(direct.rightSample)); }
    expect(graph.diagnostics().pairedBodyStates[0]).to.include({ faults: 0, semanticOnsetsAdded: 0, muted: false }); expect(direct.diagnostics().energy).to.be.greaterThan(0); graph.panic(); graph.sample(0, 0); expect(graph.leftSample).to.equal(0);
  });
  it('does not accept stale endpoints, a forged profile identity or a silent policy upgrade', async () => {
    const model = await fixture(), graph = JSON.parse(JSON.stringify(model.graph)), parameters = graph.nodes.find(node => node.kind === 'paired-modal-body').parameters;
    parameters.a.modes[0].frequencyHz++; expect((await failure(() => createOwnedEffectGraphKernel({ definition: graph }))).code).to.equal('invalid-resonator-morph'); parameters.a.modes[0].frequencyHz--; parameters.profileIdentity = '0'.repeat(64); expect((await failure(() => createOwnedEffectGraphKernel({ definition: graph }))).code).to.equal('invalid-paired-modal-body');
    expect((await failure(() => fixture(48000, 'next-onset-only'))).message).to.include('paired-held'); expect(await fixture(48000, 'prepared-dual-body-blend')).to.include({ bodyCount: 2, strategy: 'prepared-endpoint-audio-blend' });
    parameters.profileIdentity = model.profileIdentity; parameters.inputGain01 = 1.01; expect(() => preparePairedModalBodyProfile(parameters)).to.throw('bounded MORPH');
  });
  it('adds no work without source audio, preserves signed cancellation and contains a bad body alone', async () => {
    const model = await fixture(), parameters = model.graph.nodes.find(node => node.kind === 'paired-modal-body').parameters, rest = new PairedModalBodyKernel({ parameters });
    for (let frame = 0; frame < 3000; frame++) rest.sample(0.4, -0.4, (frame % 101) / 100); expect(rest.diagnostics()).to.include({ inputWork: 0, energy: 0, faults: 0 });
    rest.sample(NaN, 0, 0); expect(rest.diagnostics()).to.include({ muted: true, faults: 1, energy: 0 }); rest.sample(0.5, 0.5, 1); expect(rest.leftSample).to.equal(0);
    const graph = await createOwnedEffectGraphKernel({ definition: model.graph }); expect(() => graph.update('morph-body', { morph01: 1.1 })).to.throw('normalized'); graph.sample(0.1, 0.1); expect(graph.leftSample).not.to.equal(0); expect(graph.diagnostics().muted).to.equal(false);
  });
  it('uses committed signed travel with endpoint clamping and no synthetic source or wall clock', async () => {
    const model = await fixture(), values = [], intents = [0, 128, 256, 512, 128, 0].map((distance, index) => ({ kind: 'update', voiceId: 'actor-7', generation: 2, mappingId: 'route', scoreTime: index * 10, intentId: 'intent-' + index, sourceEventIds: ['motion-' + index], articulationState: { signedDistancePixels: distance } })), before = JSON.stringify(intents), owner = createTravelEffectMotion({ update: (nodeId, value, frame, expected, cause) => { values.push({ nodeId, value, frame, expected, cause }); return expected; }, bypass() {}, toFrame: time => time * 48 });
    owner.bind({ voiceId: 'actor-7', generation: 2, instrumentId: 'route', control: model.control, expected: { graphDefinitionHash: 'a'.repeat(64), ownerRouteRevision: 3 } }); owner.consume(intents, 'epoch'); expect(values.map(value => value.value.morph01)).to.deep.equal([0, 0.5, 1, 0.5, 0]); expect(values[1].cause.sourceEventIds).to.deep.equal(['motion-1']); expect(JSON.stringify(intents)).to.equal(before); expect(travelColorationValue(model.control, -50)).to.equal(0); expect(travelColorationValue(model.control, 1000)).to.equal(1); owner.consume([{ ...intents[0], kind: 'end' }], 'epoch'); expect(owner.state().active).to.equal(null); owner.dispose();
  });
});
