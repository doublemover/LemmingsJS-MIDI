import { renderCausalOwnedTake } from '../../js/app/midi-ui/CausalOwnedRender.js';
import { createCausalMusicEngine } from '../../js/app/procgen/workstation/CausalMusicEngine.js';
import { sampleTravelGraph, sampleMotionBatch } from '../helpers/sampleTraversal.js';
import { expect } from 'chai';
import fs from 'node:fs/promises';
import { SpatialTextureKernel } from '../../js/app/midi-ui/worklet/SpatialTextureKernel.js';
import { OwnedTextureKernel } from '../../js/app/midi-ui/worklet/OwnedTextureProcessor.js';
import { prepareTextureExciter, textureSpatialHash } from '../../js/midi/content/TextureExciter.js';
import { planTextureTravel } from '../../js/midi/content/TextureTravel.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { renderOwnedSourceControls } from '../../js/app/midi-ui/OwnedSourceControlRender.js';
import { hashData } from '../../js/core/CanonicalData.js';
import { BEGIN, END, APPLIED, REJECTED, FAULTED, RECEIPT_WIDTH } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';

const profile = getOwnedSourceProfile('worklet-texture');
const parameters = kind => ({ ...Object.fromEntries(Object.entries(profile.fields).map(([key, value]) => [key, value[2]])), textureKind: kind, textureBodySeconds: kind === 3 ? 0.16 : 0.05 });
const command = (kind, motion = true) => {
  const p = parameters(kind), packet = new Float64Array(profile.width * 2), travel = { from: 0, to: motion ? 0.5 : 0, firstFrame: 0, endFrame: 6000 };
  Object.assign(packet, { 0: 1, 1: 0, 2: 1, 3: BEGIN, 4: 0, 5: 1, 6: 261.6255653005986, 7: 0.5, 8: 1, 9: 0, 10: 240, 11: 0, 12: 1, 13: 9600, 16: 40000, 17: 1, ...profile.beginFields(p, 12345, null, null, travel) });
  const at = profile.width; Object.assign(packet, { [at]: 1, [at + 1]: 10000, [at + 2]: 2, [at + 3]: END, [at + 4]: 0, [at + 5]: 1, [at + 13]: 9600, [at + 17]: 1 }); return packet;
};
const render = (kind, blockSize, motion = true) => {
  const kernel = new OwnedTextureKernel(48000, 1), pcm = new Float32Array(21000 * 2); kernel.accept(command(kind, motion), 2, 1);
  for (let first = 0; first < 21000; first += blockSize) { const count = Math.min(blockSize, 21000 - first), left = new Float32Array(count), right = new Float32Array(count); kernel.render(left, right, first); for (let frame = 0; frame < count; frame++) { pcm[(first + frame) * 2] = left[frame]; pcm[(first + frame) * 2 + 1] = right[frame]; } }
  return { pcm, kernel };
};

