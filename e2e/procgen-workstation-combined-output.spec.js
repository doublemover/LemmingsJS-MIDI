import { expect, test } from './helpers/workstationValidation.js';

const setup = async (page, mode) => {
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=1&output=midi');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(async mode => {
    const previous = window.__PROCGEN_STUDIO__, lanes = window.__PROCGEN_LANES__, world = lanes.world;
    previous.transport.pause(); lanes.pause();
    const retired = previous.dispose(); await retired.completion;
    if (retired.outcome !== 'complete') throw new Error('The previous physical owner has unresolved retirement.');
    for (let step = 0; step < 180 && !world.actors.some(actor => !actor.removed && !actor.terminalReason); step++) world.step();
    const { createBrowserNotePreview } = await import('/js/app/midi-ui/browserNotePreview.js');
    const { createProcgenPhysicalPlayback } = await import('/js/app/procgen/workstation/ProcgenPhysicalPlayback.js');
    const { createProcgenPhysicalScoreClock } = await import('/js/app/procgen/workstation/ProcgenPhysicalScoreClock.js');
    const { createCausalMidiSink } = await import('/js/app/procgen/workstation/CausalMidiSink.js');
    const { createProcgenMidiPorts } = await import('/js/app/procgen/workstation/ProcgenMidiPorts.js');
    const { makeOutput } = await import('/test/support/midi-output.js');
    const { LemmingStateType } = await import('/js/lemmings/LemmingStateType.js');
    let authorized = false;
    const now = () => performance.now(), calls = [], receipts = [], rawMidi = [], facts = [];
    const soundLanes = [{ id: 'lane-1', channel: 1, outputId: null, gain: 1, pan: 0, mute: false, solo: false, instrumentRef: null }];
    const graph = { version: 1, revision: 1, instruments: [{ id: 'combined-native-builder', sourceKind: 'TerrainWorkCommitted', operationKind: 'build', pitchCents: 6000, velocity01: .6, role: 'percussion', route: 'local' }] };
    const audio = createBrowserNotePreview({ volume: .05, masterVolume: .1 }), ports = createProcgenMidiPorts({ now, createOutputAdmission: () => releasing => releasing || authorized });
    const output = makeOutput(Array.from({ length: 16 }, (_, index) => index + 1), calls, 'combined-virtual-port');
    ports.setNoteOutputs([output]); calls.length = 0;
    if (mode === 'midi-refused') ports.setNoteOutput(null);
    const midi = createCausalMidiSink({ ports, getLanes: () => soundLanes, isEnabled: () => true, now, onReceipt: receipt => rawMidi.push(receipt) });
    const timeline = createProcgenPhysicalScoreClock();
    const playback = createProcgenPhysicalPlayback({ audio, world, getLanes: () => soundLanes, getGraph: () => graph, scoreTimeline: timeline, now, additionalOutputs: [midi], onReceipt: receipt => receipts.push(receipt) });
    await playback.ready();
    const actor = world.actors.find(actor => !actor.removed && !actor.terminalReason);
    if (!actor) throw new Error('The combined native fixture requires a real actor.');
    actor.x = 100; actor.y = world.surfaceAt(actor.laneIndex, 100) - 1;
    actor.setAction(world.actions[LemmingStateType.BUILDING]); actor.frameIndex = 8;
    const f = window.combinedOutputFixture = { mode, world, audio, ports, midi, playback, timeline, calls, receipts, rawMidi, facts, retiredPrevious: retired.outcome, batches: [], intents: [], activated: false, peak: 0, finite: true, pcmWindows: 0 };
    const batchListener = batch => { f.batches.push(batch); facts.push(...batch.facts); f.intents.push(...playback.processBatch(batch, { bpm: 120, position: timeline.observe(batch, { bpm: 120 }) })); };
    world.soundEvents.onBatch.on(batchListener);
    f.run = async () => {
      if (mode === 'audio-suspended') await audio.getAudioContext().suspend();
      f.beforeTick = world.tickIndex; world.step(); f.afterTick = world.tickIndex;
      if (mode === 'cancel-before-submit') { const stopped = playback.stop(); await stopped.completion; f.stopOutcome = stopped.outcome; }
      const end = performance.now() + 350;
      while (performance.now() < end) {
        const sample = audio.inspectRender();
        if (sample) { f.pcmWindows++; f.peak = Math.max(f.peak, sample.peak); f.finite &&= Number.isFinite(sample.peak) && Number.isFinite(sample.rms); }
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      return { mode, beforeTick: f.beforeTick, afterTick: f.afterTick, facts: facts.map(fact => ({ eventId: fact.eventId, kind: fact.kind })), intents: f.intents,
        receipts, rawMidi, calls, peak: f.peak, finite: f.finite, pcmWindows: f.pcmWindows, activationTrusted: f.activationTrusted,
        context: { state: audio.getAudioContext().state, sampleRate: audio.getAudioContext().sampleRate }, stopOutcome: f.stopOutcome ?? null,
        diagnostics: playback.diagnostics(), previousOwnerRetirement: retired.outcome };
    };
    f.dispose = async () => {
      world.soundEvents.onBatch.off(batchListener);
      const physical = playback.dispose(); await physical.completion;
      const port = ports.dispose(); if (port?.completion) await port.completion;
      const local = audio.dispose(); await (local?.completion ?? local);
      return { physical: physical.outcome, port: port?.outcome ?? 'no-retirement-receipt', audio: audio.getState().retirement?.outcome ?? 'no-retirement-receipt', midi: midi.diagnostics(), audioState: audio.getState() };
    };
    const button = document.createElement('button'); button.textContent = 'Enable combined native output'; button.style.cssText = 'position:fixed;top:20px;left:20px;z-index:100000';
    button.addEventListener('click', async event => { f.activationTrusted = event.isTrusted; f.activated = await audio.enable(); if (f.activated) { authorized = true; if (mode !== 'midi-refused') ports.setNoteOutput(output); } });
    document.body.append(button);
  }, mode);
  await page.getByRole('button', { name: 'Enable combined native output', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.combinedOutputFixture.activated)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.combinedOutputFixture.playback.diagnostics().audioEnabled)).toBe(true);
};

