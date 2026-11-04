import { expect, test } from '@playwright/test';

test('native worker result retirement cannot publish an unowned computed result', { tag: ['@boundary', '@workstation-background-resource'] }, async ({ page }, info) => {
  test.setTimeout(90000);
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  const result = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__; studio.transport.pause(); api.pause();
    const world = api.world, project = studio.getProject(), documentState = JSON.stringify(studio.getDocumentState()), checkpoint = JSON.stringify(studio.capture().world);
    const { createBackgroundWorkerAdmission } = await import('/js/app/resources/BackgroundWorkerAdmission.js');
    const { createBackgroundJobService } = await import('/js/app/resources/BackgroundJobService.js');
    const { createResourceBudget } = await import('/js/app/resources/ResourceBudget.js');
    const input = JSON.stringify({ marker: 'native-result-frontier', values: Array.from({ length: 8192 }, (_, index) => index) }), rows = [];
    for (const interruption of ['abort', 'dispose']) for (const when of ['before', 'after']) {
      const shared = createResourceBudget(), external = createResourceBudget(), controller = new AbortController(); let armed = true, calls = 0, created = 0, terminated = 0, jobs;
      const budgetAdapter = { reserve(request) {
        const interrupt = phase => { if (armed && phase === when && request.bytes < 1048576) { armed = false; calls++; if (interruption === 'abort') controller.abort(new Error('Native result owner retired')); else jobs.dispose(); } };
        interrupt('before'); external.reserve(request); interrupt('after');
      }, release: external.release };
      class ObservedWorker extends window.Worker {
        constructor(...args) { super(...args); created++; }
        terminate() { terminated++; return super.terminate(); }
      }
      const admission = createBackgroundWorkerAdmission({ resourceBudget: shared, maxWorkers: 1 });
      jobs = createBackgroundJobService({ admission, Worker: ObservedWorker }); let published = false, failure;
      try {
        const output = await jobs.compute({ kind: 'parse-json', ownerId: 'native-result-frontier', ownerEpoch: 1, sourceRevision: 'desktop:1',
          inputBytes: input.length, estimatedPeakBytes: 8 * 1048576, budgetAdapter, signal: controller.signal, prepareInput: () => input });
        published = true; output.release();
      } catch (error) { await error.backgroundRetirementCompletion; failure = { code: error.code, message: error.message, phase: error.backgroundRetirement?.phase }; }
      finally { jobs.dispose(); admission.dispose(); }
      rows.push({ interruption, when, calls, published, failure, created, terminated, sharedBytes: shared.diagnostics().accountedBytes, externalBytes: external.diagnostics().accountedBytes, admission: admission.diagnostics() });
    }
    const admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: window.Worker });
    let control;
    try {
      const output = await jobs.compute({ kind: 'parse-json', ownerId: 'native-control', ownerEpoch: 1, sourceRevision: 'desktop:1', inputBytes: input.length,
        estimatedPeakBytes: 8 * 1048576, prepareInput: () => input });
      control = { marker: output.value.marker, values: output.value.values.length, method: output.receipt.method, receipt: output.receipt, retainedBeforeRelease: admission.diagnostics().retainedResults };
      output.release(); control.bytesAfterRelease = admission.diagnostics().memory.accountedBytes;
    } finally { jobs.dispose(); admission.dispose(); }
    return { rows, control, source: { sameWorld: api.world === world, sameProject: studio.getProject() === project, sameDocument: JSON.stringify(studio.getDocumentState()) === documentState,
      sameCheckpoint: JSON.stringify(studio.capture().world) === checkpoint, playing: studio.transport.getState().playing } };
  });
  await info.attach('native-background-result-frontiers', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.rows).toHaveLength(4);
  for (const row of result.rows) {
    expect(row).toMatchObject({ calls: 1, published: false, created: 1, terminated: 1, sharedBytes: 0, externalBytes: 0, failure: { code: 'ownership-retired', phase: 'released' } });
    expect(row.admission).toMatchObject({ activeWorkers: 0, retainedResults: 0, queuedJobs: 0, failedOrUnknown: 0 });
  }
  expect(result.control).toMatchObject({ marker: 'native-result-frontier', values: 8192, method: 'dedicated-worker', retainedBeforeRelease: 1, bytesAfterRelease: 0 });
  expect(result.source).toEqual({ sameWorld: true, sameProject: true, sameDocument: true, sameCheckpoint: true, playing: false });
});
