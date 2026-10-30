import { textureSpatialHash } from '../../js/midi/content/TextureExciter.js';
import { expect } from 'chai';
import { OwnedTextureKernel } from '../../js/app/midi-ui/worklet/OwnedTextureProcessor.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { ownedKernelStateBytes } from '../../js/app/midi-ui/worklet/OwnedSineState.js';
import { BEGIN, UPDATE, END } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';

const identity = Object.freeze({ engineArtifactHash: 'a'.repeat(64), patchDefinitionHash: 'b'.repeat(64), graphRevision: 4 }), profile = getOwnedSourceProfile('worklet-texture');
const create = (rate = 48000, kind = 2, external = false, seed = 12345) => {
  const kernel = new OwnedTextureKernel(rate, 2), parameters = { ...Object.fromEntries(Object.entries(profile.fields).map(([id, spec]) => [id, spec[2]])), textureKind: kind, textureBodySeconds: kind === 3 ? 0.16 : 0.05,
    ...(external ? { graftModeCount: 2, graftMix01: 0.7, graftT60Seconds: 0.8, graftMode0Ratio: 1, graftMode1Ratio: 2.17, graftMode0PickupA: 0.7, graftMode0PickupB: -0.7, graftMode1PickupA: 0.3, graftMode1PickupB: 0.3 } : {}) };
  const commands = new Float64Array(profile.width * 3), begin = commands.subarray(0, profile.width), update = commands.subarray(profile.width, profile.width * 2), end = commands.subarray(profile.width * 2);
  begin.set([1, 0, 1, BEGIN, 0, 1, 261.6255653005986, 0.5, 1, 0, 24, 0, 1, 2000, 0, 0, 22000, 7]); Object.assign(begin, profile.beginFields(parameters, seed, null, null, { from: 0, to: 16 / 128, firstFrame: 0, endFrame: 6000 }));
  update.set([1, 6000, 2, UPDATE, 0, 1]); Object.assign(update, { 15: 64, 17: 7, 25: 16 / 128, 26: 0, 27: 6000 });
  end.set([1, 14000, 3, END, 0, 1]); end[13] = 2000; end[17] = 7; kernel.accept(commands, 3, 1); return kernel;
};
const render = (kernel, count, block = 128) => {
  const output = new Float32Array(count * 2);
  for (let first = 0; first < count; first += block) { const n = Math.min(block, count - first), left = new Float32Array(n), right = new Float32Array(n); kernel.render(left, right, kernel.lastFrame); for (let i = 0; i < n; i++) { output[(first + i) * 2] = left[i]; output[(first + i) * 2 + 1] = right[i]; } }
  return output;
};
const cut = kernel => { const bytes = new Uint8Array(kernel.stateByteLength()), receipt = kernel.snapshotInto(bytes, identity); expect(receipt.qualification).to.equal('state-contract-awaiting-pcm-equivalence'); return bytes; };
const reseal = bytes => { let crc = 0xffffffff; for (let at = 0; at < bytes.length; at++) { crc ^= at >= 252 && at < 256 ? 0 : bytes[at]; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } new DataView(bytes.buffer).setUint32(252, (crc ^ 0xffffffff) >>> 0, true); return bytes; };

describe('owned texture source state cuts (PCM/browser qualification deferred)', () => {
  for (const rate of [44100, 48000, 96000]) for (const kind of [0, 1, 2, 3]) it('continues kind ' + kind + ' at ' + rate + ' with independent arrays and arbitrary render partitions', () => {
    const original = create(rate, kind); render(original, 255); const saved = cut(original), restored = new OwnedTextureKernel(rate, 2); restored.restoreFrom(saved, identity);
    expect(render(restored, 4096, 17)).to.deep.equal(render(original, 4096, 128));
    for (const field of ['state', 'modes', 'pulses', 'observation', 'admission']) { expect(restored.source[field]).to.deep.equal(original.source[field]); expect(restored.source[field].buffer).not.to.equal(original.source[field].buffer); }
    expect(restored.source.children[0].admission).to.equal(restored.source.admission); expect(restored.source.children[1].admission).to.equal(restored.source.admission);
  });
  for (const frame of [0, 6001, 14001, 16001]) it('retains queued begin/reverse/end and retired state at frame ' + frame, () => {
    const original = create(); render(original, frame); const restored = new OwnedTextureKernel(48000, 2); restored.restoreFrom(cut(original), identity); expect(render(restored, 1024, 31)).to.deep.equal(render(original, 1024));
  });
  for (const rate of [44100, 48000, 96000]) it('retains a signed private external body and its tail at ' + rate, () => {
    const original = create(rate, 0, true); render(original, 12001); expect(original.source.state[42]).to.equal(2); const restored = new OwnedTextureKernel(rate, 2); restored.restoreFrom(cut(original), identity);
    expect(render(restored, 4096, 19)).to.deep.equal(render(original, 4096)); expect(restored.source.state[47]).to.equal(original.source.state[47]);
  });
  it('retains future source-owned crackle offspring and the absolute-frame quota without another birth', () => {
    let seed = 1; while (seed < 64 && (textureSpatialHash(seed, 0, 1) >>> 16) % 4 === 0) seed++; expect(seed).to.be.lessThan(64);
    const original = create(48000, 2, false, seed); let pending = false;
    for (let frame = 0; frame < 6000 && !pending; frame++) { render(original, 1); const mask = original.source.state[21]; pending = Array.from({ length: 32 }, (_, slot) => slot).some(slot => (mask >>> slot & 1) && original.source.pulses[slot * 8] >= original.lastFrame); }
    expect(pending).to.equal(true); const births = original.source.state[24], quota = original.source.admission.slice(), restored = new OwnedTextureKernel(48000, 2); restored.restoreFrom(cut(original), identity);
    expect(restored.source.state[24]).to.equal(births); expect(restored.source.admission).to.deep.equal(quota); expect(render(restored, 2048)).to.deep.equal(render(original, 2048, 23));
  });
  it('rejects identity, checksum, quota, coefficient, gate and modal-arity corruption before mutating a live target', () => {
    const source = create(48000, 0, true); render(source, 255); const saved = cut(source), target = create(48000, 1); render(target, 33); const before = cut(target), stateOffset = 256 + ownedKernelStateBytes(source) + 16;
    const mutate = edit => { const bytes = saved.slice(), view = new DataView(bytes.buffer); edit(view); return reseal(bytes); };
    const quotaOffset = stateOffset + source.source.state.byteLength + source.source.modes.byteLength + source.source.pulses.byteLength + source.source.observation.byteLength;
    const cases = [mutate(view => view.setFloat64(stateOffset, 0, true)), mutate(view => view.setFloat64(stateOffset + 42 * 8, 9, true)), mutate(view => view.setFloat64(stateOffset + source.source.state.byteLength, 2, true)), mutate(view => view.setFloat64(quotaOffset + 8, 33, true))];
    for (const invalid of cases) { expect(() => target.restoreFrom(invalid, identity)).to.throw(); expect(cut(target)).to.deep.equal(before); }
    const corrupt = saved.slice(); corrupt[corrupt.length - 1] ^= 1; expect(() => target.restoreFrom(corrupt, identity)).to.throw('checksum'); expect(cut(target)).to.deep.equal(before);
    expect(() => target.restoreFrom(saved, { ...identity, patchDefinitionHash: 'c'.repeat(64) })).to.throw(); expect(cut(target)).to.deep.equal(before);
    expect(() => target.restoreFrom(new Uint8Array(target.source.state.buffer), identity)).to.throw(); expect(cut(target)).to.deep.equal(before);
  });
});
