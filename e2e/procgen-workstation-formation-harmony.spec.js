import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('actual formation harmony follows physical spread and removal while desktop paints preserve voice ownership', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, testInfo) => {
  test.setTimeout(240000);
  await page.addInitScript(() => {
    window.__formationAudioOpens = 0; window.__formationMidiRequests = 0; const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.__formationAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__formationMidiRequests++; throw new Error('Unexpected hardware request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  const receipt = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, live = window.__PROCGEN_LANES__; studio.transport.pause(); live.pause(); const activeWorld = live.world, tick = activeWorld.tickIndex, project = JSON.stringify(studio.getProject()), root = new URL('./', location.href), sourceRoot = new URL('js/app/procgen/', root);
    const [{ qualifyActualFormationHarmony }, { createActualScoredWorldFactory }, { ProcgenLaneRenderer }, { BinaryReader }, { FileContainer }, { MaskProvider }] = await Promise.all([
      import('/test/helpers/actualFormationHarmony.js'), import('/test/helpers/actualScoredWorld.js'), import(new URL('ProcgenLaneRenderer.js', sourceRoot)), import(new URL('js/data/BinaryReader.js', root)), import(new URL('js/data/FileContainer.js', root)), import(new URL('js/render/MaskProvider.js', root))]);
    const response = await fetch(new URL('lemmings_ohNo/MAIN.DAT', root)); if (!response.ok) throw new Error('Immutable masks unavailable.'); const reader = new BinaryReader(new Uint8Array(await response.arrayBuffer())), container = new FileContainer(reader), part = container.getPart(1); let masks;
    try { masks = new MaskProvider(part); } finally { part.release(); container.dispose(); reader.release(); }
    const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
    let display = null; const pauses = [];
    const result = await qualifyActualFormationHarmony({ sourceRoot, createWorld: await createActualScoredWorldFactory({ masks, sprites: activeWorld.sprites, maxActors: 128, sourceRoot }),
      async onPause({ world, render }) { const before = world.tickIndex, started = performance.now(); for (let frame = 0; frame < 8; frame++) { render(); await new Promise(resolve => requestAnimationFrame(resolve)); } pauses.push({ before, after: world.tickIndex, wallMs: performance.now() - started, frames: 8 }); },
      async createDisplay(world) { const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080; document.body.append(canvas); const renderer = new ProcgenLaneRenderer({ canvas, world, assets: live.renderer.assets, windowRef: window }); renderer.follow = false; let paints = 0;
        return { render() { renderer.cameraX = paints % 2 ? 12 : 0; const value = renderer.render(true); if (value) paints++; return value; }, dispose() { display = { paints, state: renderer.getDisplayState().state, width: canvas.width, height: canvas.height }; renderer.dispose(); canvas.remove(); } }; }
    });
    const scenarios = {};
    for (const name of ['reference', 'removed', 'staticHeld', 'coincident', 'alternate', 'empty', 'single']) { const value = result[name]; scenarios[name] = { initial: value.initial, final: value.final, removal: value.removal, minimumMotion: value.minimumMotion, restored: value.restored, physicalHash: await hash(value.facts), intentHash: await hash(value.intents), begins: value.intents.filter(row => row.intent.kind === 'begin'), updates: value.intents.filter(row => row.intent.kind === 'update').length, ends: value.intents.filter(row => row.intent.kind === 'end').length, permutationEqual: value.permutationEqual }; }
    if (live.world !== activeWorld || activeWorld.tickIndex !== tick || JSON.stringify(studio.getProject()) !== project) throw new Error('Formation corpus changed active project/world.');
    return { scenarios, routes: result.routes, refusals: result.refusals, span: result.span, sameLeaderPose: result.sameLeaderPose, display, pauses, liveProjectUnchanged: true, audioContexts: window.__formationAudioOpens, midiRequests: window.__formationMidiRequests, viewport: { width: window.innerWidth, height: window.innerHeight }, scope: result.scope };
  });
  await testInfo.attach('actual-formation-harmony-desktop', { body: JSON.stringify(receipt), contentType: 'application/json' }); expect(receipt.viewport).toEqual({ width: 1920, height: 1080 }); expect(receipt.span.final).toBeGreaterThan(receipt.span.initial);
  expect(receipt.scenarios.reference.restored.equal).toBe(true); expect(receipt.scenarios.removed.restored.equal).toBe(true); expect(receipt.scenarios.empty.begins).toHaveLength(0); expect(receipt.scenarios.staticHeld.updates).toBe(0);
  expect(receipt.refusals).toHaveLength(13);
  expect(receipt.display).toMatchObject({ state: 'ready', width: 1920, height: 1080 }); for (const pause of receipt.pauses) { expect(pause.before).toBe(16); expect(pause.after).toBe(16); }
  expect(receipt.liveProjectUnchanged).toBe(true); expect(receipt.audioContexts).toBe(0); expect(receipt.midiRequests).toBe(0);
});
