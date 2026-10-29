import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('native archive preparation can be superseded, canceled and discarded without replacing the current file', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/dist/browser/procgen.html?e2e=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    await studio.handlers.startCausalTake({ takeName: 'Export ownership fixture' }); window.__PROCGEN_LANES__.step(2); await studio.stopCausalTake();
    const send = window.Worker.prototype.postMessage;
    window.Worker.prototype.postMessage = function(message, ...args) {
      if (window.holdNextArchive && message.type === 'input-start' && message.kind === 'verify-stored-causal-sources') {
        window.holdNextArchive = false; window.archiveWorkerHeld = true; return;
      }
      return send.call(this, message, ...args);
    };
    window.exportWorld = window.__PROCGEN_LANES__.world; window.exportTick = window.exportWorld.tickIndex;
  });
  const hold = async () => {
    await page.evaluate(() => {
      window.archiveWorkerHeld = false; window.holdNextArchive = true;
      window.pendingArchive = window.__PROCGEN_STUDIO__.handlers.prepareCausalArchive();
    });
    await page.waitForFunction(() => window.archiveWorkerHeld === true);
    await expect(page.getByRole('button', { name: 'Cancel preparation', exact: true })).toBeEnabled();
  };
  for (const replacement of ['project', 'archive']) {
    await hold();
    const current = await page.evaluate(async kind => {
      const studio = window.__PROCGEN_STUDIO__;
      const newer = kind === 'project' ? await studio.handlers.export() : await studio.handlers.prepareCausalArchive();
      return { newer, earlier: await window.pendingArchive, final: studio.getExportState() };
    }, replacement);
    expect(current.earlier).toMatchObject({ status: 'superseded' });
    expect(current.newer.retained).toBe(true); expect(current.final.artifact.artifactId).toBe(current.newer.artifactId);
    expect(current.final.preparation).toBeNull();
  }
  await hold(); const retained = await page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().artifact.artifactId);
  await page.getByRole('button', { name: 'Cancel preparation', exact: true }).click();
  expect(await page.evaluate(() => window.pendingArchive)).toMatchObject({ status: 'superseded' });
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().artifact.artifactId)).toBe(retained);
  await hold(); await page.getByRole('button', { name: 'Discard file', exact: true }).click();
  expect(await page.evaluate(() => window.pendingArchive)).toMatchObject({ status: 'superseded' });
  expect(await page.evaluate(() => ({ artifact: window.__PROCGEN_STUDIO__.getExportState().artifact,
    sameWorld: window.exportWorld === window.__PROCGEN_LANES__.world, sameTick: window.exportTick === window.exportWorld.tickIndex,
    output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled }))).toEqual({ artifact: null, sameWorld: true, sameTick: true, output: false });
});
