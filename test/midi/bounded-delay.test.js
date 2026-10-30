import { expect } from 'chai';
import { BoundedDelayKernel } from '../../js/app/midi-ui/worklet/BoundedDelayProcessor.js';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';

const graph = () => ({ schema: 'lemmings-effect-graph/v1', id: 'fixture.echo', revision: 1, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 30,
  nodes: [{ id: 'input', kind: 'bus-in', parameters: {} }, { id: 'echo', kind: 'feedback-delay', parameters: {} }, { id: 'output', kind: 'bus-out', parameters: {} }],
  edges: [{ from: { nodeId: 'input', port: 'audio' }, to: { nodeId: 'echo', port: 'audio' }, gain01: 1 }, { from: { nodeId: 'echo', port: 'audio' }, to: { nodeId: 'output', port: 'audio' }, gain01: 1 }] });
const kernel = (rate, options = {}) => new BoundedDelayKernel({ sampleRate: rate, maxDelayFrames: 128, delayFrames: 10.5, feedback: 0, wet: 1, ...options });

describe('bounded creative delay and graph contracts (qualification deferred)', () => {
  it('restores delay/filter/transition/tone histories with exact forward continuation at each supported rate', () => {
    for (const rate of [44100, 48000, 96000]) for (const mode of ['glide', 'jump']) {
      const options = { mode, delayFrames: 20.25, feedback: 0.4, wet: 0.7, transitionFrames: 32 }, forward = kernel(rate, options), staged = kernel(rate, options);
      for (let i = 0; i < 300; i++) { if (i === 291) { forward.setDelay(43.75); forward.setFeedbackLowpassHz(1700); } forward.sample(Math.sin(i * 0.17) * 0.1, Math.cos(i * 0.13) * 0.1, 0.6, 0.8); }
      const bytes = new Uint8Array(forward.stateByteLength()), receipt = forward.snapshotInto(bytes); expect(receipt.frame).to.equal(300);
      staged.restoreFrom(bytes); expect(staged.diagnostics()).to.deep.equal(forward.diagnostics()); expect(staged.buffer).not.to.equal(forward.buffer);
      for (let i = 300; i < 1000; i++) {
        if (i === 451) { forward.setDelay(13.5); staged.setDelay(13.5); forward.setFeedbackLowpassHz(5000); staged.setFeedbackLowpassHz(5000); }
        const left = i < 600 ? Math.sin(i * 0.17) * 0.1 : 0, right = i < 600 ? Math.cos(i * 0.13) * 0.1 : 0;
        forward.sample(left, right, 0.3, 1); staged.sample(left, right, 0.3, 1); expect(staged.leftSample).to.equal(forward.leftSample); expect(staged.rightSample).to.equal(forward.rightSample);
      }
    }
  });
  it('refuses foreign/corrupt/aliased state without changing the active delay and retains panic silence', () => {
    const source = kernel(48000, { feedback: 0.4 }), bytes = new Uint8Array(source.stateByteLength()); for (let i = 0; i < 40; i++) source.sample(i === 0 ? 1 : 0, 0);
    source.snapshotInto(bytes); const bad = bytes.slice(); bad[bad.length - 1] ^= 1;
    expect(() => source.restoreFrom(bad)).to.throw('state'); const after = new Uint8Array(source.stateByteLength()); source.snapshotInto(after); expect(after).to.deep.equal(bytes);
    const foreign = kernel(48000, { feedback: 0.3 }); expect(() => foreign.restoreFrom(bytes)).to.throw('another processor');
    expect(() => source.snapshotInto(new Uint8Array(source.buffer.buffer))).to.throw('exclusively');
    source.panic(); source.snapshotInto(bytes); const staged = kernel(48000, { feedback: 0.4 }); staged.restoreFrom(bytes); staged.sample(1, 1); expect(staged.leftSample).to.equal(0); expect(staged.rightSample).to.equal(0);
  });
  for (const rate of [44100, 48000, 96000]) it('retains exact two-tap fractional impulse timing and independent stereo at ' + rate, () => {
    const source = kernel(rate), left = [], right = [];
    for (let frame = 0; frame < 32; frame++) { source.sample(frame === 0 ? 1 : 0, frame === 1 ? -1 : 0); left.push(source.leftSample); right.push(source.rightSample); }
    expect(left[10]).to.equal(0.5); expect(left[11]).to.equal(0.5); expect(right[11]).to.equal(-0.5); expect(right[12]).to.equal(-0.5);
    expect(left.filter(Boolean)).to.have.length(2); expect(right.filter(Boolean)).to.have.length(2);
  });
  it('bounds glide speed and uses only two jump taps with explicit refusal during a transition', () => {
    const glide = kernel(48000, { delayFrames: 20, maximumSlew: 0.25 }); glide.setDelay(40); glide.sample(0, 0);
    expect(glide.delay).to.equal(20.25); glide.setDelay(1); glide.sample(0, 0); expect(glide.delay).to.equal(20);
    const jump = kernel(48000, { mode: 'jump', delayFrames: 10, transitionFrames: 16 });
    for (let i = 0; i < 256; i++) jump.sample(0.5, -0.5);
    const buffer = jump.buffer; expect(jump.setDelay(20)).to.equal(true); expect(jump.setDelay(30)).to.equal(false);
    for (let i = 0; i < 16; i++) { jump.sample(0.5, -0.5); expect(jump.leftSample).to.equal(0.5); expect(jump.rightSample).to.equal(-0.5); }
    expect(jump.delay).to.equal(20); expect(jump.rejectedTransitions).to.equal(1); expect(jump.buffer).to.equal(buffer);
  });
  it('contains nonfinite feedback/input in its own state and clears old energy before explicit reactivation', () => {
    const failed = kernel(48000), other = kernel(48000); failed.sample(1, 1); failed.sample(NaN, 0); other.sample(0.5, 0.5);
    expect(failed.faults).to.equal(1); expect(failed.buffer.every(value => value === 0)).to.equal(true); expect(failed.leftSample).to.equal(0);
    expect(other.faults).to.equal(0); expect(other.buffer.some(Boolean)).to.equal(true);
    failed.inputEnabled = true; failed.muted = false; for (let i = 0; i < 256; i++) failed.sample(0, 0);
    expect(failed.leftSample).to.equal(0); expect(failed.rightSample).to.equal(0);
  });
  it('compiles a bounded deterministic stereo DAG and keeps creative delay separate from processing alignment', () => {
    const plan = prepareEffectGraphRevision(graph()); expect(plan.order).to.deep.equal(['input', 'echo', 'output']); expect(plan.latencyFrames).to.equal(0);
    expect(plan.stateBytes).to.equal((48000 + 4) * 8 + 48); expect(plan.maximumTailFrames).to.be.at.most(30 * 48000);
    expect(plan.nodes.find(node => node.id === 'echo').stateCapability).to.equal('deterministic-preroll');
    expect(plan.definition.nodes.find(node => node.id === 'echo').parameters.feedbackMaximum).to.equal(0.7);
    expect(Object.isFrozen(plan.definition)).to.equal(true);
  });
  it('rejects cycles, typed port mismatches, tail/storage overflow and duplicate edges', () => {
    for (const change of [value => value.edges.push(value.edges[0]), value => { value.edges[0].to.port = 'detectorEnvelope'; },
      value => { value.maximumTailSeconds = 0; }, value => { value.nodes.push({ id: 'gain', kind: 'gain', parameters: { gain01: 1 } });
        value.edges.push({ from: { nodeId: 'echo', port: 'audio' }, to: { nodeId: 'gain', port: 'audio' }, gain01: 1 }, { from: { nodeId: 'gain', port: 'audio' }, to: { nodeId: 'echo', port: 'audio' }, gain01: 1 }); }]) {
      const value = graph(); change(value); expect(() => prepareEffectGraphRevision(value)).to.throw();
    }
    expect(() => prepareEffectGraphRevision(graph(), { maxStateBytes: 128 })).to.throw('storage');
  });
});
