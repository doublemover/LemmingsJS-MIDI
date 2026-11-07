import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('desktop startup accepts a real asset response with valid empty transport chunks', { tag: ['@boundary', '@workstation-boot'] }, async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const original = window.fetch; window.__emptyAssetStreams = [];
    window.fetch = async (input, options) => {
      const response = await original(input, options), url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (!/\/lemmings\/VGAGR4\.DAT(?:\?|$)/i.test(new URL(url, location.href).pathname) || !response.ok || !response.body) return response;
      const reader = response.body.getReader(), receipt = { url: response.url, bytes: 0, emptyChunks: 1, complete: false }; window.__emptyAssetStreams.push(receipt);
      return new globalThis.Response(new globalThis.ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(0)); }, async pull(controller) {
        const result = await reader.read(); if (result.done) { controller.enqueue(new Uint8Array(0)); receipt.emptyChunks++; receipt.complete = true; controller.close(); reader.releaseLock(); return; }
        receipt.bytes += result.value.byteLength; controller.enqueue(result.value);
      }, cancel(reason) { return reader.cancel(reason); } }), { status: response.status, statusText: response.statusText, headers: response.headers });
    };
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=8');
  await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  const result = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, live = window.__PROCGEN_LANES__; studio.transport.pause(); live.pause();
    return { streams: window.__emptyAssetStreams, worldReady: !!live.world.terrain, actors: live.world.actors.length, display: live.renderer.getDisplayState().state, viewport: { width: window.innerWidth, height: window.innerHeight }, scope: 'Actual immutable app and network asset with an explicitly injected native default-stream boundary; no claim about CI failure chunk framing.' };
  });
  await testInfo.attach('actual-native-empty-chunk-startup', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.worldReady).toBe(true); expect(result.display).toBe('ready'); expect(result.viewport).toEqual({ width: 1920, height: 1080 });
  expect(result.streams).toHaveLength(1); expect(result.streams[0]).toMatchObject({ bytes: 28692, emptyChunks: 2, complete: true });
});
