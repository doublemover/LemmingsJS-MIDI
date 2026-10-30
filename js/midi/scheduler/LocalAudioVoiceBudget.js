// Both live notes and standalone local tests use the same explicit-pan and lane-spread policy.
const getLocalAudioNotePan = (spec, meta, position, supported = true) => {
  const spread = position?.lanePanSpread;
  const lanes = Math.max(1, Math.min(1024, Math.trunc(meta.laneCount) || 1));
  const lane = Math.max(0, Math.min(lanes - 1, Math.trunc(meta.laneIndex) || 0));
  return supported && Number.isFinite(spread) && !spec.explicitPan && !spec.spanPan
    ? Math.max(-127, Math.min(127, (spec.pan ?? 0) + (lanes > 1 ? (lane * 2 / (lanes - 1) - 1) * spread : 0))) : spec.pan;
};

const priorityOf = voice => Number.isFinite(voice.priority) ? voice.priority : 1;

/** Select a bounded local gate victim; hardware allocation keeps its existing policy. */
const selectLocalAudioVoice = (voices, incoming) => {
  const counts = new Map();
  let lowest = Infinity;
  for (const voice of voices) {
    const owner = voice.owner ?? null; if (!counts.has(owner)) counts.set(owner, new Map());
    const lanes = counts.get(owner); lanes.set(voice.laneIndex ?? 0, (lanes.get(voice.laneIndex ?? 0) || 0) + 1);
    lowest = Math.min(lowest, priorityOf(voice));
  }
  if (lowest > priorityOf(incoming)) return null;
  let selected = null;
  for (const voice of voices) {
    if (priorityOf(voice) !== lowest) continue;
    const lane = voice.laneIndex ?? 0, selectedLane = selected?.laneIndex ?? 0;
    const count = counts.get(voice.owner ?? null).get(lane), selectedCount = counts.get(selected?.owner ?? null)?.get(selectedLane) || 0;
    const sameLane = (voice.owner ?? null) === (incoming.owner ?? null) && lane === (incoming.laneIndex ?? 0),
      selectedSameLane = (selected?.owner ?? null) === (incoming.owner ?? null) && selectedLane === (incoming.laneIndex ?? 0);
    if (!selected || count > selectedCount || (count === selectedCount && sameLane && !selectedSameLane) ||
      (count === selectedCount && sameLane === selectedSameLane && voice.startedAt < selected.startedAt)) selected = voice;
  }
  return selected;
};

export { selectLocalAudioVoice, getLocalAudioNotePan };
