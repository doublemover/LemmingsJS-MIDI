import { expect, test } from '@playwright/test';

const openFixture = async page => {
  await page.route('**/__asset_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Asset boundary fixture</title>' }));
  await page.goto('/__asset_fixture__');
};

test('raw byte leases cover real transport and warm IndexedDB readers through final release', async ({ page }) => {
  let requests = 0;
  await page.route('**/budget-real.bin', route => {
    requests++;
    return route.fulfill({ headers: { 'Cache-Control': 'max-age=3600' }, body: Buffer.alloc(256, 7) });
  });
  await openFixture(page);
  const result = await page.evaluate(async () => {
    const { FileProvider } = await import('/js/data/FileProvider.js');
    const { createResourceBudget } = await import('/js/app/resources/ResourceBudget.js');
    const budget = createResourceBudget({ limitBytes: 65536 });
    const provider = new FileProvider('/', { budgetAdapter: budget, maxResponseBytes: 4096, localStorage: null, cacheProbeMs: 1000 });
    const handle = await provider.resolveAsset('/budget-real.bin'); await provider.waitForCacheWrites();
    const reader = handle.createReader(); handle.release(); provider.clearCache();
    const pinned = budget.diagnostics().residentBytes; reader.release();
    const cleared = budget.diagnostics().residentBytes;
    const warm = await provider.loadBinary('budget-real.bin'); await provider.waitForCacheWrites();
    const warmBytes = budget.diagnostics().residentBytes, value = warm.readByte();
    const db = await provider._openIndexedDb();
    const tx = db.transaction('meta', 'readwrite'), done = provider._idbTransactionDone(tx);
    tx.objectStore('meta').put({ key: 'totalBytes', value: 999, accountingVersion: 1 }); await done;
    await provider._pruneIndexedDb();
    const total = provider.getCacheStats().indexedDbBytes;
    provider.dispose(); warm.release();
    return { pinned, cleared, warmBytes, value, total, final: budget.diagnostics().residentBytes, peak: budget.diagnostics().peakAccountedBytes,
      byobResponses: provider.getRawAssetStats().byobResponses, estimatedResponses: provider.getRawAssetStats().estimatedStreamResponses };
  });
  expect(requests).toBe(1);
  expect(result).toMatchObject({ pinned: 256, cleared: 0, warmBytes: 256, value: 7, total: 256, final: 0, byobResponses: 1, estimatedResponses: 0 });
  expect(result.peak).toBeLessThanOrEqual(65536);
});

test('fallback admissions in separate tabs share the Web Lock and preserve owned UTF-16 cap', async ({ page, context }) => {
  await openFixture(page);
  const other = await context.newPage(); await openFixture(other);
  await page.evaluate(() => globalThis.localStorage.setItem('user-session-fixture', 'keep'));
  const write = (target, suffix) => target.evaluate(async suffix => {
    const { FileProvider } = await import('/js/data/FileProvider.js');
    const provider = new FileProvider('/', { indexedDB: null, cacheProbeMs: 1000 });
    const admitted = await provider._storeInLocalStorageCoordinated(`/parallel-${suffix}`, { type: 'text', data: suffix.repeat(1_100_000) });
    const bytes = provider._getLocalStorageUsage(); provider.dispose();
    return { admitted, bytes };
  }, suffix);
  const results = await Promise.all([write(page, 'a'), write(other, 'b')]);
  const usage = await page.evaluate(() => {
    let bytes = 0;
    for (let i = 0; i < globalThis.localStorage.length; i++) {
      const key = globalThis.localStorage.key(i);
      if (key.startsWith('lem-cache:')) bytes += (key.length + globalThis.localStorage.getItem(key).length) * 2;
    }
    return { bytes, session: globalThis.localStorage.getItem('user-session-fixture') };
  });
  expect(results.some(result => result.admitted)).toBe(true);
  expect(usage.bytes).toBeLessThanOrEqual(4 * 1024 * 1024); expect(usage.session).toBe('keep');
  await other.close();
});

