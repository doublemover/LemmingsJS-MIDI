import { expect, test } from './helpers/workstationValidation.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { useWorkstationControl } from './helpers/workstationChrome.js';

const ready = async (page, suffix = '') => {
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2' + suffix);
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
};
const saveName = async (page, name) => {
  const dialog = page.getByRole('dialog', { name: 'Project name', exact: true }); await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill(name); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
};

test('native storage fault survives bounded status spam, supports dismissal and resolves only after a durable Save', { tag: ['@boundary', '@workstation-save-cancel'] }, async ({ page }, info) => {
  test.setTimeout(90000); await ready(page);
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, put = window.IDBObjectStore.prototype.put;
    window.noticeProbe = { fail: true, changes: [], world: window.__PROCGEN_LANES__.world, project: studio.getProject() };
    window.IDBObjectStore.prototype.put = function(value, ...args) { if (window.noticeProbe.fail && this.name === 'sessions' && value?.kind === 'document') throw new window.DOMException('Injected notice quota refusal', 'QuotaExceededError'); return put.call(this, value, ...args); };
    window.noticeProbe.save = studio.handlers.save();
  });
  await saveName(page, 'Notice source'); expect(await page.evaluate(() => window.noticeProbe.save)).toBe(false);
  await expect(page.locator('.studio-status')).toContainText('Project save failed');
  const contrast = await page.locator('.studio-status').evaluate(element => {
    const channels = color => color.match(/[\d.]+/g).map(Number), luminance = rgb => rgb.slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const ink = luminance(channels(window.getComputedStyle(element).color)); let parent = element, background = null;
    while (parent) { const values = channels(window.getComputedStyle(parent).backgroundColor); if (values.length === 3 || values[3] === 1) { background = luminance(values); break; } parent = parent.parentElement; }
    return background == null ? null : (Math.max(ink, background) + .05) / (Math.min(ink, background) + .05);
  }); expect(contrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: info.outputPath('desktop-critical-notice.png') });
  const spam = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, message = document.querySelector('.studio-status'), changes = [], observer = new MutationObserver(() => changes.push(message.textContent)); observer.observe(message, { subtree: true, childList: true, characterData: true });
    for (let index = 0; index < 2048; index++) studio.handlers.status('MIDI status event ' + index);
    await Promise.resolve(); observer.disconnect(); return { changes, state: studio.getNoticeState(), sameWorld: window.__PROCGEN_LANES__.world === window.noticeProbe.world, sameProject: studio.getProject() === window.noticeProbe.project };
  });
  expect(spam.changes).toHaveLength(0); expect(spam.state.entries).toHaveLength(32); expect(spam.state.headline.code).toBe('storage-error'); expect(spam).toMatchObject({ sameWorld: true, sameProject: true });
  const history = page.getByRole('region', { name: 'Project and output notices' }); await history.locator('summary').filter({ hasText: 'Notice history' }).click();
  const fault = history.locator('li').filter({ hasText: 'Project save failed' }); await expect(fault).toHaveCount(1);
  await fault.getByRole('button', { name: 'Dismiss notice', exact: true }).click();
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getOperationalSnapshot().blockedReason.code)).toBe('storage-error');
  await fault.getByRole('button', { name: 'Show notice', exact: true }).click(); await expect(page.locator('.studio-status')).toContainText('Project save failed');
  await page.evaluate(() => { window.noticeProbe.fail = false; window.noticeProbe.save = window.__PROCGEN_STUDIO__.handlers.save(); }); await saveName(page, 'Notice source'); expect(await page.evaluate(() => window.noticeProbe.save)).toBe(true);
  await expect(page.locator('.studio-status')).toContainText('Saved Notice source');
  const settled = await page.evaluate(() => ({ notices: window.__PROCGEN_STUDIO__.getNoticeState(), document: window.__PROCGEN_STUDIO__.getDocumentState() }));
  expect(settled.document).toMatchObject({ revision: 1, dirty: false }); expect(settled.notices.entries.some(entry => entry.code === 'storage-error' && entry.active)).toBe(false);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getOperationalSnapshot().conditions.some(condition => condition.code === 'storage-error'))).toBe(false);
  await info.attach('native-notice-priority', { body: JSON.stringify({ contrast, spam, settled }), contentType: 'application/json' });
});

