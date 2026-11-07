import { expect } from 'chai';
import FakeTimers from '@sinonjs/fake-timers';
import { NativeMidiBridgeClient } from '../../js/midi/native/NativeMidiBridgeClient.js';
import { NATIVE_MIDI_BRIDGE_PROTOCOL as protocol } from '../../js/midi/native/NativeMidiBridgeProtocol.js';
import { createNativeMidiBatchQueue } from '../../js/midi/native/NativeMidiBatchQueue.js';

class Socket {
  static all = [];
  constructor() { this.readyState = 1; this.bufferedAmount = 0; this.listeners = {}; this.sent = []; Socket.all.push(this); }
  addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
  send(payload) { this.sent.push(JSON.parse(payload)); }
  close() { this.readyState = 3; for (const listener of this.listeners.close ?? []) listener({}); }
  reply(row) { for (const listener of this.listeners.message ?? []) listener({ data: JSON.stringify({ protocol, ...row }) }); }
  authorize(session = 1) { this.reply({ event: 'hello', version: 1 }); const request = this.sent.at(-1); this.reply({ event: 'authorized', requestId: request.requestId, session, capabilities: { protocol, backendReady: true } }); }
  clock(session = 1) { const request = this.sent.at(-1); expect(request.action).to.equal('clock'); this.reply({ event: 'receipt', requestId: request.requestId, session, kind: 'clock', domain: 'companion-steady-microseconds', nativeMonoUs: 1000000 }); }
}
const turn = () => new Promise(resolve => setImmediate(resolve));
describe('native connection and queued-work epochs (#1273)', () => {
  let client;
  beforeEach(() => { Socket.all = []; client = new NativeMidiBridgeClient({ WebSocketImpl: Socket, now: () => 1000 }); });
  afterEach(() => client.disconnect());
  it('keeps an immediate pairing retry alive when the old authorization rejects', async () => {
    const first = client.connect({ pairingCode: 'first' }).catch(error => error.message), old = Socket.all[0]; old.reply({ event: 'hello', version: 1 });
    client.disconnect(); const second = client.connect({ pairingCode: 'second' }), fresh = Socket.all[1];
    await turn(); expect(client.state).to.equal('pairing'); expect(fresh.readyState).to.equal(1);
    old.reply({ event: 'authorized', requestId: 1, session: 50, capabilities: { protocol, backendReady: true } });
    fresh.authorize(2); await turn(); fresh.clock(2); expect(await second).to.equal(client); expect(await first).to.equal('explicit-disconnect'); expect(client.session).to.equal(2);
  });
  it('does not let an old heartbeat rejection retire a replacement socket', async () => {
    const timers = FakeTimers.install({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const initial = client.connect({ pairingCode: 'first' }), old = Socket.all[0]; old.authorize(); await turn(); old.clock(); await initial;
      timers.tick(1000); expect(old.sent.at(-1).action).to.equal('heartbeat'); client.disconnect();
      const retry = client.connect({ pairingCode: 'second' }).catch(error => error.message), fresh = Socket.all[1]; await turn();
      expect(client.state).to.equal('pairing'); expect(fresh.readyState).to.equal(1); client.disconnect(); await retry;
    } finally { timers.uninstall(); }
  });
  it('rejects authorization without an owned authorization request and permits a later valid retry', async () => {
    const bad = client.connect({ pairingCode: 'first' }).catch(error => error.message); Socket.all[0].reply({ event: 'authorized', requestId: 1, session: 1, capabilities: { protocol, backendReady: true } });
    expect(await bad).to.equal('Invalid native session'); expect(client.state).to.equal('disconnected');
    const good = client.connect({ pairingCode: 'second' }), fresh = Socket.all[1]; fresh.authorize(2); await turn(); fresh.clock(2); await good; expect(client.state).to.equal('connected');
  });
  it('returns to disconnected when the platform refuses socket construction, then retries cleanly', async () => {
    client.WebSocketImpl = class { constructor() { throw new Error('blocked loopback port'); } };
    let error; try { await client.connect({ pairingCode: 'first' }); } catch (failure) { error = failure; }
    expect(error.message).to.equal('blocked loopback port'); expect(client.state).to.equal('disconnected');
    client.WebSocketImpl = Socket; const connected = client.connect({ pairingCode: 'retry' }), socket = Socket.all[0]; socket.authorize(); await turn(); socket.clock(); await connected; expect(client.state).to.equal('connected');
  });
  it('rechecks the connection after a native lookahead wait', async () => {
    const timers = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] }); let queue;
    try {
      const calls = [], transport = { session: 11, now: () => 0, sendBatch: async row => { calls.push(row); return { kind: 'driver-submitted', acceptedWords: 1 }; } };
      queue = createNativeMidiBatchQueue({ client: transport }); const job = queue.enqueue({ grant: 1, execution: 1, targetTimeMs: 3000, words: [0x20903c7f], provenance: {} });
      await turn(); transport.session = 22; timers.tick(1051); expect((await job.completion).kind).to.equal('cancelled'); expect(calls).to.have.length(0); expect(queue.state().pendingJobs).to.equal(0);
    } finally { queue?.dispose(); timers.uninstall(); }
  });
  for (const delayed of [false, true]) it('refuses old-session batches ' + (delayed ? 'after a dependency settles' : 'before flush') + ' and admits fresh work', async () => {
    let release, calls = []; const dependency = new Promise(resolve => { release = resolve; });
    const transport = { session: 11, now: () => 0, sendBatch: async row => { calls.push(row); return { kind: 'driver-submitted', acceptedWords: row.words.length }; } }, queue = createNativeMidiBatchQueue({ client: transport });
    const input = { grant: 1, execution: 1, targetTimeMs: 10, words: [0x20903c7f], provenance: { worldId: 'old', generation: 1, batchId: 1 } };
    const old = queue.enqueue({ ...input, dependencies: delayed ? [{ completion: dependency, requireSubmitted: true }] : [] });
    if (delayed) await turn(); transport.session = 22; release({ kind: 'driver-submitted' });
    const refused = await old.completion; expect(refused.kind).to.equal('cancelled'); expect(refused.session).to.equal(11); expect(refused.acceptedWords).to.equal(0); expect(calls).to.have.length(0);
    const fresh = queue.enqueue({ ...input, execution: 2 }); expect((await fresh.completion).kind).to.equal('driver-submitted'); expect(calls).to.have.length(1); expect(queue.state().retainedEstimateBytes).to.equal(0); queue.dispose();
  });
});
