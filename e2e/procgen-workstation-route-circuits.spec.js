import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('actual route circuits preserve period evidence terrain edits pause replay and rejected saved histories', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, testInfo) => {
  test.setTimeout(240000);
  await page.addInitScript(() => {
    window.__routeAudioOpens = 0; window.__routeMidiRequests = 0; const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.__routeAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__routeMidiRequests++; throw new Error('Unexpected hardware request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  const receipt = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, live = window.__PROCGEN_LANES__; studio.transport.pause(); live.pause();
    const activeWorld = live.world, tick = activeWorld.tickIndex, project = JSON.stringify(studio.getProject()), root = new URL('./', location.href);
    const [{ qualifyActualRouteCircuits }, { qualifyRouteStateRefusals }, { createActualScoredWorldFactory }, { ProcgenLaneRenderer }, { BinaryReader }, { FileContainer }, { MaskProvider }] = await Promise.all([
      import('/test/helpers/actualRouteCircuits.js'), import('/test/helpers/routeStateCorpus.js'), import('/test/helpers/actualScoredWorld.js'), import(new URL('js/app/procgen/ProcgenLaneRenderer.js', root)),
      import(new URL('js/data/BinaryReader.js', root)), import(new URL('js/data/FileContainer.js', root)), import(new URL('js/render/MaskProvider.js', root))]);
    const response = await fetch(new URL('lemmings_ohNo/MAIN.DAT', root)); if (!response.ok) throw new Error('Immutable masks unavailable.');
    const reader = new BinaryReader(new Uint8Array(await response.arrayBuffer())), container = new FileContainer(reader), part = container.getPart(1); let masks;
    try { masks = new MaskProvider(part); } finally { part.release(); container.dispose(); reader.release(); }
    const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value instanceof Uint8ClampedArray ? value : new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
    let display = null, pixels = null, pause = null, hiddenLane = false, nativePaints = 0;
    const result = await qualifyActualRouteCircuits({ sourceRoot: new URL('js/app/procgen/', root), createWorld: await createActualScoredWorldFactory({ masks, sprites: activeWorld.sprites, sourceRoot: new URL('js/app/procgen/', root) }),
      async onPause({ world, render }) { const start = performance.now(), before = world.tickIndex; for (let frame = 0; frame < 8; frame++) { render(); await new Promise(resolve => requestAnimationFrame(resolve)); } pause = { before, after: world.tickIndex, displayFrames: 8, wallMs: performance.now() - start }; },
      async createDisplay(world) {
        const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080; document.body.append(canvas);
        const renderer = new ProcgenLaneRenderer({ canvas, world, assets: live.renderer.assets, windowRef: window }); renderer.follow = false;
        return { render() { if (world.tickIndex >= 600) { renderer.workstationLayout = { firstLane: 1, count: 1, rowHeight: 180, stripHeight: 180 }; renderer.cameraX = 12; hiddenLane = true; } const rendered = renderer.render(true); if (rendered) nativePaints++; return rendered; }, dispose() {
          display = { state: renderer.getDisplayState().state, width: canvas.width, height: canvas.height, renderedActors: renderer.renderedActors, projectedLanes: renderer.workstationRows?.map(row => row.lane) || [], hiddenLane, nativePaints }; pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; renderer.dispose(); canvas.remove();
        } };
      } });
    const refusals = await qualifyRouteStateRefusals({ graph: result.reference.initialSnapshot.graph, source: result.reference.initialSnapshot.domain.routes, sourceRoot: new URL('js/app/procgen/', root) });
    const scenarios = {};
    for (const name of ['reference', 'fiveSeven', 'changed', 'shortcut', 'stalled', 'odd']) { const value = result[name]; scenarios[name] = { crossings: value.crossings, periodView: value.periodView, physicalHash: await hash(value.facts), intentHash: await hash(value.intents), lapseCount: value.laps.length, invalidated: value.invalidated, paints: value.paints, restored: value.restored }; }
    if (live.world !== activeWorld || activeWorld.tickIndex !== tick || JSON.stringify(studio.getProject()) !== project) throw new Error('Route corpus changed active project/world.');
    return { scenarios, refusals, travel: result.travel, oddRequest: result.oddRequest, display, pause, pixelHash: await hash(pixels), liveProjectUnchanged: true, audioContexts: window.__routeAudioOpens, midiRequests: window.__routeMidiRequests, viewport: { width: window.innerWidth, height: window.innerHeight }, scope: result.scope };
  });
  await testInfo.attach('actual-route-circuit-desktop', { body: JSON.stringify(receipt), contentType: 'application/json' });
  expect(receipt.viewport).toEqual({ width: 1920, height: 1080 }); expect(receipt.scenarios.reference.restored.equal).toBe(true); expect(receipt.travel).toEqual([118, 158]); expect(receipt.refusals.rejected).toBe(41); expect(receipt.refusals.sourceUnchanged).toBe(true);
  expect(receipt.display).toMatchObject({ state: 'ready', width: 1920, height: 1080, projectedLanes: [1], hiddenLane: true }); expect(receipt.display.nativePaints).toBe(receipt.scenarios.reference.paints + receipt.pause.displayFrames); expect(receipt.pause.before).toBe(480); expect(receipt.pause.after).toBe(480);
  expect(receipt.oddRequest.status).toBe('unsupported-under-fixture-constraints'); expect(receipt.liveProjectUnchanged).toBe(true); expect(receipt.audioContexts).toBe(0); expect(receipt.midiRequests).toBe(0);
});
