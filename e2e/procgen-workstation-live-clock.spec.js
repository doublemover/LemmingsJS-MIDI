import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { useWorkstationControl } from './helpers/workstationChrome.js';
import { armActualPhysicalClock, finishActualPhysicalClock } from './helpers/physicalMidiClock.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });

async function installLiveObservation(page) {
  await installWebMidiStub(page, { trackOutput: true, trackOutputTimestamps: true });
  await page.addInitScript(() => {
    window.__liveClockAudioOpens = 0; window.__liveClockPeak = 0; window.__liveClockNonfinite = false;
    window.__observePhysicalLiveClock = true;
    const Context = window.AudioContext, connect = window.AudioNode.prototype.connect, analysers = [];
    window.AudioContext = class extends Context { constructor(options) { super(options); window.__liveClockAudioOpens++; } };
    window.AudioNode.prototype.connect = function(destination, ...args) {
      const result = connect.call(this, destination, ...args);
      if (destination instanceof window.AudioDestinationNode && analysers.length < 4) { const analyser = this.context.createAnalyser(); analyser.fftSize = 2048; connect.call(this, analyser); analysers.push(analyser); }
      return result;
    };
    const samples = new Float32Array(2048);
    const observe = () => {
      for (const analyser of analysers) { analyser.getFloatTimeDomainData(samples); for (const sample of samples) { if (!Number.isFinite(sample)) window.__liveClockNonfinite = true; else window.__liveClockPeak = Math.max(window.__liveClockPeak, Math.abs(sample)); } }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
}

async function enableLiveOutput(page, backend) {
  if (backend === 'midi') {
    await useWorkstationControl(page, page.locator('#procgenOutput'), {}, 'selectOption', 'midi');
    if (await page.locator('#procgenMidiDevice option[value="pw-output-1"]').count() === 0) await page.locator('#procgenListen').click();
    await useWorkstationControl(page, page.locator('#procgenMidiDevice'), {}, 'selectOption', 'pw-output-1');
  }
  await page.locator('#procgenListen').click(); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true');
}

async function advanceLive(page, target) {
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex), { timeout: 15000, intervals: [20, 40, 80] }).toBeGreaterThanOrEqual(target);
}
async function startLive(page) { await page.getByRole('button', { name: 'Play world', exact: true }).click(); }

async function externalPulses(page, count, interval, { stop = false } = {}) {
  return page.evaluate(async ({ count, interval, stop }) => {
    const midi = window.__WEBMIDI_STUB__, api = window.__PROCGEN_LANES__; midi.sendInput([0xfb]); api.resume();
    for (let index = 0; index < count; index++) { midi.sendInput([0xf8]); await new Promise(resolve => setTimeout(resolve, interval)); }
    if (stop) midi.sendInput([0xfc]);
    return { state: window.__PROCGEN_STUDIO__.transport.getState(), tick: api.world.tickIndex };
  }, { count, interval, stop });
}

function assertLiveFrames(actual, backend) {
  const byIntent = new Map(actual.intents.map(intent => [intent.intentId, intent])), byBatch = new Map(actual.batches.map(batch => [batch.batchId, batch]));
  const sink = backend === 'audio' ? 'physical-browser-audio' : 'physical-midi:local';
  const timed = actual.outcomes.filter(outcome => outcome.sinkId === sink && Number.isSafeInteger(outcome.sourceTargetFrame));
  expect(timed.length).toBeGreaterThan(0); let checked = 0, lateAttacks = 0, repairedReleases = 0;
  const admittedBegins = new Set(), degradedBegins = new Set();
  for (const outcome of timed) {
    expect(outcome.targetTimeDomain).toBe(backend === 'audio' ? 'audio-sample-frames' : 'performance-microseconds');
    const intent = byIntent.get(outcome.intentId), batch = byBatch.get(outcome.batchId); expect(intent).toBeTruthy(); expect(batch).toBeTruthy();
    const anchor = backend === 'audio' ? batch.audioAnchor : batch.midiAnchor; expect(anchor).toBeTruthy();
    expect(intent.scoreTime.epoch).toBe(anchor.scoreEpoch);
    const host = anchor.hostMs + (intent.scoreTime.beat - anchor.beat) * 60000 / anchor.bpm;
    const expected = backend === 'audio' ? Math.round((anchor.contextSeconds + (host + anchor.presentationDelayMs - anchor.correlationHostMs) / 1000) * anchor.sampleRate) : Math.round(host * 1000);
    expect(outcome.sourceTargetFrame).toBe(expected); checked++;
    if (intent.kind === 'begin' && ['accepted', 'degraded'].includes(outcome.status)) {
      admittedBegins.add(intent.intentId); expect(outcome.targetFrame).toBe(outcome.sourceTargetFrame); expect(outcome.repair).toBeNull();
      if (outcome.status === 'degraded') {
        degradedBegins.add(intent.intentId); expect(backend).toBe('midi');
        const loss = outcome.losses?.find(loss => loss.kind === 'midi1-semitone-quantization');
        expect(loss).toBeTruthy(); expect(loss.requestedCents).toBe(intent.pitch.cents); expect(loss.representedCents).toBe(Math.round(intent.pitch.cents / 100) * 100);
      }
    }
    if (outcome.reason === 'late-attack') { lateAttacks++; expect(intent.kind).toBe('begin'); expect(outcome.status).toBe('rejected'); }
    if (outcome.repair) { expect(intent.kind).toBe('end'); expect(outcome.repair).toBe('late-release'); expect(outcome.targetFrame).toBeGreaterThanOrEqual(outcome.sourceTargetFrame); repairedReleases++; }
  }
  expect(admittedBegins.size).toBeGreaterThan(0);
  return { sink, checked, admittedBegins: admittedBegins.size, degradedBegins: degradedBegins.size, lateAttacks, repairedReleases, timeDomain: backend === 'audio' ? 'audio-sample-frames' : 'performance-microseconds' };
}

for (const backend of ['audio', 'midi']) for (const scenario of ['rates-pause-step', 'catch-up', 'host-gap', 'external-clock', 'generation']) test('native ' + backend + ' preserves original physical clocks through ' + scenario + ' @boundary', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ page }, testInfo) => {
  test.setTimeout(90000); page.setDefaultTimeout(15000); await installLiveObservation(page);
  const armed = await armActualPhysicalClock(page, { external: scenario === 'external-clock', speed: scenario === 'catch-up' ? 10 : 3, generationFixture: scenario === 'generation' });
  await enableLiveOutput(page, backend); const setupRequests = await page.evaluate(() => window.__WEBMIDI_STUB__.metrics().requests), journey = { scenario, backend, setupRequests };
  if (scenario === 'external-clock') {
    journey.locked = await externalPulses(page, 16, 20); expect(journey.locked.state.clockStatus).toBe('locked');
    await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.transport.getState().reason), { timeout: 5000 }).toBe('clock-lost');
    journey.lost = await page.evaluate(() => ({ state: window.__PROCGEN_STUDIO__.transport.getState(), tick: window.__PROCGEN_LANES__.world.tickIndex }));
    await page.waitForTimeout(100); expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBe(journey.lost.tick);
    journey.continued = await externalPulses(page, 16, 24, { stop: true }); expect(journey.continued.state.playing).toBe(false); expect(journey.continued.tick).toBeGreaterThan(journey.lost.tick);
    await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.transport({ clockSource: 'internal', bpm: 83 })); await startLive(page); await advanceLive(page, 110);
  } else {
    await startLive(page); await advanceLive(page, scenario === 'catch-up' ? 48 : 24);
    if (scenario === 'rates-pause-step') {
      await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.transport({ bpm: 175, speedMode: 'bpm', linked: true })); await advanceLive(page, 48);
      await page.getByRole('button', { name: 'Pause world', exact: true }).click(); journey.pausedTick = await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex);
      await page.waitForTimeout(100); expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBe(journey.pausedTick);
      await page.locator('#procgenStep').click(); expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBe(journey.pausedTick + 1);
      await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.transport({ bpm: 93, speedMode: 'game', linked: false, gameSpeed: 5 })); await startLive(page); await advanceLive(page, 110);
    } else if (scenario === 'catch-up' || scenario === 'host-gap') {
      journey.gap = await page.evaluate(milliseconds => { const started = performance.now(), before = window.__PROCGEN_LANES__.world.tickIndex; while (performance.now() - started < milliseconds) { /* Controlled host stall. */ } return { requestedMs: milliseconds, observedMs: performance.now() - started, before, afterTask: window.__PROCGEN_LANES__.world.tickIndex }; }, scenario === 'catch-up' ? 200 : 500);
      expect(journey.gap.afterTask).toBe(journey.gap.before);
      if (scenario === 'host-gap') {
        await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.transport.getState().reason)).toBe('suspended');
        expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBe(journey.gap.before); await startLive(page);
      }
      await advanceLive(page, 110);
    } else {
      await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world.generation), { timeout: 15000 }).toBeGreaterThan(armed.generation);
      journey.boundary = await page.evaluate(() => ({ generation: window.__PROCGEN_LANES__.world.generation, tick: window.__PROCGEN_LANES__.world.generationStartTick }));
      await advanceLive(page, journey.boundary.tick + 96);
    }
  }
  const live = await page.evaluate(() => ({ diagnostics: window.__PROCGEN_STUDIO__.getPhysicalOutputDiagnostics(), peak: window.__liveClockPeak, nonfinite: window.__liveClockNonfinite, opens: window.__liveClockAudioOpens, midi: window.__WEBMIDI_STUB__.metrics() }));
  const actual = await finishActualPhysicalClock(page, armed.takeId);
  await testInfo.attach('native-live-clock-observation-' + backend + '-' + scenario, { body: JSON.stringify({ journey, actual, live }), contentType: 'application/json' });
  await page.locator('#procgenPanic').click(); await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().activeNotes)).toBe(0);
  const stopped = await page.evaluate(() => window.__PROCGEN_STUDIO__.getPhysicalOutputDiagnostics());
  const frames = assertLiveFrames(actual, backend);
  expect(stopped.externalOutputs.every(output => output.ownedVoices === 0)).toBe(true);
  if (backend === 'audio') { expect(live.opens).toBe(1); expect(live.nonfinite).toBe(false); expect(live.peak).toBeGreaterThan(1e-8); expect(live.midi.requests).toBe(scenario === 'external-clock' ? 1 : 0); }
  else { expect(live.opens).toBe(0); expect(live.midi.requests).toBe(setupRequests); expect(setupRequests).toBeGreaterThan(0); expect(setupRequests).toBeLessThanOrEqual(scenario === 'external-clock' ? 2 : 1); const notes = live.midi.messages.filter(message => (message.bytes[0] & 0xf0) === 0x90 && message.bytes[2]); expect(notes.length).toBeGreaterThan(0); expect(notes.every(message => Number.isFinite(message.requestedTimestampMs))).toBe(true); }
  if (scenario === 'catch-up') { const groups = new Map(); for (const batch of actual.batches) groups.set(batch.hostEventTimeMs, (groups.get(batch.hostEventTimeMs) || 0) + 1); expect(Math.max(...groups.values())).toBeGreaterThan(1); }
  await testInfo.attach('native-live-clock-' + backend + '-' + scenario, { body: JSON.stringify({ journey, frames, stopped, viewport: page.viewportSize(), scope: 'Actual desktop runtime/owned local audio or declared WebMIDI output stub; independently recomputed original sink targets, strict lateness and terminal ownership. Internal PCM and API submissions only; no receiver, OS suspension or acoustic qualification.' }), contentType: 'application/json' });
});
