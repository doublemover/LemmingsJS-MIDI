import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.use({ permissions: [] });
let build;
test.beforeAll(async () => { build = await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('installed ProcGen generation completes module imports online and after offline reload @boundary', async ({ page, context }) => {
  test.setTimeout(90000);
  await page.goto('/dist/browser/procgen.html?e2e=1&seed=42&lanes=2');
  const observe = async () => {
    await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 30000 });
    return page.evaluate(async () => {
      window.__PROCGEN_STUDIO__.transport.pause();
      const { getActiveExecutionIdentity } = await import(new URL('js/runtime/ActiveExecutionIdentity.js', window.location.href).href);
      return { identity: getActiveExecutionIdentity(), lanes: window.__PROCGEN_STUDIO__.getProject().procgen.lanes.length,
        paused: window.__PROCGEN_STUDIO__.transport.getState().playing === false };
    });
  };
  const online = await observe(); expect(online.identity).toMatchObject({ activeExecution: 'bound', buildId: build.buildId });
  expect(online.lanes).toBe(2); expect(online.paused).toBe(true);
  await context.setOffline(true); await page.reload();
  const offline = await observe(); expect(offline.identity).toMatchObject({ activeExecution: 'bound', buildId: build.buildId });
  expect(offline.lanes).toBe(2); expect(offline.paused).toBe(true);
  await expect(page.locator('#procgenStudio')).toBeVisible();
});
