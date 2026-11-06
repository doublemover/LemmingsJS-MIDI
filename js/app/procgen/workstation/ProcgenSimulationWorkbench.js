import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
export function createProcgenSimulationWorkbench({ prepareHost, onState = () => {}, timers = globalThis } = {}) {
  if (typeof prepareHost !== 'function' || typeof onState !== 'function') throw new TypeError('A worker simulation workbench needs its canonical host preparer.');
  let host = null, projection = null, pending = null, closing = null, disposed = false, phase = 'idle', failure = null, timer = null, viewport = {}, notifications = 0;
  const counts = { batches: 0, facts: 0, intents: 0, bodyCommands: 0, lastSequence: 0, lastTick: null, generation: null };
  const state = () => Object.freeze({ phase, busy: !!pending || !!closing, active: !!host, worker: host?.state() || null, failure,
    counts: Object.freeze({ ...counts }), output: 'off', journal: 'not-recording', mainWorld: 'retained-paused', defaultEnabled: false, performanceQualification: 'awaiting-consolidated-parity-and-latency-validation', notifications });
  const report = () => { if (disposed) return; notifications++; try { onState(state()); } catch {} };
  const scheduleReport = () => { if (disposed || timer !== null) return; timer = timers.setTimeout(() => { timer = null; report(); }, 250); };
  const run = (name, work) => {
    if (disposed || pending || closing) return Promise.reject(new Error('Finish the current worker simulation operation first.'));
    const operation = { controller: new AbortController(), promise: null }; pending = operation; phase = name; failure = null; report();
    operation.promise = Promise.resolve().then(() => work(operation)).catch(error => { failure = { code: error.code || error.name || 'worker-simulation', message: String(error.message || error).slice(0, 512) }; phase = host ? 'failed-paused' : 'failed'; throw error; })
      .finally(() => { if (pending === operation) pending = null; report(); }); return operation.promise;
  };
  const replaceProjection = async (target, options = viewport) => {
    const prepared = await target.project(options); projection?.release(); projection = prepared; viewport = { ...prepared.read().viewport };
    delete viewport.y; delete viewport.height; delete viewport.laneHeight;
  };
  const start = (options = {}) => run('preparing-worker', async operation => {
    if (host) throw new Error('Close the current worker candidate before preparing another.');
    let candidate = null;
    try {
      for (const key of Object.keys(counts)) counts[key] = ['lastTick', 'generation'].includes(key) ? null : 0;
      candidate = await prepareHost({ signal: operation.controller.signal, consume(packet) {
        if (disposed || closing || packet.sequence !== counts.lastSequence + 1 || !Number.isSafeInteger(packet.batch?.tick) || !Array.isArray(packet.batch.facts) || !Array.isArray(packet.intents) || !Array.isArray(packet.bodyCommands)) throw new Error('The worker candidate observation lost its ordered canonical batch.');
        counts.batches++; counts.facts += packet.batch.facts.length; counts.intents += packet.intents.length; counts.bodyCommands += packet.bodyCommands.length;
        counts.lastSequence = packet.sequence; counts.lastTick = packet.batch.tick; counts.generation = packet.batch.generation;
        scheduleReport(); return { accepted: true, evidence: 'complete-canonical-packet-observed;output-and-recording-disabled' };
      }, onState(value) { if (value?.failure) { failure = value.failure; phase = 'failed-paused'; } scheduleReport(); } });
      operation.controller.signal.throwIfAborted();
      await replaceProjection(candidate, options.viewport || {}); operation.controller.signal.throwIfAborted(); host = candidate; candidate = null; phase = 'paused'; return state();
    } finally { if (candidate) { projection?.release(); projection = null; const receipt = candidate.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') { host = candidate; throw Object.assign(new Error('Worker candidate retirement is unresolved.'), { retirement: receipt }); } } }
  });
  const advance = (steps = 32) => run('stepping-worker', async operation => {
    if (!host || !host.state()?.paused || !Number.isSafeInteger(steps) || steps < 1 || steps > 64) throw new Error('Step one to sixty-four ticks in a paused worker candidate.');
    await host.advance(steps); operation.controller.signal.throwIfAborted(); await replaceProjection(host); phase = 'paused'; return state();
  });
  const pause = () => run('pausing-worker', async operation => { if (!host) throw new Error('Prepare a worker candidate first.'); await host.pause(); operation.controller.signal.throwIfAborted(); await replaceProjection(host); phase = 'paused'; return state(); });
  const resume = () => run('starting-worker', async () => { if (!host) throw new Error('Prepare a worker candidate first.'); await host.resume(); phase = 'running'; return state(); });
  const project = (options = {}) => run('projecting-worker', async () => { if (!host || !host.state()?.paused) throw new Error('Pause the worker before selecting its completed viewport.'); await replaceProjection(host, options); phase = 'paused'; return state(); });
  const close = ({ retire = false } = {}) => {
    if (closing) return closing;
    pending?.controller.abort(new Error('The worker simulation workbench retired.'));
    const operation = pending?.promise; phase = 'closing'; report();
    closing = (async () => {
      await operation?.catch(() => {}); projection?.release(); projection = null;
      if (host) { const receipt = host.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw Object.assign(new Error('The worker candidate retains unresolved ownership.'), { retirement: receipt }); host = null; }
      if (timer !== null) timers.clearTimeout(timer); timer = null; viewport = {}; phase = retire ? 'disposed' : 'closed'; disposed = retire; return state();
    })().catch(error => { failure = { code: 'worker-retirement-unknown', message: error.message }; phase = 'recovery-required'; throw error; }).finally(() => { closing = null; report(); }); return closing;
  };
  return Object.freeze({ state, start, advance, pause, resume, project, close, projection: () => projection?.read() || null,
    cancel() { if (!pending) return false; pending.controller.abort(new Error('Worker preparation canceled.')); return true; },
    dispose() { return createProcgenRetirementScope().retire([{ name: 'worker-simulation-workbench', run: () => close({ retire: true }) }]); } });
}
