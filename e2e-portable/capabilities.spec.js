import { expect, test } from './fixtures.js';
import { useWorkstationControl } from '../e2e/helpers/workstationChrome.js';

const ready = async page => {
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
};
const save = page => useWorkstationControl(page, page.locator('#procgenStudioFooter').getByRole('button', { name: 'Save', exact: true }), { button: 'Save' }, 'click');

test('a controlled unavailable canvas recovers the same admitted world through explicit display retry', async ({ page, nativeBrowser }, testInfo) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext; window.denyPortableDisplay = true;
    HTMLCanvasElement.prototype.getContext = function(...args) { return this.id === 'gameCanvas' && window.denyPortableDisplay ? null : getContext.apply(this, args); };
  });
  await ready(page);
  const before = await page.evaluate(() => {
    const lanes = window.__PROCGEN_LANES__, studio = window.__PROCGEN_STUDIO__; lanes.step(16);
    window.portableDisplayWorld = lanes.world; window.portableDisplayProject = studio.getProject();
    return { tick: lanes.world.tickIndex, renderer: lanes.renderer.getDisplayState() };
  });
  await expect(page.getByRole('button', { name: 'Retry display', exact: true })).toBeVisible();
  await page.evaluate(() => { window.denyPortableDisplay = false; }); await page.getByRole('button', { name: 'Retry display', exact: true }).click();
  await expect(page.locator('#gameCanvas')).toHaveAttribute('data-display-state', 'ready');
  const after = await page.evaluate(() => ({ sameWorld: window.portableDisplayWorld === window.__PROCGEN_LANES__.world, sameProject: window.portableDisplayProject === window.__PROCGEN_STUDIO__.getProject(),
    tick: window.__PROCGEN_LANES__.world.tickIndex, output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled, playing: window.__PROCGEN_STUDIO__.transport.getState().playing }));
  expect(after).toEqual({ sameWorld: true, sameProject: true, tick: before.tick, output: false, playing: false });
  await expect(page.getByRole('button', { name: 'Retry display', exact: true })).toBeHidden();
  await testInfo.attach('controlled-display-retry.json', { body: JSON.stringify({ browser: nativeBrowser.version(), before, after, fault: 'Controlled null gameCanvas context; native GPU failure is not claimed.' }, null, 2), contentType: 'application/json' });
});

test('worker construction failure keeps Save usable and refuses stored load before explicit retry', async ({ page, nativeBrowser }, testInfo) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker; window.blockPortableWorker = false; window.portableWorkerFailures = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        if (window.blockPortableWorker) { window.portableWorkerFailures.push(options?.name || 'unnamed'); throw new window.DOMException('Controlled worker construction failure', 'SecurityError'); }
        super(url, options);
      }
    };
  });
  await ready(page); await save(page);
  const dialog = page.getByRole('dialog', { name: 'Project name', exact: true });
  await dialog.getByRole('textbox').fill('Portable worker retry'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__.getDocumentState().revision === 1);
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { name: 'Retained worker retry source' } });
  });
  await page.waitForFunction(() => { const studio = window.__PROCGEN_STUDIO__, preference = studio.getPreferenceState(); return !preference.active && preference.durableRevision === studio.getDocumentState().editRevision; });
  await page.evaluate(() => { window.blockPortableWorker = true; }); await save(page);
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__.getDocumentState().revision === 2);
  const before = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { name: 'Unsaved worker-retained source' } });
    window.portableWorkerWorld = window.__PROCGEN_LANES__.world; window.portableWorkerProject = studio.getProject(); return studio.getDocumentState();
  });
  await useWorkstationControl(page, page.locator('#procgenStudioFooter').getByRole('button', { name: 'Load', exact: true }), { button: 'Load' }, 'click');
  const picker = page.getByRole('dialog', { name: 'Saved projects' }), choice = picker.getByRole('button', { name: /Portable worker retry/ });
  await choice.click();
  await expect(page.locator('.studio-status')).toContainText('Controlled worker construction failure');
  const failed = await page.evaluate(async id => {
    const { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js'), storage = createProcgenSessionStorage(indexedDB);
    let storedRevision; try { storedRevision = (await storage.listDocumentPage()).items.find(entry => entry.id === id)?.revision; } finally { await storage.close()?.completion; }
    const studio = window.__PROCGEN_STUDIO__; return { document: studio.getDocumentState(), storedRevision, failures: window.portableWorkerFailures,
      sameWorld: window.portableWorkerWorld === window.__PROCGEN_LANES__.world, sameProject: window.portableWorkerProject === studio.getProject() };
  }, before.id);
  expect(failed.failures).toContain('lemmings-background-recovery-checksum'); expect(failed.sameWorld).toBe(true); expect(failed.sameProject).toBe(true);
  expect(failed.document.revision).toBe(2); expect(failed.document.dirty).toBe(true); expect(failed.storedRevision).toBe(2);
  await page.evaluate(() => { window.blockPortableWorker = false; }); await choice.click();
  await page.waitForFunction(() => window.portableWorkerWorld !== window.__PROCGEN_LANES__.world && window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].name === 'Retained worker retry source');
  await expect(picker).toBeHidden();
  const after = await page.evaluate(() => ({ document: window.__PROCGEN_STUDIO__.getDocumentState(), laneName: window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].name,
    sameWorld: window.portableWorkerWorld === window.__PROCGEN_LANES__.world, playing: window.__PROCGEN_STUDIO__.transport.getState().playing, output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled }));
  expect(after.document.id).toBe(before.id); expect(after.document.revision).toBe(2); expect(after.document.dirty).toBe(false);
  expect(after.laneName).toBe('Retained worker retry source'); expect(after.sameWorld).toBe(false); expect(after.playing).toBe(false); expect(after.output).toBe(false);
  await testInfo.attach('controlled-worker-load-retry.json', { body: JSON.stringify({ browser: nativeBrowser.version(), before, failed, after,
    fault: 'Controlled constructor SecurityError in the load checksum worker. Native IndexedDB Save remains usable; no native worker-device failure claimed.' }, null, 2), contentType: 'application/json' });
});
