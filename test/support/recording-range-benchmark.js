const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
const timing = values => ({ samples: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), p99Ms: percentile(values, 0.99), maximumMs: Math.max(...values) });
const verifyHistory = (ports, expected) => {
  const recording = ports.getRecording();
  if (recording.length !== expected || Object.getOwnPropertySymbols(recording[0]).length) throw new Error('History was discarded or private index metadata escaped.');
  return recording.length;
};
export async function benchmarkRecordingRanges({ createPorts, createBudget, sizes = [1000, 10000, 100000, 1000000], iterations = 64,
  now = () => globalThis.performance.now(), yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), collectMemory = async () => null, onProgress = () => {} } = {}) {
  if (typeof createPorts !== 'function' || typeof createBudget !== 'function' || !Array.isArray(sizes) || !sizes.length || sizes.some(size => !Number.isSafeInteger(size) || size < 1000 || size > 1000000) || !Number.isSafeInteger(iterations) || iterations < 2 || iterations > 128) throw new RangeError('Use bounded recording sizes and repeated flush samples.');
  const profiles = [];
  for (const history of sizes) {
    const budget = createBudget(), ports = createPorts({ resourceBudget: budget, now: () => 1000, maxRecordedEvents: history + iterations * 8 + 16 });
    let memoryBefore, memoryLoaded, memoryRetired, index, state, retained, peakAccountedBytes;
    const flush = [], panic = [], scans = []; let loadingMs;
    try {
      ports.configure({ recording: true }); memoryBefore = await collectMemory(); const loadStart = now();
      for (let first = 0; first < history; first += 4096) {
        for (let event = first; event < Math.min(history, first + 4096); event++) {
          if (!ports.recordEvent({ type: 'cc', channel: 1, controller: 74, value: event % 128, timestamp: event % 1000, beat: 0 })) throw new Error('History was refused before its declared capacity.');
        }
        onProgress({ history, loaded: Math.min(history, first + 4096) }); await yieldControl();
      }
      loadingMs = now() - loadStart; memoryLoaded = await collectMemory();
      for (let round = 0; round < iterations; round++) {
        if (!ports.recordOutput({ note: 60, channel: 1, velocity: 90, timeMs: 2000, durationMs: 500 }) ||
            !ports.recordOutput({ note: 64, channel: 1, velocity: 90, timeMs: 900, durationMs: 500 })) throw new Error('The fixed future/active fixture was not retained.');
        const before = ports.getRecordingIndexState(), start = now();
        if (round % 2) ports.panic(); else ports.flush(); state = ports.getState();
        (round % 2 ? panic : flush).push(now() - start);
        const after = ports.getRecordingIndexState(); scans.push(after.scannedEvents - before.scannedEvents);
        if (scans.at(-1) > 256 || state.recordedEvents !== history + (round + 1) * 2 || state.retainedRange.lastTimestamp !== 1000) throw new Error('Flush scanned history or changed the retained source range.');
        await yieldControl();
      }
      retained = verifyHistory(ports, history + iterations * 2);
      index = ports.getRecordingIndexState(); peakAccountedBytes = budget.diagnostics().peakAccountedBytes;
    } finally { ports.clearRecording(); ports.dispose(); if (budget.diagnostics().accountedBytes !== 0) throw new Error('Recording index resources did not retire.'); }
    memoryRetired = await collectMemory();
    profiles.push({ history, iterations, loadingMs, fixedOutstanding: { active: 1, future: 1 }, flush: timing(flush), panic: timing(panic),
      maximumRescannedEvents: Math.max(...scans), retained, retainedRange: state.retainedRange, index, peakAccountedBytes, memoryBefore, memoryLoaded, memoryRetired });
  }
  return { schema: 'lemmings-midi-recording-range-benchmark/v1', profiles,
    evidence: 'actual-ports-flush-and-panic-with-synthetic-retained-CC-history;no-device-send-or-end-to-end-button-latency-claim',
    memoryScope: 'index-typed-storage-and-conservative-object-metadata-estimate-are-reserved;recording-object-heap-is-measured-separately' };
}
