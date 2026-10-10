import { getMidiMusicalPosition } from './MidiMusicalPosition.js';
import { getMidiClipVoices, expandMidiClipCell, clipConditionMatches, applyMidiClipTransforms, MAX_CLIP_PHRASE_OUTPUTS } from './MidiClipTransforms.js';
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
const getMidiTransportBar = (timing, tick, tickMs = 60, origin = 0) => getMidiMusicalPosition(timing, tick, tickMs, origin).bar;
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

const clipCellEnabled = (sequence, step, eventCount, passCount, barCount = 1) => getMidiClipVoices(step).some(voice => Number.isFinite(voice.note)) && !step.tie && clipStepEnabled(sequence, step, eventCount, passCount, barCount);

const buildMidiClipCell = (sequence, step, eventCount, passCount, mapStep, barCount = 1) => {
  if (!clipCellEnabled(sequence, step, eventCount, passCount, barCount)) return { note: null };
  const expanded = expandMidiClipCell(step, eventCount, passCount, barCount);
  const voices = expanded.notes.map(voice => ({ ...mapStep(voice), offsetTicks: voice.offsetTicks, clipVoiceIndex: voice.voiceIndex }))
    .filter(voice => Number.isFinite(voice.note));
  const primary = voices[0];
  return primary ? { ...primary, ...(step.voices || step.transformLayers ? { voices, expansionTruncated: expanded.truncated } : {}) } : { note: null };
};
const buildMidiClipPhrase = (sequence, eventCount, passCount, mapStep, barCount = 1) => {
  const steps = sequence.steps.slice(0, 16), spacing = sequence.spacingTicks;
  const cells = steps.map((step, index) => ({ ...buildMidiClipCell(sequence, step, eventCount, passCount, mapStep, barCount),
    stepIndex: index, stepCount: steps.length }));
  let previous = null;
  cells.forEach((cell, index) => {
    const voices = cell.voices || (Number.isFinite(cell.note) ? [cell] : []);
    if (voices.length) previous = cell;
    else if (steps[index].tie && previous && !steps[previous.stepIndex].hold && clipStepEnabled(sequence, steps[index], eventCount, passCount, barCount)) {
      for (const voice of previous.voices || [previous]) voice.durationTicks += spacing;
      if (previous.voices) previous.durationTicks = previous.voices[0].durationTicks;
    }
    if (voices.length && steps[index].hold) {
      const next = cells.findIndex((candidate, at) => at > index && Number.isFinite(candidate.note));
      for (const voice of voices) voice.durationTicks = Math.max(voice.durationTicks,
        Math.max(1, (next < 0 ? cells.length - index : next - index) * spacing - (voice.offsetTicks || 0)));
      if (cell.voices) cell.durationTicks = cell.voices[0].durationTicks;
    }
  });
  return cells;
};
const flattenMidiClipPhrase = (cells, spacingTicks = 2) => {
  const entries = []; let truncated = 0, completionTicks = 0;
  for (const [index, cell] of cells.slice(0, 16).entries()) {
    const offset = index * spacingTicks; completionTicks = Math.max(completionTicks, offset);
    truncated += cell.expansionTruncated || 0;
    const voices = cell.voices || (Number.isFinite(cell.note) ? [cell] : []);
    for (const voice of voices) {
      const offsetTicks = offset + (voice.offsetTicks || 0);
      if (entries.length >= MAX_CLIP_PHRASE_OUTPUTS) { truncated++; continue; }
      entries.push({ ...voice, stepIndex: cell.stepIndex ?? index, stepCount: cell.stepCount ?? cells.length, offsetTicks });
      completionTicks = Math.max(completionTicks, offsetTicks);
    }
  }
  entries.sort((a, b) => a.offsetTicks - b.offsetTicks || a.stepIndex - b.stepIndex);
  // A silent terminal marker retains pass completion through trailing rests and bounded thinning.
  entries.push({ note: null, offsetTicks: completionTicks });
  return { entries, truncated, completionTicks };
};
export { clipCellEnabled, buildMidiClipCell, buildMidiClipPhrase, flattenMidiClipPhrase, clipConditionMatches, applyMidiClipTransforms, getMidiTransportBar };
