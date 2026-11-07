import { expect, test } from '@playwright/test';
import { createChromiumImportMemorySampler } from './helpers/chromiumImportMemory.js';

// Named qualification profile, not a promise that every project with this file
// size or every combination of structural maxima fits the current free budget.
const PROFILE = { lanes: 128, checkpointDataSlots: 131072, fileBytes: 6 * 1048576, hardFileLimitBytes: 64 * 1048576, seed: 42, paused: true, audio: false };
test('declared large-project profile and near-file-limit refusal retain the owned world with measured import memory', { tag: ['@boundary', '@workstation-import-refusal'] }, async ({ browser, page }, info) => {
  test.setTimeout(300000);
  await page.goto('/procgen.html?e2e=1&seed=' + PROFILE.seed + '&lanes=' + PROFILE.lanes);
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  const sampler = await createChromiumImportMemorySampler(browser, page); let result, memory;
  try {
    sampler.mark('capture-declared-large-project');
    const source = await page.evaluate(async profile => {
      const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world;
      // Exercise admitted decoded state as well as input text. This existing
      // codec-test field contains inert data, not invented physical events.
      world.checkpointHazardFixture = Array.from({ length: profile.checkpointDataSlots }, (_, index) => index % 128);
      const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js');
      const original = structuredClone(studio.capture()); original.world = captureProcgenCheckpoint(world);
      const text = JSON.stringify(original);
      const checkpointText = JSON.stringify(original.world), hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      window.__importMemoryProfile = { text, originalCheckpointHash: await hash(checkpointText), hash, sourceWorld: new WeakRef(window.__PROCGEN_LANES__.world) };
      return { sourceBytes: new TextEncoder().encode(text).length, lanes: window.__PROCGEN_LANES__.world.laneCount, projectLanes: studio.getProject().procgen.lanes.length,
        tick: window.__PROCGEN_LANES__.world.tickIndex, activeActors: window.__PROCGEN_LANES__.world.activeCount, checkpointDataSlots: profile.checkpointDataSlots,
        audioEnabled: studio.getPlaybackState().enabled,
        resources: studio.getResourceDiagnostics() };
    }, PROFILE);
    result = { schema: 'large-project-import-profile/v1', profile: PROFILE, source, loaded: null, refusals: [],
      scope: 'Declared 128-lane profile with 131072 inert checkpoint data slots and a 6 MiB padded upload, then near 64 MiB file admission. The payload exercises decoded codec state without inventing physical events. This named admitted profile does not promise simultaneous structural maxima. The 1024-lane structural maximum has its separate overlap-refusal measurement. Shared reservations and observed process/isolate memory are reported separately.' };
    expect(source.lanes).toBe(PROFILE.lanes); expect(source.projectLanes).toBe(PROFILE.lanes); expect(source.sourceBytes).toBeLessThan(PROFILE.fileBytes);
    expect(source.audioEnabled).toBe(false);
    sampler.mark('import-6MiB-128-lane-profile');
    const loaded = await page.evaluate(async profile => {
      const studio = window.__PROCGEN_STUDIO__, fixture = window.__importMemoryProfile;
      const sourceBytes = new TextEncoder().encode(fixture.text).length, file = new File([fixture.text, ' '.repeat(profile.fileBytes - sourceBytes)], 'maximum-lane-profile.json', { type: 'application/json' });
      const started = performance.now(), accepted = await studio.handlers.import(file), durationMs = performance.now() - started;
      fixture.loadedWorld = window.__PROCGEN_LANES__.world; fixture.loadedCheckpointHash = await fixture.hash(JSON.stringify(studio.capture().world));
      fixture.project = studio.getProject(); fixture.document = JSON.stringify(studio.getDocumentState()); fixture.history = JSON.stringify(studio.handlers.historyState());
      return { accepted, durationMs, fileBytes: file.size, replacedWorld: fixture.loadedWorld !== fixture.sourceWorld.deref(),
        originalCheckpointHash: fixture.originalCheckpointHash, loadedCheckpointHash: fixture.loadedCheckpointHash,
        lanes: fixture.loadedWorld.laneCount, projectLanes: fixture.project.procgen.lanes.length, operationRetired: studio.getOperationState() === null,
        restoredCheckpointDataSlots: fixture.loadedWorld.checkpointHazardFixture?.length,
        resources: studio.getResourceDiagnostics(), status: document.querySelector('.studio-status')?.textContent };
    }, PROFILE);
    result.loaded = loaded;
    expect(loaded.accepted, JSON.stringify(loaded)).toBe(true); expect(loaded.replacedWorld).toBe(true); expect(loaded.loadedCheckpointHash).toBe(loaded.originalCheckpointHash);
    expect(loaded.lanes).toBe(PROFILE.lanes); expect(loaded.projectLanes).toBe(PROFILE.lanes); expect(loaded.operationRetired).toBe(true);
    expect(loaded.restoredCheckpointDataSlots).toBe(PROFILE.checkpointDataSlots);
    const refusals = result.refusals;
    for (const fileBytes of [PROFILE.hardFileLimitBytes - 1, PROFILE.hardFileLimitBytes, PROFILE.hardFileLimitBytes + 1]) {
      sampler.mark('file-boundary-' + fileBytes);
      const refusal = await page.evaluate(async fileBytes => {
        const fixture = window.__importMemoryProfile, studio = window.__PROCGEN_STUDIO__, sourceBytes = new TextEncoder().encode(fixture.text).length;
        const file = new File([fixture.text, ' '.repeat(fileBytes - sourceBytes)], 'near-file-boundary.json', { type: 'application/json' }); let reads = 0;
        const streamed = file.stream.bind(file), text = file.text.bind(file);
        Object.defineProperties(file, { stream: { value: () => { reads++; return streamed(); } }, text: { value: () => { reads++; return text(); } } });
        const started = performance.now(), accepted = await studio.handlers.import(file);
        return { accepted, fileBytes: file.size, reads, durationMs: performance.now() - started, operationRetired: studio.getOperationState() === null,
          sameWorld: fixture.loadedWorld === window.__PROCGEN_LANES__.world, sameCheckpoint: fixture.loadedCheckpointHash === await fixture.hash(JSON.stringify(studio.capture().world)),
          sameProject: fixture.project === studio.getProject(), sameDocument: fixture.document === JSON.stringify(studio.getDocumentState()), sameHistory: fixture.history === JSON.stringify(studio.handlers.historyState()),
          resources: studio.getResourceDiagnostics(), status: document.querySelector('.studio-status')?.textContent };
      }, fileBytes);
      refusals.push(refusal); expect(refusal, JSON.stringify(refusal)).toMatchObject({ accepted: false, sameWorld: true, sameCheckpoint: true, sameProject: true, sameDocument: true, sameHistory: true, operationRetired: true });
      if (fileBytes > PROFILE.hardFileLimitBytes) expect(refusal.reads).toBe(0);
      expect(refusal.resources.accountedBytes).toBeLessThanOrEqual(refusal.resources.limitBytes); expect(refusal.resources.unreleasedEstimatedBytes).toBe(0);
    }
  } finally {
    memory = await sampler.finish();
    await info.attach('import-profile-memory', { body: JSON.stringify({ result: result || null, memory }), contentType: 'application/json' });
  }
  expect(memory.truncated).toBe(false); expect(memory.heapSamples.length).toBeGreaterThan(1); expect(memory.processSamples.length).toBeGreaterThan(1);
  expect(memory.workers.some(worker => worker.samples > 0 && worker.url.includes('/BackgroundJobWorker.js'))).toBe(true); expect(memory.processSamples.every(sample => sample.processes.length > 0)).toBe(true);
});

