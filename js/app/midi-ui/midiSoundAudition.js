import { getLocalAudioNotePan } from '../../midi/scheduler/LocalAudioVoiceBudget.js';
import { buildMidiClipCell, buildMidiClipPhrase, flattenMidiClipPhrase, getMidiTransportBar } from '../../midi/project/MidiClipPlayback.js';
import { MidiMapping } from '../../midi/MidiMapping.js';
import { projectToMidiConfig } from '../../midi/project/MidiProject.js';

const createSoundAuditionPlan = (source, project, frameMs = 60, eventIndex = 0, counters = {}, previewContext = {}) => {
  const track = project.tracks.find(item => item.id === source?.trackId);
  if (!source?.enabled) return { notes: [], reason: 'This event is off.' };
  if (track?.mute) return { notes: [], reason: `${track.name} is muted.` };
  if (project.tracks.some(item => item.solo && !item.mute) && !track?.solo && !(project.ensemble?.enabled && track?.id === project.ensemble.sourceTrackId)) return { notes: [], reason: `${track?.name || 'Track'} is excluded by solo.` };

  const config = projectToMidiConfig({ ...project, enabled: true });
  const laneIndex = Math.max(0, Math.min(1023, Math.trunc(Number(previewContext.laneIndex) || 0)));
  const event = { sfxId: source.kind === 'sfx' ? Number(source.sourceKey) : Number(previewContext.sfxId) || 0,
    ...(source.kind !== 'sfx' ? { triggerType: Number(source.sourceKey) } : {}), laneIndex,
    laneCount: Math.max(laneIndex + 1, Math.min(1024, Math.trunc(Number(previewContext.laneCount) || 1))),
    ...(Number.isInteger(previewContext.lemmingId) && previewContext.lemmingId >= 0 ? { lemmingId: previewContext.lemmingId } : {}),
    ...(typeof previewContext.type === 'string' ? { type: previewContext.type.slice(0, 64) } : {}),
    ...(Number.isInteger(previewContext.countdownNumber) ? { countdownNumber: previewContext.countdownNumber } : {}),
    ...(Number.isFinite(previewContext.intensity) ? { intensity: previewContext.intensity } : {}),
    ...(Number.isFinite(previewContext.x) ? { x: previewContext.x } : {}), ...(Number.isFinite(previewContext.y) ? { y: previewContext.y } : {}) };
  const explicitRole = config.ensemble?.enabled && config.ensemble.roles.some(role => role.trackId === previewContext.roleTrackId);
  if (explicitRole) {
    // An explicit role is a preview choice, not an observation of a synthetic game actor.
    event.lemmingId = event.lemmingId ?? 0;
    config.ensemble = { ...config.ensemble, assignments: [{ lemmingId: event.lemmingId, laneIndex, trackId: previewContext.roleTrackId }] };
  }
  const runtimeMapping = (source.kind === 'sfx' ? config.sfx : config.triggers)?.[source.sourceKey];
  const mapper = new MidiMapping(config), context = previewContext.context || {};
  const spec = mapper.mapEvent(event, context, 0, runtimeMapping);
  if (!spec) return { notes: [], reason: 'This event has no audible mapping.' };
  const m = runtimeMapping || {};
  const notices = [];
  if (config.ensemble?.enabled && spec.trackId === config.ensemble.sourceTrackId && !Number.isInteger(event.lemmingId)) notices.push('Choose a preview actor or ensemble role to test automatic instrument routing.');
  if (config.ensemble?.tension?.enabled || config.automationSpans?.length || m.phrase?.rolling?.enabled) notices.push('Standalone test does not evaluate live crowd tension, automation spans or rolling crowd evolution.');
  if (config.position?.mappings?.some(entry => entry.enabled !== false) && (!Number.isFinite(event.x) || !Number.isFinite(event.y))) notices.push('Spatial modulation needs explicit actor coordinates and view context; this test uses the available context only.');
  const metadata = item => ({ channel: item.channel, program: item.program, ensembleRole: item.ensembleRole, percussion: item.percussion,
    pitchBendRange: config.mpe?.enabled ? (config.mpe.pitchBendRange?.semitones ?? 2) + (config.mpe.pitchBendRange?.cents ?? 0) / 100 : 2,
    trackId: item.trackId, priority: item.priority, voiceBudget: item.voiceBudget, laneIndex, laneCount: event.laneCount,
    previewContextSource: explicitRole ? 'explicit-role' : Number.isInteger(previewContext.lemmingId) ? 'explicit-actor' : 'source-only' });
  const playback = (item = spec) => ({ sourceId: source.id, sourceKind: source.kind, sourceKey: source.sourceKey,
    clipId: m.clipSequence?.id ?? null, originTick: counters.tick ?? null, eventType: 'local-audition', sfxId: event.sfxId, triggerType: event.triggerType, laneIndex, laneCount: event.laneCount, lemmingId: previewContext.lemmingId ?? null,
    ensembleRole: item.ensembleRole, program: item.program, channel: item.channel, percussion: item.percussion });
  if (m.clipSequence) {
    const sequence = m.clipSequence, length = sequence.steps.length;
    const mapStep = step => mapper.mapEvent(event, context, 0, { ...m, note: step.note, notes: null, velocity: step.velocity, durationTicks: step.durationTicks, arp: null, phrase: null });
    const count = eventIndex + 1, pass = sequence.advance === 'event' ? Math.floor(eventIndex / length) + 1
      : sequence.passCounter === 'completed' ? (counters.completedPasses || 0) + 1 : count;
    const bar = getMidiTransportBar(config.timing, counters.tick, counters.tickMs || 60);
    const cells = sequence.advance === 'game-tick' ? buildMidiClipPhrase(sequence, count, pass, mapStep, bar)
      : [{ ...buildMidiClipCell(sequence, sequence.steps[eventIndex % length], count, pass, mapStep, bar), stepIndex: eventIndex % length, stepCount: length }];
    const expanded = flattenMidiClipPhrase(cells, sequence.spacingTicks);
    return { notices, notice: notices.join(' '), advance: true, completionMs: sequence.advance === 'game-tick' ? expanded.completionTicks * frameMs : null,
      notes: expanded.entries.filter(cell => Number.isFinite(cell.note)).slice(0, 64).map(cell => ({ ...metadata(cell), note: cell.note, velocity: cell.velocity,
        pan: getLocalAudioNotePan(cell, event, config.position), pitchBend: cell.pitchBend, durationMs: cell.durationTicks * frameMs, offsetMs: cell.offsetTicks * frameMs,
        playback: { ...playback(cell), durationMs: cell.durationTicks * frameMs, stepIndex: cell.stepIndex, stepCount: length } })),
      omitted: expanded.truncated + Math.max(0, expanded.entries.filter(cell => Number.isFinite(cell.note)).length - 64),
      reason: 'This cell is a rest or its condition skipped it. The next test advances another cell.' };
  }
  const original = spec.notes?.length ? [...spec.notes] : [spec.note];
  let notes = original;
  if (spec.arp?.enabled || spec.phrase?.enabled) notes.sort((a, b) => a - b);
  if ((spec.phrase?.mode || spec.arp?.mode) === 'down') notes.reverse();
  if (spec.arp?.enabled) {
    if (spec.arp.mode === 'updown' && notes.length > 2) notes = [...notes, ...notes.slice(1, -1).reverse()];
    notes = [notes[eventIndex % notes.length]];
  }
  return { notices, notice: notices.join(' '), notes: notes.slice(0, 8).map((note, index) => ({
    ...metadata(spec), note, velocity: spec.velocity,
    playback: { ...playback(), durationMs: spec.durationTicks * frameMs },
    pan: getLocalAudioNotePan(spec, event, config.position), pitchBend: spec.pitchBend,
    durationMs: spec.durationTicks * frameMs,
    offsetMs: spec.phrase?.enabled ? index * (spec.phrase.spacingTicks || 2) * frameMs : 0
  })), reason: null };
};

export { createSoundAuditionPlan };
