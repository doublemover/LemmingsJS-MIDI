import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
const openDesktop = async page => {
  await page.addInitScript(() => {
    window.__activityAudioOpens = 0; window.__activityMidiRequests = 0; const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.__activityAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__activityMidiRequests++; throw new Error('Unexpected hardware request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
};
test('actual activity gaps do not age during sixty wall seconds of desktop paints and native take reopening refuses edited history', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, testInfo) => {
  test.setTimeout(240000); await openDesktop(page);
  const receipt = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, live = window.__PROCGEN_LANES__; studio.transport.pause(); live.pause(); const activeWorld = live.world, tick = activeWorld.tickIndex, project = JSON.stringify(studio.getProject()), root = new URL('./', location.href), sourceRoot = new URL('js/app/procgen/', root);
    const [{ qualifyActualActivityWindows }, { createActualScoredWorldFactory }, { ProcgenLaneRenderer }, { createProcgenSessionStorage }, { createProcgenCausalJournal }, { BinaryReader }, { FileContainer }, { MaskProvider }] = await Promise.all([
      import('/test/helpers/actualActivityWindows.js'), import('/test/helpers/actualScoredWorld.js'), import(new URL('ProcgenLaneRenderer.js', sourceRoot)), import(new URL('workstation/ProcgenSessionStorage.js', sourceRoot)), import(new URL('workstation/ProcgenCausalJournal.js', sourceRoot)), import(new URL('js/data/BinaryReader.js', root)), import(new URL('js/data/FileContainer.js', root)), import(new URL('js/render/MaskProvider.js', root))]);
    const response = await fetch(new URL('lemmings_ohNo/MAIN.DAT', root)); if (!response.ok) throw new Error('Immutable masks unavailable.'); const reader = new BinaryReader(new Uint8Array(await response.arrayBuffer())), container = new FileContainer(reader), part = container.getPart(1); let masks;
    try { masks = new MaskProvider(part); } finally { part.release(); container.dispose(); reader.release(); }
    const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
    let storage = createProcgenSessionStorage(), display = null, pause = null;
    try {
      const result = await qualifyActualActivityWindows({ sourceRoot, createWorld: await createActualScoredWorldFactory({ masks, sprites: activeWorld.sprites, maxActors: 128, sourceRoot }), journal: createProcgenCausalJournal({ storage }),
        async reopenJournal() { storage.close(); storage = createProcgenSessionStorage(); return createProcgenCausalJournal({ storage }); },
        async onPause({ world, engine, render }) { const before = world.tickIndex, started = performance.now(); let polls = 0, frames = 0; while (performance.now() - started < 60000) { engine.physicalAnalysis(); engine.diagnostics(); polls++; if (render()) frames++; await new Promise(resolve => setTimeout(resolve, 250)); } pause = { before, after: world.tickIndex, wallMs: performance.now() - started, polls, frames }; },
        async createDisplay(world) { const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080; document.body.append(canvas); const renderer = new ProcgenLaneRenderer({ canvas, world, assets: live.renderer.assets, windowRef: window }); renderer.follow = false; let paints = 0;
          return { render() { renderer.cameraX = paints % 2 ? 12 : 0; const value = renderer.render(true); if (value) paints++; return value; }, dispose() { display = { paints, state: renderer.getDisplayState().state, width: canvas.width, height: canvas.height }; renderer.dispose(); canvas.remove(); } }; }
      });
      const scenarios = {};
      for (const name of ['reference', 'staticWorld', 'empty', 'drone', 'muted', 'rejected']) { const value = result[name]; scenarios[name] = { physicalFacts: value.facts.length, physicalHash: await hash(value.facts), intentHash: await hash(value.intents), begins: value.intents.filter(row => row.intent.kind === 'begin').length, ends: value.intents.filter(row => row.intent.kind === 'end').length, transitions: value.transitions, windows: value.windows, restored: value.restored, nativeTake: value.nativeTake || null }; }
      if (live.world !== activeWorld || activeWorld.tickIndex !== tick || JSON.stringify(studio.getProject()) !== project) throw new Error('Activity corpus changed active project/world.');
      return { scenarios, coverage: result.coverage, unsupportedRefused: result.unsupportedRefused, refusals: result.refusals, display, pause, liveProjectUnchanged: true, audioContexts: window.__activityAudioOpens, midiRequests: window.__activityMidiRequests, viewport: { width: window.innerWidth, height: window.innerHeight }, scope: result.scope };
    } finally { storage.close(); }
  });
  await testInfo.attach('actual-activity-windows-desktop', { body: JSON.stringify(receipt), contentType: 'application/json' }); expect(receipt.viewport).toEqual({ width: 1920, height: 1080 }); expect(receipt.pause.wallMs).toBeGreaterThanOrEqual(60000); expect(receipt.pause.before).toBe(8); expect(receipt.pause.after).toBe(8); expect(receipt.pause.frames).toBeGreaterThan(1);
  expect(receipt.scenarios.reference.restored.equal).toBe(true); expect(receipt.scenarios.reference.nativeTake.failedInterpretationUnchanged).toBe(true); expect(receipt.scenarios.staticWorld.begins).toBe(0); expect(receipt.scenarios.empty.begins).toBe(0); expect(receipt.scenarios.drone.begins).toBe(3); expect(receipt.scenarios.drone.ends).toBe(0);
  expect(receipt.refusals).toHaveLength(9); expect(receipt.display).toMatchObject({ state: 'ready', width: 1920, height: 1080 }); expect(receipt.liveProjectUnchanged).toBe(true); expect(receipt.audioContexts).toBe(0); expect(receipt.midiRequests).toBe(0);
});
test('actual desktop Rescue crews make one rooted cadence for success and none for blocked or dead crews', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, testInfo) => {
  test.setTimeout(240000); await openDesktop(page);
  const receipt = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, live = window.__PROCGEN_LANES__; studio.transport.pause(); live.pause(); const activeWorld = live.world, tick = activeWorld.tickIndex, project = JSON.stringify(studio.getProject()), root = new URL('./', location.href), sourceRoot = new URL('js/app/procgen/', root);
    const [{ qualifyActualCrewCadences }, { createActualScoredWorldFactory }, { BinaryReader }, { FileContainer }, { MaskProvider }] = await Promise.all([import('/test/helpers/actualActivityWindows.js'), import('/test/helpers/actualScoredWorld.js'), import(new URL('js/data/BinaryReader.js', root)), import(new URL('js/data/FileContainer.js', root)), import(new URL('js/render/MaskProvider.js', root))]);
    const response = await fetch(new URL('lemmings_ohNo/MAIN.DAT', root)); if (!response.ok) throw new Error('Immutable masks unavailable.'); const reader = new BinaryReader(new Uint8Array(await response.arrayBuffer())), container = new FileContainer(reader), part = container.getPart(1); let masks;
    try { masks = new MaskProvider(part); } finally { part.release(); container.dispose(); reader.release(); }
    const result = await qualifyActualCrewCadences({ sourceRoot, createWorld: await createActualScoredWorldFactory({ masks, sprites: activeWorld.sprites, maxActors: 128, sourceRoot }) }), results = [];
    for (const value of result.results) { const { facts, ...summary } = value; const physicalHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(facts)))), byte => byte.toString(16).padStart(2, '0')).join(''); results.push({ ...summary, physicalFacts: facts.length, physicalHash }); }
    if (live.world !== activeWorld || activeWorld.tickIndex !== tick || JSON.stringify(studio.getProject()) !== project) throw new Error('Crew corpus changed active project/world.');
    return { results, liveProjectUnchanged: true, audioContexts: window.__activityAudioOpens, midiRequests: window.__activityMidiRequests, viewport: { width: window.innerWidth, height: window.innerHeight }, scope: result.scope };
  });
  await testInfo.attach('actual-crew-cadences-desktop', { body: JSON.stringify(receipt), contentType: 'application/json' }); expect(receipt.viewport).toEqual({ width: 1920, height: 1080 }); expect(receipt.results.map(row => row.completed)).toEqual([1, 0, 0]); expect(receipt.results[0].restoredCompletion.count).toBe(1); expect(receipt.results[0].intents).toHaveLength(3); expect(receipt.results[2].deaths).toBeGreaterThan(0); expect(receipt.liveProjectUnchanged).toBe(true); expect(receipt.audioContexts).toBe(0); expect(receipt.midiRequests).toBe(0);
});
