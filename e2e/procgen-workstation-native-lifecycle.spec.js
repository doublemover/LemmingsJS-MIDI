import { expect, test } from '@playwright/test';

test.use({ channel: 'chromium', launchOptions: { executablePath: process.env.LEMMINGS_E2E_EXECUTABLE || undefined,
  ignoreDefaultArgs: ['--disable-back-forward-cache'], args: ['--allow-insecure-localhost', '--ignore-certificate-errors'] } });

const boot = async page => {
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
};
const output = page => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState());
const heldPerformances = page => page.evaluate(async () => (await navigator.locks.query()).held.filter(lock => lock.name === 'lemmingsjs-midi:performance:v1:default').length);

test('closing an owner during actual worklet capture releases its native lock without autoplaying the other desktop tab', { tag: '@boundary' }, async ({ page, context }, testInfo) => {
  test.setTimeout(120000); const second = await context.newPage(); await Promise.all([boot(page), boot(second)]);
  await page.locator('#procgenListen').click(); await expect.poll(async () => (await output(page)).enabled).toBe(true);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.openMasterCapture());
  const capture = page.getByRole('dialog', { name: 'Record browser master', exact: true });
  await capture.getByLabel('Maximum audio capture duration').selectOption('30'); await capture.getByRole('button', { name: 'Start master capture', exact: true }).click();
  await expect(capture.getByRole('status')).toContainText('recording');
  const beforeClose = { output: await output(page), capture: await capture.innerText() };
  await expect(second.locator('#procgenListen')).toHaveText('Take over browser output'); await page.close();
  await expect.poll(() => heldPerformances(second)).toBe(0); expect((await output(second)).enabled).toBe(false);
  await testInfo.attach('owner-closed-during-native-capture.json', { body: JSON.stringify({ beforeClose, peer: await output(second), retainedPcm: 'not-claimed;owner-realm-destroyed' }, null, 2), contentType: 'application/json' });
  await second.locator('#procgenListen').click(); await expect.poll(async () => (await output(second)).enabled).toBe(true);
});

test('a rejected native context shutdown refuses takeover until the old owner actually closes', { tag: '@boundary' }, async ({ page, context }, testInfo) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const NativeContext = window.AudioContext; window.nativeContexts = []; window.nativeShutdownRejected = 0;
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); window.nativeContexts.push(this); }
      suspend() { if (window.rejectNativeShutdown) { window.nativeShutdownRejected++; return Promise.reject(new Error('Controlled native suspension rejection')); } return super.suspend(); }
    };
  });
  const second = await context.newPage(); await Promise.all([boot(page), boot(second)]);
  await page.locator('#procgenListen').click(); await expect.poll(async () => (await output(page)).enabled).toBe(true);
  await page.evaluate(() => { window.rejectNativeShutdown = true; });
  await expect(second.locator('#procgenListen')).toHaveText('Take over browser output'); await second.locator('#procgenListen').click();
  await expect.poll(() => page.evaluate(() => window.nativeShutdownRejected)).toBeGreaterThan(0);
  await expect.poll(async () => (await output(page)).audio.performanceLease.status).toBe('blocked');
  await expect.poll(async () => (await output(second)).status).toBe('error');
  expect((await output(second)).enabled).toBe(false); expect(await heldPerformances(second)).toBe(1);
  const previous = await page.evaluate(() => ({ state: window.__PROCGEN_STUDIO__.getPlaybackState(), nativeState: window.nativeContexts[0].state }));
  expect(previous.nativeState).toBe('running');
  await testInfo.attach('rejected-native-shutdown.json', { body: JSON.stringify({ previous, refused: await output(second) }, null, 2), contentType: 'application/json' });
  await page.close(); await expect.poll(() => heldPerformances(second)).toBe(0); expect((await output(second)).enabled).toBe(false);
  await second.locator('#procgenListen').click(); await expect.poll(async () => (await output(second)).enabled).toBe(true);
});

