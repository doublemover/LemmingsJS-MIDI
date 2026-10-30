import { expect } from 'chai';
import { OwnedSineKernel, WIDTH, BEGIN, UPDATE, END } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { SINE_STATE_BYTES, SINE_STATE_ABI } from '../../js/app/midi-ui/worklet/OwnedSineState.js';

const identity = Object.freeze({ engineArtifactHash: 'a'.repeat(64), patchDefinitionHash: 'b'.repeat(64), graphRevision: 7 });
const command = (rate, opcode, frame, sequence, fields = {}) => {
  const value = new Array(WIDTH).fill(0); Object.assign(value, { 0: 1, 1: frame, 2: sequence, 3: opcode, 4: 0, 5: 1, 6: 440, 7: 0.5,
    8: 0.75, 9: 0.1, 10: Math.round(rate * 0.01), 11: Math.round(rate * 0.03), 12: 0.6, 13: Math.round(rate * 0.02), 16: rate * 2, 17: 1 }, fields); return value;
};
const render = (kernel, count) => { const left = new Float32Array(count), right = new Float32Array(count); kernel.render(left, right, kernel.lastFrame); return [Array.from(left), Array.from(right)]; };
const prepared = rate => {
  const kernel = new OwnedSineKernel(rate, 8), commands = [command(rate, BEGIN, 0, 1),
    command(rate, UPDATE, Math.round(rate * 0.025), 2, { 6: 660.0123, 8: 0.12345, 9: -0.35, 14: Math.round(rate * 0.02), 15: 7 }),
    command(rate, END, Math.round(rate * 0.08), 3)];
  kernel.accept(Float64Array.from(commands.flat()), commands.length); return kernel;
};

describe('complete bounded owned-sine DSP state cuts', () => {
  for (const rate of [44100, 48000, 96000]) for (const seconds of [0.005, 0.035, 0.065, 0.09]) {
    it(`restores uninterrupted stereo PCM at ${rate} Hz, ${seconds}s with future controls and interpolation intact`, () => {
      const original = prepared(rate); render(original, Math.round(rate * seconds));
      const bytes = new Uint8Array(SINE_STATE_BYTES), receipt = original.snapshotInto(bytes, identity);
      expect(receipt).to.include({ abi: SINE_STATE_ABI, frame: Math.round(rate * seconds), bytes: SINE_STATE_BYTES, equivalence: 'same-artifact-rate-and-profile' });
      const next = new OwnedSineKernel(rate, 8); next.restoreFrom(bytes, identity);
      const repeat = new Uint8Array(SINE_STATE_BYTES); original.snapshotInto(repeat, identity); expect(repeat).to.deep.equal(bytes);
      expect(render(next, Math.round(rate * 0.12))).to.deep.equal(render(original, Math.round(rate * 0.12)));
      expect(Array.from(next.active)).to.deep.equal(Array.from(original.active)); expect(next.queueLength).to.equal(original.queueLength);
      expect(Array.from(next.receipts.subarray(0, next.receiptCount * 6))).to.deep.equal(Array.from(original.receipts.subarray(0, original.receiptCount * 6)));
      expect(next.voice.buffer).not.to.equal(original.voice.buffer); expect(next.queue.buffer).not.to.equal(original.queue.buffer);
    });
  }
  it('refuses corrupt identities, rates and payloads before changing a staged destination', () => {
    const original = prepared(48000); render(original, 128); const bytes = new Uint8Array(SINE_STATE_BYTES); original.snapshotInto(bytes, identity);
    const destination = new OwnedSineKernel(48000, 8);
    expect(() => destination.restoreFrom(bytes, { ...identity, engineArtifactHash: 'c'.repeat(64) })).to.throw('hash');
    expect(() => new OwnedSineKernel(96000, 8).restoreFrom(bytes, identity)).to.throw('rate');
    const corrupt = bytes.slice(); new DataView(corrupt.buffer).setFloat64(128 + 8, NaN, true);
    expect(() => destination.restoreFrom(corrupt, identity)).to.throw('noncanonical');
    expect(destination.lastFrame).to.equal(0); expect(destination.active.some(Boolean)).to.equal(false); expect(destination.queueLength).to.equal(0);
    original.panicPending = true; original.snapshotInto(bytes, identity); destination.restoreFrom(bytes, identity);
    expect(render(destination, 128)).to.deep.equal(render(original, 128)); expect(destination.active.some(Boolean)).to.equal(false);
  });
  it('requires an exclusive exact-size buffer and starts display observation independently', () => {
    const kernel = prepared(48000); render(kernel, 128);
    expect(() => kernel.snapshotInto(new Uint8Array(SINE_STATE_BYTES - 1), identity)).to.throw('fixed-size');
    if (typeof SharedArrayBuffer === 'function') expect(() => kernel.snapshotInto(new Uint8Array(new SharedArrayBuffer(SINE_STATE_BYTES)), identity)).to.throw('exclusively owned');
    const bytes = new Uint8Array(SINE_STATE_BYTES); kernel.snapshotInto(bytes, identity);
    const restored = new OwnedSineKernel(48000, 8); restored.displayEnabled = true; restored.displayReady = true; restored.restoreFrom(bytes, identity);
    expect(restored.displayEnabled).to.equal(false); expect(restored.displayReady).to.equal(false);
  });
});
