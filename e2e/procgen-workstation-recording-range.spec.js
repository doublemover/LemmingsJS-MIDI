import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('recording range refresh cancels only active/future ownership in the production workstation', { tag: '@boundary' }, async ({ page }) => {
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  const result = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause(); studio.handlers.record(true);
    for (let index = 0; index < 1000; index++) studio.ports.recordEvent({ type: 'cc', controller: 74, value: index % 128, timestamp: index, beat: 0 });
    const now = performance.now(); studio.ports.recordOutput({ note: 60, timeMs: now + 1000, durationMs: 500 });
    studio.ports.recordOutput({ note: 64, timeMs: now - 100, durationMs: 500 });
    const before = studio.ports.getRecordingIndexState(); studio.handlers.stopOutput(); const state = studio.ports.getState(), after = studio.ports.getRecordingIndexState();
    studio.handlers.stopOutput();
    return { count: state.recordedEvents, repeated: studio.ports.getState().recordedEvents, visits: after.scannedEvents - before.scannedEvents,
      repeatedVisits: studio.ports.getRecordingIndexState().scannedEvents - after.scannedEvents };
  });
  expect(result.count).toBe(1003); expect(result.repeated).toBe(result.count); expect(result.visits).toBeLessThanOrEqual(256); expect(result.repeatedVisits).toBe(0);
});
test('benchmark recording flush and Panic over1k–1m retained events at fixed active/future counts', { tag: '@benchmark' }, async ({ page, context, browser }, testInfo) => {
  test.skip(process.env.LEMMINGS_RECORDING_BENCH !== '1', 'Explicit large-history recording-owner qualification.'); test.setTimeout(240000);
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  const session = await context.newCDPSession(page);
  await page.exposeFunction('__recordingRangeHeap', async () => { await session.send('HeapProfiler.collectGarbage'); return session.send('Runtime.getHeapUsage'); });
  try {
    const result = await page.evaluate(async () => {
      const root = new URL('./', location.href), { createProcgenMidiPorts } = await import(new URL('js/app/procgen/workstation/ProcgenMidiPorts.js', root));
      const { createResourceBudget } = await import(new URL('js/app/resources/ResourceBudget.js', root));
      const { benchmarkRecordingRanges } = await import('/test/support/recording-range-benchmark.js');
      return benchmarkRecordingRanges({ createPorts: createProcgenMidiPorts, createBudget: createResourceBudget, collectMemory: () => window.__recordingRangeHeap(),
        onProgress: progress => { window.__recordingRangeProgress = progress; } });
    });
    expect(result.profiles.map(profile => profile.history)).toEqual([1000, 10000, 100000, 1000000]);
    expect(result.profiles.every(profile => profile.maximumRescannedEvents <= 256 && profile.retained === profile.history + profile.iterations * 2)).toBe(true);
    await testInfo.attach('browser-recording-range-benchmark', { body: JSON.stringify({ ...result, environment: { browser: browser.version(), viewport: page.viewportSize(), source: 'built-browser-runtime', heap: 'CDP after explicit collection' } }), contentType: 'application/json' });
  } finally { await session.detach(); }
});

