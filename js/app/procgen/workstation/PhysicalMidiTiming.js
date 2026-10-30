import { createProcgenPhysicalScoreClock } from './ProcgenPhysicalScoreClock.js';
import { smfBeatTick, smfTempo } from './ProcgenSmfBytes.js';

const failure = (code, message) => Object.assign(new RangeError(message), { code });
const natural = value => Number.isSafeInteger(value) && value >= 0;

export function preparePhysicalMidiTiming(events, source, ppq) {
  if (!Array.isArray(events) || events.length > 100000 || source?.version !== 1 || source.domain !== 'simulation-tick' ||
      !Number.isInteger(ppq) || ppq < 24 || ppq > 32767) throw failure('invalid-source-time', 'A bounded typed physical MIDI source is required.');
  const clock = createProcgenPhysicalScoreClock(); clock.restore(source.clock);
  const intentOrder = source.ordering === 'canonical-intent-order';
  if (source.ordering != null && !intentOrder) throw failure('invalid-source-order', 'Unknown physical MIDI source ordering.');
  const saved = clock.snapshot(), epochs = saved.timeline.epochs;
  const epochIndex = epochs.findIndex(entry => entry.epoch === source.origin?.epoch), epoch = epochs[epochIndex];
  if (!epoch || source.end?.epoch !== epoch.epoch) throw failure('source-epoch-range', 'Select one captured source epoch explicitly; cross-epoch flattening is unavailable.');
  const lastTick = epochs[epochIndex + 1]?.segments[0].simTickOrigin ?? saved.lastTick;
  const mapped = time => {
    if (time?.epoch !== epoch.epoch || !natural(time.simTick) || time.simTick > lastTick ||
        time.simTick === lastTick && (time.subTick ?? 0) > 0) throw failure('uncovered-source-time', 'Physical MIDI time exceeds the captured epoch boundary.');
    const result = clock.map(time);
    if (time.beat != null && (!Number.isFinite(time.beat) || Math.abs(time.beat - result.beat) > 1e-10 * Math.max(1, result.beat)))
      throw failure('source-score-time-mismatch', 'Physical MIDI beat disagrees with its captured piecewise timeline.');
    return result;
  };
  const origin = mapped(source.origin), end = mapped(source.end);
  if (end.beat < origin.beat) throw failure('invalid-source-range', 'Physical MIDI crop ends before its source origin.');
  const segmentFor = tick => {
    const segments = epoch.segments; let low = 0, high = segments.length - 1;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (segments[middle].simTickOrigin <= tick) low = middle; else high = middle - 1; }
    return segments[low];
  };
  const initial = segmentFor(origin.simTick), output = [];
  let lastSequence = -1, previousBeat = -Infinity, previousTick = -1, maximumBeatError = 0, maximumTimingErrorMs = 0, collapsedDistinctTimes = 0;
  const quantify = beat => {
    const tick = smfBeatTick(beat, ppq), error = Math.abs(tick / ppq - beat);
    maximumBeatError = Math.max(maximumBeatError, error);
    return tick;
  };
  const encodedTempo = bpm => { smfTempo(bpm); return Math.round(60000000 / bpm); };
  const tempoMap = [{ beat: 0, tick: 0, idealMs: 0, smfMs: 0, bpm: initial.tempoBpm, microseconds: encodedTempo(initial.tempoBpm) }];
  let tempoChanges = 0, previousTempo = initial.tempoBpm, collapsedTempoChanges = 0;
  for (const segment of epoch.segments) {
    if (segment.scoreBeatOrigin <= origin.beat || segment.scoreBeatOrigin > end.beat || segment.tempoBpm === previousTempo) continue;
    const beat = segment.scoreBeatOrigin - origin.beat, tick = quantify(beat), previous = tempoMap.at(-1);
    if (tick === previous.tick) collapsedTempoChanges++;
    tempoMap.push({ beat, tick, idealMs: previous.idealMs + (beat - previous.beat) * 60000 / previous.bpm,
      smfMs: previous.smfMs + (tick - previous.tick) * previous.microseconds / (1000 * ppq), bpm: segment.tempoBpm, microseconds: encodedTempo(segment.tempoBpm) });
    output.push({ type: 'tempo', bpm: segment.tempoBpm, beat }); tempoChanges++; previousTempo = segment.tempoBpm;
  }
  const tempoAt = (field, value) => {
    let low = 0, high = tempoMap.length - 1;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (tempoMap[middle][field] <= value) low = middle; else high = middle - 1; }
    return tempoMap[low];
  };
  const measure = (beat, tick) => {
    const ideal = tempoAt('beat', beat), encoded = tempoAt('tick', tick);
    const idealMs = ideal.idealMs + (beat - ideal.beat) * 60000 / ideal.bpm;
    const encodedMs = encoded.smfMs + (tick - encoded.tick) * encoded.microseconds / (1000 * ppq);
    maximumTimingErrorMs = Math.max(maximumTimingErrorMs, Math.abs(encodedMs - idealMs));
  };
  for (const entry of tempoMap) measure(entry.beat, entry.tick);
  for (const event of events) {
    const sequence = intentOrder ? event?.intentOrdinal : event?.causalSequence;
    if (!event || event.worldId !== saved.worldId || !natural(sequence) || sequence < lastSequence ||
        intentOrder && event.causalSequence != null && !natural(event.causalSequence) || event.type === 'tempo')
      throw failure('invalid-source-order', 'Physical MIDI events require matching world identity and nondecreasing canonical causal sequence.');
    const time = mapped(event.scoreTime), beat = time.beat - origin.beat;
    if (time.beat < origin.beat || time.beat > end.beat) throw failure('outside-source-range', 'Physical MIDI events must be selected inside the declared crop; no source event was silently excluded.');
    if (beat < previousBeat) throw failure('causal-time-inversion', 'Physical MIDI score time reverses canonical causality; export was not reordered.');
    if (event.beat != null && (!Number.isFinite(event.beat) || Math.abs(event.beat - time.beat) > 1e-10 * Math.max(1, time.beat)))
      throw failure('source-score-time-mismatch', 'Physical MIDI beat disagrees with its captured piecewise timeline.');
    const tick = quantify(beat); measure(beat, tick);
    if (tick === previousTick && beat !== previousBeat) collapsedDistinctTimes++;
    output.push({ ...event, beat }); lastSequence = sequence; previousBeat = beat; previousTick = tick;
  }
  const endBeat = end.beat - origin.beat, endTick = quantify(endBeat); measure(endBeat, endTick);
  const report = Object.freeze({ schema: 'procgen-physical-midi-timing/v1', mode: 'source-score', sourceTimeDomain: 'simulation-tick', exportTimeDomain: 'smf-tick',
    worldId: saved.worldId, epoch: epoch.epoch, origin, end, endTick, ppq, eventCount: events.length, tempoChanges,
    ordering: intentOrder ? 'canonical-intent-order-stable-protocol-expansion-on-quantized-ties' : 'canonical-causal-sequence-stable-on-quantized-ties', cropPolicy: 'reject-outside-explicit-range', liveLatenessApplied: false,
    quantization: Object.freeze({ rounding: 'nearest-tick-math-round', tempoEncoding: 'rounded-microseconds-per-quarter', maximumBeatError, maximumTimingErrorMs,
      collapsedDistinctTimes, collapsedTempoChanges, collisionScope: 'physical-events', errorScope: 'events-tempo-boundaries-and-crop-end' }) });
  return { events: output, bpm: initial.tempoBpm, endBeat, report };
}
