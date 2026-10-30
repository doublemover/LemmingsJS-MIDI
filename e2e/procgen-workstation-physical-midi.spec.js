import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import JZZ from 'jzz';
import installSmf from 'jzz-midi-smf';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { revealWorkstationControl } from './helpers/workstationChrome.js';
import { parseSmf } from '../test/support/smf.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { armActualPhysicalClock, finishActualPhysicalClock, downloadActualPhysicalMidi, assertCapturedClockMidi } from './helpers/physicalMidiClock.js';
installSmf(JZZ);
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });

test('native physical MIDI retains captured tempo and speed changes, nominal Step and closed tick crops @boundary', async ({ page }, testInfo) => {
  test.setTimeout(180000); const armed = await armActualPhysicalClock(page, { action: true });
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__;
    studio.play(); api.pause(); api.step(24);
    studio.handlers.transport({ bpm: 175, speedMode: 'bpm', linked: true }); api.pause(); api.step(24); studio.transport.pause(); api.pause();
  });
  const pausedTick = await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex); await page.waitForTimeout(120);
  expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBe(pausedTick);
  await page.locator('#procgenStep').click(); expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBe(pausedTick + 1);
  await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__; studio.handlers.transport({ bpm: 93, speedMode: 'game', linked: false, gameSpeed: 5 }); studio.play(); api.pause(); api.step(47); });
  const actual = await finishActualPhysicalClock(page, armed.takeId), full = await downloadActualPhysicalMidi(page), checked = assertCapturedClockMidi(actual, full);
  expect(new Set(actual.clock.timeline.epochs[0].segments.map(segment => segment.tickDurationMs)).size).toBeGreaterThanOrEqual(3);
  expect(actual.batches.find(batch => batch.tick === pausedTick + 1).tickDurationMs).toBeCloseTo(60 / (175 / 120), 8);
  const active = new Set(); let start = null;
  for (let index = 0; index < actual.intents.length - 1; index++) {
    const intent = actual.intents[index]; if (intent.kind === 'begin') active.add(intent.voiceId); else if (intent.kind === 'end') active.delete(intent.voiceId);
    if (!active.size && actual.intents[index + 1].scoreTime.simTick > intent.scoreTime.simTick + 1) { start = intent.scoreTime.simTick + 1; break; }
  }
  expect(start).not.toBeNull();
  expect(actual.intents.some(intent => intent.kind === 'begin' && intent.scoreTime.simTick > start)).toBe(true);
  const crop = page.getByRole('checkbox', { name: 'Crop physical take MIDI', includeHidden: true }); await revealWorkstationControl(page, crop); await crop.check();
  await page.getByRole('spinbutton', { name: 'Physical MIDI crop start tick', exact: true }).fill(String(start));
  await page.getByRole('spinbutton', { name: 'Physical MIDI crop end tick', exact: true }).fill(String(actual.tick));
  const cropped = await downloadActualPhysicalMidi(page), checkedCrop = assertCapturedClockMidi(actual, cropped);
  expect(cropped.filename).toContain('-ticks-' + start + '-' + actual.tick); expect(cropped.manifest.cropSelection.excludedIntents).toBeGreaterThan(0);
  const previous = await page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().artifact.artifactId), crossing = actual.intents.find(intent => intent.kind === 'begin' && intent.mappingId === 'clock-held-walk');
  expect(crossing).toBeTruthy(); expect(actual.intents.find(intent => intent.kind === 'end' && intent.voiceId === crossing.voiceId).scoreTime.simTick).toBeGreaterThan(crossing.scoreTime.simTick + 1);
  await revealWorkstationControl(page, crop); await page.getByRole('spinbutton', { name: 'Physical MIDI crop start tick', exact: true }).fill(String(crossing.scoreTime.simTick + 1));
  const invalid = page.getByRole('button', { name: 'Physical take MIDI1', exact: true, includeHidden: true }); await revealWorkstationControl(page, invalid); await invalid.click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().preparation)).toBeNull();
  const after = await page.evaluate(() => ({ artifact: window.__PROCGEN_STUDIO__.getExportState().artifact.artifactId, project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex }));
  expect(after.artifact).toBe(previous); expect(after.project).toBe(actual.project); expect(after.tick).toBe(actual.tick);
  await testInfo.attach('actual-physical-midi-clock-crop', { body: JSON.stringify({ actual, full: checked, cropped: checkedCrop, rejectedCrossingPreserved: after, scope: 'Ordinary unposed actors; native nominal Step and crop controls; public transport changes with controlled actual tick batches; native IndexedDB reopen and dedicated export worker; independent SMF reader. No external receiver or hardware.' }), contentType: 'application/json' });
});

