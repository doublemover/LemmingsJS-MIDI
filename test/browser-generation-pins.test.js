import { expect } from 'chai';
import { recoveryGenerationPin, readDurableBrowserGenerationPins, upgradeBrowserGenerationPins, withBrowserGenerationRetentionLock, GENERATION_RETENTION_LOCK } from '../js/runtime/BrowserGenerationPins.js';
const scopeUrl = 'https://app.invalid/lemmings/', buildId = 'a'.repeat(64);
const bound = { executionIdentity: { activeExecution: 'bound', buildId, deploymentRoot: scopeUrl } };
function storage(pins = [], { legacy = false, missing = false, late = false } = {}) {
  const reads = [], data = new Map(pins.map(pin => [pin.id, pin])); let closed = 0, aborted = 0, pending;
  const db = { close() { closed++; }, objectStoreNames: { contains: () => !legacy }, transaction(name, mode) {
    expect(name).to.equal('generationPins'); expect(mode).to.equal('readonly'); let remaining = 0;
    const tx = { objectStore(store) { expect(store).to.equal('generationPins'); return { get(key) {
      reads.push(key); remaining++; const request = {};
      queueMicrotask(() => { request.result = data.get(key); request.onsuccess(); if (!--remaining) queueMicrotask(() => tx.oncomplete()); }); return request;
    } }; } }; return tx;
  } };
  return { reads, get closed() { return closed; }, get aborted() { return aborted; }, complete() { pending(); }, open(_name, version) {
    expect(version).to.equal(undefined); const request = { result: db, transaction: { abort() { aborted++; queueMicrotask(() => request.onerror()); } } };
    pending = () => missing ? request.onupgradeneeded({ oldVersion: 0 }) : request.onsuccess(); if (!late) queueMicrotask(pending); return request;
  } };
}
describe('durable recovery source-generation retention', () => {
  it('reads exactly two metadata records, preserving only matching deployment generations', async () => {
    const foreign = recoveryGenerationPin({ executionIdentity: { ...bound.executionIdentity, buildId: 'b'.repeat(64), deploymentRoot: 'https://app.invalid/other/' } }, 0, 2);
    const indexedDB = storage([recoveryGenerationPin(bound, 1, 1), foreign]);
    const result = await readDurableBrowserGenerationPins({ indexedDB, scopeUrl });
    expect(result).to.include({ status: 'complete' }); expect(result.buildIds).to.deep.equal([buildId]); expect(indexedDB.reads).to.deep.equal(['recovery:slot:0', 'recovery:slot:1']); expect(indexedDB.closed).to.equal(1);
  });
  it('does not invent historical binding for legacy or explicitly unbound sessions', async () => {
    expect(recoveryGenerationPin({}, 0, 2).source.status).to.equal('unknown');
    const unbound = recoveryGenerationPin({ executionIdentity: { activeExecution: 'unbound' } }, 1, 1);
    expect((await readDurableBrowserGenerationPins({ indexedDB: storage([unbound]), scopeUrl })).status).to.equal('complete');
    for (const indexedDB of [storage([], { legacy: true }), storage([recoveryGenerationPin({}, 1, 1)]), storage([{ ...unbound, generation: NaN }])])
      expect((await readDurableBrowserGenerationPins({ indexedDB, scopeUrl })).status).to.equal('unknown');
  });
  it('aborts creation when there is no database and retires a connection arriving after timeout', async () => {
    const absent = storage([], { missing: true }); expect((await readDurableBrowserGenerationPins({ indexedDB: absent, scopeUrl })).status).to.equal('complete'); expect(absent.aborted).to.equal(1);
    const late = storage([], { late: true }); expect((await readDurableBrowserGenerationPins({ indexedDB: late, scopeUrl, timeoutMs: 1 })).status).to.equal('unknown'); late.complete(); expect(late.closed).to.equal(1);
  });
  it('migrates only slot existence without materializing old checkpoint payloads', async () => {
    const inserted = [], counted = [];
    upgradeBrowserGenerationPins({ objectStoreNames: { contains: () => false }, createObjectStore: () => ({ put: value => inserted.push(value) }) }, { objectStore: () => ({ count(key) {
      counted.push(key); const request = { result: key.endsWith(':1') ? 1 : 0 }; queueMicrotask(() => request.onsuccess()); return request;
    } }) }, 5);
    await Promise.resolve(); expect(counted).to.have.length(2); expect(inserted).to.have.length(1); expect(inserted[0].source.status).to.equal('unknown');
  });
  it('holds source publication and cache retirement mutually exclusively until actual completion', async () => {
    let tail = Promise.resolve(), release, published = false; const calls = [];
    const locks = { request(name, options, operation) { calls.push([name, options.mode]); const next = tail.then(() => operation({})); tail = next.catch(() => {}); return next; } };
    const gate = new Promise(resolve => { release = resolve; });
    const save = withBrowserGenerationRetentionLock(async () => { await gate; published = true; }, { locks });
    const trim = withBrowserGenerationRetentionLock(() => { expect(published).to.equal(true); }, { locks, required: true });
    await Promise.resolve(); expect(published).to.equal(false); release(); await Promise.all([save, trim]); expect(calls).to.deep.equal([[GENERATION_RETENTION_LOCK, 'exclusive'], [GENERATION_RETENTION_LOCK, 'exclusive']]);
  });
  it('allows recovery without locking but refuses unsafe trim and never steals a held lock', async () => {
    expect(withBrowserGenerationRetentionLock(() => 9, { locks: null })).to.equal(9);
    expect(() => withBrowserGenerationRetentionLock(() => {}, { locks: null, required: true })).to.throw('cross-context');
    const locks = { request(_name, options, operation) { expect(options).to.deep.equal({ mode: 'exclusive', ifAvailable: true }); return operation(null); } };
    expect(() => withBrowserGenerationRetentionLock(() => {}, { locks, required: true, ifAvailable: true })).to.throw('publication');
  });
});
