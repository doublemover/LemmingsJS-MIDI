import { buildMidiClipCell, buildMidiClipPhrase, flattenMidiClipPhrase, getMidiTransportBar } from '../../midi/project/MidiClipPlayback.js';
import { MidiMapping } from '../../midi/MidiMapping.js';
import { projectToMidiConfig } from '../../midi/project/MidiProject.js';

const createSoundAuditionPlan = (source, project, frameMs = 60, eventIndex = 0, counters = {}) => {
  const track = project.tracks.find(item => item.id === source?.trackId);
  if (!source?.enabled) return { notes: [], reason: 'This event is off.' };
  if (track?.mute) return { notes: [], reason: `${track.name} is muted.` };
  if (project.tracks.some(item => item.solo && !item.mute) && !track?.solo) return { notes: [], reason: `${track?.name || 'Track'} is excluded by solo.` };

  const config = projectToMidiConfig({ ...project, enabled: true });
  const runtimeMapping = (source.kind === 'sfx' ? config.sfx : config.triggers)?.[source.sourceKey];
  const spec = new MidiMapping(config).mapEvent({ sfxId: Number(source.sourceKey) }, {}, 0, runtimeMapping);
  if (!spec) return { notes: [], reason: 'This event has no audible mapping.' };
  const m = runtimeMapping || {};
  if (m.clipSequence) {
    const sequence = m.clipSequence, length = sequence.steps.length;
    const mapStep = step => new MidiMapping(config).mapEvent({ sfxId: Number(source.sourceKey) }, {}, 0, { ...m, note: step.note, notes: null, velocity: step.velocity, durationTicks: step.durationTicks, arp: null, phrase: null });
    const count = eventIndex + 1, pass = sequence.advance === 'event' ? Math.floor(eventIndex / length) + 1
      : sequence.passCounter === 'completed' ? (counters.completedPasses || 0) + 1 : count;
    const bar = getMidiTransportBar(config.timing, counters.tick, counters.tickMs || 60);
    const cells = sequence.advance === 'game-tick' ? buildMidiClipPhrase(sequence, count, pass, mapStep, bar)
      : [{ ...buildMidiClipCell(sequence, sequence.steps[eventIndex % length], count, pass, mapStep, bar), stepIndex: eventIndex % length, stepCount: length }];
    const expanded = flattenMidiClipPhrase(cells, sequence.spacingTicks);
    return { advance: true, completionMs: sequence.advance === 'game-tick' ? expanded.completionTicks * frameMs : null,
      notes: expanded.entries.filter(cell => Number.isFinite(cell.note)).slice(0, 64).map(cell => ({ note: cell.note, velocity: cell.velocity,
        pan: cell.pan, pitchBend: cell.pitchBend, durationMs: cell.durationTicks * frameMs, offsetMs: cell.offsetTicks * frameMs,
        playback: { sfxId: Number(source.sourceKey), durationMs: cell.durationTicks * frameMs, stepIndex: cell.stepIndex, stepCount: length } })),
      omitted: expanded.truncated + Math.max(0, expanded.entries.filter(cell => Number.isFinite(cell.note)).length - 64),
      reason: 'This cell is a rest or its condition skipped it. The next test advances another cell.' };
  }
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
