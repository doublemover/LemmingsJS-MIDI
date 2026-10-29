import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.use({ permissions: [] });
let build;
test.beforeAll(async () => { build = await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('installed ProcGen generation completes module imports online and after offline reload @boundary', async ({ page, context }, testInfo) => {
  test.setTimeout(90000);
  const failures = [];
  page.on('pageerror', error => failures.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', request => failures.push({ kind: 'requestfailed', url: request.url(), reason: request.failure()?.errorText }));
  await page.addInitScript(() => {
    window.__generationStartupEvents = [];
    for (const type of ['DOMContentLoaded', 'load', 'pageshow', 'pagehide', 'visibilitychange', 'error', 'unhandledrejection']) window.addEventListener(type, event => window.__generationStartupEvents.push({ type, at: performance.now(), state: document.readyState, visibility: document.visibilityState, message: event.message ?? event.reason?.message ?? null }), true);
    document.addEventListener('load', event => { if (event.target?.tagName === 'SCRIPT') window.__generationStartupEvents.push({ type: 'script-loaded', src: event.target.src, at: performance.now() }); }, true);
  });
  await page.bringToFront();
  await page.goto('/dist/browser/procgen.html?e2e=1&seed=42&lanes=2');
  const observe = async () => {
    try { await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 30000, polling: 50 }); }
    catch (error) {
      const state = await page.evaluate(async () => ({ url: location.href, readyState: document.readyState, visibility: document.visibilityState, focused: document.hasFocus(),
        status: document.getElementById('procgenRunStatus')?.textContent ?? document.getElementById('generation-status')?.textContent,
        startupError: document.getElementById('procgenStartupError')?.textContent ?? null, studio: !!window.__PROCGEN_STUDIO__, world: !!window.__PROCGEN_LANES__?.world,
        events: window.__generationStartupEvents, worker: navigator.serviceWorker.controller?.scriptURL ?? null,
        registrations: await navigator.serviceWorker.getRegistrations().then(values => values.map(value => ({ scope: value.scope, active: value.active?.state, waiting: value.waiting?.state, installing: value.installing?.state }))),
        resources: performance.getEntriesByType('resource').slice(-24).map(value => ({ name: value.name, duration: value.duration, type: value.initiatorType })) })).catch(failure => ({ diagnosticsError: failure.message }));
      await testInfo.attach('installed-generation-startup-failure.json', { contentType: 'application/json', body: JSON.stringify({ buildId: build.buildId, failures, state }) });
      throw error;
    }
    return page.evaluate(async () => {
      window.__PROCGEN_STUDIO__.transport.pause();
      const { getActiveExecutionIdentity } = await import(new URL('js/runtime/ActiveExecutionIdentity.js', window.location.href).href);
      return { identity: getActiveExecutionIdentity(), lanes: window.__PROCGEN_STUDIO__.getProject().procgen.lanes.length,
        paused: window.__PROCGEN_STUDIO__.transport.getState().playing === false };
    });
  };
  const online = await observe(); expect(online.identity).toMatchObject({ activeExecution: 'bound', buildId: build.buildId });
  expect(online.lanes).toBe(2); expect(online.paused).toBe(true);
  await context.setOffline(true); await page.reload(); await page.bringToFront();
  const offline = await observe(); expect(offline.identity).toMatchObject({ activeExecution: 'bound', buildId: build.buildId });
  expect(offline.lanes).toBe(2); expect(offline.paused).toBe(true);
  await expect(page.locator('#procgenStudio')).toBeVisible();
});
