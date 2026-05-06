const waitForEditorReady = async (page) => {
  await page.waitForSelector('#editorStatus', { state: 'visible' });
  await page.waitForFunction(() => {
    const state = window.__E2E__?.getState?.();
    return Boolean(state?.editor?.session?.level && state?.editor?.assets?.terrain?.length);
  });
};

const applyEditorOps = (page, ops, options = {}) => page.evaluate(
  ({ ops, options }) => window.__E2E__?.editorApply?.(ops, options),
  { ops, options }
);

const getEditorAssetIds = (page) => page.evaluate(() => {
  const assets = window.__E2E__?.getState?.()?.editor?.assets || {};
  const entranceId = assets.entranceId;
  const exitId = assets.exitId;
  const gadget = (assets.gadgets || []).find(entry => (
    Number.isFinite(entry?.id) &&
    entry.id !== entranceId &&
    entry.id !== exitId
  )) || assets.gadgets?.[0];
  return {
    terrainId: assets.terrain?.[0]?.id,
    entranceId,
    exitId,
    gadgetId: gadget?.id,
    triggerId: assets.triggers?.[0]?.id
  };
});

const assertRequiredAssetIds = (ids) => {
  for (const key of ['terrainId', 'entranceId', 'exitId']) {
    if (!Number.isFinite(ids[key])) {
      throw new Error(`Editor capture assets are missing ${key}.`);
    }
  }
};

const createWorkflowLevel = async (page, title = 'Capture Workflow') => {
  await page.evaluate(() => window.__E2E__?.setEditorPlaytest?.(false));
  await applyEditorOps(page, [
    {
      type: 'level.new',
      args: {
        header: {
          TITLE: title,
          STYLE: 'dirt',
          WIDTH: 640,
          HEIGHT: 192,
          LEMMINGS: 8,
          SAVE_REQUIREMENT: 5,
          TIME_LIMIT: 'INFINITE',
          MAX_SPAWN_INTERVAL: 50,
          START_X: 0,
          START_Y: 0
        },
        resetHistory: true
      }
    }
  ], { history: { record: false }, preview: { refresh: false }, returnState: 'editor' });

  const ids = await getEditorAssetIds(page);
  assertRequiredAssetIds(ids);
  const ops = [
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: ids.terrainId, X: 48, Y: 112 } } },
    { type: 'entry.update', args: { ref: { kind: 'terrain', index: 0 }, set: { ONE_WAY: true } } },
    { type: 'entry.add', args: { kind: 'steel', props: { X: 64, Y: 132, WIDTH: 64, HEIGHT: 16 } } },
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: ids.entranceId, X: 32, Y: 80 } } },
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: ids.exitId, X: 560, Y: 80 } } }
  ];

  if (Number.isFinite(ids.triggerId)) {
    ops.push(
      { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: ids.triggerId, X: 184, Y: 104 } } },
      {
        type: 'entry.update',
        args: {
          ref: { kind: 'gadget', index: 2 },
          set: { MIDI_FLAG: true, MIDI_FLAG_ID: 7, MIDI_FLAG_COOLDOWN: 4 }
        }
      }
    );
  } else if (Number.isFinite(ids.gadgetId)) {
    ops.push({ type: 'entry.add', args: { kind: 'gadget', props: { PIECE: ids.gadgetId, X: 184, Y: 104 } } });
  }

  ops.push({ type: 'selection.set', args: { selection: [{ kind: 'terrain', index: 0 }] } });
  await applyEditorOps(page, ops, {
    history: { record: false },
    preview: { refresh: true, preserveViewport: true },
    validate: { run: true },
    returnState: 'full'
  });
  await page.waitForFunction((expectedTitle) => {
    const state = window.__E2E__?.getState?.();
    return state?.editor?.session?.level?.header?.TITLE === expectedTitle &&
      state?.editor?.validation?.hasErrors === false;
  }, title);
};

const buildWarningImportText = (ids) => [
  '# Capture preserves unsupported NeoLemmix data as editor warnings.',
  'TITLE Capture Warning Import',
  'STYLE dirt',
  'WIDTH 640',
  'HEIGHT 192',
  'LEMMINGS 8',
  'SAVE_REQUIREMENT 5',
  '$TERRAINGROUP',
  '  STEEL true',
  '  $TERRAIN',
  `    PIECE ${ids.terrainId}`,
  '    X 80',
  '    Y 120',
  '    ROTATE 45',
  '    WIDTH 32',
  '  $END',
  '$END',
  '$TERRAIN',
  `  PIECE ${ids.terrainId}`,
  '  X 120',
  '  Y 128',
  '  ROTATE 45',
  '  FLIP_HORIZONTAL true',
  '$END',
  '$GADGET',
  `  PIECE ${ids.entranceId}`,
  '  X 32',
  '  Y 80',
  '$END',
  '$GADGET',
  `  PIECE ${ids.exitId}`,
  '  X 560',
  '  Y 80',
  '$END',
  '$TALISMAN',
  '  TITLE Preserved Capture Data',
  '$END',
  ''
].join('\n');

const stageValidationWarnings = async (page) => {
  await page.evaluate(() => window.__E2E__?.setEditorPlaytest?.(false));
  const ids = await getEditorAssetIds(page);
  assertRequiredAssetIds(ids);
  await page.setInputFiles('#editorSavedImportInput', {
    name: 'capture-warning-import.nxlv',
    mimeType: 'text/plain',
    buffer: Buffer.from(buildWarningImportText(ids), 'utf-8')
  });
  await page.waitForFunction(() => (
    window.__E2E__?.getState?.()?.editor?.session?.level?.header?.TITLE === 'Capture Warning Import'
  ));
  await page.waitForSelector('#editorIssuesList .issue-item[data-severity="warning"]');
};

