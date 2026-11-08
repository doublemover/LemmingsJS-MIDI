// One unacknowledged wake bounds main-thread backpressure.
let timer = null, epoch = null, pending = false, sequence = 0;
globalThis.onmessage = event => {
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
    globalThis.postMessage({ epoch, sequence: ++sequence, sourceTimeMs: (performance.timeOrigin || 0) + performance.now() });
  }, message.intervalMs);
};
