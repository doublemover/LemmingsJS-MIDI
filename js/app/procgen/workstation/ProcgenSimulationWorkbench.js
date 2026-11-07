import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
export function createProcgenSimulationWorkbench({ prepareHost, prepareOutput = null, getSourceIdentity = () => null, onState = () => {}, timers = globalThis } = {}) {
  if (typeof prepareHost !== 'function' || typeof getSourceIdentity !== 'function' || typeof onState !== 'function') throw new TypeError('A worker simulation workbench needs its canonical host preparer.');
  const recoveryFaults = new Set();
  let recovery = null, automaticRecovery = false, recoveryTimer = null, recoveryOriginTick = null, recoveryNotice = null;
  let directOutput = null, host = null, checkpoint = null, sourceIdentity = null, projection = null, pending = null, closing = null, disposed = false, phase = 'idle', failure = null, timer = null, viewport = {}, notifications = 0;
  const counts = { batches: 0, facts: 0, intents: 0, bodyCommands: 0, lastSequence: 0, lastTick: null, generation: null };
  const state = () => Object.freeze({ phase, busy: !!pending || !!closing, active: !!host || !!directOutput, checkpointHeld: !!checkpoint, checkpointReceipt: checkpoint?.receipt() || null, worker: host?.state() || null, failure,
    recovery: recovery?.receipt() || null, automaticRecovery: automaticRecovery && !directOutput, recoveryNotice, unresolvedRecovery: recoveryFaults.size, counts: Object.freeze({ ...counts }), liveViewport: host?.viewportState?.() || { active: false, phase: 'off', failure: null }, output: directOutput ? 'independent-native-worker' : 'off', nativeOutput: directOutput?.state() || null, journal: 'not-recording', mainWorld: 'retained-paused', defaultEnabled: false, performanceQualification: 'awaiting-consolidated-parity-and-latency-validation', notifications });
  const report = () => { if (disposed) return; notifications++; try { onState(state()); } catch {} };
  const scheduleReport = () => { scheduleRecovery(); if (disposed || timer !== null) return; timer = timers.setTimeout(() => { timer = null; report(); }, 250); };
  const run = (name, work) => {
    if (disposed || pending || closing) return Promise.reject(new Error('Finish the current worker simulation operation first.'));
    const operation = { controller: new AbortController(), promise: null }; pending = operation; phase = name; failure = null; report();
    operation.promise = Promise.resolve().then(() => work(operation)).catch(error => { failure = { code: error.code || error.name || 'worker-simulation', message: String(error.message || error).slice(0, 512) }; phase = host ? 'failed-paused' : 'failed'; throw error; })
      .finally(() => { if (pending === operation) pending = null; scheduleRecovery(); report(); }); return operation.promise;
  };
  const replaceProjection = async (target, options = viewport) => {
    const prepared = await target.project(options); projection?.release(); projection = prepared; viewport = { ...prepared.read().viewport };
    delete viewport.y; delete viewport.height; delete viewport.laneHeight;
  };
  const start = (options = {}) => run('preparing-worker', async operation => {
    if (host || checkpoint || directOutput) throw new Error('Close or adopt the current worker candidate/checkpoint before preparing another.');
    sourceIdentity = getSourceIdentity(); recoveryNotice = null;
    let candidate = null, outputCandidate = null;
    try {
      for (const key of Object.keys(counts)) counts[key] = ['lastTick', 'generation'].includes(key) ? null : 0;
      if (options.nativeOutput) { if (typeof prepareOutput !== 'function') throw new Error('Independent native output is unavailable.'); outputCandidate = await prepareOutput(); operation.controller.signal.throwIfAborted(); }
      candidate = await prepareHost({ ...(outputCandidate ? { requiredPorts: [outputCandidate.requiredPort] } : {}), signal: operation.controller.signal, consume: options.nativeOutput ? null : function(packet) {
        if (disposed || closing || packet.sequence !== counts.lastSequence + 1 || !Number.isSafeInteger(packet.batch?.tick) || !Array.isArray(packet.batch.facts) || !Array.isArray(packet.intents) || !Array.isArray(packet.bodyCommands)) throw new Error('The worker candidate observation lost its ordered canonical batch.');
        counts.batches++; counts.facts += packet.batch.facts.length; counts.intents += packet.intents.length; counts.bodyCommands += packet.bodyCommands.length;
        counts.lastSequence = packet.sequence; counts.lastTick = packet.batch.tick; counts.generation = packet.batch.generation;
        scheduleReport(); return { accepted: true, evidence: options.nativeOutput ? 'complete-canonical-packet-observed;independent-native-consumer-required;not-recording' : 'complete-canonical-packet-observed;output-and-recording-disabled' };
      }, onViewport: scheduleReport, onState(value) { if (value?.failure) { failure = value.failure; phase = 'failed-paused'; } scheduleReport(); } });
      operation.controller.signal.throwIfAborted();
      if (outputCandidate) await outputCandidate.attach(candidate.identity); operation.controller.signal.throwIfAborted();
      await replaceProjection(candidate, options.viewport || {}); operation.controller.signal.throwIfAborted();
      try { await candidate.watchViewport({ ...viewport, pixelWidth: 256, pixelHeight: 128 }); } catch (error) { if (candidate.state()?.failure) throw error; recoveryNotice = 'Live viewport unavailable: ' + error.message; } operation.controller.signal.throwIfAborted();
      host = candidate; candidate = null; directOutput = outputCandidate; outputCandidate = null; recoveryOriginTick = host.state()?.tick || 0; phase = 'paused'; return state();
    } finally { try { if (candidate) { projection?.release(); projection = null; const receipt = candidate.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') { host = candidate; throw Object.assign(new Error('Worker candidate retirement is unresolved.'), { retirement: receipt }); } } } finally { if (outputCandidate) { const receipt = outputCandidate.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') { directOutput = outputCandidate; throw Object.assign(new Error('Independent native source preparation retirement is unresolved.'), { retirement: receipt }); } } } }
  });
  const retainRecovery = () => directOutput ? pause() : run('retaining-worker-recovery', async operation => {
    if (!host || checkpoint || host.state()?.failure || getSourceIdentity() !== sourceIdentity) throw new Error('Retain a recovery point from the current unchanged worker source.');
    const wasRunning = !host.state().paused; if (wasRunning) await host.pause(); operation.controller.signal.throwIfAborted();
    let candidate = null;
    try {
      candidate = await host.captureRecoveryCheckpoint(); operation.controller.signal.throwIfAborted();
      if (getSourceIdentity() !== sourceIdentity) throw new Error('The prepared source project changed during recovery capture.');
      if (recovery && !recovery.release()) throw new Error('The previous recovery point did not retire.'); recovery = candidate; candidate = null; recoveryNotice = null;
      if (wasRunning) { await host.resume(); phase = 'running'; } else phase = 'paused'; return state();
    } catch (error) {
      if (host?.state()?.failure || operation.controller.signal.aborted || candidate) throw error;
      recoveryNotice = 'Recovery capture refused: ' + error.message + ' The worker remains paused; any previous point is retained.'; phase = 'paused'; return { status: 'refused', reason: recoveryNotice };
    } finally { if (candidate) try { candidate.release(); } catch (error) { recoveryFaults.add(candidate); throw error; } }
  });
  const scheduleRecovery = () => {
    if (directOutput || !automaticRecovery || recoveryTimer !== null || disposed || closing || pending || !host || host.state()?.paused || host.state()?.failure) return;
    const previous = recovery?.receipt()?.tick ?? recoveryOriginTick; if (previous == null || host.state().tick - previous < 256) return;
    recoveryTimer = timers.setTimeout(() => { recoveryTimer = null; if (!disposed && !closing && !pending && host && !host.state()?.paused) void retainRecovery().catch(() => {}); }, 0);
  };
  const recoverCheckpoint = () => run('recovering-worker-checkpoint', async operation => {
    if (!recovery || checkpoint || !host || getSourceIdentity() !== sourceIdentity) throw new Error('A current independently retained recovery point is required.');
    projection?.release(); projection = null; const receipt = host.dispose(); await receipt.completion; operation.controller.signal.throwIfAborted();
    if (receipt.outcome !== 'complete') throw Object.assign(new Error('The broken worker generation retains unresolved producers.'), { retirement: receipt });
    if (directOutput) { const outputReceipt = directOutput.dispose(); await outputReceipt.completion; if (outputReceipt.outcome !== 'complete') throw new Error('Native output retirement remains unconfirmed.'); directOutput = null; }
    host = null; checkpoint = recovery; recovery = null; failure = null; recoveryNotice = null; phase = 'checkpoint-held'; return state();
  });
  const advance = (steps = 32) => directOutput ? Promise.reject(new Error('Run independent native output in real time. Manual stepping belongs to the output-off candidate.')) : run('stepping-worker', async operation => {
    if (!host || !host.state()?.paused || !Number.isSafeInteger(steps) || steps < 1 || steps > 64) throw new Error('Step one to sixty-four ticks in a paused worker candidate.');
    await host.advance(steps); operation.controller.signal.throwIfAborted(); await replaceProjection(host); phase = 'paused'; return state();
  });
  const pause = () => directOutput ? run('parking-native-performance', async operation => { if (!host) throw new Error('The native worker source is unavailable.'); await host.pause(); operation.controller.signal.throwIfAborted(); return parkCheckpoint(operation); }) : run('pausing-worker', async operation => { if (!host) throw new Error('Prepare a worker candidate first.'); await host.pause(); operation.controller.signal.throwIfAborted(); await replaceProjection(host); phase = 'paused'; return state(); });
  const resume = () => run('starting-worker', async () => { if (!host) throw new Error('Prepare a worker candidate first.'); await host.resume(); phase = 'running'; return state(); });
  const project = (options = {}) => run('projecting-worker', async () => { if (!host || !host.state()?.paused) throw new Error('Pause the worker before selecting its completed viewport.'); await replaceProjection(host, options); await host.stopViewport(); try { await host.watchViewport({ ...viewport, pixelWidth: 256, pixelHeight: 128 }); } catch (error) { if (host.state()?.failure) throw error; recoveryNotice = 'Live viewport unavailable: ' + error.message; } phase = 'paused'; return state(); });
  const parkCheckpoint = async operation => {
    if (!host || !host.state()?.paused || checkpoint) throw new Error('Pause a current worker candidate before detaching its physical checkpoint.');
    projection?.release(); projection = null;
    const owned = await host.detachCheckpoint(); host = null;
    try { operation.controller.signal.throwIfAborted(); if (directOutput) { const receipt = directOutput.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw Object.assign(new Error('Native execution/grant closure remains unconfirmed.'), { retirement: receipt }); directOutput = null; } recovery?.release(); recovery = null; checkpoint = owned; phase = 'checkpoint-held'; return state(); }
    catch (error) { owned.release(); throw error; }
  };
  const detachCheckpoint = () => run('detaching-worker-checkpoint', parkCheckpoint);
  const publishCheckpoint = publish => run('publishing-worker', async operation => {
    if (!checkpoint || host || typeof publish !== 'function' || getSourceIdentity() !== sourceIdentity) throw new Error('Keep the prepared source project unchanged before adopting its worker checkpoint.');
    const result = await publish(checkpoint.read(), { signal: operation.controller.signal, receipt: checkpoint.receipt() });
    if (result) { checkpoint.release(); checkpoint = null; phase = 'published-paused'; } else phase = 'checkpoint-held'; return result;
  });
  const close = ({ retire = false, urgent = false } = {}) => {
    if (closing) return closing;
    if (recoveryTimer !== null) timers.clearTimeout(recoveryTimer); recoveryTimer = null;
    pending?.controller.abort(new Error('The worker simulation workbench retired.'));
    const operation = pending?.promise, producerRetirement = host?.dispose(), urgentOutputRetirement = urgent ? directOutput?.dispose() : null; phase = 'closing'; report();
    closing = (async () => {
      await operation?.catch(() => {}); projection?.release(); projection = null;
      if (producerRetirement) { await producerRetirement.completion; if (producerRetirement.outcome !== 'complete') throw Object.assign(new Error('The worker producer retains unresolved ownership.'), { retirement: producerRetirement }); }
      if (directOutput) { const receipt = urgentOutputRetirement || directOutput.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw new Error('The native output consumer retains unconfirmed device ownership.'); directOutput = null; }
      checkpoint?.release(); checkpoint = null; recovery?.release(); recovery = null; for (const point of recoveryFaults) { point.release(); recoveryFaults.delete(point); }
      if (host) { const receipt = host.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw Object.assign(new Error('The worker candidate retains unresolved ownership.'), { retirement: receipt }); host = null; }
      if (timer !== null) timers.clearTimeout(timer); timer = null; viewport = {}; phase = retire ? 'disposed' : 'closed'; disposed = retire; return state();
    })().catch(error => { failure = { code: 'worker-retirement-unknown', message: error.message }; phase = 'recovery-required'; throw error; }).finally(() => { closing = null; report(); }); return closing;
  };
  return Object.freeze({ state, start, advance, pause, resume, project, detachCheckpoint, publishCheckpoint, retainRecovery, recoverCheckpoint,
    setAutomaticRecovery(value) { if (disposed || typeof value !== 'boolean' || directOutput && value) throw new Error('Choose an explicit worker recovery policy.'); automaticRecovery = value; if (!value && recoveryTimer !== null) { timers.clearTimeout(recoveryTimer); recoveryTimer = null; } scheduleRecovery(); report(); return value; }, close, projection: () => host && !host.state()?.paused ? host.liveProjection?.()?.read() || null : projection?.read() || null, releaseVisualFrame: () => host?.releaseLiveProjection?.() || false,
    cancel() { if (!pending) return false; pending.controller.abort(new Error('Worker preparation canceled.')); return true; },
    dispose() { return createProcgenRetirementScope().retire([{ name: 'worker-simulation-workbench', run: () => close({ retire: true, urgent: true }) }]); } });
}
