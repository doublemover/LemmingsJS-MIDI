export async function pauseWorkstationWhenReady(page, options = {}) {
  const { retryLoading = false, ...waitOptions } = options;
  const wait = async () => {
    const handle = await page.waitForFunction(() => {
      const installation = document.getElementById('generation-status')?.textContent || '';
      if (installation.startsWith('Application installation failed:')) throw new Error(installation.slice(0, 1024));
      const studio = window.__PROCGEN_STUDIO__, lanes = window.__PROCGEN_LANES__;
      if (studio && lanes?.world?.workstationEnabled && lanes.world.terrain) {
        studio.transport.pause(); lanes.pause(); return { ready: true };
      }
      if (document.getElementById('procgenModuleStartupRetry')) return { ready: false, url: location.href,
        message: document.getElementById('procgenModuleStartupMessage')?.textContent?.slice(0, 1024) || 'Application loading interrupted.' };
      return false;
    }, null, waitOptions);
    try { return await handle.jsonValue(); } finally { await handle.dispose(); }
  };
  const initial = await wait();
  if (initial.ready) return { retried: false };
  if (!retryLoading) throw new Error(initial.message);
  await Promise.all([page.waitForEvent('domcontentloaded'), page.getByRole('button', { name: 'Retry loading', exact: true }).click()]);
  if (page.url() !== initial.url) throw new Error('Startup retry changed the pinned probe entry.');
  const retried = await wait();
  if (!retried.ready) throw new Error('Explicit startup retry failed: ' + retried.message);
  return { retried: true, entryUrl: initial.url, reason: initial.message, scope: 'explicit-same-entry-retry-before-native-measurement' };
}
