import { expect } from 'chai';
import { createProcgenDocumentId, createProcgenSessionStorage } from '../js/app/procgen/workstation/ProcgenSessionStorage.js';

const session = name => ({ format: 'lemmings-procgen-session', version: 1, name, savedAt: '2026-10-22T00:00:00.000Z',
  project: {}, settings: {}, world: { laneCount: 1, seed: 7 } });

function fakeIndexedDb({ failFirst = false, blocked = false, pending = false } = {}) {
  const records = new Map(), metadata = new Map(), connections = [], requests = [], reads = { sessions: 0, projectMetadata: 0 };
  let opens = 0;
  const newDatabase = () => {
    const db = { closes: 0, objectStoreNames: { contains: () => true }, close() { this.closes++; },
      transaction() {
        let waiting = 0, aborted = false;
        const schedule = work => { waiting++; queueMicrotask(() => { if (!aborted) work(); waiting--; if (!waiting) queueMicrotask(() => { if (!waiting && !aborted) transaction.oncomplete?.(); }); }); };
        const transaction = { objectStore: name => {
          const values = name === 'projectMetadata' ? metadata : records;
          return {
            put(record) { const request = { result: record.id }; schedule(() => values.set(record.id, record)); return request; },
            get(id) { const request = { result: null }; schedule(() => { request.result = values.get(id); request.onsuccess?.(); }); return request; },
            getAll() { const request = { result: null }; schedule(() => { reads[name]++; request.result = [...values.values()]; }); return request; },
            delete(id) { const request = { result: null }; schedule(() => values.delete(id)); return request; }
          };
        }, abort() { aborted = true; queueMicrotask(() => this.onabort?.()); } };
        return transaction;
      } };
    connections.push(db); return db;
  };
  return { records, metadata, connections, requests, reads, get opens() { return opens; },
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

  it('keeps same-name documents distinct and protects a reserved recovery record', async () => {
    const adapter = fakeIndexedDb(), storage = createProcgenSessionStorage(adapter);
    const first = createProcgenDocumentId(), second = createProcgenDocumentId();
    expect(first).not.to.equal(second);
    await storage.saveDocument(first, 0, session('__recovery__'), 'commit-1');
    await storage.saveDocument(second, 0, session('__recovery__'), 'commit-2');
    await storage.saveRecovery(session('recovery'));
    expect((await storage.listDocuments()).map(record => record.id)).to.have.members([first, second]);
    expect((await storage.loadDocument(first)).session.name).to.equal('__recovery__');
    expect(adapter.records.get('recovery:latest').session.name).to.equal('recovery');
    storage.close();
  });

  it('compares revisions atomically and recognizes a repeated uncertain commit', async () => {
    const adapter = fakeIndexedDb(), storage = createProcgenSessionStorage(adapter), id = createProcgenDocumentId();
    const first = await storage.saveDocument(id, 0, session('original'), 'commit-1');
    expect(first).to.include({ revision: 1, repeated: false });
    expect(await storage.saveDocument(id, 0, session('original'), 'commit-1')).to.include({ revision: 1, repeated: true });
    let conflict; try { await storage.saveDocument(id, 0, session('stale writer'), 'commit-2'); } catch (error) { conflict = error; }
    expect(conflict.category).to.equal('conflict');
    expect((await storage.loadDocument(id)).session.name).to.equal('original');
    expect((await storage.saveDocument(id, 1, session('renamed'), 'commit-3')).revision).to.equal(2);
    expect((await storage.loadDocument(id)).session.name).to.equal('renamed');
    storage.close();
  });

  it('migrates unusual legacy names and recovery without deleting source records', async () => {
    const adapter = fakeIndexedDb(), storage = createProcgenSessionStorage(adapter);
    await storage.save('odd/name% ·', session('same display'));
    await storage.save('__recovery__', session('old recovery'));
    const documents = await storage.listDocuments();
    expect(documents).to.have.length(1);
    expect(documents[0].id).to.match(/^doc:legacy:[0-9a-f]+$/);
    expect((await storage.loadDocument(documents[0].id)).session.name).to.equal('same display');
    expect((await storage.loadRecovery()).name).to.equal('old recovery');
    expect(adapter.records.has('odd/name% ·')).to.equal(true);
    expect(adapter.records.has('__recovery__')).to.equal(true);
    const sessionReads = adapter.reads.sessions;
    await storage.listDocuments();
    expect(adapter.reads.sessions).to.equal(sessionReads);
    storage.close();
    const reopened = createProcgenSessionStorage(adapter);
    await reopened.listDocuments();
    expect(adapter.reads.sessions).to.equal(sessionReads);
    reopened.close();
  });
});