test('native File cancellation and dialog Escape/close retire only the current operation and preserve focus and Panic', { tag: ['@boundary', '@workstation-import-refusal'] }, async ({ page }, info) => {
  test.setTimeout(90000); await ready(page);
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, file = new File([JSON.stringify(studio.capture())], 'held-native-source.json'), nativeRead = file.text.bind(file);
    window.operationProbe = { world: window.__PROCGEN_LANES__.world, project: studio.getProject() };
    Object.defineProperty(file, 'stream', { value: undefined }); Object.defineProperty(file, 'text', { value: async () => { const text = await nativeRead(); window.operationProbe.entered = true; await new Promise(resolve => { window.operationProbe.release = resolve; }); return text; } }); window.operationProbe.reading = studio.handlers.import(file);
  });
  await page.waitForFunction(() => window.operationProbe.entered); const operation = page.locator('[data-operation-id][data-kind=import]'); await expect(operation).toBeVisible(); await expect(operation).toHaveAttribute('data-phase', 'validating');
  await expect(operation.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow'); await expect(page.locator('#procgenPanic')).toBeEnabled();
  const id = await operation.getAttribute('data-operation-id'); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.cancelOperation('stale-id'))).toBe(false);
  await operation.getByRole('button', { name: 'Cancel import operation' }).click(); expect(await page.evaluate(() => window.operationProbe.reading)).toBe(false);
  await page.evaluate(() => window.operationProbe.release()); await expect(page.locator('[data-operation-id]')).toHaveCount(0);
  const dialogs = [];
  for (const close of ['escape', 'native-close', 'button']) {
    const focus = page.locator('#procgenStudioFooter').getByRole('button', { name: 'Save', exact: true }); await focus.focus(); await page.evaluate(() => { window.operationProbe.listing = window.__PROCGEN_STUDIO__.handlers.load(); });
    const dialog = page.getByRole('dialog', { name: 'Saved projects', exact: true }); await expect(dialog).toBeVisible();
    if (close === 'escape') await page.keyboard.press('Escape'); else if (close === 'native-close') await dialog.evaluate(element => element.close()); else await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).not.toBeVisible(); await expect(focus).toBeFocused(); await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getOperationState())).toBe(null); dialogs.push(close);
  }
  const result = await page.evaluate(() => ({ sameWorld: window.__PROCGEN_LANES__.world === window.operationProbe.world, sameProject: window.__PROCGEN_STUDIO__.getProject() === window.operationProbe.project, operation: window.__PROCGEN_STUDIO__.getOperationState() }));
  expect(result).toEqual({ sameWorld: true, sameProject: true, operation: null }); await info.attach('native-operation-cancel', { body: JSON.stringify({ id, dialogs, ...result }), contentType: 'application/json' });
});

test('an actual MIDI disconnect stays above successful project Save and an expired recovery action cannot retarget', { tag: '@boundary' }, async ({ page }, info) => {
  test.setTimeout(90000); await installWebMidiStub(page, { trackOutput: true }); await ready(page, '&output=midi');
  await page.locator('#procgenListen').click(); await useWorkstationControl(page, page.locator('#procgenMidiDevice'), {}, 'selectOption', 'pw-output-1'); await page.locator('#procgenListen').click();
  await page.evaluate(() => window.__WEBMIDI_STUB__.disconnectOutput('pw-output-1')); await expect(page.locator('.studio-status')).toContainText('selected MIDI destination is unavailable');
  await page.evaluate(() => { window.noticeSave = window.__PROCGEN_STUDIO__.handlers.save(); }); await saveName(page, 'Saved while MIDI absent'); expect(await page.evaluate(() => window.noticeSave)).toBe(true);
  await expect(page.locator('.studio-status')).toContainText('selected MIDI destination is unavailable');
  const history = page.getByRole('region', { name: 'Project and output notices' }); await history.locator('summary').filter({ hasText: 'Notice history' }).click();
  const fault = history.locator('li').filter({ hasText: 'selected MIDI destination is unavailable' }); await expect(fault).toHaveCount(1);
  await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__, lane = studio.getProject().procgen.lanes[0]; studio.dispatch({ type: 'procgen/lane', laneId: lane.id, patch: { gain: .75 } }); });
  await fault.getByRole('button', { name: 'Review MIDI destination', exact: true }).click(); await expect(fault).toContainText('earlier state');
  const result = await page.evaluate(() => ({ notices: window.__PROCGEN_STUDIO__.getNoticeState(), document: window.__PROCGEN_STUDIO__.getDocumentState(), metrics: window.__WEBMIDI_STUB__.metrics() }));
  expect(result.document).toMatchObject({ revision: 1, dirty: true }); expect(result.notices.headline.code).toBe('output-lost'); expect(result.metrics.messages.filter(message => (message.bytes[0] & 240) === 144 && message.bytes[2] > 0)).toHaveLength(0);
  await info.attach('native-output-notice-recovery', { body: JSON.stringify(result), contentType: 'application/json' });
});
