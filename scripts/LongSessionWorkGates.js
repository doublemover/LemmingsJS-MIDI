export function evaluateLongSessionWork({ samples, replayChecks, thresholds }) {
  const failures = [], natural = value => Number.isSafeInteger(value) && value >= 0, nonnegative = value => Number.isFinite(value) && value >= 0;
  const fields = ['coldBlocksCreated', 'coldBlocksThawed', 'coldBlocksRetired', 'historyDeltaCount'];
  const counts = ['minimumForwardTicks', 'minimumReplayChecks', 'minimumColdBlocksCreated', 'minimumColdBlocksRetired'], ratios = ['minimumObservedFraction', 'minimumActiveFraction', 'minimumProgressFraction'];
  if (counts.some(key => !natural(thresholds[key])) || ratios.some(key => !Number.isFinite(thresholds[key]) || thresholds[key] <= 0 || thresholds[key] > 1) || !nonnegative(thresholds.durationMs) || thresholds.durationMs === 0 || !nonnegative(thresholds.maximumStalledMs))
    return { failures: ['invalid_active_work_thresholds'], metrics: { workEvidence: 'invalid-thresholds' } };
  if (samples.length < 2 || samples.some(sample => sample.validTelemetry !== true || !natural(sample.tickIndex) || !nonnegative(sample.clockMs) || typeof sample.running !== 'boolean' || fields.some(key => !natural(sample[key])))) failures.push('active_work_evidence_missing');
  if (failures.length) return { failures, metrics: { workEvidence: 'invalid-or-missing', completedPhysicalTicks: null, sampledForwardMs: null, sampledPausedMs: null, replayMs: null } };
  const first = samples[0], last = samples.at(-1); let completedPhysicalTicks = 0, sampledForwardMs = 0, sampledPausedMs = 0, replayMs = 0, progressingMs = 0, stalledMs = 0, longestStallMs = 0;
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1], current = samples[i], span = current.clockMs - previous.clockMs, ticks = current.tickIndex - previous.tickIndex;
    if (span <= 0 || fields.some(key => key !== 'historyDeltaCount' && current[key] < previous[key])) { failures.push('active_work_clock_or_counter_regression'); continue; }
    if (ticks < 0) failures.push('physical_tick_regression'); else completedPhysicalTicks += ticks;
    const replayOverlap = replayChecks.reduce((sum, check) => sum + (nonnegative(check.startedAtMs) && nonnegative(check.endedAtMs) ? Math.max(0, Math.min(current.clockMs, check.endedAtMs) - Math.max(previous.clockMs, check.startedAtMs)) : 0), 0);
    const forward = Math.max(0, span - replayOverlap); replayMs += Math.min(span, replayOverlap);
    if (previous.running && current.running) { sampledForwardMs += forward; if (ticks > 0) { progressingMs += forward; stalledMs = 0; } else stalledMs += forward; }
    else { sampledPausedMs += forward; stalledMs += forward; }
    longestStallMs = Math.max(longestStallMs, stalledMs);
  }
  const observedMs = last.clockMs - first.clockMs, forwardFraction = observedMs > 0 ? sampledForwardMs / observedMs : 0, progressFraction = sampledForwardMs > 0 ? progressingMs / sampledForwardMs : 0;
  const completedChecks = replayChecks.filter(check => check.checked === true && check.status === 'complete' && check.hashMatch === true && check.transportRestored === true && check.wasRunning === true &&
    nonnegative(check.startedAtMs) && nonnegative(check.endedAtMs) && check.endedAtMs >= check.startedAtMs && check.startedAtMs >= first.clockMs && check.endedAtMs <= last.clockMs);
  if (completedPhysicalTicks < thresholds.minimumForwardTicks) failures.push('completed_physical_work_below_minimum');
  if (observedMs < thresholds.durationMs * thresholds.minimumObservedFraction) failures.push('observation_window_too_short');
  if (forwardFraction < thresholds.minimumActiveFraction || samples.some(sample => !sample.running)) failures.push('forward_workload_not_sustained');
  if (progressFraction < thresholds.minimumProgressFraction || longestStallMs > thresholds.maximumStalledMs) failures.push('physical_work_stalled_during_window');
  if (completedChecks.length < thresholds.minimumReplayChecks || completedChecks.length !== replayChecks.length) failures.push('replay_transaction_evidence_incomplete');
  const coldBlocksCreated = last.coldBlocksCreated - first.coldBlocksCreated, coldBlocksRetired = last.coldBlocksRetired - first.coldBlocksRetired;
  if (coldBlocksCreated < thresholds.minimumColdBlocksCreated || coldBlocksRetired < thresholds.minimumColdBlocksRetired) failures.push('history_turnover_below_minimum');
  return { failures: [...new Set(failures)], metrics: { workEvidence: 'sample-bracketed-transport-minus-explicit-replay-time', observedMs, completedPhysicalTicks, sampledForwardMs, sampledPausedMs, replayMs,
    forwardFraction, progressFraction, longestStallMs, completedReplayTransactions: completedChecks.length, coldBlocksCreated, coldBlocksThawed: last.coldBlocksThawed - first.coldBlocksThawed,
    coldBlocksRetired, historyDeltaCountStart: first.historyDeltaCount, historyDeltaCountEnd: last.historyDeltaCount } };
}
