import { expect } from 'chai';
import fs from 'node:fs/promises';
import { OwnedWindKernel } from '../../js/app/midi-ui/worklet/OwnedWindProcessor.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { ownedKernelStateBytes } from '../../js/app/midi-ui/worklet/OwnedSineState.js';
import { BEGIN, UPDATE, END, CANCEL, PANIC, REJECTED, FAULTED, RECEIPT_WIDTH } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { WIND_STATE as S } from '../../js/app/midi-ui/worklet/WindModalKernel.js';
import { windRandomAdvance, windRandomStep } from '../../js/midi/content/WindModel.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { renderOwnedSourceControls } from '../../js/app/midi-ui/OwnedSourceControlRender.js';
import { hashData } from '../../js/core/CanonicalData.js';

const profile = getOwnedSourceProfile('worklet-wind'), identity = { engineArtifactHash: 'a'.repeat(64), patchDefinitionHash: 'b'.repeat(64), graphRevision: 2 };
const parameters = kind => ({ ...Object.fromEntries(Object.entries(profile.fields).map(([id, spec]) => [id, spec[2]])), windKind: kind, airPressure01: kind === 1 ? 0.3 : 0.55 });
const create = (rate = 48000, kind = 0, pressure = 0.5) => {
  const kernel = new OwnedWindKernel(rate, 2), commands = new Float64Array(profile.width * 5), p = parameters(kind), begin = commands.subarray(0, profile.width);
  begin.set([1, 0, 1, BEGIN, 0, 1, kind === 1 ? 440 : 220, 0.5, pressure, 0, 24, 0, 1, 6000, 0, 0, 90000, 7]); Object.assign(begin, profile.beginFields(p, 12345));
  for (const [index, frame, pressure] of [[1, 3000, 1], [2, 7000, 0], [3, 10000, 1]]) { const command = commands.subarray(index * profile.width, (index + 1) * profile.width); command.set([1, frame, index + 1, UPDATE, 0, 1]); Object.assign(command, { 8: pressure, 14: 128, 15: 2, 17: 7 }); }
  const end = commands.subarray(profile.width * 4); end.set([1, 20000, 5, END, 0, 1]); end[13] = 6000; end[17] = 7; kernel.accept(commands, 5, 1); return { kernel, commands };
};
const render = (kernel, count, block = 128) => { const values = new Float32Array(count * 2); for (let at = 0; at < count; at += block) { const n = Math.min(block, count - at), left = new Float32Array(n), right = new Float32Array(n); kernel.render(left, right, kernel.lastFrame); for (let frame = 0; frame < n; frame++) { values[(at + frame) * 2] = left[frame]; values[(at + frame) * 2 + 1] = right[frame]; } } return values; };
const snapshot = kernel => { const bytes = new Uint8Array(kernel.stateByteLength()); kernel.snapshotInto(bytes, identity); return bytes; };
const reseal = bytes => { let crc = 0xffffffff; for (let at = 0; at < bytes.length; at++) { crc ^= at >= 252 && at < 256 ? 0 : bytes[at]; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } new DataView(bytes.buffer).setUint32(252, (crc ^ 0xffffffff) >>> 0, true); return bytes; };
describe('owned modal wind integration (runtime/browser/listening qualification deferred)', function() {
  this.timeout(60000);
  for (const rate of [44100, 48000, 96000]) for (const kind of [0, 1, 2]) it('retains independent exact source and queued pressure state at ' + rate + '/' + kind, () => {
    const original = create(rate, kind).kernel; render(original, 3500); const restored = new OwnedWindKernel(rate, 2); restored.restoreFrom(snapshot(original), identity); expect(render(restored, 4096, 23)).to.deep.equal(render(original, 4096)); expect(restored.source.state).to.deep.equal(original.source.state); expect(restored.source.modes).to.deep.equal(original.source.modes); expect(restored.source.state.buffer).not.to.equal(original.source.state.buffer); for (let at = 0; at < original.receiptCount * RECEIPT_WIDTH; at += RECEIPT_WIDTH) expect([REJECTED, FAULTED]).not.to.include(original.receipts[at]);
  });
  for (const frame of [0, 255, 8000, 15000, 22001, 30001]) it('cuts queued onset, active pressure/register, rest, release and retired source at ' + frame, () => { const original = create(48000, 2).kernel; render(original, frame); const restored = new OwnedWindKernel(48000, 2); restored.restoreFrom(snapshot(original), identity); expect(render(restored, 1024, 17)).to.deep.equal(render(original, 1024)); });
  it('jumps deterministic seeded noise in logarithmic time across the exact source age', () => { for (const seed of [1, 12345, 0xffffffff]) { let value = seed; for (let count = 0; count < 4096; count++) { if ([0, 1, 2, 31, 32, 1023, 4095].includes(count)) expect(windRandomAdvance(seed, count)).to.equal(value); value = windRandomStep(value); } expect(windRandomAdvance(seed, 2 ** 40 + 123)).to.equal(windRandomAdvance(windRandomAdvance(seed, 2 ** 40), 123)); } });
  it('rejects forged gate, noise age, positive loss, register bank, energy and reserved state before mutation', () => {
    const original = create(48000, 2).kernel; render(original, 3500); const bytes = snapshot(original), stateOffset = 256 + ownedKernelStateBytes(original) + 16, modeOffset = stateOffset + original.source.state.byteLength, target = create(48000, 1).kernel; render(target, 33); const before = snapshot(target);
    const corruptions = [view => view.setFloat64(stateOffset + S.energy * 8, 99, true), view => view.setFloat64(stateOffset + S.token * 8, 9, true), view => view.setFloat64(stateOffset + S.randomState * 8, 77, true), view => view.setFloat64(stateOffset + S.registerTransitions * 8, 2, true), view => view.setFloat64(stateOffset + S.controlPressure * 8, 0.123, true), view => view.setFloat64(stateOffset + 63 * 8, 1, true), view => view.setFloat64(modeOffset + 3 * 8, -1, true), view => view.setFloat64(modeOffset + 10 * 8, 100, true)];
    for (const corrupt of corruptions) { const bad = bytes.slice(); corrupt(new DataView(bad.buffer)); expect(() => target.restoreFrom(reseal(bad), identity)).to.throw(); expect(snapshot(target)).to.deep.equal(before); }
    const bad = bytes.slice(); bad[bad.length - 1] ^= 1; expect(() => target.restoreFrom(bad, identity)).to.throw('checksum'); expect(() => target.restoreFrom(bytes, { ...identity, engineArtifactHash: 'c'.repeat(64) })).to.throw(); expect(snapshot(target)).to.deep.equal(before);
  });
  it('keeps same-pitch expression independent and closes the existing cancel/Panic owners', () => {
    const { kernel, commands } = create(), second = commands.subarray(0, profile.width).slice(); second[2] = 10; second[4] = 1; second[5] = 2; second[8] = 0.2; second[18] = 77; kernel.accept(second, 1, 2); render(kernel, 256); expect(kernel.source.children[0].state[S.controlPressure]).to.equal(0.5); expect(kernel.source.children[1].state[S.controlPressure]).to.equal(0.2); expect(kernel.source.children[0].state[S.token]).to.equal(1); expect(kernel.source.children[1].state[S.token]).to.equal(2);
    const cancel = new Float64Array(profile.width); cancel.set([1, kernel.lastFrame, 11, CANCEL, -1, 0]); cancel[17] = 7; kernel.accept(cancel, 1, 3); render(kernel, 256); expect(kernel.active.every(value => value === 0)).to.equal(true); expect(kernel.source.state.every(value => value === 0)).to.equal(true);
    const other = create().kernel; render(other, 256); const panic = new Float64Array(profile.width); panic.set([1, other.lastFrame, 12, PANIC, -1, 0]); other.accept(panic, 1, 2); expect(render(other, 1).every(value => value === 0)).to.equal(true); expect(other.source.state.every(value => value === 0)).to.equal(true);
  });
  it('admits only the explicit acoustic-size/pitch region and rejects unimplemented live bend', () => { const p = parameters(2); expect(profile.acceptsOnset(p, 220)).to.equal(true); expect(profile.acceptsOnset(p, 660)).to.equal(false); expect(profile.acceptsOnset({ ...p, acousticLengthRatio: 0.75 }, 330)).to.equal(false); expect(profile.writeUpdate({ pitchOffsetCents: 100 }, {}, {})).to.equal(null); });
  it('compiles and control-renders three ordinary recipes without PCM or an external feedback graph', async () => {
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-wind', engineVersion: 1, artifactHash: 'a'.repeat(64) }]), compiled = await compileSoundContent(JSON.parse(await fs.readFile(new URL('../../content/sounds/wind-bodies.json', import.meta.url), 'utf8')), { targets: [{ descriptor }] }); expect(compiled.prepared.patches).to.have.length(3); expect(descriptor.capabilities).to.include({ sealedWindModel: true, pressureDrivenWind: true, livePitchUpdates: false });
    for (const patch of compiled.prepared.patches) { expect(patch.definition.sampleRefs).to.have.length(0); expect(patch.definition.macros.map(value => value.name)).to.deep.equal(['AIR', 'BITE', 'LENGTH', 'LEAK'].sort()); const source = { packId: compiled.prepared.pack.id, packVersion: compiled.prepared.pack.version, contentHash: compiled.prepared.contentHash, patchIdentity: patch.identity, definitionHash: await hashData(patch.definition), attribution: 'Original modal wind control fixture' }, result = await renderOwnedSourceControls({ definition: patch.definition, descriptor, source }, { yieldControl: async () => {} }); expect(result.manifest.statistics.peak).to.be.greaterThan(0); expect(result.manifest.physicalTakeEvidence).to.equal(false); }
  });
});
