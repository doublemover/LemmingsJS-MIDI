import { createSimScoreTimeline } from '../procgen/workstation/SimScoreTimeline.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'CausalRenderError', code });
const natural = value => Number.isSafeInteger(value) && value >= 0;
const duration = value => Number.isFinite(value) && value > 0 && value <= 60000;

export function createCausalRenderTiming(source, sampleRate) {
  const origin = source?.boundary?.state?.sourceTimeMs, end = source?.finalBoundaryState?.sourceTimeMs;
  if (!Number.isFinite(origin) || origin < 0 || !Number.isFinite(end) || end < origin || ![44100, 48000, 96000].includes(sampleRate))
    throw failure('source-clock-unavailable', 'Captured source-clock boundaries are unavailable.');
  const clock = source.finalBoundaryState.timeline, saved = clock?.timeline;
  let timeline = null, epochs = null, fractional = 0, directDurations = 0, timelineDurations = 0, confirmedScoreTimes = 0;
  const initialize = () => {
    if (timeline) return;
    if (!saved || clock.version !== 1) throw failure('subtick-timeline-required', 'Fractional-tick timing requires a captured tick duration or qualified source timeline.');
    try {
      timeline = createSimScoreTimeline({ maxSegments: 2048 }); timeline.restore(saved);
      epochs = new Map(saved.epochs.map(epoch => [epoch.epoch, epoch.segments]));
    } catch (cause) { throw Object.assign(failure('invalid-source-timeline', 'The captured source timeline is malformed or exceeds this render profile.'), { cause }); }
  };
  const segmentFor = intent => {
    initialize(); const time = intent.scoreTime, segments = epochs.get(time.epoch);
    if (!segments || !natural(time.simTick) || time.simTick < segments[0].simTickOrigin ||
        clock.worldId != null && clock.worldId !== intent.worldId) throw failure('uncovered-source-timeline', 'The captured intent belongs to an uncovered source epoch or tick.');
    let low = 0, high = segments.length - 1;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (segments[middle].simTickOrigin <= time.simTick) low = middle; else high = middle - 1; }
    if (time.beat != null) {
      const mapped = timeline.map({ epoch: time.epoch, simTick: time.simTick, subTick: time.subTick ?? 0, precision: time.precision ?? 'tick' });
      if (!Number.isFinite(time.beat) || Math.abs(mapped.beat - time.beat) > 1e-10 * Math.max(1, Math.abs(mapped.beat)))
        throw failure('source-score-time-mismatch', 'The captured intent score time disagrees with its source timeline.');
      confirmedScoreTimes++;
    }
    return segments[low];
  };
  return Object.freeze({
    frameFor(intent) {
      const time = intent?.scoreTime, fraction = time?.subTick ?? 0, base = time?.sourceTimeMs;
      if (!Number.isFinite(base) || base < origin || base > end || !Number.isFinite(fraction) || fraction < 0 || fraction >= 1 ||
          time.sourceTickDurationMs != null && !duration(time.sourceTickDurationMs)) throw failure('invalid-source-time', 'Captured intent source time or fractional-tick duration is invalid.');
      let tickDuration = time.sourceTickDurationMs;
      const segment = saved ? segmentFor(intent) : null;
      if (segment && tickDuration != null && Math.abs(tickDuration - segment.tickDurationMs) > 1e-12 * Math.max(1, tickDuration))
        throw failure('source-tick-duration-mismatch', 'Captured tick duration disagrees with the committed source timeline.');
      if (fraction) {
        fractional++;
        if (tickDuration != null) directDurations++;
        else { tickDuration = (segment || segmentFor(intent)).tickDurationMs; timelineDurations++; }
      }
      const relativeMs = base - origin + fraction * (tickDuration ?? 0), frame = Math.round(relativeMs * sampleRate / 1000);
      if (!natural(frame)) throw failure('render-frame-overflow', 'Captured intent cannot be represented as a safe output frame.'); return frame;
    },
    receipt: () => Object.freeze({ timeDomain: 'captured-source-time', scope: 'provided-semantic-history-preflight', fractionalIntents: fractional, capturedDurationUses: directDurations,
      timelineDurationUses: timelineDurations, scoreTimesConfirmed: confirmedScoreTimes, rounding: 'nearest-frame-math-round', tempoPolicy: 'captured-source-segments-no-constant-tempo-substitution' }),
    sourceTimeline: saved || null
  });
}
