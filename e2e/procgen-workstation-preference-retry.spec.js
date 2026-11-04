import { expect, test } from '@playwright/test';

test('native fallback preferences retain a retryable immutable source through result-phase suspension', { tag: ['@boundary', '@workstation-storage'] }, async ({ page }, info) => {
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  const result = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__; studio.transport.pause(); api.pause();
    const currentWorld = api.world, currentProject = studio.getProject(), currentDocument = JSON.stringify(studio.getDocumentState());
    const { createProcgenPreferenceWriter } = await import('/js/app/procgen/workstation/ProcgenPreferenceWriter.js');
    const { createBackgroundJobService } = await import('/js/app/resources/BackgroundJobService.js');
    const { createBackgroundWorkerAdmission } = await import('/js/app/resources/BackgroundWorkerAdmission.js');
    const { createResourceBudget } = await import('/js/app/resources/ResourceBudget.js');
    const key = 'e2e.preference-result-retry', budget = createResourceBudget(), admission = createBackgroundWorkerAdmission({ maxWorkers: 1 });
    let writer, hold, first = true, created = 0, terminated = 0;
    class ObservedWorker extends window.Worker { constructor(...args) { super(...args); created++; } terminate() { terminated++; return super.terminate(); } }
    const adapter = { reserve(request) { budget.reserve(request); if (first && request.bytes < 1048576) { first = false; hold = writer.suspend(); } }, release: budget.release };
    const jobs = createBackgroundJobService({ admission, Worker: ObservedWorker });
    writer = createProcgenPreferenceWriter({ jobs, resourceBudget: adapter, storage: localStorage, key, getGeneration: () => 1 });
    try {
      localStorage.removeItem(key);
      const source = { project: { procgen: { lanes: [{ note: 60 }] } }, ui: { page: 'original' } };
      writer.request(source, 1); source.ui.page = 'mutated'; source.project.procgen.lanes[0].note = 99;
      const started = performance.now();
      while (!hold && performance.now() - started < 10000) await new Promise(resolve => setTimeout(resolve, 10));
      if (!hold) throw new Error('Native result resize did not reach the preference suspension.');
      await hold.completion;
      const quiescent = { state: writer.state(), stored: localStorage.getItem(key), budgetBytes: budget.diagnostics().accountedBytes, sharedBytes: admission.diagnostics().memory.accountedBytes };
      hold.release(); await writer.dispose();
      return { quiescent, final: writer.state(), saved: JSON.parse(localStorage.getItem(key)), created, terminated,
        budgetBytes: budget.diagnostics().accountedBytes, sharedBytes: admission.diagnostics().memory.accountedBytes,
        sameWorld: api.world === currentWorld, sameProject: studio.getProject() === currentProject, sameDocument: JSON.stringify(studio.getDocumentState()) === currentDocument };
    } finally { hold?.release(); await writer.dispose({ flush: false }); jobs.dispose(); admission.dispose(); localStorage.removeItem(key); }
  });
  await info.attach('native-preference-source-retry', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.quiescent).toMatchObject({ stored: null, budgetBytes: 0, sharedBytes: 0, state: { active: false, suspended: true, durableRevision: -1, retirementUnknown: false } });
  expect(result).toMatchObject({ created: 2, terminated: 2, budgetBytes: 0, sharedBytes: 0, sameWorld: true, sameProject: true, sameDocument: true,
    saved: { project: { procgen: { lanes: [{ note: 60 }] } }, ui: { page: 'original' } }, final: { durableRevision: 1, lastError: null } });
});
