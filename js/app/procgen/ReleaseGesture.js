import { plain, identity, integer, freeze } from './workstation/physical/PhysicalSchema.js';
import { causalRandomDecision } from './workstation/CausalRandom.js';
export function validateReleaseGesture(value, laneCount = 1024) {
  if (!plain(value) || value.paused != null && typeof value.paused !== 'boolean' || value.version !== 1 || !identity(value.id) || value.id.length > 96 || !integer(value.revision) || !integer(value.nominalGapTicks, 36000) || !value.nominalGapTicks || !integer(value.spreadTicks, 53) || value.spreadTicks >= value.nominalGapTicks || !['free', 'cohort-spray', 'phase-shift', 'squeeze-release'].includes(value.grouping) || !['locked', 'adaptive'].includes(value.clockMode) || value.liveChangeBoundary !== 'next-cohort' || value.finiteBurstCount != null && (!integer(value.finiteBurstCount, 4096) || !value.finiteBurstCount) || value.grouping === 'squeeze-release' && value.finiteBurstCount == null) throw new Error('Invalid versioned physical release gesture.');
  const phase = value.lanePhase || []; if (!Array.isArray(phase) || phase.length > 1024 || new Set(phase.map(value => value.laneId)).size !== phase.length || phase.some(value => !plain(value) || !integer(value.laneId, laneCount - 1) || !integer(value.offsetTicks, value.spreadTicks)) || !Number.isSafeInteger(value.phaseStepTicks ?? 0) || Math.abs(value.phaseStepTicks ?? 0) > 53 || !Number.isSafeInteger(value.seed ?? 0)) throw new Error('Invalid release lane phase or deterministic identity.');
  return freeze({ version: 1, id: value.id, revision: value.revision, nominalGapTicks: value.nominalGapTicks, spreadTicks: value.spreadTicks, lanePhase: phase.map(value => ({ laneId: value.laneId, offsetTicks: value.offsetTicks })).sort((a, b) => a.laneId - b.laneId), grouping: value.grouping, clockMode: value.clockMode, finiteBurstCount: value.finiteBurstCount ?? null, phaseStepTicks: value.phaseStepTicks ?? 0, liveChangeBoundary: 'next-cohort', paused: value.paused === true, seed: value.seed ?? 0, missedSlotPolicy: 'consume-without-catch-up', generationPolicy: 'discard-unfinished-finite' });
}
export function releaseLanePhases(gesture, { laneCount, generation, cohortOrdinal, worldSeed = 0 }) {
  const result = new Int32Array(laneCount), explicit = new Map(gesture.lanePhase.map(value => [value.laneId, value.offsetTicks]));
  const ranked = Array.from({ length: laneCount }, (_, laneId) => ({ laneId, draw: causalRandomDecision({ seed: `${worldSeed}/${gesture.seed}`, namespace: 'population', mappingId: gesture.id, generation, stableCauseId: `cohort:${cohortOrdinal}:lane:${laneId}`, drawPurpose: 'release-phase-rank' }).drawUint32 })).sort((a, b) => a.draw - b.draw || a.laneId - b.laneId);
  const ranks = new Map(ranked.map((value, rank) => [value.laneId, rank]));
  for (let lane = 0; lane < laneCount; lane++) {
    const base = explicit.get(lane) ?? (gesture.grouping === 'cohort-spray' ? Math.floor(ranks.get(lane) * (gesture.spreadTicks + 1) / laneCount) : Math.floor(lane * (gesture.spreadTicks + 1) / laneCount));
    result[lane] = gesture.grouping === 'squeeze-release' && cohortOrdinal === 0 ? 0 : gesture.grouping === 'phase-shift' ? ((base + (cohortOrdinal % (gesture.spreadTicks + 1)) * gesture.phaseStepTicks) % (gesture.spreadTicks + 1) + gesture.spreadTicks + 1) % (gesture.spreadTicks + 1) : base;
  }
  return result;
}
export function validatePopulationReleaseState(value, laneCount) {
  for (const key of ['releaseGesture', 'pendingReleaseGesture', 'cohortReleaseGesture']) if (value[key] != null) validateReleaseGesture(value[key], laneCount);
  const run = value.gestureRun;
  if (run != null && (!plain(run) || run.remaining != null && !integer(run.remaining, 4096) || !integer(run.admitted) || !integer(run.missed) || !Number.isSafeInteger(run.cohortOrdinal) || run.cohortOrdinal < -1 || !['active', 'paused', 'exhausted', 'generation-discarded'].includes(run.status))) throw new Error('Invalid release gesture continuation.');
  if (run && !value.releaseGesture || value.releaseGesture && !run || value.cohortReleaseGesture && !value.releaseGesture || run && value.releaseGesture?.finiteBurstCount != null && (run.admitted + run.missed + (run.remaining || 0) !== value.releaseGesture.finiteBurstCount && run.status !== 'generation-discarded')) throw new Error('Incoherent finite release ownership.');
  if (run && value.releaseGesture?.finiteBurstCount == null && run.remaining != null || run?.status === 'exhausted' && run.remaining !== 0 || run?.status === 'generation-discarded' && run.remaining !== 0) throw new Error('Incoherent release attempt budget.');
  for (const key of ['releaseGestureCommandId', 'pendingGestureCommandId']) if (value[key] != null && !identity(value[key])) throw new Error('Invalid release command ancestry.');
}
