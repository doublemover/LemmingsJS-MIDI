import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { inspectLane } from './helpers/workstationDock.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('stored take corruption, missing chunks and future sources preserve the live desktop performance', { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(150000);
  await page.addInitScript(() => {
    window.__faultAudioOpens = 0; window.__faultMidiRequests = 0; const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.__faultAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__faultMidiRequests++; throw new Error('Unexpected hardware request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await inspectLane(page, 'Physical');
  const result = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__, world = api.world, root = new URL('./', location.href);
    const { createProcgenSessionStorage } = await import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', root));
    const { createProcgenCausalJournal } = await import(new URL('js/app/procgen/workstation/ProcgenCausalJournal.js', root));
    const { captureProcgenCheckpoint } = await import(new URL('js/app/procgen/workstation/ProcgenCheckpoint.js', root));
    const { hashProcgenPhysicsCheckpoint } = await import(new URL('js/app/procgen/workstation/ProcgenCheckpointProvenance.js', root));
    const { RECOVERY_DATABASE_NAME, RECOVERY_DATABASE_VERSION } = await import(new URL('js/runtime/BrowserGenerationPins.js', root));
    const { causalRuntimeBindingCorpus } = await import('/test/helpers/causalRuntimeBindingCorpus.js');
    studio.transport.pause(); api.pause(); api.step(64); studio.play(); api.pause();
    if (!await studio.handlers.startCausalTake({ takeName: 'Source fault recovery' })) throw new Error('Take admission failed.'); api.pause();
    api.step(32); studio.transport.pause(); api.pause(); const stopped = await studio.handlers.stopCausalTake();
    const store = createProcgenSessionStorage(), journal = createProcgenCausalJournal({ storage: store });
    const parent = await store.loadCausalTake(stopped.takeId), parentBefore = JSON.stringify(parent), project = JSON.stringify(studio.getProject());
    const physicalHash = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world)), tick = world.tickIndex;
    const database = await new Promise((resolve, reject) => { const request = indexedDB.open(RECOVERY_DATABASE_NAME, RECOVERY_DATABASE_VERSION); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const ref = parent.chunks[0], original = await store.loadCausalChunk(ref.id), outcomes = [];
    const corruptCanonical = original.canonical.replace('"previousHash":', '"previousHask":');
    if (corruptCanonical === original.canonical) throw new Error('Corruption fixture did not change a stored byte.');
    const write = value => new Promise((resolve, reject) => {
      const transaction = database.transaction('takeChunks', 'readwrite'), target = transaction.objectStore('takeChunks');
      if (value) target.put(value); else target.delete(ref.id);
      transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
    });
    const preserved = async () => {
      if (api.world !== world || world.tickIndex !== tick || JSON.stringify(studio.getProject()) !== project ||
          await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world)) !== physicalHash || JSON.stringify(await store.loadCausalTake(parent.takeId)) !== parentBefore)
        throw new Error('Source inspection changed the original performance.');
    };
    try {
      if (!(await studio.handlers.compareCausalTake())?.receipt?.compatibilityMatch) throw new Error('Positive comparison control failed.');
      for (const kind of ['corrupt', 'missing']) {
        await write(kind === 'corrupt' ? { ...original, canonical: corruptCanonical } : null);
        const compared = await studio.handlers.compareCausalTake(), state = studio.handlers.causalTakeState().workbench;
        if (compared !== false || state.phase !== 'failed' || !state.failure || state.failure.sourceId !== ref.id || state.failure.firstSequence !== ref.firstSequence ||
            state.failure.code !== (kind === 'missing' ? 'missing-chunk' : 'content-mismatch')) throw new Error('Missing exact recoverable ' + kind + ' diagnostic: ' + JSON.stringify(state.failure));
        outcomes.push({ kind, failure: state.failure }); await preserved(); await write(original);
        const repaired = await studio.handlers.compareCausalTake(); if (!repaired?.receipt?.compatibilityMatch || repaired.failure !== null) throw new Error('Repaired source did not recover.'); await preserved();
      }
      const future = await journal.createTake({ takeId: 'take:future-source', takeName: 'Unsupported future source', documentId: parent.documentId,
        sourceVersions: { ...parent.sourceVersions, physicalMusic: parent.sourceVersions.physicalMusic + 1 }, captureProfile: parent.captureProfile,
        initialCheckpoint: await journal.readCheckpoint(parent.initialCheckpoint), mapping: parent.mapping, assetRefs: parent.assetRefs }); await future.stop();
      await studio.handlers.browseCausalTakes(); await studio.handlers.selectCausalTake('take:future-source');
      const unsupported = await studio.handlers.compareCausalTake();
      if (unsupported?.receipt?.status !== 'unsupported' || !unsupported.receipt.reasons.includes('source-version-mismatch') || unsupported.receipt.exactQualified !== false)
        throw new Error('Future source was not explicitly refused.');
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (!document.querySelector('.studio-causal-compatibility')?.textContent.includes('musical protocol differs')) throw new Error('Future protocol refusal was not explained in the take UI.');
      outcomes.push({ kind: 'future-source', reasons: unsupported.receipt.reasons }); await preserved();
      const bindings = await causalRuntimeBindingCorpus(journal, parent.takeId, new URL('js/app/procgen/', root)), buildComparisons = [];
      if (bindings.active.activeExecution !== 'bound') throw new Error('Build corpus did not execute inside the actual immutable application.');
      await studio.handlers.browseCausalTakes();
      for (const [kind, explanation] of [['legacy-recording', 'build is unqualified'], ['changed-codeDigest', 'differs (codeDigest)'], ['matching-recording', 'recorded application build matches']]) {
        await studio.handlers.selectCausalTake('take:binding:' + kind);
        const compared = await studio.handlers.compareCausalTake();
        if (!compared?.receipt?.compatibilityMatch || compared.receipt.ticksExecuted !== 32 || compared.receipt.exactQualified !== false || compared.receipt.executionIdentity.status !== 'bound')
          throw new Error('Current-runtime build comparison failed: ' + kind + ' ' + JSON.stringify(compared));
        await new Promise(resolve => requestAnimationFrame(resolve));
        const text = document.querySelector('.studio-causal-compatibility')?.textContent;
        if (!text?.includes(explanation)) throw new Error('Missing persistent build compatibility explanation: ' + kind + ' ' + text);
        buildComparisons.push({ kind, receipt: compared.receipt, explanation: text }); await preserved();
      }
      await studio.handlers.selectCausalTake(parent.takeId); if (!(await studio.handlers.compareCausalTake())?.receipt?.compatibilityMatch) throw new Error('Original source did not recover after version refusal.');
      await preserved(); return { outcomes, bindings, buildComparisons, parentTakeId: parent.takeId, physicalHash, unchanged: true, audioContexts: window.__faultAudioOpens, midiRequests: window.__faultMidiRequests };
    } finally { await write(original); database.close(); store.close(); }
  });
  expect(result.unchanged).toBe(true); expect(result.outcomes).toHaveLength(3); expect(result.audioContexts).toBe(0); expect(result.midiRequests).toBe(0);
  expect(result.bindings.rows).toHaveLength(15); expect(result.bindings.allocations).toBe(0); expect(result.buildComparisons).toHaveLength(3);
  await expect(page.locator('.studio-causal-compatibility')).toContainText('recorded application build matches');
  await testInfo.attach('causal-source-faults', { body: JSON.stringify(result), contentType: 'application/json' });
});
