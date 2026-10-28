import { expect, test } from '@playwright/test';

const prepare = async (page, count) => {
  await page.goto('/README.md');
  await page.evaluate(async count => {
    const { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js');
    const { RECOVERY_DATABASE_NAME } = await import('/js/runtime/BrowserGenerationPins.js');
    const storage = createProcgenSessionStorage(); await storage.listDocumentPage();
    const request = indexedDB.open(RECOVERY_DATABASE_NAME);
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const probe = window.projectPageProbe = { storage, db, count, payloadBytes: 128 * 1024, reads: null };
    const session = name => ({ format: 'lemmings-procgen-session', version: 1, name, savedAt: '2026-10-27T12:00:00.000Z',
      project: {}, settings: {}, world: { laneCount: 1, seed: 7, qualificationPayload: new Uint8Array(probe.payloadBytes) }, transport: {},
      patterns: { version: 1, beat: 0, lanes: {}, pending: [], active: [] } });
    probe.session = session;
    for (let start = 0; start < count; start += 40) await new Promise((resolve, reject) => {
      const transaction = db.transaction(['sessions', 'projectMetadata'], 'readwrite');
      for (let index = start; index < Math.min(count, start + 40); index++) {
        const id = 'doc:' + String(index).padStart(6, '0'), value = session('Project ' + String(index).padStart(6, '0'));
        transaction.objectStore('sessions').put({ id, kind: 'document', revision: 1, commitId: id, name: value.name, savedAt: value.savedAt, session: value });
        transaction.objectStore('projectMetadata').put({ id, revision: 1, name: value.name, savedAt: value.savedAt });
      }
      transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
    });
    probe.reset = () => { probe.reads = { sessionKeys: [], sessionPayloadBytes: 0, sessionCursors: 0, metadataRecords: 0, metadataBytes: 0, keyCursors: 0 }; };
    probe.reset();
    const observe = (storeName, value, key) => {
      if (storeName === 'sessions') {
        probe.reads.sessionKeys.push(String(key));
        probe.reads.sessionPayloadBytes += value?.session?.world?.qualificationPayload?.byteLength || 0;
      } else if (storeName === 'projectMetadata' && value) {
        probe.reads.metadataRecords++; probe.reads.metadataBytes += new TextEncoder().encode(JSON.stringify(value)).byteLength;
      }
    };
    for (const method of ['get', 'getAll']) {
      const original = window.IDBObjectStore.prototype[method];
      window.IDBObjectStore.prototype[method] = function(...args) {
        const request = original.apply(this, args), name = this.name;
        request.addEventListener('success', () => {
          if (method === 'getAll') for (const value of request.result) observe(name, value, value.id);
          else observe(name, request.result, args[0]);
        }); return request;
      };
    }
    for (const prototype of [window.IDBObjectStore.prototype, window.IDBIndex.prototype]) {
      const original = prototype.openCursor;
      prototype.openCursor = function(...args) {
        const request = original.apply(this, args), name = this.objectStore?.name || this.name;
        request.addEventListener('success', () => {
          const cursor = request.result; if (!cursor) return;
          if (name === 'sessions') probe.reads.sessionCursors++;
          observe(name, cursor.value, cursor.primaryKey);
        }); return request;
      };
    }
    const keys = window.IDBObjectStore.prototype.openKeyCursor;
    window.IDBObjectStore.prototype.openKeyCursor = function(...args) {
      const request = keys.apply(this, args);
      request.addEventListener('success', () => { if (request.result && this.name === 'sessions') probe.reads.keyCursors++; }); return request;
    };
  }, count);
};

for (const count of [100, 1000]) test(`native IndexedDB pages metadata for ${count} large checkpoints without materializing worlds @boundary`, async ({ page }, testInfo) => {
  test.setTimeout(90000); await prepare(page, count);
  const profiler = await page.context().newCDPSession(page); await profiler.send('HeapProfiler.collectGarbage');
  const before = await profiler.send('Runtime.getHeapUsage');
  const first = await page.evaluate(async () => {
    const probe = window.projectPageProbe; probe.reset(); probe.first = await probe.storage.listDocumentPage({ limit: 40 });
    return { page: probe.first, reads: { ...probe.reads } };
  });
  await profiler.send('HeapProfiler.collectGarbage'); const after = await profiler.send('Runtime.getHeapUsage');
  expect(first.page.items.map(item => item.id)).toEqual(Array.from({ length: 40 }, (_, index) => 'doc:' + String(count - index - 1).padStart(6, '0')));
  expect(first.reads.sessionKeys).toEqual([]); expect(first.reads.sessionCursors).toBe(0); expect(first.reads.sessionPayloadBytes).toBe(0);
  expect(first.reads.metadataRecords).toBeLessThanOrEqual(42); expect(first.reads.metadataBytes).toBeLessThan(10000);
  expect(after.usedSize - before.usedSize).toBeLessThan(2 * 1024 * 1024);
  const rest = await page.evaluate(async () => {
    const probe = window.projectPageProbe; probe.reset(); let cursor = probe.first.nextCursor, ids = probe.first.items.map(item => item.id);
    while (cursor) { const page = await probe.storage.listDocumentPage({ limit: 40, cursor }); ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor; }
    const browsing = { ...probe.reads }; probe.reset();
    const chosen = await probe.storage.loadDocument('doc:000005');
    return { ids, browsing, chosen: { id: chosen.id, bytes: chosen.session.world.qualificationPayload.byteLength }, selected: { ...probe.reads } };
  });
  expect(new Set(rest.ids).size).toBe(count); expect(rest.ids).toEqual(Array.from({ length: count }, (_, index) => 'doc:' + String(count - index - 1).padStart(6, '0')));
  expect(rest.browsing.sessionKeys).toEqual([]); expect(rest.browsing.sessionPayloadBytes).toBe(0);
  expect(rest.chosen).toEqual({ id: 'doc:000005', bytes: 128 * 1024 }); expect(rest.selected.sessionKeys).toEqual(['doc:000005']);
  expect(rest.selected.sessionPayloadBytes).toBe(128 * 1024);
  const receipt = {
    fixture: 'controlled valid session headers with 128 KiB opaque checkpoint payloads; not captured performances', count,
    totalCheckpointPayloadBytes: count * 128 * 1024, firstPage: first.reads, retainedHeapDeltaBytes: after.usedSize - before.usedSize,
    remainingPages: rest.browsing, selected: rest.selected, byteMetric: 'materialized checkpoint typed-array bytes and UTF-8 metadata JSON bytes; not IndexedDB wire encoding'
  };
  console.log('PROJECT_PAGING_RECEIPT ' + JSON.stringify(receipt));
  await testInfo.attach('native-indexeddb-read-receipt', { contentType: 'application/json', body: JSON.stringify(receipt, null, 2) });
  await page.evaluate(() => { window.projectPageProbe.storage.close(); window.projectPageProbe.db.close(); });
});

test('native metadata cursor remains stable through another connection renaming and deleting projects; sparse search and cancellation stay bounded @boundary', async ({ page }) => {
  await prepare(page, 300);
  const result = await page.evaluate(async () => {
    const probe = window.projectPageProbe, first = await probe.storage.listDocumentPage({ limit: 40 });
    const { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js'), writer = createProcgenSessionStorage();
    const value = probe.session('Renamed distant project');
    await writer.saveDocument('doc:000005', 1, value, 'rename-5'); await writer.remove('doc:000250');
    const next = await probe.storage.listDocumentPage({ limit: 40, cursor: first.nextCursor });
    probe.reset(); const search = await probe.storage.listDocumentPage({ query: 'renamed', limit: 10 }), searchReads = { ...probe.reads };
    const final = await probe.storage.listDocumentPage({ query: 'renamed', limit: 10, cursor: search.nextCursor });
    const controller = new AbortController(); controller.abort(); probe.reset(); let canceled = false;
    try { await probe.storage.listDocumentPage({ signal: controller.signal }); } catch (error) { canceled = error.name === 'AbortError'; }
    const canceledReads = { ...probe.reads };
    let inFlightCanceled = false, cancelReadCount = 0;
    const abort = new AbortController(), original = window.IDBIndex.prototype.openCursor;
    window.IDBIndex.prototype.openCursor = function(...args) {
      const request = original.apply(this, args); request.addEventListener('success', () => { if (request.result) { cancelReadCount++; abort.abort(); } }); return request;
    };
    try { await probe.storage.listDocumentPage({ signal: abort.signal }); } catch (error) { inFlightCanceled = error.category === 'transaction-abort'; }
    window.IDBIndex.prototype.openCursor = original;
    writer.close(); probe.storage.close(); probe.db.close();
    return { first: first.items.map(item => item.id), next: next.items.map(item => item.id), search, searchReads, final,
      canceled, canceledReads, inFlightCanceled, cancelReadCount };
  });
  expect(result.next).toHaveLength(40); expect(result.next).not.toContain('doc:000250');
  expect(result.next.some(id => result.first.includes(id))).toBe(false);
  expect(result.search.items).toEqual([]); expect(result.search.nextCursor).toBeTruthy(); expect(result.searchReads.metadataRecords).toBeLessThanOrEqual(202);
  expect(result.searchReads.sessionKeys).toEqual([]); expect(result.final.items.map(item => item.id)).toEqual(['doc:000005']);
  expect(result.canceled).toBe(true); expect(result.canceledReads.sessionKeys).toEqual([]); expect(result.canceledReads.metadataRecords).toBe(0);
  expect(result.inFlightCanceled).toBe(true); expect(result.cancelReadCount).toBe(1);
});

test('native legacy migration skips modern payloads, notices writes from another owner and preserves recovery sources @boundary', async ({ page }) => {
  await prepare(page, 100);
  const result = await page.evaluate(async () => {
    const probe = window.projectPageProbe, { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js');
    const writer = createProcgenSessionStorage();
    await writer.save('old-one', probe.session('Legacy one')); await writer.save('__recovery__', probe.session('Legacy recovery'));
    probe.reset(); const first = await probe.storage.listDocumentPage({ limit: 40 }), migrationReads = { ...probe.reads };
    const all = await probe.storage.listDocuments(); await writer.save('old-two', probe.session('Legacy two'));
    const again = await probe.storage.listDocuments();
    const recovery = await probe.storage.loadRecovery();
    const preserved = await new Promise((resolve, reject) => {
      const transaction = probe.db.transaction('sessions'), request = transaction.objectStore('sessions').count('old-one');
      transaction.oncomplete = () => resolve(request.result); transaction.onabort = () => reject(transaction.error);
    });
    writer.close(); probe.storage.close(); probe.db.close();
    return { first: first.items.length, names: all.map(item => item.name), again: again.map(item => item.name), recovery: recovery.name, preserved, migrationReads };
  });
  expect(result.first).toBe(40); expect(result.names).toHaveLength(101); expect(result.again).toHaveLength(102);
  expect(result.names).toContain('Legacy one'); expect(result.again).toContain('Legacy two'); expect(result.names).not.toContain('Legacy recovery');
  expect(result.recovery).toBe('Legacy recovery'); expect(result.preserved).toBe(1);
  expect(result.migrationReads.sessionKeys.filter(key => /^doc:\d+$/.test(key))).toEqual([]);
  expect(result.migrationReads.sessionCursors).toBe(0); expect(result.migrationReads.keyCursors).toBeGreaterThan(100);
});

test('production picker pages by keyboard, retains the live document on corrupt/deleted selections, retries and opens only the chosen project @boundary', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 60000 });
  await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause();
    const { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js');
    const storage = createProcgenSessionStorage(), captured = studio.capture(), probe = window.pickerProbe = { storage, captured, gets: [] };
    for (let index = 0; index < 45; index++) {
      const id = 'doc:' + String(index).padStart(6, '0'), value = { ...captured, name: 'Saved ' + index, savedAt: '2026-10-27T12:00:00.000Z' };
      await storage.saveDocument(id, 0, value, 'fixture-' + index);
    }
    const { RECOVERY_DATABASE_NAME } = await import('/js/runtime/BrowserGenerationPins.js');
    const opening = indexedDB.open(RECOVERY_DATABASE_NAME);
    const db = await new Promise((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('sessions', 'readwrite');
      const corrupt = structuredClone(captured); corrupt.world.graph.owners.find(owner => owner.name === 'world').props.step = 'invalid imported method';
      transaction.objectStore('sessions').put({ id: 'doc:000043', kind: 'document', revision: 1, session: corrupt });
      transaction.objectStore('sessions').delete('doc:000042');
      transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
    }); db.close();
    const get = window.IDBObjectStore.prototype.get;
    window.IDBObjectStore.prototype.get = function(id) { if (this.name === 'sessions' && String(id).startsWith('doc:')) probe.gets.push(id); return get.call(this, id); };
    probe.before = studio.getDocumentState(); probe.project = studio.getProject(); probe.world = window.__PROCGEN_LANES__.world;
    await studio.handlers.load();
  });
  const dialog = page.getByRole('dialog', { name: 'Saved projects', exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog.locator('.studio-project-items button')).toHaveCount(40);
  expect(await page.evaluate(() => window.pickerProbe.gets)).toEqual([]);
  for (const index of [43, 42]) {
    await dialog.getByRole('button', { name: new RegExp('^Saved ' + index + ' ·') }).click();
    await expect(dialog.locator('.studio-project-feedback')).not.toHaveText('Opening project…');
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => {
      const probe = window.pickerProbe, studio = window.__PROCGEN_STUDIO__;
      return { sameIdentity: JSON.stringify(probe.before) === JSON.stringify(studio.getDocumentState()), sameProject: probe.project === studio.getProject(), sameWorld: probe.world === window.__PROCGEN_LANES__.world };
    })).toEqual({ sameIdentity: true, sameProject: true, sameWorld: true });
  }
  await page.evaluate(async () => {
    const probe = window.pickerProbe;
    await probe.storage.saveDocument('doc:000042', 0, { ...probe.captured, name: 'Repaired selected project', savedAt: '2026-10-27T12:00:00.000Z' }, 'retry');
    probe.gets.length = 0;
  });
  const more = dialog.getByRole('button', { name: 'More projects', exact: true }); await more.focus(); await page.keyboard.press('Enter');
  await expect(dialog.locator('.studio-project-items button')).toHaveCount(5);
  await expect(dialog.locator('.studio-project-items button').first()).toBeFocused();
  expect(await page.evaluate(() => window.pickerProbe.gets)).toEqual([]);
  await dialog.getByRole('button', { name: 'Previous projects', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(dialog.locator('.studio-project-items button')).toHaveCount(40);
  await dialog.getByRole('button', { name: /^Repaired selected project ·/ }).focus(); await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => ({ id: window.__PROCGEN_STUDIO__.getDocumentState().id, gets: window.pickerProbe.gets }))).toEqual({ id: 'doc:000042', gets: ['doc:000042'] });
  await page.evaluate(async () => { window.pickerProbe.gets.length = 0; await window.__PROCGEN_STUDIO__.handlers.load(); });
  await expect(dialog).toBeVisible(); await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => window.pickerProbe.gets)).toEqual([]);
  await page.evaluate(() => window.pickerProbe.storage.close());
});
