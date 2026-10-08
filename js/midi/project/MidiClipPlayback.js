const getPlayableMidiClipSteps = clip => (
  Array.isArray(clip?.steps)
    ? clip.steps.filter(step => Number.isFinite(step?.note) && (step.probability ?? 1) > 0 && !step.tie)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    : []
);

const describeMidiClipPlayback = clip => {
  if (!clip) return 'Select a clip to inspect its playback.';
  if (clip.playback) return clip.playback.advance === 'event'
    ? 'Each game event advances one cell, including rests. Velocity, duration, chance, conditions and pitch layers belong to each cell. A pass is one complete traversal. Tie omits a cell; Hold/Tie extensions require game-tick phrase mode.'
    : 'Each game event starts this phrase on the game-tick clock. Rests keep their spacing; per-cell dynamics, conditions and pitch layers apply. A pass is a ' + (clip.playback.passCounter === 'completed' ? 'completed phrase (final cell consumed, even if silent; note releases may continue)' : 'started phrase') + '. Hold lasts until the next played cell or phrase end; Tie extends the preceding played note. New events replace only unsounded cells.';
  const steps = getPlayableMidiClipSteps(clip);
  const behavior = !steps.length ? 'This clip has no playable notes.'
    : clip.type === 'arp' ? `When assigned, each game event advances one of ${steps.length} playable notes.`
      : steps.length === 1 ? 'When assigned, each game event plays one note.'
        : `When assigned, each game event plays ${steps.length} notes together.`;
  const dynamics = steps.length
    ? ` Step ${(steps[0].index ?? 0) + 1} supplies base velocity and duration for all playable notes; blank values use project defaults.` : '';
  return `${behavior}${dynamics} Empty steps add no delay. Hold is stored only. Probability 0 omits a note; every positive value enables it. Tie currently omits its note and does not extend another note.`;
};

export { getPlayableMidiClipSteps, describeMidiClipPlayback };

// Bars follow level simulation time; wall-clock pauses and effective speed do not change position.
const getMidiTransportBar = (timing, tick, tickMs = 60) => {
  const beats = Math.max(1, timing?.timeSignature?.beats || 4);
  const unit = Math.max(1, timing?.timeSignature?.unit || 4);
  const bpm = Math.max(20, timing?.bpmBase || 120);
  return Math.floor(Math.max(0, Number(tick) || 0) * tickMs * bpm / 60000 / (beats * 4 / unit)) + 1;
};
const clipCounter = (unit, eventCount, passCount, barCount) => unit === 'bar' ? barCount : unit === 'pass' ? passCount : eventCount;
const clipConditionMatches = (condition, eventCount, passCount, barCount = 1) => {
  const every = Math.max(1, condition?.every || 1);
  return clipCounter(condition?.unit, eventCount, passCount, barCount) % every === (condition?.phase || 0);
};
const applyMidiClipTransforms = (step, eventCount, passCount, barCount = 1) => {
  if (!Number.isFinite(step?.note)) return step;
  const layers = step.transforms || {};
  const offset = (Math.max(1, clipCounter(layers.unit, eventCount, passCount, barCount)) - 1) % Math.max(1, layers.span || 1);
  return { ...step, note: Math.max(0, Math.min(127, step.note + (layers.transpose || 0) + 12 * (layers.octave || 0) + offset * (layers.interval || 0))) };
};

const clipStepEnabled = (sequence, step, eventCount, passCount, barCount = 1) => {
  if (!step || (step.probability ?? 1) <= 0) return false;
  if (!clipConditionMatches(step.condition, eventCount, passCount, barCount)) return false;
  let hash = 2166136261;
  for (const char of sequence.id || '') hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ eventCount, 16777619); hash = Math.imul(hash ^ passCount, 16777619);
  hash = Math.imul(hash ^ (step.index || 0), 16777619);
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15; hash = Math.imul(hash, 0x846ca68b); hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296 < (step.probability ?? 1);
};

const clipCellEnabled = (sequence, step, eventCount, passCount, barCount = 1) => Number.isFinite(step?.note) && !step.tie && clipStepEnabled(sequence, step, eventCount, passCount, barCount);

const buildMidiClipPhrase = (sequence, eventCount, passCount, mapStep, barCount = 1) => {
  const steps = sequence.steps.slice(0, 16), spacing = sequence.spacingTicks;
  const cells = steps.map((step, index) => clipCellEnabled(sequence, step, eventCount, passCount, barCount)
    ? { ...mapStep(applyMidiClipTransforms(step, eventCount, passCount, barCount)), stepIndex: index, stepCount: steps.length } : { note: null, stepIndex: index, stepCount: steps.length });
  let previous = null;
  cells.forEach((cell, index) => {
    if (Number.isFinite(cell.note)) previous = cell;
    else if (steps[index].tie && previous && !steps[previous.stepIndex].hold && clipStepEnabled(sequence, steps[index], eventCount, passCount, barCount)) previous.durationTicks += spacing;
    if (Number.isFinite(cell.note) && steps[index].hold) {
      const next = cells.findIndex((candidate, at) => at > index && Number.isFinite(candidate.note));
      cell.durationTicks = Math.max(cell.durationTicks, (next < 0 ? cells.length - index : next - index) * spacing);
    }
  });
  return cells;
};

export { clipCellEnabled, buildMidiClipPhrase, clipConditionMatches, applyMidiClipTransforms, getMidiTransportBar };
