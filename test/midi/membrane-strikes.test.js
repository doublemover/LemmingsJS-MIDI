import { expect } from 'chai';
import { createRectangularMembraneRecipe } from '../../js/midi/content/RectangularMembraneRecipe.js';
import { RectangularMembraneKernel } from '../../js/app/midi-ui/worklet/RectangularMembraneKernel.js';
import { createMembraneStrikeTransport } from '../../js/app/midi-ui/MembraneStrikeTransport.js';

const create = () => new RectangularMembraneKernel({ parameters: createRectangularMembraneRecipe().graph.nodes.find(node => node.kind === 'rectangular-membrane').parameters });
const command = (token, frame = 0, values = {}) => ({ token, frame, x01: 0.2, y01: 0.7, amplitude01: 0.6, pulseIndex: 0, ...values });
describe('finite spatial exciters on one persistent membrane', () => {
  it('prepares area-normalized finite pulses and emits exact application and completion receipts', () => {
    const kernel = create();
    for (const pulse of kernel.profile.pulses) { expect(pulse.coefficients.reduce((a, b) => a + b, 0)).to.be.closeTo(1, 1e-12); expect(pulse.coefficients[0]).to.equal(0); expect(pulse.coefficients.at(-1)).to.equal(0); }
    expect(kernel.enqueueStrike(command(1, 37))).to.equal(true);
    const end = 37 + kernel.profile.pulses[0].frames;
    for (let frame = 0; frame < end; frame++) { kernel.sample(0, 0); if (frame < 37) expect(kernel.energy).to.equal(0); }
    expect(Array.from(kernel.strikes.drainReceipts())).to.deep.equal([1, 1, 37, 0, 3, 1, end, 0]);
    expect(kernel.strikes.diagnostics().activeExciters).to.equal(0); expect(kernel.energy).to.be.greaterThan(0);
    let prior = kernel.energy;
    for (let frame = 0; frame < 500; frame++) { kernel.sample(0, 0); expect(kernel.energy).to.be.at.most(prior + 1e-11); prior = kernel.energy; }
  });
  it('superposes independent spatial forces without cloning or restarting the shared wave state', () => {
    const a = create(), b = create(), shared = create(); a.enqueueStrike(command(1, 0)); b.enqueueStrike(command(2, 29, { x01: 0.8, y01: 0.3 })); shared.enqueueStrike(command(1, 0)); shared.enqueueStrike(command(2, 29, { x01: 0.8, y01: 0.3 }));
    let error = 0;
    for (let frame = 0; frame < 1000; frame++) { a.sample(0, 0); b.sample(0, 0); shared.sample(0, 0); error = Math.max(error, Math.abs(shared.leftSample - a.leftSample - b.leftSample)); }
    expect(error).to.be.lessThan(1e-11); expect(shared.faults).to.equal(0); expect(shared.overflows).to.equal(0);
  });
  it('orders the bounded queue, rejects late/duplicate commands, and declines a fifth overlapping exciter', () => {
    const kernel = create(); kernel.enqueueStrike(command(6, 100));
    for (let token = 5; token >= 1; token--) expect(kernel.enqueueStrike(command(token, 1))).to.equal(true);
    expect(kernel.enqueueStrike(command(1, 2))).to.equal(false); kernel.sample(0, 0); kernel.sample(0, 0);
    expect(Array.from(kernel.strikes.drainReceipts())).to.deep.equal([1, 1, 1, 0, 1, 2, 1, 0, 1, 3, 1, 0, 1, 4, 1, 0, 2, 5, 1, 2]);
    expect(kernel.enqueueStrike(command(7, 0))).to.equal(false);
    const full = create(); for (let token = 1; token <= 64; token++) expect(full.enqueueStrike(command(token, 1000 + token))).to.equal(true);
    expect(full.enqueueStrike(command(65, 2000))).to.equal(false); expect(full.strikes.queued).to.equal(64);
  });
  it('restores queued commands, active finite cursors, wave state and pending receipts exactly', () => {
    const a = create(), b = create(); a.enqueueStrike(command(1, 3)); a.enqueueStrike(command(2, 199));
    for (let frame = 0; frame < 51; frame++) a.sample(0, 0);
    const bytes = new Uint8Array(a.snapshotBytes); a.snapshotInto(bytes); b.restoreFrom(bytes);
    for (let frame = 51; frame < 600; frame++) { a.sample(0, 0); b.sample(0, 0); expect(a.leftSample).to.equal(b.leftSample); expect(a.energy).to.equal(b.energy); }
    expect(a.strikes.drainReceipts()).to.deep.equal(b.strikes.drainReceipts()); expect(a.planes).to.deep.equal(b.planes);
    a.panic(); a.snapshotInto(bytes); b.restoreFrom(bytes); expect(b.strikes.queued).to.equal(0); expect(b.muted).to.equal(true);
  });
  it('clears queued and active finite sources on panic without creating another onset', () => {
    const kernel = create(); kernel.enqueueStrike(command(1)); kernel.enqueueStrike(command(2, 1000)); kernel.sample(0, 0); kernel.strikes.drainReceipts(); kernel.panic(1);
    expect(Array.from(kernel.strikes.drainReceipts())).to.deep.equal([2, 2, 1, 3, 3, 1, 1, 3]); expect(kernel.energy).to.equal(0); expect(kernel.enqueueStrike(command(3, 2000))).to.equal(false);
  });
});