test('native physical MIDI preserves distinct source intervals through a controlled 200ms catch-up wake @boundary', async ({ page }, testInfo) => {
  test.setTimeout(120000); const armed = await armActualPhysicalClock(page, { speed: 10 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.play(); window.__PROCGEN_LANES__.resume(); });
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBeGreaterThanOrEqual(48);
  const gap = await page.evaluate(() => { const started = performance.now(), before = window.__PROCGEN_LANES__.world.tickIndex; while (performance.now() - started < 200) { /* Controlled host task stall. */ } return { requestedMs: 200, observedMs: performance.now() - started, tickBefore: before, tickAfterTask: window.__PROCGEN_LANES__.world.tickIndex }; });
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBeGreaterThanOrEqual(96);
  const actual = await finishActualPhysicalClock(page, armed.takeId), file = await downloadActualPhysicalMidi(page), checked = assertCapturedClockMidi(actual, file);
  const groups = new Map(); for (const batch of actual.batches) { const group = groups.get(batch.hostEventTimeMs) || []; group.push(batch); groups.set(batch.hostEventTimeMs, group); }
  const catchUp = [...groups.values()].filter(group => group.length > 1).sort((a, b) => b.length - a.length)[0];
  expect(gap.tickAfterTask).toBe(gap.tickBefore); expect(catchUp?.length).toBeGreaterThan(1);
  expect(new Set(catchUp.map(batch => batch.sourceTimeMs)).size).toBe(catchUp.length);
  expect(file.manifest.timing.quantization.collapsedDistinctTimes).toBe(0);
  await testInfo.attach('actual-physical-midi-catch-up', { body: JSON.stringify({ actual, gap, catchUp, file: checked, scope: 'Actual desktop timing driver and runtime pump after one controlled200ms main-thread stall; shared host wake retains distinct committed tick score times. Not OS background/suspension or listening qualification.' }), contentType: 'application/json' });
});

test('native physical MIDI excludes a controlled 500ms suspended host gap and requires explicit resume @boundary', async ({ page }, testInfo) => {
  test.setTimeout(120000); const armed = await armActualPhysicalClock(page);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.play(); window.__PROCGEN_LANES__.resume(); });
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBeGreaterThanOrEqual(24);
  const gap = await page.evaluate(() => { const started = performance.now(), before = window.__PROCGEN_LANES__.world.tickIndex; while (performance.now() - started < 500) { /* Controlled host task suspension. */ } return { requestedMs: 500, observedMs: performance.now() - started, tickBefore: before }; });
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.transport.getState().reason)).toBe('suspended');
  const halted = await page.evaluate(() => ({ state: window.__PROCGEN_STUDIO__.transport.getState(), tick: window.__PROCGEN_LANES__.world.tickIndex }));
  await page.waitForTimeout(100); expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBe(halted.tick); expect(halted.tick).toBe(gap.tickBefore); expect(halted.state.lastDiscontinuity.source).toBe('host-wake-gap');
  await page.locator('#procgenPause').click();
  await page.evaluate(() => { const api = window.__PROCGEN_LANES__; api.pause(); api.step(Math.max(1, 96 - api.world.tickIndex)); });
  const actual = await finishActualPhysicalClock(page, armed.takeId), file = await downloadActualPhysicalMidi(page), checked = assertCapturedClockMidi(actual, file);
  expect(actual.inputs.some(input => input.payload.kind === 'transport-state' && input.payload.playing === false)).toBe(true);
  await testInfo.attach('actual-physical-midi-suspended-gap', { body: JSON.stringify({ actual, gap, halted, file: checked, scope: 'Controlled500ms main-thread host gap through the actual transport driver; stops before physics catch-up and resumes through native Play world. Source-score export excludes unadvanced wall time. No OS sleep/background claim.' }), contentType: 'application/json' });
});

