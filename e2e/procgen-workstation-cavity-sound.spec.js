import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('all three cavity recipes preserve actual geometry work and restored body identity without output activation', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, testInfo) => {
  test.setTimeout(240000);
  await page.addInitScript(() => { window.__mapAudioOpens = 0; window.__mapMidiRequests = 0; const Context = window.AudioContext; window.AudioContext = class extends Context { constructor(options) { super(options); window.__mapAudioOpens++; } }; Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__mapMidiRequests++; throw new Error('Unexpected MIDI request.'); } }); });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1'); await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 }); await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  const receipt = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, live = window.__PROCGEN_LANES__; studio.transport.pause(); live.pause(); const activeWorld = live.world, tick = activeWorld.tickIndex, project = JSON.stringify(studio.getProject()), root = new URL('./', location.href), sourceRoot = new URL('js/app/procgen/', root);
    const [{ qualifyActualCavitySound }, { createActualScoredWorldFactory }, { getNativeInstrumentCatalog }, { BinaryReader }, { FileContainer }, { MaskProvider }] = await Promise.all([import('/test/helpers/actualCavitySound.js'), import('/test/helpers/actualScoredWorld.js'), import(new URL('js/app/midi-ui/NativeInstrumentSchema.js', root)), import(new URL('js/data/BinaryReader.js', root)), import(new URL('js/data/FileContainer.js', root)), import(new URL('js/render/MaskProvider.js', root))]);
    const response = await fetch(new URL('lemmings_ohNo/MAIN.DAT', root)); if (!response.ok) throw new Error('Immutable masks unavailable.'); const reader = new BinaryReader(new Uint8Array(await response.arrayBuffer())), container = new FileContainer(reader), part = container.getPart(1); let masks; try { masks = new MaskProvider(part); } finally { part.release(); container.dispose(); reader.release(); }
    const catalog = await getNativeInstrumentCatalog(), descriptor = catalog.descriptors.find(descriptor => descriptor.engineId === 'worklet-sine'), result = await qualifyActualCavitySound({ sourceRoot, descriptor, sourceHash: catalog.executionIdentity.buildId, createWorld: await createActualScoredWorldFactory({ masks, sprites: activeWorld.sprites, sourceRoot }) });
    if (live.world !== activeWorld || activeWorld.tickIndex !== tick || JSON.stringify(studio.getProject()) !== project) throw new Error('Private cavity corpus changed active project/world.');
    return { ...result, liveProjectUnchanged: true, viewport: { width: window.innerWidth, height: window.innerHeight }, audioContexts: window.__mapAudioOpens, midiRequests: window.__mapMidiRequests };
  });
  await testInfo.attach('actual-cavity-sound-maps', { body: JSON.stringify(receipt), contentType: 'application/json' }); expect(receipt.recipes).toHaveLength(3); expect(receipt.recipes.every(row => row.geometryOnlyIntents === 0 && row.restoredBodyEqual)).toBe(true); expect(receipt.wallContacts.every(row => row.attacks.length > 0 && row.actorPoseOverridden === false)).toBe(true); expect(receipt.viewport).toEqual({ width: 1920, height: 1080 }); expect(receipt.liveProjectUnchanged).toBe(true); expect(receipt.audioContexts).toBe(0); expect(receipt.midiRequests).toBe(0);
});
test('Digging Ocarina loads native chamber controls and actual wall contacts excite the prepared mapped body', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, testInfo) => {
  test.setTimeout(240000);
  await page.addInitScript(() => {
    window.__cavityAnalysers = []; window.__cavityAudioOpens = 0; window.__cavityMidiRequests = 0;
    const Context = window.AudioContext, connect = window.AudioNode.prototype.connect;
    window.AudioContext = class extends Context { constructor(options) { super(options); window.__cavityAudioOpens++; } };
    window.AudioNode.prototype.connect = function(destination, ...args) { const result = connect.call(this, destination, ...args); if (destination instanceof window.AudioDestinationNode && window.__cavityAnalysers.length < 4) { const analyser = this.context.createAnalyser(); analyser.fftSize = 32768; connect.call(this, analyser); window.__cavityAnalysers.push(analyser); } return result; };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__cavityMidiRequests++; throw new Error('Unexpected hardware request.'); } });
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1'); await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Scenes', exact: true }).click(); const catalog = page.getByRole('dialog', { name: 'Playable physical scores', exact: true }); await expect(catalog).toBeVisible();
  await catalog.getByRole('searchbox', { name: 'Search physical scores' }).fill('Digging Ocarina'); await catalog.getByRole('option', { name: /Digging Ocarina · Clay chamber/ }).click();
  await catalog.getByRole('button', { name: 'Prepare fresh', exact: true }).click(); const load = catalog.getByRole('button', { name: 'Load fresh · stopped replacement', exact: true }); await expect(load).toBeEnabled({ timeout: 90000 }); await load.click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.sceneOrigin?.manifest.id)).toBe('digging-ocarina.clay-chamber'); await page.keyboard.press('Escape');
  await page.locator('#procgenStep').click(); await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBeGreaterThan(0);
  const controls = page.getByRole('region', { name: 'Current physical score controls', exact: true }); await expect(controls).toBeVisible(); const size = controls.getByRole('spinbutton', { name: 'Left chamber side', exact: true }); await size.fill('16'); await size.locator('..').getByRole('button', { name: 'Request chamber edit', exact: true }).click(); await page.locator('#procgenStep').click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world.terrainTopology.regions.get('ocarina-chambers')?.current?.components.find(component => component.anchors.includes('left'))?.areaPixels2)).toBe(256);
  const beforeAudio = await page.evaluate(() => ({ opens: window.__cavityAudioOpens, midi: window.__cavityMidiRequests })); expect(beforeAudio).toEqual({ opens: 0, midi: 0 }); await page.locator('#procgenListen').click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().enabled)).toBe(true);
  const before = await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex); await page.getByRole('button', { name: 'Play world', exact: true }).click();
  const actual = await page.evaluate(async before => {
    const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world, facts = [], listener = batch => facts.push(...batch.facts); world.soundEvents.onBatch.on(listener); const started = performance.now(); let best = { peak: 0, rms: 0, dominantHz: null }, failure, body;
    try { while (world.tickIndex - before < 120 && performance.now() - started < 10000) { await new Promise(resolve => requestAnimationFrame(resolve));
      for (const analyser of window.__cavityAnalysers) { const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples); let peak = 0, square = 0; for (const sample of samples) { if (!Number.isFinite(sample)) throw new Error('Nonfinite native cavity PCM.'); peak = Math.max(peak, Math.abs(sample)); square += sample * sample; }
        if (peak > best.peak) { const spectrum = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(spectrum); let bin = 1; for (let index = 2; index < Math.ceil(1000 * analyser.fftSize / analyser.context.sampleRate); index++) if (spectrum[index] > spectrum[bin]) bin = index; best = { peak, rms: Math.sqrt(square / samples.length), dominantHz: bin * analyser.context.sampleRate / analyser.fftSize }; }
      }
    } body = studio.getPhysicalOutputDiagnostics(); } catch (caught) { failure = caught.message; } finally { world.soundEvents.onBatch.off(listener); }
    return { before, after: world.tickIndex, wallContacts: facts.filter(fact => fact.kind === 'ContactResolved' && fact.anchor?.x === 79), body, pcm: best, failure, viewport: { width: window.innerWidth, height: window.innerHeight }, audioOpens: window.__cavityAudioOpens, midiRequests: window.__cavityMidiRequests, actorPoseOverridden: false, scope: 'Native scene loading/geometry controls and explicit audio activation. Ordinary unposed production actors drive the existing modal route; analyser taps observe real browser PCM, without physical-device or listening qualification.' };
  }, before);
  await page.getByRole('button', { name: 'Pause world', exact: true }).click();
  await testInfo.attach('native-cavity-body-output', { body: JSON.stringify(actual), contentType: 'application/json' }); expect(actual.failure).toBeFalsy(); expect(actual.viewport).toEqual({ width: 1920, height: 1080 }); expect(actual.after - actual.before).toBeGreaterThanOrEqual(120); expect(actual.wallContacts.length).toBeGreaterThan(0); expect(actual.body.cavityBody.bindings[0].frequencyHz).toBe(110); expect(actual.body.accepted).toBeGreaterThan(0); expect(actual.pcm.peak).toBeGreaterThan(1e-8); expect(Math.abs(actual.pcm.dominantHz - 110)).toBeLessThan(4); expect(actual.midiRequests).toBe(0);
});
