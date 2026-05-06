const config = {
  name: 'procgen',
  route: '/procgen.html?seed=visual-capture',
  async setup(page) {
    await page.waitForFunction(() => window.__E2E__?.getState?.()?.ready === true);
    await page.evaluate(() => {
      window.__E2E__?.pause?.();
      window.__E2E__?.step?.(240);
    });
  },
  targets: [
    { name: 'procgen-viewport', type: 'viewport' },
    { name: 'procgen-canvas-selector', type: 'selector', selector: '#gameCanvas' },
    { name: 'procgen-runtime', type: 'runtimeRects', ids: ['canvas', 'game'] },
    { name: 'procgen-ground-band', type: 'worldRect', rect: { x: 0, y: 120, width: 360, height: 60 }, padding: 8 }
  ],
  probes: [
    {
      name: 'procgen-canvas',
      selector: '#gameCanvas',
      checks: ['horizontalOverflow', 'verticalOverflow', 'unexpectedScrollbar']
    }
  ]
};

export default config;
