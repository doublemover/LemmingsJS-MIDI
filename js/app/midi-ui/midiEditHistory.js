import { cloneSafeObject } from '../../util/safeObject.js';

const musicSnapshot = project => cloneSafeObject({
  name: project.name, templateId: project.templateId, transport: project.transport,
  global: project.global, tracks: project.tracks.map(track => { const musical = { ...track }; delete musical.outputId; return musical; }), sources: project.sources,
  clips: project.clips, automation: project.automation, ensemble: project.ensemble ?? null
});

// Device access and selection are deliberately outside musical undo.
const createMidiEditHistory = (limit = 64) => {
  const past = [], future = [];
  let restoring = false;
  let gesture = null;
  const record = (previous, next) => {
    if (restoring || !previous) return;
    const before = musicSnapshot(previous), after = musicSnapshot(next);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (!gesture || !gesture.recorded) {
      past.push(before);
      if (past.length > limit) past.shift();
      if (gesture) gesture.recorded = true;
    }
    future.length = 0;
  };
  const restore = (from, to, current, commit) => {
    gesture = null;
    if (!from.length) return false;
    to.push(musicSnapshot(current));
    const snapshot = from.pop();
    restoring = true;
    try { commit({ ...current, ...snapshot, tracks: snapshot.tracks.map(track => ({ ...track,
      outputId: current.tracks.find(entry => entry.id === track.id)?.outputId ?? null })) }); } finally { restoring = false; }
    return true;
  };
  return {
    record,
    beginGesture: () => { gesture = { recorded: false }; },
    endGesture: () => { gesture = null; },
    undo: (current, commit) => restore(past, future, current, commit),
    redo: (current, commit) => restore(future, past, current, commit),
    state: () => ({ canUndo: !!past.length, canRedo: !!future.length })
  };
};

export { createMidiEditHistory, musicSnapshot };