const stageSaveImportExport = async (page) => {
  await createWorkflowLevel(page, 'Capture Save Import Export');
  const text = await page.evaluate(() => window.__E2E__?.getEditorLevelText?.() || '');
  await page.setInputFiles('#editorSavedImportInput', {
    name: 'capture-import.nxlv',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8')
  });
  await page.waitForFunction(() => {
    const state = window.__E2E__?.getState?.();
    return state?.editor?.session?.level?.header?.TITLE === 'Capture Save Import Export';
  });
  await page.click('#editorSavedSave');
  await page.waitForFunction(() => {
    const saved = document.getElementById('editorSavedSelect');
    return Array.from(saved?.options || []).some(option => option.textContent === 'Capture Save');
  });
};

const stagePlaytest = async (page) => {
  await createWorkflowLevel(page, 'Capture Playtest');
  await page.click('#editorPlaytestToggle');
  await page.waitForFunction(() => {
    const state = window.__E2E__?.getState?.();
    return state?.editor?.playtest === true &&
      document.getElementById('editorPlaytestToggle')?.textContent === 'Playtest On';
  });
};

const config = {
  name: 'editor',
  route: '/editor.html',
  async setup(page) {
    await waitForEditorReady(page);
    await page.evaluate(() => {
      try {
        window.localStorage?.clear?.();
      } catch (error) {}
      window.prompt = () => 'Capture Save';
      window.alert = (message) => {
        window.__EDITOR_CAPTURE_ALERT__ = String(message || '');
      };
    });
  },
  states: [
    {
      name: 'shell',
      async setup(page) {
        await createWorkflowLevel(page, 'Capture Shell');
      },
      targets: [
        { name: 'app', type: 'selector', selector: '.editor-app' },
        { name: 'header-controls', type: 'selector', selector: '.editor-header' },
        { name: 'viewport', type: 'viewport' }
      ],
      probes: [
        {
          name: 'app',
          selector: '.editor-app',
          checks: ['horizontalOverflow', 'verticalOverflow', 'unexpectedScrollbar']
        },
        {
          name: 'header-controls',
          selector: '.editor-controls',
          checks: ['horizontalOverflow', 'clippedText']
        }
      ]
    },
    {
      name: 'canvas-palette-inspector',
      async setup(page) {
        await createWorkflowLevel(page, 'Capture Canvas Palette Inspector');
        await page.locator('#editorPaletteTerrain button[data-type="terrain"]').first().click();
        await page.locator('#editorSelectionFlags').evaluate((element) => {
          element.open = true;
        });
      },
      targets: [
        { name: 'canvas-panel', type: 'selector', selector: '.editor-canvas-panel' },
        { name: 'canvas-runtime', type: 'runtimeRect', id: 'editorCanvas' },
        { name: 'palette', type: 'selector', selector: '.palette-block' },
        { name: 'inspector', type: 'selector', selector: 'aside.editor-panel:has(#editorHeaderTitle)' },
        { name: 'selection-actions', type: 'selector', selector: '#editorSelectionActions' }
      ],
      probes: [
        {
          name: 'canvas-panel',
          selector: '.editor-canvas-panel',
          checks: ['horizontalOverflow', 'verticalOverflow', 'unexpectedScrollbar']
        },
        {
          name: 'palette',
          selector: '.palette-block',
          checks: ['horizontalOverflow']
        },
        {
          name: 'selection-actions',
          selector: '#editorSelectionActions',
          checks: ['horizontalOverflow', 'clippedText']
        }
      ]
    },
    {
      name: 'validation',
      async setup(page) {
        await stageValidationWarnings(page);
      },
      targets: [
        { name: 'warnings', type: 'selector', selector: '#editorIssuesList' },
        { name: 'inspector-with-warnings', type: 'selector', selector: 'aside.editor-panel:has(#editorIssuesList .issue-item)' }
      ],
      probes: [
        {
          name: 'warnings',
          selector: '#editorIssuesList',
          checks: ['horizontalOverflow', 'clippedText']
        }
      ]
    },
    {
      name: 'save-import-export',
      async setup(page) {
        await stageSaveImportExport(page);
      },
      targets: [
        { name: 'file-controls', type: 'selector', selector: '.editor-controls' },
        { name: 'saved-select', type: 'selector', selector: '#editorSavedSelect' },
        { name: 'status-strip', type: 'selector', selector: '.status-strip' }
      ],
      probes: [
        {
          name: 'file-controls',
          selector: '.editor-controls',
          checks: ['horizontalOverflow', 'clippedText']
        }
      ]
    },
    {
      name: 'playtest',
      async setup(page) {
        await stagePlaytest(page);
      },
      targets: [
        { name: 'status-strip', type: 'selector', selector: '.status-strip' },
        { name: 'canvas-runtime', type: 'runtimeRect', id: 'editorCanvas' },
        { name: 'viewport', type: 'viewport' }
      ],
      probes: [
        {
          name: 'status-strip',
          selector: '.status-strip',
          checks: ['horizontalOverflow', 'clippedText']
        }
      ]
    }
  ]
};

export default config;
