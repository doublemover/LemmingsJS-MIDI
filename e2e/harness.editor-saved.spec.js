import { expect, test } from '@playwright/test';
import fs from 'fs';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { seedSavedLevels } from './helpers/harness.js';

const waitForEditorHarness = async (page) => {
  await page.waitForFunction(() => {
    const api = window.__E2E__;
    if (!api?.getState) return false;
    const state = api.getState();
    return Boolean(
      state.editor?.session?.level?.header
      && state.editor?.assets?.terrain?.length
    );
  });
};

const bootEditor = async (page, options = {}) => {
  await installExternalAssetStubs(page);
  if (options.savedEntries) {
    await seedSavedLevels(page, options.savedEntries);
  } else {
    await page.addInitScript(() => {
      try {
        const key = '__e2eStorageCleared';
        if (!window.sessionStorage?.getItem?.(key)) {
          window.localStorage?.clear?.();
          window.sessionStorage?.setItem?.(key, 'true');
        }
      } catch (error) {}
    });
  }
  await page.addInitScript((promptValue) => {
    window.prompt = () => promptValue;
    window.alert = () => {};
  }, options.promptValue || 'E2E Save');
  await page.goto('/editor.html?e2e=1');
  await waitForEditorHarness(page);
};

test('Saved levels dropdown orders entries by name then updatedAt', async ({ page }) => {
  await bootEditor(page, {
    savedEntries: [
      { id: 'c', name: 'Zed', updatedAt: 10, text: 'zed' },
      { id: 'a', name: 'alpha', updatedAt: 5, text: 'alpha-5' },
      { id: 'b', name: 'alpha', updatedAt: 1, text: 'alpha-1' }
    ]
  });

  const options = await page.locator('#editorSavedSelect option').allTextContents();
  expect(options[0]).toBe('Saved levels');
  expect(options.slice(1)).toEqual(['alpha', 'alpha', 'Zed']);
});

test('Saved levels persist across reloads', async ({ page }) => {
  await bootEditor(page, { promptValue: 'E2E Persist' });

  await page.click('#editorSavedSave');
  await expect(page.locator('#editorSavedSelect')).toContainText('E2E Persist');

  await page.reload();
  await waitForEditorHarness(page);
  await expect(page.locator('#editorSavedSelect')).toContainText('E2E Persist');
});

test('Editor project menu stores levels and exports a pack bundle', async ({ page }) => {
  await bootEditor(page);
  await page.evaluate(() => {
    const prompts = ['Project A', 'Level Two', 'Level Two Copy', 'Renamed Level'];
    window.prompt = () => prompts.shift() || 'Project Prompt';
    window.confirm = () => true;
  });

  await page.locator('.editor-project-menu summary').click();
  await page.click('#editorProjectNew');
  await expect(page.locator('#editorProjectSelect')).toContainText('Project A (1)');

  await page.evaluate(() => window.__E2E__.editorApply([
    {
      type: 'level.new',
      args: {
        header: {
          TITLE: 'Second Project Level',
          STYLE: 'dirt',
          WIDTH: 640,
          HEIGHT: 160
        }
      }
    }
  ], { preview: { refresh: false }, returnState: 'editor' }));
  await page.dispatchEvent('#editorProjectAddLevel', 'click');
  await expect(page.locator('#editorProjectLevelSelect')).toContainText('Level Two');

  await page.dispatchEvent('#editorProjectDuplicateLevel', 'click');
  await expect(page.locator('#editorProjectLevelSelect')).toContainText('Level Two Copy');
  await page.dispatchEvent('#editorProjectRenameLevel', 'click');
  await expect(page.locator('#editorProjectLevelSelect')).toContainText('Renamed Level');
  await page.dispatchEvent('#editorProjectDeleteLevel', 'click');

  const projectState = await page.evaluate(() => window.__E2E__.getState().editor.ui.project);
  expect(projectState.name).toBe('Project A');
  expect(projectState.levelCount).toBe(2);
  expect(projectState.levels.map(level => level.title)).toEqual(['Untitled', 'Level Two']);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#editorProjectExportPack')
  ]);
  const downloadPath = await download.path();
  const bundle = JSON.parse(fs.readFileSync(downloadPath, 'utf-8'));

  expect(bundle.kind).toBe('lemmings.editor.pack.bundle');
  expect(bundle.project.name).toBe('Project A');
  expect(bundle.project.levelCount).toBe(2);
  expect(bundle.files.map(file => file.path)).toContain('info.nxmi');
  expect(bundle.files.map(file => file.path)).toContain('levels.nxmi');
  expect(bundle.validationReports).toHaveLength(2);
  expect(bundle.packValidationReport.summary.total).toBeGreaterThanOrEqual(0);
});
