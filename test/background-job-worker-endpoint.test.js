import { compileSceneTerrainLayout, verifyCompiledSceneTerrain } from '../js/app/procgen/SceneTerrainLayout.js';
import { expect } from 'chai';
import { createBackgroundJobWorkerEndpoint } from '../js/app/resources/BackgroundJobWorkerEndpoint.js';
import { BACKGROUND_JOB_PROTOCOL } from '../js/app/resources/BackgroundJobKernels.js';
import { encodeBackgroundSnapshotPages, createBackgroundSnapshotReceiver, backgroundSnapshotTransfers } from '../js/app/resources/BackgroundSnapshotPages.js';
import { createBackgroundJobService } from '../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../js/app/resources/BackgroundWorkerAdmission.js';
import { yieldBackgroundTask } from '../js/app/resources/BackgroundTaskYield.js';
const envelope = { protocol: BACKGROUND_JOB_PROTOCOL, jobId: 'background-1', ownerEpoch: 1, sourceRevision: 'source:1' };
const limits = { maxBytes: 1048576, maxNodes: 100000, estimatedPeakBytes: 16 * 1048576 };
describe('background snapshot stream owner lifecycle', () => {
  it('transfers one original scene-terrain storage buffer through the result owner', async () => {
    const raw = { schema: 'lemmings-scene-terrain/v1', id: 'score.transfer', revision: 1, width: 128, laneHeight: 96, lanes: [{ laneId: 0, regions: [{ kind: 'solid', x1: 0, x2: 128, y1: 88, y2: 96, color: 0xff526f74 }] }] }, compiled = await compileSceneTerrainLayout(raw), originalBuffer = compiled.storage.buffer;
    let receiver, result, transferred = 0;
    const endpoint = createBackgroundJobWorkerEndpoint({ kernel: async () => ({ value: compiled, inputBytes: 512, nodes: 32, retainedBytes: compiled.bytes + 65536 }), close() {}, postMessage: (value, transfers = []) => {
      if (transfers.includes(originalBuffer)) transferred++;
      const delivered = structuredClone(value, { transfer: transfers });
      if (delivered.type === 'output-start') receiver = createBackgroundSnapshotReceiver({ ...limits, allowOwnedBinary: true });
      if (delivered.type === 'output-page') receiver.push(delivered.packet);
      if (delivered.type === 'computed') result = receiver.finish(delivered.sequence);
      if (delivered.type === 'output-start' || delivered.type === 'output-page') queueMicrotask(() => { void endpoint.receive({ ...envelope, type: 'output-ack', sequence: delivered.sequence }); });
    } });
    await endpoint.receive({ ...envelope, type: 'input-start', sequence: 0, kind: 'compile-scene-terrain', limits }); let sequence = 0;
    for await (const packet of encodeBackgroundSnapshotPages(raw, { ...limits, yieldTask: async () => {} })) { sequence = packet.sequence; await endpoint.receive({ ...envelope, type: 'input-page', packet }); }
    await endpoint.receive({ ...envelope, type: 'input-end', sequence }); expect(transferred).to.equal(1); expect(originalBuffer.byteLength).to.equal(0); expect((await verifyCompiledSceneTerrain(result)).chunks[0].topProfile[0]).to.equal(88);
  });
  it('runs exactly once after a complete stream and rejects stale packet identities', async () => {
    const messages = []; let runs = 0, closes = 0, output = null, result = null;
    const endpoint = createBackgroundJobWorkerEndpoint({ postMessage: value => {
      messages.push(value);
      if (value.type === 'output-start') output = createBackgroundSnapshotReceiver({ ...limits, allowOwnedBinary: true });
      if (value.type === 'output-page') output.push(value.packet);
      if (value.type === 'computed') result = output.finish(value.sequence);
      if (value.type === 'output-start' || value.type === 'output-page') queueMicrotask(() => { void endpoint.receive({ ...envelope, type: 'output-ack', sequence: value.sequence }); });
    }, close: () => { closes++; }, kernel: async (_kind, input) => { runs++; return { value: input, inputBytes: 100, nodes: 2 }; } });
    await endpoint.receive({ ...envelope, type: 'input-start', sequence: 0, kind: 'parse-json', limits }); expect(messages[0].type).to.equal('input-ack');
    let sequence = 0; for await (const packet of encodeBackgroundSnapshotPages({ content: 'x'.repeat(10000) }, { ...limits, yieldTask: async () => {} })) { sequence = packet.sequence; await endpoint.receive({ ...envelope, type: 'input-page', packet: structuredClone(packet, { transfer: backgroundSnapshotTransfers(packet) }) }); }
    expect(runs).to.equal(0); await endpoint.receive({ ...envelope, type: 'input-end', sequence }); expect(runs).to.equal(1); expect(result.content).to.have.length(10000); expect(closes).to.equal(1);
    const rejected = createBackgroundJobWorkerEndpoint({ postMessage: value => messages.push(value), close() {} });
    await rejected.receive({ ...envelope, type: 'input-start', sequence: 0, kind: 'parse-json', limits }); await rejected.receive({ ...envelope, ownerEpoch: 2, type: 'input-end', sequence: 0 }); expect(messages.at(-1).type).to.equal('failed');
  });
  it('streams a real parse through bounded worker messages and never includes a whole input object', async () => {
    let messages = 0, terminated = 0;
    class Worker {
      constructor() { this.endpoint = createBackgroundJobWorkerEndpoint({ postMessage: value => queueMicrotask(() => this.onmessage({ data: structuredClone(value) })), close() {} }); }
      postMessage(value, transfer = []) { expect(value).not.to.have.property('input'); messages++; const copied = structuredClone(value, { transfer }); queueMicrotask(() => { void this.endpoint.receive(copied); }); }
      terminate() { terminated++; }
    }
    const admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker, yieldTask: async () => {} });
    const source = JSON.stringify({ values: Array(20000).fill(1) }), result = await jobs.compute({ kind: 'parse-json', ownerId: 'stream', ownerEpoch: 1, sourceRevision: 'v1', estimatedPeakBytes: 16 * 1048576, maxBytes: 1048576, prepareInput: () => source });
    expect(result.value.values).to.have.length(20000); expect(result.receipt.inputTransport.packets).to.be.greaterThan(1); expect(result.receipt.outputTransport.packets).to.be.greaterThan(1); expect(messages).to.be.greaterThan(3); expect(terminated).to.equal(1); result.release(); expect(admission.diagnostics().memory.accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('settles a crash during input transfer without waiting for a missing packet acknowledgment', async () => {
    let terminated = 0, released = 0;
    class Worker {
      postMessage(value) { queueMicrotask(() => value.type === 'input-page' ? this.onerror({ preventDefault() {} }) : this.onmessage({ data: { ...value, type: 'input-ack' } })); }
      terminate() { terminated++; }
    }
    const admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker, yieldTask: async () => {} }); let failure;
    try { await jobs.compute({ kind: 'parse-json', ownerId: 'crash', ownerEpoch: 1, sourceRevision: 'v1', estimatedPeakBytes: 1048576, prepareInput: () => '{"value":1}', releasePreparedInput: () => { released++; } }); } catch (error) { failure = error; }
    await failure.backgroundRetirementCompletion; expect(failure.code).to.equal('worker-crash'); expect(terminated).to.equal(1); expect(released).to.equal(1); expect(admission.diagnostics().memory.accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('retires a canceled partial result without publishing its object or losing the running lease', async () => {
    const canceled = new AbortController(); let released = 0, terminated = 0, outputPages = 0;
    class Worker {
      constructor() { this.endpoint = createBackgroundJobWorkerEndpoint({ close() {}, postMessage: (value, transfer = []) => {
        const copy = structuredClone(value, { transfer }); queueMicrotask(() => { this.onmessage({ data: copy }); if (value.type === 'output-page' && ++outputPages === 2) canceled.abort(new Error('document replaced during result')); });
      } }); }
      postMessage(value, transfer = []) { const copy = structuredClone(value, { transfer }); queueMicrotask(() => { void this.endpoint.receive(copy); }); }
      terminate() { terminated++; this.endpoint.fail(new Error('host terminated')); }
    }
    const admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker, yieldTask: async () => {} }); let failure;
    try { await jobs.compute({ kind: 'parse-json', ownerId: 'partial-result', ownerEpoch: 1, sourceRevision: 'v1', estimatedPeakBytes: 16 * 1048576, signal: canceled.signal,
      prepareInput: () => JSON.stringify(Array(20000).fill(1)), releasePreparedInput: () => { released++; } }); } catch (error) { failure = error; }
    await failure.backgroundRetirementCompletion; expect(failure.message).to.include('document replaced'); expect(outputPages).to.be.at.least(2); expect(terminated).to.equal(1); expect(released).to.equal(1); expect(admission.diagnostics().memory.accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('uses postTask only when available and falls back to a macrotask without swallowing cancellation', async () => {
    let tasks = 0, timers = 0; const timer = callback => { timers++; callback(); };
    await yieldBackgroundTask({ scheduler: { postTask: async (_work, options) => { tasks++; expect(options.priority).to.equal('background'); } }, timer });
    await yieldBackgroundTask({ scheduler: null, timer }); await yieldBackgroundTask({ scheduler: { postTask: async () => { throw new Error('unsupported'); } }, timer });
    expect(tasks).to.equal(1); expect(timers).to.equal(2); const controller = new AbortController(); controller.abort(); let error;
    try { await yieldBackgroundTask({ signal: controller.signal, scheduler: null, timer }); } catch (failure) { error = failure; } expect(error.name).to.equal('AbortError'); expect(timers).to.equal(2);
  });
});
