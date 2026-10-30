import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('actual desktop cavities and workers preserve topology binding across sculpting stale results and native take reopening', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, testInfo) => {
  test.setTimeout(240000);
  await page.addInitScript(() => {
    window.__topologyAudioOpens = 0; window.__topologyMidiRequests = 0; const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.__topologyAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__topologyMidiRequests++; throw new Error('Unexpected hardware request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  const receipt = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, live = window.__PROCGEN_LANES__; studio.transport.pause(); live.pause(); const activeWorld = live.world, tick = activeWorld.tickIndex, project = JSON.stringify(studio.getProject()), root = new URL('./', location.href), sourceRoot = new URL('js/app/procgen/', root);
    const [{ qualifyActualTerrainTopology }, { createActualScoredWorldFactory }, { ProcgenLaneRenderer }, { createProcgenSessionStorage }, { createProcgenCausalJournal }, { BinaryReader }, { FileContainer }, { MaskProvider }] = await Promise.all([
      import('/test/helpers/actualTerrainTopology.js'), import('/test/helpers/actualScoredWorld.js'), import(new URL('ProcgenLaneRenderer.js', sourceRoot)), import(new URL('workstation/ProcgenSessionStorage.js', sourceRoot)), import(new URL('workstation/ProcgenCausalJournal.js', sourceRoot)), import(new URL('js/data/BinaryReader.js', root)), import(new URL('js/data/FileContainer.js', root)), import(new URL('js/render/MaskProvider.js', root))]);
    const response = await fetch(new URL('lemmings_ohNo/MAIN.DAT', root)); if (!response.ok) throw new Error('Immutable masks unavailable.'); const reader = new BinaryReader(new Uint8Array(await response.arrayBuffer())), container = new FileContainer(reader), part = container.getPart(1); let masks;
    try { masks = new MaskProvider(part); } finally { part.release(); container.dispose(); reader.release(); }
    const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join(''); let storage = createProcgenSessionStorage(), display, pause;
    try {
      const result = await qualifyActualTerrainTopology({ sourceRoot, createWorld: await createActualScoredWorldFactory({ masks, sprites: activeWorld.sprites, maxActors: 128, sourceRoot }), journal: createProcgenCausalJournal({ storage }),
        async reopenJournal() { storage.close(); storage = createProcgenSessionStorage(); return createProcgenCausalJournal({ storage }); },
        async onPause({ world, render }) { const before = world.tickIndex, started = performance.now(); for (let frame = 0; frame < 8; frame++) { render(); await new Promise(resolve => requestAnimationFrame(resolve)); } pause = { before, after: world.tickIndex, wallMs: performance.now() - started, frames: 8 }; },
        async createDisplay(world) { const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080; document.body.append(canvas); const renderer = new ProcgenLaneRenderer({ canvas, world, assets: live.renderer.assets, windowRef: window }); renderer.follow = false; let paints = 0; return { render() { renderer.cameraX = paints % 2 ? 12 : 0; const value = renderer.render(true); if (value) paints++; return value; }, dispose() { display = { paints, state: renderer.getDisplayState().state, width: canvas.width, height: canvas.height }; renderer.dispose(); canvas.remove(); } }; }
      });
      const { facts, ...chambers } = result.chambers; chambers.physicalHash = await hash(facts); chambers.physicalFacts = facts.length; const workers = [];
      for (const { facts, ...row } of result.workerRuns) workers.push({ ...row, physicalFacts: facts.length, physicalHash: await hash(facts) });
      if (live.world !== activeWorld || activeWorld.tickIndex !== tick || JSON.stringify(studio.getProject()) !== project) throw new Error('Topology corpus changed active project/world.');
      return { chambers, workers, diagonal: result.diagonal, unknownROI: result.unknownROI, generation: result.generation, display, pause, liveProjectUnchanged: true, audioContexts: window.__topologyAudioOpens, midiRequests: window.__topologyMidiRequests, viewport: { width: window.innerWidth, height: window.innerHeight }, scope: result.scope };
    } finally { storage.close(); }
  });
  await testInfo.attach('actual-terrain-topology-desktop', { body: JSON.stringify(receipt), contentType: 'application/json' }); expect(receipt.viewport).toEqual({ width: 1920, height: 1080 }); expect(receipt.chambers.staleAfterRestore).toBe(true); expect(receipt.chambers.nativeTake.originalUnchanged).toBe(true); expect(receipt.chambers.refusals).toHaveLength(7); expect(receipt.workers[0].work).toHaveLength(6); expect(receipt.unknownROI.coverage).toBe('partial'); expect(receipt.generation.pendingOwnerRetired).toBe(true); expect(receipt.display).toMatchObject({ state: 'ready', width: 1920, height: 1080 }); expect(receipt.pause.before).toBe(3); expect(receipt.pause.after).toBe(3); expect(receipt.liveProjectUnchanged).toBe(true); expect(receipt.audioContexts).toBe(0); expect(receipt.midiRequests).toBe(0);
});
