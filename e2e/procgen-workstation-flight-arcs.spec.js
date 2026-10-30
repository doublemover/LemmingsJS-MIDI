import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('real flight arcs retain timing and voice identity across paused paint restore and independent sprite changes', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await page.addInitScript(() => {
    window.__flightAudioOpens = 0; window.__flightMidiRequests = 0; const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.__flightAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__flightMidiRequests++; throw new Error('Unexpected hardware request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  const receipt = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, live = window.__PROCGEN_LANES__; studio.transport.pause(); live.pause();
    const activeWorld = live.world, tick = activeWorld.tickIndex, project = JSON.stringify(studio.getProject()), activeAppearance = JSON.stringify(activeWorld.sprites.activePreference), root = new URL('./', location.href);
    const [{ qualifyActualFlightArcs }, { createActualScoredWorldFactory }, { ProcgenLaneRenderer }, { CharacterSpriteSet }, { BinaryReader }, { FileContainer }, { MaskProvider }] = await Promise.all([
      import('/test/helpers/actualFlightArcs.js'), import('/test/helpers/actualScoredWorld.js'), import(new URL('js/app/procgen/ProcgenLaneRenderer.js', root)),
      import(new URL('js/lemmings/CharacterSpriteSet.js', root)), import(new URL('js/data/BinaryReader.js', root)), import(new URL('js/data/FileContainer.js', root)), import(new URL('js/render/MaskProvider.js', root))]);
    const response = await fetch(new URL('lemmings_ohNo/MAIN.DAT', root)); if (!response.ok) throw new Error('Immutable masks unavailable.');
    const reader = new BinaryReader(new Uint8Array(await response.arrayBuffer())), container = new FileContainer(reader), part = container.getPart(1); let masks;
    try { masks = new MaskProvider(part); } finally { part.release(); container.dispose(); reader.release(); }
    const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value instanceof Uint8Array || value instanceof Uint8ClampedArray ? value : new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
    const shapes = activeWorld.sprites.shapes, variant = shapes.find(shape => shape.id === 'hydro')?.id || shapes[0]?.id; if (!variant) throw new Error('Actual alternate sprite source unavailable.');
    const results = [], summaries = [], pixels = [], pauses = [];
    for (const shape of ['classic', variant]) {
      const preference = { ...activeWorld.sprites.activePreference, shape }, sprites = new CharacterSpriteSet(activeWorld.sprites.base, { shapes }, activeWorld.sprites.loadText, () => preference);
      if (!await sprites.prepare()) throw new Error('Alternate source sprites unavailable: ' + sprites.error);
      const createWorld = await createActualScoredWorldFactory({ masks, sprites, sourceRoot: new URL('js/app/procgen/', root) });
      const result = await qualifyActualFlightArcs({ createWorld, sourceRoot: new URL('js/app/procgen/', root),
        async onPause({ name, world, render }) {
          const start = performance.now(), before = world.tickIndex;
          for (let frame = 0; frame < 8; frame++) { render(); await new Promise(resolve => requestAnimationFrame(resolve)); }
          pauses.push({ shape, name, before, after: world.tickIndex, wallMs: performance.now() - start, displayFrames: 8 });
        },
        async createDisplay(world, name) {
          const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080; document.body.append(canvas);
          const renderer = new ProcgenLaneRenderer({ canvas, world, assets: live.renderer.assets, windowRef: window }); renderer.follow = false; renderer.cameraX = renderer.cameraY = 0;
          let sample = null, paints = 0;
          return { render() { const rendered = renderer.render(true); if (rendered) { paints++; if (world.tickIndex === 8) sample = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; } return rendered; }, state: () => renderer.getDisplayState(), dispose() {
            pixels.push({ shape, name, paints, pixelBytes: sample }); renderer.dispose(); canvas.remove();
          } };
        } });
      const canonical = result.cases.map(({ name, facts, intents, durationTicks }) => ({ name, facts, intents, durationTicks })); results.push(canonical);
      summaries.push({ shape, canonicalHash: await hash(canonical), cases: result.cases.map(({ name, ended, durationTicks, pause, restoration, activeVoices, facts, intents }) => ({ name, durationTicks, arcId: ended.arcId, reason: ended.terminationReason, displacement: ended.verticalDisplacementPixels, travelPixels: ended.travelPixels, pause, restoration, activeVoices,
        land: facts.filter(fact => fact.type === 'lemming-land'), upwardOpening: facts.filter(fact => fact.kind === 'FlightArcUpdated' && fact.fallState === 'floating' && fact.parachutePhase === 4), intents: intents.length })), scope: result.scope });
    }
    if (JSON.stringify(results[0]) !== JSON.stringify(results[1])) throw new Error('Actual sprite change altered canonical flight facts/intents.');
    for (const pixel of pixels) { pixel.pixelHash = await hash(pixel.pixelBytes); delete pixel.pixelBytes; }
    if (live.world !== activeWorld || activeWorld.tickIndex !== tick || JSON.stringify(studio.getProject()) !== project || JSON.stringify(activeWorld.sprites.activePreference) !== activeAppearance) throw new Error('Flight corpus changed active document/world/appearance.');
    return { summaries, pixels, pauses, liveProjectUnchanged: true, audioContexts: window.__flightAudioOpens, midiRequests: window.__flightMidiRequests, viewport: { width: window.innerWidth, height: window.innerHeight } };
  });
  expect(receipt.viewport).toEqual({ width: 1920, height: 1080 }); expect(receipt.summaries).toHaveLength(2);
  expect(receipt.summaries[0].canonicalHash).toBe(receipt.summaries[1].canonicalHash);
  expect(receipt.pixels.find(row => row.shape === receipt.summaries[0].shape && row.name === 'parachute').pixelHash).not.toBe(receipt.pixels.find(row => row.shape === receipt.summaries[1].shape && row.name === 'parachute').pixelHash);
  expect(receipt.pauses.every(row => row.before === 8 && row.after === 8 && row.wallMs > 0)).toBe(true);
  expect(receipt.liveProjectUnchanged).toBe(true); expect(receipt.audioContexts).toBe(0); expect(receipt.midiRequests).toBe(0);
  await testInfo.attach('actual-flight-arc-desktop', { body: JSON.stringify(receipt), contentType: 'application/json' });
});
