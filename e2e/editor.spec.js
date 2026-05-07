import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await page.addInitScript(() => {
    try {
      window.localStorage?.clear?.();
    } catch (error) {}
    window.prompt = () => 'E2E Save';
    window.alert = () => {};
  });
  await page.goto('/editor.html?e2e=1');
  await expect(page.locator('#editorStatus')).toContainText('Tool:');
  await page.waitForFunction(() => typeof window.__E2E__?.getEditorLevelText === 'function');
});

const setEditorField = async (page, selector, value) => {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
};

const applyEditorOps = (page, ops, options = {}) => page.evaluate(
  ({ ops, options }) => window.__E2E__.editorApply(ops, options),
  { ops, options }
);

const sortByJson = (items) => [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const propNumber = (value) => {
  if (Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const propBoolean = (value) => (
  value === true || value === 1 || value === 'true' || value === '1'
);

const getEditorAssetIds = (page) => page.evaluate(() => {
  const assets = window.__E2E__.getState().editor.assets;
  return {
    terrainId: assets.terrain[0]?.id,
    triggerId: assets.triggers[0]?.id,
    entranceId: assets.entranceId,
    exitId: assets.exitId
  };
});

const semanticSummary = (level) => ({
  header: {
    TITLE: level.header?.TITLE || '',
    STYLE: level.header?.STYLE || '',
    LEMMINGS: propNumber(level.header?.LEMMINGS),
    SAVE_REQUIREMENT: propNumber(level.header?.SAVE_REQUIREMENT),
    WIDTH: propNumber(level.header?.WIDTH),
    HEIGHT: propNumber(level.header?.HEIGHT)
  },
  terrains: sortByJson((level.terrains || []).map(entry => ({
    PIECE: propNumber(entry.props?.PIECE),
    X: propNumber(entry.props?.X),
    Y: propNumber(entry.props?.Y),
    ONE_WAY: propBoolean(entry.props?.ONE_WAY)
  }))),
  gadgets: sortByJson((level.gadgets || []).map(entry => ({
    PIECE: propNumber(entry.props?.PIECE),
    X: propNumber(entry.props?.X),
    Y: propNumber(entry.props?.Y),
    MIDI_FLAG: propBoolean(entry.props?.MIDI_FLAG),
    MIDI_FLAG_ID: propNumber(entry.props?.MIDI_FLAG_ID),
    MIDI_FLAG_COOLDOWN: propNumber(entry.props?.MIDI_FLAG_COOLDOWN)
  }))),
  steel: sortByJson((level.steel || []).map(entry => ({
    X: propNumber(entry.props?.X),
    Y: propNumber(entry.props?.Y),
    WIDTH: propNumber(entry.props?.WIDTH),
    HEIGHT: propNumber(entry.props?.HEIGHT)
  })))
});

const buildWarningImportText = ({ terrainId, entranceId, exitId }) => [
  '# E2E warning import keeps unsupported NeoLemmix data visible.',
  'TITLE E2E Warning Import',
  'STYLE dirt',
  'WIDTH 640',
  'HEIGHT 192',
  'LEMMINGS 8',
  'SAVE_REQUIREMENT 5',
  '$TERRAINGROUP',
  '  STEEL true',
  '  $TERRAIN',
  `    PIECE ${terrainId}`,
  '    X 64',
  '    Y 112',
  '    ROTATE 45',
  '    WIDTH 32',
  '  $END',
  '$END',
  '$TERRAIN',
  `  PIECE ${terrainId}`,
  '  X 120',
  '  Y 128',
  '  ROTATE 45',
  '  FLIP_HORIZONTAL true',
  '$END',
  '$GADGET',
  `  PIECE ${entranceId}`,
  '  X 32',
  '  Y 80',
  '$END',
  '$GADGET',
  `  PIECE ${exitId}`,
  '  X 560',
  '  Y 80',
  '$END',
  '$TALISMAN',
  '  TITLE Preserved Unsupported Data',
  '$END',
  ''
].join('\n');

test('Editor UI loads and tool selection updates state', async ({ page }) => {
  await expect(page.locator('#editorCanvas')).toBeVisible();

  const selectTool = page.locator('#editorToolList button[data-tool="select"]');
  await expect(selectTool).toHaveAttribute('aria-pressed', 'true');

  const terrainTool = page.locator('#editorToolList button[data-tool="terrain"]');
  await terrainTool.click();
  await expect(terrainTool).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#editorStatus')).toContainText('Tool: terrain');
});

test('Palette tabs switch visible lists', async ({ page }) => {
  const terrainTab = page.locator('#editorPaletteTabs button[data-tab="terrain"]');
  const gadgetsTab = page.locator('#editorPaletteTabs button[data-tab="gadgets"]');
  const triggersTab = page.locator('#editorPaletteTabs button[data-tab="triggers"]');
  await expect(terrainTab).toHaveAttribute('aria-pressed', 'true');
  await expect(gadgetsTab).toHaveAttribute('aria-pressed', 'false');

  await gadgetsTab.click();
  await expect(terrainTab).toHaveAttribute('aria-pressed', 'false');
  await expect(gadgetsTab).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#editorPaletteGadgets')).toHaveJSProperty('hidden', false);
  await expect(page.locator('#editorPaletteGadgets')).toBeVisible();
  await expect(page.locator('#editorPaletteTerrain')).toHaveJSProperty('hidden', true);
  await expect(page.locator('#editorPaletteTerrain')).toBeHidden();

  await triggersTab.click();
  await expect(gadgetsTab).toHaveAttribute('aria-pressed', 'false');
  await expect(triggersTab).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#editorPaletteTriggers')).toHaveJSProperty('hidden', false);
  await expect(page.locator('#editorPaletteTriggers')).toBeVisible();
  await expect(page.locator('#editorPaletteTerrain')).toHaveJSProperty('hidden', true);
  await expect(page.locator('#editorPaletteTerrain')).toBeHidden();
});

test('Palette view toggle switches list and grid layouts', async ({ page }) => {
  const listButton = page.locator('#editorPaletteViewList');
  const gridButton = page.locator('#editorPaletteViewGrid');
  const terrainList = page.locator('#editorPaletteTerrain');

  await expect(listButton).toHaveClass(/active/);
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await expect(gridButton).toHaveAttribute('aria-pressed', 'false');
  await expect(terrainList).not.toHaveClass(/grid/);

  await gridButton.click();
  await expect(gridButton).toHaveClass(/active/);
  await expect(listButton).toHaveAttribute('aria-pressed', 'false');
  await expect(gridButton).toHaveAttribute('aria-pressed', 'true');
  await expect(terrainList).toHaveClass(/grid/);

  await listButton.click();
  await expect(listButton).toHaveClass(/active/);
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await expect(gridButton).toHaveAttribute('aria-pressed', 'false');
  await expect(terrainList).not.toHaveClass(/grid/);
});

test('Palette recent strip records and reselects pieces', async ({ page }) => {
  const terrainButton = page.locator('#editorPaletteTerrain button[data-type="terrain"]').first();
  const terrainId = Number(await terrainButton.getAttribute('data-id'));
  expect(Number.isFinite(terrainId)).toBe(true);

  await terrainButton.click();
  const recentTerrain = page.locator(`#editorPaletteRecent button[data-type="terrain"][data-id="${terrainId}"]`);
  await expect(recentTerrain).toBeVisible();
  await expect(recentTerrain).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#editorPaletteTabs button[data-tab="gadgets"]').click();
  const gadgetButton = page.locator('#editorPaletteGadgets button[data-type="gadget"]').first();
  const gadgetId = Number(await gadgetButton.getAttribute('data-id'));
  expect(Number.isFinite(gadgetId)).toBe(true);
  await gadgetButton.click();

  const recentButtons = page.locator('#editorPaletteRecent button');
  await expect(recentButtons.first()).toHaveAttribute('data-type', 'gadget');
  await expect(recentButtons.first()).toHaveAttribute('data-id', String(gadgetId));

  await recentTerrain.click();
  const selectedTerrainId = await page.evaluate(() => window.__E2E__.getState().editor.controller.selectedTerrainId);
  expect(selectedTerrainId).toBe(terrainId);
});

test('Save and import keep saved list wired up', async ({ page }) => {
  await page.click('#editorSavedSave');
  await expect(page.locator('#editorSavedSelect')).toContainText('E2E Save');

  const text = await page.evaluate(() => {
    return window.__E2E__?.getEditorLevelText?.() || '';
  });
  expect(text.length).toBeGreaterThan(0);

  await page.setInputFiles('#editorSavedImportInput', {
    name: 'e2e-import.nxlv',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8')
  });

  await page.waitForFunction(() => {
    const select = document.getElementById('editorSavedSelect');
    return select && select.value === '';
  });
});

test('Validation panel renders and applies fix buttons', async ({ page }) => {
  await setEditorField(page, '#editorHeaderLemmings', 5);
  await setEditorField(page, '#editorHeaderSaveRequirement', 8);

  await expect(page.locator('#editorIssuesList')).toHaveAttribute('role', 'list');
  await expect(page.locator('#editorIssuesList')).toHaveAttribute('aria-live', 'polite');
  const issue = page.locator('#editorIssuesList .issue-item', {
    hasText: 'Save requirement exceeds lemmings.'
  });
  await expect(issue).toBeVisible();
  await expect(issue).toHaveAttribute('data-severity', 'error');
  await expect(issue).toHaveAttribute('aria-label', 'Error: Save requirement exceeds lemmings.');
  await expect(issue.locator('.issue-severity')).toHaveText('Error');
  await expect(issue.locator('.issue-message')).toHaveText('Save requirement exceeds lemmings.');
  await issue.getByRole('button', { name: 'Clamp save requirement' }).click();
  await expect(page.locator('#editorIssuesList')).not.toContainText('Save requirement exceeds lemmings.');

  const header = await page.evaluate(() => window.__E2E__.getState().editor.session.level.header);
  expect(header.SAVE_REQUIREMENT).toBe(5);
  expect(header.LEMMINGS).toBe(5);
});

test('Solvability check reports bounded advisory guidance', async ({ page }) => {
  const ids = await getEditorAssetIds(page);
  expect(Number.isFinite(ids.terrainId)).toBe(true);
  expect(Number.isFinite(ids.entranceId)).toBe(true);
  expect(Number.isFinite(ids.exitId)).toBe(true);

  await applyEditorOps(page, [
    {
      type: 'level.new',
      args: {
        header: {
          TITLE: 'E2E Solvability Advisory',
          STYLE: 'dirt',
          WIDTH: 640,
          HEIGHT: 192,
          LEMMINGS: 8,
          SAVE_REQUIREMENT: 5
        },
        resetHistory: true
      }
    },
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: ids.terrainId, X: 64, Y: 120, ONE_WAY: true } } },
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: ids.entranceId, X: 32, Y: 88 } } }
  ], {
    history: { record: false },
    preview: { refresh: true, preserveViewport: true },
    validate: { run: true },
    returnState: 'editor'
  });

  await page.click('#editorSolvabilityCheck');
  await expect(page.locator('#editorSolvabilityStatus')).toHaveAttribute('data-status', 'warnings');
  await expect(page.locator('#editorSolvabilityStatus')).toContainText('Solvability: 1 advisory warning');

  const solvability = await page.evaluate(() => window.__E2E__.getState().editor.ui.solvability);
  expect(solvability.status).toBe('warnings');
  expect(solvability.warningCount).toBe(1);
  expect(solvability.warnings.map(warning => warning.code)).toContain('missing-exit');
  expect(solvability.budgetUsage).toBeTruthy();
});

