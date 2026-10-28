import { inspectLane } from './helpers/workstationDock.js';
import { expect, test } from '@playwright/test';
import { installWebMidiStub } from './helpers/webmidiStub.js';

const ready = async page => {
  await installWebMidiStub(page, { outputCount: 2, trackOutput: true });
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2&output=midi');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.locator('#procgenListen').click(); await page.locator('#procgenMidiDevice').selectOption('pw-output-1'); await page.locator('#procgenListen').click();
  await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true');
  await inspectLane(page, 'MIDI');
};
const sustainOn = page => page.evaluate(() => window.__WEBMIDI_STUB__.metrics().messages.filter(message => (message.bytes[0] & 240) === 176 && message.bytes[1] === 64 && message.bytes[2] === 127).length);

test('signed channel requests send exact bytes while invalid entries and readout redraws leave the project and paused world unchanged', { tag: '@boundary' }, async ({ page }) => {
  await ready(page);
  const state = () => page.evaluate(async () => {
    const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js');
    const { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
    return { project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), hash: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(window.__PROCGEN_LANES__.world)) };
  });
  const before = await state();
  for (const [label, value] of [['Pitch bend', '-8192'], ['Pressure', '127'], ['Sustain', '0']]) { const input = page.getByLabel(label, { exact: true }); await input.fill(value); await input.press('Enter'); await expect(input).toHaveValue(value); }
  const messages = await page.evaluate(() => window.__WEBMIDI_STUB__.metrics().messages.map(message => message.bytes));
  expect(messages).toContainEqual([224, 0, 0]); expect(messages).toContainEqual([208, 127]); expect(messages).toContainEqual([176, 64, 0]);
  const count = await page.evaluate(() => window.__WEBMIDI_STUB__.metrics().sent), pressure = page.getByLabel('Pressure', { exact: true });
  await pressure.fill('128'); await pressure.press('Enter'); await expect(pressure).toHaveAttribute('aria-invalid', 'true'); await pressure.press('Escape'); await expect(pressure).toHaveValue('127');
  expect(await page.evaluate(() => window.__WEBMIDI_STUB__.metrics().sent)).toBe(count); expect(await state()).toEqual(before);
});

test('MIDI requests retain exact values through rerenders, inspector pages, first Save and inactive-device/input changes', { tag: '@boundary' }, async ({ page }) => {
  await ready(page); const sustain = () => page.getByLabel('Sustain', { exact: true }); await expect(sustain()).toHaveValue('');
  await sustain().fill('127'); await sustain().press('Enter'); await expect(page.getByLabel('Sustain request evidence')).toContainText('Last request 127; API submission 127 accepted');
  expect(await sustainOn(page)).toBe(1); await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__; studio.dispatch({ type: 'procgen/lane', laneId: studio.state.laneId, patch: { name: 'Retained request' } }); studio.handlers.input('pw-input-1'); });
  await expect(sustain()).toHaveValue('127'); await page.locator('.studio-inspector').getByRole('tab', { name: 'Lane', exact: true }).click(); await page.locator('.studio-inspector').getByRole('tab', { name: 'MIDI', exact: true }).click(); await expect(sustain()).toHaveValue('127');
  await page.evaluate(() => window.__WEBMIDI_STUB__.disconnectOutput('pw-output-2')); await expect(sustain()).toHaveValue('127'); expect(await sustainOn(page)).toBe(1);
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Save', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Project name', exact: true }); await modal.getByRole('textbox', { name: 'Project name', exact: true }).fill('MIDI request owner'); await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(modal).toHaveCount(0); await expect.poll(() => page.evaluate(() => { const value = window.__PROCGEN_STUDIO__.getDocumentState(); return { id: value.id, dirty: value.dirty }; })).toEqual({ id: expect.any(String), dirty: false });
  await expect(sustain()).toHaveValue('127'); expect(await sustainOn(page)).toBe(1); await expect(page.getByLabel('Sustain request evidence')).toContainText('receiver state unknown');
});

test('endpoint reuse and a stale pre-route input never imply a receiver reset or dispatch the old request to the new route', { tag: '@boundary' }, async ({ page }) => {
  await ready(page); const sustain = () => page.getByLabel('Sustain', { exact: true }); await sustain().fill('127'); await sustain().press('Enter');
  await sustain().fill('42'); await page.evaluate(() => { window.__OLD_EXPRESSION_INPUT__ = document.querySelector('.studio-midi-expression input'); });
  await page.locator('#procgenMidiDevice').selectOption('pw-output-2'); await expect(sustain()).toHaveValue('');
  const before = await page.evaluate(() => window.__WEBMIDI_STUB__.metrics().sent);
  await page.evaluate(() => { const input = window.__OLD_EXPRESSION_INPUT__; input.value = '0'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(await page.evaluate(() => window.__WEBMIDI_STUB__.metrics().sent)).toBe(before); await expect(page.getByLabel('Sustain request evidence')).toContainText('No request observed');
  await page.locator('#procgenMidiDevice').selectOption('pw-output-1'); await page.locator('#procgenListen').click(); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true'); await expect(sustain()).toHaveValue('');
  expect(await sustainOn(page)).toBe(1); await page.evaluate(() => window.__WEBMIDI_STUB__.disconnectOutput('pw-output-1')); await expect(sustain()).toHaveValue('');
  await page.evaluate(() => window.__WEBMIDI_STUB__.reconnectOutput('pw-output-1')); await expect(sustain()).toHaveValue(''); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false');
});

test('an explicit offline request keeps its accepted text baseline while submission and receiver state remain unconfirmed', { tag: '@boundary' }, async ({ page }) => {
  await ready(page); await page.evaluate(() => window.__WEBMIDI_STUB__.disconnectOutput('pw-output-1'));
  const sustain = page.getByLabel('Sustain', { exact: true }); await expect(sustain).toHaveValue('');
  const before = await page.evaluate(() => window.__WEBMIDI_STUB__.metrics().sent);
  await sustain.fill('0'); await sustain.press('Enter'); await expect(page.getByLabel('Sustain request evidence')).toContainText('Last request 0; submission unconfirmed; receiver state unknown');
  await sustain.fill('42'); await sustain.press('Escape'); await expect(sustain).toHaveValue('0');
  await page.locator('.studio-inspector').getByRole('tab', { name: 'Lane', exact: true }).click(); await page.locator('.studio-inspector').getByRole('tab', { name: 'MIDI', exact: true }).click();
  await expect(page.getByLabel('Sustain', { exact: true })).toHaveValue('0'); expect(await page.evaluate(() => window.__WEBMIDI_STUB__.metrics().sent)).toBe(before);
});
