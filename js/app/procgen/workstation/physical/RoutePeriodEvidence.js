import { plain, identity, integer, finite, freeze } from './PhysicalSchema.js';

const gcd = (a, b) => { while (b) { const next = a % b; a = b; b = next; } return a; };
const ratio = (left, right) => {
  const divisor = Number.isSafeInteger(left) && Number.isSafeInteger(right) ? gcd(left, right) : null;
  return { value: left / right, reduced: divisor ? [left / divisor, right / divisor] : null };
};

// A view of completed lap evidence, never a clock or a request to change motion.
export function describeRoutePeriods(rows, { maxRows = 128 } = {}) {
  if (!Array.isArray(rows) || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 1024) throw new Error('Invalid route period evidence capacity.');
  if (rows.length > maxRows) return freeze({ status: 'capped', reason: 'route-period-view-capacity', rows: [], comparisons: [], available: rows.length });
  const identities = new Set();
  const prepared = rows.map(row => {
    if (!plain(row) || !identity(row.routeId) || !integer(row.routeRevision) || !identity(row.branchId) || !integer(row.actorId) || typeof row.coordinateStatus !== 'string' || row.coordinateStatus.length > 64 || !finite(row.lastCompletedLapTick, Number.MAX_SAFE_INTEGER) || row.lastCompletedLapTick < 0 || typeof row.sourceObservationId !== 'string' || !row.sourceObservationId || row.sourceObservationId.length > 512 || !Array.isArray(row.sourceEventIds) || !row.sourceEventIds.length || row.sourceEventIds.length > 32 || row.sourceEventIds.some(id => typeof id !== 'string' || !id || id.length > 512)) throw new Error('Invalid completed route period provenance.');
    const key = row.routeId + '/' + row.actorId;
    if (identities.has(key) || !finite(row.periodTicks, Number.MAX_SAFE_INTEGER) || row.periodTicks < Number.EPSILON || row.periodTicks > row.lastCompletedLapTick || row.requestedPeriodTicks != null && (!finite(row.requestedPeriodTicks, Number.MAX_SAFE_INTEGER) || row.requestedPeriodTicks < Number.EPSILON)) throw new Error('Invalid completed route period.');
    identities.add(key);
    return { routeId: row.routeId, routeRevision: row.routeRevision, branchId: row.branchId, actorId: row.actorId, coordinateStatus: row.coordinateStatus, periodTicks: row.periodTicks, requestedPeriodTicks: row.requestedPeriodTicks ?? null,
      lastCompletedLapTick: row.lastCompletedLapTick, sourceObservationId: row.sourceObservationId, sourceEventIds: [...row.sourceEventIds] };
  });
  const ordered = prepared.sort((a, b) => a.routeId.localeCompare(b.routeId) || a.actorId - b.actorId);
  const reference = ordered[0], comparisons = ordered.slice(1).map(row => {
    const periodRatio = ratio(reference.periodTicks, row.periodTicks), frequencyRatio = ratio(row.periodTicks, reference.periodTicks);
    const divisor = periodRatio.reduced ? gcd(reference.periodTicks, row.periodTicks) : null, coincidence = divisor ? reference.periodTicks / divisor * row.periodTicks : null;
    return { reference: { routeId: reference.routeId, actorId: reference.actorId }, other: { routeId: row.routeId, actorId: row.actorId }, periodRatio, frequencyRatio,
      periodDifferenceTicks: row.periodTicks - reference.periodTicks, periodLcmTicks: Number.isSafeInteger(coincidence) ? coincidence : null,
      requestedPeriodRatio: reference.requestedPeriodTicks != null && row.requestedPeriodTicks != null ? ratio(reference.requestedPeriodTicks, row.requestedPeriodTicks) : null };
  });
  return freeze({ status: ordered.length ? 'observed-completed-laps' : 'unobserved', rows: ordered.map(row => ({ ...row, periodErrorTicks: row.requestedPeriodTicks == null ? null : row.periodTicks - row.requestedPeriodTicks })), comparisons,
    units: { period: 'simulation-ticks', frequencyRatio: 'inverse-period-ratio', periodLcm: 'integer-period-coincidence-window-not-a-phase-reset' }, movementChanged: false });
}