test('Unsupported NeoLemmix data imports with visible warnings and preserved export text', async ({ page }) => {
  const ids = await getEditorAssetIds(page);
  expect(Number.isFinite(ids.terrainId)).toBe(true);
  expect(Number.isFinite(ids.entranceId)).toBe(true);
  expect(Number.isFinite(ids.exitId)).toBe(true);

  await page.setInputFiles('#editorSavedImportInput', {
    name: 'warning-import.nxlv',
    mimeType: 'text/plain',
    buffer: Buffer.from(buildWarningImportText(ids), 'utf-8')
  });

  const warningList = page.locator('#editorIssuesList');
  await expect(warningList.locator('.issue-item[data-severity="warning"]', {
    hasText: 'Terrain groups are not exported to classic .lvl'
  })).toBeVisible();
  await expect(warningList.locator('.issue-item[data-severity="warning"]', {
    hasText: 'Terrain entries include properties classic .lvl cannot export'
  })).toBeVisible();
  await expect(warningList.locator('.issue-item[data-severity="warning"]', {
    hasText: 'Classic LVL export is lossy'
  })).toBeVisible();

  const state = await page.evaluate(() => window.__E2E__.getState().editor);
  expect(state.validation.hasErrors).toBe(false);
  expect(state.session.level.terrainGroups).toHaveLength(1);
  expect(state.session.level.unknownSections.some(section => section.name === 'TALISMAN')).toBe(true);

  const exported = await page.evaluate(() => window.__E2E__.getEditorLevelText());
  expect(exported).toContain('$TERRAINGROUP');
  expect(exported).toContain('$TALISMAN');
  expect(exported).toContain('ROTATE 45');
});