test('benchmark trusted Pause Stop and Panic button tails over retained workstation history', { tag: '@benchmark' }, async ({ page, context, browser }, testInfo) => {
  test.skip(process.env.LEMMINGS_RECORDING_BENCH !== '1', 'Explicit production UI latency and allocation qualification.'); test.setTimeout(240000);
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => {
    const cue = document.querySelector('.studio-scene-cue');
    for (const name of ['Pause', 'Stop', 'Panic']) { const button = Array.from(cue.querySelectorAll('button')).find(button => button.textContent === name); button.dataset.recordingProbe = name.toLowerCase(); }
  });
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    const probe = window.recordingButtonProbe = { armed: null, completed: null, longTasks: [], world: window.__PROCGEN_LANES__.world, tick: window.__PROCGEN_LANES__.world.tickIndex };
    if (window.PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      probe.observer = new window.PerformanceObserver(list => { for (const entry of list.getEntries()) probe.longTasks.push({ startTime: entry.startTime, duration: entry.duration }); });
      probe.observer.observe({ type: 'longtask' });
    }
    document.addEventListener('pointerdown', event => {
      const target = event.target.closest?.('button'), sample = probe.armed;
      if (sample && target?.dataset.recordingProbe === sample.button) { sample.pointerAt = performance.now(); sample.pointerEventAt = event.timeStamp; sample.trustedPointer = event.isTrusted; }
    }, true);
    document.addEventListener('click', event => {
      const target = event.target.closest?.('button'), sample = probe.armed;
      if (!sample || target?.dataset.recordingProbe !== sample.button) return;
      sample.trustedClick = event.isTrusted; sample.active = navigator.userActivation.isActive;
      setTimeout(() => { sample.postClickTaskAt = performance.now(); }, 0);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        sample.secondFrameAt = performance.now(); const state = studio.ports.getState(), index = studio.ports.getRecordingIndexState();
        sample.rescannedEvents = index.scannedEvents - sample.beforeScans; sample.recordedEvents = state.recordedEvents;
        probe.completed = sample; probe.armed = null;
      }));
    }, true);
  });
  const session = await context.newCDPSession(page), memory = async () => { await session.send('HeapProfiler.collectGarbage'); return session.send('Runtime.getHeapUsage'); };
  const profiles = [], iterations = 192, buttons = ['pause', 'stop', 'panic'];
  const summarize = values => {
    const sorted = [...values].sort((a, b) => a - b), at = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    return { samples: values.length, p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maximumMs: sorted.at(-1) };
  };
  try {
    for (const history of [1000, 10000, 99000]) {
      await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__; studio.handlers.record(false); studio.handlers.clearMidiRecording(); });
      const memoryBefore = await memory();
      await page.evaluate(async history => {
        const studio = window.__PROCGEN_STUDIO__; studio.handlers.record(true);
        for (let first = 0; first < history; first += 4096) {
          for (let index = first; index < Math.min(history, first + 4096); index++) if (!studio.ports.recordEvent({ type: 'cc', controller: 74, value: index % 128, timestamp: index % 1000, beat: 0 })) throw new Error('Retained UI history was refused.');
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        window.recordingButtonProbe.longTasks.length = 0;
      }, history);
      await page.evaluate(async () => { await window.__PROCGEN_STUDIO__.handlers.stage(); });
      const memoryLoaded = await memory(), samples = [];
      for (let round = 0; round < iterations; round++) {
        const button = buttons[round % buttons.length], id = history + ':' + round;
        await page.evaluate(({ id, button }) => {
          const ports = window.__PROCGEN_STUDIO__.ports, now = performance.now();
          if (!ports.recordOutput({ note: 60, channel: 1, velocity: 90, timeMs: now + 60000, durationMs: 500 }) ||
              !ports.recordOutput({ note: 64, channel: 1, velocity: 90, timeMs: Math.max(0, now - 100), durationMs: 60000 })) throw new Error('Active/future UI fixture was refused.');
          const probe = window.recordingButtonProbe; probe.completed = null; probe.armed = { id, button, beforeScans: ports.getRecordingIndexState().scannedEvents };
        }, { id, button });
        await page.locator('[data-recording-probe="' + button + '"]').click(); await page.waitForFunction(id => window.recordingButtonProbe.completed?.id === id, id);
        const sample = await page.evaluate(() => window.recordingButtonProbe.completed);
        expect(sample.trustedClick && sample.trustedPointer && sample.active).toBe(true); expect(sample.rescannedEvents).toBeLessThanOrEqual(256);
        expect(sample.recordedEvents).toBe(history + 1 + (round + 1) * 2); expect(sample.postClickTaskAt).toBeGreaterThanOrEqual(sample.pointerAt);
        samples.push(sample);
      }
      const source = await page.evaluate(history => {
        const studio = window.__PROCGEN_STUDIO__, rows = studio.ports.getRecording(), controls = rows.filter(row => row.data?.[0] === 0xb0 && row.data[1] === 74), probe = window.recordingButtonProbe;
        if (controls.length !== history || controls[0].data[2] !== 0 || controls.at(-1).data[2] !== (history - 1) % 128) throw new Error('UI latency measurement lost historical data.');
        return { recordedEvents: rows.length, capacity: studio.ports.getState().recordingCapacity, index: studio.ports.getRecordingIndexState(), longTasks: probe.longTasks,
          sameWorld: probe.world === window.__PROCGEN_LANES__.world, sameTick: probe.tick === probe.world.tickIndex };
      }, history);
      expect(source.sameWorld && source.sameTick).toBe(true);
      const memoryAfterClicks = await memory();
      await page.evaluate(async () => { const studio = window.__PROCGEN_STUDIO__; await studio.handlers.stage(); studio.handlers.record(false); studio.handlers.clearMidiRecording(); });
      const memoryRetired = await memory(), operations = {};
      for (const name of buttons) {
        const button = name;
        const group = samples.filter(sample => sample.button === button);
        operations[name] = { postClickTask: summarize(group.map(sample => sample.postClickTaskAt - sample.pointerAt)), secondAnimationFrame: summarize(group.map(sample => sample.secondFrameAt - sample.pointerAt)),
          maximumRescannedEvents: Math.max(...group.map(sample => sample.rescannedEvents)) };
      }
      profiles.push({ history, iterations, fixedOutstanding: { active: 1, future: 1 }, operations, source, memoryBefore, memoryLoaded, memoryAfterClicks, memoryRetired,
        observedLongTasksDuringSamples: source.longTasks.filter(task => samples.some(sample => task.startTime <= sample.secondFrameAt && task.startTime + task.duration >= sample.pointerAt)) });
    }
    await testInfo.attach('playwright-recording-button-tail-benchmark', { body: JSON.stringify({ schema: 'lemmings-recording-button-tail/v1', profiles,
      environment: { browser: browser.version(), viewport: page.viewportSize(), source: 'built-browser-runtime', heap: 'CDP after explicit collection' },
      scope: 'Trusted Playwright pointer/click through real Stage Pause/Stop/Panic controls to a post-click task and second animation-frame callback, with paused physics and fixed active/future recording ownership. Observed p95/p99 over64samples per operation; no monitor-presentation, strict realtime, hardware or acoustic claim.',
      capacity: 'Production UI retains at most100000 records;99000 leaves room for fixed active/future samples. The separate owner benchmark covers exact100k/1m histories.' }), contentType: 'application/json' });
  } finally { await page.evaluate(() => window.recordingButtonProbe?.observer?.disconnect()); await session.detach(); }
});

