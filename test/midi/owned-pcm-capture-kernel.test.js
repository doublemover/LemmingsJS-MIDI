import { expect } from 'chai';
import { OwnedPcmCaptureKernel, OwnedPcmCaptureProcessor, PCM_CAPTURE_GAPS, BUFFER_PRESSURE, MISSING_INPUT } from '../../js/app/midi-ui/worklet/OwnedPcmCaptureProcessor.js';

const kernel = options => new OwnedPcmCaptureKernel({ sampleRate: 48000, maxFrames: 10000, targetStartFrame: 0, chunkFrames: 1024, ...options });
const signal = (frames, origin = 0) => [Float32Array.from({ length: frames }, (_, index) => (origin + index) / 32768),
  Float32Array.from({ length: frames }, (_, index) => -(origin + index) / 32768)];
const receiver = (target, { recycle = false, transfer = false } = {}) => {
  const packets = [];
  const emit = (index, token, sequence, sourceStartFrame, firstFrame, frameCount, buffer) => {
    const received = transfer ? structuredClone(buffer, { transfer: [buffer] }) : buffer;
    packets.push({ index, token, sequence, sourceStartFrame, firstFrame, frameCount, buffer: received,
      pcm: new Float32Array(received).slice(0, frameCount * 2) });
    if (recycle) target.returnBuffer(index, token, received);
  };
  return { packets, emit };
};
describe('bounded read-only PCM capture kernel', () => {
  it('keeps pre-start graph warm-up outside the captured interval without inventing PCM or gaps', () => {
    const capture = kernel({ targetStartFrame: 4096 }), output = receiver(capture, { recycle: true });
    for (const firstFrame of [0, 0, 1024]) expect(capture.process(signal(128, firstFrame), 128, firstFrame, output.emit)).to.equal(true);
    expect(capture.sourceStartFrame).to.equal(null); expect(capture.capturedFrames).to.equal(0); expect(output.packets).to.have.length(0);
    expect(capture.process(signal(128, 4096), 128, 4096, output.emit)).to.equal(true);
    expect(capture.process(signal(128, 4224), 128, 4224, output.emit)).to.equal(true);
    capture.requestStop(4352); expect(capture.process(signal(128, 4352), 128, 4352, output.emit)).to.equal(false);
    expect(capture).to.include({ sourceStartFrame: 4096, lastFrame: 4352, capturedFrames: 256, droppedFrames: 0, gapCount: 0, stopReason: 'user-stop' });
    expect(output.packets).to.have.length(1); expect(output.packets[0]).to.include({ firstFrame: 4096, frameCount: 256 });
    expect(output.packets[0].pcm[0]).to.equal(4096 / 32768);
  });
  for (const firstFrame of [0, 256]) it(`still rejects a render-clock discontinuity at ${firstFrame} after capture starts`, () => {
    const capture = kernel(), output = receiver(capture, { recycle: true }); capture.process(signal(128), 128, 0, output.emit);
    expect(capture.process(signal(128, firstFrame), 128, firstFrame, output.emit)).to.equal(false);
    expect(capture).to.include({ sourceStartFrame: 0, lastFrame: 128, capturedFrames: 128, stopReason: 'noncontiguous-render-clock' });
    expect(capture.clockDiscontinuity).to.deep.equal({ expectedFrame: 128, actualFrame: firstFrame, frames: 128 });
    expect(output.packets).to.have.length(1); expect(output.packets[0].frameCount).to.equal(128);
  });
  it('captures the exact requested frame interval across variable render block sizes', () => {
    const capture = kernel({ targetStartFrame: 200 }), output = receiver(capture, { recycle: true });
    capture.process(signal(128), 128, 0, output.emit); capture.process(signal(256, 128), 256, 128, output.emit);
    capture.requestStop(400); expect(capture.process(signal(128, 384), 128, 384, output.emit)).to.equal(false);
    expect(capture.sourceStartFrame).to.equal(200); expect(capture.lastFrame).to.equal(400); expect(capture.capturedFrames).to.equal(200);
    expect(output.packets).to.have.length(1); expect(output.packets[0]).to.include({ firstFrame: 200, frameCount: 200 });
    for (let index = 0; index < 200; index++) {
      expect(output.packets[0].pcm[index * 2]).to.equal((index + 200) / 32768);
      expect(output.packets[0].pcm[index * 2 + 1]).to.equal(-(index + 200) / 32768);
    }
  });
  it('bounds transport to two transferred buffers and records exact pressure gaps without gluing them', () => {
    const capture = kernel(), output = receiver(capture, { transfer: true });
    for (let frame = 0; frame < 2560; frame += 128) capture.process(signal(128, frame), 128, frame, output.emit);
    expect(output.packets).to.have.length(2); expect(capture.droppedFrames).to.equal(512); expect([...capture.gaps.subarray(0, 3)]).to.deep.equal([2048, 2560, BUFFER_PRESSURE]);
    expect(capture.returnBuffer(0, 99, output.packets[0].buffer)).to.equal(false);
    expect(capture.returnBuffer(0, 1, output.packets[0].buffer)).to.equal(true);
    capture.process(signal(128, 2560), 128, 2560, output.emit); capture.requestStop(2688); capture.process(signal(64, 2688), 64, 2688, output.emit);
    expect(output.packets[2]).to.include({ firstFrame: 2560, frameCount: 128, sequence: 3 });
    expect(capture.capturedFrames + capture.droppedFrames).to.equal(2688); expect(capture.pool).to.have.length(2);
  });
  it('distinguishes valid zero-channel silence, mono mapping and genuinely missing input', () => {
    const capture = kernel(), output = receiver(capture, { recycle: true });
    capture.process([], 64, 0, output.emit); capture.process([new Float32Array(64).fill(0.25)], 64, 64, output.emit);
    capture.process(undefined, 64, 128, output.emit); capture.requestStop(192); capture.process([], 64, 192, output.emit);
    expect(capture).to.include({ zeroChannelFrames: 64, monoFrames: 64, capturedFrames: 128, droppedFrames: 64 });
    expect([...capture.gaps.subarray(0, 3)]).to.deep.equal([128, 192, MISSING_INPUT]);
    expect(output.packets[0].pcm.slice(0, 128).every(value => value === 0)).to.equal(true);
    expect(output.packets[0].pcm.slice(128).every(value => value === 0.25)).to.equal(true);
  });
  it('retains a bounded gap prefix and an unknown suffix after gap-index exhaustion', () => {
    const capture = kernel(), output = receiver(capture), gapStorage = capture.gaps;
    for (let frame = 0; frame < 1024; frame++) capture.process(frame % 2 ? [new Float32Array([0.25])] : undefined, 1, frame, output.emit);
    expect(capture.gapCount).to.equal(PCM_CAPTURE_GAPS); expect(capture.gaps).to.equal(gapStorage);
    expect(capture.overflowFirstFrame).to.be.a('number'); expect(capture.overflowLastFrame).to.equal(1024);
    expect(capture.gaps.length).to.equal(PCM_CAPTURE_GAPS * 3);
  });
  it('stops before a nonfinite sample and preserves float headroom without modifying the input', () => {
    const capture = kernel(), output = receiver(capture), input = [new Float32Array(128).fill(1.5), new Float32Array(128).fill(-1.5)]; input[0][7] = NaN;
    expect(capture.process(input, 128, 0, output.emit)).to.equal(false); expect(capture).to.include({ stopReason: 'nonfinite-input', capturedFrames: 7, lastFrame: 7 });
    expect(output.packets[0].pcm[0]).to.equal(1.5); expect(output.packets[0].pcm[1]).to.equal(-1.5); expect(Number.isNaN(input[0][7])).to.equal(true);
  });
  it('has no audible output path and rejects a changed frame domain', () => {
    const processor = new OwnedPcmCaptureProcessor({ processorOptions: { protocol: 1, epoch: 'fixture', maxFrames: 32, targetStartFrame: 0, chunkFrames: 1024 } });
    const messages = []; processor.port = { postMessage: message => messages.push(message) };
    const outputs = [[new Float32Array(64).fill(1), new Float32Array(64).fill(1)]], input = signal(64);
    expect(processor.process([input], outputs)).to.equal(false); expect(outputs[0].every(channel => channel.every(value => value === 0))).to.equal(true);
    expect(messages.map(message => message.type)).to.deep.equal(['pcm', 'stopped']);
    const capture = kernel(), receive = receiver(capture); capture.process(signal(64), 64, 0, receive.emit);
    expect(capture.process(signal(64), 64, 128, receive.emit)).to.equal(false); expect(capture.stopReason).to.equal('noncontiguous-render-clock');
  });
});
