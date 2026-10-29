import { expect, test } from '@playwright/test';

const boot = async page => {
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
};
const enabled = page => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().enabled);

test('concurrent desktop tabs admit one browser performance and keep the other stopped after owner closure', { tag: '@boundary' }, async ({ page, context }) => {
  test.setTimeout(120000); const second = await context.newPage(); await Promise.all([boot(page), boot(second)]);
  await Promise.all([page.locator('#procgenListen').click(), second.locator('#procgenListen').click()]);
  await expect.poll(async () => (await Promise.all([enabled(page), enabled(second)])).filter(Boolean).length).toBe(1);
  const firstWon = await enabled(page), owner = firstWon ? page : second, other = firstWon ? second : page;
  await expect(other.locator('#procgenListen')).toHaveText('Take over browser output'); await owner.close();
  await expect.poll(() => other.evaluate(async () => (await navigator.locks.query()).held.filter(lock => lock.name === 'lemmingsjs-midi:performance:v1:default').length)).toBe(0);
  expect(await enabled(other)).toBe(false); await other.locator('#procgenListen').click(); await expect.poll(() => enabled(other)).toBe(true);
  expect(await other.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().audio.performanceLease.exclusive)).toBe(true);
});

test('explicit browser takeover stops the previous transport and returns admission only after its native context suspends', { tag: '@boundary' }, async ({ page, context }, testInfo) => {
  test.setTimeout(120000); const second = await context.newPage(); await Promise.all([boot(page), boot(second)]);
  await page.locator('#procgenListen').click(); await expect.poll(() => enabled(page)).toBe(true);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.play()); await second.locator('#procgenListen').click();
  await expect(second.locator('#procgenListen')).toHaveText('Take over browser output'); await second.locator('#procgenListen').click();
  await expect.poll(() => enabled(second)).toBe(true); expect(await enabled(page)).toBe(false);
  const previous = await page.evaluate(() => ({ output: window.__PROCGEN_STUDIO__.getPlaybackState(), transport: window.__PROCGEN_STUDIO__.transport.getState() }));
  expect(previous.transport.playing).toBe(false); expect(previous.output.audio.contextState).toBe('suspended');
  expect(previous.output.audio.performanceLease.exclusive).toBe(false);
  await testInfo.attach('native-browser-takeover.json', { body: JSON.stringify({ previous, current: await second.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState()) }, null, 2), contentType: 'application/json' });
});

test('takeover finalizes the actual native master capture before the new desktop tab owns browser output', { tag: '@boundary' }, async ({ page, context }, testInfo) => {
  test.setTimeout(120000); const second = await context.newPage(); await Promise.all([boot(page), boot(second)]);
  await page.locator('#procgenListen').click(); await expect.poll(() => enabled(page)).toBe(true);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.openMasterCapture());
  const capture = page.getByRole('dialog', { name: 'Record browser master', exact: true });
  await capture.getByLabel('Maximum audio capture duration').selectOption('30'); await capture.getByRole('button', { name: 'Start master capture', exact: true }).click();
  await expect(capture.getByRole('status')).toContainText('recording');
  await second.locator('#procgenListen').click(); await expect(second.locator('#procgenListen')).toHaveText('Take over browser output'); await second.locator('#procgenListen').click();
  await expect.poll(() => enabled(second)).toBe(true); expect(await enabled(page)).toBe(false);
  await expect(capture.getByRole('status')).toHaveText(/^(ready|partial) ·/);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().audio.contextState)).toBe('suspended');
  await testInfo.attach('native-master-capture-handoff.txt', { body: await capture.innerText(), contentType: 'text/plain' });
});

for (const mode of ['missing', 'blocked']) test('explicit playback reports ' + mode + ' Web Locks as uncoordinated', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(mode => Object.defineProperty(navigator, 'locks', { configurable: true, value: mode === 'missing' ? undefined : {
    request: () => Promise.reject(new window.DOMException('Storage policy blocked coordination', 'SecurityError'))
  } }), mode);
  await boot(page); expect(await enabled(page)).toBe(false); await page.locator('#procgenListen').click(); await expect.poll(() => enabled(page)).toBe(true);
  const state = await page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState());
  expect(state.audio.performanceLease.coordination).toBe('uncoordinated'); expect(state.audio.performanceLease.exclusive).toBe(false);
  expect(state.message).toContain('Tab coordination is unavailable');
});
