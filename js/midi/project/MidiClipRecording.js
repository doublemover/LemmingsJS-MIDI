// Quantize from the first note-on. The latest onset/order wins a monophonic cell;
// note-off order never changes placement. Existing cells are deliberately replaced.
const buildMidiClipRecording = (notes, { length, tickMs = 60, spacingTicks = 2, minDuration = 1, maxDuration = 960 }) => {
  const ordered = notes.filter(note => Number.isFinite(note.onsetMs) && Number.isFinite(note.note))
    .slice().sort((a, b) => a.onsetMs - b.onsetMs || a.order - b.order);
  const steps = Array.from({ length: Math.max(1, Math.min(16, length)) }, (_, index) => ({ index, note: null, velocity: null, durationTicks: null, probability: 1, hold: false, tie: false }));
  let collisions = 0, outside = 0;
  const origin = ordered[0]?.onsetMs || 0;
  for (const note of ordered) {
    const index = Math.round((note.onsetMs - origin) / (tickMs * spacingTicks));
    if (index < 0 || index >= steps.length) { outside += 1; continue; }
    if (steps[index].note != null) collisions += 1;
    steps[index] = { ...steps[index], note: Math.max(0, Math.min(127, Math.round(note.note))), velocity: Math.max(1, Math.min(127, Math.round(note.velocity))),
      durationTicks: Math.max(minDuration, Math.min(maxDuration, Math.max(1, Math.round(note.durationMs / tickMs)))) };
  }
  return { steps, collisions, outside, retained: steps.filter(step => step.note != null).length };
};
export { buildMidiClipRecording };
