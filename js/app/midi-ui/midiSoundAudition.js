import { MidiMapping } from '../../midi/MidiMapping.js';
import { projectToMidiConfig } from '../../midi/project/MidiProject.js';

const createSoundAuditionPlan = (source, project, frameMs = 60, eventIndex = 0) => {
  const track = project.tracks.find(item => item.id === source?.trackId);
  if (!source?.enabled) return { notes: [], reason: 'This event is off.' };
  if (track?.mute) return { notes: [], reason: `${track.name} is muted.` };
  if (project.tracks.some(item => item.solo && !item.mute) && !track?.solo) return { notes: [], reason: `${track?.name || 'Track'} is excluded by solo.` };
  if (source.mode !== 'direct') return { notes: [], reason: 'Use clip audition for this clip-routed event.' };
  const m = source.mapping || {};
  const config = projectToMidiConfig({ ...project, enabled: true });
  const runtimeMapping = (source.kind === 'sfx' ? config.sfx : config.triggers)?.[source.sourceKey];
  const spec = new MidiMapping(config).mapEvent({ sfxId: Number(source.sourceKey) }, {}, 0, runtimeMapping);
  if (!spec) return { notes: [], reason: 'This event has no audible mapping.' };
  const original = spec.notes?.length ? [...spec.notes] : [spec.note];
  let notes = original;
  if (m.arp?.enabled || m.phrase?.enabled) notes.sort((a, b) => a - b);
  if ((m.phrase?.mode || m.arp?.mode) === 'down') notes.reverse();
  if (m.arp?.enabled) {
    if (m.arp.mode === 'updown' && notes.length > 2) notes = [...notes, ...notes.slice(1, -1).reverse()];
    notes = [notes[eventIndex % notes.length]];
  }
  return { notes: notes.slice(0, 8).map((note, index) => ({
    note, velocity: spec.velocity,
    playback: { sfxId: Number(source.sourceKey), durationMs: spec.durationTicks * frameMs },
    pan: spec.pan, pitchBend: spec.pitchBend,
    durationMs: spec.durationTicks * frameMs,
    offsetMs: m.phrase?.enabled ? index * (m.phrase.spacingTicks || 2) * frameMs : 0
  })), reason: null };
};

export { createSoundAuditionPlan };
