import { freezeData } from '../../core/CanonicalData.js';

export function planPatchComparisonLevels(parent, candidate) {
  const fields = ['takeId', 'takeRevision', 'sourceCanonicalHash', 'sampleRate', 'frames', 'timelineZeroSourceFrame', 'exactEndSourceFrame', 'laneId'];
  if (!parent || !candidate || fields.some(field => parent[field] !== candidate[field]) || typeof parent.takeId !== 'string' || !parent.takeId ||
      !/^[a-f0-9]{64}$/.test(parent.sourceCanonicalHash) || !Number.isInteger(parent.frames) || parent.frames < 1 || ![44100, 48000, 96000].includes(parent.sampleRate))
    throw Object.assign(new Error('Compare requires the same immutable take, lane, crop and source clock.'), { code: 'comparison-source-mismatch' });
  const statistics = [parent.statistics, candidate.statistics];
  for (const stats of statistics) if (!stats || !Number.isFinite(stats.rms) || !Number.isFinite(stats.peak) || stats.rms <= 1e-8 || stats.peak < stats.rms)
    throw Object.assign(new Error('A comparison render is silent or has invalid finite level evidence.'), { code: 'silent-reference-gesture' });
  const targetRms = Math.min(...statistics.map(stats => stats.rms), ...statistics.map(stats => 0.8 * stats.rms / stats.peak));
  return freezeData({ schema: 'lemmings-patch-comparison-levels/v1', policy: 'same-crop-rms;attenuation-only;peak-at-most-0.8',
    targetRms, levels: statistics.map(stats => targetRms / stats.rms), sourceRms: statistics.map(stats => stats.rms),
    sourcePeaks: statistics.map(stats => stats.peak), measuredSimilarity: null, perceptualQuality: null });
}