test('native physical MIDI preserves external clock stop, loss and Continue boundaries without stale physical catch-up @boundary', async ({ page }, testInfo) => {
  test.setTimeout(150000); await installWebMidiStub(page); const armed = await armActualPhysicalClock(page, { external: true });
  const locked = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__, midi = window.__WEBMIDI_STUB__;
    midi.sendInput([0xfb]); api.resume();
    for (let index = 0; index < 16; index++) { midi.sendInput([0xf8]); await new Promise(resolve => setTimeout(resolve, 20)); }
    return { state: studio.transport.getState(), tick: api.world.tickIndex };
  });
  expect(locked.state.clockStatus).toBe('locked'); expect(locked.tick).toBeGreaterThan(armed.tick);
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.transport.getState().reason), { timeout: 5000 }).toBe('clock-lost');
  const lost = await page.evaluate(() => ({ state: window.__PROCGEN_STUDIO__.transport.getState(), tick: window.__PROCGEN_LANES__.world.tickIndex }));
  await page.waitForTimeout(100); expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBe(lost.tick);
  const resumed = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__, midi = window.__WEBMIDI_STUB__; midi.sendInput([0xfb]); api.resume();
    for (let index = 0; index < 16; index++) { midi.sendInput([0xf8]); await new Promise(resolve => setTimeout(resolve, 24)); }
    midi.sendInput([0xfc]); return { state: studio.transport.getState(), tick: api.world.tickIndex };
  });
  expect(resumed.state.playing).toBe(false); expect(resumed.tick).toBeGreaterThan(lost.tick);
  await page.waitForTimeout(100); expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex)).toBe(resumed.tick);
  await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__; studio.handlers.transport({ clockSource: 'internal', bpm: 83 }); studio.play(); api.pause(); api.step(Math.max(1, 96 - api.world.tickIndex)); });
  const actual = await finishActualPhysicalClock(page, armed.takeId), file = await downloadActualPhysicalMidi(page), checked = assertCapturedClockMidi(actual, file);
  expect(actual.clock.timeline.epochs[0].segments.length).toBeGreaterThan(2);
  await testInfo.attach('actual-physical-midi-external-clock', { body: JSON.stringify({ actual, locked, lost, resumed, file: checked, scope: 'Controlled WebMIDI input port timestamps through actual MIDI parser/transport, native runtime, journal and dedicated export worker. Clock input is a declared stub; no physical MIDI device/receiver or listening claim.' }), contentType: 'application/json' });
});

