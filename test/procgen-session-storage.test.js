import { expect } from 'chai';
import { createProcgenDocumentId, createProcgenSessionStorage } from '../js/app/procgen/workstation/ProcgenSessionStorage.js';
import { checksumProcgenRecovery } from '../js/app/procgen/workstation/ProcgenRecoveryChecksum.js';

const session = name => ({ format: 'lemmings-procgen-session', version: 1, name, savedAt: '2026-10-22T00:00:00.000Z',
  project: {}, settings: {}, world: { laneCount: 1, seed: 7 }, transport: {},
  patterns: { version: 1, beat: 0, lanes: {}, pending: [], active: [] } });

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
            delete(id) { const request = { result: null }; schedule(() => values.delete(id)); return request; },
            openCursor(range) {
              const ordered = [...values.values()].filter(value => !range || value.id > range.key).sort((a, b) => a.id.localeCompare(b.id));
              let position = 0; const request = { result: null };
              const advance = () => schedule(() => {
                const value = ordered[position++];
                request.result = value ? { key: value.id, value, continue: advance } : null;
                request.onsuccess?.();
              });
              advance(); return request;
            },
            index() { return { openCursor(range) {
              const ordered = [...values.values()].filter(value => value.savedAt && (!range ||
                value.savedAt < range.key[0] || value.savedAt === range.key[0] && value.id < range.key[1]))
                .sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id));
              let position = 0; const request = { result: null };
              const advance = () => schedule(() => {
                const value = ordered[position++];
                request.result = value ? { value, key: [value.savedAt, value.id], continue: advance } : null;
                request.onsuccess?.();
              });
              advance(); return request;
            } }; }
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
    expect(adapter.records.get('recovery:slot:1').session.name).to.equal('recovery');
    expect(adapter.records.get('recovery:head')).to.include({ generation: 1, slot: 1 });
    storage.close();
  });

  it('keeps the previous checksum-valid recovery generation when the newest copy is corrupt', async () => {
    const adapter = fakeIndexedDb(), storage = createProcgenSessionStorage(adapter);
    const first = await storage.saveRecovery(session('first'), { documentRevision: 3, tick: 60 });
    const second = await storage.saveRecovery(session('second'), { documentRevision: 4, tick: 120 });
    expect(first).to.include({ generation: 1, documentRevision: 3, tick: 60 });
    expect(second).to.include({ generation: 2, documentRevision: 4, tick: 120 });
    expect((await storage.loadRecovery()).name).to.equal('second');
    adapter.records.get('recovery:slot:0').session = session('changed after commit');
    expect((await storage.loadRecovery()).name).to.equal('first');
    await storage.removeRecovery();
    expect(await storage.loadRecovery()).to.equal(null);
    expect([...adapter.records.keys()].filter(id => id.startsWith('recovery:'))).to.deep.equal([]);
    storage.close();
  });

  it('slices recovery checksumming and can cancel before an obsolete write begins', async () => {
    const source = session('long'); source.project.steps = Array.from({ length: 5000 }, (_, index) => ({ index, enabled: true }));
    const controller = new AbortController(); let slices = 0, clock = 0;
    let canceled;
    try {
      await checksumProcgenRecovery(source, { signal: controller.signal, now: () => ++clock,
        yieldTask: async () => { slices++; controller.abort(); } });
    } catch (error) { canceled = error; }
    expect(slices).to.be.greaterThan(0);
    expect(canceled?.name).to.equal('AbortError');
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

  it('pages compact metadata with stable same-timestamp cursors and bounded search', async () => {
    const adapter = fakeIndexedDb(), storage = createProcgenSessionStorage(adapter, {
      keyRange: { upperBound: (key, exclusive) => ({ key, exclusive }) }
    });
    for (let index = 0; index < 105; index++) await storage.saveDocument('doc:' + String(index).padStart(3, '0'), 0,
      session(index === 73 ? 'Find this' : 'Other'), 'commit-' + index);
    const first = await storage.listDocumentPage({ limit: 40 });
    const second = await storage.listDocumentPage({ limit: 40, cursor: first.nextCursor });
    const third = await storage.listDocumentPage({ limit: 40, cursor: second.nextCursor });
    expect([first.items.length, second.items.length, third.items.length]).to.deep.equal([40, 40, 25]);
    expect(third.nextCursor).to.equal(null);
    expect([...first.items, ...second.items, ...third.items].map(item => item.id)).to.deep.equal(
      Array.from({ length: 105 }, (_, index) => 'doc:' + String(104 - index).padStart(3, '0')));
    const search = await storage.listDocumentPage({ query: 'find', limit: 10 });
    expect(search.items.map(item => item.id)).to.deep.equal(['doc:073']);
    expect(adapter.reads.sessions).to.equal(1);
    storage.close();
  });

  it('bounds a sparse metadata search and resumes without skipping its distant match', async () => {
    const adapter = fakeIndexedDb(), storage = createProcgenSessionStorage(adapter, {
      keyRange: { upperBound: key => ({ key }) }
    });
    for (let index = 0; index < 260; index++) await storage.saveDocument('doc:' + String(index).padStart(3, '0'), 0,
      session(index === 20 ? 'distant match' : 'other'), 'commit-' + index);
    const first = await storage.listDocumentPage({ limit: 10, query: 'distant' });
    expect(first.items).to.have.length(0);
    expect(first.nextCursor).to.exist;
    const second = await storage.listDocumentPage({ limit: 10, query: 'distant', cursor: first.nextCursor });
    expect(second.items.map(item => item.id)).to.deep.equal(['doc:020']);
    storage.close();
  });

  it('migrates legacy checkpoints in cursor batches without getAll payload cloning', async () => {
    const adapter = fakeIndexedDb(), oldStorage = createProcgenSessionStorage(adapter);
    for (let index = 0; index < 80; index++) await oldStorage.save('legacy-' + index, session('Legacy ' + index));
    oldStorage.close();
    const storage = createProcgenSessionStorage(adapter, {
      keyRange: { lowerBound: (key, exclusive) => ({ key, exclusive }), upperBound: (key, exclusive) => ({ key, exclusive }) }
    });
    const page = await storage.listDocumentPage({ limit: 40 });
    expect(page.items).to.have.length(40);
    expect(page.nextCursor).to.exist;
    expect(adapter.reads.sessions).to.equal(0);
    expect(adapter.records.has('legacy-0')).to.equal(true);
    storage.close();
  });
});
