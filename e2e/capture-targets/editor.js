const config = {
  name: 'editor',
  route: '/editor.html',
  async setup(page) {
    await page.waitForSelector('#editorStatus', { state: 'visible' });
    await page.waitForFunction(() => {
      const state = window.__E2E__?.getState?.();
      return Boolean(state?.editor?.session?.level && state?.editor?.assets?.terrain?.length);
    });
    await page.evaluate(async () => {
      window.prompt = () => 'Capture Save';
      window.alert = (message) => {
        window.__EDITOR_CAPTURE_ALERT__ = String(message || '');
      };
      const state = window.__E2E__?.getState?.();
      const terrainId = state?.editor?.assets?.terrain?.[0]?.id;
      const gadgetId = state?.editor?.assets?.gadgets?.[0]?.id;
      await window.__E2E__?.editorApply?.([
        {
          type: 'level.new',
          args: {
            header: {
              TITLE: 'Capture Workflow',
              STYLE: 'dirt',
              WIDTH: 640,
              HEIGHT: 160,
              LEMMINGS: 5,
              SAVE_REQUIREMENT: 8
            }
          }
        },
        {
          type: 'entry.add',
          args: { kind: 'terrain', props: { PIECE: terrainId, X: 48, Y: 96 } }
        },
        {
          type: 'entry.add',
          args: { kind: 'steel', props: { X: 54, Y: 112, WIDTH: 56, HEIGHT: 16 } }
        },
        ...(Number.isFinite(gadgetId)
          ? [{
            type: 'entry.add',
            args: { kind: 'gadget', props: { PIECE: gadgetId, X: 144, Y: 88 } }
          }, {
            type: 'entry.update',
            args: {
              ref: { kind: 'gadget', index: 0 },
              set: { MIDI_FLAG: true, MIDI_FLAG_ID: 7 }
            }
          }]
          : []),
        {
          type: 'selection.set',
          args: { selection: [{ kind: 'terrain', index: 0 }] }
        }
      ], {
        history: { record: false },
        preview: { refresh: true, preserveViewport: true },
        returnState: 'editor'
      });
    });
    await page.locator('#editorHeaderSaveRequirement').evaluate((element) => {
      element.value = '8';
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('#editorSavedSave');
    await page.waitForFunction(() => {
      const saved = document.getElementById('editorSavedSelect');
      return Array.from(saved?.options || []).some(option => option.textContent === 'Capture Save');
    });
    await page.click('#editorPlaytestToggle');
    await page.waitForFunction(() => document.getElementById('editorPlaytestToggle')?.textContent === 'Playtest On');
    await page.waitForSelector('#editorIssuesList .issue-item');
  },
  targets: [
    { name: 'editor-shell', type: 'selector', selector: '.editor-app' },
    { name: 'editor-canvas-selector', type: 'selector', selector: '#editorCanvas' },
    { name: 'editor-palette', type: 'selector', selector: '#editorPaletteTerrain' },
    { name: 'editor-inspector', type: 'selector', selector: 'aside.editor-panel:has(#editorHeaderTitle)' },
    { name: 'editor-file-controls', type: 'selector', selector: '.editor-controls' },
    { name: 'editor-selection-actions', type: 'selector', selector: '#editorSelectionActions' },
    { name: 'editor-validation', type: 'selector', selector: '#editorIssuesList' },
    { name: 'editor-playtest-status', type: 'selector', selector: '.status-strip' },
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
    },
    {
      name: 'editor-file-controls',
      selector: '.editor-controls',
      checks: ['horizontalOverflow', 'clippedText']
    },
    {
      name: 'editor-selection-actions',
      selector: '#editorSelectionActions',
      checks: ['horizontalOverflow', 'clippedText']
    },
    {
      name: 'editor-validation',
      selector: '#editorIssuesList',
      checks: ['horizontalOverflow', 'clippedText']
    },
    {
      name: 'editor-playtest-status',
      selector: '.status-strip',
      checks: ['horizontalOverflow', 'clippedText']
    }
  ]
};

export default config;
