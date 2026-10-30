import { expect } from 'chai';
import { OwnedSampleKernel } from '../../js/app/midi-ui/worklet/OwnedSampleProcessor.js';
import { OWNED_SAMPLE_STATE_FIELDS as F, OWNED_SAMPLE_STATE_WIDTH } from '../../js/app/midi-ui/worklet/OwnedSampleSource.js';
import { SAMPLE_LAYOUT } from '../../js/app/midi-ui/OwnedSourceLayout.js';
import { BEGIN, UPDATE, END, CANCEL, APPLIED, REJECTED } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { createOwnedPcmSetDescriptor } from '../../js/app/resources/OwnedPcmSetVerification.js';
import { computeOwnedSourceBank } from '../../js/app/resources/OwnedSourceBankComputation.js';
import { singleSampleMap } from '../helpers/sampleMap.js';
import { ownedSourceStateBytes, writeOwnedSourceState, restoreOwnedSourceState } from '../../js/app/midi-ui/worklet/OwnedSourceState.js';

const a = 'a'.repeat(64), b = 'b'.repeat(64), identity = { engineArtifactHash: 'c'.repeat(64), patchDefinitionHash: 'd'.repeat(64), graphRevision: 1 };
const row = (opcode, frame, sequence, values = {}) => Object.assign(new Array(SAMPLE_LAYOUT.width).fill(0), {
  0: 1, 1: frame, 2: sequence, 3: opcode, 4: 0, 5: 1, ...(opcode === BEGIN ? { 6: 440, 7: 0.8, 8: 1, 12: 1, 13: 64, 16: 96000, 19: 42 } : {}), 17: 1
}, values);
const submit = (kernel, rows) => kernel.accept(Float64Array.from(rows.flat()), rows.length);
const render = (kernel, frames) => { const left = new Float32Array(frames), right = new Float32Array(frames); kernel.render(left, right, kernel.lastFrame); return [left, right]; };
const receipts = kernel => Array.from({ length: kernel.receiptCount }, (_, index) => Array.from(kernel.receipts.subarray(index * 6, index * 6 + 6)));
const value = (kernel, field, slot = 0) => kernel.source.state[slot * OWNED_SAMPLE_STATE_WIDTH + field];

