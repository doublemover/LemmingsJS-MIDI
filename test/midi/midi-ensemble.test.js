import { expect } from 'chai';
import { applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';
import { createMidiProject, projectToMidiConfig, reduceMidiProject, sanitizeMidiProject, stringifyMidiProjectExport, importMidiProjectPayload } from '../../js/midi/project/MidiProject.js';
import { getMidiEnsembleRole, sanitizeMidiEnsemble } from '../../js/midi/project/MidiEnsemble.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
import { MidiMapping } from '../../js/midi/MidiMapping.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';

const project = () => applyGameEventMidiPreset(createMidiProject(), 'game-iron-ensemble');
const playable = value => projectToMidiConfig({ ...value, enabled: true });
const event = lemmingId => ({ sfxId: SoundEffectIds.BUILDER_STEP, lemmingId, laneIndex: 0 });

describe('Lemming MIDI ensemble', function() {
  it('preserves explicitly selected position pan through role selection and shared-channel suppression', () => {
    withFakeClockAndPerformance(() => {
      const config = playable(project()); config.position = { ...config.position, viewPan: true, panMode: 'level', lanePanSpread: 72 };
      const spec = new MidiMapping(config).mapEvent({ ...event(0), x: 50, laneCount: 4 }, { levelWidth: 100 });
      expect(spec).to.include({ ensembleRole: 'bass', pan: 0, spatialPan: true, explicitPan: true });
      for (const local of [false, true]) {
        const calls = [], output = makeOutput([2], calls), scheduler = new MidiScheduler(config);
        if (local) { output.supportsPerNotePan = true; output.supportsPerNoteInstrument = true; }
        try {
          scheduler.setOutput(output); scheduler.sendNote(spec, { laneIndex: 0, laneCount: 4 });
          expect(calls.some(call => call.type === 'cc' && call.cc === 10)).to.equal(false);
          const note = calls.find(call => call.type === 'noteOn'); expect(note).to.exist;
          if (local) expect(note.opts.pan).to.equal(0); else expect(note.opts).not.to.have.property('pan');
        } finally { scheduler.dispose(); }
      }
    });
  });
  it('coalesces repeated programs and controllers and releases channel voices before a conflicting edit', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], output = makeOutput([2], calls, 'fake-hardware');
      output.channels[2].sendProgramChange = value => calls.push({ type: 'program', value });
      const scheduler = new MidiScheduler({ mpe: { enabled: false }, position: { panRange: { min: -127, max: 127 } } });
      scheduler.setOutput(output);
      const spec = { channel: 2, program: 38, pan: -12, pitchBend: 0, note: 45, durationTicks: 4 };
      expect(scheduler.estimateMessages(spec)).to.deep.equal({ messages: 5, bytes: 14 });
      scheduler.sendNote(spec);
      expect(scheduler.estimateMessages(spec)).to.deep.equal({ messages: 2, bytes: 6 });
      scheduler.sendNote({ ...spec, note: 50 });
      expect(calls.filter(call => call.type === 'program')).to.have.length(1);
      expect(calls.filter(call => call.type === 'cc' && call.cc === 10)).to.have.length(1);
      expect(scheduler._activeNotes.size).to.equal(2);
      const before = calls.length;
      scheduler.sendNote({ ...spec, note: 57, program: 29, pan: -42 });
      const changed = calls.slice(before);
      expect(changed.slice(0, 2).map(call => call.type)).to.deep.equal(['noteOff', 'noteOff']);
      expect(changed.find(call => call.type === 'program').value).to.equal(29);
      expect(scheduler._activeNotes.size).to.equal(1);
      clock.tick(300);
      expect(scheduler._activeNotes.size).to.equal(0);
      scheduler.dispose();
    });
  });

  it('charges and sends local instruments per note without channel program or pan messages', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], output = makeOutput([2], calls, 'fake-local');
      output.supportsPerNotePan = true; output.supportsPerNoteInstrument = true;
      output.channels[2].sendProgramChange = value => calls.push({ type: 'program', value });
      const scheduler = new MidiScheduler({ mpe: { enabled: false } });
      scheduler.setOutput(output);
      const spec = { channel: 2, program: 38, pan: -30, note: 45, durationTicks: 4, ensembleRole: 'bass' };
      expect(scheduler.estimateMessages(spec)).to.deep.equal({ messages: 2, bytes: 6 });
      scheduler.sendNote(spec);
      scheduler.sendNote({ ...spec, program: 81, note: 69, ensembleRole: 'melody' });
      expect(calls.filter(call => call.type === 'program' || call.type === 'cc')).to.have.length(0);
      const ons = calls.filter(call => call.type === 'noteOn');
      expect(ons[0].opts.instrument).to.include({ program: 38, role: 'bass' });
      expect(ons[1].opts.instrument).to.include({ program: 81, role: 'melody' });
      expect(scheduler._activeNotes.size).to.equal(2);
      scheduler.dispose();
    });
  });

  it('keeps dedicated ensemble role channels when global MPE is enabled', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [5, 6] } });
      scheduler.setOutput(makeOutput([1, 2, 5, 6, 10], calls));
      scheduler.sendNote({ note: 45, channel: 2, program: 38, durationTicks: 1, ensembleRole: 'bass' });
      scheduler.sendNote({ note: 36, channel: 10, durationTicks: 1, ensembleRole: 'percussion', percussion: true });
      expect(calls.filter(call => call.type === 'noteOn').map(call => call.id)).to.deep.equal([2, 10]);
      expect([...scheduler._activeNotes.values()].every(voice => !voice.mpe)).to.equal(true);
      scheduler.dispose();
    });
  });

  it('reserves edited ensemble channels from MPE setup and other source voices', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], config = playable(project());
      config.mpe = { enabled: true, masterChannel: 1, memberChannels: [2, 3, 4, 5, 10] };
      const scheduler = new MidiScheduler(config);
      scheduler.setOutput(makeOutput([1, 2, 3, 4, 5, 10], calls));
      expect(calls.filter(call => call.type === 'pitchBend').map(call => call.id)).to.deep.equal([1, 5]);
      scheduler.sendNote({ note: 45, channel: 2, program: 38, durationTicks: 4, ensembleRole: 'bass' });
      scheduler.sendNote({ note: 70, pitchBend: 0.5, durationTicks: 4 });
      expect(calls.filter(call => call.type === 'noteOn').map(call => call.id)).to.deep.equal([2, 5]);
      expect(scheduler._activeNotes.size).to.equal(2);
      expect(calls.filter(call => call.type === 'pitchBend' && call.id === 2)).to.have.length(0);
      scheduler.dispose();
    });
  });

  it('restores cached MPE bends after release so the next voice receives its pitch', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } });
      scheduler.setOutput(makeOutput([1, 2], calls));
      scheduler.sendNote({ note: 60, pitchBend: 0.5, durationTicks: 1 });
      clock.tick(80);
      scheduler.sendNote({ note: 62, pitchBend: 0.5, durationTicks: 1 });
      expect(calls.filter(call => call.type === 'pitchBend' && call.value === 0.5)).to.have.length(2);
      scheduler.dispose();
    });
  });

  it('uses four editable, complementary roles with one shared modal scale', function() {
    const value = project(), config = playable(value), mapping = new MidiMapping(config);
    expect(value.ensemble.roles).to.have.length(4);
    expect(value.global.mpe.enabled).to.equal(false);
    expect(value.global.scale).to.include({ name: 'dorian', root: 2 });
    const specs = Array.from({ length: 4 }, (_, id) => mapping.mapEvent(event(id)));
    expect(specs.map(spec => spec.channel)).to.deep.equal([2, 3, 4, 10]);
    expect(specs.map(spec => spec.program)).to.deep.equal([38, 29, 81, null]);
    expect(specs.map(spec => spec.ensembleRole)).to.deep.equal(['bass', 'rhythm', 'melody', 'percussion']);
    expect(specs.every(spec => spec.velocity <= 127 && Math.abs(spec.pan) <= 42)).to.equal(true);
    for (let id = 0; id < 3; id += 1) {
      const role = value.ensemble.roles[id];
      for (const note of specs[id].notes || [specs[id].note]) {
        expect(note).to.be.within(role.register.min, role.register.max);
        expect(value.global.scale.degrees).to.include(((note - 2) % 12 + 12) % 12);
      }
    }
    expect(specs[3].percussion).to.equal(true);
    expect(specs[3].notes).to.equal(null);
  });

  it('keeps each lemming role stable across events, speed and lane-aware identities', function() {
    const value = project(), mapping = new MidiMapping(playable(value));
    const first = mapping.mapEvent(event(6));
    const later = mapping.mapEvent({ ...event(6), sfxId: SoundEffectIds.DIG, tick: 100, speedFactor: 8 });
    expect(later).to.include({ ensembleRole: first.ensembleRole, channel: first.channel, program: first.program });
    expect(getMidiEnsembleRole(value.ensemble, { lemmingId: 6, laneIndex: 1 }).id).to.equal('percussion');
  });

  it('preserves edited roles, explicit lemming assignments and source routes on re-enable and save', function() {
    let value = project();
    value = reduceMidiProject(value, { type: 'track.update', trackId: 'ensemble-bass', patch: { program: 34, channel: 6, velocityScale: 0.6 } });
    value = reduceMidiProject(value, { type: 'ensemble.role.update', trackId: 'ensemble-bass', patch: { pan: -30, register: { min: 38, max: 50 } } });
    value = reduceMidiProject(value, { type: 'ensemble.assignment.set', lemmingId: 7, laneIndex: 0, trackId: 'ensemble-bass' });
    const before = structuredClone(value);
    value = reduceMidiProject(reduceMidiProject(value, { type: 'enabled.set', enabled: false }), { type: 'enabled.set', enabled: true });
    expect(value.ensemble).to.deep.equal(before.ensemble);
    expect(value.tracks).to.deep.equal(before.tracks);
    const imported = importMidiProjectPayload(stringifyMidiProjectExport(value));
    expect(imported.ensemble).to.deep.equal(value.ensemble);
    const spec = new MidiMapping(playable(imported)).mapEvent(event(7));
    expect(spec).to.include({ channel: 6, program: 34, pan: -30, ensembleRole: 'bass' });
    const source = value.sources.find(entry => entry.sourceKey === String(SoundEffectIds.BUILDER_STEP) && entry.kind === 'sfx');
    value = reduceMidiProject(value, { type: 'source.assignTrack', sourceId: source.id, trackId: 'ensemble-melody' });
    expect(new MidiMapping(playable(value)).mapEvent(event(0))).to.include({ channel: 4, program: 81, trackId: 'ensemble-melody' });
  });

  it('honors muted and solo role tracks without reassigning another active instrument', function() {
    let value = project();
    value = reduceMidiProject(value, { type: 'track.update', trackId: 'ensemble-bass', patch: { mute: true } });
    const mapping = new MidiMapping(playable(value));
    expect(mapping.mapEvent(event(0))).to.equal(null);
    expect(mapping.mapEvent(event(1)).ensembleRole).to.equal('rhythm');
    value = reduceMidiProject(value, { type: 'track.update', trackId: 'ensemble-melody', patch: { solo: true } });
    expect(new MidiMapping(playable(value)).mapEvent(event(1))).to.equal(null);
    expect(new MidiMapping(playable(value)).mapEvent(event(2)).ensembleRole).to.equal('melody');
  });

  it('clears automatic routing when an ordinary palette is explicitly applied', function() {
    const value = project();
    const edited = reduceMidiProject(value, { type: 'track.update', trackId: 'ensemble-bass', patch: { program: 34 } });
    const ordinary = applyGameEventMidiPreset(edited, 'game-minor');
    expect(ordinary.ensemble).to.equal(undefined);
    expect(ordinary.tracks.find(track => track.id === 'ensemble-bass').program).to.equal(34);
    const enabled = reduceMidiProject(edited, { type: 'enabled.set', enabled: true });
    expect(enabled.ensemble).to.deep.equal(edited.ensemble);
    const source = edited.sources.find(entry => entry.kind === 'sfx' && entry.sourceKey === String(SoundEffectIds.BUILDER_STEP));
    const routed = reduceMidiProject(edited, { type: 'source.assignTrack', sourceId: source.id, trackId: 'ensemble-melody' });
    const reapplied = applyGameEventMidiPreset(routed, 'game-iron-ensemble');
    expect(reapplied.sources.find(entry => entry.id === source.id).trackId).to.equal(reapplied.ensemble.sourceTrackId);
  });

  it('rejects malformed role references and bounds saved assignments', function() {
    expect(sanitizeMidiEnsemble({ sourceTrackId: 'missing', roles: [] })).to.equal(null);
    const value = project();
    expect(sanitizeMidiProject({ ...value, ensemble: { ...value.ensemble, roles: [{ trackId: 'missing' }] } }).ensemble).to.equal(undefined);
    const assignments = Array.from({ length: 2200 }, (_, lemmingId) => ({ lemmingId, laneIndex: 1023, trackId: 'ensemble-bass' }));
    expect(sanitizeMidiProject({ ...value, ensemble: { ...value.ensemble, assignments } }).ensemble.assignments).to.have.length(2048);
  });
});
