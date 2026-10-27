import { expect, test } from '@playwright/test';
import { installWebMidiStub } from './helpers/webmidiStub.js';

const ready = async (page, suffix = '') => {
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=8' + suffix);
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
};
const strip = page => page.getByRole('region', { name: 'World, music and output status', exact: true });
const metrics = page => page.evaluate(() => window.__WEBMIDI_STUB__.metrics());
const projectWorldState = page => page.evaluate(async () => {
  const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js');
  const { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
  return { project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), hash: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(window.__PROCGEN_LANES__.world)), id: window.__PROCGEN_STUDIO__.getDocumentState().id };
});

test('desktop status separates world/music/output, keeps blockers and Panic visible and reveals exact timing details', { tag: '@boundary' }, async ({ page }) => {
  await installWebMidiStub(page, { trackOutput: true }); await ready(page);
  const status = strip(page); await expect(status).toBeVisible(); await expect(status).toContainText('Music stopped'); await expect(status).toContainText('Browser output is off');
  await expect(page.locator('#procgenPanic')).toBeVisible(); await expect(page.locator('#procgenListen')).toBeVisible();
  expect(await metrics(page)).toMatchObject({ requests: 0, sent: 0 });
  await status.getByText('Status details', { exact: true }).click(); await expect(status).toContainText('base BPM'); await expect(status).toContainText('effective BPM'); await expect(status).toContainText('Display refresh is not a simulation measurement');
  await expect(status).toContainText('Requested 3×');
  await expect(status).toContainText('connected port is not a heartbeat'); await expect(status).toContainText('acoustic');
  const geometry = await page.locator('#procgenPanic').evaluate(element => { const rect = element.getBoundingClientRect(); return { width: window.innerWidth, height: window.innerHeight, visible: rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight }; });
  expect(geometry).toEqual({ width: 1920, height: 1080, visible: true }); expect(await metrics(page)).toMatchObject({ requests: 0, sent: 0 });
  await page.screenshot({ path: test.info().outputPath('desktop-operational-status.png') });
});

test('MIDI first use discovers two same-name destinations without activation, preserves explicit identity and never rearms on reconnect', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(90000); await installWebMidiStub(page, { outputCount: 2, sameOutputName: true, trackOutput: true, reverseOutputs: true });
  await ready(page, '&output=midi');
  expect(await metrics(page)).toMatchObject({ requests: 0, sent: 0 }); await page.locator('#procgenListen').click();
  await expect(strip(page)).toContainText('Choose a named destination'); await expect(page.locator('#procgenMidiDevice')).toHaveValue(''); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false');
  expect(await metrics(page)).toMatchObject({ requests: 1, sent: 0 });
  await expect(page.locator('#procgenMidiDevice').getByRole('option', { name: 'Identical keyboard · pw-output-1', exact: true })).toHaveCount(1);
  await page.locator('#procgenMidiDevice').selectOption('pw-output-1'); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false'); expect((await metrics(page)).sent).toBe(0);
  await page.locator('#procgenListen').click(); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true'); await expect(strip(page)).toHaveAttribute('data-note-output-state', 'active');
  const activated = await metrics(page); expect(activated.messages.filter(message => (message.bytes[0] & 240) === 144 && message.bytes[2] > 0)).toHaveLength(0);
  await page.evaluate(() => window.__WEBMIDI_STUB__.disconnectOutput('pw-output-2')); expect((await metrics(page)).sent).toBe(activated.sent); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.__WEBMIDI_STUB__.disconnectOutput('pw-output-1')); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false'); await expect(strip(page)).toContainText('unavailable');
  const stopped = await metrics(page); await page.evaluate(() => window.__WEBMIDI_STUB__.reconnectOutput('pw-output-1', 'Identical keyboard'));
  await expect(page.locator('#procgenMidiDevice')).toHaveValue('pw-output-1'); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false'); expect((await metrics(page)).sent).toBe(stopped.sent);
  expect(Object.keys((await metrics(page)).outputs)).not.toContain('pw-output-2');
});

