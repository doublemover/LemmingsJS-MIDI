export const BENCHMARK_RECEIPT_SCHEMA = 'lemmings-benchmark-result/v2';
export const REQUIRED_SMOKE_HOTPATHS = Object.freeze(['marchingAnts', 'tileComposition', 'overlayPlane', 'scaledBlit']);
const HOTPATH_WORK = Object.freeze({ marchingAnts: 3000, tileComposition: 1200, overlayPlane: 700, scaledBlit: 1600 });
export const createBenchmarkReceipt = (kind, profile, scenarioIds) => ({ schema: BENCHMARK_RECEIPT_SCHEMA, kind, profile,
  status: 'completed', scenarioIds, units: { duration: 'milliseconds', throughput: 'ticks-per-second', historySpan: 'ticks' },
  samplePolicy: 'all-observations; filtered summaries are diagnostic only' });

export function admitMidiRepetition(receipt, { attempts, workload, source }) {
  const diagnostics = [];
  const invalid = reason => diagnostics.push({ kind: 'invalid-measurement', path: 'midi.repetition', reason });
  if (!Number.isSafeInteger(attempts) || attempts <= 0 || !['router', 'scheduler'].includes(source)) invalid('Expected MIDI work and source must be explicit and positive');
  if (receipt?.schema !== BENCHMARK_RECEIPT_SCHEMA || receipt.source !== source || receipt.workload !== workload || receipt.clock !== 'deterministic-workload-ms' || receipt.attempted !== attempts) invalid('MIDI workload identity, clock or requested work count differs');
  if (!Number.isFinite(receipt?.startMs) || !Number.isFinite(receipt?.endMs) || receipt.endMs < receipt.startMs) invalid('MIDI workload clock interval is missing or reversed');
  for (const field of ['attempted', 'admitted', 'rejected', 'submittedNoteOns', 'submittedNoteOffs', 'pendingOnsets', 'activeVoices', 'scheduledOffs']) {
    if (!Number.isSafeInteger(receipt?.[field]) || receipt[field] < 0) invalid('Missing or invalid work count: ' + field);
  }
  if (receipt?.pendingOnsets !== 0 || receipt.activeVoices !== 0 || receipt.scheduledOffs !== 0) invalid('MIDI repetition did not retire its gates and timers');
  if (workload === 'successful-fixed-work') {
    if (receipt?.admitted !== attempts || receipt.submittedNoteOns !== attempts || receipt.submittedNoteOffs !== attempts || receipt.rejected !== 0) invalid('Successful MIDI workload did not complete every requested onset and terminal');
  } else if (workload === 'saturated-rate-rejection') {
    if (receipt?.admitted !== 0 || receipt.submittedNoteOns !== 0 || receipt.submittedNoteOffs !== 0 || receipt.rejected !== attempts ||
        !Object.values(receipt.rejectionReasons || {}).some(count => Number.isSafeInteger(count) && count > 0)) invalid('Saturated MIDI workload did not prove its declared rejection contract');
  } else invalid('Unsupported MIDI workload');
  return { accepted: diagnostics.length === 0, diagnostics };
}

