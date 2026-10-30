import { expect, test } from '@playwright/test';
import { useWorkstationControl } from './helpers/workstationChrome.js';

async function corruptStoredPreferences(page, corruption) {
  await page.evaluate(async corruption => {
    const { RECOVERY_DATABASE_NAME, RECOVERY_DATABASE_VERSION } = await import('/js/runtime/BrowserGenerationPins.js');
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open(RECOVERY_DATABASE_NAME, RECOVERY_DATABASE_VERSION); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite'), store = tx.objectStore('sessions'), head = store.get('preferences:head');
        head.onsuccess = () => {
          const root = store.get('preferences:slot:' + head.result.slot);
          root.onsuccess = () => { if (corruption === 'page') store.delete(root.result.references[0].key); else { root.result.layout.schema = 'corrupt'; store.put(root.result); } };
        }; tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, corruption);
}

async function bootSavedPreferences(page) {
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause(); studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { name: 'Saved source' } }); });
  await page.waitForFunction(() => { const studio = window.__PROCGEN_STUDIO__, state = studio.getPreferenceState(); return state?.pendingRevision == null && state.durableRevision === studio.getDocumentState().editRevision; });
}

test('an owned saved-project load cancels an in-flight native preference worker and resumes current preferences', { tag: ['@boundary', '@workstation-storage'] }, async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker; window.preferenceOverlap = { armed: false, blocked: 0, terminated: 0 };
    window.Worker = class extends NativeWorker {
      postMessage(message, ...options) {
        if (window.preferenceOverlap.armed && message?.type === 'input-start' && message.kind === 'encode-preference-pages') {
          window.preferenceOverlap.armed = false; window.preferenceOverlap.blocked++; this.blockedPreference = true; return;
        }
        return super.postMessage(message, ...options);
      }
      terminate() { if (this.blockedPreference) { this.blockedPreference = false; window.preferenceOverlap.terminated++; } return super.terminate(); }
    };
  });
  await bootSavedPreferences(page);
  await useWorkstationControl(page, page.locator('#procgenStudioFooter').getByRole('button', { name: 'Save', exact: true }), { button: 'Save' }, 'click');
  const naming = page.getByRole('dialog', { name: 'Project name', exact: true });
  await naming.getByRole('textbox').fill('Foreground selection'); await naming.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.studio-status')).toContainText('Saved Foreground selection');
  await page.evaluate(() => { window.preferenceOverlap.armed = true; window.__PROCGEN_STUDIO__.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { name: 'Newer dirty source' } }); });
  await page.waitForFunction(() => window.preferenceOverlap.blocked === 1 && window.__PROCGEN_STUDIO__.getPreferenceState().active);
  await useWorkstationControl(page, page.locator('#procgenStudioFooter').getByRole('button', { name: 'Load', exact: true }), { button: 'Load' }, 'click');
  await page.getByRole('dialog', { name: 'Saved projects' }).getByRole('button', { name: /Foreground selection/ }).click();
  await expect(page.locator('.studio-status')).toContainText('Project loaded paused');
  await page.waitForFunction(() => { const studio = window.__PROCGEN_STUDIO__, state = studio.getPreferenceState(); return !state.active && !state.suspended && state.pendingRevision == null && state.durableRevision === studio.getDocumentState().editRevision; });
  const receipt = await page.evaluate(() => ({ worker: window.preferenceOverlap, preferences: window.__PROCGEN_STUDIO__.getPreferenceState(),
    name: window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].name, playing: window.__PROCGEN_STUDIO__.transport.getState().playing }));
  expect(receipt.worker).toEqual({ armed: false, blocked: 1, terminated: 1 }); expect(receipt.name).toBe('Saved source'); expect(receipt.playing).toBe(false);
  expect(receipt.preferences.lastError).toBe(null); expect(receipt.preferences.retirementUnknown).toBe(false); expect(receipt.preferences.storage.pendingBytes).toBe(0);
  await testInfo.attach('foreground-preference-overlap.json', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' });
});

test('corrupt committed preferences refuse previous setup without falling back to a legacy score', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(120000); await bootSavedPreferences(page);
  await page.evaluate(() => localStorage.setItem('lemmings.procgen.workstation.v1', JSON.stringify({ version: 1, project: window.__PROCGEN_STUDIO__.getProject(), ui: {}, transport: {} })));
  await corruptStoredPreferences(page, 'page'); await page.goto('/procgen.html?e2e=1&startup=previous-setup');
  await expect(page.locator('#procgenRunStatus')).toContainText('page is missing or differs');
  expect(await page.evaluate(() => !!window.__PROCGEN_STUDIO__)).toBe(false);
});

for (const corruption of ['page', 'layout']) test('an explicit recipe remains independent of corrupt prior preference ' + corruption, { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(120000); await bootSavedPreferences(page); await corruptStoredPreferences(page, corruption);
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=999&lanes=3');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  expect(await page.evaluate(() => ({ mode: window.__PROCGEN_STUDIO__.getStartupPlan().mode, seed: window.__PROCGEN_LANES__.world.seed,
    lanes: window.__PROCGEN_STUDIO__.getProject().procgen.lanes.length, output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled }))).toEqual({ mode: 'recipe', seed: 999, lanes: 3, output: false });
});

test('authored lane pages commit and reload without whole-project localStorage writes', { tag: ['@boundary', '@workstation-storage'] }, async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    localStorage.removeItem('lemmings.procgen.workstation.v1');
    const { createProcgenPattern } = await import('/js/app/procgen/workstation/ProcgenWorkstationProject.js'), lane = studio.getProject().procgen.lanes[0];
    studio.dispatch({ type: 'procgen/lane', laneId: lane.id, patch: { mode: 'pattern', patternPurpose: 'Preference round-trip fixture: complementary control', patterns: [createProcgenPattern(lane.family, lane.role)] } });
    studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 87 } });
    studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { name: 'Durable authored lane', gain: .37 } });
  });
  await page.waitForFunction(() => {
    const studio = window.__PROCGEN_STUDIO__, state = studio.getPreferenceState();
    return state?.pendingRevision == null && state.durableRevision === studio.getDocumentState().editRevision;
  });
  const receipt = await page.evaluate(() => ({ preferences: window.__PROCGEN_STUDIO__.getPreferenceState(), legacy: localStorage.getItem('lemmings.procgen.workstation.v1') }));
  expect(receipt.legacy).toBe(null); expect(receipt.preferences.lastError).toBe(null); expect(receipt.preferences.storage.committed).toBeGreaterThan(0);
  expect(receipt.preferences.storage.pendingBytes).toBe(0);
  await page.goto('/procgen.html?e2e=1&startup=previous-setup');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
  const restored = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, lane = studio.getProject().procgen.lanes[0]; studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    return { name: lane.name, gain: lane.gain, note: lane.patterns[0].steps[0].note, lanes: studio.getProject().procgen.lanes.length,
      mode: studio.getStartupPlan().mode, output: studio.getPlaybackState().enabled, recording: studio.state.recording, thru: studio.state.thru };
  });
  expect(restored).toEqual({ name: 'Durable authored lane', gain: .37, note: 87, lanes: 8, mode: 'previous-setup', output: false, recording: false, thru: false });
  await testInfo.attach('authored-preferences.json', { body: JSON.stringify({ ...receipt, restored }, null, 2), contentType: 'application/json' });
});