test('Panic completes while a real IndexedDB document transaction remains pending @boundary', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause(); studio.handlers.record(true);
    for (let index = 0; index < 10000; index++) studio.ports.recordEvent({ type: 'cc', controller: 74, value: index % 128, timestamp: index % 1000, beat: 0 });
    const probe = window.recordingStorageProbe = { keepAlive: true, held: null, documentWriteIssued: false, completed: false, aborted: false, requests: 0,
      world: window.__PROCGEN_LANES__.world, tick: window.__PROCGEN_LANES__.world.tickIndex,
      transaction: window.IDBDatabase.prototype.transaction, put: window.IDBObjectStore.prototype.put };
    window.IDBDatabase.prototype.transaction = function(names, mode, ...options) {
      const transaction = probe.transaction.call(this, names, mode, ...options), stores = typeof names === 'string' ? [names] : Array.from(names);
      if (probe.held || mode !== 'readwrite' || !stores.includes('sessions') || !stores.includes('projectMetadata')) return transaction;
      probe.held = transaction;
      transaction.addEventListener('complete', () => { probe.completed = true; }); transaction.addEventListener('abort', () => { probe.aborted = true; });
      const store = transaction.objectStore('sessions'), pump = () => {
        const request = store.get('recording-backpressure-sentinel'); request.addEventListener('success', () => { probe.requests++; if (probe.keepAlive) pump(); });
      };
      pump(); return transaction;
    };
    window.IDBObjectStore.prototype.put = function(value, ...options) {
      if (this.transaction === probe.held && this.name === 'sessions' && value?.kind === 'document') probe.documentWriteIssued = true;
      return probe.put.call(this, value, ...options);
    };
    probe.pendingSave = studio.handlers.save();
  });
  try {
    const dialog = page.getByRole('dialog', { name: 'Project name', exact: true }); await dialog.getByRole('textbox').fill('Panic with pending storage');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForFunction(() => window.recordingStorageProbe.documentWriteIssued);
    const before = await page.evaluate(() => {
      const ports = window.__PROCGEN_STUDIO__.ports, now = performance.now();
      ports.recordOutput({ note: 60, channel: 1, velocity: 90, timeMs: now + 60000, durationMs: 500 });
      ports.recordOutput({ note: 64, channel: 1, velocity: 90, timeMs: now - 100, durationMs: 60000 });
      return { count: ports.getState().recordedEvents, scans: ports.getRecordingIndexState().scannedEvents, document: window.__PROCGEN_STUDIO__.getDocumentState() };
    });
    await page.locator('#procgenPanic').click();
    const after = await page.evaluate(() => {
      const studio = window.__PROCGEN_STUDIO__, probe = window.recordingStorageProbe, state = studio.ports.getState();
      return { count: state.recordedEvents, scans: studio.ports.getRecordingIndexState().scannedEvents, pending: !probe.completed && !probe.aborted,
        sameWorld: probe.world === window.__PROCGEN_LANES__.world, sameTick: probe.tick === probe.world.tickIndex, keepAliveRequests: probe.requests };
    });
    expect(after.pending && after.sameWorld && after.sameTick).toBe(true); expect(after.keepAliveRequests).toBeGreaterThan(0);
    expect(after.count).toBe(before.count - 2); expect(after.scans - before.scans).toBeLessThanOrEqual(256);
    const committed = await page.evaluate(async () => {
      const probe = window.recordingStorageProbe; probe.keepAlive = false; const saved = await probe.pendingSave;
      return { saved, completed: probe.completed, aborted: probe.aborted, document: window.__PROCGEN_STUDIO__.getDocumentState(), count: window.__PROCGEN_STUDIO__.ports.getState().recordedEvents };
    });
    expect(committed.saved && committed.completed && !committed.aborted).toBe(true); expect(committed.document.revision).toBe(1); expect(committed.count).toBe(after.count);
    await testInfo.attach('playwright-panic-pending-indexeddb', { body: JSON.stringify({ before, after, committed,
      scope: 'Real IndexedDB document transaction held active by controlled get requests while trusted Panic cancels fixed active/future ownership. Actual transaction completion follows release; no physical disk latency, power-loss or acoustic claim.' }), contentType: 'application/json' });
  } finally {
    await page.evaluate(() => { const probe = window.recordingStorageProbe; probe.keepAlive = false;
      window.IDBDatabase.prototype.transaction = probe.transaction; window.IDBObjectStore.prototype.put = probe.put; });
  }
});
