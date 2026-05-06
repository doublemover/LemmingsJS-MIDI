import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { MidiUiPage } from './helpers/pageObjects.js';

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
});

const openMidiUi = async (page, path = '/') => {
  const midi = new MidiUiPage(page);
  await midi.goto(path);
  return midi;
};

test('MIDI UI starts disabled and hides panels', async ({ page }) => {
  const midi = await openMidiUi(page);
  await expect(page.locator('body')).toHaveClass(/midi-disabled/);
  await expect(midi.enabledToggle()).not.toBeChecked();
  await expect(midi.controlRight()).toBeHidden();
});

test('Enabling MIDI reveals panels and inputs', async ({ page }) => {
  const midi = await openMidiUi(page);
  await midi.enable();
  await expect(page.locator('body')).not.toHaveClass(/midi-disabled/);
  await expect(midi.controlRight()).toBeVisible();
  const inputState = await page.evaluate(() => {
    const input = document.getElementById('midiInSelect');
    const output = document.getElementById('midiOutSelect');
    const error = document.getElementById('errorDisplay');
    return {
      inputDisabled: input?.disabled ?? null,
      outputDisabled: output?.disabled ?? null,
      inputLabel: input?.options?.[0]?.textContent ?? '',
      outputLabel: output?.options?.[0]?.textContent ?? '',
      errorText: error?.textContent ?? ''
    };
  });
  if (inputState.inputDisabled) {
    expect(inputState.inputLabel).toContain('No input');
    expect(inputState.errorText).toContain('No input device');
  } else {
    await expect(page.locator('#midiInSelect')).toBeEnabled();
  }
  if (inputState.outputDisabled) {
    expect(inputState.outputLabel).toContain('No output');
    expect(inputState.errorText).toContain('No output device');
  } else {
    await expect(page.locator('#midiOutSelect')).toBeEnabled();
  }
});

test('MIDI panels render expected layout and tab content', async ({ page }) => {
  const midi = await openMidiUi(page);
  await midi.enable();
  await midi.eventDetails().first().waitFor();
  const leftPanel = page.locator('#controlLeft');
  const rightPanel = midi.controlRight();
  await expect(leftPanel).toBeVisible();
  await expect(rightPanel).toBeVisible();

  const bounds = await Promise.all([
    leftPanel.boundingBox(),
    rightPanel.boundingBox()
  ]);
  const leftBounds = bounds[0];
  const rightBounds = bounds[1];
  expect(leftBounds).not.toBeNull();
  expect(rightBounds).not.toBeNull();
  expect(rightBounds.x).toBeGreaterThan(leftBounds.x + 200);
  expect(leftBounds.height).toBeGreaterThan(200);
  expect(rightBounds.height).toBeGreaterThan(200);

  const eventDetailsCount = await page.locator('#midiEventList details').count();
  expect(eventDetailsCount).toBeGreaterThan(0);
  await expect(page.locator('#midiEventList summary .panel-title-text').first()).toContainText('#');
  await midi.tabButton('midiTabTriggers').click();
  await expect(page.locator('#midiTabTriggers')).toHaveClass(/active/);
  const triggerDetailsCount = await page.locator('#midiTriggerList details').count();
  expect(triggerDetailsCount).toBeGreaterThan(0);
  await midi.tabButton('midiTabAdsr').click();
  await expect(page.locator('#midiTabAdsr')).toHaveClass(/active/);
  await expect(page.locator('#midiEnvAttack')).toBeVisible();
  await expect(page.locator('#midiEnvRelease')).toBeVisible();
  await midi.tabButton('midiTabGlobalFx').click();
  await expect(page.locator('#midiTabGlobalFx')).toHaveClass(/active/);
  await expect(page.locator('#midiIntensity')).toBeVisible();
  await expect(page.locator('#midiAccent')).toBeVisible();
});

test('MIDI event and trigger titles render with width', async ({ page }) => {
  const midi = await openMidiUi(page);
  await midi.enable();
  await midi.eventDetails().first().waitFor();
  await expect(midi.controlRight()).toBeVisible();
  await page.waitForSelector('#midiTabEvents #midiEventList summary .panel-title-text', { state: 'visible' });
  const eventTitle = page.locator('#midiTabEvents #midiEventList summary .panel-title-text').first();
  await expect(eventTitle).toContainText('#');
  const eventWidth = await eventTitle.evaluate(el => el.getBoundingClientRect().width);
  expect(eventWidth).toBeGreaterThan(1);
  await midi.tabButton('midiTabTriggers').click();
  await page.waitForSelector('#midiTabTriggers #midiTriggerList summary .panel-title-text', { state: 'visible' });
  const triggerTitle = page.locator('#midiTabTriggers #midiTriggerList summary .panel-title-text').first();
  await expect(triggerTitle).toContainText('#');
  const triggerWidth = await triggerTitle.evaluate(el => el.getBoundingClientRect().width);
  expect(triggerWidth).toBeGreaterThan(1);
});

test('MIDI event list excludes unknown-0B', async ({ page }) => {
  const midi = await openMidiUi(page);
  await midi.enable();
  await midi.eventDetails().first().waitFor();
  await expect(page.locator('#midiEventList')).not.toContainText('unknown-0B');
});

