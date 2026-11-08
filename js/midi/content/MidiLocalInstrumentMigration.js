import { freezeData } from '../../core/CanonicalData.js';
const VERSION = 1, fail = message => Object.assign(new Error(message), { name: 'SoundContentError', code: 'local-instrument-migration' });
const nativePatchFor = (track, percussion) => {
  if (percussion) return 'material.sheet-metal';
  const program = track.program;
  if (program == null) return 'foundation.soft-triangle';
  if (program >= 0 && program <= 7) return 'forge.copper-tine';
  if (program >= 24 && program <= 31) return 'pluck.wire-ladder';
  if (program >= 32 && program <= 39) return 'forge.rubber-bolt';
  if (program >= 80 && program <= 87) return 'spectrum.acid-current-dry';
  if (program >= 88 && program <= 95) return 'choir.hollow-ooh';
  if (program >= 112 && program <= 119) return 'material.timber';
  return 'foundation.soft-triangle';
};

export function planMidiLocalInstrumentMigration(project) {
  if (!project || !Array.isArray(project.tracks) || !project.tracks.length || project.tracks.length > 64 || !Array.isArray(project.sources)) throw fail('Choose a supported event sound project.');
  const entries = project.tracks.filter(track => !track.instrumentRef).map(track => {
    const percussion = project.ensemble?.roles?.some(role => role.trackId === track.id && role.percussion === true) || project.sources.some(source => source.trackId === track.id && source.mapping?.percussion === true);
    return { trackId: track.id, originalProgram: track.program ?? null, percussion: !!percussion, patchId: nativePatchFor(track, percussion),
      equivalence: 'declared-native-alias;not-GM-emulation', notices: percussion ? ['GM kit articulations require an explicitly selected prepared drum kit; this default is one authored metallic body.'] : track.program != null ? ['The external GM program is preserved; local timbre uses an authored native instrument.'] : [] };
  });
  if (new Set(entries.map(entry => entry.patchId)).size > 16) throw fail('Use at most sixteen distinct native default instruments.');
  return freezeData({ schema: 'midi-local-instrument-migration-plan/v1', version: VERSION, entries, preserved: ['event-note-and-scale-mapping', 'event-duration-and-gate-multipliers', 'note-on-strength-and-reduction', 'note-off-velocity-ratio', 'external-program-and-routing', 'physical-world'],
    legacyEnvelopePolicy: 'strength-and-gate-fields-remain-mapping-controls;never-ADSR-seconds', physicalMutation: false, externalOutputRequested: false });
}

export function validateMidiLocalInstrumentMigration(value) {
  if (value == null) return null;
  if (!value || value.schema !== 'midi-local-instrument-migration/v1' || value.version !== VERSION || !Array.isArray(value.entries) || value.entries.length > 64 || value.physicalMutation !== false || value.externalProgramChanged !== false || value.legacyEnvelopePolicy !== 'strength-and-gate-fields-remain-mapping-controls;never-ADSR-seconds') throw fail('The local instrument conversion receipt is unsupported.');
  const seen = new Set();
  const entries = value.entries.map(entry => {
    if (!entry || typeof entry.trackId !== 'string' || !entry.trackId || entry.trackId.length > 128 || seen.has(entry.trackId) || typeof entry.patchId !== 'string' || !/^[a-z][a-z0-9._:-]{0,127}$/i.test(entry.patchId) || !Number.isSafeInteger(entry.revision) || entry.revision < 1 || !/^[a-f0-9]{64}$/.test(entry.definitionHash || '') || entry.originalProgram !== null && (!Number.isInteger(entry.originalProgram) || entry.originalProgram < 0 || entry.originalProgram > 127) || typeof entry.percussion !== 'boolean' || entry.equivalence !== 'declared-native-alias;not-GM-emulation' || !Array.isArray(entry.notices) || entry.notices.length > 4 || entry.notices.some(message => typeof message !== 'string' || message.length > 256)) throw fail('A local instrument conversion row is invalid.');
    seen.add(entry.trackId); return { trackId: entry.trackId, originalProgram: entry.originalProgram, percussion: entry.percussion, patchId: entry.patchId, revision: entry.revision, definitionHash: entry.definitionHash, equivalence: entry.equivalence, notices: [...entry.notices] };
  });
  return freezeData({ schema: 'midi-local-instrument-migration/v1', version: VERSION, entries, legacyEnvelopePolicy: value.legacyEnvelopePolicy, physicalMutation: false, externalProgramChanged: false });
}
