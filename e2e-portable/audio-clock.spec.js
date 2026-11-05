import { expect, test } from './fixtures.js';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { observeNativeAudioClock, isolateAudioClockProbe } from '../e2e/helpers/observeNativeAudioClock.js';
import { armActualPhysicalClock, finishActualPhysicalClock } from '../e2e/helpers/physicalMidiClock.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });

async function advance(page, tick, journey, startsAfter = null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let observed;
    await expect.poll(async () => {
      observed = await page.evaluate(() => ({ tick: window.__PROCGEN_LANES__.world.tickIndex, starts: window.__nativeClockObservation.starts.length, transport: window.__PROCGEN_STUDIO__.transport.getState() }));
      return startsAfter === null ? observed.tick >= tick || !observed.transport.playing : observed.starts > startsAfter || observed.tick >= tick || !observed.transport.playing;
    }, { timeout: 15000, intervals: [20, 40, 80] }).toBe(true);
    if (startsAfter === null && observed.tick >= tick || startsAfter !== null && observed.starts > startsAfter) return;
    expect(observed.transport.reason, JSON.stringify(observed)).toBe('suspended'); expect(observed.transport.lastDiscontinuity?.source).toBe('host-wake-gap'); expect(attempt).toBeLessThan(2);
    journey.push(observed); await page.waitForTimeout(100); expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBe(observed.tick);
    await page.getByRole('button', { name: 'Play world', exact: true }).click();
  }
}
const attach = (info, browser, scenario, evidence) => {
  const viewport = evidence.actual?.snapshot?.viewport || evidence.after?.viewport || evidence.availability?.viewport;
  expect(viewport).toEqual({ width: 1920, height: 1080 });
  return info.attach('native-physical-clock.json', { contentType: 'application/json',
    body: JSON.stringify({ schema: 'lemmings-native-clock-qualification/v1', project: info.project.name, browser: browser.version(), scenario,
      viewport, acousticReceipt: false, availability: { available: true }, ...evidence }) });
};
async function unavailable(page, info, browser, scenario) {
  const availability = await page.evaluate(() => ({ available: false, reason: 'native-AudioContext-absent', contextType: typeof window.AudioContext,
    legacyContextType: typeof window.webkitAudioContext, contextsOpened: window.__nativeClockObservation.contexts.length, outputEnabled: window.__PROCGEN_STUDIO__.getPlaybackState().enabled,
    viewport: { width: window.innerWidth, height: window.innerHeight } }));
  expect(availability.contextType).not.toBe('function'); expect(availability.legacyContextType).not.toBe('function'); expect(availability.contextsOpened).toBe(0); expect(availability.outputEnabled).toBe(false);
  await attach(info, browser, scenario, { availability });
}
const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];

function verifyTargets(snapshot) {
  expect(snapshot.source.actorsPosed).toBe(false); expect(snapshot.source.processorsOverridden).toBe(false);
  const batches = new Map(snapshot.batches.map(batch => [batch.batchId, batch])), intents = new Map(snapshot.intents.map(intent => [intent.intentId, intent]));
  const starts = snapshot.receipts.filter(row => row.status === 'accepted' && intents.get(row.intentId)?.kind === 'begin' && row.sinkId === 'physical-browser-audio');
  const unique = [...new Map(starts.map(row => [row.intentId, row])).values()]; expect(unique).toHaveLength(8);
  const targetFrames = unique.map(row => {
    const intent = intents.get(row.intentId), anchor = batches.get(row.batchId)?.anchors; expect(anchor).toBeTruthy();
    const host = anchor.hostMs + (intent.scoreTime.beat - anchor.beat) * 60000 / anchor.bpm;
    const original = Math.round((anchor.contextSeconds + (host + anchor.presentationDelayMs - anchor.correlationHostMs) / 1000) * anchor.sampleRate);
    expect(row.sourceTargetFrame).toBe(original); expect(row.targetFrame).toBe(original); expect(row.repair).toBeNull(); return original;
  }).sort((a, b) => a - b);
  expect(snapshot.nodes.map(row => row.expectedFrame).sort((a, b) => a - b)).toEqual(targetFrames);
  expect(snapshot.nodes.every(row => row.expectedFrame > row.submittedFrame)).toBe(true);
  expect(snapshot.nodes.every(row => row.expectedFrame > row.renderFrameAtSubmission && Number.isFinite(row.submittedHostMs))).toBe(true);
  return { checked: unique.length, sourcePrecision: snapshot.source.sourcePrecision, presentationDelayMs: snapshot.presentationDelayMs, producerLeadClock: 'native-audio-worklet-quantum-start',
    producerLeadFrames: snapshot.nodes.map(row => row.expectedFrame - row.renderFrameAtSubmission), mainThreadContextLeadFrames: snapshot.nodes.map(row => row.expectedFrame - row.submittedFrame) };
}

