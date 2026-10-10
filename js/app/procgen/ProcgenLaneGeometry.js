const BASE_LANE_HEIGHT = 96;
const DEFAULT_LANE_HEIGHT = 144;
const MAX_LANE_HEIGHT = 256;
const normalizeLaneHeight = (value, fallback = BASE_LANE_HEIGHT) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(BASE_LANE_HEIGHT, Math.min(MAX_LANE_HEIGHT, Math.trunc(parsed))) : fallback;
};
export { BASE_LANE_HEIGHT, DEFAULT_LANE_HEIGHT, MAX_LANE_HEIGHT, normalizeLaneHeight };
