import { expect } from 'chai';
import { seedLayerDefinition, seedLayerPCM } from '../helpers/seedLayers.js';
import { validateSeedLayerProfile } from '../../js/midi/content/SeedLayerProfile.js';
import { prepareSeedLayerPlan } from '../../js/app/midi-ui/SeedLayerPlan.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { OwnedSeedLayerKernel } from '../../js/app/midi-ui/worklet/OwnedSeedLayerProcessor.js';
import { BEGIN, UPDATE, END, APPLIED, ENDED, REJECTED, FAULTED } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { computeOwnedSourceBank } from '../../js/app/resources/OwnedSourceBankComputation.js';

const identity = { engineArtifactHash: '1'.repeat(64), patchDefinitionHash: '2'.repeat(64), graphRevision: 1 };
const row = (opcode, frame, sequence, parameters, pcm, values = {}) => Object.assign(new Array(56).fill(0), { 0: 1, 1: frame, 2: sequence, 3: opcode, 4: 0, 5: 1, 17: 1,
  ...(opcode === BEGIN ? { 6: 440, 7: 0.8, 8: 1, 12: 1, 13: 480, 16: 96000, ...getOwnedSourceProfile('worklet-seed-layers').beginFields(parameters, 42, pcm) } : {}) }, values);
const submit = (kernel, rows) => kernel.accept(Float64Array.from(rows.flat()), rows.length);
const render = (kernel, frames) => { const left = new Float32Array(frames), right = new Float32Array(frames); kernel.render(left, right, kernel.lastFrame); return [left, right]; };
const receipts = kernel => Array.from({ length: kernel.receiptCount }, (_, index) => Array.from(kernel.receipts.subarray(index * 6, index * 6 + 6)));

