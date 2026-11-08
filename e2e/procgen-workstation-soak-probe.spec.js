import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { run, createProcgenSoakConfig } from '../scripts/bench-procgen-soak.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('ProcGen soak measures completed workstation work with the bound executing generation', { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(150000);
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  const config = createProcgenSoakConfig({ argv: ['--duration=2000', '--warmup=200', '--sample=100', '--opTimeout=90000', '--maxRuntime=120000', '--name=rook'], env: { LEMMINGS_PROCGEN_URL: page.url() } });
  const result = await run(config, { log() {} });
  expect(result.environment.executionIdentity.activeExecution).toBe('bound'); expect(result.environment.viewport).toEqual({ width: 1920, height: 1080 });
  expect(result.measurement.completedTicks).toBeGreaterThan(0); expect(result.measurement.observedStepCalls).toBe(result.measurement.worldTickDelta);
  expect(result.measurement.rafIntervalMs.samples).toBeGreaterThan(0); expect(result.sampleCount).toBeLessThanOrEqual(result.maximumSamples);
  await testInfo.attach('completed-work-soak-receipt', { body: JSON.stringify(result), contentType: 'application/json' });
});
