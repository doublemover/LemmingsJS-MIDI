import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
import { createMidiProjectFromMidiConfig, projectToMidiConfig, createMidiProjectExportPayload, importMidiProjectPayload } from '../../js/midi/project/MidiProject.js';
import { MidiMapping } from '../../js/midi/MidiMapping.js';

describe('owned MIDI voice gates', function() {
  it('snapshots queued note parameters and cleans a disconnected output without throwing from its timer', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], output = makeOutput([1], calls), scheduler = new MidiScheduler({ mpe: { enabled: false } });
      scheduler.setOutput(output);
      const spec = { note: 60, timeMs: 100, durationTicks: 2 };
      scheduler.sendNote(spec); spec.note = 90; clock.tick(100);
      expect(calls.find(call => call.type === 'noteOn').note).to.equal(60);
      output.channels[1].sendNoteOff = () => { throw new Error('Device disconnected'); };
      expect(() => clock.tick(200)).not.to.throw();
      expect(scheduler._activeNotes.size).to.equal(0);
      expect(scheduler.lastOutputError).to.equal('Device disconnected');
      output.channels[1].sendNoteOn = () => { throw new Error('Still disconnected'); };
      scheduler.sendNote({ note: 62, timeMs: 400, durationTicks: 2 });
      expect(() => clock.tick(200)).not.to.throw();
      expect(scheduler._activeNotes.size).to.equal(0);
      scheduler.dispose();
    });
  });

  it('preserves optional device programs through project export, import and event lowering', function() {
    const project = createMidiProjectFromMidiConfig({ sfx: { 20: { note: 60 } } });
    expect(project.tracks[0].program).to.equal(null);
    project.tracks[0].program = 0;
    const imported = importMidiProjectPayload(createMidiProjectExportPayload(project));
    expect(imported.tracks[0].program).to.equal(0);
    const config = projectToMidiConfig(imported);
    expect(config.sfx['20'].program).to.equal(0);
    expect(new MidiMapping(config).mapEvent({ sfxId: 20 })).to.include({ program: 0 });
  });

  it('rejects broken imported routes rather than silently moving music to a fallback track', function() {
    const project = createMidiProjectFromMidiConfig({ sfx: { 20: { note: 60 } } });
    for (const alter of [
      p => { p.sources[0].trackId = 'missing'; },
      p => { p.tracks.push({ ...p.tracks[0] }); },
      p => { p.tracks[0].outputId = { invalid: true }; },
      p => { p.sources[0].mode = 'clip'; p.sources[0].clipId = 'missing'; }
    ]) {
      const broken = JSON.parse(JSON.stringify(project)); alter(broken);
      expect(() => importMidiProjectPayload(broken)).to.throw();
    }
  });

  it('uses one member-channel allocation for default and explicit routes to the same device', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], output = makeOutput([1, 2, 3], calls, 'synth');
      const scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2, 3] } });
      scheduler.setOutput(output); scheduler.setOutputs([output]); calls.length = 0;
      scheduler.sendNote({ note: 60, durationTicks: 4 });
      scheduler.sendNote({ note: 64, durationTicks: 4, outputId: 'synth', trackId: 'other' });
      expect(calls.filter(c => c.type === 'noteOn').map(c => c.id)).to.deep.equal([2, 3]);
      expect(calls.filter(c => c.type === 'noteOff')).to.have.length(0);
      scheduler.dispose();
    });
  });

  it('cancels a queued onset without submitting any future note to the device', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: false } });
      scheduler.setOutput(makeOutput([1], calls));
      scheduler.sendNote({ note: 60, timeMs: 200, durationTicks: 4 });
      expect(calls.filter(c => c.type === 'noteOn')).to.have.length(0);
      scheduler.clearQueue(); clock.tick(1000);
      expect(calls.filter(c => c.type === 'noteOn')).to.have.length(0);
      expect(scheduler._pendingNoteOns.size).to.equal(0);
      expect(scheduler._activeNotes.size).to.equal(0);
      scheduler.dispose();
    });
  });

  it('does not revive a future voice stolen before its onset', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: false }, limits: { maxActiveNotes: 1 } });
      scheduler.setOutput(makeOutput([1], calls));
      scheduler.sendNote({ note: 60, timeMs: 200, durationTicks: 4 });
      scheduler.sendNote({ note: 64, durationTicks: 10 }); clock.tick(300);
      expect(calls.filter(c => c.type === 'noteOn').map(c => c.note)).to.deep.equal([64]);
      scheduler.dispose();
    });
  });

  it('does not let a stolen MPE gate release or reset the replacement voice', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } });
      scheduler.setOutput(makeOutput([1, 2], calls)); scheduler.setTickMs(10); calls.length = 0;
      scheduler.sendNote({ note: 60, durationTicks: 10, pitchBend: 0.3 }); clock.tick(20);
      scheduler.sendNote({ note: 60, durationTicks: 20, pitchBend: 0.7 }); calls.length = 0;
      clock.tick(81);
      expect(calls).to.deep.equal([]);
      expect(scheduler._activeNotes.size).to.equal(1);
      clock.tick(119);
      expect(calls.filter(c => c.type === 'noteOff')).to.have.length(1);
      expect(calls.filter(c => c.type === 'pitchBend')).to.have.length(1);
      expect(scheduler._activeNotes.size).to.equal(0);
      scheduler.dispose();
    });
  });

  it('retriggering the same MIDI 1 pitch transfers gate ownership', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: false } });
      scheduler.setOutput(makeOutput([1], calls)); scheduler.setTickMs(10);
      scheduler.sendNote({ note: 60, durationTicks: 10 }); clock.tick(20);
      scheduler.sendNote({ note: 60, durationTicks: 20 });
      expect(calls.map(c => c.type)).to.deep.equal(['noteOn', 'noteOff', 'noteOn']);
      calls.length = 0; clock.tick(81); expect(calls).to.deep.equal([]);
      clock.tick(119); expect(calls.map(c => c.type)).to.deep.equal(['noteOff']);
      scheduler.dispose();
    });
  });

  it('sends the chosen zero-based device program before note onset, only when that onset occurs', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], output = makeOutput([1], calls), scheduler = new MidiScheduler({ mpe: { enabled: false } });
      output.channels[1].sendProgramChange = (program, opts) => calls.push({ type: 'program', program, opts });
      scheduler.setOutput(output);
      scheduler.sendNote({ note: 60, program: 0, timeMs: 50, durationTicks: 1 });
      expect(calls).to.deep.equal([]); clock.tick(50);
      expect(calls.map(c => c.type)).to.deep.equal(['program', 'noteOn']);
      expect(calls[0].program).to.equal(0);
      scheduler.dispose();
    });
  });
});
