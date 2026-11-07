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

for (const workload of ['simple-data', 'terrain']) test('native background module loading is scoped to ' + workload, { tag: ['@boundary', '@workstation-background-resource'] }, async ({ page }, info) => {
  const requests = []; let overflow = false;
  const observe = request => { const target = new URL(request.url()); if (!target.pathname.startsWith('/js/')) return; if (requests.length >= 4096) overflow = true; else requests.push(target.pathname.slice(1)); };
  page.context().on('request', observe);
  try {
    await page.goto('/e2e-portable/fixtures/pcm-evidence.html');
    const result = await page.evaluate(async workload => {
      const { createBackgroundWorkerAdmission } = await import('/js/app/resources/BackgroundWorkerAdmission.js');
      const { createBackgroundJobService } = await import('/js/app/resources/BackgroundJobService.js');
      const admission = createBackgroundWorkerAdmission({ maxWorkers: 1 }), jobs = createBackgroundJobService({ admission, Worker: window.Worker }), rows = [];
      const terrain = { schema: 'lemmings-scene-terrain/v1', id: 'score.cold-modules', revision: 1, width: 128, laneHeight: 96,
        lanes: [{ laneId: 0, regions: [{ kind: 'solid', x1: 0, x2: 128, y1: 88, y2: 96, color: 0xff526f74 }] }] };
      const probes = workload === 'terrain' ? [{ kind: 'compile-scene-terrain', input: terrain }] : [
        { kind: 'parse-json', input: '{"marker":"native-cold-data","values":[1,2,3]}' },
        { kind: 'encode-preference-pages', input: [{ value: { name: '音楽', number: 7 }, maxBytes: 1024 }] },
        { kind: 'encode-canonical-json', input: { z: 2, a: 1 } }
      ];
      try {
        for (const [index, probe] of probes.entries()) {
          const output = await jobs.compute({ kind: probe.kind, ownerId: 'cold-native-' + index, ownerEpoch: 1, sourceRevision: 'cold:1',
            inputBytes: new TextEncoder().encode(JSON.stringify(probe.input)).byteLength, estimatedPeakBytes: 16 * 1048576, prepareInput: () => probe.input });
          try { rows.push({ kind: probe.kind, value: workload === 'terrain' ? { schema: output.value.schema, bytes: output.value.bytes, storageBytes: output.value.storage.byteLength, storageHash: output.value.storageHash } : output.value,
            method: output.receipt.method, executionIdentity: output.receipt.executionIdentity }); } finally { output.release(); }
        }
      } finally { jobs.dispose(); admission.dispose(); }
      return { rows, admission: admission.diagnostics(), viewport: { width: window.innerWidth, height: window.innerHeight }, evidence: 'actual-dedicated-workers-raw-source;not-bound-exact-replay-or-timing-benchmark' };
    }, workload);
    expect(overflow).toBe(false); expect(result.viewport.width).toBeGreaterThanOrEqual(1920); expect(result.viewport.height).toBeGreaterThanOrEqual(1080);
    expect(result.rows.every(row => row.method === 'dedicated-worker')).toBe(true);
    expect(result.admission).toMatchObject({ activeWorkers: 0, retainedResults: 0, queuedJobs: 0, failedOrUnknown: 0 });
    expect(result.admission.memory.accountedBytes).toBe(0);
    const files = [...new Set(requests)].sort();
    expect(files).toContain('js/app/resources/BackgroundJobWorker.js'); expect(files).toContain('js/app/resources/BackgroundJobKernels.js');
    for (const file of ['js/app/resources/CircuitWorkshopBuilder.js', 'js/app/resources/ShapeBodySolver.js', 'js/app/resources/ShapeBodyRefinement.js',
      'js/app/resources/FiniteFmExcitation.js', 'js/app/resources/SeedDecomposition.js']) expect(files, file).not.toContain(file);
    if (workload === 'simple-data') {
      expect(result.rows[0].value).toEqual({ marker: 'native-cold-data', values: [1, 2, 3] });
      expect(result.rows[1].value.map(JSON.parse)).toEqual([{ name: '音楽', number: 7 }]);
      expect(JSON.parse(result.rows[2].value)).toEqual({ a: 1, z: 2 }); expect(files).not.toContain('js/app/procgen/SceneTerrainLayout.js');
    } else {
      expect(files).toContain('js/app/procgen/SceneTerrainLayout.js');
      expect(result.rows[0].value).toMatchObject({ schema: 'lemmings-compiled-scene-terrain/v1' });
      expect(result.rows[0].value.bytes).toBeGreaterThan(0); expect(result.rows[0].value.storageBytes).toBe(result.rows[0].value.bytes); expect(result.rows[0].value.storageHash).toMatch(/^[a-f0-9]{64}$/);
    }
    await info.attach('native-background-module-loading-' + workload, { body: JSON.stringify({ ...result, requests, uniqueFiles: files }), contentType: 'application/json' });
  } finally { page.context().removeListener('request', observe); }
});