test('structural maximum lane count refuses an overlapping large import before file materialization', { tag: ['@boundary', '@workstation-import-refusal'] }, async ({ browser, page }, info) => {
  test.setTimeout(120000);
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=1024');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  const sampler = await createChromiumImportMemorySampler(browser, page); let result, memory;
  try {
    sampler.mark('1024-lane-overlap-refusal');
    result = await page.evaluate(async () => {
      const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js');
      const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world, checkpoint = JSON.stringify(captureProcgenCheckpoint(world)), project = studio.getProject();
      const before = { resources: studio.getResourceDiagnostics(), document: JSON.stringify(studio.getDocumentState()), history: JSON.stringify(studio.handlers.historyState()) };
      const text = '{}', file = new File([text, ' '.repeat(48 * 1048576 - new TextEncoder().encode(text).length)], 'structural-maximum-overlap.json', { type: 'application/json' });
      let reads = 0; const stream = file.stream.bind(file); Object.defineProperty(file, 'stream', { value: () => { reads++; return stream(); } });
      const started = performance.now(), accepted = await studio.handlers.import(file), durationMs = performance.now() - started;
      return { profile: { lanes: 1024, fileBytes: file.size, paused: true, audioEnabled: studio.getPlaybackState().enabled }, accepted, reads, durationMs, beforeResources: before.resources,
        sameWorld: world === window.__PROCGEN_LANES__.world, sameCheckpoint: checkpoint === JSON.stringify(captureProcgenCheckpoint(world)), sameProject: project === studio.getProject(),
        sameDocument: before.document === JSON.stringify(studio.getDocumentState()), sameHistory: before.history === JSON.stringify(studio.handlers.historyState()),
        operationRetired: studio.getOperationState() === null, resources: studio.getResourceDiagnostics(), status: document.querySelector('.studio-status')?.textContent };
    });
  } finally {
    memory = await sampler.finish(); await info.attach('structural-maximum-memory-refusal', { body: JSON.stringify({ result: result || null, memory }), contentType: 'application/json' });
  }
  expect(result).toMatchObject({ accepted: false, reads: 0, sameWorld: true, sameCheckpoint: true, sameProject: true, sameDocument: true, sameHistory: true, operationRetired: true });
  expect(result.profile.lanes).toBe(1024); expect(result.profile.audioEnabled).toBe(false); expect(result.resources.unreleasedEstimatedBytes).toBe(0);
  expect(result.resources.accountedBytes).toBeLessThanOrEqual(result.resources.limitBytes); expect(result.status).toContain('available');
  expect(memory.truncated).toBe(false); expect(memory.processSamples.length).toBeGreaterThan(1);
});
