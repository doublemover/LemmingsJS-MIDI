export async function createPhysicalAudioClockFixture({ sourceRoot, presentationDelayMs, copies = 1 }) {
  const [{ createBrowserNotePreview }, { createProcgenPhysicalPlayback }, { createProcgenPhysicalScoreClock }, { createResourceBudget }] = await Promise.all([
    import(new URL('js/app/midi-ui/browserNotePreview.js', sourceRoot)), import(new URL('js/app/procgen/workstation/ProcgenPhysicalPlayback.js', sourceRoot)),
    import(new URL('js/app/procgen/workstation/ProcgenPhysicalScoreClock.js', sourceRoot)), import(new URL('js/app/resources/ResourceBudget.js', sourceRoot))]);
  const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__, world = api.world;
  studio.transport.pause(); api.pause();
  if (!window.crossOriginIsolated || typeof window.SharedArrayBuffer !== 'function') throw new Error('The native clock observer requires its controlled isolated test document.');
  const observation = new Int32Array(new window.SharedArrayBuffer(16));
  if (world.tickIndex > 4 || world.laneCount !== 1 || !Number.isInteger(copies) || copies < 1 || copies > 4) throw new Error('Native clock fixture needs a fresh bounded ordinary world.');
  const budget = createResourceBudget({ limitBytes: 128 * 1048576 }), audio = createBrowserNotePreview({ resourceBudget: budget });
  const clock = createProcgenPhysicalScoreClock(), graph = { version: 1, revision: world.physicalAuthoring.graph.revision + 1,
    instruments: Array.from({ length: 8 }, (_, gate) => 40 + gate).flatMap((gateX, gate) => Array.from({ length: copies }, (_, copy) => ({ id: 'native-clock-' + gate + '-' + copy,
      sourceKind: 'MotionCommitted', sourceLanes: [0], gateX, crossingDirection: 'positive', pitchCents: 6000 + gate * 175, velocity01: 0.6, route: 'local', role: 'crossing' }))) };
  const previousSpeed = world.timer.speedFactor, receipts = [], intents = [], batches = [], probes = [], pending = new Map();
  let producing = false, preparingSource = true, sourcePreparation = null, allowed = true, failure = null, requestOrdinal = 0, zero = null, other = null, retired = false, preparedSourceTick = null;
  world.configurePhysicalAuthoring(graph); world.timer.speedFactor = 3;
  const playback = createProcgenPhysicalPlayback({ audio, world, resourceBudget: budget, presentationDelayMs, isPlaybackEnabled: () => allowed && audio.getState().enabled,
    getGraph: () => graph, getLanes: () => studio.getProject().procgen.lanes, scoreTimeline: clock, now: () => performance.now(), isEffectCaptureEnabled: () => false,
    onReceipt: receipt => { if (receipts.length >= 4096) throw new Error('Native clock receipt bound exceeded.'); receipts.push(receipt); } });
  const onBatch = batch => {
    try {
      const position = clock.observe(batch, { bpm: 120 });
      const processingStarted = performance.now();
      const output = playback.processBatch(batch, { bpm: 120, playing: producing || preparingSource, position }); intents.push(...output);
      const processingHostDurationMs = performance.now() - processingStarted;
      if (batches.length >= 512) throw new Error('Native clock source prefix exceeded its bound.');
      batches.push({ batchId: batch.batchId, worldId: batch.worldId, phase: preparingSource ? 'muted-preparation' : 'producing', processingHostDurationMs, tick: batch.tick, generation: batch.generation, position, sourceTimeMs: batch.sourceTimeMs, tickDurationMs: batch.tickDurationMs,
        anchors: playback.operationalState().clock.anchor, facts: batch.facts.filter(fact => fact.kind === 'MotionCommitted' && fact.positionAfter?.x >= 37 && fact.positionAfter?.x <= 48) });
    } catch (error) { failure ||= error; }
  };
  world.soundEvents.onBatch.on(onBatch);
  const step = () => { world.step(performance.now()); if (failure) throw failure; };
  const waitContext = async seconds => {
    const context = audio.getAudioContext(), started = performance.now();
    while (context.currentTime < seconds && context.state === 'running' && performance.now() - started < 3000) await new Promise(resolve => setTimeout(resolve, 2));
    if (context.state !== 'running' || context.currentTime < seconds) throw new Error('Native audio context did not reach its observed render boundary.');
  };
  const snapshot = async () => {
    const request = ++requestOrdinal;
    const values = await Promise.all(probes.map(probe => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(probe.id + ':' + request); reject(new Error('Native render probe did not acknowledge.')); }, 2000);
      pending.set(probe.id + ':' + request, value => { clearTimeout(timeout); resolve(value); });
      probe.node.port.postMessage({ kind: 'snapshot', request });
    })));
    return { schema: 'lemmings-native-physical-clock/v1', presentationDelayMs, viewport: { width: window.innerWidth, height: window.innerHeight }, context: { sampleRate: audio.getAudioContext().sampleRate,
      seconds: audio.getAudioContext().currentTime }, source: { worldId: world.worldId, generation: world.generation, tick: world.tickIndex,
      sourcePrecision: 'committed-tick-and-endpoint-crossing', nominalSpeed: 3, sourceProducer: 'cooperative-committed-batches;prepared-muted-prefix;original-clock-anchor-retained', sourcePreparation, preparedSourceTick, actorsPosed: false, processorsOverridden: false, graph }, batches, intents, receipts,
    nodes: probes.map((probe, index) => ({ ...probe.start, ...values[index] })), stops: window.__nativeClockObservation.stops, ends: window.__nativeClockObservation.ends,
    observer: { crossOriginIsolated: window.crossOriginIsolated, sharedBytes: observation.byteLength, warmed: probes.every(probe => Number.isSafeInteger(probe.readyFrame)), slots: probes.length,
      clock: 'native-audio-worklet-shared-observer', documentHeaders: window.__nativeClockHeaderReceipt },
    diagnostics: playback.diagnostics(), preview: audio.getState(), budget: budget.diagnostics() };
  };
  await playback.ready();
  const enable = async () => {
    while (!world.actors.some(actor => !actor.failureReason && actor.x >= 38 && actor.x < 40) && world.tickIndex < 128) step();
    if (world.tickIndex >= 128) throw new Error('Ordinary source did not reach the pre-gate boundary.');
    preparedSourceTick = world.tickIndex; preparingSource = false;
    sourcePreparation = Object.freeze({ kind: 'muted-committed-prefix', firstTick: batches[0]?.tick, lastTick: preparedSourceTick, processedBatches: batches.length,
      emittedIntents: intents.length, hasAudioContext: audio.getAudioContext() != null, audioEnabled: audio.getState().enabled, clockAnchored: playback.operationalState().clock.anchor != null });
    if (!sourcePreparation.processedBatches || sourcePreparation.emittedIntents || sourcePreparation.hasAudioContext || sourcePreparation.audioEnabled || sourcePreparation.clockAnchored) throw new Error('Native source preparation must remain muted and unanchored before the first gate.');
    if (!await audio.enable()) throw new Error('Private native audio owner was not enabled: ' + JSON.stringify(audio.getState()));
    const context = audio.getAudioContext();
    await context.audioWorklet.addModule('/e2e-portable/fixtures/clock-onset-probe.js');
    zero = context.createGain(); zero.gain.value = 0; zero.connect(context.destination);
    const ready = [];
    for (let id = 0; id < copies * 8; id++) {
      const node = new window.AudioWorkletNode(context, 'lemmings-clock-onset-probe', { processorOptions: { id, observation: observation.buffer }, numberOfInputs: 1, numberOfOutputs: 1 });
      const probe = { id, node, start: null, readyFrame: null }; probes.push(probe);
      let acknowledge, timeout;
      ready.push(new Promise((resolve, reject) => { acknowledge = resolve; timeout = setTimeout(() => reject(new Error('Native source observer did not enter its render loop.')), 2000); }));
      node.port.onmessage = event => {
        const value = event.data;
        if (value.kind === 'ready') { probe.readyFrame = value.frame; clearTimeout(timeout); acknowledge(); }
        else if (value.request) { pending.get(id + ':' + value.request)?.(value); pending.delete(id + ':' + value.request); }
        else probe.first = value.first;
      };
      node.connect(zero);
    }
    await Promise.all(ready); let nextProbe = 0;
    window.__nativeClockStartProbe = (oscillator, row) => {
      if (oscillator.context !== context) return;
      const probe = probes[nextProbe++]; if (!probe) throw new Error('Native source probe bound exceeded.');
      probe.start = { ...row, expectedFrame: Math.round(row.targetSeconds * row.sampleRate), submittedFrame: Math.round(row.submittedSeconds * row.sampleRate),
        renderFrameAtSubmission: window.Atomics.load(observation, 0), observerReadyFrame: probe.readyFrame };
      oscillator.connect(probe.node);
    };
    window.__nativeClockStopProbe = (oscillator, row, phase) => {
      if (oscillator.context !== context) return;
      row[phase === 'before' ? 'renderFrameBeforeStop' : 'renderFrameAfterStop'] = window.Atomics.load(observation, 0);
      if (phase === 'after') row.mainSecondsAfterStop = context.currentTime;
    };
    window.__nativeClockEndProbe = (oscillator, row) => { if (oscillator.context === context) row.renderFrameAtAcknowledgment = window.Atomics.load(observation, 0); };
    const started = performance.now();
    while (!playback.operationalState().audioEnabled && performance.now() - started < 2000) await new Promise(resolve => setTimeout(resolve, 0));
    if (!playback.operationalState().audioEnabled) throw new Error('Physical native owner did not arm.');
    return true;
  };
  return {
    enable, snapshot,
    async produce() {
      const started = performance.now();
      producing = true;
      let sliceStarted = performance.now();
      for (let count = 0; count < 16 && intents.filter(intent => intent.kind === 'begin').length < copies * 8; count++) {
        step();
        if (performance.now() - sliceStarted >= 8) {
          await new Promise(resolve => { const channel = new window.MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); }; channel.port2.postMessage(null); });
          sliceStarted = performance.now();
        }
      }
      if (intents.filter(intent => intent.kind === 'begin').length !== copies * 8 || probes.some(probe => !probe.start)) throw new Error('Native source onsets were not all admitted at their original times.');
      return { firstTargetSeconds: Math.min(...probes.map(probe => probe.start.targetSeconds)), lastTargetSeconds: Math.max(...probes.map(probe => probe.start.targetSeconds)),
        submittedSeconds: audio.getAudioContext().currentTime, producerHostDurationMs: performance.now() - started, onsets: probes.length, currentTick: world.tickIndex };
    },
    async stall(milliseconds) {
      const targets = [...new Set(probes.map(probe => probe.start.expectedFrame))].sort((a, b) => a - b), context = audio.getAudioContext();
      let target = targets.find(frame => frame > window.Atomics.load(observation, 0) + 512);
      if (target === undefined) throw new Error('No original scheduled source retains two render quanta of stall-observer lead.');
      const waiting = performance.now();
      while (window.Atomics.load(observation, 0) < target - 512 && performance.now() - waiting < 2000) await new Promise(resolve => setTimeout(resolve, 1));
      if (target < window.Atomics.load(observation, 0) + 256) target = targets.find(frame => frame > window.Atomics.load(observation, 0) + 512);
      if (target === undefined) throw new Error('The original scheduled-source observation window elapsed before the UI stall.');
      const before = window.Atomics.load(observation, 0), mainBefore = context.currentTime;
      window.Atomics.store(observation, 2, 0); window.Atomics.store(observation, 1, 1); const started = performance.now();
      try { while (performance.now() - started < milliseconds || window.Atomics.load(observation, 2) === 0 && performance.now() - started < milliseconds + 32) { /* Bounded observed render onset; original targets stay unchanged. */ } }
      finally { window.Atomics.store(observation, 1, 0); }
      const mainAfter = context.currentTime, observedMs = performance.now() - started, after = window.Atomics.load(observation, 0);
      await waitContext(Math.max(...probes.map(probe => probe.start.targetSeconds)) + 0.18);
      const onsetsWhileBlocked = window.Atomics.load(observation, 2);
      return { requestedMs: milliseconds, observedMs, maximumObservationOverrunMs: 32, stallTargetFrame: target, renderStartFrame: before, renderEndFrame: after, onsetsWhileBlocked, renderWindowClock: 'native-audio-worklet-shared-observer',
        mainThreadContextSeconds: { before: mainBefore, after: mainAfter }, snapshot: await snapshot() };
    },
    async cancel({ afterRender = false } = {}) {
      if (afterRender) await waitContext(Math.max(...probes.map(probe => probe.start.targetSeconds)) + 0.02);
      const context = audio.getAudioContext(), before = context.currentTime;
      allowed = false; const receipt = playback.stop(); await receipt.completion;
      if (receipt.outcome !== 'complete') throw new Error('Native clock owner stop retirement is unresolved.');
      await waitContext(Math.max(...probes.map(probe => probe.start.targetSeconds)) + 0.2);
      const waiting = performance.now(), timeoutMs = 2000;
      const missing = () => probes.filter(probe => !window.__nativeClockObservation.ends.some(end => end.ordinal === probe.start.ordinal)).map(probe => probe.start.ordinal);
      while (missing().length && performance.now() - waiting < timeoutMs) await new Promise(resolve => setTimeout(resolve, 10));
      const missingOrdinals = missing(), nativeEndWait = { elapsedMs: performance.now() - waiting, timeoutMs, complete: missingOrdinals.length === 0, missingOrdinals };
      return { nativeEndWait, mode: afterRender ? 'after-render-observed' : 'after-native-submission-before-start', requestedAtFrame: Math.round(before * context.sampleRate),
        retirement: { state: receipt.state, outcome: receipt.outcome }, snapshot: await snapshot() };
    },
    async unrelatedOwner() {
      const before = playback.operationalState().clock, context = audio.getAudioContext();
      other = audio.createSession('independent-clock-owner'); if (!await other.enable()) throw new Error('Unrelated native owner did not enable.');
      await other.stop(); const after = playback.operationalState().clock;
      await waitContext(Math.max(...probes.map(probe => probe.start.targetSeconds)) + 0.18);
      return { sameContext: audio.getAudioContext() === context, before, after, other: other.getState(), snapshot: await snapshot() };
    },
    async dispose() {
      if (retired) return; retired = true; window.__nativeClockStartProbe = null; window.__nativeClockStopProbe = null; window.__nativeClockEndProbe = null; world.soundEvents.onBatch.off(onBatch); world.timer.speedFactor = previousSpeed;
      const stopped = playback.dispose(); await stopped.completion; if (stopped.outcome !== 'complete') throw new Error('Private playback retirement is unresolved.');
      const otherClosing = other?.dispose(); await (otherClosing?.completion || otherClosing);
      for (const probe of probes) { probe.node.port.postMessage({ kind: 'retire' }); probe.node.disconnect(); probe.node.port.close(); }
      zero?.disconnect(); const closing = audio.dispose(); await (closing?.completion || closing);
      if (budget.diagnostics().accountedBytes !== 0) throw new Error('Native clock fixture retained audio resources.');
      return { accountedBytes: 0, retired: true };
    }
  };
}
