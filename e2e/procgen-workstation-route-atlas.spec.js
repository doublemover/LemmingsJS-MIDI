import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('actual U routes crossing branches marker edits and native mid-loop take reopening preserve route evidence', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, testInfo) => {
  test.setTimeout(240000);
  await page.addInitScript(() => {
    window.__atlasAudioOpens = 0; window.__atlasMidiRequests = 0; const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.__atlasAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__atlasMidiRequests++; throw new Error('Unexpected hardware request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  const receipt = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, live = window.__PROCGEN_LANES__; studio.transport.pause(); live.pause();
    const activeWorld = live.world, tick = activeWorld.tickIndex, project = JSON.stringify(studio.getProject()), root = new URL('./', location.href), sourceRoot = new URL('js/app/procgen/', root);
    const [{ qualifyActualRouteAtlasJourneys }, { createActualScoredWorldFactory }, { ProcgenLaneRenderer }, { createProcgenSessionStorage }, { createProcgenCausalJournal }, { BinaryReader }, { FileContainer }, { MaskProvider }] = await Promise.all([
      import('/test/helpers/actualRouteAtlasJourneys.js'), import('/test/helpers/actualScoredWorld.js'), import(new URL('ProcgenLaneRenderer.js', sourceRoot)), import(new URL('workstation/ProcgenSessionStorage.js', sourceRoot)),
      import(new URL('workstation/ProcgenCausalJournal.js', sourceRoot)), import(new URL('js/data/BinaryReader.js', root)), import(new URL('js/data/FileContainer.js', root)), import(new URL('js/render/MaskProvider.js', root))]);
    const response = await fetch(new URL('lemmings_ohNo/MAIN.DAT', root)); if (!response.ok) throw new Error('Immutable masks unavailable.');
    const reader = new BinaryReader(new Uint8Array(await response.arrayBuffer())), container = new FileContainer(reader), part = container.getPart(1); let masks;
    try { masks = new MaskProvider(part); } finally { part.release(); container.dispose(); reader.release(); }
    const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
    const displays = []; let storage = createProcgenSessionStorage(), reopen = false, pause = null;
    try {
      const result = await qualifyActualRouteAtlasJourneys({ sourceRoot, journal: createProcgenCausalJournal({ storage }), createWorld: await createActualScoredWorldFactory({ masks, sprites: activeWorld.sprites, maxActors: 128, sourceRoot }),
        async reopenJournal() { storage.close(); storage = createProcgenSessionStorage(); reopen = true; return createProcgenCausalJournal({ storage }); },
        async onPause({ world }) { const before = world.tickIndex, start = performance.now(); for (let frame = 0; frame < 8; frame++) await new Promise(resolve => requestAnimationFrame(resolve)); pause = { before, after: world.tickIndex, displayFrames: 8, wallMs: performance.now() - start }; },
        async createDisplay(world) {
          const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080; document.body.append(canvas);
          const renderer = new ProcgenLaneRenderer({ canvas, world, assets: live.renderer.assets, windowRef: window }); renderer.follow = false; let paints = 0;
          return { render() { renderer.cameraX = paints % 2 ? 12 : 0; const rendered = renderer.render(true); if (rendered) paints++; return rendered; }, dispose() { displays.push({ paints, state: renderer.getDisplayState().state, width: canvas.width, height: canvas.height }); renderer.dispose(); canvas.remove(); } };
        } });
      const geometry = {};
      for (const name of ['u', 'crossing', 'ambiguous']) { const value = result[name]; geometry[name] = { result: value.result, coordinates: value.coordinates, physicalHash: await hash(value.facts), physicalFacts: value.facts.length, permutationEqual: value.permutationEqual }; }
      if (live.world !== activeWorld || activeWorld.tickIndex !== tick || JSON.stringify(studio.getProject()) !== project) throw new Error('Atlas corpus changed active project/world.');
      return { geometry, markers: result.markers, nativeTake: result.nativeTake, realIndexedDbReopen: reopen, displays, pause, liveProjectUnchanged: true, audioContexts: window.__atlasAudioOpens, midiRequests: window.__atlasMidiRequests, viewport: { width: window.innerWidth, height: window.innerHeight }, scope: result.scope };
    } finally { storage.close(); }
  });
  await testInfo.attach('actual-route-atlas-desktop', { body: JSON.stringify(receipt), contentType: 'application/json' });
  expect(receipt.viewport).toEqual({ width: 1920, height: 1080 }); expect(receipt.nativeTake.equal).toBe(true); expect(receipt.nativeTake.neverRequestedPlanRefused).toBe(true); expect(receipt.realIndexedDbReopen).toBe(true);
  expect(receipt.geometry.u.result.routeGapPixels).toBeGreaterThan(96); expect(receipt.geometry.u.result.euclideanPixels).toBeLessThan(48); expect(receipt.markers.edits).toHaveLength(8);
  expect(receipt.displays).toHaveLength(3); for (const display of receipt.displays) { expect(display).toMatchObject({ state: 'ready', width: 1920, height: 1080 }); expect(display.paints).toBeGreaterThan(0); }
  expect(receipt.pause.before).toBe(200); expect(receipt.pause.after).toBe(200); expect(receipt.liveProjectUnchanged).toBe(true); expect(receipt.audioContexts).toBe(0); expect(receipt.midiRequests).toBe(0);
});