test('real terrain decoding retires private compressed cursors before cache eviction', async ({ page }) => {
  await page.route('**/lemmings/*.DAT', async route => {
    const response = await route.fetch();
    return route.fulfill({ response, headers: { ...response.headers(), 'cache-control': 'max-age=3600' } });
  });
  await openFixture(page);
  const result = await page.evaluate(async () => {
    const { FileProvider } = await import('/js/data/FileProvider.js');
    const { EditorAssetCache } = await import('/js/editor/EditorAssetCache.js');
    const { createResourceBudget } = await import('/js/app/resources/ResourceBudget.js');
    const budget = createResourceBudget({ limitBytes: 128 * 1024 * 1024 });
    const provider = new FileProvider('/', { budgetAdapter: budget, maxResponseBytes: 2 * 1024 * 1024, localStorage: null, cacheProbeMs: 1000 });
    const cache = new EditorAssetCache();
    const assets = await cache.loadStyleAssets('dirt', { path: 'lemmings' }, provider);
    await provider.waitForCacheWrites();
    const warm = provider.getRawAssetStats();
    provider.clearCache(); const retired = provider.getRawAssetStats().residentBytes;
    const decoded = assets.terrainImages.some(image => image?.frames?.length);
    const decodedResident = budget.diagnostics().residentBytes;
    const retirement = cache.clear(); await retirement.completion; provider.dispose();
    return { warm, retired, decoded, decodedResident, retirement: retirement.outcome, remaining: budget.diagnostics().accountedBytes };
  });
  expect(result.decoded).toBe(true); expect(result.warm.residentBytes).toBeGreaterThan(0);
  expect(result.warm.pinnedBytes).toBe(0); expect(result.retired).toBe(0);
  expect(result.decodedResident).toBeGreaterThan(0); expect(result.retirement).toBe('complete'); expect(result.remaining).toBe(0);
});

test('GameResources and LevelLoader retire owned raw cursors while surviving consumers stay readable', async ({ page }) => {
  let mainRequests = 0;
  page.on('request', request => { if (request.url().endsWith('/lemmings/MAIN.DAT')) mainRequests++; });
  await page.route('**/lemmings/*.DAT', async route => {
    const response = await route.fetch();
    return route.fulfill({ response, headers: { ...response.headers(), 'cache-control': 'max-age=3600' } });
  });
  await openFixture(page);
  const result = await page.evaluate(async () => {
    const [{ FileProvider }, { GameResources }, { LevelLoader }, { GameTypes }, { createResourceBudget }] = await Promise.all([
      import('/js/data/FileProvider.js'), import('/js/game/GameResources.js'), import('/js/level/LevelLoader.js'),
      import('/js/game/GameTypes.js'), import('/js/app/resources/ResourceBudget.js')
    ]);
    const budget = createResourceBudget({ limitBytes: 32 * 1024 * 1024 });
    const provider = new FileProvider('/', { budgetAdapter: budget, maxResponseBytes: 2 * 1024 * 1024, localStorage: null, cacheProbeMs: 1000 });
    const config = { path: 'lemmings', gametype: GameTypes.LEMMINGS, mechanics: {}, level: { groups: [], filePrefix: 'LEVEL', useOddTable: false, order: [[0]] } };
    const a = new GameResources(provider, config), b = new GameResources(provider, config);
    const [first, second] = await Promise.all([a.getMainDat(), b.getMainDat()]);
    await provider.waitForCacheWrites();
    const before = provider.getRawAssetStats().pinnedBytes;
    const held = first.getPart(0), expected = held.readByte(); held.setOffset(0);
    a.dispose(); const afterOne = provider.getRawAssetStats().pinnedBytes;
    const survivor = second.getPart(0), survivorValue = survivor.readByte(); survivor.release(); b.dispose();
    const afterBoth = provider.getRawAssetStats().pinnedBytes, heldValue = held.readByte(); held.release();
    const level = await new LevelLoader(provider, config).getLevel(0, 0);
    await provider.waitForCacheWrites();
    const afterLevel = provider.getRawAssetStats().pinnedBytes;
    provider.clearCache(); const cleared = budget.diagnostics().residentBytes;
    provider.dispose();
    return { before, afterOne, afterBoth, afterLevel, expected, survivorValue, heldValue, cleared, levelPixels: level.groundMask.mask.some(Boolean) };
  });
  expect(mainRequests).toBe(1);
  expect(result.before).toBeGreaterThan(0); expect(result.afterOne).toBe(result.before);
  expect(result.afterBoth).toBe(0); expect(result.afterLevel).toBe(0); expect(result.cleared).toBe(0);
  expect(result.survivorValue).toBe(result.expected); expect(result.heldValue).toBe(result.expected); expect(result.levelPixels).toBe(true);
});

