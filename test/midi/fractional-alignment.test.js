import { expect } from 'chai';
import { FixedFractionalDelayKernel } from '../../js/app/midi-ui/worklet/FixedFractionalDelayProcessor.js';
import { prepareEffectGraphRevision, effectGraphHash } from '../../js/midi/content/EffectGraphRevision.js';
import { createQuarryTape } from '../../js/midi/content/DubQuarryRack.js';
import { BoundedDelayKernel, DELAY_KERNEL_REVISION } from '../../js/app/midi-ui/worklet/BoundedDelayProcessor.js';
import { NonlinearChainKernel } from '../../js/app/midi-ui/worklet/NonlinearChainKernel.js';
import { NONLINEAR_KERNEL_REVISION } from '../../js/midi/content/NonlinearChainProfile.js';
import { ALIGNMENT_KERNEL_REVISION } from '../../js/midi/content/EffectRuntimeRevisions.js';
import { prepareNativeEffectGraph } from '../../js/app/midi-ui/NativeEffectGraph.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';

describe('owned fixed fractional graph alignment (deferred qualification)', () => {
  it('preserves causal integer/subsample two-tap stereo timing at every supported rate', () => {
    for (const sampleRate of [44100, 48000, 96000]) for (const delayFrames of [0, 0.25, 0.5, 1, 20.25]) {
      const kernel = new FixedFractionalDelayKernel({ sampleRate, delayFrames }), first = Math.floor(delayFrames), fraction = delayFrames - first;
      for (let frame = 0; frame < 32; frame++) {
        kernel.sample(frame === 0 ? 1 : 0, frame === 1 ? -1 : 0);
        expect(kernel.leftSample).to.equal(frame === first ? 1 - fraction : frame === first + 1 ? fraction : 0);
        expect(kernel.rightSample).to.equal(frame === first + 1 ? -(1 - fraction) : frame === first + 2 ? -fraction : 0);
      }
      expect(kernel.buffer.byteLength).to.equal((Math.ceil(delayFrames) + 2) * 8);
    }
  });
  it('restores independent ring/cursor state exactly and refuses changed fractional identities', () => {
    const options = { sampleRate: 48000, delayFrames: 16.25 }, forward = new FixedFractionalDelayKernel(options), staged = new FixedFractionalDelayKernel(options);
    for (let i = 0; i < 113; i++) forward.sample(Math.sin(i), Math.cos(i));
    const bytes = new Uint8Array(forward.stateByteLength()); forward.snapshotInto(bytes); staged.restoreFrom(bytes);
    for (let i = 113; i < 256; i++) { forward.sample(Math.sin(i), Math.cos(i)); staged.sample(Math.sin(i), Math.cos(i)); expect(staged.leftSample).to.equal(forward.leftSample); expect(staged.rightSample).to.equal(forward.rightSample); }
    expect(staged.buffer).not.to.equal(forward.buffer); const foreign = new FixedFractionalDelayKernel({ ...options, delayFrames: 16.75 }); expect(() => foreign.restoreFrom(bytes)).to.throw('another processor');
    staged.sample(NaN, 0); staged.sample(1, 1); expect(staged.muted).to.equal(true); expect(staged.leftSample).to.equal(0);
  });
  it('admits exact alignment storage and binds used algorithm revisions into the graph identity', async () => {
    const graph = createQuarryTape(), plan = prepareEffectGraphRevision(graph); expect(plan.alignmentStateBytes).to.equal((17 + 2) * 8);
    expect(plan.processingRevisions).to.include({ delay: 'bounded-fractional-delay-v3-lagrange', nonlinear: 'polyphase-cubic-fold-adaa1-v1', alignment: 'fixed-linear-fractional-delay-v1' });
    expect(await effectGraphHash({ ...plan, processingRevisions: { ...plan.processingRevisions, alignment: 'fixture-other' } })).not.to.equal(await effectGraphHash(plan));
    expect(() => prepareEffectGraphRevision(graph, { maxStateBytes: plan.stateBytes - 1 })).to.throw('storage');
  });
  it('prepares actual delay/nonlinear/alignment kernels through the shared host and retires all producers before releasing their storage', async () => {
    const resources = createAudioResourceLeases(), nodes = [], listeners = new Set();
    const param = () => ({ setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {} }), node = () => ({ gain: param(), connect() {}, disconnect() {} });
    const context = { state: 'running', currentTime: 0, sampleRate: 48000, createGain: node, audioWorklet: { async addModule() {} },
      addEventListener: (_kind, callback) => listeners.add(callback), removeEventListener: (_kind, callback) => listeners.delete(callback) };
    const createWorkletNode = (_context, name, options) => {
      const nonlinear = name === 'lemmings-nonlinear-chain-v1', alignment = name === 'lemmings-fixed-fractional-delay-v1';
      const source = nonlinear ? new NonlinearChainKernel({ sampleRate: 48000, parameters: options.processorOptions.parameters }) : alignment ? new FixedFractionalDelayKernel({ ...options.processorOptions, sampleRate: 48000 }) : new BoundedDelayKernel({ ...options.processorOptions, sampleRate: 48000 });
      const value = { ...node(), source, name, parameters: new Map(Object.keys(options.parameterData).map(name => [name, param()])), port: { onmessage: null, close() {}, postMessage(message) {
        if (message.type === 'dispose') { source.panic(); value.port.onmessage?.({ data: { type: 'disposed' } }); }
      } } }; nodes.push(value);
      queueMicrotask(() => value.port.onmessage?.({ data: { type: 'ready', revision: nonlinear ? NONLINEAR_KERNEL_REVISION : alignment ? ALIGNMENT_KERNEL_REVISION : DELAY_KERNEL_REVISION,
        sampleRate: 48000, stateBytes: nonlinear ? source.state.byteLength : source.buffer.byteLength + (source.filter?.byteLength || 0), configurationKey: nonlinear ? source.identity : source.stateIdentity } }));
      return value;
    };
    const graph = await prepareNativeEffectGraph(createQuarryTape(), { context, resources, owner: 'fixture', createWorkletNode });
    expect(nodes.map(value => value.name)).to.have.members(['lemmings-nonlinear-chain-v1', 'lemmings-bounded-delay-v1', 'lemmings-fixed-fractional-delay-v1']);
    const bytes = nodes.reduce((sum, value) => sum + (value.source.state?.byteLength || value.source.buffer.byteLength + (value.source.filter?.byteLength || 0)), 0);
    expect(bytes).to.equal(graph.plan.stateBytes); graph.update('preamp', { driveDb: 9 }); graph.update('echo', { feedbackLowpassHz: 1800 });
    const receipt = graph.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(nodes.every(value => value.source.muted)).to.equal(true); expect(resources.diagnostics().exactBytes).to.equal(0);
    context.state = 'closed'; for (const callback of listeners) callback(); expect(resources.diagnostics().reservations).to.equal(0); await resources.dispose().completion;
  });
});
