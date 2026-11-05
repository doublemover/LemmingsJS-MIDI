export async function pauseWorkstationWhenReady(page, options = {}) {
  await page.waitForFunction(() => {
    const installation = document.getElementById('generation-status')?.textContent || '';
    if (installation.startsWith('Application installation failed:')) throw new Error(installation.slice(0, 1024));
    const studio = window.__PROCGEN_STUDIO__, lanes = window.__PROCGEN_LANES__;
    if (!studio || !lanes?.world?.workstationEnabled || !lanes.world.terrain) return false;
    studio.transport.pause(); lanes.pause(); return true;
  }, null, options);
}
