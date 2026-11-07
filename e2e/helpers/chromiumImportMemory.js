import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile), usageBytes = usage => usage.usedSize + usage.backingStorageSize;
async function processMemory(ids) {
  if (!ids.length || ids.length > 128 || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Invalid owned browser process inventory.');
  if (process.platform === 'win32') {
    const script = 'Get-Process -Id ' + ids.join(',') + ' -ErrorAction SilentlyContinue | Select-Object Id,@{Name=\'privateBytes\';Expression={$_.PrivateMemorySize64}},@{Name=\'residentBytes\';Expression={$_.WorkingSet64}} | ConvertTo-Json -Compress';
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 3000 });
    const values = stdout.trim() ? JSON.parse(stdout) : [];
    return { privateMetric: 'process-private-committed-bytes', processes: (Array.isArray(values) ? values : [values]).map(row => ({ pid: row.Id, privateBytes: row.privateBytes, residentBytes: row.residentBytes })) };
  }
  if (process.platform !== 'linux') throw new Error('Native process memory sampling requires Windows or Linux.');
  const processes = (await Promise.all(ids.map(async pid => {
    try {
      const text = await readFile('/proc/' + pid + '/smaps_rollup', 'utf8'), amount = name => Number(text.match(new RegExp('^' + name + ':\\s+(\\d+)', 'm'))?.[1] || 0) * 1024;
      return { pid, privateBytes: amount('Private_Clean') + amount('Private_Dirty'), residentBytes: amount('Rss') };
    } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
  }))).filter(Boolean);
  return { privateMetric: 'smaps-private-resident-bytes', processes };
}

