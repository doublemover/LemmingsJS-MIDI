import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { waitForHarnessReady } from './helpers/harness.js';

test.use({ permissions: [] });

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await page.addInitScript(() => {
    window.__midiPermissionCalls = 0;
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => {
      window.__midiPermissionCalls += 1;
      throw new Error('Unexpected MIDI permission request');
    } });
  });
});

test('all layouts keep the identical live map canvas and musical undo keeps game time', { tag: '@boundary' }, async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?e2e=1&midi=1');
  await waitForHarnessReady(page);
  await page.evaluate(() => { window.__E2E__.pause(); window.__originalGameCanvas = document.getElementById('gameCanvas'); });
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
  await page.locator('[data-game-event-id="1"]').click();
  for (const layout of ['Focus', 'Split', 'Overlay', 'Split']) {
    await page.locator(`#midiLayout${layout}`).click();
    await expect(page.locator(`#midiLayout${layout}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#gameCanvas')).toBeVisible();
    expect(await page.evaluate(() => document.getElementById('gameCanvas') === window.__originalGameCanvas)).toBe(true);
    await expect(page.locator('#gameCanvas')).toHaveCount(1);
  }
  const duration = page.locator('#midiSoundDurationNumber');
  const before = await duration.inputValue();
  await duration.fill(before === '7' ? '8' : '7'); await duration.dispatchEvent('change');
  await page.locator('#midiGameStep').click();
  const clock = await page.locator('#midiGameClock').textContent();
  await page.locator('#midiUndo').click();
  await expect(duration).toHaveValue(before);
  await expect(page.locator('#midiGameClock')).toHaveText(clock);
  await page.locator('#midiRedo').click();
  await expect(duration).toHaveValue(before === '7' ? '8' : '7');
  expect(await page.evaluate(() => window.__midiPermissionCalls)).toBe(0);
});

test('instrument menus support keyboard navigation, dismissal and repeated opening', async ({ page }) => {
  await page.goto('/?e2e=1&midi=1');
  await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__.pause());
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
  const nav = page.locator('#midiInstrumentMenus');
  const menu = nav.locator('summary');
  await menu.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.locator('#midiMenuImport')).toBeFocused();
  await page.keyboard.press('End'); await expect(page.locator('#midiMenuSave')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(menu).toBeFocused();
  await expect(nav.locator('details[open]')).toHaveCount(0);
  await expect(page.locator('#midiSequencerWorkspace')).toBeVisible();
  await menu.click(); await page.locator('#midiGameClock').click();
  await expect(nav.locator('details[open]')).toHaveCount(0);
  await menu.click(); await page.locator('#midiWorkspaceClose').click();
  await page.locator('#midiWorkspaceToggle').click();
  await expect(nav.locator('details[open]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__midiPermissionCalls)).toBe(0);
});

test('character choices replace one accessory while retaining separate eyewear', async ({ page }, testInfo) => {
  await page.goto('/?e2e=1&midi=1');
  await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__.pause());
  await page.locator('#characterShapeChoices [data-value=donut]').click();
  const accessory = page.locator('#characterAccessory'), eyewear = page.locator('#characterEyewear');
  await expect(accessory).toBeEnabled();
  await page.locator('#characterEyewearChoices [data-value=monocle]').click();
  for (const choice of ['headphones', 'bow', 'crown', 'none', 'beret']) {
    await page.locator(`#characterAccessoryChoices [data-value=${choice}]`).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lemmings.character.appearance.v1')));
    expect(saved.accessory || 'beret').toBe(choice);
    expect(saved.eyewear).toBe('monocle');
    expect(saved.accessories).toBeUndefined();
    expect(saved.headwear).toBeUndefined();
    await expect(eyewear).toHaveValue('monocle');
  }
  await page.screenshot({ path: testInfo.outputPath('characters-single-accessory.png'), fullPage: true });
  await page.locator('#characterShapeChoices [data-value=classic]').click();
  await expect(accessory).toBeDisabled(); await expect(eyewear).toBeDisabled();
  expect(await page.evaluate(() => window.__midiPermissionCalls)).toBe(0);
});

test.describe('mobile workbench availability', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' });
  test('mobile hides MIDI until explicit opt-in', async ({ page }) => {
    await page.goto('/?e2e=1'); await waitForHarnessReady(page);
    await expect(page.locator('#midiWorkspaceToggle')).toBeHidden();
    await expect(page.locator('#midiSequencerWorkspace')).toBeHidden();
    expect(await page.evaluate(() => window.__midiPermissionCalls)).toBe(0);
    await page.goto('/?e2e=1&midi=1'); await waitForHarnessReady(page);
    await expect(page.locator('#midiWorkspaceToggle')).toBeVisible();
    if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
    await expect(page.locator('#midiSequencerWorkspace')).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('#gameCanvas')).toBeVisible();
  });
});