describe('aligned seed composite source (authored runtime qualification deferred)', () => {
  let pcm, sampleBank, grainBank;
  before(async () => {
    pcm = await seedLayerPCM(); sampleBank = await computeOwnedSourceBank('sample-read-v1', { yieldControl: async () => {} }); grainBank = await computeOwnedSourceBank('grain-window-v1', { yieldControl: async () => {} });
  });
  const create = (family = 'hammer-cloud', rate = 48000, patch = seedLayerDefinition(family), material = pcm) => new OwnedSeedLayerKernel(rate, material, patch, 2, sampleBank, { 'grain-window-v1': grainBank });
  it('privately copies the plan descriptor, pins both banks and never uses the original as playback material', () => {
    const patch = seedLayerDefinition(), mutable = structuredClone(pcm.descriptor), plan = prepareSeedLayerPlan(patch, mutable, 48000);
    expect(Object.isFrozen(mutable)).to.equal(false); expect(plan.descriptor).not.to.equal(mutable); expect(plan.descriptor).to.deep.equal(mutable);
    expect(plan.footprint).to.include({ semanticSources: 2, childrenPerSource: 3, completePcmBytes: 57600, pcmCopiesPerRenderer: 1, parentBackingLayers: 0 }); expect(plan.sourceBanks.map(bank => bank.id)).to.deep.equal(['sample-read-v1', 'grain-window-v1']);
    patch.sampleRefs[0].sha256 = patch.seedLayers.parentAssetHash; expect(() => prepareSeedLayerPlan(patch, mutable, 48000)).to.throw('complete source inventory');
  });
  it('rejects mismatched reconstruction, component coordinates and undeclared contact lifetimes before admission', () => {
    for (const change of [patch => { patch.seedLayers.reconstruction.maximumAbsoluteError = 0.01; }, patch => { patch.seedLayers.components[1].sourceFrames++; }, patch => { patch.seedLayers.bodyFit = seedLayerDefinition('hollow-tool').seedLayers.bodyFit; }]) {
      const patch = seedLayerDefinition(); change(patch); expect(() => validateSeedLayerProfile(patch.seedLayers, patch.sampleRefs)).to.throw();
    }
    const broken = { ...pcm, banks: pcm.banks.map((bank, index) => index ? bank : { ...bank, planes: [bank.planes[0], bank.planes[0]] }) }; expect(() => create('hammer-cloud', 48000, seedLayerDefinition(), broken)).to.throw('Private component');
    expect(() => new OwnedSeedLayerKernel(48000, pcm, seedLayerDefinition(), 2, sampleBank)).to.throw('Invalid fixed source bank');
  });
  for (const family of ['hammer-cloud', 'hollow-tool']) for (const rate of [44100, 48000, 96000]) it('keeps one semantic onset and independently resumes all ' + family + ' children at ' + rate, () => {
    const patch = seedLayerDefinition(family), kernel = create(family, rate, patch);
    submit(kernel, [row(BEGIN, 0, 1, patch.parameters, pcm.descriptor), row(UPDATE, 160, 2, patch.parameters, pcm.descriptor, { 15: 16 | 64, 14: 512, 20: 24, 23: 0.1 }), row(END, 512, 3, patch.parameters, pcm.descriptor, { 13: 480 })]);
    const first = render(kernel, 800), bytes = new Uint8Array(kernel.stateByteLength()); kernel.snapshotInto(bytes, identity);
    const resumed = create(family, rate, patch); resumed.restoreFrom(bytes, identity);
    for (const key of ['state', 'cloudState', 'grains']) expect(resumed.source[key].buffer).not.to.equal(kernel.source[key].buffer);
    expect(render(resumed, 1800)).to.deep.equal(render(kernel, 1800)); expect(receipts(resumed)).to.deep.equal(receipts(kernel));
    const facts = receipts(kernel); expect(facts.filter(receipt => receipt[0] === REJECTED || receipt[0] === FAULTED)).to.have.length(0); expect(facts.filter(receipt => receipt[0] === APPLIED && receipt[1] === 1)).to.have.length(1); expect(facts.filter(receipt => receipt[0] === ENDED)).to.have.length(1);
    expect(first[0].some(value => value !== 0)).to.equal(true); expect(first.flatMap(channel => [...channel]).every(Number.isFinite)).to.equal(true);
  });
  it('force-closes every child, cancels future controls, and does not revive the source after its finite material end', () => {
    const patch = seedLayerDefinition(), kernel = create(); submit(kernel, [row(BEGIN, 0, 1, patch.parameters, pcm.descriptor), row(END, 256, 2, patch.parameters, pcm.descriptor, { 13: 64, 20: 1 }), row(UPDATE, 512, 3, patch.parameters, pcm.descriptor, { 15: 16, 20: 48, 14: 512 })]);
    render(kernel, 1024); expect(kernel.active[0]).to.equal(0); expect(kernel.source.cloudState.every(value => value === 0)).to.equal(true); expect(kernel.source.grains.every(value => value === 0)).to.equal(true); expect(render(kernel, 128)[0].every(value => value === 0)).to.equal(true);
    const natural = create(); submit(natural, [row(BEGIN, 0, 1, patch.parameters, pcm.descriptor)]); render(natural, 4000); expect(natural.active[0]).to.equal(0); expect(render(natural, 128)[0].every(value => value === 0)).to.equal(true);
  });
  it('rejects a state cut from a different residual loss or modal-fit recipe without mutating the target', () => {
    const patch = seedLayerDefinition(), kernel = create(); submit(kernel, [row(BEGIN, 0, 1, patch.parameters, pcm.descriptor)]); render(kernel, 128); const bytes = new Uint8Array(kernel.stateByteLength()); kernel.snapshotInto(bytes, identity);
    const otherPatch = seedLayerDefinition(); otherPatch.parameters.residualT60Seconds = 0.1; const other = create('hammer-cloud', 48000, otherPatch); expect(() => other.restoreFrom(bytes, identity)).to.throw('different exact prepared map'); expect(other.active.every(value => value === 0)).to.equal(true);
  });
});
