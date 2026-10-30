const validTick = value => Number.isSafeInteger(value) && value >= 0;
const validEpoch = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const validRate = (value, max) => Number.isFinite(value) && value > 0 && value <= max;
const validReason = value => typeof value === 'string' && value.length > 0 && value.length <= 128;

// Segments belong to a single source epoch. A change at tick N preserves the
// score positions of ticks before N and applies the new rate from N onward.
export function createSimScoreTimeline({ epoch = 'initial', simTickOrigin = 0, scoreBeatOrigin = 0,
  tickDurationMs = 60, tempoBpm = 120, maxSegments = 2048 } = {}) {
  if (!validEpoch(epoch) || !validTick(simTickOrigin) || !Number.isFinite(scoreBeatOrigin) || scoreBeatOrigin < 0 ||
      !validRate(tickDurationMs, 60000) || !validRate(tempoBpm, 1000000) ||
      !Number.isSafeInteger(maxSegments) || maxSegments < 1 || maxSegments > 65536) throw new Error('Invalid simulation score timeline.');
  let currentEpoch = epoch;
  let segments = [Object.freeze({ epoch, simTickOrigin, scoreBeatOrigin, tickDurationMs, tempoBpm, discontinuityReason: 'initial' })];
  let epochs = [{ epoch, segments }];
  let epochIndex = new Map([[epoch, segments]]), segmentCount = 1;
  const find = (list, tick) => {
    let lo = 0, hi = list.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (list[mid].simTickOrigin <= tick) lo = mid;
      else hi = mid - 1;
    }
    return list[lo];
  };
  const map = ({ epoch: requestedEpoch = currentEpoch, simTick, subTick = 0, precision = 'tick' } = {}) => {
    const list = epochIndex.get(requestedEpoch);
    if (!validTick(simTick) || !Number.isFinite(subTick) || subTick < 0 || subTick >= 1 ||
        !['tick', 'endpoint', 'interpolated'].includes(precision) || !list || simTick < list[0].simTickOrigin) {
      throw new Error('Invalid or uncovered simulation time.');
    }
    const segment = find(list, simTick);
    const beat = segment.scoreBeatOrigin + (simTick - segment.simTickOrigin + subTick) * segment.tickDurationMs * segment.tempoBpm / 60000;
    if (!Number.isFinite(beat)) throw new Error('Simulation score time overflow.');
    return Object.freeze({ epoch: requestedEpoch, simTick, subTick, precision, beat });
  };
  const append = ({ simTick, tickDurationMs: duration, tempoBpm: tempo, discontinuityReason = 'rate-change' }) => {
    const last = segments.at(-1);
    if (!validTick(simTick) || simTick <= last.simTickOrigin || !validRate(duration, 60000) ||
        !validRate(tempo, 1000000) || !validReason(discontinuityReason)) throw new Error('Invalid timeline segment.');
    if (segmentCount >= maxSegments) throw new Error('Simulation score timeline capacity reached; retain or export a checkpoint.');
    const scoreBeatOrigin = map({ simTick }).beat;
    const segment = Object.freeze({ epoch: currentEpoch, simTickOrigin: simTick, scoreBeatOrigin,
      tickDurationMs: duration, tempoBpm: tempo, discontinuityReason });
    segments.push(segment); segmentCount++;
    return segment;
  };
  const resetEpoch = ({ epoch: nextEpoch, simTickOrigin: origin, scoreBeatOrigin: beat = 0,
    tickDurationMs: duration, tempoBpm: tempo, discontinuityReason }) => {
    if (!validEpoch(nextEpoch) || epochs.some(item => item.epoch === nextEpoch) || !validTick(origin) || !Number.isFinite(beat) || beat < 0 ||
        !validRate(duration, 60000) || !validRate(tempo, 1000000) || !validReason(discontinuityReason)) {
      throw new Error('Invalid timeline epoch reset.');
    }
    if (segmentCount >= maxSegments) throw new Error('Simulation score timeline capacity reached; retain or export a checkpoint.');
    currentEpoch = nextEpoch;
    segments = [Object.freeze({ epoch: nextEpoch, simTickOrigin: origin, scoreBeatOrigin: beat,
      tickDurationMs: duration, tempoBpm: tempo, discontinuityReason })];
    epochs.push({ epoch: nextEpoch, segments }); epochIndex.set(nextEpoch, segments); segmentCount++;
    return segments[0];
  };
  const snapshot = () => Object.freeze({ version: 2, currentEpoch,
    epochs: Object.freeze(epochs.map(item => Object.freeze({ epoch: item.epoch, segments: Object.freeze([...item.segments]) }))) });
  const restore = saved => {
    if (saved?.version !== 2 || !validEpoch(saved.currentEpoch) || !Array.isArray(saved.epochs) ||
        !saved.epochs.length || saved.epochs.length > maxSegments || saved.epochs.at(-1)?.epoch !== saved.currentEpoch) throw new Error('Invalid timeline checkpoint.');
    const nextEpochs = [], names = new Set();
    let count = 0;
    for (const entry of saved.epochs) {
      if (!validEpoch(entry?.epoch) || names.has(entry.epoch) || !Array.isArray(entry.segments) ||
          !entry.segments.length || (count += entry.segments.length) > maxSegments) throw new Error('Invalid timeline checkpoint epoch.');
      names.add(entry.epoch);
      const next = [];
      for (const segment of entry.segments) {
        if (!segment || segment.epoch !== entry.epoch || !validTick(segment.simTickOrigin) ||
          !Number.isFinite(segment.scoreBeatOrigin) || segment.scoreBeatOrigin < 0 ||
          !validRate(segment.tickDurationMs, 60000) || !validRate(segment.tempoBpm, 1000000) ||
          !validReason(segment.discontinuityReason) ||
          (next.length && segment.simTickOrigin <= next.at(-1).simTickOrigin)) throw new Error('Invalid timeline checkpoint segment.');
        if (next.length) {
          const previous = next.at(-1);
          const expected = previous.scoreBeatOrigin + (segment.simTickOrigin - previous.simTickOrigin) * previous.tickDurationMs * previous.tempoBpm / 60000;
          if (Math.abs(expected - segment.scoreBeatOrigin) > 1e-8 * Math.max(1, expected)) throw new Error('Discontinuous timeline checkpoint.');
        }
        next.push(Object.freeze({ epoch: entry.epoch, simTickOrigin: segment.simTickOrigin,
          scoreBeatOrigin: segment.scoreBeatOrigin, tickDurationMs: segment.tickDurationMs,
          tempoBpm: segment.tempoBpm, discontinuityReason: segment.discontinuityReason }));
      }
      nextEpochs.push({ epoch: entry.epoch, segments: next });
    }
    epochs = nextEpochs; epochIndex = new Map(epochs.map(item => [item.epoch, item.segments]));
    segmentCount = count; currentEpoch = saved.currentEpoch; segments = epochs.at(-1).segments;
  };
  const currentSegment = () => segments.at(-1);
  const epochCount = () => epochs.length;
  return { map, append, resetEpoch, snapshot, restore, currentSegment, epochCount };
}
