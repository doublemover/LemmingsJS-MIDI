import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { inspectLane } from './helpers/workstationDock.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('hash-valid malformed causal inputs retain exact desktop diagnostics without changing the recorded performance @boundary', async ({ page }, testInfo) => {
  test.setTimeout(150000);
  await page.addInitScript(() => {
    window.__inputAudioOpens = 0; window.__inputMidiRequests = 0; const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.__inputAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__inputMidiRequests++; throw new Error('Unexpected hardware request'); } });
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
    const { hashProcgenContinuationCheckpoint } = await import(new URL('js/app/procgen/workstation/ProcgenCheckpointProvenance.js', root));
    const { prepareCausalRecordedInputCorpus } = await import('/test/helpers/causalRecordedInputCorpus.js');
    api.step(64); studio.play(); api.pause();
    if (!await studio.handlers.startCausalTake({ takeName: 'Semantic input control' })) throw new Error('Control recording was not admitted.'); api.pause();
    api.step(16); studio.transport.pause(); api.pause(); const stopped = await studio.handlers.stopCausalTake();
    const storage = createProcgenSessionStorage(), journal = createProcgenCausalJournal({ storage }), parent = await journal.openTake(stopped.takeId);
    const parentBytes = JSON.stringify(parent), project = JSON.stringify(studio.getProject()), tick = world.tickIndex;
    const hash = await hashProcgenContinuationCheckpoint(captureProcgenCheckpoint(world)), outcomes = [];
    const select = async takeId => {
      let page = await studio.handlers.browseCausalTakes('first');
      for (let pages = 0; page && pages < 4; pages++) {
        if (page.items.some(row => row.takeId === takeId)) { if (await studio.handlers.selectCausalTake(takeId) !== takeId) throw new Error('Take selection failed.'); return; }
        if (!page.nextCursor) break; page = await studio.handlers.browseCausalTakes('next');
      }
      throw new Error('Take is absent from bounded storage pages: ' + takeId);
    };
    const unchanged = async () => {
      if (api.world !== world || world.tickIndex !== tick || JSON.stringify(studio.getProject()) !== project ||
          await hashProcgenContinuationCheckpoint(captureProcgenCheckpoint(world)) !== hash || JSON.stringify(await journal.openTake(parent.takeId)) !== parentBytes)
        throw new Error('Invalid imported input changed the source performance.');
    };
    try {
      const corpus = await prepareCausalRecordedInputCorpus(journal, parent.takeId);
      for (const row of corpus.rows) {
        await journal.verify(row.takeId); await select(row.takeId);
        const result = await studio.handlers.compareCausalTake(), receipt = result?.receipt;
        if (row.valid) { if (!receipt?.compatibilityMatch || receipt.finalWorldParity !== 'matched-at-captured-component-checkpoint') throw new Error('Positive observation control failed: ' + JSON.stringify(result)); }
        else {
          const failure = receipt?.failure;
          if (receipt?.status !== 'unsupported-or-incomplete' || receipt.compatibilityMatch !== false || receipt.throughSequence !== 0 ||
              failure?.code !== row.expectedCode || failure.sourceId !== row.sourceId || failure.sequence !== row.sequence || failure.tick !== row.tick || failure.recordKind !== row.kind)
            throw new Error('Missing exact semantic input diagnostic: ' + row.name + ' ' + JSON.stringify(result));
          await new Promise(resolve => requestAnimationFrame(resolve));
          if (!document.querySelector('.studio-causal-compatibility')?.textContent.includes(failure.message)) throw new Error('Semantic refusal was not explained in the take panel.');
        }
        outcomes.push({ name: row.name, status: receipt.status, compatibilityMatch: receipt.compatibilityMatch, failure: receipt.failure || null }); await unchanged();
      }
      await select(parent.takeId); const recovered = await studio.handlers.compareCausalTake();
      if (!recovered?.receipt?.compatibilityMatch || recovered.receipt.ticksExecuted !== 16) throw new Error('Original take did not recover after invalid imports.');
      await unchanged(); storage.close(); const reopened = createProcgenSessionStorage();
      try { if (JSON.stringify(await createProcgenCausalJournal({ storage: reopened }).openTake(parent.takeId)) !== parentBytes) throw new Error('Reopened original changed.'); } finally { reopened.close(); }
      return { outcomes, unchanged: true, parentTakeId: parent.takeId, parentHash: parent.canonicalHash, continuationHash: hash,
        recovered: recovered.receipt, audioContexts: window.__inputAudioOpens, midiRequests: window.__inputMidiRequests, scope: 'Actual immutable browser module and IndexedDB input parsing/refusal; no device or acoustic qualification.' };
    } finally { storage.close(); }
  });
  expect(result.outcomes).toHaveLength(27); expect(result.outcomes.filter(row => row.compatibilityMatch)).toHaveLength(1);
  expect(result.unchanged).toBe(true); expect(result.audioContexts).toBe(0); expect(result.midiRequests).toBe(0);
  await testInfo.attach('recorded-input-semantic-refusals', { body: JSON.stringify(result), contentType: 'application/json' });
});
