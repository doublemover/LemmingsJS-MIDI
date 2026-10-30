import { test, expect } from '@playwright/test';
import { RECOVERY_DATABASE_VERSION } from '../js/runtime/BrowserGenerationPins.js';

test('v4 causal manifests migrate once and browsing touches only compact summary rows @boundary', async ({ page }) => {
  await page.goto('/e2e/fixtures/causal-journal.html');
  const result = await page.evaluate(async () => {
    const { createMemoryCausalStore } = await import('/test/helpers/causalJournalStore.js');
    const { createProcgenCausalJournal } = await import('/js/app/procgen/workstation/ProcgenCausalJournal.js');
    const { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js');
    const memory = createMemoryCausalStore(), original = createProcgenCausalJournal({ storage: memory.storage, maxChunkRecords: 1 });
    const writer = await original.createTake({ takeId: 'take:legacy', documentId: 'doc:legacy', sourceVersions: { physicalBatch: 1 },
      captureProfile: { version: 1, id: 'legacy', factKinds: [], descriptorKinds: [], stateKinds: [] },
      initialCheckpoint: { tick: 0 }, mapping: { version: 1, revision: 1, instruments: [] } });
    for (let tick = 1; tick <= 100; tick++) { writer.append({ kind: 'marker', tick, generation: 1, payload: tick }); await writer.flush(); }
    await writer.stop();
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('lemmings.procgen.sessions', 4);
      request.onupgradeneeded = () => {
        for (const name of ['sessions', 'projectMetadata', 'takeManifests', 'takeChunks', 'takeCheckpoints']) request.result.createObjectStore(name, { keyPath: 'id' });
        request.transaction.objectStore('projectMetadata').createIndex('byUpdated', ['savedAt', 'id']);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, transaction = database.transaction(['takeManifests', 'takeChunks', 'takeCheckpoints'], 'readwrite');
        transaction.objectStore('takeManifests').add({ id: 'take:legacy', manifest: writer.manifest() });
        for (const chunk of memory.chunks.values()) transaction.objectStore('takeChunks').add(chunk);
        for (const checkpoint of memory.checkpoints.values()) transaction.objectStore('takeCheckpoints').add(checkpoint);
        transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onabort = () => reject(transaction.error);
      };
    });
    const storage = createProcgenSessionStorage(indexedDB), journal = createProcgenCausalJournal({ storage, maxChunkRecords: 1 });
    await journal.verify('take:legacy');
    const transactions = [], transact = globalThis.IDBDatabase.prototype.transaction;
    globalThis.IDBDatabase.prototype.transaction = function(names, ...args) { transactions.push(typeof names === 'string' ? [names] : [...names]); return transact.call(this, names, ...args); };
    let listed;
    try { listed = await storage.listCausalTakes({ limit: 1 }); } finally { globalThis.IDBDatabase.prototype.transaction = transact; }
    const head = await storage.loadCausalTakeHead('take:legacy');
    const tail = await journal.query({ takeId: 'take:legacy', firstSequence: 100, limit: 1 });
    storage.close();
    return { transactions, listed, head, tick: tail.records[0].tick };
  });
  expect(result.transactions).toEqual([['takeSummaries']]);
  expect(result.listed.items[0]).toMatchObject({ takeId: 'take:legacy', durableSequence: 100, complete: true });
  expect(result.head.chunkCount).toBe(100); expect(result.head.chunks).toBeUndefined(); expect(result.head.sourceVersions).toBeUndefined();
  expect(result.tick).toBe(100);
});