test('canceling takeover while the real native context is awaiting suspension never queues new playback', { tag: '@boundary' }, async ({ page, context }, testInfo) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      suspend() { if (!window.delayNativeSuspension) return super.suspend(); return new Promise((resolve, reject) => { window.releaseNativeSuspension = () => { window.delayNativeSuspension = false; super.suspend().then(resolve, reject); }; }); }
    };
  });
  const second = await context.newPage(); await Promise.all([boot(page), boot(second)]);
  await page.locator('#procgenListen').click(); await expect.poll(async () => (await output(page)).enabled).toBe(true);
  await page.evaluate(() => { window.delayNativeSuspension = true; });
  await expect(second.locator('#procgenListen')).toHaveText('Take over browser output'); await second.locator('#procgenListen').click();
  await page.waitForFunction(() => typeof window.releaseNativeSuspension === 'function');
  expect((await output(second)).enabled).toBe(false); expect(await heldPerformances(second)).toBe(1);
  await second.locator('#procgenListen').click(); await expect.poll(async () => (await output(second)).status).toBe('off');
  await page.evaluate(() => window.releaseNativeSuspension()); await expect.poll(() => heldPerformances(second)).toBe(0);
  const canceled = await output(second); expect(canceled.enabled).toBe(false); expect(canceled.audio.performanceLease.pendingRequests).toBe(0);
  await testInfo.attach('canceled-native-takeover.json', { body: JSON.stringify({ previous: await output(page), canceled }, null, 2), contentType: 'application/json' });
  await second.locator('#procgenListen').click(); await expect.poll(async () => (await output(second)).enabled).toBe(true);
});

test('missing BroadcastChannel cannot transfer a live native lock and closing the owner does not autoplay its peer', { tag: '@boundary' }, async ({ page, context }, testInfo) => {
  test.setTimeout(120000); const second = await context.newPage();
  for (const target of [page, second]) await target.addInitScript(() => Object.defineProperty(window, 'BroadcastChannel', { value: undefined, configurable: true }));
  await Promise.all([boot(page), boot(second)]); await page.locator('#procgenListen').click(); await expect.poll(async () => (await output(page)).enabled).toBe(true);
  await second.locator('#procgenListen').click(); await expect(second.locator('#procgenListen')).toHaveText('Take over browser output');
  await second.locator('#procgenListen').click(); await expect.poll(async () => (await output(second)).status).toBe('error');
  expect((await output(second)).audio.performanceLease.reason).toBe('handoff-channel-unavailable'); expect((await output(page)).enabled).toBe(true);
  await testInfo.attach('absent-handoff-channel.json', { body: JSON.stringify({ previous: await output(page), refused: await output(second) }, null, 2), contentType: 'application/json' });
  await page.close(); await expect.poll(() => heldPerformances(second)).toBe(0); expect((await output(second)).enabled).toBe(false);
  await second.locator('#procgenListen').click(); await expect.poll(async () => (await output(second)).enabled).toBe(true);
});

test('reload abandons a performance claim after native graph preparation without reviving its context or autoplaying', { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const request = navigator.locks.request.bind(navigator.locks); window.delayedClaims = 0; window.delayPerformanceClaim = true;
    navigator.locks.request = (name, options, callback) => {
      if (name !== 'lemmingsjs-midi:performance:v1:default' || !window.delayPerformanceClaim) return request(name, options, callback);
      window.delayedClaims++; return new Promise(resolve => { window.releasePerformanceClaim = () => resolve(request(name, options, callback)); });
    };
  });
  await boot(page); await page.locator('#procgenListen').click(); await page.waitForFunction(() => window.delayedClaims === 1);
  expect((await output(page)).enabled).toBe(false); expect((await output(page)).audio.contextState).toBe('running');
  await page.reload(); await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  const restored = await output(page); expect(restored.enabled).toBe(false); expect(restored.audio.contextState).toBe('not-created'); expect(await heldPerformances(page)).toBe(0);
  await testInfo.attach('reload-during-performance-claim.json', { body: JSON.stringify(restored, null, 2), contentType: 'application/json' });
  await page.evaluate(() => { window.delayPerformanceClaim = false; }); await page.locator('#procgenListen').click(); await expect.poll(async () => (await output(page)).enabled).toBe(true);
});

