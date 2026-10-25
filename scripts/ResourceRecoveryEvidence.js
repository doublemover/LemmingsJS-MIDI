export const RESOURCE_RECOVERY_CASES = Object.freeze([8, 128, 1024].flatMap(laneCount => [1, 2].map(dpr => Object.freeze({ laneCount, dpr }))));
export function summarizeResourceSamples(samples) {
  if (!Array.isArray(samples) || samples.length > 20000 || samples.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid resource timing samples.');
  const sorted = samples.slice().sort((a, b) => a - b), percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return { count: sorted.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), maximum: sorted.at(-1) ?? null, raw: samples };
}
export function evaluateResourceRecoveryEvidence(report) {
  const failures = [], coverage = [], add = (id, reason) => failures.push({ case: id, reason });
  if (!Array.isArray(report.cases) || report.cases.length > 12) return { status: 'not-qualified', failures: [{ case: 'report', reason: 'invalid-case-inventory' }] };
  if (!/^[a-f0-9]{64}$/.test(report.applicationBuildId || '')) add('report', 'missing-source-binding');
  for (const required of RESOURCE_RECOVERY_CASES) {
    const id = `${required.laneCount}@${required.dpr}`, matches = report.cases.filter(item => item.laneCount === required.laneCount && item.dpr === required.dpr);
    if (matches.length !== 1) { add(id, 'missing-or-duplicate-required-case'); continue; }
    const row = matches[0]; coverage.push(id);
    if (row.error) { add(id, row.error); continue; }
    if (row.executionIdentity?.activeExecution !== 'bound' || row.executionIdentity.buildId !== report.applicationBuildId) add(id, 'executed-source-differs');
    if (row.observedLaneCount !== required.laneCount || row.observedDpr !== required.dpr || row.patternLength !== 64 || row.patternLanes !== required.laneCount || row.terrainEditCells < 4096) add(id, 'workload-not-realized');
    if (row.refcountSharing !== true || row.cctvViews !== 8 || row.bank?.decodedEntries !== 8 || row.bank?.activePins < 8 || !(row.bank?.decodedBytes >= 30000000)) add(id, 'combined-resident-workload-incomplete');
    if (!(row.playingTickDelta > 0) || row.writes?.length !== 8 || row.writes.some(write => !write.accepted || !write.durable || !Number.isFinite(write.snapshotMs) || !Number.isFinite(write.encodeMs) || !Number.isFinite(write.commitMs))) add(id, 'recovery-durable-evidence-incomplete');
    if (row.writes?.some(write => write.snapshotMs > 4 || !Number.isFinite(write.maximumStoredPayloadBytes) || write.maximumStoredPayloadBytes > 65536 || !Number.isFinite(write.transactionMaximumSliceMs) || write.transactionMaximumSliceMs > 4 || !Number.isFinite(write.inputCopyMaximumSliceMs) || write.inputCopyMaximumSliceMs > 4 || !Number.isFinite(write.resultCopyMaximumSliceMs) || write.resultCopyMaximumSliceMs > 4) || !(row.capture?.slices > 0) || !Number.isFinite(row.capture.maximumSliceMs) || row.capture.maximumSliceMs > 4) add(id, 'capture-slice-budget-exceeded-or-unobserved');
    if (!row.samples || Object.values(row.samples).some(samples => !Array.isArray(samples) || samples.length > 20000 || samples.some(value => !Number.isFinite(value) || value < 0))) add(id, 'invalid-raw-timing-tail');
    if (row.samples?.clickPaintMs?.length < 16 || row.samples?.schedulingLatenessMs?.length < 32 || row.sampleOverflow) add(id, 'interaction-tail-coverage-incomplete');
    if (!row.pressure?.rejectedBeforeAllocation || !row.pressure?.activeWorldPreserved || !row.pressure?.activePinsPreserved || row.pressure?.continuedTicks < 1) add(id, 'pressure-mutated-active-performance');
    if (!['committed', 'refused-with-current-world-preserved'].includes(row.candidate?.outcome)) add(id, 'candidate-outcome-unresolved');
    if (row.candidate?.outcome === 'committed' && !row.candidate.overlapObserved) add(id, 'old-new-world-overlap-not-observed');
    if (row.budget?.peakAccountedBytes > row.budget?.limitBytes || !Number.isFinite(row.budget?.estimatedOverheadBytes) || row.budget?.categoryPeakCoverage !== 'complete' || !row.budget?.categoryPeaks?.candidate) add(id, 'memory-accounting-incomplete-or-over-cap');
    if (!row.pausedRecovery?.accepted || row.pausedRecovery.playing) add(id, 'paused-edit-not-durably-recovered');
    if (row.cleanup?.outcome !== 'complete' || row.browserErrors?.length) add(id, 'cleanup-or-browser-failure');
  }
  return Object.freeze({ schema: 'resource-recovery-evaluation/v1', status: failures.length ? 'not-qualified' : 'measured-profile-passed', requiredCases: RESOURCE_RECOVERY_CASES.length,
    observedCases: coverage.length, failures, qualificationScope: 'accounted-estimates-and-browser-lifecycle', nativeHeapQualification: 'not-established', acousticQualification: 'not-performed' });
}