test('every right-pane workspace keeps aligned direct Panic and close controls', { tag: '@boundary' }, async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?e2e=1&midi=1'); await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__.pause());
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
  for (const view of ['Sounds', 'Expert', 'Project', 'Devices']) {
    await page.locator(`#midiView${view}`).click();
    await expect(page.locator('#midiPanicButton')).toBeVisible(); await expect(page.locator('#midiWorkspaceClose')).toBeVisible();
    const bounds = await page.locator('#midiTransportStrip').evaluate(header => {
      const title = header.querySelector('#midiEditScope').getBoundingClientRect(), close = header.querySelector('#midiWorkspaceClose').getBoundingClientRect();
      return { titleCenter: title.top + title.height / 2, closeCenter: close.top + close.height / 2,
        titleRight: title.right, closeLeft: close.left, overflowing: header.scrollWidth > header.clientWidth + 1 };
    });
    expect(Math.abs(bounds.titleCenter - bounds.closeCenter)).toBeLessThan(2);
    expect(bounds.closeLeft).toBeGreaterThanOrEqual(bounds.titleRight); expect(bounds.overflowing).toBe(false);
    const tick = await page.locator('#midiGameClock').textContent(); await page.locator('#midiPanicButton').click();
    await expect(page.locator('#midiGameClock')).toHaveText(tick);
  }
  await page.locator('#midiViewSounds').click();
  await expect(page.locator('.midi-sound-secondary')).not.toHaveAttribute('open');
  await page.locator('.midi-sound-secondary > summary').click(); await expect(page.locator('#midiSoundSnapshot')).toBeVisible();
  await page.locator('.midi-sound-secondary > summary').click(); await expect(page.locator('#midiSoundSnapshot')).toBeHidden();
  expect(await page.evaluate(() => window.__midiPermissionCalls)).toBe(0);
});


