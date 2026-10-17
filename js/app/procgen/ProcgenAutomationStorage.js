import { sanitizeMidiProject } from '../../midi/project/MidiProject.js';
import { musicSnapshot } from '../midi-ui/midiEditHistory.js';
const PROCGEN_AUTOMATION_STORAGE_KEY = 'lemmings.procgen.automation.v2';
const LEGACY_KEY = 'lemmings.procgen.automationSpans.v1';
const saveProcgenAutomation = (storage, project) => {
  if (typeof storage?.setItem !== 'function') return false;
  try { storage.setItem(PROCGEN_AUTOMATION_STORAGE_KEY, JSON.stringify({ version: 2, value: project.automation, musicDirector: project.global?.musicDirector,
    musicProject: { version: 1, value: musicSnapshot(project) } })); return true; } catch { return false; }
};
const loadProcgenAutomation = (storage, project) => {
  for (const [key, version] of [[PROCGEN_AUTOMATION_STORAGE_KEY, 2], [LEGACY_KEY, 1]]) {
    try {
      const stored = JSON.parse(storage?.getItem(key) || 'null');
      if (stored?.version !== version || !Array.isArray(stored.value)) continue;
      // Keep every present canonical entry, including converted spatial curves
      // and saved overflow pages. Previously discarded data is unrecoverable.
      const snapshot = stored.musicProject?.version === 1 ? stored.musicProject.value : null;
      if (snapshot && Array.isArray(snapshot.tracks) && Array.isArray(snapshot.sources) && snapshot.global && Array.isArray(snapshot.clips)) {
        return sanitizeMidiProject({ ...project, ...musicSnapshot({ ...project, ...snapshot }), enabled: project.enabled,
          tracks: snapshot.tracks.map(track => ({ ...track, outputId: project.tracks.find(current => current.id === track.id)?.outputId ?? null })) });
      }
      const savedIds = new Set(stored.value.map(entry => entry?.id));
      const automation = version === 1 ? [...project.automation.filter(entry => !savedIds.has(entry.id)), ...stored.value] : stored.value;
      const next = sanitizeMidiProject({ ...project, automation, global: { ...project.global, ...(stored.musicDirector ? { musicDirector: stored.musicDirector } : {}) } });
      if (version === 1) saveProcgenAutomation(storage, next);
      return next;
    } catch { /* Try the legacy source, then retain the current defaults. */ }
  }
  return project;
};
export { PROCGEN_AUTOMATION_STORAGE_KEY, loadProcgenAutomation, saveProcgenAutomation };
