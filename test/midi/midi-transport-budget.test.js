import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { midiTransportBudget } from '../../js/midi/scheduler/MidiTransportBudget.js';
import { createProcgenMidiPorts } from '../../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const config = limits => ({ mpe: { enabled: false }, limits: { maxEventsPerSecond: 100000,
  maxBytesPerSecond: 300000, ...limits } });
const plan = (count = 1, timeMs = 0) => ({ on: { timeMs, count, bytes: count * 3 } });
const output = (id, budgetProfile) => ({ id, state: 'connected', budgetProfile });
const reserve = (scheduler, id, count = 1, timeMs = 0) => scheduler.reserve(plan(count, timeMs), { outputId: id }, 0);

describe('MIDI endpoint and declared shared-link capacity', function() {
  it('uses explicit transport declarations and never infers wire capacity from names', function() {
    expect(midiTransportBudget({ id: 'usb', name: 'USB MIDI 2 10Gbps' })).to.include({ transport: 'unknown-webmidi', protocol: 'midi1',
      confidence: 'conservative-default', maxBytesPerSecond: 3125 });
    expect(midiTransportBudget(output('din', { transport: 'din', maxBytesPerSecond: 99999 }))).to.include({ maxBytesPerSecond: 3125 });
    expect(midiTransportBudget(output('usb', { transport: 'usb', maxBytesPerSecond: 12000 }))).to.include({ maxBytesPerSecond: 12000,
      confidence: 'user-configured' });
    const local = midiTransportBudget({ id: 'local', supportsIndependentNoteGates: true }, { maxEventsPerSecond: 1, maxBytesPerSecond: 1 });
    expect(local.maxMessagesPerSecond).to.equal(Number.MAX_SAFE_INTEGER); expect(local.transport).to.equal('local-audio');
  });

  it('keeps two ordinary endpoints independent and enforces a declared shared link across both', function() {
    const independent = new MidiScheduler(config({ maxEventsPerSecond: 4 }));
    independent.setOutputs([output('a'), output('b')]);
    expect(reserve(independent, 'a', 4).ok).to.equal(true); expect(reserve(independent, 'b', 4).ok).to.equal(true);
    expect(reserve(independent, 'a').reason).to.equal('count-limit'); independent.dispose();
    const shared = new MidiScheduler(config({ linkProfiles: { cable: { maxMessagesPerSecond: 4 } } }));
    shared.setOutputs([output('a', { linkId: 'cable' }), output('b', { linkId: 'cable' }), output('c')]);
    expect(reserve(shared, 'a', 3).ok).to.equal(true); expect(reserve(shared, 'b').ok).to.equal(true);
    const refused = reserve(shared, 'b'); expect(refused.ok).to.equal(false); expect(refused.reason).to.equal('count-limit');
    expect(refused.softOk).to.equal(false); expect(refused.sharedLink.combined.count).to.equal(5);
    expect(reserve(shared, 'c', 4).ok).to.equal(true);
    const state = shared.getRateSnapshot(0, false, 'b'); expect(state.next.count).to.equal(1); expect(state.sharedLink.next.count).to.equal(4);
    shared.dispose();
  });

  it('applies the endpoint cap to its own traffic and the link cap to the combined traffic', function() {
    const scheduler = new MidiScheduler(config({ linkProfiles: { cable: { maxMessagesPerSecond: 10, maxBytesPerSecond: 30 } } }));
    scheduler.setOutputs([output('a', { linkId: 'cable' }), output('b', { linkId: 'cable', maxMessagesPerSecond: 2 })]);
    expect(reserve(scheduler, 'a', 6).ok).to.equal(true); expect(reserve(scheduler, 'b', 2).ok).to.equal(true);
    expect(reserve(scheduler, 'b').reason).to.equal('count-limit'); expect(reserve(scheduler, 'a', 2).ok).to.equal(true);
    expect(reserve(scheduler, 'a').reason).to.equal('byte-limit'); scheduler.dispose();
  });

  it('keeps submitted shared-link cost after endpoint retirement and refunds only unsent work', function() {
    const scheduler = new MidiScheduler(config({ linkProfiles: { cable: { maxMessagesPerSecond: 4 } } }));
    const a = output('a', { linkId: 'cable' }), b = output('b', { linkId: 'cable' }); scheduler.setOutputs([a, b]);
    scheduler._recordSent({ outputId: 'a', timeMs: 0, count: 3, bytes: 9 }, 0); reserve(scheduler, 'a');
    scheduler.setOutputs([b]); expect(scheduler.getRateSnapshot(0).next.count).to.equal(0);
    expect(reserve(scheduler, 'b').ok).to.equal(true); expect(reserve(scheduler, 'b').ok).to.equal(false); scheduler.dispose();
  });

  it('bounds pending work and queue horizon independently of transport throughput', function() {
    const scheduler = new MidiScheduler(config()); scheduler.setOutputs([output('a', { maxPending: 2, queueHorizonMs: 50 })]);
    expect(reserve(scheduler, 'a', 1, 51).reason).to.equal('queue-horizon'); expect(reserve(scheduler, 'a', 2, 50).ok).to.equal(true);
    expect(reserve(scheduler, 'a').reason).to.equal('pending-cap');
    scheduler.setOutputs([output('ump', { protocol: 'ump' })]); expect(reserve(scheduler, 'ump').reason).to.equal('protocol-budget-unsupported');
    scheduler.dispose();
  });

  it('retains all accepted cost beyond 4096 messages without charging an independent endpoint', function() {
    this.timeout(10000);
    const scheduler = new MidiScheduler(config()); scheduler.setOutputs([output('busy'), output('healthy')]);
    for (let index = 0; index < 12000; index++) scheduler._recordSent({ outputId: 'busy', timeMs: 0, count: 1, bytes: 3 }, 0);
    expect(scheduler._rateSent.length).to.be.at.most(4096);
    expect(scheduler.getRateSnapshot(0, false, 'busy').past).to.include({ count: 12000, bytes: 36000 });
    expect(scheduler.getRateSnapshot(0, false, 'healthy').past).to.include({ count: 0, bytes: 0 });
    expect(scheduler.getOutputPressure(0, 'busy').historyDetail).to.equal('conservative-endpoint-totals');
    expect(scheduler.getRateSnapshot(1001).past.count).to.equal(0); scheduler.dispose();
  });

  it('conservatively retains grouped message totals through the last message rolling-window boundary', function() {
    const scheduler = new MidiScheduler(config()); scheduler.setOutputs([output('a')]);
    for (let index = 0; index < 4100; index++) scheduler._recordSent({ outputId: 'a', timeMs: index < 2047 ? 0 : 1, count: 1, bytes: 3 }, 1);
    expect(scheduler.getRateSnapshot(1001).past.count).to.equal(4100);
    expect(scheduler.getRateSnapshot(1002).past.count).to.equal(0); scheduler.dispose();
  });

  it('bounds retained identity even under endpoint churn without discarding the submitted cost', function() {
    this.timeout(10000);
    const scheduler = new MidiScheduler(config());
    for (let index = 0; index < 6000; index++) scheduler._recordSent({ outputId: 'retired-' + index, timeMs: 0, count: 1, bytes: 3 }, 0);
    expect(scheduler._rateSent.length).to.be.at.most(4096); expect(scheduler.getRateSnapshot(0).past.count).to.equal(6000);
    const guarded = scheduler.getRateSnapshot(0, false, 'new-endpoint'); expect(guarded.past.count).to.be.greaterThan(0);
    expect(scheduler.getRateSnapshot(1001, false, 'new-endpoint').past.count).to.equal(0); scheduler.dispose();
  });

  it('invalidates future work and old external reservations when the routing budget changes', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler(config()), port = makeOutput([1], calls); port.id = 'a'; scheduler.setOutput(port);
      const reservation = reserve(scheduler, 'a', 1, 500);
      expect(scheduler.sendNote({ note: 60, durationTicks: 0 })).to.equal(true);
      expect(scheduler.sendNote({ note: 61, timeMs: 500, durationTicks: 0 })).to.equal(true);
      const revision = scheduler.getOutputRouteState('a').routeRevision;
      scheduler.setConfig(config({ maxEventsPerSecond: 50 }));
      expect(scheduler._claimReservation(reservation.reservationId, 999, 1, 'a')).to.equal(false);
      expect(scheduler.getOutputRouteState('a').routeRevision).to.be.greaterThan(revision);
      expect(scheduler._activeNotes.size).to.equal(1); expect(scheduler._pendingNoteOns.size).to.equal(0);
      clock.tick(600); expect(calls.filter(call => call.type === 'noteOn')).to.have.length(1);
      scheduler.allNotesOff(); expect(calls.filter(call => call.type === 'noteOff')).to.have.length(1); scheduler.dispose();
    });
  });

  it('honors native-byte output profiles and charges source safety releases beyond the onset quota', function() {
    withFakeClockAndPerformance(() => {
      const messages = [], scheduler = new MidiScheduler(config({ maxEventsPerSecond: 1 }));
      const port = { ...output('raw', { maxMessagesPerSecond: 2 }), send(data) { messages.push([...data]); } };
      const ports = createProcgenMidiPorts({ scheduler, now: () => 0 }); ports.setNoteOutput(port); ports.configure({ thru: true });
      ports.receiveMidi([0x90, 60, 100]); ports.receiveMidi([0x90, 61, 100]);
      expect(messages.filter(data => data[0] === 0x90)).to.have.length(2);
      ports.setInput({ id: 'replacement' }); expect(messages.filter(data => data[0] === 0x80)).to.have.length(2);
      expect(scheduler.getRateSnapshot(0).past).to.include({ count: 4, bytes: 12 }); ports.dispose(); scheduler.dispose();
    });
  });

  it('snapshots authored channel authorization so caller mutations cannot silently widen a route', function() {
    withFakeClockAndPerformance(() => {
      const messages = [], scheduler = new MidiScheduler(config()), port = { ...output('a'), send(data) { messages.push([...data]); } };
      const ports = createProcgenMidiPorts({ scheduler, now: () => 0 }); ports.setNoteOutputs([port]);
      const channels = [1], route = { outputId: 'a', channels, laneIndices: [3] }; ports.setActiveNoteOutputs([route]); channels.push(2);
      expect(ports.sendEvent({ outputId: 'a', type: 'cc', channel: 2, controller: 1, value: 10 })).to.equal(false);
      expect(ports.sendEvent({ outputId: 'a', type: 'cc', channel: 1, controller: 1, value: 10 })).to.equal(true);
      expect(messages).to.deep.equal([[0xb0, 1, 10]]); ports.dispose(); scheduler.dispose();
    });
  });

  it('stops MPE setup after a helper callback retires its route and retains the accepted setup cost', function() {
    withFakeClockAndPerformance(() => {
      const scheduler = new MidiScheduler({ mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } }), calls = [];
      const port = makeOutput([1, 2], calls, 'a');
      port.channels[1].sendPitchBendRange = () => { calls.push('accepted-range'); scheduler.setOutput(null); };
      scheduler.setOutput(port);
      expect(calls).to.deep.equal(['accepted-range']); expect(scheduler.hasAnyOutput()).to.equal(false);
      expect(scheduler.getRateSnapshot(0).past).to.include({ count: 6, bytes: 18 });
      expect(scheduler.getRateSnapshot(0).next.count).to.equal(0); scheduler.dispose();
    });
  });

  it('retains submitted link cost through stop, queue clear and re-enable while refunding canceled work', function() {
    withFakeClockAndPerformance(clock => {
      const scheduler = new MidiScheduler(config({ linkProfiles: { cable: { maxMessagesPerSecond: 4 } } })), calls = [];
      const a = makeOutput([1], calls, 'a'), b = makeOutput([1], calls, 'b'); a.budgetProfile = b.budgetProfile = { linkId: 'cable' };
      scheduler.setOutputs([a, b]); scheduler.setOutput(a); scheduler.sendNote({ note: 60 }); scheduler.allNotesOff();
      scheduler.clearQueue(); expect(scheduler.getRateSnapshot(0, false, 'b').sharedLink.past.count).to.equal(2);
      expect(scheduler.sendNote({ note: 61, outputId: 'b' })).to.equal(true); expect(scheduler.sendNote({ note: 62, outputId: 'b' })).to.equal(true);
      expect(scheduler.sendNote({ note: 63, outputId: 'b' })).to.equal(false); scheduler.allNotesOff();
      expect(scheduler.getRateSnapshot(0, false, 'b').sharedLink.past.count).to.equal(6);
      clock.tick(1001); expect(scheduler.sendNote({ note: 64, outputId: 'b' })).to.equal(true); scheduler.dispose();
    });
  });

  it('removes orphaned external reservations on queue clear without erasing physical cost', function() {
    withFakeClockAndPerformance(() => {
      const scheduler = new MidiScheduler(config()); scheduler.setOutputs([output('a')]);
      scheduler._recordSent({ outputId: 'a', timeMs: 0, count: 1, bytes: 3 }, 0); reserve(scheduler, 'a', 1, 500);
      scheduler.clearQueue(); expect(scheduler.getRateSnapshot(0).next.count).to.equal(0);
      expect(scheduler.getRateSnapshot(0).past.count).to.equal(1); scheduler.dispose();
    });
  });

  it('charges accepted exclusive and whole-device reset bytes, including a prefix before a rejected helper', function() {
    withFakeClockAndPerformance(() => {
      const accepted = [], port = { id: 'a', exclusiveChannels: [1], channels: {}, send(data) { accepted.push([...data]); return true; } };
      port.channels[1] = {
        sendNoteOn(note) { port.send([0x90, note, 64]); }, sendNoteOff(note) { port.send([0x80, note, 64]); },
        sendControlChange(cc, value) { port.send([0xb0, cc, value]); }, sendAllNotesOff() { port.send([0xb0, 123, 0]); },
        sendPitchBend() { port.send([0xe0, 0, 64]); }
      };
      const scheduler = new MidiScheduler(config()); scheduler.setOutput(port); scheduler.sendNote({ note: 60 }); scheduler.allNotesOff();
      expect(accepted).to.have.length(6); expect(scheduler.getRateSnapshot(0).past).to.include({ count: 6, bytes: 18 });
      port.channels[1].sendAllNotesOff = () => { port.send([0xb0, 123, 0]); return false; };
      scheduler.allNotesOff({ wholeDevice: true }); expect(accepted).to.have.length(10);
      expect(scheduler.getRateSnapshot(0).past).to.include({ count: 10, bytes: 30 }); expect(scheduler.lastCleanup.uncertain).to.be.greaterThan(0); scheduler.dispose();
    });
  });
});
