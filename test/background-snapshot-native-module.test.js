import { expect } from 'chai';
import { encodeBackgroundSnapshotPages, createBackgroundSnapshotReceiver, backgroundSnapshotTransfers, BACKGROUND_SNAPSHOT_WASM_MODULE_ESTIMATE_BYTES } from '../js/app/resources/BackgroundSnapshotPages.js';
import { createBackgroundJobWorkerEndpoint } from '../js/app/resources/BackgroundJobWorkerEndpoint.js';
import { BACKGROUND_JOB_PROTOCOL } from '../js/app/resources/BackgroundJobKinds.js';

const limits = { maxBytes: 32 * 1048576, maxNodes: 256, estimatedPeakBytes: 64 * 1048576 }, refused = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected refusal.'); };
const packets = async (value, extra = {}) => { const result = []; for await (const packet of encodeBackgroundSnapshotPages(value, { ...limits, yieldTask: async () => {}, ...extra })) result.push(packet); return result; };

describe('explicit native module snapshot capability (fixtures unrun; no module execution)', () => {
  let module;
  before(async () => { module = await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); });
  it('clones one compiled module with owned data and charges the declared code estimate without putting it in a transfer list', async () => {
    const heap = new Uint8Array(65536); heap[11] = 7; const receiver = createBackgroundSnapshotReceiver({ ...limits, allowOwnedWasmModule: true }); let sequence = 0;
    for (const packet of await packets({ compiledModule: module, heap }, { allowOwnedWasmModule: true })) {
      expect(backgroundSnapshotTransfers(packet).every(value => value instanceof ArrayBuffer)).to.equal(true); receiver.push(structuredClone(packet, { transfer: backgroundSnapshotTransfers(packet) })); sequence = packet.sequence;
    }
    const receipt = receiver.diagnostics(), value = receiver.finish(sequence); expect(value.compiledModule).to.be.instanceOf(WebAssembly.Module); expect(WebAssembly.Module.exports(value.compiledModule)).to.deep.equal([]); expect(value.heap[11]).to.equal(7); expect(heap.byteLength).to.equal(65536); expect(WebAssembly.Module.exports(module)).to.deep.equal([]); expect(receipt.nativeModules).to.equal(1); expect(receipt.nativeModuleEstimateBytes).to.equal(BACKGROUND_SNAPSHOT_WASM_MODULE_ESTIMATE_BYTES); expect(receipt.retainedEstimateBytes).to.be.greaterThan(2 * BACKGROUND_SNAPSHOT_WASM_MODULE_ESTIMATE_BYTES);
  });
  it('rejects native objects by default at both ends and enforces the one-module and footprint limits', async () => {
    expect((await refused(() => packets(module))).message).to.include('prototype');
    const [packet] = await packets(module, { allowOwnedWasmModule: true }); expect(() => createBackgroundSnapshotReceiver(limits).push(packet)).to.throw('unadmitted');
    expect((await refused(() => packets({ a: module, b: module }, { allowOwnedWasmModule: true }))).message).to.include('one unique'); expect((await refused(() => packets(module, { allowOwnedWasmModule: true, maxBytes: 1048576 }))).message).to.include('result limit'); expect((await refused(() => packets(module, { allowOwnedWasmModule: true, estimatedPeakBytes: 1048576 }))).message).to.include('footprint');
    expect(() => createBackgroundSnapshotReceiver({ ...limits, allowOwnedWasmModule: 'yes' })).to.throw('boolean'); expect((await refused(() => packets(module, { allowOwnedWasmModule: 'yes' }))).message).to.include('boolean');
  });
  it('rejects a prototype spoof and canceled source without compiling or executing project data', async () => {
    const fake = Object.create(WebAssembly.Module.prototype); expect((await refused(() => packets(fake, { allowOwnedWasmModule: true }))).message).to.include('prototype');
    const [original] = await packets(module, { allowOwnedWasmModule: true }), changed = { ...original, operations: [['owned-wasm-module', fake]] }; expect(() => createBackgroundSnapshotReceiver({ ...limits, allowOwnedWasmModule: true }).push(changed)).to.throw('unadmitted');
    const controller = new AbortController(); controller.abort(new Error('Canceled source fixture')); expect((await refused(() => packets(module, { allowOwnedWasmModule: true, signal: controller.signal }))).message).to.include('Canceled source');
  });
  const endpointFixture = async kind => {
    const envelope = { protocol: BACKGROUND_JOB_PROTOCOL, jobId: 'background-1', ownerEpoch: 1, sourceRevision: 'module-fixture' }, observed = [], receiver = createBackgroundSnapshotReceiver({ ...limits, allowOwnedWasmModule: true, allowOwnedBinary: true }); let endpoint, sequence = 0, closed = 0;
    endpoint = createBackgroundJobWorkerEndpoint({ identity: () => ({ activeExecution: 'bound', buildId: 'a'.repeat(64) }), compareIdentity: () => true, close: () => closed++, kernel: async () => ({ value: { compiledModule: module, heap: new Uint8Array(32) }, inputBytes: 1, nodes: 2, retainedBytes: BACKGROUND_SNAPSHOT_WASM_MODULE_ESTIMATE_BYTES + 65536 }),
      postMessage(message, transfer = []) { const value = structuredClone(message, { transfer }); observed.push(value); if (value.type === 'output-page') { receiver.push(value.packet); sequence = value.sequence; } if (['output-start', 'output-page'].includes(value.type)) queueMicrotask(() => { void endpoint.receive({ ...envelope, type: 'output-ack', sequence: value.sequence }); }); }
    });
    await endpoint.receive({ ...envelope, type: 'input-start', sequence: 0, kind, limits, requiredIdentity: { activeExecution: 'bound', buildId: 'a'.repeat(64) } });
    let inputSequence = 0; for (const packet of await packets({})) { inputSequence = packet.sequence; await endpoint.receive({ ...envelope, type: 'input-page', packet }); }
    await endpoint.receive({ ...envelope, type: 'input-end', sequence: inputSequence });
    return { observed, receiver, sequence, closed };
  };
  it('allows the native output only for the exact worker image job and rejects it from ordinary computations', async () => {
    const accepted = await endpointFixture('prepare-stretch-core-image'); expect(accepted.observed.at(-1).type).to.equal('computed'); expect(accepted.receiver.finish(accepted.sequence).compiledModule).to.be.instanceOf(WebAssembly.Module); expect(accepted.closed).to.equal(1);
    const rejected = await endpointFixture('parse-json'); expect(rejected.observed.at(-1).type).to.equal('failed'); expect(rejected.observed.some(value => value.type === 'computed')).to.equal(false); rejected.receiver.dispose(); expect(rejected.closed).to.equal(1);
  });
  it('ignores a forged ingress capability and rejects native input before invoking its kernel', async () => {
    const envelope = { protocol: BACKGROUND_JOB_PROTOCOL, jobId: 'background-1', ownerEpoch: 1, sourceRevision: 'input-fixture' }, observed = []; let calls = 0;
    const endpoint = createBackgroundJobWorkerEndpoint({ identity: () => ({ activeExecution: 'bound' }), compareIdentity: () => true, close() {}, postMessage: value => observed.push(value), kernel: async () => { calls++; return {}; } });
    await endpoint.receive({ ...envelope, type: 'input-start', sequence: 0, kind: 'parse-json', limits: { ...limits, allowOwnedWasmModule: true } });
    for (const packet of await packets(module, { allowOwnedWasmModule: true })) await endpoint.receive({ ...envelope, type: 'input-page', packet });
    expect(calls).to.equal(0); expect(observed.at(-1).type).to.equal('failed');
  });
});
