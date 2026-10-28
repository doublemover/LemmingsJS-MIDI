import { expect, test } from '@playwright/test';
import { installWebMidiStub } from './helpers/webmidiStub.js';

const ready = async (page, lanes = 8) => {
  await installWebMidiStub(page, { trackOutput: true });
  await page.goto(`/procgen.html?e2e=1&recipe=1&seed=42&lanes=${lanes}&output=midi`);
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
};
const activate = async page => { await page.locator('#procgenListen').click(); await page.locator('#procgenMidiDevice').selectOption('pw-output-1'); await page.locator('#procgenListen').click(); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true'); };
const ownerState = page => page.evaluate(async () => {
  const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js');
  const { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
  return { project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), physics: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(window.__PROCGEN_LANES__.world)), sent: window.__WEBMIDI_STUB__.metrics().sent };
});

test('desktop lane displays expose manual pages and complete text without changing project, world or MIDI', { tag: '@boundary' }, async ({ page }) => {
  await ready(page); await expect(page.locator('.studio-lane-display').first()).toBeVisible(); const before = await ownerState(page);
  await page.getByText('View actions', { exact: true }).click();
  for (const value of ['cause', 'parameter', 'output', 'identity']) { await page.getByLabel('Selected lane display page').selectOption(value); await expect(page.locator('.studio-lane-display').first()).toHaveAttribute('data-page', value); }
  await page.getByRole('button', { name: 'Read selected lane display', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Selected lane display details' }); await expect(dialog).toBeVisible(); await expect(dialog).toContainText('acoustic evidence unknown');
  const name = await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].name); await expect(dialog).toContainText(name);
  await expect(dialog.getByRole('button', { name: 'Panic', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Close lane display', exact: true }).click();
  expect(await ownerState(page)).toEqual(before);
  const geometry = await page.locator('.studio-lane-display').evaluateAll(nodes => nodes.map(node => { const rect = node.getBoundingClientRect(), header = node.closest('.studio-lane-header').getBoundingClientRect(); return { width: rect.width, height: rect.height, font: window.getComputedStyle(node).fontSize, fits: rect.left >= header.left && rect.right <= header.right && rect.bottom <= header.bottom }; }));
  expect(geometry.length).toBeGreaterThan(0); expect(geometry.length).toBeLessThanOrEqual(8); for (const row of geometry) { expect(row).toMatchObject({ height: 32, font: '11px', fits: true }); expect(row.width).toBeGreaterThanOrEqual(150); }
  expect(await page.evaluate(() => [window.innerWidth, window.innerHeight, document.documentElement.scrollWidth])).toEqual([1920, 1080, 1920]);
});

test('focused lane parameter drafts temporarily override a stable manual page and never replace the OLED nodes', { tag: '@boundary' }, async ({ page }) => {
  await ready(page, 2); await activate(page); await page.getByText('View actions', { exact: true }).click(); await page.getByLabel('Selected lane display page').selectOption('cause');
  await page.getByText('View actions', { exact: true }).click(); const before = await ownerState(page), display = page.locator('.studio-lane-display').first();
  await display.evaluate(element => { window.__laneDisplayNodes = [...element.children]; window.__laneDisplayMutations = []; window.__laneDisplayObserver = new MutationObserver(records => window.__laneDisplayMutations.push(...records.filter(record => record.type === 'childList').map(record => record.type))); window.__laneDisplayObserver.observe(element, { childList: true, subtree: true }); });
  const input = page.locator('.studio-lane-header').first().locator('.parameter-knob-number'); await input.fill('-'); await expect(display).toHaveAttribute('data-priority', 'edit'); await expect(display).toContainText('- · draft');
  await input.press('Escape'); await page.locator('.studio-lane-title').first().focus(); await expect(display).toHaveAttribute('data-page', 'cause'); await expect(display).toHaveAttribute('data-priority', 'ordinary');
  expect(await ownerState(page)).toEqual(before); expect(await display.evaluate(element => ({ stable: window.__laneDisplayNodes.every((node, index) => node === element.children[index]), mutations: window.__laneDisplayMutations.length }))).toEqual({ stable: true, mutations: 0 });
  await page.evaluate(() => window.__laneDisplayObserver.disconnect());
});

test('live physical lane evidence joins real recorded MIDI IDs and leaves receiver and acoustic evidence unknown', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await ready(page, 2); await activate(page);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.ports.configure({ recording: true }); window.__PROCGEN_LANES__.resume(); window.__PROCGEN_STUDIO__.play(); });
  const evidence = await page.waitForFunction(() => {
    const studio = window.__PROCGEN_STUDIO__, lanes = studio.getProject().procgen.lanes, displays = studio.handlers.laneDisplayState(lanes.map(lane => lane.id));
    const notes = studio.ports.getRecording().filter(row => row.intentId && (row.data[0] & 0xf0) === 0x90 && row.data[2] > 0);
    for (const display of displays) for (const event of display.evidence.record?.events || []) {
      if (!notes.some(note => note.intentId === event.intentId) || !event.receipts.some(receipt => receipt.stage === 'submitted')) continue;
      window.__PROCGEN_LANES__.pause(); studio.transport.pause(); return { event, note: notes.find(note => note.intentId === event.intentId), display };
    }
    return false;
  }, null, { timeout: 20000 });
  const value = await evidence.jsonValue(); await evidence.dispose(); expect(value.event.sources.some(source => source.recorded)).toBe(true); expect(value.event.intentId).toBe(value.note.intentId); expect(value.event.voiceId).toBe(value.note.voiceId); expect(value.event.intentId.startsWith(value.event.batchId + ':')).toBe(true);
  expect(value.event.receipts.some(receipt => receipt.stage === 'submitted' && receipt.targetTimeDomain === 'performance-microseconds')).toBe(true);
  await page.locator(`.studio-lane-header[data-lane-id="${value.display.lane.id}"] .studio-lane-title`).click();
  await page.getByText('View actions', { exact: true }).click(); await page.getByLabel('Selected lane display page').selectOption('output');
  await page.getByRole('button', { name: 'Read selected lane display', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Selected lane display details' });
  await expect(dialog).toContainText('receiver unknown'); await expect(dialog).toContainText('acoustic evidence unknown'); await dialog.getByRole('button', { name: 'Panic', exact: true }).click();
});
