import { expect } from '@playwright/test';

async function installNativeCavityObservation(page, { probeSources = false } = {}) {
  await page.addInitScript(({ probeSources }) => {
    window.__cavityAnalysers = []; window.__cavityAudioOpens = 0; window.__cavityMidiRequests = 0;
    window.__cavitySourceAnalysers = [];
    const Context = window.AudioContext, connect = window.AudioNode.prototype.connect;
    if (probeSources) { const Worklet = window.AudioWorkletNode; window.AudioWorkletNode = class extends Worklet { constructor(context, name, options) { super(context, name, options); this.__cavityWorkletName = name; } }; }
    const probed = new WeakSet(), probe = (source, label) => { if (probed.has(source) || window.__cavitySourceAnalysers.length >= 16) return; probed.add(source); const analyser = source.context.createAnalyser(); analyser.fftSize = 512; connect.call(source, analyser); window.__cavitySourceAnalysers.push({ label: label + ':' + window.__cavitySourceAnalysers.length, analyser }); };
    window.AudioContext = class extends Context { constructor(options) { super(options); window.__cavityAudioOpens++; } };
    window.AudioNode.prototype.connect = function(destination, ...args) { const result = connect.call(this, destination, ...args); if (probeSources && this.__cavityWorkletName) probe(this, 'output:' + this.__cavityWorkletName); if (probeSources && destination.__cavityWorkletName) probe(this, 'input:' + destination.__cavityWorkletName); if (destination instanceof window.AudioDestinationNode && window.__cavityAnalysers.length < 4) { const analyser = this.context.createAnalyser(); analyser.fftSize = 32768; connect.call(this, analyser); window.__cavityAnalysers.push(analyser); } return result; };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__cavityMidiRequests++; throw new Error('Unexpected hardware request.'); } });
  }, { probeSources });
}
async function openNativeCavity(page, recipe, options) {
  const { step = true, ...observation } = options || {};
  await installNativeCavityObservation(page, observation);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1'); await page.waitForURL(/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html\?/, { timeout: 90000 });
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Scenes', exact: true }).click(); const catalog = page.getByRole('dialog', { name: 'Playable physical scores', exact: true }); await expect(catalog).toBeVisible();
  await catalog.getByRole('searchbox', { name: 'Search physical scores' }).fill('Digging Ocarina'); await catalog.getByRole('option', { name: new RegExp('Digging Ocarina · ' + recipe) }).click();
  await catalog.getByRole('button', { name: 'Prepare fresh', exact: true }).click(); const load = catalog.getByRole('button', { name: 'Load fresh · stopped replacement', exact: true }); await expect(load).toBeEnabled({ timeout: 90000 }); await load.click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.sceneOrigin?.manifest.title)).toBe('Digging Ocarina · ' + recipe); await page.keyboard.press('Escape');
  if (step) await page.locator('#procgenStep').click();
}
async function cavityEdit(page, label, value, { step = true } = {}) {
  const controls = page.getByRole('region', { name: 'Current physical score controls', exact: true }), input = controls.getByRole('spinbutton', { name: label, exact: true }); await input.fill(String(value)); await input.locator('..').getByRole('button', { name: 'Request chamber edit', exact: true }).click(); if (step) await page.locator('#procgenStep').click();
}
async function enableCavity(page) {
  expect(await page.evaluate(() => ({ opens: window.__cavityAudioOpens, midi: window.__cavityMidiRequests }))).toEqual({ opens: 0, midi: 0 }); await page.locator('#procgenListen').click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().enabled)).toBe(true);
}
async function runNativeCavity(page, ticks = 120, { keepRunning = false, resumePhysicalOnly = false } = {}) {
  const before = await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex);
  if (resumePhysicalOnly) await page.evaluate(() => window.__PROCGEN_LANES__.resume()); else await page.getByRole('button', { name: 'Play world', exact: true }).click();
  const actual = await page.evaluate(async ({ before, ticks }) => {
    const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world, facts = [], listener = batch => facts.push(...batch.facts); world.soundEvents.onBatch.on(listener); const started = performance.now(), energies = {}, sourcePeaks = {}; let best = { peak: 0, rms: 0, dominantHz: null, modeBins: [] }, failure, body;
    try { while (world.tickIndex - before < ticks && performance.now() - started < 10000) { await new Promise(resolve => requestAnimationFrame(resolve));
      const observed = studio.getPhysicalOutputDiagnostics({ requestHealth: true }), health = observed?.effects?.activeGraph?.processors.find(processor => processor.nodeId === 'body')?.health;
      for (const entry of health?.bodies || []) energies[entry.bodyId] = Math.max(energies[entry.bodyId] || 0, entry.energy);
      for (const { label, analyser } of window.__cavitySourceAnalysers) { const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples); let peak = 0; for (const value of samples) { if (!Number.isFinite(value)) throw new Error('Nonfinite source/body tap.'); peak = Math.max(peak, Math.abs(value)); } sourcePeaks[label] = Math.max(sourcePeaks[label] || 0, peak); }
      for (const analyser of window.__cavityAnalysers) { const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples); let peak = 0, square = 0; for (const sample of samples) { if (!Number.isFinite(sample)) throw new Error('Nonfinite native cavity PCM.'); peak = Math.max(peak, Math.abs(sample)); square += sample * sample; }
        if (peak > best.peak) { const spectrum = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(spectrum); let bin = 1; for (let index = 2; index < Math.ceil(1000 * analyser.fftSize / analyser.context.sampleRate); index++) if (spectrum[index] > spectrum[bin]) bin = index;
          const fundamental = observed.cavityBody?.bindings[0].frequencyHz, modeBins = [1, 2.02, 3.08, 4.16].map(ratio => { const targetHz = fundamental * ratio, center = Math.round(targetHz * analyser.fftSize / analyser.context.sampleRate); let peakDb = -Infinity; for (let at = center - 2; at <= center + 2; at++) peakDb = Math.max(peakDb, spectrum[at]); return { targetHz, peakDb }; });
          best = { peak, rms: Math.sqrt(square / samples.length), dominantHz: bin * analyser.context.sampleRate / analyser.fftSize, modeBins, sampleRate: analyser.context.sampleRate, fftSize: analyser.fftSize }; }
      }
    } body = studio.getPhysicalOutputDiagnostics({ requestHealth: true, requestSourceDiagnostics: true, includeSourceTraces: true }); } catch (caught) { failure = caught.message; } finally { world.soundEvents.onBatch.off(listener); }
    return { before, after: world.tickIndex, wallContacts: facts.filter(fact => fact.kind === 'ContactResolved' && [79, 87].includes(fact.anchor?.x)), body, pcm: best, energies, sourcePeaks, failure, viewport: { width: window.innerWidth, height: window.innerHeight }, audioOpens: window.__cavityAudioOpens, midiRequests: window.__cavityMidiRequests, actorPoseOverridden: false, processorsOverridden: false, clock: 'Native Play world control; ordinary production timer', scope: 'Real internal browser PCM and native worklet health. No listening, device or acoustic qualification.' };
  }, { before, ticks });
  if (!keepRunning) await page.getByRole('button', { name: 'Pause world', exact: true }).click(); return actual;
}

export { installNativeCavityObservation, openNativeCavity, cavityEdit, enableCavity, runNativeCavity };
