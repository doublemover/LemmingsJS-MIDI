import { expect, test } from '@playwright/test';
import { waitForHarnessReady } from './helpers/harness.js';

const getRightmostX = (state) => {
  const lems = Array.isArray(state?.game?.lemmings) ? state.game.lemmings : [];
  let max = null;
  for (const lem of lems) {
    if (!lem || lem.removed || lem.disabled) continue;
    if (max == null || lem.x > max) max = lem.x;
  }
  return max;
};

test('procgen loads and spawns endlessly', async ({ page }) => {
  await page.goto('/procgen.html?e2e=1');
  await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__.pause());

  const initial = await page.evaluate(() => window.__E2E__.getState());
  const initialCount = initial.game.lemmings.length;
  const initialRightmost = getRightmostX(initial) ?? 0;
  const initialViewX = initial.stage.viewRect.x;

  await page.evaluate(() => window.__E2E__.step(240));
  const after = await page.evaluate(() => window.__E2E__.getState());
  const afterCount = after.game.lemmings.length;
  const afterRightmost = getRightmostX(after) ?? 0;

  expect(afterCount).toBeGreaterThan(initialCount);
  expect(afterRightmost).toBeGreaterThanOrEqual(initialRightmost);
  expect(after.stage.viewRect.x).toBeGreaterThanOrEqual(initialViewX);
});

test('procgen exposes debug state and records no-op assist decisions', async ({ page }) => {
  await page.goto('/procgen.html?e2e=1&seed=debug-state&aiDebug=1');
  await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__.pause());
  await page.evaluate(() => window.__E2E__.step(180));

  const state = await page.evaluate(() => window.__E2E__.getState());
  const procgen = state.procgen;

  expect(procgen.selectedTheme).toEqual(expect.any(String));
  expect(procgen.seed).not.toBeNull();
  expect(procgen.generatedEndX).toBeGreaterThan(0);
  expect(procgen.frontier).toEqual(expect.objectContaining({
    viableCount: expect.any(Number),
    rightMovingCount: expect.any(Number)
  }));
  expect(procgen.recentChunks.length).toBeGreaterThan(0);
  expect(procgen.recentPieces.length).toBeGreaterThan(0);
  expect(procgen.recentPieces.every(piece => piece.theme === procgen.selectedTheme)).toBe(true);
  expect(procgen.trackingSizes.recentChunks).toBeLessThanOrEqual(64);
  expect(procgen.trackingSizes.recentPieces).toBeLessThanOrEqual(128);
  expect(procgen.trackingSizes.recentAssists).toBeLessThanOrEqual(32);

  await expect.poll(async () => {
    await page.evaluate(() => window.__E2E__.step(30));
    return page.evaluate(() => {
      const assists = window.__E2E__?.getState?.()?.procgen?.recentAssists || [];
      return assists.some(assist => (
        assist.type === 'noop' &&
        (assist.reason === 'traversable' || assist.reason === 'safe-drop')
      ));
    });
  }).toBe(true);
});

test('procgen exposes solver-verified gap certificates for fixed seeds', async ({ page }) => {
  await page.goto('/procgen.html?e2e=1&seed=certificate-e2e&aiDebug=1&gapChance=1&gapMinWidth=5&gapMaxWidth=5&recentCertificateLimit=8');
  await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__.pause());

  await expect.poll(async () => {
    await page.evaluate(() => window.__E2E__.step(120));
    return page.evaluate(() => {
      const certificates = window.__E2E__?.getState?.()?.procgen?.recentCertificates || [];
      return certificates.some(entry => (
        entry.challengeType === 'bridge-gap' &&
        entry.decision === 'accept' &&
        entry.resultType === 'solved'
      ));
    });
  }, { timeout: 10000 }).toBe(true);

  const procgen = await page.evaluate(() => window.__E2E__.getState().procgen);
  const accepted = procgen.recentCertificates.find(entry => (
    entry.challengeType === 'bridge-gap' &&
    entry.decision === 'accept' &&
    entry.resultType === 'solved'
  ));

  expect(accepted).toEqual(expect.objectContaining({
    expectedSkill: 'builder',
    width: 5
  }));
  expect(procgen.recentChunks.some(entry => (
    entry.type === 'gap' &&
    entry.certificateDecision === 'accept' &&
    entry.certificateResultType === 'solved'
  ))).toBe(true);
  expect(procgen.trackingSizes.recentCertificates).toBeLessThanOrEqual(8);
});