for (const mode of ['both', 'midi-refused', 'audio-suspended', 'cancel-before-submit']) {
  test('native audio and production MIDI share one physical boundary: ' + mode, { tag: ['@boundary', '@workstation-physical-music', ...(mode === 'both' || mode === 'midi-refused' ? ['@workstation-local-audio'] : [])] }, async ({ page }, testInfo) => {
    test.setTimeout(60000); await setup(page, mode);
    let result, cleanup;
    try {
      result = await page.evaluate(() => window.combinedOutputFixture.run());
      expect(page.viewportSize()).toEqual({ width: 1920, height: 1080 });
      expect(result.previousOwnerRetirement).toBe('complete'); expect(result.activationTrusted).toBe(true);
      expect(result.afterTick).toBe(result.beforeTick + 1);
      expect(result.facts.some(fact => fact.kind === 'TerrainWorkCommitted')).toBe(true);
      const begin = result.intents.find(intent => intent.kind === 'begin'); expect(begin).toBeTruthy();
      const audio = result.receipts.find(receipt => receipt.intentId === begin.intentId && receipt.sinkId === 'physical-browser-audio');
      const midi = result.receipts.find(receipt => receipt.intentId === begin.intentId && receipt.sinkId === 'physical-midi:local');
      expect(audio).toBeTruthy(); expect(midi).toBeTruthy();
      for (const receipt of [audio, midi]) { expect(receipt).toMatchObject({ worldId: begin.worldId, generation: begin.generation, batchId: begin.batchId, onsetId: begin.onsetId, voiceId: begin.voiceId, sourceEventIds: begin.sourceEventIds }); }
      if (mode === 'audio-suspended') {
        expect(audio.status).toBe('rejected'); expect(audio.reason).toBe('clock-unavailable'); expect(['accepted', 'degraded']).toContain(midi.status); expect(result.context.state).toBe('suspended');
      } else {
        expect(['accepted', 'degraded']).toContain(audio.status); expect(audio.admission.timeDomain).toBe('audio-sample-frames');
        if (mode !== 'cancel-before-submit') { expect(result.pcmWindows).toBeGreaterThan(0); expect(result.finite).toBe(true); expect(result.peak).toBeGreaterThan(0); }
      }
      const notes = result.calls.filter(call => call.type === 'noteOn');
      if (mode === 'midi-refused') { expect(midi.status).toBe('rejected'); expect(notes).toHaveLength(0); }
      else if (mode === 'cancel-before-submit') { expect(result.stopOutcome).toBe('complete'); expect(notes).toHaveLength(0); expect(result.peak).toBe(0); expect(result.diagnostics.externalOutputs[0].ownedVoices).toBe(0); }
      else {
        expect(['accepted', 'degraded']).toContain(midi.status); expect(midi.admission.timeDomain).toBe('performance-microseconds'); expect(notes).toHaveLength(1);
        expect(result.receipts.some(receipt => receipt.intentId === begin.intentId && receipt.sinkId === midi.sinkId && receipt.ackState === 'driver-submitted')).toBe(true);
        expect(result.calls.filter(call => call.type === 'noteOff')).toHaveLength(1);
      }
      expect(result.diagnostics.pendingAdmissions).toBe(0);
    } finally { cleanup = await page.evaluate(() => window.combinedOutputFixture.dispose()); await testInfo.attach('combined-native-output.json', { contentType: 'application/json', body: JSON.stringify({ ...result, cleanup, viewport: page.viewportSize(), scope: 'One replacement physical owner, actual native AudioContext/oscillator/master PCM and production MIDI scheduler with virtual output. No physical receiver/acoustic qualification.' }) }); }
    expect(cleanup.physical).toBe('complete'); expect(cleanup.audioState.retirement?.outcome).toBe('complete'); expect(cleanup.midi.ownedVoices).toBe(0); expect(cleanup.audioState.sessionCount).toBe(0);
  });
}
