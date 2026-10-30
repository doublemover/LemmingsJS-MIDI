import { normalizeLaneHeight } from './ProcgenLaneGeometry.js';
import { PROCGEN_TRIGGER_INDEX_BYTES_PER_ACTOR } from './ProcgenTriggerManager.js';

export const estimateProcgenCandidateBytes = ({ laneCount, laneHeight }) => {
  const lanes = Math.max(1, Math.min(1024, Math.trunc(Number(laneCount)) || 1)), height = normalizeLaneHeight(laneHeight);
  return lanes * (65536 + height * 384) + 16384 * (128 + PROCGEN_TRIGGER_INDEX_BYTES_PER_ACTOR);
};
