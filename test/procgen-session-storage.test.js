import { expect } from 'chai';
import { createProcgenSessionStorage } from '../js/app/procgen/workstation/ProcgenSessionStorage.js';

const session = name => ({ format: 'lemmings-procgen-session', version: 1, name, savedAt: '2026-10-22T00:00:00.000Z',
  project: {}, settings: {}, world: { laneCount: 1, seed: 7 } });

function fakeIndexedDb({ failFirst = false, blocked = false, pending = false } = {}) {
  const records = new Map(), connections = [], requests = [];
  let opens = 0;
  const newDatabase = () => {
    const db = { closes: 0, objectStoreNames: { contains: () => true }, close() { this.closes++; },
      transaction() {
        const transaction = { objectStore: () => ({
          put(record) { const request = { result: record.id }; queueMicrotask(() => { records.set(record.id, record); transaction.oncomplete?.(); }); return request; },
          get(id) { const request = { result: null }; queueMicrotask(() => { request.result = records.get(id); transaction.oncomplete?.(); }); return request; },
          getAll() { const request = { result: null }; queueMicrotask(() => { request.result = [...records.values()]; transaction.oncomplete?.(); }); return request; },
          delete(id) { const request = { result: null }; queueMicrotask(() => { records.delete(id); transaction.oncomplete?.(); }); return request; }
        }) };
        return transaction;
      } };
    connections.push(db); return db;
  };
  return { records, connections, requests, get opens() { return opens; },
    open() {
      opens++; const request = { result: null, error: null }; requests.push(request);
      if (!pending) queueMicrotask(() => {
        if (blocked) { request.onblocked?.(); return; }
        if (failFirst && opens === 1) { request.error = Object.assign(new Error('temporary'), { name: 'UnknownError' }); request.onerror?.(); return; }
        request.result = newDatabase(); request.onsuccess?.();
      });
      return request;
    },
    completePending(index = 0) { const request = requests[index]; request.result = newDatabase(); request.onsuccess?.(); } };
}

describe('ProcGen session storage connection lifecycle', () => {
  it('shares one failed open among callers, then retries the next explicit save', async () => {
    const adapter = fakeIndexedDb({ failFirst: true }), storage = createProcgenSessionStorage(adapter);
    const failures = await Promise.allSettled([storage.save('one', session('one')), storage.save('two', session('two'))]);
    expect(failures.every(item => item.status === 'rejected')).to.equal(true);
    expect(adapter.opens).to.equal(1); expect(storage.getState().state).to.equal('unavailable');
    expect(await storage.save('one', session('one'))).to.equal('one');
    expect(adapter.opens).to.equal(2); expect((await storage.load('one')).name).to.equal('one');
    storage.close();
  });

  it('retires a versionchanged connection and opens a new one on explicit retry', async () => {
    const adapter = fakeIndexedDb(), storage = createProcgenSessionStorage(adapter);
    await storage.save('one', session('one'));
    adapter.connections[0].onversionchange?.({});
    expect(adapter.connections[0].closes).to.equal(1);
    expect(storage.getState().state).to.equal('unavailable');
    await storage.save('two', session('two'));
    expect(adapter.opens).to.equal(2); expect(storage.getState().state).to.equal('ready');
    storage.close(); expect(adapter.connections[1].closes).to.equal(1);
  });

  it('reports a blocked upgrade and does not retain its failed promise', async () => {
    const adapter = fakeIndexedDb({ blocked: true }), storage = createProcgenSessionStorage(adapter, { openTimeoutMs: 5 });
    let error; try { await storage.save('one', session('one')); } catch (failure) { error = failure; }
    expect(error.message).to.include('Another tab'); expect(storage.getState().state).to.equal('blocked');
    expect(adapter.opens).to.equal(1); storage.close();
  });

  it('closes a late connection after disposal and rejects the pending caller', async () => {
    const adapter = fakeIndexedDb({ pending: true }), storage = createProcgenSessionStorage(adapter);
    const saving = storage.save('one', session('one'));
    storage.close();
    let error; try { await saving; } catch (failure) { error = failure; }
    expect(error.message).to.include('closed');
    adapter.completePending();
    expect(adapter.connections[0].closes).to.equal(1);
    expect(adapter.records.size).to.equal(0);
    expect(storage.getState().state).to.equal('closed');
  });
});
