const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const getMidiMusicalPosition = (timing, tick, tickMs = 60, origin = 0) => {
  const bpm = Math.max(20, Math.min(320, finite(timing?.bpmBase, 120)));
  const baseMs = tickMs > 0 ? finite(tickMs, 60) : 60;
  const quartersPerBar = Math.max(1, finite(timing?.timeSignature?.beats, 4)) * 4 / Math.max(1, finite(timing?.timeSignature?.unit, 4));
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
export { getMidiMusicalPosition, getNextMidiBoundaryTick };
