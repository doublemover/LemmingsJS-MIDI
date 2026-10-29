import { expect, test } from './fixtures.js';
import { useWorkstationControl } from '../e2e/helpers/workstationChrome.js';

const playback = page => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState());
const boot = async (page, search = '&recipe=1&seed=42&lanes=8') => {
  await page.goto('/procgen.html?e2e=1' + search);
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
};
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.engineHistory = { marker: crypto.randomUUID?.() || Date.now() + ':' + Math.random(), hides: [], shows: [] };
    window.addEventListener('pagehide', event => window.engineHistory.hides.push(event.persisted));
    window.addEventListener('pageshow', event => window.engineHistory.shows.push(event.persisted));
  });
  page.on('pageerror', error => { void test.info().attach('native-page-error.txt', { body: String(error.stack || error), contentType: 'text/plain' }); });
});
test.afterEach(async ({ page, nativeBrowser: browser }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) await evidence(page, browser, testInfo, 'portable-failure-state.json').catch(() => {});
});
const historyReturn = async page => { await page.goto('about:blank'); await page.goBack({ waitUntil: 'commit' }); await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled); };
const evidence = async (page, browser, testInfo, name, extra = {}) => {
  const source = await page.evaluate(() => ({ history: window.engineHistory, output: window.__PROCGEN_STUDIO__.getPlaybackState(),
    transport: window.__PROCGEN_STUDIO__.transport.getState(), document: window.__PROCGEN_STUDIO__.getDocumentState(),
    preferences: window.__PROCGEN_STUDIO__.getPreferenceState(), recovery: window.__PROCGEN_STUDIO__.getRecoveryState(),
    project: { mode: window.__PROCGEN_STUDIO__.getStartupPlan().mode, seed: window.__PROCGEN_LANES__.world.seed, laneName: window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].name },
    capabilities: { audioContext: typeof (window.AudioContext || window.webkitAudioContext) === 'function' },
    navigation: { type: performance.getEntriesByType('navigation')[0]?.type, reasons: performance.getEntriesByType('navigation')[0]?.notRestoredReasons?.toJSON?.() || null } }));
  await testInfo.attach(name, { body: JSON.stringify({ project: testInfo.project.name, browser: browser.version(), configuredAudioBackend: testInfo.config.metadata.audioBackend,
    configuredRenderer: testInfo.project.use.launchOptions?.firefoxUserPrefs ? 'software-webrender-requested' : 'browser-default-unqualified', source, ...extra }, null, 2), contentType: 'application/json' });
  return source;
};

test('cold history reconstructs saved editor preferences without autoplay', async ({ page, nativeBrowser: browser }, testInfo) => {
  // Playwright disables Firefox/WebKit BFCache; Chromium's separate native fixture tests actual retained worlds.
  await boot(page, '');
  const before = await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__; studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { name: 'Portable cached source' } });
    return { marker: window.engineHistory.marker, revision: studio.getDocumentState().editRevision }; });
  await page.waitForFunction(() => { const studio = window.__PROCGEN_STUDIO__, saved = studio.getPreferenceState(); return !saved.active && saved.durableRevision === studio.getDocumentState().editRevision; });
  await historyReturn(page);
  const after = await evidence(page, browser, testInfo, 'portable-editor-cold-history.json', { before, scope: 'Cold history reconstruction; no retained world or physical tick recovery claimed.' });
  expect(after.history.marker).not.toBe(before.marker); expect(after.navigation.type).toBe('back_forward'); expect(after.history.shows).not.toContain(true);
  expect(after.project.mode).toBe('previous-setup'); expect(after.project.laneName).toBe('Portable cached source');
  expect(after.output.enabled).toBe(false); expect(after.transport.playing).toBe(false);
});

