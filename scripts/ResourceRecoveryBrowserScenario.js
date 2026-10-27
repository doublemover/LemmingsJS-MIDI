// Serialized by Playwright into an isolated immutable-build browser context.
export async function runResourceRecoveryBrowserScenario({ laneCount, dpr, buildId, fixtures, origin }) {
  const studio = window.__PROCGEN_STUDIO__, initial = window.__PROCGEN_LANES__, budget = initial.renderer.resources.budgetAdapter;
  const { getActiveExecutionIdentity } = await import(new URL('./js/runtime/ActiveExecutionIdentity.js', window.location.href).href);
  const { createProcgenPattern } = await import(new URL('./js/app/procgen/workstation/ProcgenWorkstationProject.js', window.location.href).href);
  const { prepareProcgenRecoveryJournal } = await import(new URL('./js/app/procgen/workstation/ProcgenRecoveryCapture.js', window.location.href).href);
  const { createAudioAssetLoader } = await import(new URL('./js/app/midi-ui/AudioAssetLoader.js', window.location.href).href);
  const { backgroundWorkerAdmission } = await import(new URL('./js/app/resources/BackgroundWorkerAdmission.js', window.location.href).href);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms)), report = { laneCount, dpr, executionIdentity: getActiveExecutionIdentity(), observedLaneCount: initial.world.laneCount,
    observedDpr: window.devicePixelRatio, samples: { schedulingLatenessMs: [], clickPaintMs: [], frameGapMs: [] }, writes: [], pressure: null, candidate: null, sampleOverflow: false,
    nativeEstimates: 'Resource category cost factors include declared headroom, not measured browser/GPU/AudioBuffer heap.', contextLoss: 'synthetic lifecycle event; not native driver loss' };
  if (report.executionIdentity.buildId !== buildId || !budget?.inspectOwners) throw new Error('Resource scenario lacks its bound source or shared owner ledger.');
  let loader = null, pins = [], pulse = null, interval = null, frame = null, observer = null, sampling = false, sampleAt = performance.now(), frameAt = null;
  const push = (key, value) => { if (report.samples[key].length < 20000) report.samples[key].push(value); else report.sampleOverflow = true; };
  const owners = () => budget.inspectOwners({ maximum: 256 }); let overlapObserved = false, ownerCoverage = 'complete';
  const inspect = () => { const value = owners(); if (value.status !== 'complete') ownerCoverage = value.status;
    if (value.owners.some(owner => owner.owner === 'active-world') && value.owners.some(owner => owner.owner === 'candidate-world')) overlapObserved = true;
  };
  try {
    studio.transport.pause();
    const lanes = studio.getProject().procgen.lanes;
    for (let index = 0; index < lanes.length; index++) {
      const lane = lanes[index], pattern = createProcgenPattern(lane.family, lane.role); pattern.length = 64;
      pattern.steps = Array.from({ length: 64 }, (_, step) => ({ ...pattern.steps[step % 16] }));
      studio.dispatch({ type: 'procgen/lane', laneId: lane.id, patch: { mode: 'pattern', patternPurpose: 'Resource qualification complementary control fixture', patterns: Array.from({ length: 4 }, () => pattern) } });
      if (index % 8 === 7) await delay(0);
    }
    report.patternLength = 64; report.patternLanes = studio.getProject().procgen.lanes.filter(lane => lane.patterns.length === 4 && lane.patterns.every(pattern => pattern.length === 64)).length;
    const spans = [];
    for (let lane = 0; lane < 8; lane++) for (let y = 2; y < 18; y++) {
      for (let x = 128; x < 192; x += 32) initial.world.hasGroundAt(x, lane * initial.world.laneHeight + y);
      spans.push({ x1: 128, x2: 192, y: lane * initial.world.laneHeight + y });
    }
    const commandId = 'qualification:large-terrain', edit = initial.world.prepareIntervention({ id: commandId, kind: 'terrain-edit', target: { generation: initial.world.generation }, parameters: { terrain: {
      operation: 'addSolid', transactionId: commandId, generation: initial.world.generation, spans, materialId: 'qualification-fixture', tag: 'qualification-fill' } } });
    if (edit.outcome.status !== 'queued') throw new Error('Large terrain command was not admitted.'); edit.commit(); initial.world.step();
    report.terrainEditCells = initial.world.terrainScoreState.transactions.at(-1)?.solidAdded ?? 0;
    if (report.terrainEditCells < 4096) throw new Error('Large authored terrain fixture did not produce at least 4096 actual solid edits.');
    const decodeContext = new window.OfflineAudioContext(2, 1, 48000);
    loader = createAudioAssetLoader({ resourceBudget: budget, getContext: () => { throw new Error('Qualification must not open a live audio destination.'); }, fetchAsset: (ref, { signal }) => fetch(origin + '/fixtures/' + ref.contentHash + '.wav', { signal }) });
    for (const ref of fixtures) pins.push(await loader.acquire(ref, { owner: 'resource-qualification-bank', decodeContext, joinCancellation: true }));
    const duplicate = await loader.acquire(fixtures[0], { owner: 'resource-qualification-shared-pin', decodeContext, joinCancellation: true });
    report.refcountSharing = duplicate.buffer === pins[0].buffer; duplicate.release(); duplicate.release();
    studio.handlers.observe({ mode: 'overview' }); initial.renderer.cctv.setEnabled(true); initial.renderer.render(true);
    report.cctvViews = initial.renderer.cctv.views.size; report.bank = loader.diagnostics();
    const capture = await prepareProcgenRecoveryJournal(initial.world, { resourceBudget: budget, isCurrent: () => window.__PROCGEN_LANES__.world === initial.world && !studio.transport.getState().playing });
    report.capture = capture.stats().capture; report.initialBudget = budget.diagnostics();
    report.longTasks = []; report.longTaskObservation = window.PerformanceObserver.supportedEntryTypes.includes('longtask') ? 'supported' : 'unsupported';
    if (report.longTaskObservation === 'supported') { observer = new window.PerformanceObserver(list => { for (const entry of list.getEntries()) { if (report.longTasks.length < 2000) report.longTasks.push({ startTime: entry.startTime, duration: entry.duration }); else report.sampleOverflow = true; } }); observer.observe({ type: 'longtask', buffered: false }); }
    pulse = document.createElement('button'); pulse.id = 'resource-qualification-pulse'; pulse.textContent = 'Qualification interaction'; pulse.style.cssText = 'position:fixed;z-index:2147483647;left:8px;top:8px;width:220px;height:36px'; document.body.append(pulse);
    pulse.addEventListener('click', event => { if (!event.isTrusted) return; const at = performance.now(); requestAnimationFrame(() => push('clickPaintMs', performance.now() - at)); });
    sampling = true; window.__RESOURCE_QUALIFICATION_ACTIVE__ = true;
    const observeFrame = at => { if (!sampling) return; if (frameAt != null) push('frameGapMs', Math.max(0, at - frameAt)); frameAt = at; frame = requestAnimationFrame(observeFrame); }; frame = requestAnimationFrame(observeFrame);
    sampleAt = performance.now(); interval = setInterval(() => { const at = performance.now(); push('schedulingLatenessMs', Math.max(0, at - sampleAt - 8)); sampleAt = at; inspect(); }, 8);
    const startTick = initial.world.tickIndex; studio.play();
    for (let revision = 0; revision < 8; revision++) {
      await delay(250); const before = studio.getRecoveryState(); studio.dispatch({ type: 'procgen/lane', laneId: lanes[0].id, patch: { gain: .5 + revision / 16 } });
      const started = performance.now(), accepted = await studio.recover(), after = studio.getRecoveryState();
      report.writes.push({ accepted, elapsedMs: performance.now() - started, durable: after.lastCommit?.documentRevision === after.durableRevision && after.lastCommit?.generation === after.durableGeneration,
        state: after.state, tick: after.durableTick, revision: after.durableRevision, snapshotMs: after.snapshot.totalMs - before.snapshot.totalMs,
        encodeMs: after.storage.encodeMs - before.storage.encodeMs, commitMs: after.storage.commitMs - before.storage.commitMs, transactionMaximumSliceMs: after.storage.transactionMaximumSliceMs, maximumStoredPayloadBytes: after.storage.maximumStoredPayloadBytes,
        resultCopyMs: after.storage.resultCopyMs - before.storage.resultCopyMs, resultCopyMaximumSliceMs: after.storage.resultCopyMaximumSliceMs, resultCopyPackets: after.storage.resultCopyPackets - before.storage.resultCopyPackets,
        inputCopyMs: after.storage.inputCopyMs - before.storage.inputCopyMs, inputCopyMaximumSliceMs: after.storage.inputCopyMaximumSliceMs, inputCopyPackets: after.storage.inputCopyPackets - before.storage.inputCopyPackets,
        workerQueueWaitMs: after.storage.workerQueueWaitMs - before.storage.workerQueueWaitMs, encodedPages: after.storage.encodedPages - before.storage.encodedPages,
        reusedPages: after.storage.reusedPages - before.storage.reusedPages, retirement: after.retirement });
    }
    report.playingTickDelta = initial.world.tickIndex - startTick;
    const activePins = loader.diagnostics().activePins, pressureToken = {}; let allocated = false, rejected = false;
    try { budget.reserve({ token: pressureToken, owner: 'qualification-over-cap', category: 'other', bytes: budget.diagnostics().limitBytes + 1, pinned: true }); allocated = true; }
    catch (error) { rejected = error.name === 'ResourceBudgetError'; }
    finally { if (allocated) budget.release({ token: pressureToken, owner: 'qualification-over-cap' }); }
    const pressureTick = initial.world.tickIndex; await delay(250);
    report.pressure = { rejectedBeforeAllocation: rejected && !allocated, activeWorldPreserved: window.__PROCGEN_LANES__.world === initial.world, activePinsPreserved: loader.diagnostics().activePins === activePins, continuedTicks: initial.world.tickIndex - pressureTick };
    const renderer = initial.renderer; report.resizes = [];
    for (const [width, height] of [[720, 1440], [2560, 720], [1440, 1000]]) { const started = performance.now(); renderer.resize({ width: width * dpr, height: height * dpr }); report.resizes.push({ width, height, elapsedMs: performance.now() - started, display: renderer.getDisplayState(), budget: budget.diagnostics().accountedBytes }); await delay(50); }
    renderer.canvas.dispatchEvent(new Event('contextlost', { cancelable: true })); renderer.canvas.dispatchEvent(new Event('contextrestored')); await delay(100); report.displayAfterSyntheticLoss = renderer.getDisplayState();
    studio.transport.pause(); const previousWorld = window.__PROCGEN_LANES__.world, previousSeed = previousWorld.seed;
    const recoveryOverlap = studio.recover(); const candidate = await studio.handlers.seed((previousSeed + 1) >>> 0); const recoveryOverlapAccepted = await recoveryOverlap;
    const current = window.__PROCGEN_LANES__.world;
    report.candidate = { outcome: current !== previousWorld && current.seed === ((previousSeed + 1) >>> 0) ? 'committed' : current === previousWorld && candidate === false ? 'refused-with-current-world-preserved' : 'unknown',
      overlapObserved, ownerCoverage, recoveryOverlapAccepted, sourceSeed: previousSeed, resultingSeed: current.seed };
    studio.dispatch({ type: 'procgen/lane', laneId: lanes[0].id, patch: { gain: .91 } });
    const pausedAccepted = await studio.recover(); report.pausedRecovery = { accepted: pausedAccepted, playing: studio.transport.getState().playing, state: studio.getRecoveryState().state };
    report.budget = budget.diagnostics(); report.workers = backgroundWorkerAdmission.diagnostics(); report.finalOwners = owners(); report.finalBank = loader.diagnostics();
  } catch (error) { report.error = String(error.message); report.budget = budget.diagnostics(); }
  finally {
    window.__RESOURCE_QUALIFICATION_ACTIVE__ = false; sampling = false; clearInterval(interval); cancelAnimationFrame(frame); observer?.disconnect(); pulse?.remove(); studio.transport.pause();
    for (const pin of pins) pin.release(); pins = [];
    const receipt = loader?.dispose(); if (receipt) { await receipt.completion; report.cleanup = { outcome: receipt.outcome, bank: loader.diagnostics() }; } else report.cleanup = { outcome: 'complete', bank: null };
  }
  return report;
}
