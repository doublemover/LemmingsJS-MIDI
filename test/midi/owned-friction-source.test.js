import { expect } from 'chai';
import fs from 'node:fs/promises';
import { OwnedFrictionKernel } from '../../js/app/midi-ui/worklet/OwnedFrictionProcessor.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { ownedKernelStateBytes } from '../../js/app/midi-ui/worklet/OwnedSineState.js';
import { BEGIN, UPDATE, END, CANCEL, PANIC, APPLIED, REJECTED, FAULTED, RECEIPT_WIDTH } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { planFrictionTravel } from '../../js/midi/content/FrictionTravel.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { renderOwnedSourceControls } from '../../js/app/midi-ui/OwnedSourceControlRender.js';
import { renderCausalOwnedTake } from '../../js/app/midi-ui/CausalOwnedRender.js';
import { createCausalMusicEngine } from '../../js/app/procgen/workstation/CausalMusicEngine.js';
import { sampleTravelGraph, sampleMotionBatch } from '../helpers/sampleTraversal.js';
import { hashData } from '../../js/core/CanonicalData.js';

const profile = getOwnedSourceProfile('worklet-friction'), identity = { engineArtifactHash: 'a'.repeat(64), patchDefinitionHash: 'b'.repeat(64), graphRevision: 2 };
const parameters = kind => ({ ...Object.fromEntries(Object.entries(profile.fields).map(([id, spec]) => [id, spec[2]])), frictionKind: kind, frictionPressure01: [0.4, 0.25, 0.5][kind] });
const create = (rate = 48000, kind = 0, moving = true) => {
  const kernel = new OwnedFrictionKernel(rate, 2), count = Math.round(rate * 0.15), commands = new Float64Array(profile.width * 4), p = parameters(kind);
  const begin = commands.subarray(0, profile.width); begin.set([1, 0, 1, BEGIN, 0, 1, 220, 0.5, 1, 0, 24, 0, 1, 2000, 0, 0, count * 4, 7]); Object.assign(begin, profile.beginFields(p, 12345, null, null, { from: 0, to: moving ? 18 / 128 : 0, firstFrame: 0, endFrame: count }));
  const reverse = commands.subarray(profile.width, profile.width * 2); reverse.set([1, count, 2, UPDATE, 0, 1]); Object.assign(reverse, { 15: 64, 17: 7, 25: moving ? 18 / 128 : 0, 26: 0, 27: count });
  const pressure = commands.subarray(profile.width * 2, profile.width * 3); pressure.set([1, count + 10, 3, UPDATE, 0, 1]); Object.assign(pressure, { 8: 0.4, 14: 128, 15: 2, 17: 7 });
  const end = commands.subarray(profile.width * 3); end.set([1, count * 2 + 1000, 4, END, 0, 1]); end[13] = 2000; end[17] = 7;
  kernel.accept(commands, 4, 1); return { kernel, count, commands };
};
const render = (kernel, count, block = 128) => {
  const output = new Float32Array(count * 2);
  for (let at = 0; at < count; at += block) { const n = Math.min(block, count - at), a = new Float32Array(n), b = new Float32Array(n); kernel.render(a, b, kernel.lastFrame); for (let frame = 0; frame < n; frame++) { output[(at + frame) * 2] = a[frame]; output[(at + frame) * 2 + 1] = b[frame]; } }
  return output;
};
const snapshot = kernel => { const bytes = new Uint8Array(kernel.stateByteLength()); kernel.snapshotInto(bytes, identity); return bytes; };
const reseal = bytes => { let crc = 0xffffffff; for (let at = 0; at < bytes.length; at++) { crc ^= at >= 252 && at < 256 ? 0 : bytes[at]; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } new DataView(bytes.buffer).setUint32(252, (crc ^ 0xffffffff) >>> 0, true); return bytes; };