describe('owned spatial procedural textures (runtime and listening qualification deferred)', function() {
  this.timeout(30000);
  for (const kind of [0, 1, 2, 3]) it('is silent without movement and invariant to render-block partition for kind ' + kind, () => {
    const silent = render(kind, 128, false); expect(silent.pcm.every(value => value === 0)).to.equal(true);
    const baseline = render(kind, 128), other = render(kind, 17); expect(other.pcm).to.deep.equal(baseline.pcm); expect(baseline.pcm.some(value => value !== 0)).to.equal(true); expect(baseline.pcm.every(Number.isFinite)).to.equal(true);
    let begins = 0;
    for (let at = 0; at < baseline.kernel.receiptCount * RECEIPT_WIDTH; at += RECEIPT_WIDTH) { const code = baseline.kernel.receipts[at]; expect(code).not.to.equal(REJECTED); expect(code).not.to.equal(FAULTED); if (code === APPLIED && baseline.kernel.receipts[at + 1] === 1) begins++; }
    expect(begins).to.equal(1); expect(baseline.kernel.active.every(value => value === 0)).to.equal(true);
  });
  it('holds actual position at rest, keeps a positive decay tail and reverses within the same source state', () => {
    const kernel = new SpatialTextureKernel(48000); expect(kernel.begin(0, 123, 0.4, 0.5, 0.5, 0.05, 0, 64, 0, 6000)).to.equal(true);
    for (let frame = 0; frame < 6000; frame++) kernel.sample(frame); const births = kernel.state[24]; expect(births).to.be.greaterThan(0); expect(kernel.state[8]).to.equal(64);
    expect(kernel.setSpan(64, 64, 6000, 12000)).to.equal(true); let tail = 0;
    for (let frame = 6000; frame < 12000; frame++) { kernel.sample(frame); tail = Math.max(tail, Math.abs(kernel.leftSample)); }
    expect(tail).to.be.greaterThan(0); expect(kernel.state[24]).to.equal(births); expect(kernel.state[8]).to.equal(64);
    expect(kernel.setSpan(64, 0, 12000, 18000)).to.equal(true); for (let frame = 12000; frame < 18000; frame++) kernel.sample(frame);
    expect(kernel.state[24]).to.be.greaterThan(births); expect(kernel.state[8]).to.equal(0); expect(kernel.state[1]).to.equal(123);
    const before = kernel.state.slice(); expect(kernel.setSpan(900, 901, 18000, 20000)).to.equal(false); expect(kernel.state).to.deep.equal(before);
  });
  it('cancels a burst exactly at an end boundary before it can acquire an exciter tail', () => {
    const kernel = new SpatialTextureKernel(48000); kernel.begin(2, 123, 0.4, 0, 0.5, 0.05, 0, 8, 0, 6000); kernel.birth(0, 10, 100, 0.01, -0.01);
    for (let frame = 0; frame < 10; frame++) kernel.sample(frame); kernel.end(10); kernel.sample(10);
    expect(kernel.state[21]).to.equal(0); expect(kernel.leftSample).to.equal(0); expect(kernel.rightSample).to.equal(0);
  });
  it('keeps same-pitch source seeds independent and caps source-owned children across one absolute output bucket', () => {
    const admission = new Float64Array([-1, 0]), kernels = Array.from({ length: 8 }, (_, index) => new SpatialTextureKernel(48000, { admission }));
    for (let index = 0; index < kernels.length; index++) { expect(kernels[index].begin(2, index + 1, 0.4, 0.5, 0.5, 0.05, 0, 64, 0, 6000)).to.equal(true); for (let child = 0; child < 5; child++) kernels[index].birth(0, 0, 100, 0.01, -0.01); }
    expect(admission[1]).to.equal(32); expect(kernels.reduce((sum, kernel) => sum + kernel.state[25], 0)).to.equal(8);
    expect(textureSpatialHash(1, -3, 7)).to.equal(textureSpatialHash(1, -3, 7)); expect(textureSpatialHash(1, -3, 7)).not.to.equal(textureSpatialHash(2, -3, 7));
    const a = new SpatialTextureKernel(48000), b = new SpatialTextureKernel(48000); a.begin(1, 1, 0.4, 0.5, 0.5, 0.05, 0, 64, 0, 6000); b.begin(1, 2, 0.4, 0.5, 0.5, 0.05, 0, 64, 0, 6000);
    let difference = 0; for (let frame = 0; frame < 1000; frame++) { a.sample(frame); b.sample(frame); difference = Math.max(difference, Math.abs(a.leftSample - b.leftSample)); } expect(difference).to.be.greaterThan(0);
  });
  it('requires canonical source ownership and separates explicit control motion from physical evidence', () => {
    const p = parameters(0), travel = { schema: 'lemmings-canonical-travel-observation/v1', worldId: 'texture-world', generation: 1, actorId: 7, instrumentId: 'ribbon', lifetimeScope: 'actorJourney', scopeInstanceId: 'journey-7', orientation: 'signedX', metric: 'axis-projection', discontinuityEpoch: 0,
      from: { signedDistancePixels: 0 }, to: { signedDistancePixels: 8 }, timing: 'completed-tick-equal-segments-v1', completedTickDurationMs: 60, segmentCount: 1, segmentOrdinal: 0, sourceSequence: 1, sourceEventId: 'motion-7', precision: 'endpoint-chord' };
    const intent = { worldId: travel.worldId, generation: 1, actorId: 7, mappingId: 'ribbon', sourceEventIds: ['motion-7'], articulationState: { travel } }, planned = planTextureTravel(p, intent, 100, 48000);
    expect(planned.from).to.equal(0); expect(planned.to).to.equal(8 / 128); expect(planned.endFrame - planned.firstFrame).to.equal(2880); expect(planned.receipt.physicalTakeEvidence).to.equal(true); expect(planned.receipt.firstSignedPositionPixels).to.equal(0); expect(planned.receipt.endSignedPositionPixels).to.equal(8); expect(planned.receipt).not.to.have.property('firstPhaseCycles');
    expect(() => planTextureTravel(p, { ...intent, actorId: 8 }, 100, 48000)).to.throw(); expect(() => planTextureTravel(p, { ...intent, sourceEventIds: [] }, 100, 48000)).to.throw();
    expect(planTextureTravel(p, { controlFixture: true }, 100, 48000).receipt.physicalTakeEvidence).to.equal(false);
    expect(() => prepareTextureExciter({ kind: 'sand-drag', bodySeconds: 0.25 })).to.throw('authored domain'); expect(profile.restoration).to.equal('semanticResume');
    const kernel = new OwnedTextureKernel(48000, 1), before = kernel.source.state.slice(); expect(() => kernel.restoreFrom(new Uint8Array(1024))).to.throw('semanticResume'); expect(kernel.source.state).to.deep.equal(before);
  });
  it('compiles the four ordinary saved recipes and uses the same renderer for explicit motion/rest control WAVs', async () => {
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-texture', engineVersion: 1, artifactHash: 'a'.repeat(64) }]), raw = JSON.parse(await fs.readFile(new URL('../../content/sounds/procedural-textures.json', import.meta.url), 'utf8'));
    const compiled = await compileSoundContent(raw, { targets: [{ descriptor }] }); expect(compiled.prepared.patches).to.have.length(4); expect(descriptor.capabilities).to.include({ proceduralTextures: true, semanticResumeOnly: true, perVoicePitch: false });
    for (const patch of compiled.prepared.patches) { expect(patch.definition.sampleRefs).to.have.length(0); expect(patch.definition.macros.map(macro => macro.name)).to.deep.equal(['GRAIN', 'DRAG', 'SHADE', 'BODY']); }
    const patch = compiled.prepared.patches[0], source = { packId: compiled.prepared.pack.id, packVersion: compiled.prepared.pack.version, contentHash: compiled.prepared.contentHash, patchIdentity: patch.identity, definitionHash: await hashData(patch.definition), attribution: 'Original control fixture' };
    const rendered = await renderOwnedSourceControls({ definition: patch.definition, descriptor, source }, { yieldControl: async () => {} }); expect(rendered.manifest.statistics.peak).to.be.greaterThan(0); expect(rendered.manifest.physicalTakeEvidence).to.equal(false);
  });
  it('revoices actual canonical movement/rest/reversal as one source with texture-specific manifest evidence', async () => {
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-texture', engineVersion: 1, artifactHash: 'a'.repeat(64) }]), raw = JSON.parse(await fs.readFile(new URL('../../content/sounds/procedural-textures.json', import.meta.url), 'utf8'));
    const compiled = await compileSoundContent(raw, { targets: [{ descriptor }] }), engine = createCausalMusicEngine({ getGraph: () => sampleTravelGraph() });
    const intents = [sampleMotionBatch(1, 0, 8), sampleMotionBatch(2, 8, 16), sampleMotionBatch(3, 16, 16), sampleMotionBatch(4, 16, 8)].flatMap(batch => engine.processBatch(batch));
    const revoice = { operation: 'sound-only-revoice', version: 1, takeId: 'take:texture', takeRevision: 1, sourceCanonicalHash: 'c'.repeat(64), sourceState: 'finalized', nextSequence: null,
      sourceVersions: { physicalMusic: 9 }, coverage: { status: 'known-covered' }, boundary: { status: 'captured-initial-state', state: { voices: [], sourceTimeMs: 0 } }, finalBoundaryState: { sourceTimeMs: 500 }, intents };
    const result = await renderCausalOwnedTake({ definition: compiled.prepared.patches[0].definition, descriptor, revoice, sampleRate: 48000, startSeconds: 0, endSeconds: 0.3, tail: { mode: 'bounded-natural', maxSeconds: 1 } }, { yieldControl: async () => {} });
    expect(result.manifest.commands.capturedBegins).to.equal(1); expect(result.manifest.realization.textureTravel.voices).to.equal(1); expect(result.manifest.realization.textureTravel.segments).to.equal(intents.filter(intent => intent.articulationState?.travel).length);
    expect(result.manifest.realization.textureTravel.policy).to.include('no-pitch-cycle'); expect(result.manifest.realization.textureTravel.restoration).to.include('semanticResume'); expect(result.manifest.realization).not.to.have.property('circularTravel'); engine.dispose();
  });

});
