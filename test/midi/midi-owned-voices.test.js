import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const setup = (extra = {}, { mpe = true } = {}) => {
  const calls = [], output = makeOutput([1, 2, 3], calls, 'physical');
  for (const [id, channel] of Object.entries(output.channels)) channel.sendChannelAftertouch = (value, options) => calls.push({ type: 'pressure', id: Number(id), value, options });
  const scheduler = new MidiScheduler({ mpe: { enabled: mpe, masterChannel: 1, memberChannels: [2, 3] }, ...extra });
  scheduler.setOutput(output); calls.length = 0; return { scheduler, output, calls };
};
describe('opaque scheduler-owned physical MIDI voices', () => {
  it('keeps equal-pitch MPE voices independently addressable and releases only the owned member', () => withFakeClockAndPerformance(() => {
    const f = setup();
    try {
      const first = f.scheduler.beginOwnedVoice({ note: 60 }), second = f.scheduler.beginOwnedVoice({ note: 60 });
      expect(first).to.include({ status: 'accepted', stage: 'submitted', channel: 2 }); expect(second.channel).to.equal(3);
      expect(first.handle).not.to.equal(second.handle); expect(f.scheduler.endOwnedVoice(first.handle).status).to.equal('accepted');
      expect(f.calls.filter(call => call.type === 'noteOff').map(call => call.id)).to.deep.equal([2]);
      expect(f.scheduler.inspectOwnedVoice(second.handle).status).to.equal('submitted');
    } finally { f.scheduler.dispose(); }
  }));
  it('orders a future onset before owned expression and the exact later terminal frontier', () => withFakeClockAndPerformance(clock => {
    const f = setup(), terminals = [], submissions = [], expressions = [];
    try {
      const voice = f.scheduler.beginOwnedVoice({ note: 60, timeMs: 100 }, {}, { onTerminal: result => terminals.push(result), onSubmitted: result => submissions.push(result) });
      expect(voice.stage).to.equal('scheduled');
      expect(f.scheduler.updateOwnedVoice(voice.handle, { bend: 0.5, pressure: 96 }, { timeMs: 100, onResult: result => expressions.push(result) }).stage).to.equal('scheduled');
      expect(f.scheduler.endOwnedVoice(voice.handle, { timeMs: 150, reason: 'physical-contact-ended' }).stage).to.equal('scheduled');
      clock.tick(99); expect(f.calls).to.have.length(0);
      clock.tick(1); const onset = f.calls.findIndex(call => call.type === 'noteOn'), update = f.calls.findIndex(call => call.type === 'pitchBend' && call.value === 0.5);
      expect(onset).to.be.at.least(0); expect(update).to.be.greaterThan(onset); expect(expressions[0].stage).to.equal('submitted');
      expect(submissions[0]).to.include({ channel: 2, intendedMs: 100, submittedAtMs: 100 });
      clock.tick(49); expect(terminals).to.have.length(0); clock.tick(1);
      expect(terminals).to.have.length(1); expect(terminals[0]).to.include({ state: 'release-submitted', reason: 'physical-contact-ended' });
      expect(f.scheduler.inspectOwnedVoice(voice.handle).status).to.equal('retired');
    } finally { f.scheduler.dispose(); }
    expect(clock.countTimers()).to.equal(0);
  }));
  it('refuses an ordinary same-pitch collision without stealing the existing or future owner', () => withFakeClockAndPerformance(() => {
    const f = setup({}, { mpe: false });
    try {
      const first = f.scheduler.beginOwnedVoice({ note: 60, timeMs: 100 });
      expect(f.scheduler.beginOwnedVoice({ note: 60 }).reason).to.equal('same-pitch-owner-busy'); expect(f.calls).to.have.length(0);
      f.scheduler.endOwnedVoice(first.handle); expect(f.scheduler.beginOwnedVoice({ note: 60 }).status).to.equal('accepted');
    } finally { f.scheduler.dispose(); }
  }));
  it('bounds future expressions and retires their timers/reservations with their exact voice', () => withFakeClockAndPerformance(clock => {
    const f = setup(), results = [];
    try {
      const voice = f.scheduler.beginOwnedVoice({ note: 60 });
      for (let i = 0; i < 16; i++) expect(f.scheduler.updateOwnedVoice(voice.handle, { bend: i / 32 }, { timeMs: 100 + i, onResult: result => results.push(result) }).status).to.equal('accepted');
      expect(f.scheduler.updateOwnedVoice(voice.handle, { bend: 0.8 }, { timeMs: 200 }).reason).to.equal('owned-expression-capacity');
      expect(f.scheduler.inspectOwnedVoice(voice.handle).pendingUpdates).to.equal(16);
      f.scheduler.endOwnedVoice(voice.handle); expect(results).to.have.length(16); expect(results.every(result => result.reason === 'voice-retired')).to.equal(true);
      clock.tick(1000); expect(f.calls.filter(call => call.type === 'pitchBend' && call.value > 0)).to.have.length(0);
    } finally { f.scheduler.dispose(); }
    expect(clock.countTimers()).to.equal(0);
  }));
  it('shares transport rate reservations for future pressure and controllers', () => withFakeClockAndPerformance(clock => {
    const f = setup({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] }, limits: { maxEventsPerSecond: 20 } });
    try {
      clock.tick(2000); const voice = f.scheduler.beginOwnedVoice({ note: 60 }); expect(voice.status).to.equal('accepted');
      const outcomes = Array.from({ length: 8 }, () => f.scheduler.updateOwnedVoice(voice.handle, { bend: 0.2, pan: 64, pressure: 90, timbre: 80 }, { timeMs: 2100 }));
      expect(outcomes.some(result => result.status === 'rejected')).to.equal(true); expect(outcomes.filter(result => result.status === 'accepted').length).to.be.below(8);
      expect(f.calls.filter(call => call.type === 'pressure')).to.have.length(0);
    } finally { f.scheduler.dispose(); }
  }));
  it('retires old route ownership without sending queued expression into its replacement', () => withFakeClockAndPerformance(clock => {
    const f = setup(), replacementCalls = [], terminals = [];
    try {
      const voice = f.scheduler.beginOwnedVoice({ note: 60 }, {}, { onTerminal: result => terminals.push(result) });
      f.scheduler.updateOwnedVoice(voice.handle, { bend: 0.5 }, { timeMs: 100 });
      f.scheduler.setOutput(makeOutput([1, 2, 3], replacementCalls, 'replacement')); clock.tick(500);
      expect(terminals).to.have.length(1); expect(terminals[0].reason).to.equal('output-retired');
      expect(replacementCalls.some(call => call.type === 'noteOn' || call.type === 'pitchBend' && call.value === 0.5)).to.equal(false);
      expect(f.scheduler.inspectOwnedVoice(voice.handle).status).to.equal('retired');
    } finally { f.scheduler.dispose(); }
  }));
  it('does not let forged or foreign handles release another scheduler owner', () => withFakeClockAndPerformance(() => {
    const first = setup(), second = setup();
    try {
      const voice = first.scheduler.beginOwnedVoice({ note: 60 });
      expect(second.scheduler.endOwnedVoice(voice.handle).reason).to.equal('foreign-voice-handle');
      expect(first.scheduler.endOwnedVoice({ ...voice.handle }).reason).to.equal('foreign-voice-handle');
      expect(first.scheduler.inspectOwnedVoice(voice.handle).status).to.equal('submitted');
    } finally { first.scheduler.dispose(); second.scheduler.dispose(); }
  }));
  it('preserves an uncertain terminal and never reports a second release as complete', () => withFakeClockAndPerformance(() => {
    const f = setup(), terminals = [];
    try {
      const voice = f.scheduler.beginOwnedVoice({ note: 60 }, {}, { onTerminal: result => terminals.push(result) });
      f.output.channels[2].sendNoteOff = () => false;
      expect(f.scheduler.endOwnedVoice(voice.handle)).to.include({ status: 'rejected', reason: 'release-unconfirmed' });
      expect(f.scheduler.endOwnedVoice(voice.handle).status).to.equal('rejected'); expect(terminals).to.have.length(1); expect(terminals[0].state).to.equal('uncertain');
      expect(f.scheduler.beginOwnedVoice({ note: 64 }).reason).to.equal('owned-output-retirement-unknown');
      expect(f.scheduler.sendNote({ note: 67, durationTicks: 1 })).to.equal(false);
      expect(f.scheduler.getOutputRouteState('physical').ownedVoiceAdmissionReady).to.equal(false);
    } finally { f.scheduler.dispose(); }
  }));
  it('does not reset bend or submit a replacement when a stolen owned member refuses release', () => withFakeClockAndPerformance(() => {
    const f = setup({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2], voicePolicy: 'steal-oldest' } });
    try {
      const first = f.scheduler.beginOwnedVoice({ note: 60 }); expect(first.status).to.equal('accepted'); f.calls.length = 0;
      f.output.channels[2].sendNoteOff = () => false;
      const next = f.scheduler.beginOwnedVoice({ note: 64 });
      expect(next.status).to.equal('rejected'); expect(f.calls.some(call => call.type === 'noteOn' || call.type === 'pitchBend')).to.equal(false);
      expect(f.scheduler.inspectOwnedVoice(first.handle).terminal.state).to.equal('uncertain');
    } finally { f.scheduler.dispose(); }
  }));
  it('cancels a future onset when its physical end precedes it and rejects invalid timing or expression', () => withFakeClockAndPerformance(clock => {
    const f = setup();
    try {
      expect(f.scheduler.beginOwnedVoice({ note: 60.5 }).status).to.equal('rejected');
      expect(f.scheduler.beginOwnedVoice({ note: 60, timeMs: 5001 }).status).to.equal('rejected');
      const voice = f.scheduler.beginOwnedVoice({ note: 60, timeMs: 100 });
      expect(f.scheduler.updateOwnedVoice(voice.handle, { bend: NaN }).status).to.equal('rejected');
      expect(f.scheduler.updateOwnedVoice(voice.handle, { volume: 100 }).status).to.equal('rejected');
      expect(f.scheduler.endOwnedVoice(voice.handle, { timeMs: 50 }).stage).to.equal('cancelled'); clock.tick(200);
      expect(f.calls.some(call => call.type === 'noteOn')).to.equal(false);
    } finally { f.scheduler.dispose(); }
  }));
  it('stops expression after a reentrant terminal and cannot resurrect a retired gate', () => withFakeClockAndPerformance(() => {
    const f = setup();
    try {
      const voice = f.scheduler.beginOwnedVoice({ note: 60 }), bend = f.output.channels[2].sendPitchBend;
      f.output.channels[2].sendPitchBend = (value, options) => { bend(value, options); if (value === 0.5) f.scheduler.endOwnedVoice(voice.handle); };
      const outcome = f.scheduler.updateOwnedVoice(voice.handle, { bend: 0.5, pressure: 100 });
      expect(outcome.status).to.equal('rejected'); expect(f.calls.filter(call => call.type === 'pressure')).to.have.length(0);
      expect(f.scheduler.inspectOwnedVoice(voice.handle).status).to.equal('retired');
    } finally { f.scheduler.dispose(); }
  }));
});
