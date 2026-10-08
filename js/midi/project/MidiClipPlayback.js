const getPlayableMidiClipSteps = clip => (
  Array.isArray(clip?.steps)
    ? clip.steps.filter(step => Number.isFinite(step?.note) && (step.probability ?? 1) > 0 && !step.tie)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    : []
);

const describeMidiClipPlayback = clip => {
  if (!clip) return 'Select a clip to inspect its playback.';
  if (clip.playback) return clip.playback.advance === 'event'
    ? 'Each game event advances one cell, including rests. Velocity, duration, probability and event/pass conditions belong to each cell. A pass is one complete traversal. Tie omits a cell; Hold/Tie extensions require game-tick phrase mode.'
    : 'Each game event starts this phrase on the game-tick clock. Rests keep their spacing; per-cell dynamics and event/pass conditions apply. A pass is a started phrase. Hold lasts until the next played cell or phrase end; Tie extends the preceding played note. New events replace only unsounded cells.';
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

const clipCellEnabled = (sequence, step, eventCount, passCount) => {
  if (!Number.isFinite(step?.note) || step.tie || (step.probability ?? 1) <= 0) return false;
  const count = step.condition?.unit === 'pass' ? passCount : eventCount;
  if (count % Math.max(1, step.condition?.every || 1)) return false;
  let hash = 2166136261;
  for (const char of sequence.id || '') hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ eventCount, 16777619); hash = Math.imul(hash ^ passCount, 16777619);
  hash = Math.imul(hash ^ (step.index || 0), 16777619);
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15; hash = Math.imul(hash, 0x846ca68b); hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296 < (step.probability ?? 1);
};

const buildMidiClipPhrase = (sequence, eventCount, passCount, mapStep) => {
  const steps = sequence.steps.slice(0, 16), spacing = sequence.spacingTicks;
  const cells = steps.map((step, index) => clipCellEnabled(sequence, step, eventCount, passCount)
    ? { ...mapStep(step), stepIndex: index, stepCount: steps.length } : { note: null, stepIndex: index, stepCount: steps.length });
  let previous = null;
  cells.forEach((cell, index) => {
    if (Number.isFinite(cell.note)) previous = cell;
    else if (steps[index].tie && previous && !steps[previous.stepIndex].hold) previous.durationTicks += spacing;
    if (Number.isFinite(cell.note) && steps[index].hold) {
      const next = cells.findIndex((candidate, at) => at > index && Number.isFinite(candidate.note));
      cell.durationTicks = Math.max(cell.durationTicks, (next < 0 ? cells.length - index : next - index) * spacing);
    }
  });
  return cells;
};

export { clipCellEnabled, buildMidiClipPhrase };