test('Studio cell edits preserve focus and saved Hold/Tie', { tag: '@boundary' }, async ({ page }) => {
  await page.goto('/?e2e=1&midi=1'); await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__.pause());
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
  await page.locator('[data-game-event-id="1"]').click();
  await page.locator('#midiClipCreate').click();
  await page.locator('#midiEventClipAdvance').selectOption('game-tick');
  const before = await page.evaluate(() => window.__E2E__.midiGetProject());
  const clipId = before.sources.find(source => source.id === 'sfx-1').clipId;
  const firstNote = before.clips.find(clip => clip.id === clipId).steps[0].note;
  const clock = await page.locator('#midiGameClock').textContent();
  await page.locator('#midiEventClipVoices').locator('..').locator('summary').click();
  await page.locator('#midiEventClipVoiceAdd').click();
  const voice = page.locator('#midiEventClipVoices input[aria-label="Voice 2 pitch"]');
  await voice.fill('F#4');
  await voice.evaluate(input => { input.setSelectionRange(1, 2); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(voice).toBeFocused();
  expect(await voice.evaluate(input => [input.selectionStart, input.selectionEnd])).toEqual([1, 2]);
  await page.locator('#midiEventClipLayers').locator('..').locator('summary').click();
  await page.locator('#midiEventClipLayerAdd').click();
  await page.locator('#midiEventClipLayers select[aria-label="Layer 1"]').selectOption('repeat');
  const repeat = page.locator('#midiEventClipLayers input[aria-label="Repeat count"]');
  await repeat.fill('3'); await repeat.dispatchEvent('change'); await expect(repeat).toBeFocused();
  await page.locator('#midiEventClipLayerAdd').click(); await page.locator('#midiEventClipLayerAdd').click();
  const layerRows = page.locator('#midiEventClipLayers > .midi-clip-controls');
  const transpose = layerRows.nth(2).locator('.midi-clip-layer-transpose');
  await transpose.fill('7'); await transpose.dispatchEvent('change');
  await layerRows.nth(2).getByRole('button', { name: 'Earlier', exact: true }).focus();
  for (const [row, label] of [[1, 'Earlier'], [0, 'Later'], [1, 'Later'], [2, 'Earlier']]) {
    await page.keyboard.press('Enter');
    await expect(layerRows.nth(row).getByRole('button', { name: label, exact: true })).toBeFocused();
  }

  await page.locator('#midiEventClipHold').check();
  await expect(page.locator('#midiEventClipHold')).toHaveAttribute('title', /next played|phrase end/i);
  await page.locator('#midiEventClipGrid [data-cell-index="0"]').focus(); await page.keyboard.press('ArrowRight');
  await page.locator('#midiEventClipTie').check();
  await expect(page.locator('#midiEventClipTie')).toHaveAttribute('title', /extend/i);
  await page.locator('#midiEventClipAdvance').selectOption('event');
  await expect(page.locator('#midiEventClipTie')).toHaveAttribute('title', /omit|skip/i);
  await page.locator('#midiEventClipAdvance').selectOption('game-tick');
  const edited = await page.evaluate(id => window.__E2E__.midiGetProject().clips.find(clip => clip.id === id), clipId);
  expect(edited.steps[0].voices[0].note).toBe(firstNote); expect(edited.steps[0].voices[1].note).toBe(66);
  expect(edited.steps[0].transformLayers[0]).toMatchObject({ type: 'repeat', count: 3 });
  expect(edited.steps[0].transformLayers[2]).toMatchObject({ type: 'pitch', transpose: 7 });
  expect(edited.steps[0].hold).toBe(true); expect(edited.steps[1].tie).toBe(true);
  await expect(page.locator('#midiGameClock')).toHaveText(clock);
  await page.locator('#midiViewProject').click(); await page.locator('.midi-project-tools > summary').click(); await page.locator('#midiTemplateSaveButton').click();
  await expect(page.locator('#midiProjectStatus')).toContainText('Saved');
  await page.reload(); await waitForHarnessReady(page);
  expect(await page.evaluate(id => window.__E2E__.midiGetProject().clips.find(clip => clip.id === id), clipId)).toEqual(edited);
  expect(await page.evaluate(() => window.__midiPermissionCalls)).toBe(0);
});


test('Studio span bundles keep selection, atomic Undo and saved edits', { tag: '@boundary' }, async ({ page }) => {
  await page.goto('/?e2e=1&midi=1'); await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__.pause());
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
  await page.locator('#midiViewExpert').click();
  await page.locator('#midiModulationInspector > summary').click();
  await page.locator('#midiAutomationAddButton').click();
  const spatial = await page.evaluate(() => window.__E2E__.midiGetProject().automation.filter(entry => !entry.span));
  expect(spatial.length).toBeGreaterThan(0);
  const clock = await page.locator('#midiGameClock').textContent();
  await page.locator('#midiSpanPresetApply').click();
  const list = page.locator('#midiMainSpanList');
  const rows = list.locator('.midi-span-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('details[open]')).toHaveCount(3);
  await expect(list.locator('.midi-span-batch strong')).toHaveText('3 selected');
  const length = list.getByRole('spinbutton', { name: 'Selected spans Length', exact: true });
  const original = await page.evaluate(() => window.__E2E__.midiGetProject());
  await length.fill('11.5'); await length.dispatchEvent('change');
  await expect(length).toBeFocused();
  expect(await page.evaluate(() => window.__E2E__.midiGetProject().automation.filter(entry => entry.span).map(entry => entry.span.duration))).toEqual([11.5, 11.5, 11.5]);
  await page.locator('#midiUndo').click();
  const undone = await page.evaluate(() => window.__E2E__.midiGetProject());
  expect({ ...undone, updatedAt: original.updatedAt }).toEqual(original);
  expect(undone.updatedAt).toBeGreaterThanOrEqual(original.updatedAt);
  await page.locator('#midiRedo').click();
  await expect(length).toHaveValue('11.5');
  const name = rows.first().locator('input[data-span-property=name]');
  await name.fill('Studio rise');
  await name.evaluate(input => { input.setSelectionRange(2, 6, 'backward'); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(name).toBeFocused();
  expect(await name.evaluate(input => [input.selectionStart, input.selectionEnd, input.selectionDirection])).toEqual([2, 6, 'backward']);
  await list.getByRole('combobox', { name: 'Selected spans Target', exact: true }).selectOption('pan');
  await list.getByRole('spinbutton', { name: 'Selected spans Start value', exact: true }).fill('-24');
  await list.getByRole('spinbutton', { name: 'Selected spans Start value', exact: true }).dispatchEvent('change');
  await list.getByRole('spinbutton', { name: 'Selected spans End value', exact: true }).fill('24');
  await list.getByRole('spinbutton', { name: 'Selected spans End value', exact: true }).dispatchEvent('change');
  await list.getByRole('button', { name: 'Bypass selected', exact: true }).click();
  await expect(rows.locator('details[open]')).toHaveCount(3);
  const edited = await page.evaluate(() => window.__E2E__.midiGetProject());
  expect(edited.automation.filter(entry => !entry.span)).toEqual(spatial);
  expect(edited.automation.filter(entry => entry.span).every(entry => entry.span.duration === 11.5 && entry.target === 'pan' && entry.min === -24 && entry.max === 24 && !entry.enabled)).toBe(true);
  expect(edited.automation.find(entry => entry.span).name).toBe('Studio rise');
  await expect(page.locator('#midiGameClock')).toHaveText(clock);
  await page.locator('#midiViewProject').click(); await page.locator('.midi-project-tools > summary').click(); await page.locator('#midiTemplateSaveButton').click();
  await expect(page.locator('#midiProjectStatus')).toContainText('Saved');
  await page.reload(); await waitForHarnessReady(page);
  expect((await page.evaluate(() => window.__E2E__.midiGetProject())).automation).toEqual(edited.automation);
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
  await page.locator('#midiViewExpert').click(); await page.locator('#midiModulationInspector > summary').click();
  const spatialRow = page.locator('#midiAutomationList [data-automation-id="' + spatial[0].id + '"]');
  await spatialRow.locator('.midi-span-editor > summary').click();
  await spatialRow.getByRole('button', { name: 'Create looping beat span', exact: true }).focus(); await page.keyboard.press('Enter');
  const converted = list.locator('[data-span-id="' + spatial[0].id + '"]');
  await expect(converted.locator('input[data-span-property=name]')).toBeFocused();
  await converted.getByRole('button', { name: 'Return to spatial curve', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(spatialRow.locator('select[data-automation-field=target]')).toBeFocused();
  expect((await page.evaluate(() => window.__E2E__.midiGetProject())).automation).toEqual(edited.automation);
  expect(await page.evaluate(() => window.__midiPermissionCalls)).toBe(0);
});


test('Studio saved span pages retain overflow entries and keyboard focus', { tag: '@boundary' }, async ({ page }) => {
  await page.goto('/?e2e=1&midi=1'); await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__.pause());
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
  await page.locator('#midiViewExpert').click(); await page.locator('#midiModulationInspector > summary').click();
  await page.locator('#midiSpanPresetApply').click();
  const before = await page.evaluate(() => {
    const payload = window.__E2E__.midiExportProject({ download: false });
    const base = payload.project.automation.find(entry => entry.span);
    payload.project.automation = Array.from({ length: 65 }, (_, index) => ({ ...base, id: 'saved-span-' + index, name: 'Saved ' + (index + 1), enabled: false }));
    return window.__E2E__.midiImportProject(payload).automation;
  });
  const list = page.locator('#midiMainSpanList'), rows = list.locator('.midi-span-row');
  await expect(rows).toHaveCount(64);
  const next = list.getByRole('button', { name: 'Next spans', exact: true });
  await next.focus(); await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(1);
  await expect(list.getByRole('button', { name: 'Previous spans', exact: true })).toBeFocused();
  await rows.first().getByRole('button', { name: 'Saved 65', exact: true }).click();
  const name = rows.first().locator('input[data-span-property=name]');
  await name.fill('Saved overflow'); await name.dispatchEvent('change'); await expect(name).toBeFocused();
  const edited = await page.evaluate(() => window.__E2E__.midiGetProject().automation);
  expect(edited).toHaveLength(65); expect(edited.slice(0, 64)).toEqual(before.slice(0, 64));
  expect(edited[64]).toEqual({ ...before[64], name: 'Saved overflow' });
  expect(await page.evaluate(() => window.__E2E__.midiGetRuntimeConfig().automationSpans)).toHaveLength(0);
  await page.locator('#midiViewProject').click(); await page.locator('.midi-project-tools > summary').click(); await page.locator('#midiTemplateSaveButton').click();
  await expect(page.locator('#midiProjectStatus')).toContainText('Saved');
  await page.reload(); await waitForHarnessReady(page);
  expect((await page.evaluate(() => window.__E2E__.midiGetProject())).automation).toEqual(edited);
  expect(await page.evaluate(() => window.__midiPermissionCalls)).toBe(0);
});