test('a real Chromium freeze revokes performance and thaw never restarts the old desktop owner', { tag: '@boundary' }, async ({ page, context }, testInfo) => {
  test.setTimeout(120000); const second = await context.newPage(); await Promise.all([boot(page), boot(second)]);
  await page.locator('#procgenListen').click(); await expect.poll(async () => (await output(page)).enabled).toBe(true);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.play());
  await expect(second.locator('#procgenListen')).toHaveText('Take over browser output');
  const session = await context.newCDPSession(page); let thawed = false;
  try {
    await session.send('Page.setWebLifecycleState', { state: 'frozen' });
    await second.locator('#procgenListen').click();
    await expect.poll(async () => { const state = await output(second); return state.enabled || !['starting', 'unlocking'].includes(state.status); }, { timeout: 8000 }).toBe(true);
    const during = await output(second), held = await second.evaluate(async () => (await navigator.locks.query()).held);
    await session.send('Page.setWebLifecycleState', { state: 'active' }); thawed = true;
    await expect.poll(async () => (await output(page)).enabled).toBe(false);
    const previous = await page.evaluate(() => ({ output: window.__PROCGEN_STUDIO__.getPlaybackState(), transport: window.__PROCGEN_STUDIO__.transport.getState() }));
    expect(previous.transport.playing).toBe(false);
    if (during.enabled) expect(['suspended', 'closed']).toContain(previous.output.audio.contextState);
    else expect(during.audio.performanceLease.exclusive).toBe(false);
    expect(held.filter(lock => lock.name === 'lemmingsjs-midi:performance:v1:default').length).toBeLessThanOrEqual(1);
    await testInfo.attach('actual-freeze-handoff.json', { body: JSON.stringify({ during, held, previous, current: await output(second) }, null, 2), contentType: 'application/json' });
    await page.close();
    if (!(await output(second)).enabled) { await second.locator('#procgenListen').click(); await expect.poll(async () => (await output(second)).enabled).toBe(true); }
  } finally { if (!thawed) await session.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {}); await session.detach().catch(() => {}); }
});

test('real back/forward history restores the same instrument realm paused and requires fresh output activation', { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const session = await page.context().newCDPSession(page), notRestored = [];
  await session.send('Page.enable'); session.on('Page.backForwardCacheNotUsed', event => notRestored.push(event));
  await page.addInitScript(() => {
    window.nativeHistoryReceipt = { marker: crypto.randomUUID(), pagehides: [], pageshows: [] };
    window.addEventListener('pagehide', event => window.nativeHistoryReceipt.pagehides.push(event.persisted));
    window.addEventListener('pageshow', event => window.nativeHistoryReceipt.pageshows.push(event.persisted));
  });
  await boot(page); await page.locator('#procgenListen').click(); await expect.poll(async () => (await output(page)).enabled).toBe(true);
  const before = await page.evaluate(() => ({ marker: window.nativeHistoryReceipt.marker, revision: window.__PROCGEN_STUDIO__.getDocumentState().editRevision,
    world: window.__PROCGEN_LANES__.world.worldId, playback: window.__PROCGEN_STUDIO__.getPlaybackState() }));
  await page.goto('about:blank'); await page.goBack({ waitUntil: 'commit' });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  const after = await page.evaluate(() => ({ history: window.nativeHistoryReceipt, world: window.__PROCGEN_LANES__.world.worldId,
    revision: window.__PROCGEN_STUDIO__.getDocumentState().editRevision, playback: window.__PROCGEN_STUDIO__.getPlaybackState(),
    transport: window.__PROCGEN_STUDIO__.transport.getState(), notRestoredReasons: performance.getEntriesByType('navigation')[0]?.notRestoredReasons?.toJSON?.() || null }));
  await testInfo.attach('actual-history-navigation.json', { body: JSON.stringify({ before, after, notRestored }, null, 2), contentType: 'application/json' });
  await session.detach();
  expect(after.history.marker, JSON.stringify(after.notRestoredReasons)).toBe(before.marker);
  expect(after.history.pageshows).toContain(true); expect(after.world).toBe(before.world); expect(after.revision).toBe(before.revision);
  expect(after.playback.enabled).toBe(false); expect(after.transport.playing).toBe(false); expect(after.playback.audio.performanceLease.exclusive).toBe(false);
  await page.locator('#procgenListen').click(); await expect.poll(async () => (await output(page)).enabled).toBe(true);
});
