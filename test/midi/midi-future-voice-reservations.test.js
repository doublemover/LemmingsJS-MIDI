import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const fixture = ({ independent = false, track = false, limit = 1 } = {}) => {
  const calls = [], output = makeOutput([1], calls), voices = new Set();
  output.supportsIndependentNoteGates = independent;
  output.supportsPerNoteInstrument = independent;
  output.canAllocateVoice = () => true;
  output.isVoiceActive = token => voices.has(token);
  output.channels[1].sendNoteOn = (note, options) => { calls.push({ type: 'noteOn', note, options, at: performance.now() }); voices.add(options.voiceToken); };
  output.channels[1].sendNoteOff = (note, options) => { calls.push({ type: 'noteOff', note, options, at: performance.now() }); voices.delete(options?.voiceToken); };
  const scheduler = new MidiScheduler({ mpe: { enabled: false }, limits: { maxActiveNotes: track ? 8 : limit } });
  scheduler.setOutput(output); scheduler.setTickMs(10);
  const send = spec => scheduler.sendNote({ ...(track ? { trackId: 'lead', voiceBudget: limit } : {}), ...spec });
  return { scheduler, output, calls, send, notes: () => calls.filter(call => call.type === 'noteOn' || call.type === 'noteOff') };
};

describe('ordinary and local future voice reservations', () => {
  for (const independent of [false, true]) for (const track of [false, true]) {
    const name = `${independent ? 'independent local' : 'ordinary MIDI'} ${track ? 'track' : 'global'} budget`;
    it(`keeps the sounding owner until the replacement frontier for ${name}`, () => withFakeClockAndPerformance(clock => {
      const f = fixture({ independent, track });
      f.send({ note: 60 }); expect(f.send({ note: 64, timeMs: 1000, durationTicks: 20 })).to.equal(true);
      expect(f.notes().map(call => [call.type, call.note])).to.deep.equal([['noteOn', 60]]);
      clock.tick(999); expect(f.notes()).to.have.length(1);
      clock.tick(1);
      expect(f.notes().map(call => [call.type, call.note, call.at])).to.deep.equal([['noteOn', 60, 0], ['noteOff', 60, 1000], ['noteOn', 64, 1000]]);
      clock.tick(200); expect(f.scheduler._activeNotes.size).to.equal(0);
      expect(f.scheduler._pendingNoteOns.size).to.equal(0); f.scheduler.dispose();
    }));

    it(`cancels only a queued replacement for ${name}`, () => withFakeClockAndPerformance(clock => {
      const f = fixture({ independent, track });
      f.send({ note: 60 }); f.send({ note: 64, timeMs: 1000, phraseVoiceKey: 'later' });
      clock.tick(500); expect(f.scheduler.cancelGamePhrase('later')).to.equal(true); clock.tick(1000);
      expect(f.notes().map(call => [call.type, call.note])).to.deep.equal([['noteOn', 60]]);
      expect(f.scheduler._activeNotes.size).to.equal(1); f.scheduler.dispose();
    }));

    it(`retains the sounding owner when replacement setup is refused for ${name}`, () => withFakeClockAndPerformance(clock => {
      const f = fixture({ independent, track });
      f.send({ note: 60 }); f.send({ note: 64, timeMs: 1000, timbre: 99 });
      f.output.channels[1].sendControlChange = () => false; clock.tick(1000);
      expect(f.notes().map(call => [call.type, call.note])).to.deep.equal([['noteOn', 60]]);
      expect(f.scheduler._activeNotes.size).to.equal(1); f.scheduler.dispose();
    }));
  }

  for (const independent of [false, true]) {
    it(`retains queued ownership when an immediate replacement submission is refused (${independent})`, () => withFakeClockAndPerformance(clock => {
      const f = fixture({ independent }); f.send({ note: 60, timeMs: 1000 });
      const submit = f.output.channels[1].sendNoteOn;
      f.output.channels[1].sendNoteOn = () => false;
      expect(f.send({ note: 64 })).to.equal(false);
      expect(f.scheduler._pendingNoteOns.size).to.equal(1);
      f.output.channels[1].sendNoteOn = submit; clock.tick(1000);
      expect(f.notes().filter(call => call.type === 'noteOn').map(call => call.note)).to.deep.equal([60]);
      f.scheduler.dispose();
    }));

    it(`orders a same-time chord deterministically at its onset (${independent})`, () => withFakeClockAndPerformance(clock => {
      const f = fixture({ independent, limit: 2 });
      f.send({ note: 60 }); f.send({ note: 64, timeMs: 1000 }); f.send({ note: 67, timeMs: 1000 });
      expect(f.notes()).to.have.length(1); clock.tick(1000);
      expect(f.notes().map(call => [call.type, call.note])).to.deep.equal([['noteOn', 60], ['noteOn', 64], ['noteOff', 60], ['noteOn', 67]]);
      expect(f.scheduler._countSoundingNotes()).to.equal(2); f.scheduler.dispose();
    }));

    it(`admits multiple future notes and retires same-pitch gates without stale offs (${independent})`, () => withFakeClockAndPerformance(clock => {
      const f = fixture({ independent });
      f.send({ note: 60, durationTicks: 150 });
      expect(f.send({ note: 60, timeMs: 1000, durationTicks: 100 })).to.equal(true);
      expect(f.send({ note: 67, timeMs: 2500, durationTicks: 10 })).to.equal(true);
      clock.tick(1000); const count = f.notes().length; clock.tick(500);
      expect(f.notes()).to.have.length(count); clock.tick(1100);
      expect(f.notes().map(call => [call.type, call.note])).to.deep.equal([['noteOn', 60], ['noteOff', 60], ['noteOn', 60], ['noteOff', 60], ['noteOn', 67], ['noteOff', 67]]);
      expect(f.scheduler._activeNotes.size).to.equal(0); f.scheduler.dispose();
    }));

    it(`keeps nonoverlapping future reservations after an immediate onset (${independent})`, () => withFakeClockAndPerformance(clock => {
      const f = fixture({ independent });
      f.send({ note: 60, timeMs: 1000, durationTicks: 10 }); f.send({ note: 64, durationTicks: 10 });
      clock.tick(1100);
      expect(f.notes().filter(call => call.type === 'noteOn').map(call => call.note)).to.deep.equal([64, 60]);
      expect(f.scheduler._activeNotes.size).to.equal(0); f.scheduler.dispose();
    }));

    it(`does not revive future notes after route retirement (${independent})`, () => withFakeClockAndPerformance(clock => {
      const f = fixture({ independent }); f.send({ note: 60, timeMs: 1000 });
      f.scheduler.setOutput(makeOutput([1], [])); f.send({ note: 64 }); clock.tick(1500);
      expect(f.notes()).to.deep.equal([]); expect(f.scheduler._pendingNoteOns.size).to.equal(0); f.scheduler.dispose();
    }));
  }

  it('keeps output ownership separate while applying a shared track budget at dispatch', () => withFakeClockAndPerformance(clock => {
    const a = [], b = [], outputA = makeOutput([1], a, 'a'), outputB = makeOutput([1], b, 'b');
    const scheduler = new MidiScheduler({ mpe: { enabled: false }, limits: { maxActiveNotes: 8 } });
    scheduler.setOutput(outputA); scheduler.setOutputs([outputA, outputB]);
    scheduler.sendNote({ note: 60, outputId: 'a', trackId: 'lead', voiceBudget: 1 });
    scheduler.sendNote({ note: 65, outputId: 'b', trackId: 'bass', voiceBudget: 1 });
    scheduler.sendNote({ note: 67, outputId: 'b', trackId: 'lead', voiceBudget: 1, timeMs: 1000 });
    expect(a.filter(call => call.type === 'noteOff')).to.have.length(0);
    expect(b.filter(call => call.type === 'noteOff')).to.have.length(0); clock.tick(1000);
    expect(a.filter(call => call.type === 'noteOff').map(call => call.note)).to.deep.equal([60]);
    expect(b.filter(call => call.type === 'noteOff')).to.have.length(0);
    expect(scheduler._countSoundingNotes('lead')).to.equal(1); expect(scheduler._countSoundingNotes('bass')).to.equal(1);
    scheduler.dispose();
  }));

  it('preserves a local sounding owner when physical capacity disappears before dispatch', () => withFakeClockAndPerformance(clock => {
    const f = fixture({ independent: true }); f.send({ note: 60 }); f.send({ note: 64, timeMs: 1000 });
    f.output.canAllocateVoice = () => false; clock.tick(1000);
    expect(f.notes().map(call => [call.type, call.note])).to.deep.equal([['noteOn', 60]]);
    expect(f.scheduler._pendingNoteOns.size).to.equal(0); f.scheduler.dispose();
  }));

  it('bounds pending reservations independently of the one sounding voice slot', () => withFakeClockAndPerformance(() => {
    const f = fixture(); f.send({ note: 60 });
    for (let index = 0; index < 32; index++) expect(f.send({ note: 64, timeMs: 2000 + index * 2000 })).to.equal(true);
    expect(f.send({ note: 67, timeMs: 100000 })).to.equal(false);
    expect(f.scheduler._pendingNoteOns.size).to.equal(32); expect(f.notes()).to.have.length(1); f.scheduler.dispose();
  }));
});