// Read-only debugger observations: no forced GC, worker suspension, source
// replacement or runtime injection. OS process totals and V8 isolate heaps are
// separate measurements; neither is relabeled as the application's reservation.
export async function createChromiumImportMemorySampler(browser, page) {
  const root = await browser.newBrowserCDPSession(), main = await page.context().newCDPSession(page), started = performance.now();
  const workers = new Map(), pending = new Map(), heapSamples = [], processSamples = [], errors = [];
  let serial = 0, phase = 'baseline', stopped = false, heapWork = null, processWork = null, heapSkipped = 0, processSkipped = 0, truncated = false;
  const error = (kind, value) => { if (errors.length < 32) errors.push({ kind, phase, message: String(value?.message || value).slice(0, 240) }); };
  const received = event => {
    const message = JSON.parse(event.message), key = event.sessionId + ':' + message.id, work = pending.get(key);
    if (!work) return; pending.delete(key); clearTimeout(work.timer);
    if (message.error) work.reject(new Error(message.error.message)); else work.resolve(message.result);
  };
  const send = (worker, method) => new Promise((resolve, reject) => {
    const id = ++serial, key = worker.sessionId + ':' + id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error('Worker observation timed out.')); }, 1000);
    pending.set(key, { resolve, reject, timer });
    main.send('Target.sendMessageToTarget', { sessionId: worker.sessionId, message: JSON.stringify({ id, method }) }).catch(value => { clearTimeout(timer); pending.delete(key); reject(value); });
  });
  const attach = event => {
    const info = event.targetInfo;
    if (stopped || info.type !== 'worker' || workers.has(info.targetId)) return;
    if (workers.size >= 64) { truncated = true; return; }
    const worker = { targetId: info.targetId, url: info.url, active: true, samples: 0, unavailable: 0, peakUsedPlusBackingBytes: 0, sessionId: event.sessionId };
    workers.set(info.targetId, worker);
  };
  const changed = event => { const worker = workers.get(event.targetInfo.targetId); if (worker) worker.url = event.targetInfo.url; };
  const destroyed = event => {
    const worker = [...workers.values()].find(value => value.sessionId === event.sessionId); if (!worker) return; worker.active = false;
    for (const [key, work] of pending) if (key.startsWith(worker.sessionId + ':')) { clearTimeout(work.timer); pending.delete(key); work.reject(new Error('Observed worker retired.')); }
  };
  main.on('Target.receivedMessageFromTarget', received); main.on('Target.attachedToTarget', attach); main.on('Target.detachedFromTarget', destroyed);
  root.on('Target.targetInfoChanged', changed);
  await root.send('Target.setDiscoverTargets', { discover: true });
  await main.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: false, filter: [{ type: 'worker' }, { exclude: true }] });
  const heapSample = async () => {
    const samplePhase = phase, requestedAtMs = performance.now() - started;
    const usage = await main.send('Runtime.getHeapUsage'), values = [];
    await Promise.all([...workers.values()].filter(worker => worker.active && worker.sessionId).map(async worker => {
      try { const usage = await send(worker, 'Runtime.getHeapUsage'); worker.samples++; worker.peakUsedPlusBackingBytes = Math.max(worker.peakUsedPlusBackingBytes, usageBytes(usage)); values.push({ targetId: worker.targetId, ...usage }); }
      catch { worker.unavailable++; }
    }));
    if (heapSamples.length >= 8192) { truncated = true; return; }
    heapSamples.push({ elapsedMs: performance.now() - started, requestedAtMs, phase: samplePhase, phaseAtCompletion: phase, main: usage, workers: values, combinedUsedPlusBackingBytes: usageBytes(usage) + values.reduce((sum, value) => sum + usageBytes(value), 0) });
  };
  const nativeSample = async () => {
    const samplePhase = phase, requestedAtMs = performance.now() - started;
    const inventory = (await root.send('SystemInfo.getProcessInfo')).processInfo, ids = [...new Set(inventory.map(info => info.id))];
    const result = await processMemory(ids);
    if (processSamples.length >= 2048) { truncated = true; return; }
    processSamples.push({ elapsedMs: performance.now() - started, requestedAtMs, phase: samplePhase, phaseAtCompletion: phase, ...result, privateBytes: result.processes.reduce((sum, row) => sum + row.privateBytes, 0), residentBytes: result.processes.reduce((sum, row) => sum + row.residentBytes, 0) });
  };
  await heapSample(); await nativeSample();
  const scheduleHeap = () => { if (heapWork) { heapSkipped++; return; } heapWork = heapSample().catch(value => error('main-heap', value)).finally(() => { heapWork = null; }); };
  const scheduleProcess = () => { if (processWork) { processSkipped++; return; } processWork = nativeSample().catch(value => error('process-memory', value)).finally(() => { processWork = null; }); };
  const heapTimer = setInterval(scheduleHeap, 25), processTimer = setInterval(scheduleProcess, 250);
  return { mark(value) { phase = value; }, async finish() {
    stopped = true; clearInterval(heapTimer); clearInterval(processTimer); await Promise.allSettled([heapWork, processWork].filter(Boolean));
    try { await heapSample(); await nativeSample(); } catch (value) { error('final-sample', value); }
    main.off('Target.receivedMessageFromTarget', received); main.off('Target.attachedToTarget', attach); main.off('Target.detachedFromTarget', destroyed); root.off('Target.targetInfoChanged', changed);
    for (const work of pending.values()) { clearTimeout(work.timer); work.reject(new Error('Memory observation finished.')); } pending.clear();
    for (const result of await Promise.allSettled([main.detach(), root.detach()])) if (result.status === 'rejected') error('debugger-detach', result.reason);
    return { schema: 'chromium-import-memory/v1', platform: process.platform, heapIntervalMs: 25, processIntervalMs: 250, heapSkipped, processSkipped, truncated, errors,
      workers: [...workers.values()].map(({ sessionId, ...worker }) => worker), heapSamples, processSamples,
      scope: 'Observed maxima at the recorded cadence, without forced GC. V8 used heap plus ArrayBuffer/external-string backing is separate from whole owned-browser OS process totals. Windows private commit and Linux private resident bytes are named separately. Not an exact instantaneous peak or a replacement for shared resource admission.' };
  } };
}
