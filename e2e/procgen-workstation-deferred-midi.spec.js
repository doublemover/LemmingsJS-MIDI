import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
const ready = async page => {
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.deferredMidiWorld = window.__PROCGEN_LANES__.world; });
};
const installAccessFixture = page => page.addInitScript(() => {
  window.explicitMidiRequests = 0;
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async options => {
    if (options.sysex) throw new Error('Unexpected SysEx request'); window.explicitMidiRequests++;
    return { inputs: new Map(), outputs: new Map(), sysexEnabled: false, onstatechange: null };
  } });
});
test('fresh desktop startup omits MIDI scripting and retries a failed explicit library load', { tag: '@boundary' }, async ({ page }) => {
  let scripts = 0; await installAccessFixture(page);
  await page.route('**/js/vendor/webmidi.js', route => { scripts++; return route.abort('failed'); });
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=2'); await ready(page);
  expect(scripts).toBe(0); expect(await page.evaluate(() => !!window.WebMidi)).toBe(false);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.connect())).toBe(false); expect(scripts).toBe(1);
  expect(await page.evaluate(() => window.explicitMidiRequests)).toBe(0);
  await expect(page.locator('.studio-status')).toContainText('could not load');
  await page.unroute('**/js/vendor/webmidi.js');
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.connect())).toBe(true);
  expect(await page.evaluate(() => ({ requests: window.explicitMidiRequests, enabled: window.WebMidi.enabled,
    sameWorld: window.deferredMidiWorld === window.__PROCGEN_LANES__.world, output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled })))
    .toEqual({ requests: 1, enabled: true, sameWorld: true, output: false });
});
test('installed desktop MIDI loading respects Panic and remains available after offline reload', { tag: '@boundary' }, async ({ page, context }) => {
  test.setTimeout(90000); await installAccessFixture(page);
  await page.goto('/dist/browser/procgen.html?e2e=1&seed=42&lanes=2'); await ready(page);
  expect(await page.evaluate(() => !!window.WebMidi)).toBe(false);
  await page.evaluate(() => {
    const append = document.head.append.bind(document.head);
    document.head.append = script => {
      if (script.tagName === 'SCRIPT' && script.src.endsWith('/js/vendor/webmidi.js')) {
        document.head.append = append; window.releaseMidiLoad = () => append(script);
      } else append(script);
    };
    window.pendingMidi = window.__PROCGEN_STUDIO__.handlers.connect();
  });
  await page.waitForFunction(() => typeof window.releaseMidiLoad === 'function');
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.handlers.panicOutput(); window.releaseMidiLoad(); });
  expect(await page.evaluate(() => window.pendingMidi)).toBe(false); expect(await page.evaluate(() => window.explicitMidiRequests)).toBe(0);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.connect())).toBe(true);
  await context.setOffline(true); await page.reload(); await ready(page);
  expect(await page.evaluate(() => !!window.WebMidi)).toBe(false);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.connect())).toBe(true);
  expect(await page.evaluate(() => ({ requests: window.explicitMidiRequests, enabled: window.WebMidi.enabled,
    sameWorld: window.deferredMidiWorld === window.__PROCGEN_LANES__.world, output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled })))
    .toEqual({ requests: 1, enabled: true, sameWorld: true, output: false });
});
