import { expect, test } from '@playwright/test';

test('an explicit stop while Save waits for its name survives capture and the native durable write', { tag: ['@boundary', '@workstation-save-cancel'] }, async ({ page }, info) => {
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  const rows = [];
  for (const action of ['pause', 'stop']) {
    await page.evaluate(action => {
      const studio = window.__PROCGEN_STUDIO__; studio.play();
      if (!studio.transport.getState().playing) throw new Error('Save control did not begin playing.');
      window.__saveResumeWorld = window.__PROCGEN_LANES__.world; window.__saveResumeProject = studio.getProject();
      window.__pendingSaveResume = studio.handlers.saveAs(); window.__saveResumeAction = action;
    }, action);
    const dialog = page.getByRole('dialog', { name: 'Save project copy' }); await expect(dialog).toBeVisible();
    await page.evaluate(() => window.__PROCGEN_STUDIO__.transport[window.__saveResumeAction]());
    await dialog.getByRole('textbox').fill('Stopped during Save ' + action); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const row = await page.evaluate(async () => {
      const accepted = await window.__pendingSaveResume, studio = window.__PROCGEN_STUDIO__, state = studio.getDocumentState();
      const { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js');
      const storage = createProcgenSessionStorage();
      try { const saved = await storage.loadDocument(state.id); return { action: window.__saveResumeAction, accepted, playing: studio.transport.getState().playing,
        sameWorld: window.__PROCGEN_LANES__.world === window.__saveResumeWorld, sameProject: studio.getProject() === window.__saveResumeProject,
        revision: state.revision, dirty: state.dirty, durableName: saved.session.name, durableSeed: saved.session.world.seed, durablePlaying: saved.session.transport.playing }; }
      finally { storage.close(); }
    });
    rows.push(row);
    expect(row).toMatchObject({ action, accepted: true, playing: false, sameWorld: true, sameProject: true, revision: 1, dirty: false,
      durableName: 'Stopped during Save ' + action, durableSeed: 42, durablePlaying: false });
  }
  await info.attach('native-save-resume-leases', { body: JSON.stringify(rows), contentType: 'application/json' });
});
