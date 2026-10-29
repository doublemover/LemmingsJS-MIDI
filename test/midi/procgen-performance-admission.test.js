import { expect } from 'chai';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { createProcgenMidiPorts } from '../../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { createProcgenTransport } from '../../js/app/procgen/workstation/ProcgenTransport.js';
import { sendProcgenMidiBytes, clearProcgenMidiQueue } from '../../js/app/procgen/workstation/ProcgenMidiBytes.js';
import { environment, receipt, turn, deferred } from '../helpers/performance-lease.js';

const portFixture = () => {
  const packets = [], clears = [], native = { send(data, timestamp) { packets.push({ data: [...data], timestamp }); }, clear() { clears.push(packets.length); } };
  const port = { id: 'reviewed-output', state: 'connected', _midiOutput: native,
    send(data, options) { native.send(data, options?.time); }, clear() { native.clear(); }, channels: {} };
  port.channels[1] = { sendNoteOn(note, options) { port.send([0x90, note, options?.rawAttack || 100], options); },
    sendNoteOff(note, options) { port.send([0x80, note, 0], options); },
    sendPitchBendRange() { for (const data of [[0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, 2]]) port.send(data); } };
  return { port, native, packets, clears };
};
const managed = async (extra = {}) => {
  const env = environment(), owner = env.make(), peer = env.make(), parent = env.source(owner.lease, () => receipt(), 'reviewed-parent');
  const token = await parent.acquire(), p = portFixture(); let time = 0, ports; const timers = [];
  const transport = createProcgenTransport({ now: () => time, driver: { start() {}, stop() {}, dispose() {} },
    onFlush: () => ports?.flush(),
    setTimer: (fn, delay) => { timers.push({ fn, delay }); return timers.length; } });
  const admission = cleanup => parent.isCurrent(token) || cleanup && parent.canRelease(token);
  ports = createProcgenMidiPorts({ transport, performanceCoordinator: owner.lease, now: () => time,
    createOutputAdmission: () => admission, ...extra });
  return { env, owner, peer, parent, token, ...p, transport, ports, timers, time: value => { time = value; },
    async close() { const retired = ports.dispose(); await retired.completion; transport.dispose(); await owner.lease.dispose(); await peer.lease.dispose(); } };
};