test('initial budget refusal never prepares native input or constructs a worker and retires delayed side effects', { tag: ['@boundary', '@workstation-background-resource'] }, async ({ page }, info) => {
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  const result = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__; studio.transport.pause(); api.pause();
    const world = api.world, project = studio.getProject(), documentState = JSON.stringify(studio.getDocumentState()), checkpoint = JSON.stringify(studio.capture().world);
    const { createBackgroundWorkerAdmission } = await import('/js/app/resources/BackgroundWorkerAdmission.js');
    const { createBackgroundJobService } = await import('/js/app/resources/BackgroundJobService.js');
    const { createResourceBudget } = await import('/js/app/resources/ResourceBudget.js');
    const rows = [], input = '{"marker":"initial-native-ownership"}';
    for (const mode of ['throw-after', 'delayed-resolve', 'delayed-reject']) {
      const shared = createResourceBudget(), external = createResourceBudget(); let fault = true, settle = null, prepared = 0, created = 0, terminated = 0;
      const budgetAdapter = { reserve(request) {
        if (!fault) return external.reserve(request); fault = false;
        if (mode === 'throw-after') { external.reserve(request); throw new Error('Initial reservation failed after side effect'); }
        return new Promise((resolve, reject) => { settle = () => { external.reserve(request); if (mode === 'delayed-reject') reject(new Error('Delayed initial reservation failed')); else resolve(); }; });
      }, release: external.release, inspectReservation: external.inspectReservation };
      class ObservedWorker extends window.Worker { constructor(...args) { super(...args); created++; } terminate() { terminated++; return super.terminate(); } }
      const admission = createBackgroundWorkerAdmission({ resourceBudget: shared }), jobs = createBackgroundJobService({ admission, Worker: ObservedWorker });
      const request = { kind: 'parse-json', ownerId: 'native-initial', ownerEpoch: 1, sourceRevision: 'desktop:1', inputBytes: input.length, estimatedPeakBytes: 8 * 1048576, budgetAdapter };
      try {
        let error; try { const unexpected = await jobs.compute({ ...request, prepareInput: () => { prepared++; return input; } }); unexpected.release(); } catch (failure) { error = failure; }
        if (!error) throw new Error('Initial reservation incorrectly published a native result');
        const beforeSettlement = { prepared, created, failedAdmissions: admission.diagnostics().failedAdmissionRetirements, sharedBytes: shared.diagnostics().residentBytes };
        settle?.(); const retirement = await error.backgroundRetirementCompletion;
        const afterSettlement = { prepared, created, failedAdmissions: admission.diagnostics().failedAdmissionRetirements, sharedBytes: shared.diagnostics().residentBytes, externalBytes: external.diagnostics().residentBytes };
        const control = await jobs.compute({ ...request, ownerId: 'native-after-retirement', prepareInput: () => input });
        const value = control.value, method = control.receipt.method; control.release();
        rows.push({ mode, beforeSettlement, afterSettlement, retirement, value, method, created, terminated, sharedBytes: shared.diagnostics().residentBytes, externalBytes: external.diagnostics().residentBytes });
      } finally { jobs.dispose(); admission.dispose(); }
    }
    return { rows, source: { sameWorld: api.world === world, sameProject: studio.getProject() === project, sameDocument: JSON.stringify(studio.getDocumentState()) === documentState, sameCheckpoint: JSON.stringify(studio.capture().world) === checkpoint, playing: studio.transport.getState().playing } };
  });
  await info.attach('native-initial-reservation-frontiers', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.rows).toHaveLength(3);
  for (const row of result.rows) {
    expect(row.beforeSettlement).toMatchObject({ prepared: 0, created: 0 });
    if (row.mode !== 'throw-after') { expect(row.beforeSettlement.failedAdmissions).toBe(1); expect(row.beforeSettlement.sharedBytes).toBeGreaterThan(0); }
    expect(row.afterSettlement).toEqual({ prepared: 0, created: 0, failedAdmissions: 0, sharedBytes: 0, externalBytes: 0 });
    expect(row).toMatchObject({ retirement: { phase: 'released', admission: 'not-granted' }, value: { marker: 'initial-native-ownership' }, method: 'dedicated-worker', created: 1, terminated: 1, sharedBytes: 0, externalBytes: 0 });
  }
  expect(result.source).toEqual({ sameWorld: true, sameProject: true, sameDocument: true, sameCheckpoint: true, playing: false });
});
