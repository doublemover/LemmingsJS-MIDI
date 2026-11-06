import http from 'node:http';
import https from 'node:https';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { NativeMidiProcess } from './NativeMidiProcess.js';
import { decodeNativeMidiBatch, NATIVE_MIDI_BRIDGE_PROTOCOL } from '../../js/midi/native/NativeMidiBridgeProtocol.js';

const uint = (value, maximum = 0xffffffff) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error('Invalid bridge integer'); return value;
};
const digest = value => createHash('sha256').update(value).digest();
const originValue = value => { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) throw new Error('An exact HTTP(S) application Origin is required'); return value; };
export async function createNativeMidiBridgeServer({ executable, port = 8765, origins = ['http://127.0.0.1:8080', 'http://localhost:8080'], tls = null } = {}) {
  uint(port, 65535); if (!port) throw new Error('Choose an explicit loopback bridge port');
  const permittedOrigins = new Set(origins.map(originValue)); if (!permittedOrigins.size || permittedOrigins.size > 8) throw new Error('Invalid bridge Origin grants');
  const peer = new NativeMidiProcess({ executable }), clients = new Set(), sessions = new Map();
  let sessionSequence = 0, pairing = null, closing = false, unavailable = 'starting';
  const httpHandler = (request, response) => { response.writeHead(request.url === '/' ? 200 : 404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(request.url === '/' ? 'Lemmings native MIDI bridge. Pair from the configured application.\n' : 'Not found\n'); };
  const server = tls ? https.createServer(tls, httpHandler) : http.createServer(httpHandler);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false });
  const send = (client, value, ingress = false) => {
    if (client.ws.readyState !== WebSocket.OPEN) return false;
    if (client.ws.bufferedAmount > (ingress ? 262144 : 1048576)) {
      if (!ingress) revoke(client, 'browser-output-pressure'); return false;
    }
    const text = JSON.stringify({ protocol: NATIVE_MIDI_BRIDGE_PROTOCOL, ...value });
    if (Buffer.byteLength(text) > 65536) { revoke(client, 'bridge-output-capacity'); return false; }
    client.ws.send(text, error => { if (error) revoke(client, 'browser-connection-failed'); }); return true;
  };
  const revoke = (client, reason) => {
    if (client.retired) return; client.retired = true; clearTimeout(client.pairTimeout); clients.delete(client); sessions.delete(client.session);
    if (client.session && peer.ready) peer.request('D', client.session, [], { priority: true }).catch(() => {});
    if (client.ws.readyState === WebSocket.OPEN) client.ws.close(1008, reason); else client.ws.terminate();
  };
  const failure = (client, requestId, error) => send(client, { event: 'receipt', requestId, session: client.session, kind: 'error', failedPacketUnconfirmed: error.notSubmitted !== true, reason: String(error.message || error).slice(0, 180) });
  const call = async (client, requestId, operation, fields, { priority = false, provenance } = {}) => {
    if (client.pending >= (priority ? 64 : 56)) throw Object.assign(new Error('Browser native request capacity'), { notSubmitted: true }); ++client.pending;
    try {
      const row = await peer.request(operation, client.session, fields, { priority, onQueued: receipt => send(client, { ...receipt, requestId, provenance }) });
      if (row.kind === 'opened') client.grants.set(row.grant, Object.freeze({ direction: row.direction, groupMask: row.groupMask, permissions: row.permissions }));
      if (row.kind === 'closed') client.grants.delete(row.grant);
      if (!client.retired) send(client, { ...row, requestId, provenance });
      return row;
    } finally { --client.pending; }
  };
  const authorize = async (client, row) => {
    if (client.authorizing || row.action !== 'authorize' || typeof row.pairingCode !== 'string' || row.pairingCode.length > 128 || !pairing || pairing.expires <= performance.now() || pairing.attempts++ >= 5 ||
        !timingSafeEqual(digest(row.pairingCode), pairing.hash)) throw new Error('Pairing denied or expired');
    if (!peer.ready || unavailable) throw new Error('Native companion ' + unavailable);
    pairing = null; client.authorizing = true; client.session = ++sessionSequence; if (client.session > 0xffffffff) throw new Error('Bridge session identity exhausted');
    const receipt = await peer.request('S', client.session); if (receipt.kind !== 'session-opened' || client.retired) { revoke(client, 'session-open-failed'); return; }
    clearTimeout(client.pairTimeout); client.authorized = true; client.lastHeartbeat = performance.now(); sessions.set(client.session, client);
    send(client, { event: 'authorized', requestId: row.requestId, session: client.session, capabilities: peer.ready, heartbeatIntervalMs: 1000, leaseMs: 5000 });
  };
  const command = async (client, row, binary) => {
    const requestId = uint(row.requestId); if (!requestId || requestId <= client.sequence) throw new Error('Replayed bridge sequence'); client.sequence = requestId;
    if (!client.authorized) { if (binary || row.protocol !== NATIVE_MIDI_BRIDGE_PROTOCOL) throw new Error('Pairing required'); return authorize(client, row); }
    if (row.session !== client.session || !binary && row.protocol !== NATIVE_MIDI_BRIDGE_PROTOCOL) throw new Error('Bridge session or protocol mismatch');
    if (binary) {
      if (!client.grants.has(row.grant) || client.grants.get(row.grant).direction !== 'output') throw new Error('Writable endpoint grant required');
      return call(client, requestId, 'B', [row.grant, row.execution, row.deadlineUs, row.priority, row.words.length, ...row.words.map(word => word.toString(16))], { priority: row.priority === 0, provenance: row.provenance });
    }
    switch (row.action) {
    case 'heartbeat': client.lastHeartbeat = performance.now(); return call(client, requestId, 'H', [], { priority: true });
    case 'clock': return call(client, requestId, 'P', []);
    case 'enumerate': return call(client, requestId, 'L', [uint(row.cursor ?? 0, 1024), uint(row.limit ?? 16, 16)]);
    case 'selectBackend': return call(client, requestId, 'A', [uint(row.api, 65535)]);
    case 'open': return call(client, requestId, 'O', [uint(row.inventoryEpoch), uint(row.endpointToken), uint(row.groupMask, 65535), uint(row.permissions ?? 0, 15)]);
    case 'publish': {
      if (typeof row.name !== 'string' || !row.name.trim() || Buffer.byteLength(row.name) > 128 || /[\x00-\x1f\x7f]/.test(row.name) || !['input', 'output'].includes(row.direction)) throw new Error('Invalid virtual endpoint publication');
      return call(client, requestId, 'V', [Number(row.direction === 'input'), uint(row.groupMask, 65535), uint(row.permissions ?? 0, 15), Buffer.from(row.name, 'utf8').toString('hex')]);
    }
    case 'close': if (!client.grants.has(uint(row.grant))) throw new Error('Endpoint grant required'); return call(client, requestId, 'X', [row.grant], { priority: true });
    case 'cancel': if (!client.grants.has(uint(row.grant)) || !uint(row.execution)) throw new Error('Owned execution required'); return call(client, requestId, 'C', [row.grant, row.execution], { priority: true });
    case 'disconnect': revoke(client, 'explicit-disconnect'); return;
    default: throw new Error('Unsupported bridge operation');
    }
  };
  server.on('upgrade', (request, socket, head) => {
    const address = socket.remoteAddress;
    if (closing || request.url !== '/midi' || request.headers.host !== '127.0.0.1:' + port || !permittedOrigins.has(request.headers.origin) ||
        !['127.0.0.1', '::ffff:127.0.0.1'].includes(address) || clients.size >= 4) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws));
  });
  sockets.on('connection', ws => {
    const client = { ws, session: 0, sequence: 0, pending: 0, authorized: false, authorizing: false, retired: false, grants: new Map(), lastHeartbeat: performance.now(), rateStart: performance.now(), messages: 0, bytes: 0 };
    clients.add(client); client.pairTimeout = setTimeout(() => revoke(client, 'pairing-timeout'), 120000); client.pairTimeout.unref?.();
    send(client, { event: 'hello', state: 'pairing-required', version: 1 });
    ws.on('error', () => revoke(client, 'browser-connection-error')); ws.on('close', () => revoke(client, 'browser-disconnected'));
    ws.on('message', (bytes, binary) => {
      let requestId = 0;
      try {
        const now = performance.now(); if (now - client.rateStart >= 1000) { client.rateStart = now; client.messages = client.bytes = 0; }
        if (++client.messages > 256 || (client.bytes += bytes.length) > 2097152 || !binary && bytes.length > 8192) throw new Error('Bridge input pressure');
        const row = binary ? decodeNativeMidiBatch(bytes) : JSON.parse(bytes.toString('utf8')); requestId = row?.requestId;
        if (!row || Object.getPrototypeOf(row) !== Object.prototype || client.retired) throw new Error('Invalid bridge envelope');
        command(client, row, binary).catch(error => { failure(client, requestId, error); if (!client.authorized) revoke(client, 'authorization-failed'); });
      } catch (error) { failure(client, requestId, error); revoke(client, 'invalid-or-excessive-bridge-input'); }
    });
  });
  peer.on('ready', () => { unavailable = null; });
  peer.on('unavailable', state => { unavailable = state.state; for (const client of [...clients]) { send(client, { event: 'unavailable', ...state }); revoke(client, 'native-companion-unavailable'); } });
  peer.on('notification', row => {
    const target = row.session ? sessions.get(row.session) : null, recipients = target ? [target] : row.session ? [] : [...sessions.values()];
    for (const client of recipients) {
      if (row.event === 'grant-retired') client.grants.delete(row.grant);
      if (!send(client, row, row.event === 'ingress') && row.event === 'ingress') send(client, { event: 'ingress-loss', session: client.session, grant: row.grant, reason: 'browser-ingress-pressure' });
      if (row.event === 'session-retired') revoke(client, 'native-session-retired');
    }
  });
  const watchdog = setInterval(() => { for (const client of [...clients]) if (client.authorized && performance.now() - client.lastHeartbeat >= 5000) revoke(client, 'application-heartbeat-expired'); }, 500); watchdog.unref?.();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); peer.start();
  return Object.freeze({
    url: (tls ? 'wss' : 'ws') + '://127.0.0.1:' + port + '/midi',
    issuePairingCode() { if (closing) throw new Error('Bridge closed'); const code = randomBytes(32).toString('base64url'); pairing = { hash: digest(code), expires: performance.now() + 120000, attempts: 0 }; return code; },
    revokeAll() { pairing = null; for (const client of [...clients]) revoke(client, 'local-revoke'); },
    async close() { if (closing) return; closing = true; pairing = null; clearInterval(watchdog); for (const client of [...clients]) revoke(client, 'bridge-stopping'); await peer.close(); for (const ws of sockets.clients) ws.terminate(); sockets.close(); await new Promise(resolve => server.close(resolve)); }
  });
}