test('denied MIDI permission names the blocker without a fake lost-port state or browser fallback', { tag: '@boundary' }, async ({ page }) => {
  await installWebMidiStub(page, { permission: 'denied', trackOutput: true }); await ready(page, '&output=midi'); await page.locator('#procgenListen').click();
  await expect(strip(page)).toContainText('permission was denied'); await expect(page.locator('#procgenOutput')).toHaveValue('midi'); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false');
  expect(await metrics(page)).toMatchObject({ requests: 1, sent: 0 });
});

test('an empty MIDI catalog explains silence after explicit discovery and never activates a fallback', { tag: '@boundary' }, async ({ page }) => {
  await installWebMidiStub(page, { withDevices: false, trackOutput: true }); await ready(page, '&output=midi');
  await page.locator('#procgenListen').click(); await expect(strip(page)).toContainText('No MIDI outputs discovered');
  await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false'); await expect(page.locator('#procgenOutput')).toHaveValue('midi');
  expect(await metrics(page)).toMatchObject({ requests: 1, sent: 0 });
});

test('native dialogs keep canonical Panic reachable without saving drafts or rearming a reconnected endpoint', { tag: '@boundary' }, async ({ page }) => {
  await installWebMidiStub(page, { trackOutput: true }); await ready(page, '&output=midi');
  await page.locator('#procgenListen').click(); await page.locator('#procgenMidiDevice').selectOption('pw-output-1'); await page.locator('#procgenListen').click();
  await expect(strip(page)).toHaveAttribute('data-note-output-state', 'active');
  const before = await projectWorldState(page);
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Save', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Project name', exact: true }), name = modal.getByRole('textbox', { name: 'Project name', exact: true });
  await name.fill('Unsaved live draft'); await modal.getByRole('button', { name: 'Panic', exact: true }).click();
  await expect(modal).toBeVisible(); await expect(name).toHaveValue('Unsaved live draft'); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false');
  await modal.getByRole('button', { name: 'Stop music', exact: true }).click();
  await page.evaluate(() => { window.__WEBMIDI_STUB__.disconnectOutput(); window.__WEBMIDI_STUB__.reconnectOutput(); });
  await expect(modal).toBeVisible(); await expect(name).toHaveValue('Unsaved live draft');
  const after = await projectWorldState(page);
  expect(after).toEqual(before); await expect(page.locator('#procgenMidiDevice')).toHaveValue('pw-output-1'); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false');
  expect((await metrics(page)).messages.filter(message => (message.bytes[0] & 240) === 144 && message.bytes[2] > 0)).toHaveLength(0);
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(modal).toHaveCount(0);
});

test('paused controller evidence refreshes independently of the activated note route and internal clock', { tag: '@boundary' }, async ({ page }) => {
  await installWebMidiStub(page, { trackOutput: true }); await ready(page, '&output=midi');
  await page.locator('#procgenListen').click(); await page.locator('#procgenMidiDevice').selectOption('pw-output-1'); await page.locator('#procgenListen').click();
  await expect(strip(page)).toHaveAttribute('data-note-output-state', 'active');
  const before = await metrics(page); await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__; studio.handlers.input('pw-input-1'); studio.ports.configure({ activeSensingVisibility: 'filtered' }); });
  await expect(strip(page)).toHaveAttribute('data-state', 'controller-observation'); await expect(strip(page)).toHaveAttribute('data-note-output-state', 'active'); await expect(strip(page)).toHaveAttribute('data-clock-state', 'internal');
  await strip(page).getByText('Status details', { exact: true }).click(); await expect(strip(page)).toContainText('active-sensing-filtered');
  await page.evaluate(() => window.__PROCGEN_STUDIO__.ports.configure({ activeSensingVisibility: 'observable' }));
  await expect(strip(page)).toContainText('liveness unobserved'); await expect(strip(page)).not.toHaveAttribute('data-state', 'controller-observation');
  expect((await metrics(page)).sent).toBe(before.sent);
});
