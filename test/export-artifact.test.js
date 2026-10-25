import { expect } from 'chai';
import { aggregateExportDeliveries, createExportDeliveryManifest, deliverArtifactToAnchor, deliverArtifactToFileHandle,
  prepareExportArtifact, prepareReplayableExportArtifact, requestExportFileHandle } from '../js/app/export/ExportArtifact.js';
import { createResourceBudget, ResourceBudgetError } from '../js/app/resources/ResourceBudget.js';
import { nativeExportDeliveryDiagnostics } from '../js/app/export/NativeExportDeliveryOwner.js';

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
  it('expires without a consumer poll while preserving borrowed and native digest ownership', async () => {
    const budget = createResourceBudget(), artifact = prepare(Uint8Array.of(1, 2), { budgetAdapter: budget, lifetimeMs: 5, clock: () => 0 });
    const lease = artifact.borrow(); let notifications = 0; artifact.onDiscard(() => { notifications++; });
    await artifact.digest(); await new Promise(resolve => setTimeout(resolve, 15));
    expect(artifact.metadata()).to.include({ retained: false, retirementReason: 'expired', activeLeases: 1 }); expect(notifications).to.equal(1);
    expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0); expect(() => artifact.borrow()).to.throw('expired');
    lease.release(); expect(() => lease.blob).to.throw('released'); artifact.discard(); expect(notifications).to.equal(1);
    expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('checks injected-clock expiry and rejects invalid clocks before any allocation admission', async () => {
    let time = 0; const budget = createResourceBudget(), artifact = prepare(Uint8Array.of(1), { budgetAdapter: budget, lifetimeMs: 100, clock: () => time });
    await artifact.digest(); time = 101; expect(artifact.metadata()).to.include({ retained: false, retirementReason: 'expired' });
    expect(budget.diagnostics().accountedBytes).to.equal(0);
    expect(() => prepare(Uint8Array.of(1), { budgetAdapter: budget, clock: () => NaN })).to.throw('clock reading');
    expect(budget.diagnostics().accountedBytes).to.equal(0);
    const empty = prepare(new Uint8Array(0), { budgetAdapter: budget }); await empty.digest(); empty.discard(); expect(empty.metadata().budgetState).to.equal('released');
  });
  it('retains a replayable source lease until an accepted read and queued return actually settle', async () => {
    let finish; const gate = new Promise(resolve => { finish = resolve; });
    const artifact = prepareReplayableExportArtifact({ immutableSourceRef: 'owned:pending:1', formatVersion: 'bytes/v1', suggestedFilename: 'owned.bin',
      openChunks: async function* () { await gate; yield Uint8Array.of(1); } });
    const lease = artifact.borrow(), iterator = lease.openChunks()[Symbol.asyncIterator](), reading = iterator.next();
    await Promise.resolve(); artifact.discard(); lease.release();
    expect(artifact.metadata()).to.include({ retained: false, activeLeases: 1, sourceRetirement: 'waiting-for-source-leases' });
    finish(); await reading; await new Promise(resolve => setTimeout(resolve, 0));
    expect(artifact.metadata()).to.include({ activeLeases: 0, sourceRetirement: 'released' });
    expect(() => lease.openChunks()).to.throw('retired');
  });
  it('checks the absolute deadline before each immediately resolved source or sink step', async () => {
    for (const expiresDuring of ['open', 'read', 'write', 'progress']) {
      let time = 0, reads = 0, writes = 0, closes = 0, aborts = 0;
      const expire = phase => { if (phase === expiresDuring) time = 100; };
      const artifact = prepareReplayableExportArtifact({ immutableSourceRef: 'take:deadline:1',
        formatVersion: 'bytes/v1', suggestedFilename: 'take.bin', byteLength: 20,
        openChunks: async function* () { for (let index = 0; index < 20; index++) { reads++; expire('read'); yield Uint8Array.of(index); } } });
      const writer = { async write() { writes++; expire('write'); }, async close() { closes++; }, async abort() { aborts++; } };
      const receipt = await deliverArtifactToFileHandle(artifact, { async createWritable() { expire('open'); return writer; } },
        { clock: () => time, maxDeliveryMs: 10, onProgress() { expire('progress'); } });
      expect(receipt).to.include({ state: 'failed', errorKind: 'timeout', deadlineExceeded: true, abortAcknowledged: true });
      expect(writes).to.equal(['open', 'read'].includes(expiresDuring) ? 0 : 1);
      expect(reads).to.equal(expiresDuring === 'open' ? 0 : 1); expect(closes).to.equal(0); expect(aborts).to.equal(1);
      time = 0; const bytes = [];
      const retry = await deliverArtifactToFileHandle(artifact, { async createWritable() { return {
        async write(chunk) { bytes.push(...chunk); }, async close() {}, async abort() {}
      }; } }, { clock: () => time, maxDeliveryMs: 10 });
      // A fresh source may still advance its clock; source expiry therefore remains a failure.
      expect(retry.state).to.equal(expiresDuring === 'read' ? 'failed' : 'close-acknowledged');
      if (expiresDuring !== 'read') expect(bytes).to.deep.equal(Array.from({ length: 20 }, (_, index) => index));
      artifact.discard();
    }
  });

  it('admits staging before allocation and retains its budget through a borrowed delivery', async () => {
    const budget = createResourceBudget({ limitBytes: 4096 });
    const artifact = prepare(new Uint8Array(1800), { budgetAdapter: budget });
    const lease = artifact.borrow();
    expect(budget.diagnostics()).to.include({ residentBytes: 1800, accountedBytes: 3600 });
    expect(() => prepare(new Uint8Array(300), { budgetAdapter: budget })).to.throw(ResourceBudgetError);
    artifact.discard(); expect(budget.diagnostics().accountedBytes).to.equal(3600);
    lease.release(); await artifact.digest(); expect(budget.diagnostics().accountedBytes).to.equal(0);
    const retry = prepare(new Uint8Array(300), { budgetAdapter: budget }); retry.discard(); await retry.digest();
  });
  it('retains a discarded native digest until its actual byte read settles and keeps failed release accounting', async () => {
    const budget = createResourceBudget(); let finish;
    class DelayedBlob extends Blob { arrayBuffer() { return new Promise(resolve => { finish = () => super.arrayBuffer().then(resolve); }); } }
    const artifact = prepare(new DelayedBlob(['owned source']), { budgetAdapter: budget }); artifact.discard();
    expect(artifact.metadata().budgetState).to.equal('waiting-for-leases-or-digest'); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    await finish(); await artifact.digest(); expect(budget.diagnostics().accountedBytes).to.equal(0);
    let attempts = 0;
    const failed = prepare(Uint8Array.of(1), { budgetAdapter: { reserve() {}, release() { attempts++; return false; } } });
    await failed.digest(); expect(() => failed.discard()).to.throw('not acknowledged');
    expect(failed.metadata().budgetState).to.equal('failed-or-unknown'); expect(() => failed.discard()).to.throw('not acknowledged'); expect(attempts).to.equal(1);
  });
  it('reopens a bounded chunk source for retry and reports the failed write without restaging', async () => {
    let opens = 0;
    const artifact = prepareReplayableExportArtifact({ immutableSourceRef: 'take:frozen:7',
      formatVersion: 'pcm/v1', suggestedFilename: 'stem.wav', byteLength: 5, maxDeliveryBytes: 8,
      openChunks: async function* () { opens++; yield Uint8Array.of(1, 2); yield Uint8Array.of(3, 4, 5); } });
    expect(deliverArtifactToAnchor(artifact, anchor())).to.include({ state: 'unsupported', errorKind: 'streaming-source-requires-file-handle' });
    const run = fail => {
      const bytes = [], handle = { async createWritable() { return { async write(chunk) {
        if (fail && bytes.length) throw new Error('write failed'); bytes.push(...chunk);
      }, async close() {}, async abort() {} }; } };
      return deliverArtifactToFileHandle(artifact, handle).then(receipt => ({ receipt, bytes }));
    };
    const first = await run(true); expect(first.receipt).to.include({ state: 'failed', bytesWritten: 2 });
    const second = await run(false); expect(second.receipt).to.include({ state: 'close-acknowledged', bytesWritten: 5 });
    expect(second.bytes).to.deep.equal([1, 2, 3, 4, 5]); expect(opens).to.equal(2);
    artifact.discard(); expect(artifact.metadata().activeLeases).to.equal(0);
  });
  it('rejects a streaming source that exceeds or fails its declared byte count', async () => {
    const make = (chunks, byteLength) => prepareReplayableExportArtifact({ immutableSourceRef: 'take:sealed:8',
      formatVersion: 'pcm/v1', suggestedFilename: 'stem.wav', byteLength, maxDeliveryBytes: 8,
      openChunks: async function* () { for (const chunk of chunks) yield chunk; } });
    const handle = { async createWritable() { return { async write() {}, async close() {}, async abort() {} }; } };
    expect(await deliverArtifactToFileHandle(make([new Uint8Array(9)], null), handle))
      .to.include({ state: 'failed', errorKind: 'artifact-limit', bytesWritten: 0 });
    expect(await deliverArtifactToFileHandle(make([new Uint8Array(2)], 3), handle))
      .to.include({ state: 'failed', errorKind: 'source-length-mismatch', bytesWritten: 2 });
  });
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
    expect(artifact.metadata().activeLeases).to.equal(1);
    expect(await artifact.digest()).to.match(/^[a-f0-9]{64}$/);
    second.timers[0](); expect(second.calls.at(-1)).to.equal('revoke'); expect(artifact.metadata().activeLeases).to.equal(0);
    artifact.discard(); expect(deliverArtifactToAnchor(artifact, anchor()).errorKind).to.equal('artifact-expired');
  });
  it('keeps prepared storage borrowed through actual native object URL revocation', async () => {
    const budget = createResourceBudget(), artifact = prepare(Uint8Array.of(1, 2), { budgetAdapter: budget }), delivery = anchor();
    await artifact.digest(); deliverArtifactToAnchor(artifact, delivery); artifact.discard();
    expect(artifact.metadata().activeLeases).to.equal(1); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    delivery.timers[0](); expect(artifact.metadata().activeLeases).to.equal(0); expect(budget.diagnostics().accountedBytes).to.equal(0);
    delivery.timers[0](); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('holds a canceled native write through actual promise settlement after abort acknowledgment', async () => {
    const before = nativeExportDeliveryDiagnostics().activeOwners, budget = createResourceBudget(); let finishWrite, started;
    const writing = new Promise(resolve => { started = resolve; }), artifact = prepare(Uint8Array.of(1, 2, 3), { budgetAdapter: budget });
    const pending = deliverArtifactToFileHandle(artifact, { async createWritable() { return {
      write() { started(); return new Promise(resolve => { finishWrite = resolve; }); }, async close() {}, async abort() {}
    }; } }, { maxDeliveryMs: 20 });
    await writing; const receipt = await pending; artifact.discard(); await artifact.digest();
    expect(receipt).to.include({ state: 'failed', errorKind: 'timeout', abortAcknowledged: true, nativeRetirement: 'pending-native-settlement' });
    expect(artifact.metadata().activeLeases).to.equal(1); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    finishWrite(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(artifact.metadata().activeLeases).to.equal(0); expect(budget.diagnostics().accountedBytes).to.equal(0);
    expect(nativeExportDeliveryDiagnostics().activeOwners).to.equal(before);
  });
  it('owns a late opened writer until its actual abort settles', async () => {
    const before = nativeExportDeliveryDiagnostics().activeOwners, budget = createResourceBudget(); let finishOpen, finishAbort;
    const artifact = prepare(Uint8Array.of(1), { budgetAdapter: budget });
    const receipt = await deliverArtifactToFileHandle(artifact, { createWritable: () => new Promise(resolve => { finishOpen = resolve; }) }, { maxDeliveryMs: 10 });
    artifact.discard(); await artifact.digest(); expect(receipt.nativeRetirement).to.equal('pending-native-settlement');
    finishOpen({ abort: () => new Promise(resolve => { finishAbort = resolve; }) }); await new Promise(resolve => setTimeout(resolve, 0));
    expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0); finishAbort(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(budget.diagnostics().accountedBytes).to.equal(0); expect(nativeExportDeliveryDiagnostics().activeOwners).to.equal(before);
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
    let started, finishWrite;
    const entered = new Promise(resolve => { started = resolve; });
    const calls = [];
    const delivery = deliverArtifactToFileHandle(artifact, { async createWritable() { return {
      write() { calls.push('write'); started(); return new Promise(resolve => { finishWrite = resolve; }); },
      async abort() { calls.push('abort'); }, async close() { calls.push('close'); }
    }; } }, { signal: controller.signal });
    await entered; controller.abort();
    const receipt = await delivery;
    expect(receipt).to.include({ state: 'canceled', bytesWritten: 0, abortAttempted: true, abortAcknowledged: true });
    expect(calls).to.deep.equal(['write', 'abort']);
    expect(artifact.metadata().activeLeases).to.equal(1); expect(receipt.nativeRetirement).to.equal('pending-native-settlement');
    finishWrite(); await new Promise(resolve => setImmediate(resolve)); expect(artifact.metadata().activeLeases).to.equal(0);
    expect((await requestExportFileHandle(artifact, { windowRef: {} })).state).to.equal('unsupported');
    let invoked = false;
    const pending = requestExportFileHandle(artifact, { windowRef: { showSaveFilePicker() { invoked = true; return Promise.reject(Object.assign(new Error('closed'), { name: 'AbortError' })); } } });
    expect(invoked).to.equal(true); expect((await pending).state).to.equal('canceled');
  });

  it('cancels an owned in-flight delivery when its prepared artifact is discarded', async () => {
    const artifact = prepare(new Uint8Array(100000)); let entered, finishWrite;
    const started = new Promise(resolve => { entered = resolve; });
    const calls = [];
    const delivery = deliverArtifactToFileHandle(artifact, { async createWritable() { return {
      write() { entered(); return new Promise(resolve => { finishWrite = resolve; }); },
      async abort() { calls.push('abort'); }, async close() { calls.push('close'); }
    }; } });
    await started; artifact.discard();
    const receipt = await delivery;
    expect(receipt).to.include({ state: 'canceled', abortAcknowledged: true });
    expect(calls).to.deep.equal(['abort']);
    expect(artifact.metadata()).to.include({ retained: false, activeLeases: 1 });
    finishWrite(); await new Promise(resolve => setImmediate(resolve)); expect(artifact.metadata().activeLeases).to.equal(0);
  });

  it('aborts a file handle that arrives after opening was canceled', async () => {
    const artifact = prepare(), controller = new AbortController();
    let resolveOpen, enteredOpen, lateAborted = false; const opening = new Promise(resolve => { enteredOpen = resolve; });
    const delivery = deliverArtifactToFileHandle(artifact, { createWritable() { enteredOpen(); return new Promise(resolve => { resolveOpen = resolve; }); } },
      { signal: controller.signal });
    await opening; controller.abort();
    const receipt = await delivery;
    expect(receipt).to.include({ state: 'canceled', bytesWritten: 0 });
    resolveOpen({ abort() { lateAborted = true; } });
    await new Promise(resolve => setImmediate(resolve));
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
  it('keeps independent stem attempts and does not mark a partial bundle complete', () => {
    const left = prepare(Uint8Array.of(1), { suggestedFilename: 'left.wav' });
    const right = prepare(Uint8Array.of(2), { suggestedFilename: 'right.wav' });
    const first = createExportDeliveryManifest([
      { artifact: left, receipts: [{ artifactId: left.artifactId, state: 'close-acknowledged' }] },
      { artifact: right, receipts: [{ artifactId: right.artifactId, state: 'failed' }] }
    ]);
    expect(first).to.include({ complete: false, state: 'partial' });
    expect(first.files.map(file => file.suggestedFilename)).to.deep.equal(['left.wav', 'right.wav']);
    const retry = createExportDeliveryManifest([
      { artifact: left, receipts: [{ artifactId: left.artifactId, state: 'close-acknowledged' }] },
      { artifact: right, receipts: [{ artifactId: right.artifactId, state: 'failed' },
        { artifactId: right.artifactId, state: 'close-acknowledged' }] }
    ]);
    expect(retry).to.include({ complete: true, state: 'close-acknowledged' });
    expect(retry.files[1].attempts).to.have.length(2);
    expect(() => createExportDeliveryManifest([{ artifact: left, receipts: [{ artifactId: right.artifactId }] }]))
      .to.throw(TypeError);
    left.discard(); right.discard();
  });
});