test('HTTP conditional 304 updates metadata without a payload rewrite and changed bytes preserve old handles', async ({ page }) => {
  let revision = 1, failure = false;
  const observed = [];
  await page.route('**/conditional.bin', route => {
    const request = route.request(), etag = `"revision-${revision}"`;
    observed.push({ method: request.method(), etag: request.headers()['if-none-match'], modified: request.headers()['if-modified-since'] });
    if (failure) return route.fulfill({ status: 500, body: 'offline fixture' });
    const headers = { ETag: etag, 'Last-Modified': 'Wed, 01 Jan 2020 00:00:00 GMT' };
    return route.fulfill({ status: request.headers()['if-none-match'] === etag ? 304 : 200,
      headers, body: request.headers()['if-none-match'] === etag ? '' : Buffer.from([revision]) });
  });
  await openFixture(page);
  const first = await page.evaluate(async () => {
    const { FileProvider } = await import('/js/data/FileProvider.js');
    const provider = new FileProvider('/', { localStorage: null, cacheProbeMs: 1000 });
    const old = await provider.resolveAsset('/conditional.bin');
    await provider.waitForCacheWrites();
    let payloadWrites = 0;
    const originalPut = globalThis.IDBObjectStore.prototype.put;
    globalThis.IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'payloads') payloadWrites++;
      return originalPut.apply(this, args);
    };
    globalThis.__assetGenerationFixture = { provider, old, originalPut, writes: () => payloadWrites };
    provider.clearCache();
    const cached = await provider.resolveAsset('/conditional.bin');
    await Promise.all([...provider._validationPromises.values()]);
    await provider.waitForCacheWrites();
    return { hash: old.identity.contentHash, sameHash: old.identity.contentHash === cached.identity.contentHash,
      payloadWrites, value: cached.createReader().readByte() };
  });
  expect(first.sameHash).toBe(true); expect(first.value).toBe(1); expect(first.payloadWrites).toBe(0);
  expect(observed).toEqual([{ method: 'GET', etag: undefined, modified: undefined },
    { method: 'GET', etag: '"revision-1"', modified: undefined }]);
  revision = 2;
  const changed = await page.evaluate(async () => {
    const state = globalThis.__assetGenerationFixture;
    state.latest = await state.provider.resolveAsset('/conditional.bin', { cachePolicy: 'revalidate' });
    await state.provider.waitForCacheWrites();
    return { hash: state.latest.identity.contentHash, latest: state.latest.createReader().readByte(), old: state.old.createReader().readByte() };
  });
  expect(changed.hash).not.toBe(first.hash); expect(changed.latest).toBe(2); expect(changed.old).toBe(1);
  failure = true;
  const rejected = await page.evaluate(async () => {
    const state = globalThis.__assetGenerationFixture;
    try {
      await state.provider.resolveAsset('/conditional.bin', { cachePolicy: 'revalidate' });
      throw new Error('Expected typed refresh failure');
    } catch (error) {
      const current = await state.provider.resolveAsset('/conditional.bin');
      return { kind: error.kind, value: current.createReader().readByte(), hash: current.identity.contentHash };
    } finally {
      globalThis.IDBObjectStore.prototype.put = state.originalPut;
      state.provider.dispose();
      delete globalThis.__assetGenerationFixture;
    }
  });
  expect(rejected).toEqual({ kind: 'server', value: 2, hash: changed.hash });
});

test('real HTTP seasonal absence resolves to the same terrain and steel as an explicit source', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (/GROUND0O\.DAT/.test(request.url())) requests.push(new URL(request.url()).pathname); });
  await openFixture(page);
  const result = await page.evaluate(async () => {
    const [{ FileProvider }, { LevelLoader }, { GameTypes }] = await Promise.all([
      import('/js/data/FileProvider.js'), import('/js/level/LevelLoader.js'), import('/js/game/GameTypes.js')
    ]);
    const provider = new FileProvider('/', { indexedDB: null, localStorage: null });
    const config = { path: 'xmas92', gametype: GameTypes.XMAS92, mechanics: {},
      level: { filePrefix: 'LEVEL', useOddTable: false, order: [[4]] } };
    const level = await new LevelLoader(provider, config).getLevel(0, 0);
    const bytes = await (await fetch('/xmas91/GROUND0O.DAT')).arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    const exact = await new LevelLoader(provider, { ...config, resourcePins: { 'GROUND0O.DAT': { root: 'xmas91', sha256: hash } } }).getLevel(0, 0);
    const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
    const result = { sameTerrain: equal(level.groundMask.mask, exact.groundMask.mask), sameSteel: equal(level.steelMask.mask, exact.steelMask.mask),
      terrainPixels: Array.from(level.groundMask.mask).filter(Boolean).length, provenance: level.resourceSources.ground,
      immutable: Object.isFrozen(level.resourceSources) && Object.isFrozen(level.resourceSources.ground) };
    provider.dispose();
    return result;
  });
  expect(requests).toContain('/xmas92/GROUND0O.DAT');
  expect(requests).toContain('/xmas91/GROUND0O.DAT');
  expect(result).toMatchObject({ sameTerrain: true, sameSteel: true, immutable: true,
    provenance: { root: 'xmas91', filename: 'GROUND0O.DAT' } });
  expect(result.terrainPixels).toBeGreaterThan(0);
});