test('causal takes upgrade v3 project storage and reopen the exact durable prefix disarmed @boundary', async ({ page }) => {
  await page.goto('/e2e/fixtures/causal-journal.html');
  const result = await page.evaluate(async () => {
    const { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js');
    const { createProcgenCausalJournal } = await import('/js/app/procgen/workstation/ProcgenCausalJournal.js');
    const preserved = { format: 'lemmings-procgen-session', version: 1, name: 'Existing v3 project', savedAt: '2026-10-22',
      project: {}, settings: {}, world: { laneCount: 1, seed: 42 }, transport: {}, patterns: { version: 1, beat: 0, lanes: {}, pending: [], active: [] } };
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('lemmings.procgen.sessions', 3);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('sessions', { keyPath: 'id' });
        request.result.createObjectStore('projectMetadata', { keyPath: 'id' }).createIndex('byUpdated', ['savedAt', 'id']);
      };
      request.onsuccess = () => {
        const database = request.result, transaction = database.transaction('sessions', 'readwrite');
        transaction.objectStore('sessions').put({ id: 'preserved', session: preserved });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
    const storage = createProcgenSessionStorage(indexedDB), journal = createProcgenCausalJournal({ storage });
    const writer = await journal.createTake({ takeId: 'take:browser', documentId: 'doc:browser', sourceVersions: { physicalBatch: 1 },
      captureProfile: { version: 1, id: 'browser', factKinds: [], descriptorKinds: [], stateKinds: [] },
      boundaryState: { voices: [] }, initialCheckpoint: { world: { tick: 0 } }, mapping: { version: 1, revision: 1, instruments: [] }, assetRefs: [] });
    for (let tick = 1; tick <= 100; tick++) writer.append({ kind: 'marker', tick, generation: 1, payload: { marker: tick } });
    const receipt = await writer.stop(), oldProject = await storage.load('preserved');
    storage.close();
    const reopenedStorage = createProcgenSessionStorage(indexedDB), reopened = createProcgenCausalJournal({ storage: reopenedStorage });
    const verified = await reopened.verify('take:browser'), manifest = await reopened.openTake('take:browser');
    const slice = await reopened.query({ takeId: 'take:browser', firstTick: 40, lastTick: 42 });
    const databaseState = await new Promise((resolve, reject) => {
      const request = indexedDB.open('lemmings.procgen.sessions');
      request.onsuccess = () => { const database = request.result; resolve({ version: database.version, stores: [...database.objectStoreNames] }); database.close(); };
      request.onerror = () => reject(request.error);
    });
    reopenedStorage.close();
    return { receipt, verified, inspection: manifest.inspection, oldName: oldProject.name, ticks: slice.records.map(record => record.tick), databaseState };
  });
  expect(result.receipt.complete).toBe(true);
  expect(result.verified.verifiedThroughSequence).toBe(100);
  expect(result.oldName).toBe('Existing v3 project');
  expect(result.databaseState.version).toBe(RECOVERY_DATABASE_VERSION);
  expect(result.databaseState.stores).toEqual(expect.arrayContaining(['sessions', 'projectMetadata', 'takeHeaders', 'takeHeads', 'takeSummaries', 'takeChunkIndex', 'takeCheckpointIndex', 'takeChunks', 'takeCheckpoints']));
  expect(result.ticks).toEqual([40, 41, 42]);
  expect(result.inspection).toEqual({ paused: true, recording: false, hardware: false, thru: false, physicalLayers: false });
});

test('causal take CAS admits one concurrent writer and unfinished finalization reopens partial @boundary', async ({ page }) => {
  await page.goto('/e2e/fixtures/causal-journal.html');
  const result = await page.evaluate(async () => {
    const { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js');
    const { createProcgenCausalJournal } = await import('/js/app/procgen/workstation/ProcgenCausalJournal.js');
    const storage = createProcgenSessionStorage(indexedDB), journal = createProcgenCausalJournal({ storage });
    const definition = { takeId: 'take:race', documentId: 'doc:race', sourceVersions: { physicalBatch: 1 },
      captureProfile: { version: 1, id: 'race', factKinds: [], descriptorKinds: [], stateKinds: [] },
      initialCheckpoint: { tick: 0 }, mapping: { version: 1, revision: 1, instruments: [] } };
    const first = await journal.createTake(definition), second = await journal.createTake(definition);
    first.append({ kind: 'marker', tick: 1, generation: 1, payload: 'first' });
    second.append({ kind: 'marker', tick: 1, generation: 1, payload: 'second' });
    await Promise.allSettled([first.flush(), second.flush()]);
    const states = [first.status().state, second.status().state];
    const durable = await journal.query({ takeId: 'take:race' });
    const failureStorage = { ...storage, commitCausalTake: args => (args.head || args.manifest).state !== 'recording'
      ? Promise.reject(new Error('Interrupted final flush')) : storage.commitCausalTake(args) };
    const unfinishedJournal = createProcgenCausalJournal({ storage: failureStorage });
    const unfinished = await unfinishedJournal.createTake({ ...definition, takeId: 'take:unfinished' });
    unfinished.append({ kind: 'marker', tick: 5, generation: 1, payload: 'observed-prefix' });
    await unfinished.flush(); const stop = await unfinished.stop();
    const reopened = await journal.openTake('take:unfinished');
    const prefix = await journal.verify('take:unfinished');
    const firstPage = await storage.listCausalTakes({ limit: 1 });
    const secondPage = await storage.listCausalTakes({ limit: 1, cursor: firstPage.nextCursor });
    storage.close();
    return { states, durableRecords: durable.records.length, durableSequence: durable.records[0].sequence,
      stop, effectiveStatus: reopened.effectiveStatus, prefix, firstPage, secondPage };
  });
  expect(result.states.sort()).toEqual(['recording', 'recovery-required']);
  expect(result.durableRecords).toBe(1); expect(result.durableSequence).toBe(1);
  expect(result.stop.complete).toBe(false); expect(result.effectiveStatus).toBe('partial');
  expect(result.prefix.verifiedThroughSequence).toBe(1);
  expect(result.firstPage.items.map(item => item.takeId)).toEqual(['take:race']);
  expect(result.firstPage.nextCursor).toBe('take:race');
  expect(result.secondPage.items.map(item => item.takeId)).toEqual(['take:unfinished']);
  expect(result.secondPage.items[0].complete).toBe(false);
  expect(result.secondPage.nextCursor).toBe(null);
});
