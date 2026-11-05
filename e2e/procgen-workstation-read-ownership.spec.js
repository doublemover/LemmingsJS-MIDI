import { expect, test } from '@playwright/test';

test('canceled native listing and superseded file input preserve the current operation status and source', { tag: ['@boundary', '@workstation-import-refusal'] }, async ({ page }, info) => {
  test.setTimeout(90000);
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  const result = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__; studio.transport.pause(); api.pause();
    const status = document.querySelector('.studio-status'), changes = [], observer = new MutationObserver(() => changes.push(status.textContent));
    observer.observe(status, { subtree: true, childList: true, characterData: true }); let releaseRead;
    try {
      const beforeListing = status.textContent, listing = studio.handlers.load(); studio.handlers.cancelProjectPicker(); const listed = await listing;
      await Promise.resolve(); const canceledListing = { accepted: listed, sameStatus: status.textContent === beforeListing, operation: studio.getOperationState() };
      const older = studio.capture('Old file'), newer = structuredClone(older); newer.name = 'Latest native file';
      Object.assign(newer.transport, { bpm: 149, baseBpm: 149, speedMode: 'bpm', linked: false }); newer.project.transport.bpm = 149;
      const oldFile = new File([JSON.stringify(older)], 'old-source.json', { type: 'application/json' }), nativeText = oldFile.text.bind(oldFile);
      let began; const entered = new Promise(resolve => { began = resolve; });
      Object.defineProperty(oldFile, 'stream', { value: undefined });
      Object.defineProperty(oldFile, 'text', { value: async () => { const text = await nativeText(); began(); await new Promise(resolve => { releaseRead = resolve; }); return text; } });
      const stale = studio.handlers.import(oldFile); await entered;
      const latest = studio.handlers.import(new File([JSON.stringify(newer)], 'latest-source.json', { type: 'application/json' }));
      const oldAccepted = await stale, latestAccepted = await latest;
      const currentWorld = api.world, currentProject = studio.getProject(), currentDocument = JSON.stringify(studio.getDocumentState()), name = studio.capture().name;
      releaseRead();
      const { backgroundWorkerAdmission } = await import('/js/app/resources/BackgroundWorkerAdmission.js');
      const started = performance.now();
      while (backgroundWorkerAdmission.diagnostics().activeWorkers && performance.now() - started < 15000) await new Promise(resolve => setTimeout(resolve, 10));
      await Promise.resolve();
      return { canceledListing, oldAccepted, latestAccepted, name, bpm: studio.transport.getState().bpm,
        sameWorld: api.world === currentWorld, sameProject: studio.getProject() === currentProject, sameDocument: JSON.stringify(studio.getDocumentState()) === currentDocument,
        operation: studio.getOperationState(), admission: backgroundWorkerAdmission.diagnostics(), obsoleteErrors: changes.filter(text => /abort|cancel|obsolete/i.test(text)), changes };
    } finally { releaseRead?.(); observer.disconnect(); }
  });
  await info.attach('native-operation-read-ownership', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result).toMatchObject({ canceledListing: { accepted: false, sameStatus: true, operation: null }, oldAccepted: false, latestAccepted: true,
    name: 'Latest native file', bpm: 149, sameWorld: true, sameProject: true, sameDocument: true, operation: null, obsoleteErrors: [], admission: { activeWorkers: 0, failedOrUnknown: 0 } });
});
