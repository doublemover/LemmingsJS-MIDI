import { DEFAULT_MIDI_ENSEMBLE_TENSION, sanitizeMidiEnsembleTension } from './MidiEnsembleTension.js';
import { isPlainObject } from '../../util/safeObject.js';
import { quantizeToScale, resolveScale } from '../midi-mapping/MidiMappingDomain.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const MIDI_ENSEMBLE_ROLES = Object.freeze([
  { id: 'bass', name: 'Bass', channel: 2, program: 38, instrumentLabel: 'Synth bass', register: { min: 38, max: 50 }, pan: -12, durationScale: 0.9, velocityScale: 0.88, voiceBudget: 6 },
  { id: 'rhythm', name: 'Rhythm', channel: 3, program: 29, instrumentLabel: 'Overdriven guitar', register: { min: 50, max: 65 }, pan: -42, durationScale: 0.65, velocityScale: 0.78, voiceBudget: 6 },
  { id: 'melody', name: 'Melody', channel: 4, program: 81, instrumentLabel: 'Saw lead', register: { min: 65, max: 81 }, pan: 42, durationScale: 1, velocityScale: 0.72, voiceBudget: 8 },
  { id: 'percussion', name: 'Percussion', channel: 10, program: null, instrumentLabel: 'GM drums', register: { min: 36, max: 49 }, pan: 12, durationScale: 0.5, velocityScale: 0.8, voiceBudget: 4, percussion: true }
]);

const sanitizeMidiEnsemble = (value, trackIds = null) => {
  if (!isPlainObject(value)) return null;
  const validTrack = id => typeof id === 'string' && (!trackIds || trackIds.has(id));
  const roles = (Array.isArray(value.roles) ? value.roles : []).slice(0, 16).filter(role => validTrack(role?.trackId)).map(role => {
    const min = clamp(Math.round(number(role.register?.min, 36)), 0, 127);
    const max = clamp(Math.round(number(role.register?.max, 84)), min, 127);
    return { id: String(role.id || role.trackId), trackId: role.trackId, register: { min, max },
      pan: clamp(Math.round(number(role.pan, 0)), -127, 127),
      durationScale: clamp(number(role.durationScale, 1), 0.1, 4), percussion: role.percussion === true };
  });
  if (!roles.length || !validTrack(value.sourceTrackId)) return null;
  const assignments = (Array.isArray(value.assignments) ? value.assignments : []).slice(-2048).filter(entry =>
    Number.isInteger(entry?.lemmingId) && entry.lemmingId >= 0 && validTrack(entry.trackId)).map(entry => ({
    lemmingId: entry.lemmingId, laneIndex: clamp(Math.trunc(number(entry.laneIndex, 0)), 0, 1023), trackId: entry.trackId
  }));
  return { enabled: value.enabled !== false, sourceTrackId: value.sourceTrackId, roles, assignments, tension: sanitizeMidiEnsembleTension(value.tension) };
};

const createDefaultMidiEnsemble = (sourceTrackId, tracks = []) => {
  const existing = tracks.filter(track => !MIDI_ENSEMBLE_ROLES.some(role => track.id === 'ensemble-' + role.id));
  const roleTracks = MIDI_ENSEMBLE_ROLES.map(role => ({ id: 'ensemble-' + role.id, name: role.name,
    channel: role.channel, program: role.program, instrumentLabel: role.instrumentLabel,
    velocityScale: role.velocityScale, voiceBudget: role.voiceBudget, priority: 1, outputId: null }));
  const roles = MIDI_ENSEMBLE_ROLES.map(role => ({ id: role.id, trackId: 'ensemble-' + role.id,
    register: { ...role.register }, pan: role.pan, durationScale: role.durationScale, percussion: !!role.percussion }));
  return { tracks: [...existing, ...roleTracks], ensemble: { enabled: true, sourceTrackId, roles, assignments: [], tension: { ...DEFAULT_MIDI_ENSEMBLE_TENSION } } };
};

const buildMidiEnsembleConfig = (ensemble, tracks, hasSolo = false) => ensemble ? {
  ...ensemble, roles: ensemble.roles.map(role => ({ ...role, track: tracks.find(track => track.id === role.trackId) || null,
    disabled: !tracks.some(track => track.id === role.trackId && !track.mute && (!hasSolo || track.solo)) }))
} : null;

const getMidiEnsembleRole = (ensemble, event) => {
  if (!ensemble?.enabled || !Number.isInteger(event?.lemmingId) || event.lemmingId < 0 || !ensemble.roles?.length) return null;
  const lane = Math.max(0, Math.trunc(number(event.laneIndex, 0)));
  const assigned = ensemble.assignments?.find(entry => entry.lemmingId === event.lemmingId && entry.laneIndex === lane);
  return assigned ? ensemble.roles.find(role => role.trackId === assigned.trackId) || null
    : ensemble.roles[(event.lemmingId + lane) % ensemble.roles.length];
};

const applyMidiEnsembleToSpec = (spec, event, config, mapping = {}) => {
  const ensemble = config?.ensemble;
  if (!spec || !ensemble?.enabled || spec.trackId !== ensemble.sourceTrackId) return spec;
  const role = getMidiEnsembleRole(ensemble, event);
  if (!role) return spec;
  if (role.disabled || !role.track) return null;
  const track = role.track, scale = resolveScale(config.scale);
  const low = Math.max(config.noteRange?.min ?? 0, role.register.min);
  const high = Math.min(config.noteRange?.max ?? 127, role.register.max);
  if (low > high) return null;
  const fold = pitch => {
    let value = quantizeToScale(pitch, scale);
    while (value < low) value += 12;
    while (value > high) value -= 12;
    if (value < low || value > high) {
      for (let candidate = low; candidate <= high; candidate += 1) {
        if (scale.degrees.includes(((candidate - scale.root) % 12 + 12) % 12)) return candidate;
      }
      return null;
    }
    return value;
  };
  const notes = (spec.notes || [spec.note]).map(fold);
  if (!role.percussion && notes.some(note => note == null)) return null;
  const drumNotes = [36, 38, 42, 45, 49];
  const note = role.percussion ? drumNotes[Math.abs(Math.trunc(number(event.sfxId, 0))) % drumNotes.length] : notes[0];
  const pan = Number.isFinite(mapping.pan) ? spec.pan : role.pan;
  const velocity = clamp(Math.round(spec.velocity * track.velocityScale), 1, 127);
  return { ...spec, note, notes: role.percussion ? null : spec.notes ? notes : null,
    velocity, releaseVelocity: clamp(Math.round((spec.releaseVelocity ?? spec.velocity) * track.velocityScale), 1, 127),
    durationTicks: Math.max(1, Math.round(spec.durationTicks * role.durationScale)),
    channel: track.channel, program: track.program, trackId: track.id, voiceBudget: track.voiceBudget,
    priority: track.priority, outputId: track.outputId, pan, spatialPan: false,
    timbre: null, pitchBend: Number.isFinite(mapping.pitchBend) ? spec.pitchBend : null,
    percussion: role.percussion, ensembleRole: role.id,
    ...(role.percussion ? { arp: null, phrase: null } : {}) };
};

export { MIDI_ENSEMBLE_ROLES, sanitizeMidiEnsemble, createDefaultMidiEnsemble, buildMidiEnsembleConfig,
  getMidiEnsembleRole, applyMidiEnsembleToSpec };