test('native actual cohort generation transition exports separate captured MIDI epochs and reopens its source @boundary', async ({ page }, testInfo) => {
  test.setTimeout(180000); const armed = await armActualPhysicalClock(page, { generationFixture: true });
  const transition = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__; studio.play(); api.pause();
    const initial = api.world.generation; let steps = 0;
    while (api.world.generation === initial && steps < 384) { api.step(); steps++; }
    if (api.world.generation === initial) throw new Error('Natural bounded cohort cascade did not restart: ' + JSON.stringify(api.world.stall.snapshot(api.world.tickIndex)));
    const boundaryTick = api.world.tickIndex; api.step(96);
    return { initial, next: api.world.generation, boundaryTick, steps, sourceSetup: 'Controlled pre-take collision wall and declared stall thresholds; ordinary spawning, actions, cascade and restart; no actor posing or injected physical/semantic events.' };
  });
  const actual = await finishActualPhysicalClock(page, armed.takeId); expect(actual.batches.some(batch => batch.terminalGenerationTransition?.to === armed.generation + 1)).toBe(true);
  expect(actual.clock.timeline.epochs.length).toBeGreaterThanOrEqual(2);
  const first = assertCapturedClockMidi(actual, await downloadActualPhysicalMidi(page, { epochOrdinal: 1 })), second = assertCapturedClockMidi(actual, await downloadActualPhysicalMidi(page, { epochOrdinal: 2 }));
  expect(first.manifest.epochSelection.ordinal).toBe(1); expect(second.manifest.epochSelection.ordinal).toBe(2);
  expect(second.manifest.timing.origin.simTick).toBe(transition.boundaryTick); expect(second.manifest.timing.origin.beat).toBe(0);
  const replay = await page.evaluate(async () => { const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world, result = await studio.handlers.compareCausalTake(); return { receipt: result?.receipt || null, worldUnchanged: window.__PROCGEN_LANES__.world === world }; });
  expect(replay.receipt?.compatibilityMatch, JSON.stringify(replay.receipt)).toBe(true); expect(replay.worldUnchanged).toBe(true);
  await testInfo.attach('actual-generation-midi-epochs', { body: JSON.stringify({ actual, transition, files: [first, second], replay, scope: 'Native actual controlled-score cohort cascade and generation boundary, IndexedDB reopen, per-epoch chooser and dedicated export worker, independent SMF parsing and current-runtime compatibility comparison. No manually injected epochs, posed actors, exact-qualified or hardware claim.' }), contentType: 'application/json' });
});