export function admitSmokeMeasurements({ performance, history, hotpaths }, { profile = 'smoke',
  historySpeeds = profile === 'soak' ? [30, 60, 120] : [30, 60], minPerformanceSamples = 3, minHotpathSamples = 3 } = {}) {
  const diagnostics = [];
  const invalid = (path, reason) => diagnostics.push({ kind: 'invalid-measurement', path, reason });
  const number = (value, path, min = 0) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min) { invalid(path, `expected a finite number >= ${min}`); return null; }
    return value;
  };
  const count = (value, path, min = 1) => {
    const result = number(value, path, min); if (result != null && !Number.isSafeInteger(result)) { invalid(path, 'expected an integer observation/work count'); return null; } return result;
  };
  const receipt = (data, kind, expectedProfile, expectedIds) => {
    const meta = data?.receipt;
    if (meta?.schema !== BENCHMARK_RECEIPT_SCHEMA || meta.kind !== kind || meta.status !== 'completed' || meta.profile !== expectedProfile)
      invalid(`${kind}.receipt`, 'missing, unsupported, incomplete or unexpected benchmark identity/profile');
    if (!Array.isArray(meta?.scenarioIds) || meta.scenarioIds.length !== expectedIds.length ||
        new Set(meta.scenarioIds).size !== expectedIds.length || expectedIds.some(id => !meta.scenarioIds.includes(id)))
      invalid(`${kind}.receipt.scenarioIds`, 'requested scenario set is missing, duplicated or different');
    if (meta?.units?.duration !== 'milliseconds' || meta?.units?.throughput !== 'ticks-per-second' || meta?.units?.historySpan !== 'ticks')
      invalid(`${kind}.receipt.units`, 'measurement units are missing or unsupported');
  };
  receipt(performance, 'performance', profile, [`bench:entrances:${profile === 'soak' ? 220 : 30}`]);
  receipt(history, 'history', profile, historySpeeds.map(speed => `speed:${speed}`));
  receipt(hotpaths, 'hotpaths', 'smoke', REQUIRED_SMOKE_HOTPATHS);
  if (performance?.measurement?.kind !== 'completed-work/v1' || performance.measurement.clock !== 'browser-performance-now' ||
      performance.measurement.frameDistribution !== 'completed-raf-gap-ms') invalid('performance.measurement', 'completed work, monotonic browser time and actual RAF gaps are required');
  const sampleCount = count(performance?.sampleCount, 'performance.sampleCount', minPerformanceSamples);
  if (performance?.filteredSampleCount === 0 && sampleCount > 0) invalid('performance.filteredSampleCount', 'all observations were flagged; the harness has no stable diagnostic window');
  if (!Array.isArray(performance?.samples) || performance.samples.length !== sampleCount) invalid('performance.samples', 'raw observation count does not match its receipt');
  const frames = [], throughputs = [];
  for (const [index, sample] of (Array.isArray(performance?.samples) ? performance.samples : []).entries()) {
    const path = `performance.samples[${index}]`;
    const elapsed = number(sample?.measurementElapsedMs, path + '.measurementElapsedMs', Number.MIN_VALUE);
    const completed = count(sample?.completedTicks, path + '.completedTicks');
    const startTick = count(sample?.startTick, path + '.startTick', 0), endTick = count(sample?.tick, path + '.tick', 0);
    const tps = number(sample?.tps, path + '.tps');
    if (startTick != null && endTick != null && completed != null && endTick - startTick !== completed) invalid(path + '.completedTicks', 'forward completed work disagrees with observed tick boundaries');
    if (elapsed != null && completed != null && tps != null && Math.abs(tps - completed * 1000 / elapsed) > Math.max(1e-9, tps * 1e-9)) invalid(path + '.tps', 'throughput must be measured completions per elapsed second');
    if (sample?.ready !== true || sample.running !== true || sample.reverse !== false || sample.continuousDirection !== true || sample.overflow !== false) invalid(path, 'source is unavailable, paused, discontinuous or its observation storage overflowed');
    const entrances = profile === 'soak' ? 220 : 30;
    if (sample?.entrances !== entrances) invalid(path + '.entrances', 'observed entrance population differs from the declared scene');
    count(sample?.activeActors, path + '.activeActors', entrances);
    for (const field of ['frameGapsMs', 'tickExecutionMs', 'renderExecutionMs']) {
      const values = sample?.[field];
      if (!Array.isArray(values) || !values.length || values.length > 16384) { invalid(path + '.' + field, 'bounded actual timing observations are required'); continue; }
      for (const [valueIndex, value] of values.entries()) {
        const measured = number(value, `${path}.${field}[${valueIndex}]`, field === 'frameGapsMs' ? Number.MIN_VALUE : 0);
        if (field === 'frameGapsMs' && measured != null) frames.push(measured);
      }
    }
    if (tps != null) throughputs.push(tps);
  }
  const percentile = (values, p) => { values.sort((a, b) => a - b); return values.length ? values[Math.floor((values.length - 1) * p)] : null; };
  const reportedFrame = number(performance?.frameStats?.p95, 'performance.frameStats.p95');
  const reportedTps = number(performance?.tpsStats?.p50, 'performance.tpsStats.p50');
  const observedFrame = percentile(frames, 0.95), observedTps = percentile(throughputs, 0.5);
  const perfP95Frame = reportedFrame == null || observedFrame == null ? null : Math.max(reportedFrame, observedFrame);
  const perfP50Tps = reportedTps == null || observedTps == null ? null : Math.min(reportedTps, observedTps);
  const scenarios = [], seenSpeeds = new Set();
  if (!Array.isArray(history?.results) || history.results.length !== historySpeeds.length) invalid('history.results', 'required scenario count is missing or different');
  for (const [index, item] of (Array.isArray(history?.results) ? history.results : []).entries()) {
    const speed = number(item?.speedFactor, `history.results[${index}].speedFactor`, Number.MIN_VALUE);
    if (!historySpeeds.includes(speed) || seenSpeeds.has(speed)) invalid(`history.results[${index}]`, 'unexpected or duplicate speed scenario');
    seenSpeeds.add(speed);
    const target = count(item?.targetSpanTicks, `history.results[${index}].targetSpanTicks`);
    if (target !== (profile === 'soak' ? 60000 : 6000)) invalid(`history.results[${index}].targetSpanTicks`, 'unexpected history workload target');
    const span = count(item?.maxSpanTicks, `history.results[${index}].maxSpanTicks`, 0);
    count(item?.sampleCount, `history.results[${index}].sampleCount`);
    const replay = item?.seekProbe, path = `history.results[${index}].seekProbe`;
    const digestEvidence = replay?.evidence === 'sha256-forward-state-and-base64-terrain';
    if (replay?.status !== 'complete' || !['exact-forward-state-and-base64-terrain', 'sha256-forward-state-and-base64-terrain'].includes(replay.evidence) || replay.startRestored !== true ||
        replay.deltaAvailable !== true || replay.hashMatch !== true || replay.restoredTick !== replay.startTick) invalid(path, 'independent applied-state/terrain parity and exact starting-boundary restoration are required');
    if (digestEvidence && (replay.hashAlgorithm !== 'SHA-256' || !Number.isSafeInteger(replay.maximumSerializedCheckpointBytes) ||
        replay.maximumSerializedCheckpointBytes < 1 || replay.maximumSerializedCheckpointBytes > 32 * 1048576 ||
        !Number.isSafeInteger(replay.startSerializedBytes) || replay.startSerializedBytes < 1 || replay.startSerializedBytes > replay.maximumSerializedCheckpointBytes)) invalid(path, 'independent SHA-256 checkpoint algorithm or serialization bound is invalid');
    count(replay?.startTick, path + '.startTick', 0);
    if (!Array.isArray(replay?.observations) || replay.observations.length < 4 || replay.observations.length > 128) invalid(path + '.observations', 'bounded first-touch/repeat/return work observations are required');
    for (const [ordinal, row] of (Array.isArray(replay?.observations) ? replay.observations : []).entries()) {
      const rowPath = `${path}.observations[${ordinal}]`;
      if (row?.accepted !== true || row.exactStateMatch !== true || row.observedTick !== row.targetTick ||
          !['first-touch-cold', 'already-warm', 'warm-repeat', 'repeat-cold', 'return'].includes(row.phase)) invalid(rowPath, 'seek completion, target state or measured cache phase is invalid');
      if (digestEvidence && (row?.hashAlgorithm !== 'SHA-256' || typeof row.expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.expectedHash) || row.actualHash !== row.expectedHash)) invalid(rowPath, 'independent forward and applied replay SHA-256 digests must match');
      count(row?.targetTick, rowPath + '.targetTick', 0); number(row?.durationMs, rowPath + '.durationMs');
      count(row?.coldDecodes, rowPath + '.coldDecodes', 0); count(row?.coldCacheHits, rowPath + '.coldCacheHits', 0); count(row?.coldDecodedBytes, rowPath + '.coldDecodedBytes', 0);
      if (row?.phase === 'first-touch-cold' && !(row.coldDecodes > 0) || row?.phase === 'warm-repeat' && row.coldDecodes !== 0) invalid(rowPath + '.phase', 'cache phase disagrees with actual decoding work');
    }
    scenarios.push({ speed, ratio: target == null || span == null ? null : span / target });
  }
  for (const speed of historySpeeds) if (!seenSpeeds.has(speed)) invalid(`history.speed:${speed}`, 'required scenario was not measured');
  if (!Array.isArray(history?.failures)) invalid('history.failures', 'producer failure evidence is missing');
  else for (const failure of history.failures) diagnostics.push({ kind: 'producer-failure', path: 'history.failures', reason: String(failure) });
  const hotpathMetrics = {};
  for (const name of REQUIRED_SMOKE_HOTPATHS) {
    const data = hotpaths?.[name];
    hotpathMetrics[name] = number(data?.avgMs, `hotpaths.${name}.avgMs`);
    count(data?.workIterations, `hotpaths.${name}.workIterations`, HOTPATH_WORK[name]);
    const observations = count(data?.sampleCount, `hotpaths.${name}.sampleCount`, minHotpathSamples);
    if (!Array.isArray(data?.samplesMs) || data.samplesMs.length !== observations) invalid(`hotpaths.${name}.samplesMs`, 'observation count is missing or inconsistent');
    for (const [index, sample] of (Array.isArray(data?.samplesMs) ? data.samplesMs : []).entries()) number(sample, `hotpaths.${name}.samplesMs[${index}]`);
  }
  return { valid: diagnostics.length === 0, diagnostics, metrics: { perfP95Frame, perfP50Tps,
    historyRatio: scenarios.length && scenarios.every(item => item.ratio != null) ? Math.min(...scenarios.map(item => item.ratio)) : null,
    antsAvgMs: hotpathMetrics.marchingAnts, tileCompositionAvgMs: hotpathMetrics.tileComposition,
    overlayPlaneAvgMs: hotpathMetrics.overlayPlane, scaledBlitAvgMs: hotpathMetrics.scaledBlit }, scenarios };
}
