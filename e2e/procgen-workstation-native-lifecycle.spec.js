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
const installHistoryReceipt = page => page.addInitScript(() => {
  window.nativeHistoryReceipt = { marker: crypto.randomUUID(), pagehides: [], pageshows: [] };
  window.addEventListener('pagehide', event => window.nativeHistoryReceipt.pagehides.push(event.persisted));
  window.addEventListener('pageshow', event => window.nativeHistoryReceipt.pageshows.push(event.persisted));
});

test('canceling a real beforeunload dialog preserves the edited world and its live performance owner', { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(120000); await installHistoryReceipt(page); await boot(page);
  await page.locator('#procgenListen').click(); await expect.poll(async () => (await output(page)).enabled).toBe(true);
  const before = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { name: 'Canceled navigation source' } }); studio.play();
    window.nativeHistoryWorld = window.__PROCGEN_LANES__.world;
    window.preventNativeUnload = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', window.preventNativeUnload);
    return { url: window.location.href, revision: studio.getDocumentState().editRevision, marker: window.nativeHistoryReceipt.marker };
  });
  try {
    const requested = page.waitForEvent('dialog'); await page.evaluate(() => window.setTimeout(() => { window.location.href = 'about:blank'; }, 0));
    const dialog = await requested; expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss();
    expect(page.url()).toBe(before.url);
    const after = await page.evaluate(() => ({ history: window.nativeHistoryReceipt, sameWorld: window.nativeHistoryWorld === window.__PROCGEN_LANES__.world,
      revision: window.__PROCGEN_STUDIO__.getDocumentState().editRevision, name: window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].name,
      output: window.__PROCGEN_STUDIO__.getPlaybackState(), playing: window.__PROCGEN_STUDIO__.transport.getState().playing }));
    expect(after.history.marker).toBe(before.marker); expect(after.history.pagehides).toEqual([]); expect(after.sameWorld).toBe(true);
    expect(after.revision).toBe(before.revision); expect(after.name).toBe('Canceled navigation source'); expect(after.playing).toBe(true);
    expect(after.output.enabled).toBe(true); expect(after.output.audio.contextState).toBe('running'); expect(after.output.audio.performanceLease.exclusive).toBe(true);
    await testInfo.attach('actual-canceled-beforeunload.json', { body: JSON.stringify({ before, after }, null, 2), contentType: 'application/json' });
  } finally { await page.evaluate(() => window.removeEventListener('beforeunload', window.preventNativeUnload)).catch(() => {}); }
});

test('a pending actual preference worker survives BFCache and commits the current edited revision after return', { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(120000); await installHistoryReceipt(page);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker; window.preferenceHistoryHold = { armed: false, blocked: 0 };
    window.Worker = class extends NativeWorker {
      postMessage(message, ...options) {
        if (window.preferenceHistoryHold.armed && message?.type === 'input-start' && message.kind === 'encode-preference-pages') {
          window.preferenceHistoryHold.armed = false; window.preferenceHistoryHold.blocked++;
          window.resumeHistoryPreference = () => super.postMessage(message, ...options); return;
        }
        return super.postMessage(message, ...options);
      }
    };
  });
  await boot(page); await page.waitForFunction(() => !window.__PROCGEN_STUDIO__.getPreferenceState().active);
  const before = await page.evaluate(() => {
    window.preferenceHistoryHold.armed = true; const studio = window.__PROCGEN_STUDIO__;
    studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { name: 'Pending history revision' } }); window.nativeHistoryWorld = window.__PROCGEN_LANES__.world;
    return { marker: window.nativeHistoryReceipt.marker, revision: studio.getDocumentState().editRevision };
  });
  await page.waitForFunction(() => window.preferenceHistoryHold.blocked === 1 && window.__PROCGEN_STUDIO__.getPreferenceState().active);
  await page.goto('about:blank'); await page.goBack({ waitUntil: 'commit' }); await page.waitForFunction(() => window.__PROCGEN_STUDIO__);
  const returned = await page.evaluate(() => ({ marker: window.nativeHistoryReceipt.marker, persisted: window.nativeHistoryReceipt.pageshows.includes(true),
    sameWorld: window.nativeHistoryWorld === window.__PROCGEN_LANES__.world, name: window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].name }));
  expect(returned.marker).toBe(before.marker); expect(returned.persisted).toBe(true); expect(returned.sameWorld).toBe(true); expect(returned.name).toBe('Pending history revision');
  await page.evaluate(() => window.resumeHistoryPreference());
  await page.waitForFunction(() => { const studio = window.__PROCGEN_STUDIO__, state = studio.getPreferenceState(); return !state.active && state.pendingRevision == null && state.durableRevision === studio.getDocumentState().editRevision; });
  const after = await page.evaluate(() => ({ preferences: window.__PROCGEN_STUDIO__.getPreferenceState(), recovery: window.__PROCGEN_STUDIO__.getRecoveryState(),
    revision: window.__PROCGEN_STUDIO__.getDocumentState().editRevision, output: window.__PROCGEN_STUDIO__.getPlaybackState(), transport: window.__PROCGEN_STUDIO__.transport.getState() }));
  expect(after.revision).toBe(before.revision); expect(after.preferences.lastError).toBe(null); expect(after.preferences.retirementUnknown).toBe(false); expect(after.preferences.storage.pendingBytes).toBe(0);
  expect(after.output.enabled).toBe(false); expect(after.transport.playing).toBe(false);
  await testInfo.attach('actual-bfcache-pending-preferences.json', { body: JSON.stringify({ before, returned, after }, null, 2), contentType: 'application/json' });
});