describe('owned bowed/friction source integration (runtime/browser/listening qualification deferred)', function() {
  this.timeout(60000);
  for (const rate of [44100, 48000, 96000]) for (const kind of [0, 1, 2]) it('retains exact source/gate/queue state with independent arrays at ' + rate + '/' + kind, () => {
    const original = create(rate, kind).kernel; render(original, 255); const bytes = snapshot(original), restored = new OwnedFrictionKernel(rate, 2); restored.restoreFrom(bytes, identity);
    expect(render(restored, 2048, 17)).to.deep.equal(render(original, 2048, 128)); expect(restored.source.state).to.deep.equal(original.source.state); expect(restored.source.modes).to.deep.equal(original.source.modes); expect(restored.source.state.buffer).not.to.equal(original.source.state.buffer); expect(restored.source.modes.buffer).not.to.equal(original.source.modes.buffer);
    for (let at = 0; at < original.receiptCount * RECEIPT_WIDTH; at += RECEIPT_WIDTH) expect([REJECTED, FAULTED]).not.to.include(original.receipts[at]);
  });
  for (const frame of [0, 7201, 14401, 15401, 18001]) it('retains queued onset, reversal, pressure, end and retired state at frame ' + frame, () => {
    const original = create().kernel; render(original, frame); const restored = new OwnedFrictionKernel(48000, 2); restored.restoreFrom(snapshot(original), identity); expect(render(restored, 1024, 23)).to.deep.equal(render(original, 1024));
  });
  it('has no attack without admitted motion and no additional semantic onset on reverse or rest', () => {
    const still = create(48000, 0, false).kernel; expect(render(still, 18000).every(value => value === 0)).to.equal(true);
    const moving = create().kernel, output = render(moving, 18000); expect(output.some(value => value !== 0)).to.equal(true); expect(output.every(Number.isFinite)).to.equal(true); expect(moving.active.every(value => value === 0)).to.equal(true);
    let begins = 0; for (let at = 0; at < moving.receiptCount * RECEIPT_WIDTH; at += RECEIPT_WIDTH) { expect([REJECTED, FAULTED]).not.to.include(moving.receipts[at]); if (moving.receipts[at] === APPLIED && moving.receipts[at + 1] === 1) begins++; } expect(begins).to.equal(1);
  });
  it('keeps two same-pitch actor bodies independent and ends them through the existing cancel/Panic owner', () => {
    const f = create(), kernel = f.kernel, second = f.commands.subarray(0, profile.width).slice(); second[2] = 10; second[4] = 1; second[5] = 2; second[18] = 77; second[37] *= -1; kernel.accept(second, 1, 2); render(kernel, 256);
    expect(kernel.source.children[0].state[36]).to.be.greaterThan(0); expect(kernel.source.children[1].state[36]).to.be.lessThan(0); expect(kernel.source.children[0].state[48]).to.equal(1); expect(kernel.source.children[1].state[48]).to.equal(2);
    const cancel = new Float64Array(profile.width); cancel.set([1, kernel.lastFrame, 11, CANCEL, -1, 0]); cancel[17] = 7; kernel.accept(cancel, 1, 3); render(kernel, 256); expect(kernel.active.every(value => value === 0)).to.equal(true); expect(kernel.source.state.every(value => value === 0)).to.equal(true);
    const other = create().kernel; render(other, 256); const panic = new Float64Array(profile.width); panic.set([1, other.lastFrame, 12, PANIC, -1, 0]); other.accept(panic, 1, 2); expect(render(other, 1).every(value => value === 0)).to.equal(true); expect(other.source.state.every(value => value === 0)).to.equal(true);
  });
  it('rejects forged positive-loss, energy, gate, cursor, pressure and reserved fields before target mutation', () => {
    const original = create().kernel; render(original, 255); const bytes = snapshot(original), stateOffset = 256 + ownedKernelStateBytes(original) + 16, modeOffset = stateOffset + original.source.state.byteLength;
    const target = create(48000, 1).kernel; render(target, 33); const before = snapshot(target), corruptions = [
      view => view.setFloat64(stateOffset + 17 * 8, 99, true), view => view.setFloat64(stateOffset + 48 * 8, 9, true), view => view.setFloat64(stateOffset + 33 * 8, 0.1, true), view => view.setFloat64(stateOffset + 8 * 8, 100, true), view => view.setFloat64(stateOffset + 55 * 8, 1, true), view => view.setFloat64(modeOffset + 3 * 8, -1, true), view => view.setFloat64(modeOffset + 5 * 8, 2, true)
    ];
    for (const corrupt of corruptions) { const bad = bytes.slice(); corrupt(new DataView(bad.buffer)); reseal(bad); expect(() => target.restoreFrom(bad, identity)).to.throw(); expect(snapshot(target)).to.deep.equal(before); }
    const checksum = bytes.slice(); checksum[checksum.length - 1] ^= 1; expect(() => target.restoreFrom(checksum, identity)).to.throw('checksum'); expect(snapshot(target)).to.deep.equal(before);
    expect(() => target.restoreFrom(bytes, { ...identity, engineArtifactHash: 'c'.repeat(64) })).to.throw(); expect(snapshot(target)).to.deep.equal(before); expect(() => target.restoreFrom(new Uint8Array(target.source.state.buffer), identity)).to.throw();
  });
  it('requires the exact canonical actor/scope/precision and retains friction-specific evidence', () => {
    const p = { ...parameters(0), frictionRequireSegments: 1 }, travel = { schema: 'lemmings-canonical-travel-observation/v1', worldId: 'bow-world', generation: 1, actorId: 7, instrumentId: 'bow', lifetimeScope: 'actorJourney', scopeInstanceId: 'journey-7', orientation: 'signedX', metric: 'axis-projection', discontinuityEpoch: 0, from: { signedDistancePixels: 0 }, to: { signedDistancePixels: 8 }, timing: 'completed-tick-equal-segments-v1', completedTickDurationMs: 60, segmentCount: 1, segmentOrdinal: 0, sourceSequence: 1, sourceEventId: 'motion-7', precision: 'committed-coordinate-write' };
    const intent = { worldId: travel.worldId, generation: 1, actorId: 7, mappingId: 'bow', sourceEventIds: ['motion-7'], articulationState: { travel } }, planned = planFrictionTravel(p, intent, 100, 48000);
    expect(planned.receipt.schema).to.equal('lemmings-friction-travel-receipt/v1'); expect(planned.receipt.physicalTakeEvidence).to.equal(true); expect(planned.receipt).not.to.have.property('firstPhaseCycles'); expect(planned.receipt.coordinateScale).to.include('not-acoustic-length');
    for (const bad of [{ ...intent, actorId: 8 }, { ...intent, sourceEventIds: [] }, { ...intent, articulationState: { travel: { ...travel, precision: 'endpoint-chord' } } }]) expect(() => planFrictionTravel(p, bad, 100, 48000)).to.throw();
    expect(planFrictionTravel(p, { controlFixture: true }, 100, 48000).receipt.physicalTakeEvidence).to.equal(false); expect(profile.writeUpdate({ pitchOffsetCents: 100 }, {}, {})).to.equal(null);
  });
  it('compiles three ordinary recipes and renders their explicit control movement/rest through the owned source', async () => {
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-friction', engineVersion: 1, artifactHash: 'a'.repeat(64) }]), raw = JSON.parse(await fs.readFile(new URL('../../content/sounds/friction-bodies.json', import.meta.url), 'utf8')), compiled = await compileSoundContent(raw, { targets: [{ descriptor }] });
    expect(compiled.prepared.patches).to.have.length(3); expect(descriptor.maximumVoices).to.equal(2); expect(descriptor.capabilities).to.include({ sealedFrictionModel: true, canonicalFrictionTravel: true, livePitchUpdates: false });
    for (const patch of compiled.prepared.patches) {
      expect(patch.definition.sampleRefs).to.have.length(0); expect(patch.definition.macros.map(macro => macro.name)).to.deep.equal(['DRAG', 'PRESS', 'EDGE', 'BODY']);
      const source = { packId: compiled.prepared.pack.id, packVersion: compiled.prepared.pack.version, contentHash: compiled.prepared.contentHash, patchIdentity: patch.identity, definitionHash: await hashData(patch.definition), attribution: 'Original friction control fixture' };
      const rendered = await renderOwnedSourceControls({ definition: patch.definition, descriptor, source }, { yieldControl: async () => {} }); expect(rendered.manifest.statistics.peak).to.be.greaterThan(0); expect(rendered.manifest.physicalTakeEvidence).to.equal(false);
    }
  });
  it('revoices committed movement, rest and reversal as one held source without a hidden onset', async () => {
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-friction', engineVersion: 1, artifactHash: 'a'.repeat(64) }]), raw = JSON.parse(await fs.readFile(new URL('../../content/sounds/friction-bodies.json', import.meta.url), 'utf8')), compiled = await compileSoundContent(raw, { targets: [{ descriptor }] }), engine = createCausalMusicEngine({ getGraph: () => sampleTravelGraph() });
    const batches = [[0, 8], [8, 16], [16, 16], [16, 8]].map(([from, to], index) => sampleMotionBatch(index + 1, from, to, { physicalPayload: { pathEvidence: 'committed-coordinate-write', contactObserved: false } })), intents = batches.flatMap(batch => engine.processBatch(batch));
    const revoice = { operation: 'sound-only-revoice', version: 1, takeId: 'take:friction', takeRevision: 1, sourceCanonicalHash: 'c'.repeat(64), sourceState: 'finalized', nextSequence: null, sourceVersions: { physicalMusic: 9 }, coverage: { status: 'known-covered' }, boundary: { status: 'captured-initial-state', state: { voices: [], sourceTimeMs: 0 } }, finalBoundaryState: { sourceTimeMs: 500 }, intents };
    const result = await renderCausalOwnedTake({ definition: compiled.prepared.patches[0].definition, descriptor, revoice, sampleRate: 48000, startSeconds: 0, endSeconds: 0.3, tail: { mode: 'bounded-natural', maxSeconds: 1 } }, { yieldControl: async () => {} });
    expect(result.manifest.commands.capturedBegins).to.equal(1); expect(result.manifest.realization.frictionTravel.voices).to.equal(1); expect(result.manifest.realization.frictionTravel.segments).to.equal(intents.filter(intent => intent.articulationState?.travel).length); expect(result.manifest.realization).not.to.have.property('circularTravel'); engine.dispose();
  });
});
