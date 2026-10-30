import { expect, test } from './fixtures.js';
import { useWorkstationControl } from '../e2e/helpers/workstationChrome.js';

test('native denied MIDI permission is requested only explicitly and browser listening remains independently usable', async ({ page, context, baseURL, nativeBrowser }, testInfo) => {
  const cdp = await context.newCDPSession(page), { targetInfo } = await cdp.send('Target.getTargetInfo');
  await cdp.send('Browser.setPermission', { permission: { name: 'midi', sysex: false }, setting: 'denied', origin: new URL(baseURL).origin, browserContextId: targetInfo.browserContextId });
  await page.addInitScript(() => {
    const request = navigator.requestMIDIAccess.bind(navigator); window.nativeMidiPermission = { calls: 0, errors: [] };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value(options) {
      window.nativeMidiPermission.calls++;
      return request(options).catch(error => { window.nativeMidiPermission.errors.push({ name: error.name, message: String(error.message).slice(0, 512) }); throw error; });
    } });
  });
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  expect(await page.evaluate(() => window.nativeMidiPermission.calls)).toBe(0);
  expect(await page.evaluate(async () => (await navigator.permissions.query({ name: 'midi', sysex: false })).state)).toBe('denied');
  await useWorkstationControl(page, page.locator('#procgenOutput'), {}, 'selectOption', 'midi'); await page.locator('#procgenListen').click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().midiPermission)).toBe('denied');
  const denied = await page.evaluate(() => ({ output: window.__PROCGEN_STUDIO__.getPlaybackState(), permission: window.nativeMidiPermission }));
  expect(denied.output.enabled).toBe(false); expect(denied.output.failureKind).toBe('permission-denied'); expect(denied.permission.calls).toBe(1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => window.nativeMidiPermission.calls)).toBe(1);
  await useWorkstationControl(page, page.locator('#procgenOutput'), {}, 'selectOption', 'synth'); await page.locator('#procgenListen').click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().enabled)).toBe(true);
  const local = await page.evaluate(() => ({ output: window.__PROCGEN_STUDIO__.getPlaybackState(), playing: window.__PROCGEN_STUDIO__.transport.getState().playing, calls: window.nativeMidiPermission.calls }));
  expect(local.output.audio.contextState).toBe('running'); expect(local.playing).toBe(false); expect(local.calls).toBe(1);
  await page.locator('#procgenPanic').click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().audio.performanceLease.exclusive)).toBe(false);
  await testInfo.attach('native-midi-denial.json', { body: JSON.stringify({ browser: nativeBrowser.version(), decision: 'Native Chromium permission denied; no API result substituted.', denied, local,
    scope: 'Digital context activation and API denial; no physical MIDI device, acoustic or GPU qualification.' }, null, 2), contentType: 'application/json' });
});
