import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { nonlinearADAA1, nonlinearTransfer, NonlinearChainKernel } from '../../js/app/midi-ui/worklet/NonlinearChainKernel.js';
import { prepareNonlinearChainProfile } from '../../js/midi/content/NonlinearChainProfile.js';
import { NONLINEAR_FILTER_TABLES } from '../../js/midi/content/NonlinearFilterTables.js';
import { createQuarryTape } from '../../js/midi/content/DubQuarryRack.js';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';

describe('shared nonlinear chain arithmetic and history (deferred qualification)', () => {
  it('uses the specified cubic/fold integral and stable equal/adjacent input limits', () => {
    for (const shape of ['cubic', 'fold']) {
      for (const value of [-8, -3, -1, -0.01, 0, 0.01, 1, 3, 8]) {
        expect(nonlinearADAA1(shape, value, value)).to.equal(nonlinearTransfer(shape, value));
        expect(nonlinearADAA1(shape, value, value + 1e-12)).to.be.closeTo(nonlinearTransfer(shape, value), 1e-8);
      }
      for (const [a, b] of [[-1.5, 0.75], [0.8, 1.2], [-4.7, 6.1], [2.5, 3.5]]) {
        let integral = 0; const count = 16384;
        for (let i = 0; i < count; i++) integral += nonlinearTransfer(shape, a + (b - a) * (i + 0.5) / count) / count;
        expect(nonlinearADAA1(shape, b, a)).to.be.closeTo(integral, 2e-7);
      }
    }
  });
  it('pins real filter coefficients and reports fractional small-signal delay separately from phase/droop', () => {
    for (const table of NONLINEAR_FILTER_TABLES) {
      expect(createHash('sha256').update(JSON.stringify(table.coefficients)).digest('hex')).to.equal(table.coefficientHash);
      expect(table.coefficients.reduce((sum, value) => sum + value, 0)).to.be.closeTo(1, 1e-14);
      for (let i = 0; i < table.coefficients.length; i++) expect(table.coefficients[i]).to.be.closeTo(table.coefficients.at(-i - 1), 1e-15);
      const profile = prepareNonlinearChainProfile({ oversample: table.factor }); expect(profile.processingLatencyFrames).to.equal(16 + 0.5 / table.factor);
      expect(profile.phasePolicy).to.include('frequency-dependent'); expect(profile.internalSampleRate).to.equal(48000 * table.factor);
    }
  });
  it('restores every filter, phase and conditioning frontier with exact forward output', () => {
    for (const sampleRate of [44100, 48000, 96000]) for (const oversample of [1, 2, 4]) for (const antialiasMode of ['direct', 'adaa1']) {
      const parameters = { stages: [{ shape: 'cubic', driveDb: 3, bias: 0.1 }, { shape: 'fold', driveDb: 6, bias: -0.15 }], oversample, antialiasMode, driveDb: 4 };
      const forward = new NonlinearChainKernel({ sampleRate, parameters }), restored = new NonlinearChainKernel({ sampleRate, parameters });
      const input = index => Math.sin(index * 0.31) * 0.6 + Math.cos(index * 0.077) * 0.2;
      for (let i = 0; i < 317; i++) forward.sample(input(i), input(i + 3), i > 199 ? 11 : 4, 0.7);
      const bytes = new Uint8Array(forward.stateByteLength); forward.snapshotInto(bytes); restored.restoreFrom(bytes);
      expect(restored.diagnostics().frame).to.equal(317);
      for (let i = 317; i < 1024; i++) { const drive = i > 751 ? 1 : 11, left = input(i), right = input(i + 3); forward.sample(left, right, drive, 0.7); restored.sample(left, right, drive, 0.7);
        expect(restored.leftSample).to.equal(forward.leftSample); expect(restored.rightSample).to.equal(forward.rightSample);
      }
      expect(restored.diagnostics().faults).to.equal(0);
    }
  });
  it('rejects corrupt/foreign state atomically, remains exactly silent without input, and quarantines nonfinite input', () => {
    const kernel = new NonlinearChainKernel({ sampleRate: 48000, parameters: { stages: [{ shape: 'fold', driveDb: 4, bias: 0.2 }] } });
    for (let i = 0; i < 256; i++) { kernel.sample(0, 0); expect(kernel.leftSample).to.equal(0); expect(kernel.rightSample).to.equal(0); }
    const bytes = new Uint8Array(kernel.stateByteLength); kernel.snapshotInto(bytes); const corrupted = bytes.slice(); corrupted[corrupted.length - 9] ^= 1;
    expect(() => kernel.restoreFrom(corrupted)).to.throw(); const after = new Uint8Array(kernel.stateByteLength); kernel.snapshotInto(after); expect(after).to.deep.equal(bytes);
    const other = new NonlinearChainKernel({ sampleRate: 48000, parameters: { stages: [{ shape: 'fold', driveDb: 5, bias: 0.2 }] } }); expect(() => other.restoreFrom(bytes)).to.throw('identity');
    kernel.sample(NaN, 1); expect(kernel.diagnostics()).to.include({ faults: 1, muted: true }); kernel.sample(1, 1); expect(kernel.leftSample).to.equal(0);
    expect(() => kernel.snapshotInto(new Uint8Array(kernel.state.buffer))).to.throw();
  });
  it('prepares Quarry Tape with a separate creative chain, declared dry alignment and no master replacement', () => {
    const graph = createQuarryTape({ age01: 1 }), plan = prepareEffectGraphRevision(graph), preamp = plan.nodes.find(node => node.id === 'preamp');
    expect(preamp.nonlinear.parameters).to.include({ driveDb: 12, inputHighpassHz: 100, oversample: 2 }); expect(plan.latencyFrames).to.equal(16.25);
    expect(plan.edges.find(edge => edge.from.nodeId === 'dry' && edge.to.nodeId === 'output').alignmentFrames).to.equal(16.25);
    expect(plan.alignmentStateBytes).to.be.greaterThan(0); expect(plan.outputProtection).to.include('external');
    expect(plan.nodes.find(node => node.id === 'echo').parameters.feedbackLowpassHz).to.equal(1500);
    expect(() => createQuarryTape({ age01: 2 })).to.throw(); expect(() => createQuarryTape({ delaySeconds: 0.07 })).to.throw();
    expect(() => prepareNonlinearChainProfile({ antialiasMode: 'adaa2' })).to.throw(); expect(() => prepareNonlinearChainProfile({ oversample: 8 })).to.throw();
  });
});
