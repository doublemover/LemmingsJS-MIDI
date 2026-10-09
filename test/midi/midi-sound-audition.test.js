import { expect } from 'chai';
import { createSoundAuditionPlan } from '../../js/app/midi-ui/midiSoundAudition.js';
import { MidiMapping } from '../../js/midi/MidiMapping.js';
import { createMidiProject, projectToMidiConfig, sanitizeMidiProject } from '../../js/midi/project/MidiProject.js';
import { applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';

const ensemble = () => applyGameEventMidiPreset(createMidiProject(), 'game-iron-ensemble');
const fields = ['note', 'velocity', 'pan', 'pitchBend', 'program', 'channel', 'trackId', 'ensembleRole', 'percussion', 'priority', 'voiceBudget'];
const pick = value => Object.fromEntries(fields.map(key => [key, value[key]]));

describe('local event audition context', function() {
  it('shares live lane panning while preserving explicit pan and the configured local bend range', () => {
    const project = ensemble(), source = project.sources[0];
    project.global.position.lanePanSpread = 50;
    project.global.mpe.enabled = true; project.global.mpe.pitchBendRange = { semitones: 12, cents: 50 };
    const context = { roleTrackId: 'ensemble-melody', laneIndex: 0, laneCount: 4 };
    const spread = createSoundAuditionPlan(source, project, 60, 0, {}, context).notes[0];
    expect(spread.pan).to.equal(-8); expect(spread.pitchBendRange).to.equal(12.5);
    source.mapping.pan = 75;
    expect(createSoundAuditionPlan(source, project, 60, 0, {}, context).notes[0].pan).to.equal(75);
  });

  it('uses the live ensemble lowering for actual actor assignments and preserves edited instruments, registers and pan', () => {
    const project = ensemble(), source = project.sources[0];
    project.tracks.find(track => track.id === 'ensemble-bass').program = 35;
    source.mapping.pan = -67;
    project.ensemble.assignments = [{ lemmingId: 12, laneIndex: 2, trackId: 'ensemble-melody' }];
    const config = projectToMidiConfig({ ...project, enabled: true }), mapper = new MidiMapping(config);
    const before = JSON.stringify(project);
    for (const lemmingId of [0, 1, 2, 3, 12]) {
      const event = { type: 'bomber-countdown', countdownNumber: 3, intensity: 0.6, sfxId: Number(source.sourceKey), lemmingId, laneIndex: 2, laneCount: 4, x: 180, y: 240 };
      const spec = mapper.mapEvent(event, {}, 0, config.sfx[source.sourceKey]);
      const plan = createSoundAuditionPlan(source, project, 60, 0, {}, event);
      expect(pick(plan.notes[0])).to.deep.equal(pick(spec));
      expect(plan.notes[0].durationMs).to.equal(spec.durationTicks * 60);
      expect(plan.notes[0].playback).to.include({ lemmingId, laneIndex: 2, program: spec.program, ensembleRole: spec.ensembleRole, percussion: spec.percussion, channel: spec.channel });
      expect(plan.notes[0].previewContextSource).to.equal('explicit-actor');
    }
    expect(JSON.stringify(project)).to.equal(before);
  });

  it('provides an explicit role without inventing an observed actor, honors solo and removes percussion arpeggios', () => {
    const project = ensemble(), source = project.sources.find(item => item.sourceKey === '24');
    project.tracks.find(track => track.id === 'ensemble-percussion').solo = true;
    const before = JSON.stringify(project);
    const plan = createSoundAuditionPlan(source, project, 60, 0, {}, { roleTrackId: 'ensemble-percussion' });
    expect(plan.notes).to.have.length(1); expect(plan.notes[0]).to.include({ ensembleRole: 'percussion', percussion: true, channel: 10, previewContextSource: 'explicit-role' });
    expect(plan.notes[0].playback.lemmingId).to.equal(null);
    expect(plan.notice).to.include('does not evaluate live crowd tension');
    expect(createSoundAuditionPlan(source, project, 60, 0, {}, { roleTrackId: 'ensemble-bass' }).notes).to.have.length(0);
    expect(JSON.stringify(project)).to.equal(before);
  });

  it('preserves role metadata on every independent temporal clip cell and retains rests and entered dynamics', () => {
    const project = ensemble(), source = project.sources[0];
    source.mode = 'clip'; source.clipId = 'context-clip';
    project.clips = [{ id: 'context-clip', name: 'Context', type: 'stepPattern', lengthSteps: 3,
      playback: { advance: 'game-tick', spacingTicks: 3, passCounter: 'started' },
      steps: [{ index: 0, note: 60, velocity: 90, durationTicks: 2, voices: [{ note: 60, velocity: 90, durationTicks: 2 }, { note: 64, velocity: 65, durationTicks: 5 }] },
        { index: 1, note: null }, { index: 2, note: 72, velocity: 100, durationTicks: 4 }] }];
    const clean = sanitizeMidiProject(project), assigned = clean.sources.find(item => item.id === source.id);
    const plan = createSoundAuditionPlan(assigned, clean, 60, 0, {}, { roleTrackId: 'ensemble-melody' });
    expect(plan.notes).to.have.length(3); expect(plan.notes.every(note => note.playback.sourceId === assigned.id && note.playback.clipId === 'context-clip' && note.playback.eventType === 'local-audition')).to.equal(true); expect(plan.notes.map(note => note.offsetMs)).to.deep.equal([0, 0, 360]);
    expect(plan.notes.every(note => note.program === 81 && note.channel === 4 && note.ensembleRole === 'melody' && note.trackId === 'ensemble-melody')).to.equal(true);
    expect(plan.notes.map(note => note.durationMs)).to.deep.equal([120, 300, 240]);
    expect(plan.notes[0].velocity).not.to.equal(plan.notes[1].velocity);
    expect(clean.clips[0].steps[0].voices.map(voice => voice.note)).to.deep.equal([60, 64]);
  });

  it('labels absent live context and preserves legacy channel/program metadata without synthesizing a role', () => {
    const project = ensemble(), source = project.sources[0];
    const absent = createSoundAuditionPlan(source, project);
    expect(absent.notice).to.include('Choose a preview actor or ensemble role');
    expect(absent.notes[0].previewContextSource).to.equal('source-only');
    delete project.ensemble; project.tracks[0].program = 29; project.tracks[0].channel = 5;
    const legacy = createSoundAuditionPlan(source, project);
    expect(legacy.notes[0]).to.include({ program: 29, channel: 5, previewContextSource: 'source-only' });
    expect(legacy.notes[0].ensembleRole).to.equal(undefined);
  });
});
