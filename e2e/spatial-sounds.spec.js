import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { waitForHarnessReady } from './helpers/harness.js';
import { MidiUiPage } from './helpers/pageObjects.js';

test('pan mode persists, live local audio is 48 kHz and studio restores focus', async ({ page }) => {
  await installExternalAssetStubs(page);
  await page.addInitScript(() => {
    const NativeContext = window.AudioContext;
    window.__audioContexts = [];
    window.AudioContext = class extends NativeContext {
      constructor(options) { super(options); window.__audioContexts.push(this); }
    };
  });
  await page.goto('/?e2e=1&midi=1');
  await waitForHarnessReady(page);
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
  await page.locator('#midiGlobalPanMode').selectOption('level');
  await expect.poll(() => page.evaluate(() => window.__E2E__.midiGetRuntimeConfig().position.panMode)).toBe('level');
  await page.reload();
  await waitForHarnessReady(page);
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
  await expect(page.locator('#midiGlobalPanMode')).toHaveValue('level');
  await page.locator('#midiViewSounds').click();
  await page.locator('#midiLocalListenButton').click();
  await expect(page.locator('#midiOutputSummary')).toContainText('Listening to game locally');
  expect(await page.evaluate(() => window.__audioContexts.map(context => context.sampleRate))).toEqual([48000]);
  await page.locator('#midiWorkspaceClose').click();
  await expect(page.locator('#midiWorkspaceToggle')).toBeFocused();
});

test('Learn and Record cancellation leave mappings and clips unchanged', async ({ page }) => {
  await installExternalAssetStubs(page);
  await installWebMidiStub(page);
  const midi = new MidiUiPage(page);
  await midi.goto('/?e2e=1');
  await waitForHarnessReady(page);
  await midi.enable();
  const before = await page.evaluate(() => window.__E2E__.midiGetProject().sources);
  await page.locator('#midiLearnButton').click();
  await page.evaluate(() => window.__WEBMIDI_STUB__.sendNoteOn(86, 100, 1));
  await expect(page.locator('#midiLearnStatus')).toContainText('Pending');
  await page.locator('#midiViewExpert').click();
  await page.locator('#midiLearnCancelButton').click();
  expect(await page.evaluate(() => window.__E2E__.midiGetProject().sources)).toEqual(before);
  await page.locator('#midiClipAddButton').click();
  const clips = await page.evaluate(() => window.__E2E__.midiGetProject().clips);
  await page.locator('#midiRecordButton').click();
  await page.evaluate(() => window.__WEBMIDI_STUB__.sendNoteOn(65, 88, 1));
  await page.locator('#midiViewExpert').click();
  await page.locator('#midiRecordCancelButton').click();
  expect(await page.evaluate(() => window.__E2E__.midiGetProject().clips)).toEqual(clips);
});

test('mobile MIDI stays hidden except for a single exact opt-in', { tag: '@boundary' }, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile' });
  try {
    const page = await context.newPage();
    await installExternalAssetStubs(page);
    for (const query of ['', '&midi=0', '&midi=1&midi=1', '&midi=true']) {
      await page.goto(`/?e2e=1${query}`);
      await waitForHarnessReady(page);
      await expect(page.locator('#midiWorkspaceToggle')).toBeHidden();
    }
    await page.goto('/?e2e=1&midi=1');
    await waitForHarnessReady(page);
    await expect(page.locator('#midiWorkspaceToggle')).toBeVisible();
    if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
    await expect(page.locator('#midiSoundsView')).toBeVisible();
    const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  } finally {
    await context.close();
  }
});
