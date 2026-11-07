import { expect } from 'chai';
import { OwnedPluckKernel, OwnedPluckSource, PLUCK_WIDTH, pluckSourceBytes } from '../../js/app/midi-ui/worklet/OwnedPluckProcessor.js';
import { BEGIN, UPDATE, PANIC, APPLIED, REJECTED, RECEIPT_WIDTH } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';

const begin = ({ slot = 0, token = 1, seed = 191, frame = 0, rate = 48000 } = {}) => {
  const data = new Float64Array(PLUCK_WIDTH); data.set([1, frame, token, BEGIN, slot, token, 130.8127826503, 0.4, 1, 0, 0, 0, 1, rate * 0.005, 0, 0, rate / 2, 1,
    seed, 0.28, 0.9, 0.6, 0, 0.3]); return data;
};
const render = (seed, blockSize) => {
  const kernel = new OwnedPluckKernel(48000), data = begin({ seed }); kernel.accept(data, 1, 1);
  const output = new Float32Array(4096);
  for (let frame = 0; frame < output.length; frame += blockSize) { const block = output.subarray(frame, Math.min(output.length, frame + blockSize)); kernel.render(block, null, frame); }
  return { kernel, output };
};
describe('owned preallocated plucked-string kernel', () => {
  it('damps an existing string/body smoothly without another excitation or voice token', () => {
    const baseline = new OwnedPluckKernel(48000), damped = new OwnedPluckKernel(48000), event = begin(); event[22] = 0.3;
    for (const kernel of [baseline, damped]) { kernel.accept(event, 1, 1); for (let frame = 0; frame < 4096; frame += 128) kernel.render(new Float32Array(128), null, frame); }
    const writes = damped.source.initializationWrites, control = new Float64Array(PLUCK_WIDTH);
    control.set([1, 4096, 2, UPDATE, 0, 1]); control[14] = 240; control[15] = 8; control[20] = 0.02; control[23] = 0.02;
    damped.accept(control, 1, 2); const energy = [0, 0];
    for (let frame = 4096; frame < 18432; frame += 128) for (const [index, kernel] of [baseline, damped].entries()) {
      const output = new Float32Array(128); kernel.render(output, null, frame); if (frame >= 16384) for (const sample of output) energy[index] += sample * sample;
    }
    expect(energy[0]).to.be.greaterThan(0); expect(energy[1]).to.be.lessThan(energy[0] * 0.01);
    expect(damped.source.initializationWrites).to.equal(writes); expect(damped.voice[2]).to.equal(1); expect(damped.active[0]).to.equal(1);
    expect([...damped.receipts.subarray(0, damped.receiptCount * RECEIPT_WIDTH)].filter((value, index) => index % RECEIPT_WIDTH === 0 && value === REJECTED)).to.have.length(0);
  });
  it('preserves seeded excitation across render block sizes and distinguishes same-pitch actors', () => {
    const a = render(191, 64), b = render(191, 257), other = render(192, 128);
    expect([...a.output]).to.deep.equal([...b.output]); expect([...other.output]).not.to.deep.equal([...a.output]);
    expect(a.output.every(Number.isFinite)).to.equal(true); expect(a.output.some(value => Math.abs(value) > 0.0001)).to.equal(true);
    expect(a.kernel.receipts[0]).not.to.equal(REJECTED);
  });
  it('allocates an exact bounded source inventory and admits excitation by absolute 128-frame buckets', () => {
    const source = new OwnedPluckSource(96000);
    expect(source.buffer.byteLength + source.scratch.byteLength + source.state.byteLength).to.equal(pluckSourceBytes(96000));
    const kernel = new OwnedPluckKernel(384000), packet = new Float64Array(16 * PLUCK_WIDTH);
    for (let slot = 0; slot < 16; slot++) { const event = begin({ slot, token: slot + 1, rate: 384000 }); event[6] = 50; packet.set(event, slot * PLUCK_WIDTH); }
    kernel.accept(packet, 16, 1); kernel.render(new Float32Array(1), null, 0);
    expect(kernel.source.initializationDenials).to.be.greaterThan(0); expect(kernel.source.initializationWrites).to.be.at.most(65536);
    let applied = 0, rejected = 0; for (let index = 0; index < kernel.receiptCount; index++) { const at = index * RECEIPT_WIDTH;
      if (kernel.receipts[at] === APPLIED) applied++; if (kernel.receipts[at] === REJECTED && kernel.receipts[at + 5] === 10) rejected++; }
    expect(applied + rejected).to.equal(16); expect(rejected).to.equal(kernel.source.initializationDenials);
  });
  it('ends every string/body contribution on Panic and refuses incomplete sine-only state cuts', () => {
    const kernel = new OwnedPluckKernel(48000), data = begin(); data[22] = 0.3; kernel.accept(data, 1, 1); kernel.render(new Float32Array(128), null, 0);
    const panic = new Float64Array(PLUCK_WIDTH); panic[2] = 2; panic[3] = PANIC; kernel.accept(panic, 1, 2);
    for (let frame = 128; frame < 1024; frame += 128) kernel.render(new Float32Array(128), null, frame);
    const silence = new Float32Array(128); kernel.render(silence, null, 1024); expect(silence.every(value => value === 0)).to.equal(true);
    expect(() => kernel.snapshotInto(new Uint8Array(1), {})).to.throw('exclusively owned exact-size');
  });
});
