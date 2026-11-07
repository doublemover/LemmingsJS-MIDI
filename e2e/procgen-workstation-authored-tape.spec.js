import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
for (const ticks of [128, 10000]) test('authored durable tape preserves births transfer work and every captured control over ' + ticks + ' ticks', { tag: ticks === 128 ? '@boundary' : '@benchmark' }, async ({ page }, testInfo) => {
  test.skip(ticks === 10000 && process.env.LEMMINGS_LONG_TAPE !== '1', 'Explicit authored long-tape qualification.'); test.setTimeout(ticks === 10000 ? 600000 : 150000);
  await page.addInitScript(() => {
    window.__authoredAudioOpens = 0; window.__authoredMidiRequests = 0; const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.__authoredAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__authoredMidiRequests++; throw new Error('Unexpected hardware request'); } });
  });
  await page.exposeFunction('__authoredProgress', value => { if (ticks === 10000) console.log('Authored tape: ' + JSON.stringify(value)); });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  const result = await page.evaluate(async ticks => {
    const studio = window.__PROCGEN_STUDIO__, live = window.__PROCGEN_LANES__; studio.transport.pause(); live.pause();
    const world = live.world, tick = world.tickIndex, project = JSON.stringify(studio.getProject()), root = new URL('./', location.href);
    const { authoredCausalTape } = await import('/test/helpers/authoredCausalTape.js');
    const { ProcgenLaneWorld } = await import(new URL('js/app/procgen/ProcgenLaneWorld.js', root));
    const { createProcgenSessionStorage } = await import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', root));
    const { createProcgenCausalJournal } = await import(new URL('js/app/procgen/workstation/ProcgenCausalJournal.js', root));
    const { BinaryReader } = await import(new URL('js/data/BinaryReader.js', root)), { FileContainer } = await import(new URL('js/data/FileContainer.js', root)), { MaskProvider } = await import(new URL('js/render/MaskProvider.js', root));
    const response = await fetch(new URL('lemmings_ohNo/MAIN.DAT', root)); if (!response.ok) throw new Error('Immutable source masks unavailable.');
    const reader = new BinaryReader(new Uint8Array(await response.arrayBuffer())), container = new FileContainer(reader), part = container.getPart(1); let masks;
    try { masks = new MaskProvider(part); } finally { part.release(); container.dispose(); reader.release(); }
    const storage = createProcgenSessionStorage(), journal = createProcgenCausalJournal({ storage });
    try {
      const result = await authoredCausalTape({ journal, createWorld: () => new ProcgenLaneWorld({ masks, laneCount: 2, seed: 42, assists: false }),
        ticks, sourceRoot: new URL('js/app/procgen/', root), onProgress: value => { if (value.phase !== 'replaying' || value.ticks % 1024 === 0) void window.__authoredProgress(value); } });
      if (live.world !== world || world.tickIndex !== tick || JSON.stringify(studio.getProject()) !== project) throw new Error('Authored tape changed the active project.');
      const original = JSON.stringify(await journal.openTake(result.takeId)); storage.close(); const reopened = createProcgenSessionStorage();
      try { if (JSON.stringify(await createProcgenCausalJournal({ storage: reopened }).openTake(result.takeId)) !== original) throw new Error('Authored original changed on reopen.'); } finally { reopened.close(); }
      return { ...result, realIndexedDbReopen: true, liveProjectUnchanged: true, audioContexts: window.__authoredAudioOpens, midiRequests: window.__authoredMidiRequests };
    } finally { storage.close(); }
  }, ticks);
  expect(result.ticks).toBe(ticks); expect(result.full.comparedBatches).toBe(ticks); expect(result.full.actualContinuationHash).toBe(result.expectedHash);
  expect(result.sourceVersions.applicationExecution.activeExecution).toBe('bound'); expect(result.full.executionBinding.status).toBe('matched'); expect(result.full.exactQualified).toBe(false);
  expect(result.realIndexedDbReopen).toBe(true); expect(result.liveProjectUnchanged).toBe(true); expect(result.audioContexts).toBe(0); expect(result.midiRequests).toBe(0);
  await testInfo.attach('authored-durable-tape-' + ticks, { body: JSON.stringify(result), contentType: 'application/json' });
});
