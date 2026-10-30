// The worker owns a single outstanding wake. A busy main thread can delay one
// delivery, but cannot accumulate an unbounded queue of obsolete callbacks.
const workerSource = `
let timer = null, epoch = null, pending = false, sequence = 0;
onmessage = event => {
  const message = event.data;
  if (message?.kind === 'ack') {
    if (message.epoch === epoch && message.sequence === sequence) pending = false;
    return;
  }
  if (message?.kind !== 'start') return;
  clearInterval(timer);
  epoch = message.epoch; pending = false; sequence = 0;
  timer = setInterval(() => {
    if (pending) return;
    pending = true;
    postMessage({ epoch, sequence: ++sequence, sourceTimeMs: (performance.timeOrigin || 0) + performance.now() });
  }, message.intervalMs);
};`;

export function createProcgenTimingDriver({ host = globalThis, intervalMs = 10 } = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs < 1 || intervalMs > 1000) throw new Error('Invalid timing driver interval.');
  let worker = null, timer = null, url = null, epoch = 0, mode = 'stopped', lastError = null;
  let wakes = 0, lateWakes = 0, lastSequence = 0;
  const delayBuckets = new Uint32Array(5);
  const now = () => host.performance?.now ? (host.performance.timeOrigin || 0) + host.performance.now() : Date.now();
  const stop = () => {
    epoch++;
    worker?.terminate(); worker = null;
    if (url) host.URL.revokeObjectURL(url);
    url = null;
    if (timer !== null) host.clearInterval(timer);
    timer = null; mode = 'stopped';
  };
  const diagnostics = () => Object.freeze({ epoch, mode, lastError, wakes, lateWakes, lastSequence,
    delayBuckets: Object.freeze([...delayBuckets]) });
  return {
    start(callback) {
      if (typeof callback !== 'function') throw new Error('Timing driver needs a callback.');
      stop();
      const activeEpoch = epoch;
      wakes = 0; lateWakes = 0; lastSequence = 0; delayBuckets.fill(0); lastError = null;
      const deliver = message => {
        if (epoch !== activeEpoch || message.epoch !== activeEpoch || message.sequence <= lastSequence) return;
        lastSequence = message.sequence; wakes++;
        const delay = Math.max(0, now() - message.sourceTimeMs);
        if (delay > intervalMs) lateWakes++;
        delayBuckets[delay < 5 ? 0 : delay < 20 ? 1 : delay < 50 ? 2 : delay < 250 ? 3 : 4]++;
        try { callback(message); } finally {
          if (epoch === activeEpoch && worker) worker.postMessage({ kind: 'ack', epoch: activeEpoch, sequence: message.sequence });
        }
      };
      if (host.Worker && host.Blob && host.URL?.createObjectURL) {
        try {
          url = host.URL.createObjectURL(new host.Blob([workerSource], { type: 'text/javascript' }));
          worker = new host.Worker(url);
          worker.onmessage = event => deliver(event.data || {});
          worker.onerror = () => {
            if (epoch !== activeEpoch) return;
            lastError = 'worker-runtime-failure'; stop(); callback({ suspended: true, reason: lastError, epoch: activeEpoch });
          };
          worker.postMessage({ kind: 'start', epoch: activeEpoch, intervalMs });
          mode = 'worker';
          return;
        } catch {
          lastError = 'worker-construction-failure';
          worker?.terminate(); worker = null;
          if (url) host.URL.revokeObjectURL(url);
          url = null;
        }
      }
      mode = 'fallback-timer';
      timer = host.setInterval(() => deliver({ epoch: activeEpoch, sequence: lastSequence + 1, sourceTimeMs: now() }), intervalMs);
      timer?.unref?.();
    },
    stop,
    dispose: stop,
    diagnostics
  };
}