test('native physical take MIDI revoice uses recorded clocks and independent melodic channels without live output @boundary', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    window.physicalMidiRequests = 0;
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.physicalMidiRequests++; throw new Error('Unexpected MIDI permission request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  const before = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    studio.dispatch({ type: 'procgen/physicalGraph', graph: { version: 1, revision: studio.getProject().procgen.physicalGraph.revision + 1,
      instruments: [{ id: 'midi-crossing', sourceKind: 'MotionCommitted', gateX: 40, crossingDirection: 'positive', pitchCents: 6012.34567,
        velocity01: 0.8, role: 'crossing', route: 'local' }] } });
    await studio.handlers.startCausalTake({ takeName: 'Actual physical MIDI revoice' });
    studio.play(); window.__PROCGEN_LANES__.pause(); window.__PROCGEN_LANES__.step(96); studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    await studio.handlers.stopCausalTake();
    const state = studio.handlers.causalTakeState(); if (!state.last?.takeId) throw new Error('Physical take did not finalize.');
    const capturedBpm = studio.transport.getState().bpm; studio.transport.configure({ bpm: 17 });
    return { project: JSON.stringify(studio.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex, takeId: state.last.takeId, capturedBpm, uiBpm: studio.transport.getState().bpm };
  });
  const program = page.getByRole('spinbutton', { name: 'Physical take MIDI program', includeHidden: true }); await revealWorkstationControl(page, program); await program.fill('25');
  const exportButton = page.getByRole('button', { name: 'Physical take MIDI1', exact: true, includeHidden: true }); await revealWorkstationControl(page, exportButton);
  const downloading = page.waitForEvent('download'); await exportButton.click(); const download = await downloading, bytes = await readFile(await download.path()), parsed = parseSmf(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(parsed.find(row => row.type === 1).data))), independent = new JZZ.MIDI.SMF(bytes);
  const notes = parsed.filter(row => (row.status & 0xf0) === 0x90);
  expect(notes.length).toBeGreaterThan(0); expect(manifest.takeId).toBe(before.takeId); expect(manifest.lowering.program).toBe(24);
  expect(manifest.lowering.evidence).toBe('new-midi1-revoice-not-submitted-output'); expect(manifest.timing.liveLatenessApplied).toBe(false);
  const tempoBytes = parsed.find(row => row.type === 0x51).data, initialTempo = tempoBytes[0] * 65536 + tempoBytes[1] * 256 + tempoBytes[2];
  expect(initialTempo).toBe(Math.round(60000000 / before.capturedBpm)); expect(initialTempo).not.toBe(Math.round(60000000 / before.uiBpm)); expect(manifest.lowering.losses.originalTimbreReplaced).toBe(true);
  expect(parsed.at(-1).tick).toBe(manifest.timing.endTick); expect(parsed.at(-1).tick).toBeGreaterThanOrEqual(notes.at(-1).tick);
  expect(Array.from(independent[0]).filter(row => (row[0] & 0xf0) === 0x90).map(row => row.tt)).toEqual(notes.map(row => row.tick));
  const after = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, before = studio.getExportState();
    const pending = studio.handlers.exportPhysicalTakeMidi(); studio.handlers.cancelExportDelivery(); await pending;
    await studio.handlers.exportPhysicalTakeMidi({ program: 999 });
    return { tick: window.__PROCGEN_LANES__.world.tickIndex, project: JSON.stringify(studio.getProject()), requests: window.physicalMidiRequests,
      preparationReceipt: before.preparationReceipt, previousRetained: before.artifact.artifactId === studio.getExportState().artifact.artifactId };
  });
  expect(after.tick).toBe(before.tick); expect(after.project).toBe(before.project); expect(after.requests).toBe(0); expect(after.previousRetained).toBe(true);
  expect(after.preparationReceipt.method).toBe('dedicated-worker'); expect(after.preparationReceipt.outputTransport.ownedTransferredBytes).toBe(bytes.length);
  await testInfo.attach('actual-physical-take-midi-revoice', { body: JSON.stringify({ before, after, manifest, independentReader: 'jzz-midi-smf@1.9.9/jzz@1.9.6',
    scope: 'Actual captured desktop physical phrase projected from verified semantic journal, captured clock, owned worker and MIDI1 revoice. No historical submitted trace, MPE/CI Profile, physical receiver or hardware setup/playback qualification.' }), contentType: 'application/json' });
});
test('native captured epoch chooser exports one closed score origin and cancels without replacing its prior file @boundary', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  const fixture = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    const load = relative => import(new URL(relative, window.location.href).href);
    const [{ createProcgenSessionStorage }, { createProcgenCausalJournal }, { createCausalTakeRecorder }, { createProcgenPhysicalScoreClock }, { createResourceBudget }] = await Promise.all([
      load('js/app/procgen/workstation/ProcgenSessionStorage.js'), load('js/app/procgen/workstation/ProcgenCausalJournal.js'), load('js/app/procgen/workstation/CausalTake.js'),
      load('js/app/procgen/workstation/ProcgenPhysicalScoreClock.js'), load('js/app/resources/ResourceBudget.js')]);
    const clock = createProcgenPhysicalScoreClock(), journal = createProcgenCausalJournal({ storage: createProcgenSessionStorage(indexedDB), resourceBudget: createResourceBudget() });
    clock.observe({ version: 1, worldId: 'epoch-fixture', generation: 1, tick: 0, sourceTimeMs: 0, tickDurationMs: 60 }, { bpm: 120 });
    const takeId = 'native-epoch-fixture', recorder = await createCausalTakeRecorder({ journal, takeId, documentId: 'epoch-fixture', sourceVersions: { source: 1 },
      mapping: { version: 1, revision: 1, instruments: [] }, initialCheckpoint: { tick: 0 }, boundaryState: { sourceTimeMs: 0, voices: [], timeline: clock.snapshot() } });
    let milliseconds = 0;
    for (let tick = 1; tick <= 12; tick++) {
      const generation = tick <= 5 ? 1 : 2, duration = tick <= 5 ? 60 : 30; milliseconds += duration;
      clock.observe({ version: 1, worldId: 'epoch-fixture', generation, tick, sourceTimeMs: milliseconds, tickDurationMs: duration }, { bpm: generation === 1 ? 120 : 90 });
      const kind = [2, 8].includes(tick) ? 'begin' : [4, 10].includes(tick) ? 'end' : null;
      const intents = kind ? [{ version: 1, kind, worldId: 'epoch-fixture', generation, batchId: 'epoch-batch-' + tick, intentId: 'epoch-intent-' + tick, voiceId: 'voice-' + generation,
        onsetId: 'voice-' + generation, laneId: 0, sourceEventIds: ['fact-' + tick], causalSequence: tick, pitch: { cents: generation === 1 ? 6000 : 6700, referenceHz: 440 }, velocity01: 0.75, expression: {},
        scoreTime: { ...clock.map({ simTick: tick }), sourceTimeMs: milliseconds } }] : [];
      recorder.recordCommittedBatch({ batch: { version: 1, worldId: 'epoch-fixture', generation, tick, batchId: 'epoch-batch-' + tick, facts: [], completeness: { status: 'complete', dropped: 0 },
        ...(tick === 5 ? { terminalGenerationTransition: { from: 1, to: 2, reason: 'fixture-generation-boundary' } } : {}) }, intents });
      if (tick === 5) clock.observe({ version: 1, worldId: 'epoch-fixture', generation: 2, tick, sourceTimeMs: milliseconds, tickDurationMs: 30 }, { bpm: 90 });
    }
    await recorder.stop({ boundaryState: { sourceTimeMs: milliseconds, voices: [], timeline: clock.snapshot() } });
    await studio.handlers.browseCausalTakes('first'); if (await studio.handlers.selectCausalTake(takeId) !== takeId) throw new Error('Stored epoch fixture was not selected.');
    return { takeId, tick: window.__PROCGEN_LANES__.world.tickIndex, project: JSON.stringify(studio.getProject()) };
  });
  const exportButton = page.getByRole('button', { name: 'Physical take MIDI1', exact: true, includeHidden: true }); await revealWorkstationControl(page, exportButton); await exportButton.click();
  const field = page.locator('.studio-midi-export-routes'); await expect(field.getByText('Choose captured clock epoch', { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download'); await field.getByRole('button', { name: /^Prepare clock epoch 2/ }).click();
  const download = await downloading, bytes = await readFile(await download.path()), parsed = parseSmf(bytes), manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(parsed.find(row => row.type === 1).data)));
  expect(download.suggestedFilename()).toContain('-epoch-2'); expect(manifest.epochSelection).toMatchObject({ ordinal: 2, available: 2, selectedIntents: 2, excludedIntents: 2 });
  expect(manifest.timing.origin.simTick).toBe(5); expect(manifest.timing.end.simTick).toBe(12);
  expect(parsed.filter(row => (row.status & 0xf0) === 0x90).map(row => row.data[0])).toEqual([67]);
  const previous = await page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().artifact.artifactId);
  await revealWorkstationControl(page, exportButton); await exportButton.click(); await expect(field.getByRole('button', { name: 'Cancel clock epoch choice', exact: true })).toBeVisible();
  await field.getByRole('button', { name: 'Cancel clock epoch choice', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getExportState().preparation)).toBeNull();
  const after = await page.evaluate(() => ({ artifact: window.__PROCGEN_STUDIO__.getExportState().artifact.artifactId, tick: window.__PROCGEN_LANES__.world.tickIndex, project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()) }));
  expect(after.artifact).toBe(previous); expect(after.tick).toBe(fixture.tick); expect(after.project).toBe(fixture.project);
  await testInfo.attach('captured-clock-epoch-midi-choice', { body: JSON.stringify({ fixture, after, manifest,
    scope: 'Controlled captured-clock/semantic fixture through native IndexedDB journal, owned worker and desktop epoch chooser. No actual generation-transition physics, receiver or hardware qualification.' }), contentType: 'application/json' });
});
