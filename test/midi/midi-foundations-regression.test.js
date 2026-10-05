import { expect } from 'chai';
import { MidiMapping } from '../../js/midi/MidiMapping.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { createMidiUiController } from '../../js/app/midiUiController.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const mappingConfig = {
  enabled: true,
  mpe: { enabled: false },
  position: { mappings: [], viewPan: false, panRange: { min: -127, max: 127 } },
  sfx: { '1': { note: 60, pan: -80, timbre: 100, pitchBend: 0.5 } }
};

const makeScheduledOutput = (id, clock, clearMode = 'supported') => {
  const active = new Set();
  const queue = [];
  const calls = [];
  const output = { id, channels: {} };
  const schedule = (type, note, opts = {}) => {
    calls.push({ type, note, time: opts.time ?? clock.now });
    queue.push({ type, note, time: opts.time ?? clock.now });
  };
  for (let number = 1; number <= 16; number += 1) {
    output.channels[number] = {
      sendNoteOn: (note, opts) => schedule('on', `${number}:${note}`, opts),
      sendNoteOff: (note, opts) => schedule('off', `${number}:${note}`, opts),
      sendAllNotesOff: () => schedule('panic', `${number}:`),
      sendPitchBend() {},
      sendControlChange() {}
    };
  }
  if (clearMode !== 'absent') {
    output.clear = () => {
      calls.push({ type: 'clear' });
      if (clearMode === 'throw') throw new Error('Clear unavailable');
      if (clearMode === 'supported') queue.length = 0;
    };
  }
  if (clearMode === 'silent-wrapper') output._midiOutput = {};
  const flush = () => {
    queue.sort((a, b) => a.time - b.time);
    for (const event of queue.splice(0)) {
      if (event.time > clock.now) {
        queue.push(event);
      } else if (event.type === 'on') {
        active.add(event.note);
      } else if (event.type === 'off') {
        active.delete(event.note);
      } else {
        for (const note of active) if (note.startsWith(event.note)) active.delete(note);
      }
    }
  };
  return { output, active, calls, flush };
};

