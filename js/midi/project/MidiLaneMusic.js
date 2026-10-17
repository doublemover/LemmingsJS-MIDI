import { isPlainObject } from '../../util/safeObject.js';

const MAX_LANE_MUSIC_RANGES = 32;
const integer = (value, fallback, low, high) => Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Math.round(Number(value)))) : fallback;
const sanitizeMidiLaneMusic = value => {
  if (!isPlainObject(value)) return null;
  const seen = new Set(), ranges = [];
  for (const range of (Array.isArray(value.ranges) ? value.ranges : []).slice(0, MAX_LANE_MUSIC_RANGES)) {
    if (!isPlainObject(range) || typeof range.id !== 'string' || !range.id || typeof range.schemeId !== 'string') continue;
    const id = range.id.slice(0, 80); if (seen.has(id)) continue;
    const startLane = integer(range.startLane, 1, 1, 1024), endLane = integer(range.endLane, startLane, startLane, 1024);
    seen.add(id); ranges.push({ id, enabled: range.enabled !== false, startLane, endLane, schemeId: range.schemeId.slice(0, 80) });
  }
  return { version: 1, pitchEnabled: value.pitchEnabled !== false, referenceRoot: integer(value.referenceRoot, 0, 0, 11), spread: integer(value.spread, 0, 0, 48),
    variation: ['steady', 'balanced', 'animated'].includes(value.variation) ? value.variation : 'balanced',
    defaultSchemeId: typeof value.defaultSchemeId === 'string' ? value.defaultSchemeId.slice(0, 80) : null,
    mode: value.mode === 'phrase' ? 'phrase' : 'steps', ranges };
};
const midiLaneMusicRange = (music, laneIndex) => {
  if (!Number.isInteger(laneIndex) || laneIndex < 0 || laneIndex > 1023) return null;
  const lane = laneIndex + 1;
  for (let index = (music?.ranges?.length || 0) - 1; index >= 0; index--) {
    const range = music.ranges[index];
    if (range.enabled && lane >= range.startLane && lane <= range.endLane) return range;
  }
  return null;
};
export { MAX_LANE_MUSIC_RANGES, sanitizeMidiLaneMusic, midiLaneMusicRange };