describe('pooled owned sample source and logical release children (runtime qualification deferred)', () => {
  let sourceBank, pcm;
  before(async () => {
    sourceBank = await computeOwnedSourceBank('sample-read-v1', { yieldControl: async () => {} });
    const banks = [a, b].map((assetHash, index) => {
      const plane = Float32Array.from({ length: 8000 }, (_, frame) => Math.sin(frame * (index ? 0.07 : 0.04)) * 0.5);
      const descriptor = { schema: 'lemmings-owned-pcm-bank/v1', assetHash, pcmHash: assetHash, bankHash: assetHash, format: 'float32-planar-le',
        sourceFrames: plane.length, sourceSampleRate: 48000, frames: plane.length, sampleRate: 48000, channels: 1, bytes: plane.byteLength,
        decoderVersion: 'fixture-v1', peak: 0.5, sampleMagnitudeLimit: 16, evidence: 'copied-decoded-pcm-not-acoustic-qualification' };
      return { descriptor, planes: [plane] };
    });
    pcm = { descriptor: await createOwnedPcmSetDescriptor(banks.map(bank => bank.descriptor)), banks };
  });
  const patch = ({ crossfade = 256, reverse = false, position = false } = {}) => {
    const map = singleSampleMap(a, { frames: 8000 }); map.rendererProfile = 'owned-sample-v1'; const zone = map.zones[0];
    zone.rootCents = 6900; zone.pitchRange = { minCents: 6300, maxCents: 7500, maxTransposeCents: 600 };
    zone.playbackMode = position ? 'positionDriven' : reverse ? 'reverse' : 'forward';
    zone.loop = position ? null : { mode: 'sustain', startFrame: 0, endFrame: 8000, crossfadeFrames: crossfade, gainLaw: 'linear' };
    if (position) zone.positionPolicy = { boundary: 'wrap', interpolation: 'linear', slewSeconds: 0.01, maximumReadDerivative: 4, crossfadeFrames: 256, gainLaw: 'linear' };
    zone.releaseRegion = { assetHash: b, onsetFrame: 0, endFrame: 8000, rootCents: 6900, tuningCents: 0, gain01: 0.5, pitchRange: { ...zone.pitchRange } };
    return { id: 'kernel-sample', revision: 1, sampleRefs: [{ sha256: a, bytes: 32044, required: true }, { sha256: b, bytes: 32044, required: true }], sampleMap: map,
      parameters: { releaseSeconds: 0.01 }, voicePolicy: { maxVoices: 2 } };
  };
  it('authors sixteen-voice held PCM/state continuation with cursor storage bounded to declared zones', () => {
    const definition = patch(); definition.voicePolicy.maxVoices = 16; const kernel = new OwnedSampleKernel(48000, pcm, definition, 16, sourceBank), clone = new OwnedSampleKernel(48000, pcm, definition, 16, sourceBank);
    expect(kernel.source.cursorQueues.length).to.equal(16 * definition.sampleMap.zones.length * SAMPLE_LAYOUT.cursorCapacity * SAMPLE_LAYOUT.cursorWidth); expect(kernel.source.cursors).to.have.length(16);
    submit(kernel, Array.from({ length: 16 }, (_, slot) => row(BEGIN, 0, slot + 1, { 4: slot }))); render(kernel, 256);
    const bytes = new Uint8Array(ownedSourceStateBytes(kernel)); writeOwnedSourceState(kernel, bytes, identity); restoreOwnedSourceState(clone, bytes, identity); expect(render(clone, 512)).to.deep.equal(render(kernel, 512));
    const small = new OwnedSampleKernel(48000, pcm, patch(), undefined, sourceBank); expect(small.maxVoices).to.equal(2); expect(small.source.cursors).to.have.length(2); expect(() => restoreOwnedSourceState(small, bytes, identity)).to.throw();
  });
  const create = (rate = 48000, options = {}) => new OwnedSampleKernel(rate, pcm, patch(options), 2, sourceBank);

  for (const rate of [44100, 48000, 96000]) for (const reverse of [false, true]) it('keeps a fractional ' + (reverse ? 'reverse' : 'forward') + ' playhead and authored loop period at ' + rate + ' Hz', () => {
    const kernel = create(rate, { reverse }), alternate = create(rate, { reverse, crossfade: 128 });
    submit(kernel, [row(BEGIN, 0, 1)]); submit(alternate, [row(BEGIN, 0, 1)]);
    const frames = 9000, [left, right] = render(kernel, frames); render(alternate, frames);
    const expected = ((reverse ? 7999 - frames * 48000 / rate : frames * 48000 / rate) % 8000 + 8000) % 8000;
    expect(value(kernel, F.position)).to.be.closeTo(expected, 1e-6); expect(value(alternate, F.position)).to.be.closeTo(expected, 1e-6);
    expect(left.every(Number.isFinite) && right.every(Number.isFinite)).to.equal(true); expect(left.some(sample => sample !== 0)).to.equal(true);
    expect(receipts(kernel).filter(item => item[0] === APPLIED)).to.have.length(1); expect(value(kernel, F.heads)).to.be.at.most(2);
  });

  it('keeps the release child audible after its parent envelope reaches zero and retires at the admitted deadline', () => {
    const kernel = create(); submit(kernel, [row(BEGIN, 0, 1), row(END, 512, 2, { 13: 64, 16: 1200, 7: 0.7, 8: 1 })]);
    render(kernel, 800); expect(kernel.voice[4]).to.equal(0); expect(kernel.active[0]).to.equal(1); expect(value(kernel, F.attackDone)).to.equal(1); expect(value(kernel, F.childActive)).to.equal(1);
    const [tail] = render(kernel, 400); expect(tail.some(sample => Math.abs(sample) > 1e-7)).to.equal(true);
    render(kernel, 1); expect(kernel.active[0]).to.equal(0); expect(value(kernel, F.childActive)).to.equal(0);
    expect(receipts(kernel).filter(item => item[0] === APPLIED)).to.have.length(2); expect(receipts(kernel).some(item => item[0] === REJECTED)).to.equal(false);
  });
  it('retires a completed source before a new onset reuses its exact frame and slot', () => {
    const kernel = create(); submit(kernel, [row(BEGIN, 0, 1), row(END, 512, 2, { 13: 64, 16: 576, 7: 0, 8: 1 }), row(BEGIN, 576, 3, { 5: 2 })]);
    render(kernel, 700); expect(receipts(kernel).some(item => item[0] === REJECTED)).to.equal(false); expect(kernel.active[0]).to.equal(1);
    expect(value(kernel, F.token)).to.equal(2); expect(value(kernel, F.start)).to.equal(576);
  });

  it('resumes independent mutable source, future-control, cursor and release state inside an actual child tail', () => {
    for (const position of [false, true]) {
      const kernel = create(48000, { position }); submit(kernel, [row(BEGIN, 0, 1), ...(position ? [row(UPDATE, 0, 2, { 15: 8, 18: 0, 19: 900, 20: 0, 21: 900, 22: 1, 23: 0 })] : []), row(END, 512, position ? 3 : 2, { 13: 64, 16: 1600 })]);
      render(kernel, 800); const bytes = new Uint8Array(kernel.stateByteLength()); kernel.snapshotInto(bytes, identity);
      const next = create(48000, { position }); next.restoreFrom(bytes, identity);
      expect(next.source.state.buffer).not.to.equal(kernel.source.state.buffer); expect(next.source.cursorQueues.buffer).not.to.equal(kernel.source.cursorQueues.buffer);
      expect(render(next, 1000)).to.deep.equal(render(kernel, 1000)); expect(receipts(next)).to.deep.equal(receipts(kernel));
    }
  });

  it('reverses observed position without another onset and settles to exact zero at rest', () => {
    const kernel = create(48000, { position: true }); submit(kernel, [row(BEGIN, 0, 1),
      row(UPDATE, 0, 2, { 15: 8, 18: 0, 19: 480, 20: 0, 21: 480, 22: 1, 23: 0 }),
      row(UPDATE, 480, 3, { 15: 8, 18: 480, 19: 960, 20: 480, 21: 0, 22: 2, 23: 0 })]);
    render(kernel, 700); const bytes = new Uint8Array(kernel.stateByteLength()); kernel.snapshotInto(bytes, identity);
    const next = create(48000, { position: true }); next.restoreFrom(bytes, identity);
    expect(render(next, 900)).to.deep.equal(render(kernel, 900)); expect(kernel.source.cursor(0).position).to.equal(0);
    const [rest] = render(kernel, 128); expect(rest.every(sample => sample === 0)).to.equal(true); expect(value(kernel, F.heads)).to.equal(0);
    expect(receipts(kernel).filter(item => item[0] === APPLIED)).to.have.length(3);
  });

  it('cancels every layer of one owner without retriggering releases or killing a same-pitch neighbor', () => {
    const kernel = create(); submit(kernel, [row(BEGIN, 0, 1), row(BEGIN, 0, 2, { 0: 2, 4: 1 }), row(END, 512, 3, { 13: 128, 16: 1800 }),
      row(CANCEL, 640, 4, { 4: -1, 5: 0 })]);
    render(kernel, 1100); expect(kernel.active[0]).to.equal(0); expect(kernel.active[1]).to.equal(1); expect(value(kernel, F.childActive)).to.equal(0);
    expect(value(kernel, F.childActive, 1)).to.equal(0); kernel.panicPending = true; render(kernel, 256); expect(kernel.active.some(Boolean)).to.equal(false);
    expect(kernel.source.cursorQueues.every(sample => sample === 0)).to.equal(true);
  });

  it('rejects a different prepared map and corrupt cut before changing staged DSP state', () => {
    const kernel = create(); submit(kernel, [row(BEGIN, 0, 1)]); render(kernel, 256);
    const bytes = new Uint8Array(kernel.stateByteLength()); kernel.snapshotInto(bytes, identity);
    const other = create(48000, { crossfade: 128 }); expect(() => other.restoreFrom(bytes, identity)).to.throw('prepared map'); expect(other.lastFrame).to.equal(0); expect(other.active.some(Boolean)).to.equal(false);
    const corrupt = bytes.slice(); corrupt[corrupt.length - 1] ^= 1; const staged = create(); expect(() => staged.restoreFrom(corrupt, identity)).to.throw('checksum'); expect(staged.lastFrame).to.equal(0);
  });
  it('keeps unpitched attack and release PCM at the authored rate across different triggering pitches', () => {
    const definition = patch();
    for (const region of [definition.sampleMap.zones[0], definition.sampleMap.zones[0].releaseRegion]) {
      region.pitchTracking = 'fixed'; region.pitchRange = { minCents: 0, maxCents: 12700, maxTransposeCents: 0 };
    }
    const make = frequency => {
      const kernel = new OwnedSampleKernel(48000, pcm, definition, 2, sourceBank);
      submit(kernel, [row(BEGIN, 0, 1, { 6: frequency }), row(END, 256, 2, { 13: 64 })]);
      return { kernel, audio: render(kernel, 1024) };
    };
    const low = make(220), high = make(880);
    expect(low.audio).to.deep.equal(high.audio);
    expect(value(low.kernel, F.derivative)).to.equal(1);
    expect(value(high.kernel, F.childDerivative)).to.equal(1);
    expect(high.kernel.source.inspect().voices[0].rateRatio).to.equal(1);
    expect(receipts(high.kernel).some(item => item[0] === REJECTED)).to.equal(false);
  });

  it('derives a bounded sampler tone from semantic velocity and keeps filter state private to the voice', () => {
    const quiet = create(), loud = create();
    submit(quiet, [row(BEGIN, 0, 1, { 31: 9000, 32: 0.8, 33: 0.1 })]);
    submit(loud, [row(BEGIN, 0, 1, { 31: 9000, 32: 0.8, 33: 0.9 })]);
    render(quiet, 1); render(loud, 1);
    expect(value(quiet, F.filterHz)).to.be.closeTo(2520, 1e-9); expect(value(loud, F.filterHz)).to.be.closeTo(8280, 1e-9);
    const [low] = render(quiet, 512), [high] = render(loud, 512); expect(low).not.to.deep.equal(high);
    expect([...low, ...high].every(Number.isFinite)).to.equal(true);
    expect(value(quiet, F.filterAlpha)).to.be.greaterThan(0).and.lessThan(1);
  });

});
