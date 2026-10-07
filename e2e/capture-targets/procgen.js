const config = {
  name: 'procgen',
  route: '/procgen.html?e2e=1&seed=visual-capture&lanes=8',
  async setup(page) {
    await page.waitForFunction(() => window.__PROCGEN_LANES__?.getState?.().terrainRecipe);
    await page.evaluate(() => { window.__PROCGEN_LANES__.pause(); window.__PROCGEN_LANES__.step(360); });
  },
  states: [
    { name: 'shared-world', targets: [{ name: 'procgen-viewport', type: 'viewport' }, { name: 'procgen-canvas', type: 'selector', selector: '#gameCanvas' }] },
    { name: 'drawer', async setup(page) { await page.locator('#procgenTab').click(); }, targets: [{ name: 'procgen-controls', type: 'selector', selector: '#procgenDrawer' }] },
    { name: 'lower-lanes', async setup(page) {
      await page.keyboard.press('Escape');
      await page.evaluate(() => { const api = window.__PROCGEN_LANES__; api.renderer.cameraY = 500; api.renderer.render(); });
    }, targets: [{ name: 'lower-lanes-canvas', type: 'selector', selector: '#gameCanvas' }] }
  ],
  probes: [{ name: 'procgen-canvas', selector: '#gameCanvas', checks: ['horizontalOverflow', 'verticalOverflow', 'unexpectedScrollbar'] }]
};
export default config;