async function privateSource(page, delay) {
  await observeNativeAudioClock(page);
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1');
  await page.waitForFunction(() => { if (!window.__PROCGEN_STUDIO__ || !window.__PROCGEN_LANES__?.world?.terrain) return false; window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); return true; });
  if (!await page.evaluate(() => typeof (window.AudioContext || window.webkitAudioContext) === 'function')) return null;
  await isolateAudioClockProbe(page);
  await page.evaluate(async presentationDelayMs => {
    const { createPhysicalAudioClockFixture } = await import('/e2e/helpers/physicalAudioClockFixture.js');
    window.__privateClock = await createPhysicalAudioClockFixture({ sourceRoot: new URL('./', location.href).href, presentationDelayMs });
    const button = document.createElement('button'); button.textContent = 'Enable measured native audio'; button.id = 'enableNativeClock';
    button.style.cssText = 'position:fixed;top:0;left:0;z-index:100000';
    button.onclick = () => { window.__privateClockEnabled = window.__privateClock.enable(); }; document.body.append(button);
  }, delay);
  await page.locator('#enableNativeClock').click(); await page.evaluate(() => window.__privateClockEnabled);
  return true;
}
const disposePrivate = page => page.evaluate(() => window.__privateClock.dispose());

for (const [delay, stall] of [[128, 20], [128, 50], [160, 100]]) test('native scheduled sources retain original frames during a ' + stall + 'ms main-thread stall', async ({ page, nativeBrowser }, info) => {
  if (!await privateSource(page, delay)) { await unavailable(page, info, nativeBrowser, 'stall-' + stall); return; }
  const { produced, actual } = await page.evaluate(async milliseconds => { const produced = await window.__privateClock.produce(); return { produced, actual: await window.__privateClock.stall(milliseconds) }; }, stall), targets = verifyTargets(actual.snapshot);
  await info.attach('native-clock-attempt.json', { body: JSON.stringify({ produced, actual }), contentType: 'application/json' });
  const nodes = actual.snapshot.nodes; expect(nodes.every(row => Number.isSafeInteger(row.first))).toBe(true);
  expect(new Set(nodes.map(row => row.expectedFrame)).size).toBe(8);
  const errors = nodes.map(row => Math.abs(row.first - row.expectedFrame));
  expect(Math.max(...errors)).toBeLessThanOrEqual(129);
  expect(actual.onsetsWhileBlocked).toBeGreaterThan(0);
  expect(nodes.filter(row => row.firstWhileBlocked === row.first && Number.isSafeInteger(row.firstWhileBlocked))).toHaveLength(actual.onsetsWhileBlocked);
  expect(actual.observedMs).toBeGreaterThanOrEqual(stall); expect(actual.renderEndFrame).toBeGreaterThan(actual.renderStartFrame);
  const retirement = await disposePrivate(page);
  await attach(info, nativeBrowser, 'stall-' + stall, { targets, produced, actual, retirement,
    onset: { population: nodes.length, p50Frames: quantile(errors, 0.5), p95Frames: quantile(errors, 0.95), p99Frames: quantile(errors, 0.99), maxFrames: Math.max(...errors),
      sampleRate: actual.snapshot.context.sampleRate, tap: 'native-oscillator-pre-envelope', deviceLatency: 'unmeasured' } });
});

