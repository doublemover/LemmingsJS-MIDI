const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const units = new Set([1, 2, 4, 8, 16]);
const beatsFor = meter => Number.isInteger(meter?.beats) && meter.beats >= 1 && meter.beats <= 16 ? meter.beats : 4;
const unitFor = meter => units.has(meter?.unit) ? meter.unit : 4;
const meterQuarterLength = meter => beatsFor(meter) * 4 / unitFor(meter);
// Displayed beats count denominator notes: 6/8 has six eighth-note beats.
const quarterMeterPosition = (quarter, meter) => {
  if (!Number.isFinite(quarter) || quarter < 0) return null;
  const beats = beatsFor(meter), unit = unitFor(meter), denominatorNotes = quarter * unit / 4;
  const barIndex = Math.floor(denominatorNotes / beats), withinBar = denominatorNotes - barIndex * beats;
  return Object.freeze({ quarter, bar: barIndex + 1, beat: Math.floor(withinBar) + 1,
    fraction: withinBar % 1, beats, unit, quartersPerBar: beats * 4 / unit });
};
const getMidiMusicalPosition = (timing, tick, tickMs = 60, origin = 0) => {
  const bpm = Math.max(20, Math.min(320, finite(timing?.bpmBase, 120)));
  const baseMs = tickMs > 0 ? finite(tickMs, 60) : 60;
  const quartersPerBar = meterQuarterLength(timing?.timeSignature);
  const ticksPerQuarter = 60000 / bpm / baseMs;
  const beat = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, finite(tick, 0) - finite(origin, 0)) / ticksPerQuarter);
  return { beat, bar: Math.floor(beat / quartersPerBar + 1e-12) + 1, quartersPerBar, ticksPerQuarter };
};
const getNextMidiBoundaryTick = (timing, tick, tickMs = 60, origin = 0, boundary = 'beat') => {
  tick = Math.max(0, finite(tick, 0)); origin = finite(origin, 0);
  const position = getMidiMusicalPosition(timing, tick, tickMs, origin);
  const span = boundary === 'bar' ? position.quartersPerBar : 1;
  const beat = (Math.floor(position.beat / span + 1e-12) + 1) * span;
  return { beat, tick: Math.max(tick + 1, Math.ceil(origin + beat * position.ticksPerQuarter - 1e-9)) };
};
export { getMidiMusicalPosition, getNextMidiBoundaryTick, meterQuarterLength, quarterMeterPosition };
