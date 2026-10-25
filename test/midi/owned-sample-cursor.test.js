import { expect } from 'chai';
import { OwnedSampleCursor } from '../../js/app/midi-ui/worklet/OwnedSampleCursor.js';
import { prepareSampleCursorProfile } from '../../js/midi/content/SampleCursorProfile.js';
const parameters = (sampleRate = 48000, extra = {}) => ({ sampleRate, sourceSampleRate: 44100, decodedSampleRate: sampleRate, sourceFrames: 44100, decodedFrames: sampleRate, regionStartFrame: 0, regionEndFrame: 44100, bankHash: 'a'.repeat(64), mapRevision: 1, ...extra });
const segment = (firstOutputFrame, endOutputFrame, firstSourceFrame, endSourceFrame, sequence, discontinuity = 'continuous') => ({ firstOutputFrame, endOutputFrame, firstSourceFrame, endSourceFrame, sequence, discontinuity });

describe('observed source-frame sample cursor', () => {
  for (const rate of [44100, 48000, 96000]) it('preserves exact outward/return coordinates and rests silently at ' + rate, () => {
    const cursor = new OwnedSampleCursor(parameters(rate)), frames = rate / 10;
    expect(cursor.enqueue(segment(0, frames, 0, 4410, 1))).to.equal(true); expect(cursor.enqueue(segment(frames, frames * 2, 4410, 0, 2))).to.equal(true);
    for (let frame = 0; frame <= frames * 2; frame++) cursor.advance(frame);
    expect(cursor.position).to.equal(0); expect(cursor.decodedPosition).to.equal(0); expect(cursor.segmentsApplied).to.equal(2);
    for (let frame = frames * 2 + 1; frame < frames * 2 + rate; frame++) cursor.advance(frame);
    expect(cursor.position).to.equal(0); expect(cursor.gain).to.equal(0); expect(cursor.readDerivative).to.equal(0);
    expect(cursor.stateByteLength()).to.equal(cursor.profile.transferBytes);
  });
  it('does not drop a reversal when the queue fills or infer motion beyond observed segment time', () => {
    const cursor = new OwnedSampleCursor(parameters(48000, { capacity: 2 }));
    expect(cursor.enqueue(segment(0, 1000, 0, 200, 1))).to.equal(true); expect(cursor.enqueue(segment(1000, 2000, 200, 0, 2))).to.equal(true);
    expect(cursor.enqueue(segment(2000, 3000, 0, 100, 3))).to.equal(false);
    for (let frame = 0; frame < 2600; frame++) cursor.advance(frame);
    expect(cursor.position).to.equal(0); expect(cursor.gain).to.equal(0); expect(cursor.segmentsApplied).to.equal(2); expect(cursor.rejected).to.equal(1);
  });
  it('requires explicit seeks and rejects late/overlapping or out-of-derivative-domain commands before queuing', () => {
    const cursor = new OwnedSampleCursor(parameters());
    expect(cursor.enqueue(segment(0, 100, 0, 10000, 1))).to.equal(false);
    expect(cursor.enqueue(segment(0, 100, 0, 10, 1, '__proto__'))).to.equal(false);
    expect(cursor.enqueue(segment(0, 1000, 100, 200, 1))).to.equal(false);
    expect(cursor.enqueue(segment(0, 1000, 100, 200, 1, 'seek'))).to.equal(true);
    expect(cursor.enqueue(segment(999, 2000, 200, 400, 2))).to.equal(false);
    for (let frame = 0; frame < 100; frame++) cursor.advance(frame);
    expect(cursor.crossfadeRemaining).to.be.greaterThan(0); expect(cursor.seekMix01).to.be.within(0, 1);
    expect(cursor.enqueue(segment(0, 1000, 200, 300, 2))).to.equal(false);
  });
  it('bounds simultaneous seek heads without dropping or aliasing a second discontinuity', () => {
    const cursor = new OwnedSampleCursor(parameters());
    expect(cursor.enqueue(segment(0, 20, 100, 102, 1, 'seek'))).to.equal(true);
    expect(cursor.enqueue(segment(20, 40, 200, 202, 2, 'seek'))).to.equal(false);
    expect(cursor.enqueue(segment(20, 1000, 102, 105, 2))).to.equal(true);
  });
  it('keeps clamping, wrapping and sample-center reflection as distinct prepared boundary policies', () => {
    const stop = new OwnedSampleCursor(parameters(44100, { regionEndFrame: 10, boundary: 'stop' })), wrap = new OwnedSampleCursor(parameters(44100, { regionEndFrame: 10, boundary: 'wrap' })), reflect = new OwnedSampleCursor(parameters(44100, { regionEndFrame: 10, boundary: 'reflect' }));
    expect(stop.map(12)).to.equal(9); expect(wrap.map(12)).to.equal(2); expect(wrap.map(-1)).to.equal(9); expect(reflect.map(12)).to.equal(6);
    expect(wrap.map(9.5)).to.equal(9.5); expect(reflect.map(9)).to.equal(9);
    expect(() => prepareSampleCursorProfile(parameters(48000, { decodedFrames: 49000 }))).to.throw();
  });
  it('restores actual queue, seek and gain state with immutable bank binding and independent storage', () => {
    const a = new OwnedSampleCursor(parameters()), b = new OwnedSampleCursor(parameters());
    a.enqueue(segment(0, 1000, 100, 200, 1, 'seek')); a.enqueue(segment(1000, 2000, 200, 0, 2));
    for (let frame = 0; frame < 123; frame++) a.advance(frame);
    const state = new Uint8Array(a.stateByteLength()); a.snapshotInto(state); b.restoreFrom(state);
    expect(b.queue).to.not.equal(a.queue); expect(b.seekMix01).to.equal(a.seekMix01);
    for (let frame = 123; frame < 2600; frame++) { a.advance(frame); b.advance(frame); expect([b.position, b.decodedPosition, b.gain, b.seekMix01]).to.deep.equal([a.position, a.decodedPosition, a.gain, a.seekMix01]); }
    const different = new OwnedSampleCursor(parameters(48000, { bankHash: 'b'.repeat(64) })); expect(() => different.restoreFrom(state)).to.throw();
    const before = new Uint8Array(b.stateByteLength()); b.snapshotInto(before); state[state.length - 1] ^= 1; expect(() => b.restoreFrom(state)).to.throw(); const after = new Uint8Array(b.stateByteLength()); b.snapshotInto(after); expect(after).to.deep.equal(before);
  });
  it('reuses prepared storage after release/Panic without a hidden playback clock', () => {
    const cursor = new OwnedSampleCursor(parameters()), queue = cursor.queue;
    cursor.enqueue(segment(0, 1000, 0, 200, 1)); cursor.advance(0); cursor.release(); expect(cursor.enqueue(segment(1000, 2000, 200, 0, 2))).to.equal(false); cursor.panic(); expect(cursor.gain).to.equal(0);
    cursor.reset(2000, 100); expect(cursor.queue).to.equal(queue); expect(cursor.frame).to.equal(2000); expect(cursor.position).to.equal(100); expect(cursor.enqueue(segment(2000, 3000, 100, 200, 1))).to.equal(true); expect(() => cursor.advance(2001)).to.throw();
  });
});