for (const status of [401, 403, 429, 500]) {
  test(`HTTP ${status} retains its type and cannot select a substitute seasonal pack`, async ({ page }) => {
    let substituted = false;
    await page.route('**/xmas92/GROUND0O.DAT', route => route.fulfill({ status, body: 'fixture failure' }));
    await page.route('**/xmas91/GROUND0O.DAT', route => { substituted = true; return route.continue(); });
    await openFixture(page);
    const result = await page.evaluate(async () => {
      const [{ FileProvider }, { LevelLoader }] = await Promise.all([import('/js/data/FileProvider.js'), import('/js/level/LevelLoader.js')]);
      const provider = new FileProvider('/', { indexedDB: null, localStorage: null });
      try {
        await new LevelLoader(provider, { path: 'xmas92', gametype: 0, mechanics: {},
          level: { filePrefix: 'LEVEL', useOddTable: false, order: [[4]] } }).getLevel(0, 0);
      } catch (error) { return { kind: error.kind, status: error.status, roots: error.attemptedRoots, message: error.message }; }
      finally { provider.dispose(); }
      throw new Error('Expected a typed transport error');
    });
    expect(result.status).toBe(status);
    expect(result.roots).toEqual(['xmas92']);
    expect(result.kind).toBe(status === 500 ? 'server' : status === 429 ? 'rate-limit' : 'denied');
    expect(result.message).not.toContain('xmas92');
    expect(substituted).toBe(false);
  });
}

