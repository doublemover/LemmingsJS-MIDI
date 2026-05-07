const config = {
  name: 'game-hud',
  route: '/',
  async setup(page) {
    await page.waitForFunction(() => window.__E2E__?.getState?.()?.ready === true);
    await page.evaluate(() => window.__E2E__?.pause?.());
  },
  targets: [
    { name: 'game-level-selects', type: 'selector', selector: '#levelSelects' },
    { name: 'game-runtime-hud', type: 'runtimeRects', ids: ['canvas', 'game', 'gui', 'minimap'] },
    { name: 'game-viewport', type: 'viewport' }
  ],
  probes: [
    {
      name: 'game-shell',
      selector: '.game',
      checks: ['horizontalOverflow', 'verticalOverflow', 'unexpectedScrollbar']
    },
    {
      name: 'game-level-selects',
      selector: '#levelSelects',
      checks: ['horizontalOverflow', 'verticalOverflow', 'unexpectedScrollbar']
    }
  ]
};

export default config;
