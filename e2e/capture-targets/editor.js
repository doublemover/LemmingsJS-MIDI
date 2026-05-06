const config = {
  name: 'editor',
  route: '/editor.html',
  async setup(page) {
    await page.waitForSelector('#editorStatus', { state: 'visible' });
    await page.waitForFunction(() => {
      const state = window.__E2E__?.getState?.();
      return Boolean(state?.editor?.session?.level && state?.editor?.assets?.terrain?.length);
    });
  },
  targets: [
    { name: 'editor-shell', type: 'selector', selector: '.editor-app' },
    { name: 'editor-canvas-selector', type: 'selector', selector: '#editorCanvas' },
    { name: 'editor-palette', type: 'selector', selector: '#editorPaletteTerrain' },
    { name: 'editor-inspector', type: 'selector', selector: 'aside.editor-panel:has(#editorHeaderTitle)' },
    { name: 'editor-header-rect', type: 'pageRect', rect: { x: 0, y: 0, width: 520, height: 120 } },
    { name: 'editor-canvas-runtime', type: 'runtimeRect', id: 'editorCanvas' },
    { name: 'editor-viewport', type: 'viewport' }
  ],
  probes: [
    {
      name: 'editor-shell',
      selector: '.editor-app',
      checks: ['horizontalOverflow', 'verticalOverflow', 'unexpectedScrollbar']
    },
    {
      name: 'editor-canvas-panel',
      selector: '.editor-canvas-panel',
      checks: ['horizontalOverflow', 'verticalOverflow', 'unexpectedScrollbar']
    }
  ]
};

export default config;
