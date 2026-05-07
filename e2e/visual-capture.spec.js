import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import {
  DEFAULT_CAPTURE_ROOT,
  captureTargets,
  resolveCaptureTargets,
  runVisualProbes
} from './helpers/visualCapture.js';

const waitForHarnessReady = async (page) => {
  await page.waitForFunction(() => window.__E2E__?.getState?.()?.ready === true);
};

const isInside = (root, filePath) => {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await page.addInitScript(() => {
    try {
      window.localStorage?.clear?.();
    } catch (error) {}
  });
});

test('captures selector, page rect, runtime rect, and viewport targets under temp', async ({ page }) => {
  const outDir = path.join(DEFAULT_CAPTURE_ROOT, `smoke-${Date.now()}`);
  await fs.rm(outDir, { recursive: true, force: true });
  await page.goto('/?e2e=1');
  await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__?.pause?.());

  const result = await captureTargets(page, [
    { name: 'level-selects', type: 'selector', selector: '#levelSelects' },
    { name: 'top-left-page-rect', type: 'pageRect', rect: { x: 0, y: 0, width: 160, height: 120 } },
    { name: 'runtime-canvas', type: 'runtimeRect', id: 'canvas' },
    { name: 'viewport', type: 'viewport' }
  ], {
    outDir,
    route: '/'
  });

  expect(result.captures).toHaveLength(4);
  for (const capture of result.captures) {
    expect(isInside(DEFAULT_CAPTURE_ROOT, capture.path)).toBe(true);
    const stat = await fs.stat(capture.path);
    expect(stat.size).toBeGreaterThan(0);
  }
});

test('reports missing selectors with route and nearby page selectors', async ({ page }) => {
  await page.goto('/?e2e=1');
  await waitForHarnessReady(page);
  let message = '';
  try {
    await resolveCaptureTargets(page, [
      { name: 'missing-control', type: 'selector', selector: '#missingCaptureTarget' }
    ], { route: '/' });
  } catch (error) {
    message = error.message;
  }
  expect(message).toContain('#missingCaptureTarget');
  expect(message).toContain('Route: /');
  expect(message).toContain('Target: target=missing-control type=selector');
  expect(message).toContain('Nearby page ids/classes:');
});

test('returns overflow probe output for a known selector', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.id = 'captureOverflowProbe';
    probe.style.cssText = 'position:absolute;left:0;top:0;width:20px;height:10px;overflow:hidden;';
    probe.innerHTML = '<span style="display:inline-block;width:120px;">Overflow probe text</span>';
    document.body.appendChild(probe);
  });
  const result = await runVisualProbes(page, [
    {
      name: 'overflow-probe',
      selector: '#captureOverflowProbe',
      required: true,
      checks: ['horizontalOverflow', 'clippedText']
    }
  ]);
  expect(result.failures.some(issue => issue.code === 'horizontalOverflow')).toBe(true);
});
