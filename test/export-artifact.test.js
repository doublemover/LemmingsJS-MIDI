import { expect } from 'chai';
import { aggregateExportDeliveries, deliverArtifactToAnchor, deliverArtifactToFileHandle,
  prepareExportArtifact, requestExportFileHandle } from '../js/app/export/ExportArtifact.js';

const prepare = (bytes = Uint8Array.of(1, 2, 3), overrides = {}) => prepareExportArtifact({ bytes,
  immutableSourceRef: 'take:fixture:1', formatVersion: 'midi/v1', suggestedFilename: 'take.mid', ...overrides });
const anchor = (failClick = false) => {
  const calls = [], blobs = [], timers = [];
  const link = { click() { calls.push('click'); if (failClick) throw new Error('click failed'); }, remove() { calls.push('remove'); } };
  const document = { createElement() { calls.push('create'); return link; }, body: { append() { calls.push('append'); } } };
  const windowRef = { Blob, URL: { createObjectURL(blob) { blobs.push(blob); calls.push('url'); return 'blob:test'; }, revokeObjectURL() { calls.push('revoke'); } },
    setTimeout(callback) { timers.push(callback); } };
  return { document, windowRef, calls, blobs, timers };
};

describe('prepared export artifacts and delivery receipts', () => {
  it('preflights bounded byte staging and preserves UTF-8 across chunk boundaries', async () => {
    expect(() => prepare(new Uint8Array(5), { maxBytes: 4 })).to.throw(RangeError);
    expect(() => prepare('éé', { maxBytes: 3 })).to.throw(RangeError);
    const source = 'a'.repeat(65535) + '𝄞' + 'z';
    const artifact = prepare(source, { maxBytes: 65541 });
    const lease = artifact.borrow();
    expect(await lease.blob.text()).to.equal(source);
    expect(artifact.metadata().byteLength).to.equal(65540);
    lease.release(); artifact.discard();
  });
  it('freezes source bytes and retries an anchor request without rerendering', async () => {
    const source = Uint8Array.of(1, 2, 3), artifact = prepare(source);
    source[0] = 99;
    const first = anchor(true), failed = deliverArtifactToAnchor(artifact, first);
    expect(failed).to.include({ state: 'failed', bytesWritten: 0 });
    expect(first.calls.at(-1)).to.equal('revoke');
    const second = anchor(), requested = deliverArtifactToAnchor(artifact, second);
    expect(requested).to.include({ artifactId: failed.artifactId, state: 'delivery-requested', evidence: 'anchor-click-returned' });
    expect([...new Uint8Array(await second.blobs[0].arrayBuffer())]).to.deep.equal([1, 2, 3]);
    expect(artifact.metadata().activeLeases).to.equal(0);
    expect(await artifact.digest()).to.match(/^[a-f0-9]{64}$/);
    second.timers[0](); expect(second.calls.at(-1)).to.equal('revoke');
    artifact.discard(); expect(deliverArtifactToAnchor(artifact, anchor()).errorKind).to.equal('artifact-expired');
  });

  it('distinguishes a completed file close from failed writes and unknown close outcomes', async () => {
    class ChunkBlob extends Blob {
      stream() { return new globalThis.ReadableStream({ start(controller) {
        for (const size of [50000, 75000, 75000]) controller.enqueue(new Uint8Array(size));
        controller.close();
      } }); }
    }
    const artifact = prepare(new ChunkBlob([new Uint8Array(200000)]));
    const run = async failAt => {
      const calls = [], writer = { async write(chunk) { calls.push(['write', chunk.byteLength]); if (calls.filter(call => call[0] === 'write').length === failAt) throw new Error('write failed'); },
        async close() { calls.push(['close']); if (failAt === 'close') throw new Error('close failed'); }, async abort() { calls.push(['abort']); } };
      const receipt = await deliverArtifactToFileHandle(artifact, { async createWritable() { calls.push(['open']); return writer; } });
      return { receipt, calls };
    };
    const success = await run(null);
    expect(success.receipt).to.include({ state: 'close-acknowledged', bytesWritten: 200000, evidence: 'writable-close-resolved' });
    expect(success.calls.at(-1)[0]).to.equal('close');
    for (const [at, written] of [[1, 0], [2, 50000], [3, 125000]]) {
      const failure = await run(at);
      expect(failure.receipt).to.include({ state: 'failed', errorKind: 'sink-error', bytesWritten: written,
        abortAttempted: true, abortAcknowledged: true });
      expect(failure.calls.at(-1)[0]).to.equal('abort');
    }
    const close = await run('close');
    expect(close.receipt).to.include({ state: 'failed', evidence: 'closing', bytesWritten: 200000, abortAttempted: true });
    expect(artifact.metadata().activeLeases).to.equal(0);
    expect(aggregateExportDeliveries([success.receipt, close.receipt])).to.include({ state: 'partial', complete: false });
  });

  it('cancels an in-flight write and reports picker capabilities without claiming disk durability', async () => {
    const artifact = prepare(new Uint8Array(100000)), controller = new AbortController();
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    const calls = [];
    const delivery = deliverArtifactToFileHandle(artifact, { async createWritable() { return {
      write() { calls.push('write'); started(); return new Promise(() => {}); },
      async abort() { calls.push('abort'); }, async close() { calls.push('close'); }
    }; } }, { signal: controller.signal });
    await entered; controller.abort();
    const receipt = await delivery;
    expect(receipt).to.include({ state: 'canceled', bytesWritten: 0, abortAttempted: true, abortAcknowledged: true });
    expect(calls).to.deep.equal(['write', 'abort']);
    expect(artifact.metadata().activeLeases).to.equal(0);
    expect((await requestExportFileHandle(artifact, { windowRef: {} })).state).to.equal('unsupported');
    let invoked = false;
    const pending = requestExportFileHandle(artifact, { windowRef: { showSaveFilePicker() { invoked = true; return Promise.reject(Object.assign(new Error('closed'), { name: 'AbortError' })); } } });
    expect(invoked).to.equal(true); expect((await pending).state).to.equal('canceled');
  });

  it('cancels an owned in-flight delivery when its prepared artifact is discarded', async () => {
    const artifact = prepare(new Uint8Array(100000)); let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const calls = [];
    const delivery = deliverArtifactToFileHandle(artifact, { async createWritable() { return {
      write() { entered(); return new Promise(() => {}); },
      async abort() { calls.push('abort'); }, async close() { calls.push('close'); }
    }; } });
    await started; artifact.discard();
    const receipt = await delivery;
    expect(receipt).to.include({ state: 'canceled', abortAcknowledged: true });
    expect(calls).to.deep.equal(['abort']);
    expect(artifact.metadata()).to.include({ retained: false, activeLeases: 0 });
  });

  it('aborts a file handle that arrives after opening was canceled', async () => {
    const artifact = prepare(), controller = new AbortController();
    let resolveOpen, lateAborted = false;
    const delivery = deliverArtifactToFileHandle(artifact, { createWritable() { return new Promise(resolve => { resolveOpen = resolve; }); } },
      { signal: controller.signal });
    controller.abort();
    const receipt = await delivery;
    expect(receipt).to.include({ state: 'canceled', bytesWritten: 0 });
    resolveOpen({ abort() { lateAborted = true; } });
    await Promise.resolve(); await Promise.resolve();
    expect(lateAborted).to.equal(true);
    expect(artifact.metadata().activeLeases).to.equal(0);
  });
  it('bounds a stalled sink and reports timeout with an abort attempt', async () => {
    const artifact = prepare(); let aborted = false;
    const receipt = await deliverArtifactToFileHandle(artifact, { async createWritable() { return {
      write() { return new Promise(() => {}); }, close() {}, abort() { aborted = true; }
    }; } }, { maxDeliveryMs: 30 });
    expect(receipt).to.include({ state: 'failed', errorKind: 'timeout', abortAttempted: true, abortAcknowledged: true });
    expect(aborted).to.equal(true);
  });
});