test('native project transactions retain the exact named revision across reload and explicit stored load', async ({ page, nativeBrowser: browser }, testInfo) => {
  await boot(page);
  await useWorkstationControl(page, page.locator('#procgenStudioFooter').getByRole('button', { name: 'Save', exact: true }), { button: 'Save' }, 'click');
  const naming = page.getByRole('dialog', { name: 'Project name', exact: true });
  await naming.getByRole('textbox').fill('Portable named document'); await naming.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__.getDocumentState().revision === 1);
  const before = await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__, document = studio.getDocumentState(); studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { name: 'Portable revision two' } }); return document; });
  await useWorkstationControl(page, page.locator('#procgenStudioFooter').getByRole('button', { name: 'Save', exact: true }), { button: 'Save' }, 'click');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__.getDocumentState().revision === 2);
  await page.reload(); await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  await useWorkstationControl(page, page.locator('#procgenStudioFooter').getByRole('button', { name: 'Load', exact: true }), { button: 'Load' }, 'click');
  await page.getByRole('dialog', { name: 'Saved projects' }).getByRole('button', { name: /Portable named document/ }).click();
  await page.waitForFunction(id => { const document = window.__PROCGEN_STUDIO__.getDocumentState(); return document.id === id && document.revision === 2; }, before.id);
  await expect(page.locator('.studio-status')).toContainText('Project loaded paused');
  const after = await evidence(page, browser, testInfo, 'portable-native-document.json', { before });
  expect(after.document.id).toBe(before.id); expect(after.document.revision).toBe(2);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].name)).toBe('Portable revision two');
  expect(after.output.enabled).toBe(false); expect(after.transport.playing).toBe(false);
});

test('native audio navigation requires fresh activation and absent audio remains unavailable', async ({ page, nativeBrowser: browser }, testInfo) => {
  await boot(page);
  const supported = await page.evaluate(() => typeof (window.AudioContext || window.webkitAudioContext) === 'function');
  await page.locator('#procgenListen').click();
  if (!supported) {
    await expect.poll(async () => (await playback(page)).status).toBe('error');
    const unavailable = await evidence(page, browser, testInfo, 'portable-native-audio-unavailable.json', { qualification: 'Native AudioContext absent in this browser port; no native audio activation claimed.' });
    expect(unavailable.output.enabled).toBe(false); expect(unavailable.output.audio.performanceLease.exclusive).toBe(false); return;
  }
  await expect.poll(async () => (await playback(page)).enabled).toBe(true);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.play()); await historyReturn(page);
  const after = await evidence(page, browser, testInfo, 'portable-native-audio-navigation.json');
  expect(after.output.enabled).toBe(false); expect(after.transport.playing).toBe(false);
  expect(after.output.audio.performanceLease.exclusive).toBe(false);
  await page.locator('#procgenListen').click(); await expect.poll(async () => (await playback(page)).enabled).toBe(true);
});

test('cold history never invents durable recovery when native storage is unavailable', async ({ page, nativeBrowser: browser }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open() { throw new window.DOMException('Controlled unavailable storage', 'SecurityError'); } } }));
  await boot(page);
  const before = await page.evaluate(async () => { const studio = window.__PROCGEN_STUDIO__; studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { name: 'Portable unsaved source' } });
    await studio.recover(); return { marker: window.engineHistory.marker, revision: studio.getDocumentState().editRevision }; });
  await historyReturn(page); await page.evaluate(() => window.__PROCGEN_STUDIO__.recover());
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__.getRecoveryState().state === 'unavailable');
  const after = await evidence(page, browser, testInfo, 'portable-unavailable-storage.json', { before, durability: 'Unavailable storage and a destroyed realm cannot retain unsaved source. No durable recovery claimed.' });
  expect(after.history.marker).not.toBe(before.marker); expect(after.navigation.type).toBe('back_forward'); expect(after.history.shows).not.toContain(true);
  expect(after.recovery.state).toBe('unavailable'); expect(after.recovery.durableRevision).toBe(-1);
  expect(after.output.enabled).toBe(false); expect(after.transport.playing).toBe(false);
});
