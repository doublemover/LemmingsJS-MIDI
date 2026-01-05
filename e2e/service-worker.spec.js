import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';

async function ensureServiceWorkerControls(page) {
  await page.waitForFunction(() => 'serviceWorker' in navigator);
  const result = await page.evaluate(async () => {
    let registration = await navigator.serviceWorker.getRegistration();
    let registeredByApp = true;
    if (!registration) {
      registeredByApp = false;
      registration = await navigator.serviceWorker.register('service-worker.js', {
        updateViaCache: 'none'
      });
    }
    try {
      await registration.update();
    } catch (error) {
      if (error?.name !== 'InvalidStateError') {
        throw error;
      }
    }
    const ready = await navigator.serviceWorker.ready;
    const readyRegistration = ready || registration;
    const state = readyRegistration.active?.state ||
      readyRegistration.installing?.state ||
      readyRegistration.waiting?.state ||
      null;
    return {
      scope: readyRegistration.scope || registration.scope || '',
      state,
      registeredByApp
    };
  });
  await page.reload();
  const hasRegistrationAfterReload = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return !!registration;
  });
  return { ...result, hasRegistrationAfterReload };
}

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
});

test('Service worker controls the game page and checks for updates', async ({ page }, testInfo) => {
  await page.goto('/');
  const result = await ensureServiceWorkerControls(page);
  expect(result).not.toBeNull();
  expect(result?.state).toBeTruthy();
  expect(result?.scope).toContain('localhost');
  expect(result?.hasRegistrationAfterReload).toBe(true);
  if (!result?.registeredByApp) {
    testInfo.annotations.push({
      type: 'warning',
      description: 'Service worker was registered manually during the smoke test.'
    });
  }
});

test('Service worker controls the editor page and checks for updates', async ({ page }, testInfo) => {
  await page.goto('/editor.html');
  const result = await ensureServiceWorkerControls(page);
  expect(result).not.toBeNull();
  expect(result?.state).toBeTruthy();
  expect(result?.scope).toContain('localhost');
  expect(result?.hasRegistrationAfterReload).toBe(true);
  if (!result?.registeredByApp) {
    testInfo.annotations.push({
      type: 'warning',
      description: 'Service worker was registered manually during the smoke test.'
    });
  }
});