describe('MIDI foundations regressions', function() {
  it('preserves direct expression and sends it on an ordinary track channel', function() {
    const mapped = new MidiMapping(mappingConfig).mapEvent({ sfxId: 1 });
    expect(mapped).to.include({ pan: -80, timbre: 100, pitchBend: 0.5 });
    const calls = [];
    const scheduler = new MidiScheduler(mappingConfig);
    scheduler.setOutput(makeOutput([4], calls));
    scheduler.sendNote({ ...mapped, channel: 4, durationTicks: 0 });
    expect(calls.find(call => call.type === 'pitchBend')).to.include({ id: 4, value: 0.5 });
    expect(calls.find(call => call.type === 'cc' && call.cc === 74)).to.include({ id: 4, value: 100 });
    expect(calls.find(call => call.type === 'cc' && call.cc === 10)).to.include({ id: 4, value: 24 });
    expect(scheduler.estimateMessages({ ...mapped, durationTicks: 0 }).messages).to.equal(calls.length);
    scheduler.dispose();
  });

  it('keeps explicit zero expression ahead of positional modulation', function() {
    const mapping = new MidiMapping({
      ...mappingConfig,
      position: {
        viewPan: true,
        mappings: ['pan', 'timbre', 'pitchBend'].map(target => ({ axis: 'x', target, min: 1, max: 1 }))
      },
      sfx: { '1': { note: 60, pan: 0, timbre: 0, pitchBend: 0 } }
    });
    expect(mapping.mapEvent({ sfxId: 1, x: 100 }, { levelWidth: 100 })).to.include({ pan: 0, timbre: 0, pitchBend: 0 });
  });

  it('clamps direct expression and retains frequency-derived pitch precedence', function() {
    const mapping = new MidiMapping({
      ...mappingConfig,
      sfx: { '1': { note: 60, pan: -999, timbre: 999, pitchBend: 999, frequencyHz: 440 } }
    });
    expect(mapping.mapEvent({ sfxId: 1 })).to.include({ pan: -127, timbre: 127, pitchBend: 0 });
  });

  it('uses one scheduler-clock timestamp for a chord audition', function() {
    const sent = [];
    const view = {
      getMidiBaseConfig: () => ({ sfx: { '1': { notes: [60, 64], durationTicks: 4 } } }),
      midiRouter: { scheduler: { _nowMs: () => 123, sendNote: spec => { sent.push(spec); return true; } } }
    };
    const ui = createMidiUiController({ window: null, document: null, getLemmings: () => view });
    expect(ui.audition({ sourceId: 'sfx-1' })).to.equal(true);
    expect(sent.map(spec => spec.timeMs)).to.deep.equal([123, 123]);
    ui.dispose();
  });

  it('uses navigation-relative time when an audition scheduler has no clock hook', function() {
    withFakeClockAndPerformance(() => {
      const sent = [];
      const view = {
        getMidiBaseConfig: () => ({ sfx: { '1': { note: 60 } } }),
        midiRouter: { scheduler: { sendNote: spec => { sent.push(spec); return true; } } }
      };
      const ui = createMidiUiController({ window: null, document: null, getLemmings: () => view });
      ui.audition({ sourceId: 'sfx-1' });
      expect(sent[0].timeMs).to.equal(87);
      ui.dispose();
    }, { now: 1700000000000, performanceValue: { now: () => 87 } });
  });

  it('panics every used channel on every output, including a replaced default output', function() {
    const firstCalls = [];
    const secondCalls = [];
    const first = makeOutput([1, 4], firstCalls, 'first');
    const second = makeOutput([1, 9], secondCalls, 'second');
    const scheduler = new MidiScheduler({ mpe: { enabled: false } });
    scheduler.setOutput(first);
    scheduler.sendNote({ note: 60, channel: 4, durationTicks: 0 });
    scheduler.setOutput(second);
    scheduler.setOutputs([second]);
    scheduler.sendNote({ note: 62, channel: 9, durationTicks: 0 });
    scheduler.allNotesOff();
    expect(firstCalls.filter(call => call.type === 'allNotesOff').map(call => call.id)).to.deep.equal([1, 4]);
    expect(secondCalls.filter(call => call.type === 'allNotesOff').map(call => call.id)).to.deep.equal([1, 9]);
    expect(scheduler._activeNotes.size).to.equal(0);
    expect(scheduler._usedOutputChannels.size).to.equal(0);
  });

  for (const clearMode of ['supported', 'absent', 'silent-wrapper', 'throw']) {
    it(`prevents a queued held note becoming stuck after Panic (${clearMode})`, function() {
      withFakeClockAndPerformance(clock => {
        const fixture = makeScheduledOutput('out', clock, clearMode);
        const scheduler = new MidiScheduler({ mpe: { enabled: false }, limits: { maxActiveNotes: 1 } });
        scheduler.setOutput(fixture.output);
        scheduler.sendNote({ note: 60, channel: 4, durationTicks: 0, timeMs: 1000 });
        scheduler.sendNote({ note: 64, channel: 4, durationTicks: 0, timeMs: 1100 });
        scheduler.allNotesOff();
        fixture.flush();
        clock.tick(1200);
        fixture.flush();
        expect([...fixture.active]).to.deep.equal([]);
        expect(scheduler._pendingNoteOns.size).to.equal(0);
        if (clearMode === 'supported') {
          expect(fixture.calls.some(call => call.type === 'clear')).to.equal(true);
          expect(fixture.calls.filter(call => call.type === 'off' && call.time > 0)).to.deep.equal([]);
        } else {
          expect(fixture.calls.filter(call => call.type === 'off' && call.time > 0).map(call => call.time)).to.deep.equal([1001, 1101]);
        }
      });
    });
  }

  it('clearQueue and disposal stop ordinary held notes', function() {
    for (const method of ['clearQueue', 'dispose']) {
      const calls = [];
      const scheduler = new MidiScheduler({ mpe: { enabled: false } });
      scheduler.setOutput(makeOutput([1, 4], calls));
      scheduler.sendNote({ note: 60, channel: 4, durationTicks: 0 });
      scheduler[method]();
      expect(calls.some(call => call.type === 'allNotesOff' && call.id === 4)).to.equal(true);
      expect(scheduler._activeNotes.size).to.equal(0);
    }
  });
});
