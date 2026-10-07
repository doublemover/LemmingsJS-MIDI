const getPlayableMidiClipSteps = clip => (
  Array.isArray(clip?.steps)
    ? clip.steps.filter(step => Number.isFinite(step?.note) && (step.probability ?? 1) > 0 && !step.tie)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    : []
);

const describeMidiClipPlayback = clip => {
  if (!clip) return 'Select a clip to inspect its playback.';
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
