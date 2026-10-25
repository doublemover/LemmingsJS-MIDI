import { expect } from 'chai';
import { encodeBackgroundSnapshotPages, createBackgroundSnapshotReceiver, backgroundSnapshotTransfers, BACKGROUND_SNAPSHOT_PACKET_BYTES, BACKGROUND_SNAPSHOT_PACKET_OPERATIONS } from '../js/app/resources/BackgroundSnapshotPages.js';
const limits = { maxBytes: 1048576, maxNodes: 100000, estimatedPeakBytes: 16 * 1048576 };
const roundTrip = async (value, extra = {}) => {
  const receiver = createBackgroundSnapshotReceiver({ ...limits, ...extra.receiverOptions }), packets = []; let sequence = 0;
  for await (const packet of encodeBackgroundSnapshotPages(value, { ...limits, yieldTask: async () => {}, ...extra })) {
    packets.push({ bytes: packet.bytes, operations: packet.operations.length }); sequence = packet.sequence;
    const transferred = structuredClone(packet, { transfer: backgroundSnapshotTransfers(packet) }); receiver.push(transferred);
  }
  return { value: receiver.finish(sequence), packets };
};
describe('bounded owned background snapshot pages', () => {
  it('copies actual binary views in bounded transferable pages without detaching live sources', async () => {
    const source = new Float32Array(60000); source[34] = -.25; const sharedView = source.subarray(10, 50);
    const input = { source, sharedView, bytes: new DataView(new Uint8Array([1, 2, 3, 4]).buffer), text: 'x\ud800'.repeat(20000), nested: [null, undefined, -0, { yes: true }] };
    const result = await roundTrip(input); expect(result.value).to.deep.equal(input); expect(Object.is(result.value.nested[2], -0)).to.equal(true);
    expect(source.byteLength).to.equal(240000); expect(source[34]).to.equal(-.25); expect(result.value.source.buffer).not.to.equal(source.buffer);
    expect(result.packets.length).to.be.greaterThan(2); expect(result.packets.every(packet => packet.bytes <= BACKGROUND_SNAPSHOT_PACKET_BYTES && packet.operations <= BACKGROUND_SNAPSHOT_PACKET_OPERATIONS)).to.equal(true);
  });
  it('moves only explicitly owned complete result buffers and refuses aliases before publishing', async () => {
    const source = new Uint8Array(100000); source[10] = 7;
    const result = await roundTrip({ bytes: source }, { ownedTransferBuffers: new Set([source.buffer]), receiverOptions: { allowOwnedBinary: true } });
    expect(result.value.bytes[10]).to.equal(7); expect(source.buffer.byteLength).to.equal(0); expect(result.packets).to.have.length(1);
    const alias = new Uint8Array(4); let failure;
    try { await roundTrip({ a: alias, b: alias }, { ownedTransferBuffers: new Set([alias.buffer]), receiverOptions: { allowOwnedBinary: true } }); } catch (error) { failure = error; }
    expect(failure.message).to.include('more than once');
  });
  it('cooperatively receives object results and keeps incomplete results unpublished on cancellation', async () => {
    const receiver = createBackgroundSnapshotReceiver(limits), canceled = new AbortController(); let clock = 0, yielded = 0, failure;
    try { for await (const packet of encodeBackgroundSnapshotPages(Array(3000).fill(1), { ...limits, yieldTask: async () => {} })) await receiver.pushCooperative(packet, {
      signal: canceled.signal, now: () => clock++, yieldTask: async () => { yielded++; canceled.abort(new Error('owner gone')); }
    }); } catch (error) { failure = error; }
    expect(yielded).to.equal(1); expect(failure.message).to.equal('owner gone'); expect(() => receiver.finish(0)).to.throw('Incomplete'); receiver.dispose();
  });
  it('yields during large array enumeration and checks cancellation before further pages', async () => {
    let yields = 0, clock = 0; const canceled = new AbortController(); let failure;
    try { await roundTrip(Array(20000).fill(1), { now: () => clock++, signal: canceled.signal, yieldTask: async () => { if (++yields === 2) canceled.abort(new Error('source replaced')); } }); } catch (error) { failure = error; }
    expect(yields).to.equal(2); expect(failure.message).to.equal('source replaced');
  });
  it('rejects getters, cycles, sparse arrays, custom hooks and shared live buffers', async () => {
    const cycle = {}; cycle.self = cycle;
    const inputs = [cycle, new Array(2), { get value() { throw new Error('getter must not execute'); } }, { toJSON() {} }];
    if (typeof globalThis.SharedArrayBuffer === 'function') inputs.push(new Uint8Array(new globalThis.SharedArrayBuffer(8)));
    for (const input of inputs) { let error; try { await roundTrip(input); } catch (failure) { error = failure; } expect(error?.name).to.equal('BackgroundSnapshotError'); }
  });
  it('refuses duplicate/reordered/incomplete packets and cumulative expansion before completion', async () => {
    const packets = []; for await (const packet of encodeBackgroundSnapshotPages({ text: 'a'.repeat(20000) }, { ...limits, yieldTask: async () => {} })) packets.push(packet);
    const receiver = createBackgroundSnapshotReceiver(limits); receiver.push(packets[0]); expect(() => receiver.push(packets[0])).to.throw('Stale'); expect(() => receiver.finish(999)).to.throw('Incomplete'); receiver.dispose();
    const tight = createBackgroundSnapshotReceiver({ maxBytes: 10, maxNodes: 100, estimatedPeakBytes: 4096 }); expect(() => tight.push(packets[0])).to.throw();
  });
  it('cannot create unbounded zero-length nested scalar staging without consuming nodes', () => {
    const receiver = createBackgroundSnapshotReceiver(limits), operations = [['string', 0], ['string', 0]], bytes = operations.reduce((sum, op) => sum + 64 + op.reduce((n, value) => n + (typeof value === 'string' ? value.length * 2 : 8), 0), 0);
    expect(() => receiver.push({ schema: 'owned-background-snapshot-pages/v1', sequence: 1, operations, bytes })).to.throw('writable');
  });
});
