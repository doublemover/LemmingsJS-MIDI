import { NATIVE_MIDI_BRIDGE_PROTOCOL, encodeNativeMidiBatch } from './NativeMidiBridgeProtocol.js';

const bridgeUrl = value => {
  const address = new URL(value);
  if (!['ws:', 'wss:'].includes(address.protocol) || address.hostname !== '127.0.0.1' || address.pathname !== '/midi' || address.search || address.hash || address.username || address.password) throw new Error('Native MIDI requires an explicit loopback bridge URL');
  if (globalThis.location?.protocol === 'https:' && address.protocol !== 'wss:') throw new Error('HTTPS applications require a trusted WSS native bridge');
  return address.href;
};

const beforeSubmission = reason => Object.assign(new Error(reason), { notSubmitted: true });
export class NativeMidiBridgeClient {
  #socket = null; #requests = new Map(); #listeners = new Set(); #sequence = 0; #session = 0; #timer = null;
  #samples = []; #grants = new Map(); #state = 'disconnected'; #capabilities = null; #connect = null; #lastClock = 0;
  constructor({ url = (globalThis.location?.protocol === 'https:' ? 'wss:' : 'ws:') + '//127.0.0.1:8765/midi', WebSocketImpl = globalThis.WebSocket, now = () => performance.now() } = {}) {
    this.url = bridgeUrl(url); this.WebSocketImpl = WebSocketImpl; this.now = now;
  }
  setUrl(url) { if (this.#socket) throw new Error('Disconnect before changing the bridge address'); this.url = bridgeUrl(url); }
  get state() { return this.#state; }
  get session() { return this.#session; }
  get capabilities() { return this.#capabilities; }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #emit(row) { for (const listener of this.#listeners) { try { listener(Object.freeze(row)); } catch { /* Observers cannot alter transport ownership. */ } } }
  #setState(state, reason = null) { this.#state = state; this.#emit({ event: 'state', state, reason }); }
  async connect({ pairingCode } = {}) {
    if (this.#socket || typeof pairingCode !== 'string' || !pairingCode || pairingCode.length > 128) throw new Error('A fresh local pairing code is required');
    if (typeof this.WebSocketImpl !== 'function') throw new Error('WebSocket is unavailable');
    this.#setState('pairing'); this.#sequence = 0;
    const socket = this.#socket = new this.WebSocketImpl(this.url); socket.binaryType = 'arraybuffer';
    const connected = new Promise((resolve, reject) => { this.#connect = { resolve, reject }; });
    socket.addEventListener('error', () => { if (this.#socket === socket) this.#retire('not-installed-or-unreachable'); });
    socket.addEventListener('close', () => { if (this.#socket === socket) this.#retire('disconnected'); });
    socket.addEventListener('message', event => {
      if (this.#socket !== socket) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 65536) throw new Error('Invalid native MIDI reply');
        const row = JSON.parse(event.data); if (row.protocol !== NATIVE_MIDI_BRIDGE_PROTOCOL) throw new Error('Native MIDI version mismatch');
        if (row.event === 'hello') {
          if (row.version !== 1 || this.#state !== 'pairing') throw new Error('Native MIDI handshake mismatch');
          this.#request('authorize', { pairingCode }, { pairing: true }).catch(error => this.#retire(error.message)); pairingCode = null; return;
        }
        if (row.event === 'authorized') {
          if (this.#session || !Number.isInteger(row.session) || row.session <= 0 || row.capabilities?.protocol !== NATIVE_MIDI_BRIDGE_PROTOCOL) throw new Error('Invalid native session');
          this.#session = row.session; this.#capabilities = Object.freeze(row.capabilities); this.#setState(row.capabilities.backendReady ? 'connected' : 'native-backend-unavailable');
          const pending = this.#requests.get(row.requestId); if (pending) { clearTimeout(pending.timeout); this.#requests.delete(row.requestId); pending.resolve(row); }
          this.#timer = setInterval(() => {
            this.#request('heartbeat', {}, { priority: true }).catch(error => this.#retire(error.message));
            if (this.now() - this.#lastClock >= 2000) this.synchronizeClock().catch(error => this.#emit({ event: 'clock-unavailable', reason: error.message }));
          }, 1000);
          this.#connect?.resolve(row); this.#connect = null; return;
        }
        if (row.session != null && row.session !== this.#session) throw new Error('Stale native MIDI session');
        if (row.event === 'receipt') {
          const pending = this.#requests.get(row.requestId); if (!pending) return;
          if (row.kind === 'queued') { pending.onReceipt?.(Object.freeze(row)); this.#emit(row); return; }
          this.#requests.delete(row.requestId); clearTimeout(pending.timeout);
          if (row.kind === 'opened') this.#grants.set(row.grant, Object.freeze({ ...row, connectionEpoch: this.#session }));
          if (row.kind === 'closed') this.#grants.delete(row.grant);
          if (row.kind === 'backend') { this.#capabilities = Object.freeze({ ...this.#capabilities, backendReady: row.ready, selectedApi: row.api }); this.#setState(row.ready ? 'connected' : 'native-backend-unavailable'); }
          pending.onReceipt?.(Object.freeze(row));
          if (row.kind === 'error') pending.reject(Object.assign(new Error(row.reason), { receipt: row })); else pending.resolve(Object.freeze(row));
        } else if (row.event === 'grant-retired') this.#grants.delete(row.grant);
        else if (row.event === 'unavailable' || row.event === 'session-retired' || row.event === 'fatal') { this.#emit(row); this.#retire(row.reason || row.state || row.event); return; }
        this.#emit(row);
      } catch (error) { this.#retire(error.message); }
    });
    const timeout = setTimeout(() => this.#retire('pairing-timeout'), 15000);
    try { await connected; await this.synchronizeClock(); return this; } finally { clearTimeout(timeout); }
  }
  #request(action, fields = {}, { pairing = false, priority = false, binary = null, onReceipt } = {}) {
    if (!this.#socket || this.#socket.readyState !== 1 || !pairing && !this.#session || this.#sequence >= 0xffffffff || this.#requests.size >= (priority ? 64 : 56) || this.#socket.bufferedAmount > (priority ? 1048576 : 983040)) return Promise.reject(beforeSubmission('Native bridge unavailable or at capacity'));
    const requestId = ++this.#sequence;
    let payload;
    try { payload = binary ? encodeNativeMidiBatch({ ...binary, session: this.#session, requestId }) : JSON.stringify({ protocol: NATIVE_MIDI_BRIDGE_PROTOCOL, session: this.#session, requestId, action, ...fields }); }
    catch (error) { error.notSubmitted = true; return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.#retire('native-receipt-timeout'), 10000);
      this.#requests.set(requestId, { resolve, reject, timeout, onReceipt });
      try { this.#socket.send(payload); } catch (error) { clearTimeout(timeout); this.#requests.delete(requestId); reject(error); this.#retire('native-send-failed'); }
    });
  }
  async synchronizeClock() {
    const session = this.#session, before = this.now(), row = await this.#request('clock'), after = this.now();
    if (session !== this.#session) throw new Error('Clock session retired');
    if (row.kind !== 'clock' || row.domain !== 'companion-steady-microseconds' || !Number.isSafeInteger(row.nativeMonoUs) || row.nativeMonoUs < 0 || after < before) throw new Error('Native monotonic clock unavailable');
    const sample = Object.freeze({ offsetUs: row.nativeMonoUs - (before + after) * 500, uncertaintyUs: (after - before) * 500, observedMs: after });
    this.#samples.push(sample); this.#samples = this.#samples.filter(item => after - item.observedMs <= 5000).slice(-8); this.#lastClock = after; return sample;
  }
  clockStatus() {
    const now = this.now(), sample = this.#samples.filter(item => now - item.observedMs <= 5000).sort((a, b) => a.uncertaintyUs - b.uncertaintyUs)[0];
    return sample ? Object.freeze({ status: sample.uncertaintyUs <= 25000 ? 'synchronized' : 'uncertain', ...sample, domain: 'companion-steady-microseconds' }) : Object.freeze({ status: 'unavailable' });
  }
  async enumerate() {
    const endpoints = []; let cursor = 0, inventoryEpoch = null;
    do {
      const row = await this.#request('enumerate', { cursor, limit: 16 });
      if (inventoryEpoch != null && inventoryEpoch !== row.inventoryEpoch) throw new Error('Native inventory changed during enumeration');
      inventoryEpoch = row.inventoryEpoch; if (!Array.isArray(row.endpoints) || endpoints.length + row.endpoints.length > 1024) throw new Error('Native endpoint inventory capacity');
      endpoints.push(...row.endpoints); cursor = row.nextCursor;
    } while (cursor !== null);
    return Object.freeze({ inventoryEpoch, endpoints: Object.freeze(endpoints.map(row => Object.freeze({ ...row, connectionEpoch: this.#session }))) });
  }
  selectBackend(api) { return this.#request('selectBackend', { api }); }
  open({ inventoryEpoch, endpointToken, groupMask, permissions = 0 }) { return this.#request('open', { inventoryEpoch, endpointToken, groupMask, permissions }); }
  publish({ name = 'Lemmings Performance', direction = 'output', groupMask, permissions = 0 }) { return this.#request('publish', { name, direction, groupMask, permissions }); }
  closeGrant(grant) { return this.#request('close', { grant }, { priority: true }); }
  cancelExecution(grant, execution) { return this.#request('cancel', { grant, execution }, { priority: true }); }
  sendBatch({ grant, execution, targetTimeMs, priority = 1, words, provenance = {}, onReceipt }) {
    if (!this.#grants.has(grant) || this.#grants.get(grant).direction !== 'output') return Promise.reject(beforeSubmission('Native output grant required'));
    const clock = this.clockStatus(); if (clock.status !== 'synchronized') return Promise.reject(beforeSubmission('Native clock is stale or uncertain'));
    const now = this.now(); if (!Number.isFinite(targetTimeMs) || targetTimeMs > now + 1950 || priority !== 0 && targetTimeMs < now - 50) return Promise.reject(beforeSubmission('Native target outside scheduling horizon'));
    const deadlineUs = Math.round(targetTimeMs * 1000 + clock.offsetUs);
    return this.#request('send', {}, { priority: priority === 0, binary: { grant, execution, deadlineUs, priority, words, provenance }, onReceipt });
  }
  #retire(reason) {
    const socket = this.#socket; if (!socket && !this.#connect) return; this.#socket = null; clearInterval(this.#timer); this.#timer = null;
    for (const request of this.#requests.values()) { clearTimeout(request.timeout); request.reject(new Error(reason)); } this.#requests.clear();
    this.#connect?.reject(new Error(reason)); this.#connect = null; this.#session = 0; this.#samples = []; this.#grants.clear(); this.#capabilities = null;
    if (socket && socket.readyState < 2) socket.close(1000, 'Application session retired'); this.#setState('disconnected', reason);
  }
  disconnect() { if (this.#session) this.#request('disconnect', {}, { priority: true }).catch(() => {}); this.#retire('explicit-disconnect'); }
}