test('Empty editor import reports a visible failure without replacing the current level', async ({ page }) => {
  const titleBefore = await page.evaluate(() => window.__E2E__.getState().editor.session.level.header.TITLE);

  await page.setInputFiles('#editorSavedImportInput', {
    name: 'empty-import.nxlv',
    mimeType: 'text/plain',
    buffer: Buffer.from('', 'utf-8')
  });

  await expect(page.locator('#editorStatus')).toContainText('NXLV import failed');
  await expect(page.locator('#editorIssuesList .issue-item[data-severity="error"]', {
    hasText: 'NXLV import failed: Level file is empty.'
  })).toBeVisible();
  const titleAfter = await page.evaluate(() => window.__E2E__.getState().editor.session.level.header.TITLE);
  expect(titleAfter).toBe(titleBefore);
});

test('UI export and import accepts the same semantic editor state', async ({ page }) => {
  const ids = await getEditorAssetIds(page);
  expect(Number.isFinite(ids.terrainId)).toBe(true);
  expect(Number.isFinite(ids.triggerId)).toBe(true);
  expect(Number.isFinite(ids.entranceId)).toBe(true);
  expect(Number.isFinite(ids.exitId)).toBe(true);

  await applyEditorOps(page, [
    {
      type: 'level.new',
      args: {
        header: {
          TITLE: 'E2E UI Semantic Roundtrip',
          STYLE: 'dirt',
          WIDTH: 640,
          HEIGHT: 192,
          LEMMINGS: 10,
          SAVE_REQUIREMENT: 6,
          TIME_LIMIT: 'INFINITE',
          MAX_SPAWN_INTERVAL: 50
        },
        resetHistory: true
      }
    },
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: ids.terrainId, X: 64, Y: 120 } } },
    { type: 'entry.update', args: { ref: { kind: 'terrain', index: 0 }, set: { ONE_WAY: true } } },
    { type: 'entry.add', args: { kind: 'steel', props: { X: 72, Y: 136, WIDTH: 48, HEIGHT: 12 } } },
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: ids.entranceId, X: 32, Y: 88 } } },
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: ids.exitId, X: 560, Y: 88 } } },
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: ids.triggerId, X: 196, Y: 104 } } },
    {
      type: 'entry.update',
      args: {
        ref: { kind: 'gadget', index: 2 },
        set: { MIDI_FLAG: true, MIDI_FLAG_ID: 9, MIDI_FLAG_COOLDOWN: 3 }
      }
    }
  ], {
    history: { record: false },
    preview: { refresh: true, preserveViewport: true },
    validate: { run: true },
    returnState: 'full'
  });

  await page.waitForFunction(() => window.__E2E__.getState().editor.validation.hasErrors === false);
  const beforeLevel = await page.evaluate(() => window.__E2E__.getState().editor.session.level);
  const before = semanticSummary(beforeLevel);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#editorSavedExport')
  ]);
  const downloadPath = await download.path();
  const exportedText = await fs.readFile(downloadPath, 'utf-8');
  expect(exportedText).toContain('E2E UI Semantic Roundtrip');
  expect(exportedText).toContain('MIDI_FLAG true');

  await page.setInputFiles('#editorSavedImportInput', {
    name: 'semantic-roundtrip.nxlv',
    mimeType: 'text/plain',
    buffer: Buffer.from(exportedText, 'utf-8')
  });
  await page.waitForFunction(() => (
    window.__E2E__.getState().editor.session.level.header.TITLE === 'E2E UI Semantic Roundtrip'
  ));

  const afterLevel = await page.evaluate(() => window.__E2E__.getState().editor.session.level);
  expect(semanticSummary(afterLevel)).toEqual(before);
});

