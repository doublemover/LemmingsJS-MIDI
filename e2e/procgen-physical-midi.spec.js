import { expect, test } from '@playwright/test';
import { installWebMidiStub } from './helpers/webmidiStub.js';

test.use({ permissions: [] });
test('default physical scene sends causal MIDI without pattern cells or a browser audio clock and stops owned gates @boundary', async ({ page }) => {
  test.setTimeout(60000); await installWebMidiStub(page);
  await page.addInitScript(() => {
    const request = navigator.requestMIDIAccess; window.__physicalMidiRequests = 0; window.__physicalMidiBytes = [];
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async options => {
      window.__physicalMidiRequests++; const access = await request(options);
      for (const output of access.outputs.values()) output.send = bytes => window.__physicalMidiBytes.push([...bytes]);
      return access;
    } });
  });
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.transport.pause());
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes.every(lane => lane.mode === 'physical' && lane.patterns.length === 0))).toBe(true);
  expect(await page.evaluate(() => window.__physicalMidiRequests)).toBe(0);
  await page.locator('#procgenOutput').selectOption('midi'); await page.locator('#procgenListen').click();
  await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__physicalMidiBytes.length)).toBe(0);
  await page.locator('#procgenMidiDevice').selectOption('pw-output-1'); await page.locator('#procgenListen').click();
  await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.ports.configure({ recording: true }); window.__PROCGEN_STUDIO__.play(); });
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.ports.getRecording().filter(row => row.intentId && (row.data[0] & 0xf0) === 0x90 && row.data[2] > 0).length), { timeout: 15000 }).toBeGreaterThan(0);
  const active = await page.evaluate(() => ({ diagnostics: window.__PROCGEN_STUDIO__.getPhysicalOutputDiagnostics(),
    notes: window.__PROCGEN_STUDIO__.ports.getRecording().filter(row => row.intentId && (row.data[0] & 0xf0) === 0x90),
    requests: window.__physicalMidiRequests, bytes: window.__physicalMidiBytes.length }));
  expect(active.diagnostics.audioEnabled).toBe(false); expect(active.diagnostics.externalOutputs[0].enabled).toBe(true);
  expect(active.requests).toBe(1); expect(active.bytes).toBeGreaterThan(0); expect(active.notes.every(row => row.voiceId && row.onsetId)).toBe(true);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.transport.pause()); await page.locator('#procgenPanic').click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().activeNotes)).toBe(0);
  await page.evaluate(() => window.__WEBMIDI_STUB__.disconnectOutput());
  await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false');
});