for (const afterRender of [false, true]) test('native scheduled cancellation qualifies ' + (afterRender ? 'already rendered source frames' : 'submission before source onset'), async ({ page, nativeBrowser }, info) => {
  if (!await privateSource(page, 512)) { await unavailable(page, info, nativeBrowser, afterRender ? 'cancel-after-render' : 'cancel-before-render'); return; }
  const { produced, actual } = await page.evaluate(async afterRender => { const produced = await window.__privateClock.produce(); return { produced, actual: await window.__privateClock.cancel({ afterRender }) }; }, afterRender), targets = verifyTargets(actual.snapshot);
  const nodes = actual.snapshot.nodes;
  await info.attach('native-cancellation-attempt.json', { body: JSON.stringify({ produced, actual, targets }), contentType: 'application/json' });
  const stopFrontiers = [];
  expect(actual.nativeEndWait.complete).toBe(true); expect(actual.nativeEndWait.missingOrdinals).toEqual([]);
  if (afterRender) {
    expect(nodes.every(row => Number.isSafeInteger(row.first) && row.last >= row.first)).toBe(true);
    for (const row of nodes) {
      const stops = actual.snapshot.stops.filter(stop => stop.ordinal === row.ordinal); expect(stops.length).toBeGreaterThan(0);
      for (const stop of stops) { expect(Number.isSafeInteger(stop.renderFrameBeforeStop)).toBe(true); expect(Number.isSafeInteger(stop.renderFrameAfterStop)).toBe(true); expect(stop.renderFrameAfterStop).toBeGreaterThanOrEqual(stop.renderFrameBeforeStop); }
      const ends = actual.snapshot.ends.filter(end => end.ordinal === row.ordinal); expect(ends).toHaveLength(1); const end = ends[0];
      expect(end.trusted).toBe(true); expect(end.acknowledgment).toBe('native-source-ended');
      const frontier = Math.max(Math.round(end.contextSeconds * end.sampleRate), end.renderFrameAtAcknowledgment);
      stopFrontiers.push({ ordinal: row.ordinal, lastRenderedFrame: row.last, frontierFrame: frontier, maximumFollowingFrames: 128, stops, nativeEnd: end, lastStopToAcknowledgmentMs: end.hostMs - stops.at(-1).submittedHostMs });
      expect(row.last).toBeLessThanOrEqual(frontier + 128);
    }
  } else { expect(actual.requestedAtFrame).toBeLessThan(Math.min(...nodes.map(row => row.expectedFrame))); expect(nodes.every(row => row.first === null && row.last === null)).toBe(true); }
  const retirement = await disposePrivate(page);
  await attach(info, nativeBrowser, afterRender ? 'cancel-after-render' : 'cancel-before-render', { produced, targets, actual, retirement,
    cancellation: { nativeSubmissionObserved: true, rendered: afterRender, nodes: nodes.length, frontier: 'native-source-ended-acknowledgment', submissionFrontier: 'native-stop-call-bracketed-by-shared-render-quantum', maximumFollowingFrames: 128, stopFrontiers, deviceBufferedPcm: 'unknown' } });
});

test('an independent audio owner leaves physical correlation and scheduled sources intact', async ({ page, nativeBrowser }, info) => {
  if (!await privateSource(page, 512)) { await unavailable(page, info, nativeBrowser, 'independent-owner'); return; }
  const { produced, actual } = await page.evaluate(async () => { const produced = await window.__privateClock.produce(); return { produced, actual: await window.__privateClock.unrelatedOwner() }; }), targets = verifyTargets(actual.snapshot);
  expect(actual.sameContext).toBe(true); expect(actual.after.anchor).toEqual(actual.before.anchor); expect(actual.after.rebases).toBe(actual.before.rebases);
  expect(actual.snapshot.nodes.every(row => Number.isSafeInteger(row.first))).toBe(true);
  const retirement = await disposePrivate(page);
  await attach(info, nativeBrowser, 'independent-owner', { produced, targets, actual, retirement, independentOwner: { sameContext: true, sameAnchor: true, unchangedRebases: true } });
});

