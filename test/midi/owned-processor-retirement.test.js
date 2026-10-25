import { expect } from 'chai';
import { retireOwnedProcessorState } from '../../js/app/midi-ui/OwnedProcessorRetirement.js';
import { OwnedSineProcessor } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';

describe('owned processor state retirement (protocol fixtures awaiting the combined pass)', () => {
  it('drops the real processor kernel before acknowledging and refuses further rendering', async () => {
    const saved = { port: Object.getOwnPropertyDescriptor(OwnedSineProcessor.prototype, 'port'), rate: Object.getOwnPropertyDescriptor(globalThis, 'sampleRate') };
    const main = { onmessage: null, close() { this.closed = true; }, postMessage(data) { thread.onmessage?.({ data }); } };
    const thread = { onmessage: null, postMessage(data) { main.onmessage?.({ data }); } };
    Object.defineProperty(OwnedSineProcessor.prototype, 'port', { configurable: true, value: thread }); globalThis.sampleRate = 48000;
    try {
      const processor = new OwnedSineProcessor({ processorOptions: { maxVoices: 1 } }), receipt = await retireOwnedProcessorState({ port: main }, { state: 'running' });
      expect(receipt).to.include({ stage: 'processor-state-released', renderingContinues: false, acousticReceipt: false });
      expect(processor.kernel).to.equal(null); expect(thread.onmessage).to.equal(null); expect(main.closed).to.equal(true);
      const outputs = [[new Float32Array(128).fill(1), new Float32Array(128).fill(1)]];
      expect(processor.process([], outputs)).to.equal(false); expect(outputs[0][0].every(value => value === 0)).to.equal(true);
    } finally {
      for (const [target, key, descriptor] of [[OwnedSineProcessor.prototype, 'port', saved.port], [globalThis, 'sampleRate', saved.rate]]) {
        if (descriptor) Object.defineProperty(target, key, descriptor); else delete target[key];
      }
    }
  });
  it('keeps a missing acknowledgement unknown and retains the concrete producer for recovery', async () => {
    const node = { port: { postMessage() {}, close() {} } }, context = { state: 'running' }; let error;
    try { await retireOwnedProcessorState(node, context, { timeoutMs: 1 }); } catch (value) { error = value; }
    expect(error?.message).to.include('timed out'); expect(error.retainedProducer.node).to.equal(node); expect(error.retainedProducer.context).to.equal(context);
  });
  it('accepts confirmed context closure while rejecting forged same-request completion', async () => {
    const listeners = new Set(), context = { state: 'running', addEventListener(type, listener) { listeners.add(listener); }, removeEventListener(type, listener) { listeners.delete(listener); } };
    const node = { port: { close() {}, postMessage() { context.state = 'closed'; for (const listener of listeners) listener(); } } };
    expect((await retireOwnedProcessorState(node, context)).stage).to.equal('closed-context'); expect(listeners.size).to.equal(0);
    context.state = 'running'; node.port.postMessage = data => node.port.onmessage({ data: { type: 'processor-retired', retirementId: data.retirementId, protocol: 1, retirementProtocol: 1, stage: 'processor-state-released', frame: 0, renderingContinues: true } });
    let error; try { await retireOwnedProcessorState(node, context); } catch (value) { error = value; }
    expect(error?.message).to.equal('Invalid owned processor retirement receipt.'); expect(listeners.size).to.equal(0);
  });
});
