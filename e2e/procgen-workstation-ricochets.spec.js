import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('real blocker turns preserve paired roles release restore and deterministic 100-actor admission', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await page.addInitScript(() => {
    window.__ricochetAudioOpens = 0; window.__ricochetMidiRequests = 0; const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.__ricochetAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__ricochetMidiRequests++; throw new Error('Unexpected hardware request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
  await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  const receipt = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, live = window.__PROCGEN_LANES__; studio.transport.pause(); live.pause();
    const activeWorld = live.world, tick = activeWorld.tickIndex, project = JSON.stringify(studio.getProject()), root = new URL('./', location.href);
    const [{ qualifyActualRicochets }, { createActualScoredWorldFactory }, { ProcgenLaneRenderer }, { BinaryReader }, { FileContainer }, { MaskProvider }] = await Promise.all([
      import('/test/helpers/actualRicochets.js'), import('/test/helpers/actualScoredWorld.js'), import(new URL('js/app/procgen/ProcgenLaneRenderer.js', root)),
      import(new URL('js/data/BinaryReader.js', root)), import(new URL('js/data/FileContainer.js', root)), import(new URL('js/render/MaskProvider.js', root))]);
    const response = await fetch(new URL('lemmings_ohNo/MAIN.DAT', root)); if (!response.ok) throw new Error('Immutable masks unavailable.');
    const reader = new BinaryReader(new Uint8Array(await response.arrayBuffer())), container = new FileContainer(reader), part = container.getPart(1); let masks;
    try { masks = new MaskProvider(part); } finally { part.release(); container.dispose(); reader.release(); }
    const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value instanceof Uint8ClampedArray ? value : new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
    let display = null, pause = null, pixels = null, paints = 0;
    const result = await qualifyActualRicochets({ createWorld: await createActualScoredWorldFactory({ masks, sprites: activeWorld.sprites, maxActors: 128, sourceRoot: new URL('js/app/procgen/', root) }), sourceRoot: new URL('js/app/procgen/', root),
      async onPause({ world, render }) { const start = performance.now(), before = world.tickIndex; for (let frame = 0; frame < 8; frame++) { render(); await new Promise(resolve => requestAnimationFrame(resolve)); } pause = { before, after: world.tickIndex, displayFrames: 8, wallMs: performance.now() - start }; },
      async createDisplay(world) {
        const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080; document.body.append(canvas);
        const renderer = new ProcgenLaneRenderer({ canvas, world, assets: live.renderer.assets, windowRef: window }); renderer.follow = false; renderer.cameraX = renderer.cameraY = 0;
        return { render() { const value = renderer.render(true); if (value) paints++; return value; }, state: () => renderer.getDisplayState(), dispose() {
          display = { state: renderer.getDisplayState().state, width: canvas.width, height: canvas.height }; pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; renderer.dispose(); canvas.remove();
        } };
      } });
    if (live.world !== activeWorld || activeWorld.tickIndex !== tick || JSON.stringify(studio.getProject()) !== project) throw new Error('Ricochet corpus changed live project/world.');
    const summary = async value => ({ contacts: value.facts.filter(fact => fact.kind === 'ContactResolved' && fact.causeKind === 'blocker').map(fact => ({ eventId: fact.eventId, simTick: fact.simTick, contactId: fact.contactId, actorId: fact.actorId, otherActorId: fact.otherActorId, actionInstanceId: fact.actionInstanceId, otherActionInstanceId: fact.otherActionInstanceId, incomingDirection: fact.incomingDirection })),
      physicalHash: await hash(value.facts), intentHash: await hash(value.intents), intents: value.intents.length });
    return { dual: await summary(result.dual), muted: await summary(result.muted), bounce: { ...await summary(result.bounce), pause: result.bounce.pause, restored: result.bounce.restored, replacementId: result.bounce.replacementId },
      dense: { ...await summary(result.dense), contacts: result.dense.contacts, accepted: result.dense.accepted, rejected: result.dense.rejected, completePhysicalFacts: result.dense.completePhysicalFacts, activeVoicesAfterRelease: result.dense.activeVoicesAfterRelease },
      paints, display, pixelHash: await hash(pixels), pause, liveProjectUnchanged: true, audioContexts: window.__ricochetAudioOpens, midiRequests: window.__ricochetMidiRequests, viewport: { width: window.innerWidth, height: window.innerHeight }, scope: result.scope };
  });
  expect(receipt.viewport).toEqual({ width: 1920, height: 1080 }); expect(receipt.dual.contacts).toHaveLength(2); expect(receipt.dual.physicalHash).toBe(receipt.muted.physicalHash);
  expect(receipt.bounce.restored.equal).toBe(true); expect(receipt.bounce.contacts.length).toBeGreaterThanOrEqual(6);
  expect(receipt.dense.contacts).toBe(100); expect(receipt.dense.accepted + receipt.dense.rejected).toBe(200); expect(receipt.dense.rejected).toBeGreaterThan(0); expect(receipt.dense.activeVoicesAfterRelease).toBe(0); expect(receipt.dense.completePhysicalFacts).toBe(true);
  expect(receipt.pause.before).toBe(100); expect(receipt.pause.after).toBe(100); expect(receipt.paints).toBe(308); expect(receipt.display).toEqual({ state: 'ready', width: 1920, height: 1080 });
  expect(receipt.liveProjectUnchanged).toBe(true); expect(receipt.audioContexts).toBe(0); expect(receipt.midiRequests).toBe(0);
  await testInfo.attach('actual-blocker-ricochet-desktop', { body: JSON.stringify(receipt), contentType: 'application/json' });
});