test('actual BFCache retains dirty edits while unavailable storage stays explicit and output remains stopped', { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(120000); await installHistoryReceipt(page);
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open() { throw new window.DOMException('Controlled unavailable project storage', 'SecurityError'); } } }));
  await boot(page);
  const before = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { name: 'Unsaved history source' } }); await studio.recover();
    window.nativeHistoryWorld = window.__PROCGEN_LANES__.world;
    return { marker: window.nativeHistoryReceipt.marker, revision: studio.getDocumentState().editRevision, recovery: studio.getRecoveryState() };
  });
  expect(before.recovery.state).toBe('unavailable');
  await page.goto('about:blank'); await page.goBack({ waitUntil: 'commit' }); await page.waitForFunction(() => window.__PROCGEN_STUDIO__);
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__.getRecoveryState().state === 'unavailable');
  const after = await page.evaluate(() => ({ history: window.nativeHistoryReceipt, sameWorld: window.nativeHistoryWorld === window.__PROCGEN_LANES__.world,
    revision: window.__PROCGEN_STUDIO__.getDocumentState().editRevision, name: window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].name,
    recovery: window.__PROCGEN_STUDIO__.getRecoveryState(), output: window.__PROCGEN_STUDIO__.getPlaybackState(), transport: window.__PROCGEN_STUDIO__.transport.getState() }));
  expect(after.history.marker).toBe(before.marker); expect(after.history.pageshows).toContain(true); expect(after.sameWorld).toBe(true); expect(after.revision).toBe(before.revision);
  expect(after.name).toBe('Unsaved history source'); expect(after.recovery.durableRevision).toBeLessThan(after.revision); expect(after.output.enabled).toBe(false); expect(after.transport.playing).toBe(false);
  await testInfo.attach('actual-bfcache-unavailable-storage.json', { body: JSON.stringify({ before, after, evidence: 'Dirty source retained in the same realm; durable save not claimed.' }, null, 2), contentType: 'application/json' });
});

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
  await installHistoryReceipt(page);
  await boot(page); await page.locator('#procgenListen').click(); await expect.poll(async () => (await output(page)).enabled).toBe(true);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.play(); window.nativeHistoryWorld = window.__PROCGEN_LANES__.world; });
  const before = await page.evaluate(() => ({ marker: window.nativeHistoryReceipt.marker, revision: window.__PROCGEN_STUDIO__.getDocumentState().editRevision,
    world: window.__PROCGEN_LANES__.world.worldId, playback: window.__PROCGEN_STUDIO__.getPlaybackState(), playing: window.__PROCGEN_STUDIO__.transport.getState().playing }));
  expect(before.playing).toBe(true);
  await page.goto('about:blank'); await page.goBack({ waitUntil: 'commit' });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  const after = await page.evaluate(() => ({ history: window.nativeHistoryReceipt, world: window.__PROCGEN_LANES__.world.worldId, sameWorld: window.nativeHistoryWorld === window.__PROCGEN_LANES__.world,
    revision: window.__PROCGEN_STUDIO__.getDocumentState().editRevision, playback: window.__PROCGEN_STUDIO__.getPlaybackState(),
    transport: window.__PROCGEN_STUDIO__.transport.getState(), notRestoredReasons: performance.getEntriesByType('navigation')[0]?.notRestoredReasons?.toJSON?.() || null }));
  await testInfo.attach('actual-history-navigation.json', { body: JSON.stringify({ before, after, notRestored }, null, 2), contentType: 'application/json' });
  await session.detach();
  expect(after.history.marker, JSON.stringify(after.notRestoredReasons)).toBe(before.marker);
  expect(after.history.pageshows).toContain(true); expect(after.sameWorld).toBe(true); expect(after.world).toBe(before.world); expect(after.revision).toBe(before.revision);
  expect(after.playback.enabled).toBe(false); expect(after.transport.playing).toBe(false); expect(after.playback.audio.performanceLease.exclusive).toBe(false);
  await page.locator('#procgenListen').click(); await expect.poll(async () => (await output(page)).enabled).toBe(true);
});