test('real IndexedDB commits consistent cross-provider totals and warm reads never rewrite payloads', async ({ page }) => {
  await openFixture(page);
  const result = await page.evaluate(async () => {
    const { FileProvider } = await import('/js/data/FileProvider.js');
    const first = new FileProvider('/', { localStorage: null, fetch: null, cacheProbeMs: 1000 });
    const second = new FileProvider('/', { localStorage: null, fetch: null, cacheProbeMs: 1000 });
    let payloadWrites = 0;
    const originalPut = globalThis.IDBObjectStore.prototype.put;
    globalThis.IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'payloads') payloadWrites++;
      return originalPut.apply(this, args);
    };
    try {
      await Promise.all([first._storeInIndexedDb('first', { type: 'text', data: 'αβγ' }), second._storeInIndexedDb('second', { type: 'text', data: 'warm' })]);
      const stale = { size: 1, hash: 'stale' };
      await second._storeInIndexedDb('first', { type: 'text', data: 'replacement payload' });
      await first._touchIndexedDbEntry('first', stale);
      const db = await first._openIndexedDb();
      const snapshot = async () => {
        const tx = db.transaction(['entries', 'payloads', 'meta'], 'readonly');
        const read = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        const [entries, payloads, total] = await Promise.all([read(tx.objectStore('entries').getAll()), read(tx.objectStore('payloads').getAll()), read(tx.objectStore('meta').get('totalBytes'))]);
        return { entries, payloads, total: total.value };
      };
      const before = await snapshot();
      payloadWrites = 0;
      const durations = [];
      for (let i = 0; i < 12; i++) {
        const start = performance.now();
        const value = await first._loadFromIndexedDb('first', 'text');
        if (value.value !== 'replacement payload') throw new Error('Stale cache content');
        durations.push(performance.now() - start);
      }
      await first._pruneIndexedDb(999999999);
      const after = await snapshot();
      const statsBeforeAbort = first.getCacheStats().indexedDbBytes;
      globalThis.IDBObjectStore.prototype.put = function(...args) {
        if (this.name === 'payloads') throw new globalThis.DOMException('Injected quota refusal', 'QuotaExceededError');
        return originalPut.apply(this, args);
      };
      const quotaStored = await first._storeInIndexedDb('quota-refused', { type: 'text', data: 'reconstructible' });
      globalThis.IDBObjectStore.prototype.put = originalPut;
      const aborted = await snapshot();
      const tx = db.transaction(['entries', 'payloads', 'meta'], 'readwrite');
      const corrupted = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = reject; });
      tx.objectStore('meta').put({ key: 'totalBytes', accountingVersion: 2, value: 999999 });
      tx.objectStore('entries').put({ url: 'legacy-partial', type: 'binary', size: 10000 });
      tx.objectStore('payloads').put({ url: 'orphan', data: 'partial old record' });
      await corrupted;
      const reconciled = await first.reconcilePersistentCache(), recovered = await snapshot();
      return { total: after.total, sum: after.entries.reduce((sum, entry) => sum + entry.size, 0),
        oldTotal: before.total, payloadWrites, payloadCount: after.payloads.length, entryCount: after.entries.length,
        maxWarmReadMs: Math.max(...durations), warmReadCount: durations.length, quotaStored,
        abortUnchanged: aborted.total === after.total && aborted.entries.length === after.entries.length,
        statsBeforeAbort, reconciled, recoveredTotal: recovered.total, recoveredEntries: recovered.entries.length, recoveredPayloads: recovered.payloads.length };
    } finally {
      globalThis.IDBObjectStore.prototype.put = originalPut;
      first.dispose(); second.dispose();
    }
  });
  expect(result.total).toBe(result.sum);
  expect(result.total).toBe(result.oldTotal);
  expect(result.entryCount).toBe(result.payloadCount);
  expect(result.payloadWrites).toBe(0);
  expect(result.warmReadCount).toBe(12);
  expect(result.quotaStored).toBe(false);
  expect(result.abortUnchanged).toBe(true);
  expect(result.reconciled).toBe(true);
  expect(result.recoveredTotal).toBe(result.total);
  expect(result.recoveredEntries).toBe(result.recoveredPayloads);
  expect(Number.isFinite(result.maxWarmReadMs)).toBe(true);
  test.info().annotations.push({ type: 'warm-cache-sample', description: JSON.stringify(result) });
});

test('real localStorage warm reads write no payloads, enforce the app cap and preserve unrelated keys', async ({ page }) => {
  await openFixture(page);
  const result = await page.evaluate(async () => {
    const { FileProvider } = await import('/js/data/FileProvider.js');
    localStorage.setItem('saved-performance-session', 'durable user data');
    let writes = 0, reads = 0;
    const storage = { getItem(key) { reads++; return localStorage.getItem(key); },
      setItem(key, value) { writes++; localStorage.setItem(key, value); }, removeItem: key => localStorage.removeItem(key),
      get length() { return localStorage.length; }, key: index => localStorage.key(index) };
    const provider = new FileProvider('/', { indexedDB: null, localStorage: storage, fetch: null });
    provider._storeInLocalStorage('/warm.txt', { type: 'text', data: 'warm asset' });
    writes = 0; reads = 0;
    const durations = [];
    for (let i = 0; i < 12; i++) {
      const start = performance.now();
      if (provider._loadFromLocalStorage('/warm.txt', 'text').value !== 'warm asset') throw new Error('Cache mismatch');
      durations.push(performance.now() - start);
    }
    const warmWrites = writes, warmReads = reads;
    const oversizedStored = provider._storeInLocalStorage('/oversized.txt', { type: 'text', data: 'x'.repeat(2100000) });
    const bytes = provider._getLocalStorageUsage();
    provider._evictLocalStorage(4 * 1024 * 1024);
    provider.dispose();
    return { warmWrites, warmReads, oversizedStored, bytes, retainedSession: localStorage.getItem('saved-performance-session'),
      maxWarmReadMs: Math.max(...durations) };
  });
  expect(result.warmWrites).toBe(0); expect(result.warmReads).toBe(12);
  expect(result.oversizedStored).toBe(false); expect(result.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  expect(result.retainedSession).toBe('durable user data');
  test.info().annotations.push({ type: 'local-storage-sample', description: JSON.stringify(result) });
});