describe('native finite-body command ownership', () => {
  const fixture = () => {
    const profile = create().profile, messages = [], receipts = [], faults = [], context = { sampleRate: 48000, currentTime: 0 };
    const transport = createMembraneStrikeTransport({ profile, node: { port: { postMessage: packet => messages.push(packet) } }, context, nodeId: 'skin', graphDefinitionHash: 'a'.repeat(64), onReceipt: packet => receipts.push(packet), onUnknown: error => faults.push(error) });
    const queue = token => transport.consume({ type: 'body-strike-admission', revision: profile.revision, token, frame: 0, accepted: true, reasonCode: 0, muted: false });
    const deliver = data => transport.consume({ type: 'body-strike-receipts', revision: profile.revision, data: new Float64Array(data) });
    return { profile, transport, messages, receipts, faults, queue, deliver };
  };
  it('keeps queue submission separate from exact DSP application and end evidence', () => {
    const f = fixture(), receipt = f.transport.enqueue(command(1, 128)); expect(receipt.appliedFrame).to.equal(null); expect(receipt.acousticReceipt).to.equal(false); f.queue(1);
    expect(f.transport.state().pending).to.equal(1); f.deliver([1, 1, 128, 0, 3, 1, 128 + f.profile.pulses[0].frames, 0]); f.transport.assertComplete();
    expect(f.receipts.map(value => value.stage)).to.deep.equal(['body-strike-dsp-queued', 'body-strike-applied', 'body-strike-ended']); expect(f.receipts[1].appliedFrame).to.equal(128);
    expect(f.transport.lastDriveFrame()).to.equal(128 + f.profile.pulses[0].frames);
  });
  it('validates a whole receipt packet before releasing a command with malformed trailing evidence', () => {
    const f = fixture(); f.transport.enqueue(command(1, 128)); f.queue(1); f.deliver([1, 1, 128, 0, 3, 99, 320, 0]);
    expect(f.transport.state().pending).to.equal(1); expect(f.transport.state().applied).to.equal(0); expect(f.faults).to.have.length(1); expect(() => f.transport.assertComplete()).to.throw(); expect(() => f.transport.enqueue(command(2, 256))).to.throw('unresolved');
  });
  it('retains delivery uncertainty and enforces the live scheduling horizon', () => {
    const f = fixture(); expect(() => f.transport.enqueue(command(1, 48001))).to.throw('bounded frame');
    const transport = createMembraneStrikeTransport({ profile: f.profile, node: { port: { postMessage() { throw new Error('lost transport'); } } }, context: { sampleRate: 48000, currentTime: 0 }, nodeId: 'skin', graphDefinitionHash: 'a'.repeat(64), onReceipt() {}, onUnknown() {} });
    expect(() => transport.enqueue(command(1, 128))).to.throw('lost transport'); expect(transport.state().pending).to.equal(1); expect(transport.state().blocked).to.equal(true);
  });
});