test('MIDI panels warn when scrolling is required', async ({ page }, testInfo) => {
  const midi = await openMidiUi(page);
  await midi.enable();
  const selectors = ['#controlLeft', '#controlRight'];
  for (const selector of selectors) {
    const metrics = await page.evaluate((sel) => {
      const panel = document.querySelector(sel);
      if (!panel) return null;
      const styles = window.getComputedStyle(panel);
      const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
      return {
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        scrollWidth: panel.scrollWidth,
        clientWidth: panel.clientWidth,
        paddingX: paddingLeft + paddingRight
      };
    }, selector);
    if (!metrics) continue;
    expect(metrics.scrollWidth).toBeLessThanOrEqual(
      metrics.clientWidth + metrics.paddingX + 2
    );
    if (metrics.scrollHeight > metrics.clientHeight + 2) {
      testInfo.annotations.push({
        type: 'warning',
        description: `${selector} requires scrolling at default size.`
      });
    }
  }
});

test('Canvas interaction clears focused MIDI inputs', async ({ page }) => {
  const midi = await openMidiUi(page);
  await midi.enable();
  const bpmInput = page.locator('#midiBpmBase');
  await bpmInput.focus();
  await expect(bpmInput).toBeFocused();
  const canvas = page.locator('#gameCanvas');
  await canvas.click({ position: { x: 20, y: 20 }, force: true });
  await expect(bpmInput).not.toBeFocused();
});

test('Expressive MIDI controls expose keyboard editing, arp patterns, and preview hooks', async ({ page }) => {
  const midi = await openMidiUi(page);
  await midi.enable();
  await midi.eventDetails().first().waitFor();
  await midi.openFirstEventDetails();
  const result = await page.evaluate(() => {
    const api = window.__LEMMINGS_MIDI_UI__;
    const details = document.querySelector('#midiEventList details');
    if (!api || !details) {
      return { ok: false, reason: 'missing-api-or-details' };
    }
    details.open = true;
    const summaryText = details.querySelector('summary')?.textContent || '';
    const match = summaryText.match(/#(\d+)/);
    const id = match ? match[1] : null;
    if (!id) {
      return { ok: false, reason: 'missing-id' };
    }
    const rows = Array.from(details.querySelectorAll('label'));
    const rowByLabel = (label) => rows.find(row => row.querySelector('span')?.textContent?.trim() === label) || null;
    const modeSelect = rowByLabel('Mode')?.querySelector('select');
    if (modeSelect) {
      modeSelect.value = 'note';
      modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const keyboardRow = rowByLabel('Keyboard');
    const keyButtons = Array.from(keyboardRow?.querySelectorAll('.midi-note-key') || []);
    if (keyButtons[7]) {
      keyButtons[7].click();
    }
    const arpPresetRow = rowByLabel('Arp preset');
    const downPresetButton = Array.from(arpPresetRow?.querySelectorAll('button') || [])
      .find(button => button.dataset?.value === 'down');
    const arpToggle = rowByLabel('Arp')?.querySelector('input[type="checkbox"]');
    if (arpToggle) {
      arpToggle.checked = true;
      arpToggle.dispatchEvent(new Event('change', { bubbles: true }));
    }
    downPresetButton?.click();
    const previewButton = rowByLabel('Preview')?.querySelector('button');
    previewButton?.click();
    const overrides = api.getIntentState?.()?.overrides || {};
    const mappedEntry = overrides?.sfx?.[id] || null;
    const previewResult = api.auditionMapping?.({ targetKey: 'sfx', id }) ?? null;
    return {
      ok: true,
      keyButtonCount: keyButtons.length,
      keyButtonsHaveLabels: keyButtons.every(button => !!button.getAttribute('aria-label')),
      mappedNote: mappedEntry?.note ?? null,
      arpPreset: mappedEntry?.arp?.pattern?.preset ?? null,
      previewResultType: typeof previewResult
    };
  });

  expect(result.ok).toBe(true);
  expect(result.keyButtonCount).toBe(12);
  expect(result.keyButtonsHaveLabels).toBe(true);
  expect((result.mappedNote ?? 0) % 12).toBe(7);
  expect(result.arpPreset).toBe('down');
  expect(result.previewResultType).toBe('boolean');
});

test('Expressive controls keep mobile layout parity', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const midi = await openMidiUi(page);
  await midi.enable();
  await midi.eventDetails().first().waitFor();
  await midi.openFirstEventDetails();
  const metrics = await page.evaluate(() => {
    const right = document.getElementById('controlRight');
    const details = document.querySelector('#midiEventList details');
    details?.setAttribute?.('open', '');
    details.open = true;
    const keyboardRow = Array.from(details?.querySelectorAll('label') || [])
      .find(row => row.querySelector('span')?.textContent?.trim() === 'Keyboard');
    return {
      keyboardVisible: !!keyboardRow,
      panelScrollWidth: right?.scrollWidth ?? 0,
      panelClientWidth: right?.clientWidth ?? 0
    };
  });
  expect(metrics.keyboardVisible).toBe(true);
  expect(metrics.panelScrollWidth).toBeLessThanOrEqual(metrics.panelClientWidth + 80);
});
