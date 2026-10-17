// A worker keeps wakeups independent of animation frames. Delayed delivery is
// detected by the transport, which stops instead of replaying a clock backlog.
export function createProcgenTimingDriver({ host = globalThis, intervalMs = 10 } = {}) {
  let worker = null, timer = null, url = null;
  const stop = () => {
    worker?.terminate(); worker = null;
    if (url) host.URL.revokeObjectURL(url);
    url = null;
    if (timer !== null) host.clearInterval(timer);
    timer = null;
  };
  return {
    start(callback) {
      stop();
      if (host.Worker && host.Blob && host.URL?.createObjectURL) {
        try {
          url = host.URL.createObjectURL(new host.Blob([
            'let timer; onmessage = event => { clearInterval(timer); timer = setInterval(() => postMessage(0), event.data); };'
          ], { type: 'text/javascript' }));
          worker = new host.Worker(url);
          worker.onmessage = () => callback();
          worker.onerror = () => { stop(); callback({ suspended: true }); };
          worker.postMessage(intervalMs);
          return;
        } catch { stop(); }
      }
      timer = host.setInterval(callback, intervalMs);
      timer?.unref?.();
    },
    stop,
    dispose: stop
  };
}
