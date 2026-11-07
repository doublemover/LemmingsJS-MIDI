import { expect } from 'chai';
import { MessageChannel } from 'node:worker_threads';
import { createDirectOwnedSineOutput } from '../../js/app/midi-ui/DirectOwnedSineOutput.js';
import { OwnedSineKernel, PROTOCOL, RECEIPT_WIDTH, BEGIN } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

const yieldMessages = () => new Promise(resolve => setImmediate(resolve));
async function kernelTransport() {
  const channel = new MessageChannel(), sampleRate = 48000, kernel = new OwnedSineKernel(sampleRate, 8), packets = [], budget = createResourceBudget();
  let frame = 0, released = false;
  const receipts = () => {
    for (let first = 0; first < kernel.receiptCount; first += 64) {
      const count = Math.min(64, kernel.receiptCount - first), data = new Float64Array(64 * RECEIPT_WIDTH);
      data.set(kernel.receipts.subarray(first * RECEIPT_WIDTH, (first + count) * RECEIPT_WIDTH)); channel.port2.postMessage({ type: 'receipts', protocol: PROTOCOL, count, data });
    }
    kernel.receiptCount = 0;
  };
  channel.port2.on('message', message => {
    if (message.type === 'inspect') channel.port2.postMessage({ type: 'health', protocol: PROTOCOL, requestId: message.requestId, frame: kernel.lastFrame, counters: [...kernel.counters], nonfinite: kernel.nonfinite });
    else if (message.type === 'commands') { packets.push({ data: message.data.slice(), count: message.count, sequence: message.packetSequence }); kernel.accept(message.data, message.count, message.packetSequence); receipts(); }
    else if (message.type === 'panic') { kernel.panicPending = true; }
    else if (message.type === 'retire-processor') { kernel.active.fill(0); kernel.queue.fill(0); kernel.queueLength = 0; released = true; channel.port2.postMessage({ type: 'processor-retired', protocol: PROTOCOL, retirementProtocol: 1, retirementId: message.retirementId, stage: 'processor-state-released', frame, renderingContinues: false }); }
  });
  const output = await createDirectOwnedSineOutput({ port: channel.port1, sampleRate, resourceBudget: budget, now: () => frame * 1000 / sampleRate });
  return { output, kernel, packets, budget, async render(count) {
    const left = new Float32Array(count), right = new Float32Array(count);
    for (let first = 0; first < count; first += 128) { const end = Math.min(count, first + 128); kernel.render(left.subarray(first, end), right.subarray(first, end), frame); frame += end - first; receipts(); }
    await yieldMessages(); await yieldMessages(); return { left, right };
  }, async close() { const receipt = output.dispose(); await receipt.completion; channel.port2.close(); expect(receipt.outcome).to.equal('complete'); expect(released).to.equal(true); } };
}
const score = (beat = 0) => ({ epoch: 'fixture.score', simTick: 1, subTick: 0, precision: 'tick', beat });
const onset = (voiceId, actorId, generation = 1) => ({ version: 1, kind: 'begin', route: 'local', voiceId, onsetId: 'onset.' + voiceId, intentId: 'intent.' + voiceId, worldId: 'fixture.world', generation, actorId, laneId: 0,
  pitch: { cents: 6012.34567, referenceHz: 440 }, velocity01: .73, expression: { pressure01: .61, pan01: 0 }, sourceEventIds: ['fact.' + actorId], scoreTime: score() });

describe('independent owned audio producer through the actual sine kernel', function() {
  this.timeout(10000);
  it('keeps same-pitch owners and non7bit pitch/expression exact through real transferred packets and render receipts', async () => {
    const fixture = await kernelTransport(), output = fixture.output;
    try {
      output.observe(score(), { bpm: 120, executionEpoch: 'fixture.execution', generation: 1 });
      const handle = output.backend.registerExecution({ executionEpoch: 'fixture.execution', generation: 1 }).execution, frame = output.sinks[0].toTargetFrame(score());
      expect(output.backend.begin(onset('a', 7), frame, handle).status).to.equal('accepted'); expect(output.backend.begin(onset('b', 8), frame, handle).status).to.equal('accepted');
      expect(output.backend.update('a', { pitchOffsetCents: .17531, pressure01: .43129, pan01: -.2473 }, frame + 1200, handle).status).to.equal('accepted');
      expect(output.backend.end('a', { seconds: .025 }, frame + 3600, handle).status).to.equal('accepted');
      expect(output.backend.end('b', { seconds: .025 }, frame + 4800, handle).status).to.equal('accepted'); await output.flushSourceControls();
      const reference = new OwnedSineKernel(48000, 8); for (const packet of fixture.packets) reference.accept(packet.data, packet.count, packet.sequence);
      const expected = { left: new Float32Array(16384), right: new Float32Array(16384) }; reference.render(expected.left, expected.right, 0);
      const actual = await fixture.render(16384); expect(actual.left).to.deep.equal(expected.left); expect(actual.right).to.deep.equal(expected.right);
      const beginnings = fixture.packets.flatMap(packet => Array.from({ length: packet.count }, (_, index) => packet.data.subarray(index * 18, (index + 1) * 18))).filter(row => row[3] === BEGIN);
      expect(beginnings).to.have.length(2); expect(beginnings[0][4]).not.to.equal(beginnings[1][4]); expect(beginnings[0][6]).to.equal(440 * 2 ** ((6012.34567 - 6900) / 1200));
      expect(output.diagnostics()).to.include({ activeVoices: 0, inFlight: 0, renderedCommands: 5, renderedEnds: 2 }); expect(Math.max(...actual.left.map(Math.abs))).to.be.greaterThan(.001);
    } finally { await fixture.close(); }
  });
  it('waits for real cancellation and terminal receipts while preserving the other execution', async () => {
    const fixture = await kernelTransport(), output = fixture.output;
    try {
      output.observe(score(), { bpm: 120, executionEpoch: 'fixture.execution', generation: 1 });
      const a = output.backend.registerExecution({ executionEpoch: 'fixture.a', generation: 1 }).execution, b = output.backend.registerExecution({ executionEpoch: 'fixture.b', generation: 2 }).execution, frame = output.sinks[0].toTargetFrame(score());
      output.backend.begin(onset('a', 7), frame, a); output.backend.begin(onset('b', 8, 2), frame, b); await output.flushSourceControls(); await fixture.render(10000);
      const receipt = output.backend.cancelGenerationWithReceipt(1, a).retirement; expect(receipt.outcome).to.equal('pending');
      await yieldMessages(); await yieldMessages(); await fixture.render(1024); await receipt.completion;
      expect(receipt.outcome).to.equal('complete'); expect(output.diagnostics().activeVoices).to.equal(1); expect(fixture.kernel.active.reduce((sum, value) => sum + value, 0)).to.equal(1);
      expect(output.backend.update('a', { pressure01: .2 }, 12000, a).status).to.equal('rejected');
    } finally { await fixture.close(); }
  });
});