test('Selection inspector toggles terrain one-way flags', async ({ page }) => {
  const terrainId = await page.evaluate(() => window.__E2E__.getState().editor.assets.terrain[0]?.id);
  expect(Number.isFinite(terrainId)).toBe(true);

  await applyEditorOps(page, [
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: terrainId, X: 32, Y: 32 } } },
    { type: 'entry.add', args: { kind: 'steel', props: { X: 96, Y: 32, WIDTH: 16, HEIGHT: 16 } } },
    { type: 'selection.set', args: { selection: [{ kind: 'terrain', index: 0 }] } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  const oneWay = page.locator('#editorSelOneWay');
  await page.locator('#editorSelectionFlags').evaluate(element => {
    element.open = true;
  });
  await expect(oneWay).toBeEnabled();
  await expect(oneWay).not.toBeChecked();

  await oneWay.check();
  const checkedProps = await page.evaluate(() => window.__E2E__.getState().editor.session.level.terrains[0].props);
  expect(checkedProps.ONE_WAY).toBe(true);

  await oneWay.uncheck();
  const uncheckedProps = await page.evaluate(() => window.__E2E__.getState().editor.session.level.terrains[0].props);
  expect(Object.prototype.hasOwnProperty.call(uncheckedProps, 'ONE_WAY')).toBe(false);

  await applyEditorOps(page, [
    { type: 'selection.set', args: { selection: [{ kind: 'steel', index: 0 }] } }
  ], { preview: { refresh: false }, returnState: 'editor' });
  await expect(oneWay).toBeDisabled();
});

test('Canvas interaction clears focused editor inputs', async ({ page }) => {
  const titleInput = page.locator('#editorHeaderTitle');
  await titleInput.focus();
  await expect(titleInput).toBeFocused();
  await page.locator('#editorCanvas').click({ position: { x: 12, y: 12 }, force: true });
  await expect(titleInput).not.toBeFocused();
});

test('Shortcut overlay focuses close control and restores focus on Escape', async ({ page }) => {
  const opener = page.locator('#editorSavedSave');
  const overlay = page.locator('#editorShortcutOverlay');
  const close = overlay.locator('.shortcut-overlay__close');

  await page.waitForSelector('#editorShortcutOverlay .shortcut-row');
  await opener.focus();
  await expect(opener).toBeFocused();

  await page.keyboard.press('F1');
  await expect(overlay).toHaveAttribute('aria-hidden', 'false');
  await expect(close).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  await expect(opener).toBeFocused();
});
