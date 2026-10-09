import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { MidiGamePhraseQueue } from '../../js/midi/scheduler/MidiGamePhraseQueue.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const config = { mpe: { enabled: false } };
const onNotes = calls => calls.filter(call => call.type === 'noteOn').map(call => call.note);

describe('MIDI lifecycle callback ownership', function() {
  it('retires held and pending notes on the original default destination while retaining sent history', function() {
    withFakeClockAndPerformance(clock => {
      const oldCalls = [], nextCalls = [], scheduler = new MidiScheduler(config);
      const old = makeOutput([1], oldCalls, 'old'), next = makeOutput([1], nextCalls, 'next');
      try {
        scheduler.setOutput(old);
        scheduler.sendNote({ note: 60, durationTicks: 0 });
        scheduler.sendNote({ note: 62, durationTicks: 4, timeMs: 100 });
        const sent = scheduler._rateSent.slice();
        scheduler.setOutput(next);
        expect(oldCalls.filter(call => call.type === 'noteOff').map(call => call.note)).to.deep.equal([60]);
        expect(scheduler._activeNotes.size).to.equal(0);
        expect(scheduler._pendingNoteOns.size).to.equal(0);
        expect(scheduler._rateSent.slice(0, sent.length)).to.deep.equal(sent);
        clock.tick(500);
        expect(onNotes(oldCalls)).to.deep.equal([60]);
        expect(nextCalls).to.deep.equal([]);
        expect(scheduler.sendNote({ note: 67, durationTicks: 1 })).to.equal(true);
        expect(onNotes(nextCalls)).to.deep.equal([67]);
      } finally { scheduler.dispose(); }
    });
  });

  it('retires a replaced registered destination without releasing a retained output gate', function() {
    withFakeClockAndPerformance(clock => {
      const retainedCalls = [], oldCalls = [], nextCalls = [], scheduler = new MidiScheduler(config);
      const retained = makeOutput([1], retainedCalls, 'default'), old = makeOutput([1], oldCalls, 'track'), next = makeOutput([1], nextCalls, 'track');
      try {
        scheduler.setOutput(retained); scheduler.setOutputs([retained, old]);
        scheduler.sendNote({ note: 60, durationTicks: 0, outputId: 'track' });
        scheduler.sendNote({ note: 64, durationTicks: 8 });
        scheduler.setOutputs([retained, next]);
        expect(oldCalls.filter(call => call.type === 'noteOff').map(call => call.note)).to.deep.equal([60]);
        expect(retainedCalls.filter(call => call.type === 'noteOff')).to.have.length(0);
        expect(scheduler._activeNotes.size).to.equal(1);
        expect(nextCalls).to.deep.equal([]);
        clock.tick(500);
        expect(retainedCalls.filter(call => call.type === 'noteOff').map(call => call.note)).to.deep.equal([64]);
      } finally { scheduler.dispose(); }
    });
  });

  it('cancels only one phrase tail and its tokens beside an unrelated held pitch on the same channel', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler(config);
      try {
        scheduler.setOutput(makeOutput([1], calls));
        scheduler.sendNote({ note: 60, durationTicks: 0, phraseVoiceKey: 'cue' });
        scheduler.sendNote({ note: 64, durationTicks: 0, phraseVoiceKey: 'unrelated' });
        scheduler.sendNote({ note: 62, durationTicks: 1, timeMs: 100, phraseVoiceKey: 'cue' });
        scheduler.gamePhrases.replace('cue', [65, 67], { durationTicks: 1 }, {}, 0, 2);
        expect(scheduler.cancelGamePhrase('cue')).to.equal(true);
        expect(calls.filter(call => call.type === 'noteOff').map(call => call.note)).to.deep.equal([60]);
        expect(calls.filter(call => call.type === 'cc' || call.type === 'allNotesOff')).to.have.length(0);
        expect([...scheduler._activeNotes.values()].map(voice => voice.note)).to.deep.equal([64]);
        clock.tick(500); scheduler.gamePhrases.advance(1, spec => scheduler.sendNote(spec));
        expect(onNotes(calls)).to.deep.equal([60, 64]);
        scheduler.allNotesOff();
        expect(calls.some(call => call.type === 'cc' && call.cc === 120)).to.equal(true);
        expect(scheduler._activeNotes.size).to.equal(0);
      } finally { scheduler.dispose(); }
    });
  });

  it('does not emit a note after a controller callback invokes Panic', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], output = makeOutput([1], calls), scheduler = new MidiScheduler(config);
      output.channels[1].sendProgramChange = () => scheduler.allNotesOff();
      try {
        scheduler.setOutput(output);
        expect(scheduler.sendNote({ note: 60, program: 5, durationTicks: 0 })).to.equal(false);
        expect(onNotes(calls)).to.deep.equal([]);
        expect(scheduler._activeNotes.size).to.equal(0);
      } finally { scheduler.dispose(); }
    });
  });

  it('rejects attacks raised by cleanup callbacks and does not recursively release the same token', function() {
    withFakeClockAndPerformance(() => {
      const calls = [], output = makeOutput([1], calls), scheduler = new MidiScheduler(config), attempts = [];
      try {
        scheduler.setOutput(output); scheduler.sendNote({ note: 60, durationTicks: 0 });
        let callback = false;
        output.channels[1].sendNoteOff = note => {
          calls.push({ type: 'noteOff', note });
          if (callback) return;
          callback = true; scheduler._stopActiveNoteToken(1);
          attempts.push(scheduler.sendNote({ note: 64, durationTicks: 0 }));
        };
        scheduler._stopActiveNoteToken(1);
        expect(calls.filter(call => call.type === 'noteOff').map(call => call.note)).to.deep.equal([60]);
        expect(attempts).to.deep.equal([false]);
        expect(onNotes(calls)).to.deep.equal([60]);
        expect(scheduler._activeNotes.size).to.equal(0);
        output.channels[1].sendControlChange = () => attempts.push(scheduler.sendNote({ note: 67, durationTicks: 0 }));
        scheduler.allNotesOff();
        expect(attempts.every(value => value === false)).to.equal(true);
        scheduler.dispose();
        expect(scheduler.sendNote({ note: 72, durationTicks: 0 })).to.equal(false);
      } finally { scheduler.dispose(); }
    });
  });

  it('stops a same-tick polyphonic tail and completion callback when its first admission clears the queue', function() {
    const queue = new MidiGamePhraseQueue(), sent = [];
    let completed = 0;
    queue.replaceSteps('cue', [{ voices: [{ note: 60, offsetTicks: 0 }, { note: 64, offsetTicks: 0 }] }], {}, 0, 1, () => completed++);
    queue.advance(0, spec => { sent.push(spec.note); queue.clear(); });
    expect(sent).to.deep.equal([60]);
    expect(completed).to.equal(0);
    expect(queue.voices.size).to.equal(0);
  });

  it('keeps same-key replacement raised by a send callback for a later dispatch phase', function() {
    const queue = new MidiGamePhraseQueue(), sent = [];
    queue.replace('cue', [60], {}, {}, 0, 1);
    queue.advance(0, spec => {
      sent.push(spec.note);
      queue.replace('cue', [64], {}, {}, 0, 1);
      queue.advance(0, next => sent.push(next.note));
    });
    expect(sent).to.deep.equal([60]);
    expect(queue.voices.size).to.equal(1);
    queue.advance(1, spec => sent.push(spec.note));
    expect(sent).to.deep.equal([60, 64]);
  });
  it('keeps a sounded tail when requested while cancelling its unsounded owned onset', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler(config);
      try {
        scheduler.setOutput(makeOutput([1], calls));
        scheduler.sendNote({ note: 60, durationTicks: 4, phraseVoiceKey: 'tail' });
        scheduler.sendNote({ note: 64, durationTicks: 4, timeMs: 100, phraseVoiceKey: 'tail' });
        scheduler.gamePhrases.replace('tail', [67], { durationTicks: 1 }, {}, 0, 2);
        expect(scheduler.cancelGamePhrase('tail', { releaseActive: false })).to.equal(true);
        expect(calls.filter(call => call.type === 'noteOff')).to.have.length(0);
        expect([...scheduler._activeNotes.values()].map(voice => voice.note)).to.deep.equal([60]);
        clock.tick(300);
        expect(onNotes(calls)).to.deep.equal([60]);
        expect(calls.filter(call => call.type === 'noteOff').map(call => call.note)).to.deep.equal([60]);
        expect(scheduler.cancelGamePhrase('tail')).to.equal(false);
      } finally { scheduler.dispose(); }
    });
  });

  it('exposes only global queue-clear lifecycle changes while pause and scoped cancellation retain epoch', function() {
    withFakeClockAndPerformance(() => {
      const scheduler = new MidiScheduler(config);
      try {
        scheduler.setOutput(makeOutput([1], []));
        const queue = scheduler.gamePhrases, epoch = queue.epoch;
        queue.replace('cue', [60, 64], {}, {}, 0, 2);
        expect(queue.epoch).to.equal(epoch);
        scheduler.allNotesOff({ preserveGamePhrases: true, preserveRateHistory: true });
        expect(queue.epoch).to.equal(epoch); expect(queue.voices.size).to.equal(1);
        scheduler.cancelGamePhrase('cue'); expect(queue.epoch).to.equal(epoch);
        queue.replace('cue', [60], {}, {}, 0, 1);
        scheduler.allNotesOff(); expect(queue.epoch).to.equal(epoch + 1);
        expect(queue.voices.size).to.equal(0);
      } finally { scheduler.dispose(); }
    });
  });

});
