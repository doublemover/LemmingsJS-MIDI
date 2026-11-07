import { canonicalDataText } from '../../../core/CanonicalData.js';

const fields = Object.freeze(['nominalGapTicks', 'spreadTicks', 'lanePhase', 'phaseStepTicks', 'grouping', 'clockMode', 'seed']);
export function physicalLessonPolicy(graph, releaseGesture) {
  return canonicalDataText({ graph, release: Object.fromEntries(fields.map(key => [key, releaseGesture?.[key] ?? null])) },
    { maxBytes: 262144, maxNodes: 16384 }).text;
}