describe('performance ownership at actual MIDI submissions', () => {
  it('releases a direct stop and builds a fresh cleanup frontier after reactivation under the same parent lease', async () => {
    const f = await managed();
    try {
      f.ports.setNoteOutput(f.port); await turn(); expect(f.ports.sendEvent({ data: [0x90, 60, 100] })).to.equal(true);
      const stopped = f.ports.stopPerformance('page-hidden'); await stopped.completion; await turn();
      expect(stopped.outcome).to.equal('complete'); expect(f.parent.isCurrent(f.token)).to.equal(true);
      f.ports.setNoteOutput(f.port, { rearm: true }); await turn(); expect(f.ports.sendEvent({ data: [0x90, 61, 100] })).to.equal(true);
      expect(await f.peer.lease.takeOver()).to.equal(true);
      expect(f.packets.filter(packet => (packet.data[0] & 0xf0) === 0x80).map(packet => packet.data[1])).to.deep.equal([60, 61]);
    } finally { await f.close(); }
  });
  it('does not halt transport or cancel preparation when an unused managed note catalog is synchronized', async () => {
    const f = await managed();
    try {
      f.transport.play(); f.ports.setActiveNoteOutputs([]);
      expect(f.transport.getState().playing).to.equal(true);
      await f.ports.setClockOutput(f.port); expect(f.transport.getState().playing).to.equal(true);
    } finally { await f.close(); }
  });
  it('does not stop newly received external clock while a selected clock destination awaits its lease', async () => {
    const f = await managed();
    try {
      const arming = f.ports.setClockOutput(f.port, { arm: true });
      f.transport.configure({ clockSource: 'external' }); f.transport.receiveMidi([0xfa]);
      await arming; expect(f.transport.getState().playing).to.equal(true); expect(f.packets).to.have.length(0);
    } finally { await f.close(); }
  });
  it('clears a shared clock queue before submitting owned releases and does not erase those releases a second time', async () => {
    const f = await managed();
    try {
      f.ports.setNoteOutput(f.port); await turn(); await f.ports.setClockOutput(f.port, { arm: true });
      f.transport.play(); f.ports.sendEvent({ data: [0x90, 60, 100] });
      expect(await f.peer.lease.takeOver()).to.equal(true);
      const off = f.packets.findIndex(packet => packet.data[0] === 0x80);
      expect(off).to.be.greaterThan(0); expect(f.clears).to.have.length(1); expect(f.clears[0]).to.be.at.most(off);
    } finally { await f.close(); }
  });
  it('checks native calls inside a multi-message adapter and preserves only the accepted prefix', () => {
    const f = portFixture(), scheduler = new MidiScheduler({ defaultChannel: 1 }); let current = true;
    scheduler.setOutputAdmission(() => current); scheduler.setOutput(f.port);
    const original = f.native.send; f.native.send = function(...args) { const value = original.apply(this, args); current = false; return value; };
    expect(scheduler._sendOutput(f.port, 1, 'sendPitchBendRange', [2, 0])).to.equal(false);
    expect(f.packets.map(packet => packet.data)).to.deep.equal([[0xb0, 101, 0]]);
    scheduler.dispose();
  });
  it('fails closed when the native boundary cannot be wrapped, without calling an adapter', () => {
    const f = portFixture(), scheduler = new MidiScheduler({ defaultChannel: 1 });
    Object.defineProperty(f.native, 'send', { value: f.native.send, writable: false }); scheduler.setOutputAdmission(() => true); scheduler.setOutput(f.port);
    expect(scheduler._sendOutput(f.port, 1, 'sendNoteOn', [60, {}])).to.equal(false); expect(f.packets).to.have.length(0);
    scheduler.dispose();
  });
  it('captures one admission scope so a reentrant route replacement cannot authorize its remaining packets', () => {
    const f = portFixture(), scheduler = new MidiScheduler({ defaultChannel: 1 }); let old = true, current = () => old;
    scheduler.setOutputAdmissionFactory(() => current); scheduler.setOutput(f.port);
    const original = f.native.send; f.native.send = function(...args) { const result = original.apply(this, args); old = false; current = () => true; return result; };
    expect(scheduler._sendOutput(f.port, 1, 'sendPitchBendRange', [2, 0], { reason: 'mpe-init' })).to.equal(false);
    expect(f.packets).to.have.length(1); scheduler.dispose();
  });
  it('guards raw bytes and queue clearing after the captured owner has retired', () => {
    const f = portFixture(); let current = true; const allowed = () => current;
    expect(sendProcgenMidiBytes(f.port, [0x90, 60, 100], 0, allowed)).to.equal(true); current = false;
    expect(sendProcgenMidiBytes(f.port, [0x90, 61, 100], 0, allowed)).to.equal(false);
    expect(clearProcgenMidiQueue(f.port, allowed)).to.equal(false); expect(f.clears).to.have.length(0); expect(f.packets).to.have.length(1);
  });
  it('retires workstation raw ownership before another tab can perform', async () => {
    const f = await managed();
    try {
      f.ports.setNoteOutput(f.port); await turn(); expect(f.ports.sendEvent({ data: [0x90, 60, 100] })).to.equal(true);
      expect(await f.peer.lease.takeOver()).to.equal(true);
      expect(f.packets.map(packet => packet.data)).to.deep.equal([[0x90, 60, 100], [0x80, 60, 0]]);
      expect(f.ports.sendEvent({ data: [0x90, 61, 100] })).to.equal(false); expect(f.ports.getState().authorizedNoteOutputIds).to.deep.equal([]);
    } finally { await f.close(); }
  });
  it('keeps the native lock if an owned raw release is rejected, even after later empty flushes', async () => {
    const f = await managed();
    try {
      f.ports.setNoteOutput(f.port); await turn(); f.ports.sendEvent({ data: [0x90, 60, 100] });
      f.native.send = () => { throw new Error('Port rejected cleanup'); };
      expect(await f.peer.lease.takeOver()).to.equal(false); f.ports.flush();
      expect(f.ports.getState().lastCleanup.uncertain).to.be.greaterThan(0); expect(f.owner.lease.state().status).to.equal('blocked'); expect(f.env.owned()).to.equal(true);
    } finally { await f.close(); }
  });
  it('selects a saved clock without arming and requires a fresh explicit arm after handoff', async () => {
    const f = await managed();
    try {
      expect(await f.ports.setClockOutput(f.port)).to.equal(false); f.transport.play(); expect(f.packets).to.have.length(0);
      expect(await f.ports.setClockOutput(f.port, { arm: true })).to.equal(true); f.transport.play(); expect(f.packets.some(packet => packet.data[0] === 0xf8)).to.equal(true);
      expect(await f.peer.lease.takeOver()).to.equal(true); const count = f.packets.length;
      f.transport.play(); await f.ports.setClockOutput(f.port); expect(f.packets).to.have.length(count); expect(f.ports.getState().performance.clockArmed).to.equal(false);
    } finally { await f.close(); }
  });
  it('holds a submitted future clock frontier when a native queue cannot be cleared', async () => {
    const f = await managed();
    try {
      delete f.native.clear; await f.ports.setClockOutput(f.port, { arm: true }); f.transport.play();
      const handoff = f.peer.lease.takeOver(); await turn(); expect(f.env.owned()).to.equal(true); expect(f.peer.lease.state().exclusive).to.equal(false);
      expect(f.timers.length).to.be.greaterThan(0); f.time(101); for (const timer of f.timers.splice(0)) timer.fn();
      expect(await handoff).to.equal(true); expect(f.transport.getState().playing).to.equal(false);
    } finally { await f.close(); }
  });
});

describe('performance cleanup generations', () => {
  it('never grants cleanup to an earlier source activation while another source retains the same native lock', async () => {
    const f = environment(), a = f.make(), held = f.source(a.lease, () => receipt(), 'held'), next = f.source(a.lease, () => receipt(), 'next');
    await held.acquire(); const old = await next.acquire(); await next.release(); const fresh = await next.acquire();
    const frontier = deferred(); const stopping = next.release({ receipt: receipt(() => frontier.promise) });
    expect(next.canRelease(old)).to.equal(false); expect(next.canRelease(fresh)).to.equal(true); frontier.resolve(); await stopping;
    expect(next.canRelease(fresh)).to.equal(false); await a.lease.dispose();
  });
  it('cancels a source waiting for a late native grant without stranding that lock', async () => {
    const late = deferred(), f = environment(), a = f.make({ locks: { request: (_name, _options, callback) => late.promise.then(() => callback({})) } });
    const source = f.source(a.lease), acquired = source.acquire(), released = source.release();
    expect(await acquired).to.equal(null); expect(await released).to.equal(true); late.resolve(); await turn(); await turn();
    expect(a.lease.state().exclusive).to.equal(false); await a.lease.dispose();
  });
});
