import { expect } from 'chai';
import { createBackgroundJobWorkerEndpoint } from '../../js/app/resources/BackgroundJobWorkerEndpoint.js';
import { createBackgroundJobService } from '../../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';
import { runBackgroundJobKernel } from '../../js/app/resources/BackgroundJobKernels.js';
import { encodeMidiClipFile } from '../../js/midi/protocol/MidiClipFile.js';

const input = () => ({ ppq: 960, configurationEndTick: 0, endTick: 1920,
  sequence: { ticks: new Float64Array([0, 960]), offsets: new Uint32Array([0, 2, 4]), words: new Uint32Array([0x4f923c00, 0x12340000, 0x4f823c00, 0xabcd0000]) } });
const limits = { maxBytes: 1048576, estimatedPeakBytes: 64 * 1048576 };

describe('MIDI Clip admitted worker transport', () => {
  it('transfers encoded bytes and all six decoded columns under independent result owners', async () => {
    let terminated = 0, outputTransfers = 0;
    class Worker {
      constructor() { this.endpoint = createBackgroundJobWorkerEndpoint({ close() {}, postMessage: (value, transfers = []) => {
        outputTransfers += transfers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
        const copy = structuredClone(value, { transfer: transfers }); queueMicrotask(() => this.onmessage({ data: copy }));
      } }); }
      postMessage(value, transfers = []) { const copy = structuredClone(value, { transfer: transfers }); queueMicrotask(() => { void this.endpoint.receive(copy); }); }
      terminate() { terminated++; }
    }
    const admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker, yieldTask: async () => {} });
    const take = input(), expected = await encodeMidiClipFile(take, { ...limits, yieldControl: async () => {} });
    const encoded = await jobs.compute({ ...limits, kind: 'encode-midi-clip', ownerId: 'clip-export', ownerEpoch: 1, sourceRevision: 'take:1', prepareInput: () => take });
    expect(encoded.value.bytes).to.deep.equal(expected.bytes); expect(encoded.receipt.method).to.equal('dedicated-worker');
    expect(encoded.receipt.outputTransport.ownedTransferredBytes).to.equal(expected.bytes.byteLength); expect(outputTransfers).to.equal(expected.bytes.byteLength);
    const decoded = await jobs.compute({ ...limits, kind: 'decode-midi-clip', ownerId: 'clip-import', ownerEpoch: 1, sourceRevision: 'file:1', prepareInput: () => ({ bytes: encoded.value.bytes }) });
    expect(decoded.value.sequence).to.deep.equal(take.sequence); expect(decoded.value.endTick).to.equal(1920);
    const decodedBytes = [decoded.value.configuration, decoded.value.sequence].reduce((sum, columns) => sum + columns.ticks.byteLength + columns.offsets.byteLength + columns.words.byteLength, 0);
    expect(decoded.receipt.outputTransport.ownedTransferredBytes).to.equal(decodedBytes);
    expect(decoded.value.report.setupDisposition).to.equal('data-only-never-submitted'); expect(terminated).to.equal(2);
    encoded.release(); decoded.release(); expect(admission.diagnostics().memory.accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('requires a worker instead of synchronously parsing imported files on the owner thread', async () => {
    const admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null });
    for (const kind of ['encode-midi-clip', 'decode-midi-clip']) {
      let error; try { await jobs.compute({ ...limits, kind, ownerId: 'clip', ownerEpoch: 1, sourceRevision: '1', prepareInput: input }); } catch (caught) { error = caught; }
      expect(error).to.have.property('code', 'worker-required');
    }
    expect(admission.diagnostics().memory.accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('retains explicit kernel limits and refuses malformed input without output', async () => {
    const encoded = await runBackgroundJobKernel('encode-midi-clip', input(), { ...limits, yieldControl: async () => {} });
    expect(encoded.retainedBytes).to.equal(encoded.value.bytes.byteLength * 2 + 65536);
    let error; try { await runBackgroundJobKernel('decode-midi-clip', { bytes: encoded.value.bytes.subarray(0, 57) }, limits); } catch (caught) { error = caught; }
    expect(error).to.have.property('code', 'file-length');
  });
});
