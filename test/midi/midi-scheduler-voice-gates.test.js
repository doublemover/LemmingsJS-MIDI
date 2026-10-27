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

  it('keeps a held MPE note sounding until a future note actually starts', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] }, limits: { maxActiveNotes: 1 } });
      scheduler.setOutput(makeOutput([1, 2], calls)); scheduler.setTickMs(10); calls.length = 0;
      scheduler.sendNote({ note: 60, durationTicks: 100, pitchBend: 0.3 });
      scheduler.sendNote({ note: 64, timeMs: 200, durationTicks: 20, pitchBend: 0.7 });
      expect(calls.filter(call => call.type === 'noteOff')).to.have.length(0);
      expect(scheduler._activeByChannel.get(2).note).to.equal(60);
      clock.tick(199);
      expect(calls.filter(call => call.type === 'noteOff')).to.have.length(0);
      clock.tick(1);
      expect(calls.filter(call => ['noteOn', 'noteOff'].includes(call.type)).map(call => [call.type, call.note])).to.deep.equal([
        ['noteOn', 60], ['noteOff', 60], ['noteOn', 64]
      ]);
      expect(scheduler._activeByChannel.get(2).note).to.equal(64);
      scheduler.dispose();
    });
  });

  it('cancels a future MPE note without touching the held channel', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } });
      scheduler.setOutput(makeOutput([1, 2], calls)); scheduler.setTickMs(10); calls.length = 0;
      scheduler.sendNote({ note: 60, durationTicks: 100 });
      scheduler.sendNote({ note: 64, timeMs: 200, durationTicks: 20, phraseVoiceKey: 'later' });
      expect(scheduler.cancelGamePhrase('later')).to.equal(true);
      clock.tick(300);
      expect(calls.filter(call => call.type === 'noteOn').map(call => call.note)).to.deep.equal([60]);
      expect(calls.filter(call => call.type === 'noteOff')).to.have.length(0);
      expect(scheduler._activeByChannel.get(2).note).to.equal(60);
      scheduler.dispose();
    });
  });

  it('rejects an empty or reserved MPE member zone without using the master', function() {
    withFakeClockAndPerformance(() => {
      for (const memberChannels of [[], [10]]) {
        const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels }, sfx: { 1: { percussion: true } } });
        scheduler.setOutput(makeOutput([1, 10], calls));
        expect(calls).to.deep.equal([]);
        expect(scheduler.sendNote({ note: 60, pitchBend: 0.5, durationTicks: 0 })).to.equal(false);
        expect(calls).to.deep.equal([]);
        expect(scheduler._activeNotes.size).to.equal(0);
        scheduler.dispose();
      }
    });
  });

  it('does not start an MPE note when receiver setup rejects its range', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], output = makeOutput([1, 2], calls), scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } });
      output.channels[2].sendPitchBendRange = () => false;
      scheduler.setOutput(output); calls.length = 0;
      expect(scheduler.sendNote({ note: 60, pitchBend: 0.5, durationTicks: 0 })).to.equal(false);
      expect(calls).to.deep.equal([]);
      scheduler.dispose();
    });
  });

  it('retires an old MPE zone before rejecting a noncontiguous replacement and never resurrects its channel', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } });
      scheduler.setOutput(makeOutput([1, 2, 3], calls)); scheduler.setTickMs(10); calls.length = 0;
      scheduler.sendNote({ note: 60, durationTicks: 100 });
      scheduler.sendNote({ note: 62, timeMs: 200, durationTicks: 20 });
      scheduler.setConfig({ mpe: { enabled: true, masterChannel: 1, memberChannels: [3], pitchBendRange: { semitones: 12, cents: 0 } } });
      expect(calls.find(call => call.type === 'noteOff' && call.note === 60)?.id).to.equal(2);
      calls.length = 0;
      expect(scheduler.sendNote({ note: 64, durationTicks: 100 })).to.equal(false);
      expect(scheduler.sendNote({ note: 67, durationTicks: 100 })).to.equal(false);
      clock.tick(300);
      expect(calls.filter(call => call.type === 'noteOn')).to.deep.equal([]);
      expect(scheduler.getOutputRouteState().mpeFailure).to.equal('noncontiguous-mpe-zone');
      expect(scheduler._activeNotes.size).to.equal(0);
      expect(calls.some(call => call.type === 'noteOn' && call.note === 62)).to.equal(false);
      scheduler.dispose();
    });
  });

  it('retries refused frontier setup without poisoning dedup or resurrecting the released victim', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], output = makeOutput([1], calls), scheduler = new MidiScheduler({ mpe: { enabled: false } });
      scheduler.setOutput(output); scheduler.sendNote({ note: 60, durationTicks: 0 });
      let attempts = 0;
      output.channels[1].sendControlChange = () => { attempts++; return false; };
      expect(scheduler.sendNote({ note: 64, timbre: 99, durationTicks: 0 })).to.equal(false);
      expect(attempts).to.equal(1);
      expect(calls.filter(call => call.type === 'noteOff').map(call => call.note)).to.deep.equal([60]);
      expect(scheduler._activeNotes.size).to.equal(0);
      output.channels[1].sendControlChange = (cc, value) => { attempts++; calls.push({ type: 'cc', cc, value }); return true; };
      expect(scheduler.sendNote({ note: 65, timbre: 99, durationTicks: 0 })).to.equal(true);
      expect(attempts).to.equal(2);
      expect(calls.filter(call => call.type === 'cc').map(call => call.value)).to.deep.equal([99]);
      expect(scheduler.sendNote({ note: 67, timbre: 99, durationTicks: 0 })).to.equal(true);
      expect(attempts).to.equal(2);
      scheduler.dispose();
    });
  });

  it('rejects required setup when a channel lacks its method', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], output = makeOutput([1], calls), scheduler = new MidiScheduler({ mpe: { enabled: false } });
      scheduler.setOutput(output);
      expect(scheduler.sendNote({ note: 60, program: 12, durationTicks: 0 })).to.equal(false);
      expect(calls.filter(call => call.type === 'noteOn')).to.have.length(0);
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
