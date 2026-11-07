import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('actual work-cycle intents survive 0 15 and 120 source-relative desktop paint cadences', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await page.addInitScript(() => {
    window.__workCycleAudioOpens = 0; window.__workCycleMidiRequests = 0; const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.__workCycleAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__workCycleMidiRequests++; throw new Error('Unexpected hardware request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  const receipt = await page.evaluate(async () => {
    const live = window.__PROCGEN_LANES__, studio = window.__PROCGEN_STUDIO__; live.pause(); studio.transport.pause();
    const activeWorld = live.world, tick = activeWorld.tickIndex, project = JSON.stringify(studio.getProject()), root = new URL('./', location.href);
    const [{ qualifyActualWorkCycles }, { baseScoredTerrainFixture }, { ProcgenLaneWorld }, { ProcgenScoredTerrain }, { createResourceBudget }, { ProcgenLaneRenderer }, { BinaryReader }, { FileContainer }, { MaskProvider }] = await Promise.all([
      import('/test/helpers/actualWorkCycles.js'), import('/test/helpers/scored-terrain.js'), import(new URL('js/app/procgen/ProcgenLaneWorld.js', root)),
      import(new URL('js/app/procgen/ProcgenScoredTerrain.js', root)), import(new URL('js/app/resources/ResourceBudget.js', root)), import(new URL('js/app/procgen/ProcgenLaneRenderer.js', root)),
      import(new URL('js/data/BinaryReader.js', root)), import(new URL('js/data/FileContainer.js', root)), import(new URL('js/render/MaskProvider.js', root))]);
    const response = await fetch(new URL('lemmings_ohNo/MAIN.DAT', root)); if (!response.ok) throw new Error('Immutable masks unavailable.');
    const reader = new BinaryReader(new Uint8Array(await response.arrayBuffer())), container = new FileContainer(reader), part = container.getPart(1); let masks;
    try { masks = new MaskProvider(part); } finally { part.release(); container.dispose(); reader.release(); }
    const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
    const results = [], summaries = [], pixels = [];
    for (const renderFps of [0, 15, 120]) {
      const result = await qualifyActualWorkCycles({ renderFps, sourceRoot: new URL('js/app/procgen/', root),
        async createWorld(layout) {
          const budget = createResourceBudget({ limitBytes: 96 * 1048576 });
          const terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], layout.lanes.length), layout, { resourceBudget: budget }); await terrain.prepare();
          const world = new ProcgenLaneWorld({ masks, sprites: activeWorld.sprites, terrain, seed: 42, laneCount: layout.lanes.length, laneHeight: layout.laneHeight, assists: false, maxActors: layout.lanes.length, stallPolicy: { secondsWithoutProgress: 1000 } });
          return { world, async dispose() { world.dispose(); await terrain.dispose().completion; if (budget.diagnostics().accountedBytes !== 0) throw new Error('Authored work source leaked its budget.'); } };
        },
        async createDisplay(world) {
          const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080; canvas.setAttribute('aria-label', 'Work cycle qualification'); document.body.append(canvas);
          const renderer = new ProcgenLaneRenderer({ canvas, world, assets: live.renderer.assets, windowRef: window }); renderer.follow = false; renderer.cameraX = 0; renderer.cameraY = 0;
          return { render: () => renderer.render(true), state: () => renderer.getDisplayState(), dispose() {
            if (renderFps) pixels.push({ renderFps, width: canvas.width, height: canvas.height, paintedCells: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.reduce((count, byte, index) => count + (index % 4 === 3 && byte > 0 ? 1 : 0), 0), renderedActors: renderer.renderedActors });
            renderer.dispose(); canvas.remove();
          } };
        } });
      const canonical = Object.fromEntries(['clock', 'solid', 'dig', 'empty', 'steel', 'interruption'].map(key => [key, { facts: result[key].facts, intents: result[key].intents, actors: result[key].actors, terrainRevision: result[key].terrainRevision }]));
      const canonicalHash = await hash(canonical); results.push(canonical);
      summaries.push({ renderFps, paints: result.clock.paints, display: result.clock.display, canonicalHash, measuredCycles: result.measuredCycles,
        work: Object.fromEntries(Object.entries(canonical).map(([key, value]) => [key, { facts: value.facts.length, intents: value.intents.length, work: value.facts.filter(fact => fact.kind === 'TerrainWorkCommitted') }])), scope: result.scope });
    }
    if (JSON.stringify(results[0]) !== JSON.stringify(results[1]) || JSON.stringify(results[0]) !== JSON.stringify(results[2])) throw new Error('Paint cadence changed actual work facts or canonical intent streams.');
    if (live.world !== activeWorld || activeWorld.tickIndex !== tick || JSON.stringify(studio.getProject()) !== project) throw new Error('Work corpus changed active project.');
    return { summaries, pixels, liveProjectUnchanged: true, audioContexts: window.__workCycleAudioOpens, midiRequests: window.__workCycleMidiRequests, viewport: { width: window.innerWidth, height: window.innerHeight }, build: location.pathname.split('/')[3] };
  });
  expect(receipt.viewport).toEqual({ width: 1920, height: 1080 });
  expect(receipt.summaries.map(row => row.paints)).toEqual([0, 57, 460]);
  expect(new Set(receipt.summaries.map(row => row.canonicalHash)).size).toBe(1);
  expect(receipt.summaries.every(row => row.display.state === 'ready')).toBe(true);
  expect(receipt.pixels.every(row => row.paintedCells > 0 && row.renderedActors > 0 && row.width === 1920 && row.height === 1080)).toBe(true);
  expect(receipt.liveProjectUnchanged).toBe(true); expect(receipt.audioContexts).toBe(0); expect(receipt.midiRequests).toBe(0);
  await testInfo.attach('actual-work-cycle-render-cadence', { body: JSON.stringify(receipt), contentType: 'application/json' });
});