for (const replacement of [false, true]) test('physical audio rearms without backlog after ' + (replacement ? 'same-rate native context replacement' : 'Listen disable and re-enable'), async ({ page, nativeBrowser }, info) => {
  await observeNativeAudioClock(page); await page.addInitScript(() => { window.__observePhysicalLiveClock = true; });
  const armed = await armActualPhysicalClock(page, { speed: 3 });
  if (!await page.evaluate(() => typeof (window.AudioContext || window.webkitAudioContext) === 'function')) {
    await finishActualPhysicalClock(page, armed.takeId); await unavailable(page, info, nativeBrowser, replacement ? 'context-replacement' : 'listen-rearm'); return;
  }
  await page.locator('#procgenListen').click(); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true');
  const incidentalHostGaps = [];
  await page.getByRole('button', { name: 'Play world', exact: true }).click(); await advance(page, 24, incidentalHostGaps);
  const before = await page.evaluate(() => ({ tick: window.__PROCGEN_LANES__.world.tickIndex, generation: window.__PROCGEN_LANES__.world.generation,
    bpm: window.__PROCGEN_STUDIO__.transport.getState().bpm, clock: window.__PROCGEN_STUDIO__.getPhysicalOutputDiagnostics().clock,
    starts: window.__nativeClockObservation.starts.length, sampleRate: window.__nativeClockObservation.contexts.at(-1).sampleRate }));
  expect(before.starts).toBeGreaterThan(0);
  if (replacement) await page.evaluate(() => window.__nativeClockObservation.contexts.at(-1).close());
  else await page.locator('#procgenListen').click();
  await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false');
  const disabled = await page.evaluate(() => ({ tick: window.__PROCGEN_LANES__.world.tickIndex, starts: window.__nativeClockObservation.starts.length, enabled: window.__PROCGEN_STUDIO__.getPlaybackState().enabled }));
  await advance(page, disabled.tick + 80, incidentalHostGaps);
  const muted = await page.evaluate(() => ({ tick: window.__PROCGEN_LANES__.world.tickIndex, starts: window.__nativeClockObservation.starts.length }));
  expect(muted.starts).toBe(disabled.starts);
  await page.locator('#procgenListen').click(); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true');
  await advance(page, muted.tick + 360, incidentalHostGaps, muted.starts);
  const after = await page.evaluate(() => ({ tick: window.__PROCGEN_LANES__.world.tickIndex, generation: window.__PROCGEN_LANES__.world.generation,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    bpm: window.__PROCGEN_STUDIO__.transport.getState().bpm, clock: window.__PROCGEN_STUDIO__.getPhysicalOutputDiagnostics().clock,
    starts: window.__nativeClockObservation.starts, contexts: window.__nativeClockObservation.contexts.map(context => ({ sampleRate: context.sampleRate, state: context.state })) }));
  expect(after.generation).toBe(before.generation); expect(after.bpm).toBe(before.bpm); expect(after.clock.rebases).toBeGreaterThan(before.clock.rebases);
  expect(after.contexts).toHaveLength(replacement ? 2 : 1); expect(after.contexts.at(-1).sampleRate).toBe(before.sampleRate);
  if (replacement) expect(after.contexts[0].state).toBe('closed');
  const actual = await finishActualPhysicalClock(page, armed.takeId), byIntent = new Map(actual.intents.map(intent => [intent.intentId, intent])), byBatch = new Map(actual.batches.map(batch => [batch.batchId, batch]));
  const starts = actual.outcomes.filter(row => row.sinkId === 'physical-browser-audio' && byIntent.get(row.intentId)?.kind === 'begin');
  await info.attach('native-clock-rearm-attempt.json', { body: JSON.stringify({ before, disabled, muted, after, actual, incidentalHostGaps }), contentType: 'application/json' });
  const mutedIds = new Set(starts.filter(row => { const tick = byBatch.get(row.batchId)?.tick; return tick > disabled.tick && tick <= muted.tick; }).map(row => row.intentId));
  const admitted = starts.filter(row => row.status === 'accepted'); expect(mutedIds.size).toBeGreaterThan(0);
  expect(admitted.every(row => !mutedIds.has(row.intentId))).toBe(true);
  expect(admitted.some(row => byBatch.get(row.batchId)?.tick > muted.tick)).toBe(true);
  for (const row of admitted) {
    const anchor = byBatch.get(row.batchId).audioAnchor, intent = byIntent.get(row.intentId);
    const host = anchor.hostMs + (intent.scoreTime.beat - anchor.beat) * 60000 / anchor.bpm;
    expect(row.sourceTargetFrame).toBe(Math.round((anchor.contextSeconds + (host + anchor.presentationDelayMs - anchor.correlationHostMs) / 1000) * anchor.sampleRate));
    expect(row.targetFrame).toBe(row.sourceTargetFrame); expect(row.repair).toBeNull();
  }
  await page.locator('#procgenPanic').click(); await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getPlaybackState().activeNotes)).toBe(0);
  await attach(info, nativeBrowser, replacement ? 'context-replacement' : 'listen-rearm', { before, disabled, muted, after, actual, incidentalHostGaps,
    rearm: { sameGeneration: true, sameBpm: true, sameSampleRate: true, contexts: after.contexts.length, mutedAttacks: mutedIds.size,
      admitted: new Set(admitted.map(row => row.intentId)).size, missedAttacksReplayed: 0, sourceTargetFramesChecked: admitted.length, terminalActiveNotes: 0 } });
});
