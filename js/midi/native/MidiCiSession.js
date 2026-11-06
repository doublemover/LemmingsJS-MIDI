const BROADCAST = 0x0fffffff;
const randomMuid = () => {
  const word = new Uint32Array(1); let value;
  do { globalThis.crypto.getRandomValues(word); value = word[0] & 0x0fffffff; } while (!value || value >= 0x0fffff00); return value;
};
const identityKey = identity => JSON.stringify([identity?.manufacturer, identity?.family, identity?.model, identity?.revision]);
export function createMidiCiSession({ routes, inputGrant, outputGrant, group, scope = 127, maximumPeers = 32, maximumMessageBytes = 1024, timeoutMs = 1500, now = () => performance.now() }) {
  const initial = routes.state(), input = initial.grants.find(value => value.grant === inputGrant), output = initial.grants.find(value => value.grant === outputGrant), inputIdentity = routes.input.scope(inputGrant);
  if (!input || !output || input.direction !== 'input' || output.direction !== 'output' || !(input.permissions & 1) || !(output.permissions & 1) || !inputIdentity ||
      !Number.isInteger(group) || group < 0 || group > 15 || !(input.groupMask & output.groupMask & 1 << group) || ![127, 126, ...Array.from({ length: 16 }, (_, i) => i)].includes(scope) ||
      !Number.isSafeInteger(maximumPeers) || maximumPeers < 1 || maximumPeers > 64 || !Number.isSafeInteger(maximumMessageBytes) || maximumMessageBytes < 128 || maximumMessageBytes > 2048 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) throw new Error('MIDI-CI needs explicit current SysEx input/output grants and group');
  const peers = new Map(), pending = new Map(), listeners = new Set(), protocolObservers = new Set(), receive = [];
  let status = 'idle', reason = null, localMuid = randomMuid(), epoch = 1, execution = routes.allocateExecutionEpoch(), disposed = false, sendTail = Promise.resolve(), receiveRunning = false, receiveBytes = 0;
  let cancellation = null, cancellationExecution = null, cancellationError = null, receiveTail = Promise.resolve(), disposal = null, discovery = null, discoveryTimer = null, lastDiscoveryMs = -Infinity, collisions = [], lastVerifiedMs = null;
  const current = () => !disposed && status !== 'stale' && routes.isGrantActive(inputGrant) && routes.isGrantActive(outputGrant) && routes.client.session === initial.connectionEpoch && routes.input.scope(inputGrant)?.ingressEpoch === inputIdentity.ingressEpoch;
  const emit = () => { for (const listener of listeners) { try { listener(); } catch {} } };
  const clearPending = failure => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(failure); } pending.clear(); };
  const cancelOwnedExecution = value => {
    if (cancellationExecution === value && cancellation) return cancellation;
    cancellationExecution = value;
    cancellation = routes.client.session === initial.connectionEpoch && routes.isGrantActive(outputGrant) ? routes.client.cancelExecution(outputGrant, value).then(receipt => { if (receipt.kind !== 'cancelled-execution' || receipt.cleanupUnconfirmedNotes) throw new Error('MIDI-CI native cancellation remains unconfirmed'); }) : Promise.resolve();
    cancellation.catch(error => { cancellationError = error.message; }); return cancellation;
  };
  const stale = message => {
    if (disposed || status === 'stale') return; status = 'stale'; reason = message; epoch++; clearTimeout(discoveryTimer); discoveryTimer = null;
    discovery?.reject(new Error(message)); discovery = null; clearPending(new Error(message)); receive.length = receiveBytes = 0; void cancelOwnedExecution(execution); emit();
  };
  const send = (operation, { destinationMuid = BROADCAST, deviceScope = scope, parameters = [], sourceMuid = localMuid, isCurrent = () => true } = {}) => {
    const ownedEpoch = epoch, ownedExecution = execution;
    const task = sendTail.then(async () => {
      if (!current() || epoch !== ownedEpoch || !isCurrent()) throw new Error('MIDI-CI request or session retired');
      const encoded = await routes.client.encodeCi(outputGrant, { group, operation, sourceMuid, destinationMuid, scope: deviceScope, parameters });
      if (!current() || epoch !== ownedEpoch || !isCurrent()) throw new Error('MIDI-CI request or session retired');
      const maximum = Math.min(2048, destinationMuid === BROADCAST ? maximumMessageBytes : peers.get(destinationMuid)?.maximumMessageBytes ?? maximumMessageBytes);
      if (!Array.isArray(encoded.bytes) || encoded.bytes.length > maximum || !Array.isArray(encoded.words) || encoded.words.length > 1024) throw new Error('MIDI-CI message exceeds negotiated capacity');
      for (let offset = 0; offset < encoded.words.length; offset += 256) {
        if (!current() || epoch !== ownedEpoch || !isCurrent()) throw new Error('MIDI-CI request or session retired');
        const words = encoded.words.slice(offset, offset + 256), provenance = Object.freeze({ schema: 'lemmings-midi-ci-transaction/v1', sessionEpoch: ownedEpoch, operation, sourceMuid, destinationMuid, group, scope: deviceScope });
        let receipt;
        try { receipt = await routes.client.sendBatch({ grant: outputGrant, execution: ownedExecution, targetTimeMs: routes.client.now() + 10, priority: 2, words, provenance }); }
        catch (error) { routes.recordSubmission({ words, provenance, receipt: { session: initial.connectionEpoch, grant: outputGrant, execution: ownedExecution, kind: 'error', acceptedWords: 0, acceptedPackets: 0,
          failedPacketUnconfirmed: error.notSubmitted !== true, submissionExtent: error.notSubmitted === true ? 'observed-prefix' : 'unobserved-batch', reason: error.message } }); throw error; }
        routes.recordSubmission({ words, receipt, provenance });
        if (receipt.kind !== 'driver-submitted') throw Object.assign(new Error(receipt.reason || 'MIDI-CI submission failed'), { receipt });
      }
    });
    sendTail = task.catch(() => {}); return task;
  };
  const remember = message => {
    if (!message.identity || !Number.isSafeInteger(message.maximumMessageBytes) || message.maximumMessageBytes < 128 || message.sourceMuid >= 0x0fffff00) return;
    const prior = peers.get(message.sourceMuid);
    if (!prior && peers.size >= maximumPeers) { reason = 'MIDI-CI peer capacity'; emit(); return; }
    if (prior && identityKey(prior.identity) !== identityKey(message.identity)) {
      peers.set(message.sourceMuid, Object.freeze({ ...prior, state: 'stale', reason: 'peer-identity-changed-under-MUID' })); clearPending(new Error('MIDI-CI peer identity changed')); emit(); return;
    }
    const peer = Object.freeze({ muid: message.sourceMuid, identity: Object.freeze({ ...message.identity }), categories: message.categories, maximumMessageBytes: Math.min(2048, message.maximumMessageBytes),
      advertisedMaximumMessageBytes: message.maximumMessageBytes, functionBlock: message.functionBlock ?? null, outputPathId: message.outputPathId, version: message.version, state: 'discovered', lastVerifiedMs: now(),
      endpointInformation: prior?.endpointInformation ?? null, processFeatures: prior?.processFeatures ?? null });
    peers.set(peer.muid, peer); lastVerifiedMs = peer.lastVerifiedMs; emit();
  };
  const request = (peerMuid, operation, responseSubtype, parameters = [], deviceScope = scope) => {
    const peer = peers.get(peerMuid);
    if (!current() || peer?.state !== 'discovered' || now() - peer.lastVerifiedMs > 300000 || pending.size >= 8) return Promise.reject(new Error('Discover a current peer before requesting features'));
    const key = [peerMuid, responseSubtype, deviceScope].join(':'); if (pending.has(key)) return pending.get(key).completion;
    let resolve, reject; const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
    if ([...pending.values()].some(request => request.peerMuid === peerMuid)) return Promise.reject(new Error('Finish the current peer request first'));
    const entry = { completion, resolve, reject, peerMuid, responseSubtype, parameters: Object.freeze([...parameters]), transaction: operation === 'endpoint-inquiry' ? 114 : operation === 'process-inquiry' ? 64 : null, scope: deviceScope, epoch, timer: setTimeout(() => { if (pending.get(key) !== entry) return; pending.delete(key); reject(new Error('MIDI-CI request timed out; feature remains unknown')); }, timeoutMs) };
    pending.set(key, entry);
    send(operation, { destinationMuid: peerMuid, parameters, deviceScope, isCurrent: () => pending.get(key) === entry }).catch(error => { if (pending.get(key) === entry) { pending.delete(key); clearTimeout(entry.timer); entry.reject(error); } }); return completion;
  };
  const settleRequest = message => {
    const key = [message.sourceMuid, message.subtype, message.scope].join(':'), request = pending.get(key);
    if (!request || request.epoch !== epoch || message.destinationMuid !== localMuid || request.responseSubtype === 115 && message.status !== request.parameters[0]) return false;
    pending.delete(key); clearTimeout(request.timer); request.resolve(Object.freeze(message)); return true;
  };
  const discover = () => {
    if (!current() || status === 'stale') return Promise.reject(new Error('Reopen the MIDI-CI session after connection loss'));
    if (discovery) return discovery.completion;
    if (now() - lastDiscoveryMs < 2000) return Promise.reject(new Error('Wait before another MIDI-CI discovery'));
    lastDiscoveryMs = now(); status = 'discovering'; reason = null; peers.clear();
    let resolve, reject; const completion = new Promise((yes, no) => { resolve = yes; reject = no; }); const ownedDiscovery = discovery = { completion, resolve, reject, epoch };
    discoveryTimer = setTimeout(() => {
      if (discovery !== ownedDiscovery || ownedDiscovery.epoch !== epoch) return;
      const request = ownedDiscovery; discovery = null; discoveryTimer = null;
      status = peers.size ? 'discovered' : 'idle'; reason = peers.size ? null : 'No discovery reply in the bounded window'; emit(); request.resolve(Object.freeze([...peers.values()]));
    }, timeoutMs);
    send('discovery', { parameters: [maximumMessageBytes], deviceScope: 127, isCurrent: () => discovery === ownedDiscovery }).catch(error => { if (discovery !== ownedDiscovery || ownedDiscovery.epoch !== epoch) return; const request = discovery; discovery = null; clearTimeout(discoveryTimer); discoveryTimer = null; status = 'failed'; reason = error.message; emit(); request?.reject(error); });
    emit(); return completion;
  };
  const collision = async () => {
    const at = now(); collisions = collisions.filter(value => at - value < 60000); collisions.push(at);
    if (collisions.length > 3) { stale('Repeated MUID collision or MIDI loop; rediscovery stopped'); return; }
    const previousMuid = localMuid, previousExecution = execution; epoch++; clearTimeout(discoveryTimer); discoveryTimer = null;
    discovery?.reject(new Error('MUID changed during discovery')); discovery = null; clearPending(new Error('MUID changed'));
    localMuid = randomMuid(); execution = routes.allocateExecutionEpoch(); peers.clear(); status = 'idle'; lastDiscoveryMs = -Infinity;
    try { await cancelOwnedExecution(previousExecution); await send('invalidate', { sourceMuid: previousMuid, parameters: [previousMuid] }); if (current()) void discover().catch(error => { if (current()) { reason = error.message; emit(); } }); }
    catch (error) { stale(error.message); } emit();
  };
  const handle = async (message, messageGroup) => {
    if (![126, 127].includes(message.scope) && !(message.scope >= 0 && message.scope < 16) || message.sourceMuid === BROADCAST) return;
    if (!message.known || message.destinationMuid !== localMuid && message.destinationMuid !== BROADCAST) {
      for (const observer of protocolObservers) { try { observer(Object.freeze({ kind: message.known ? 'foreign-ci' : 'unknown-ci', message: Object.freeze(message), epoch, connectionEpoch: initial.connectionEpoch, inputGrant, group: messageGroup })); } catch {} }
      return;
    }
    if (message.sourceMuid === localMuid || message.subtype === 126 && message.targetMuid === localMuid) { await collision(); return; }
    for (const observer of protocolObservers) { try { observer(Object.freeze({ kind: 'ci', message: Object.freeze(message), epoch, connectionEpoch: initial.connectionEpoch, inputGrant, group: messageGroup })); } catch {} }
    if (messageGroup !== group) return;
    if (message.subtype === 112 || message.subtype === 113) {
      if (message.subtype === 113 && !discovery) return; remember(message);
      if (message.subtype === 112) await send('discovery-reply', { destinationMuid: message.sourceMuid, deviceScope: 127, parameters: [maximumMessageBytes, 127] });
    } else if (message.subtype === 126) {
      const peer = peers.get(message.targetMuid); if (peer) { peers.set(message.targetMuid, Object.freeze({ ...peer, state: 'stale', reason: 'peer-MUID-invalidated' })); clearPending(new Error('MIDI-CI peer invalidated')); emit(); }
    } else if (message.subtype === 115 || message.subtype === 65) {
      if (!settleRequest(message)) return;
      const peer = peers.get(message.sourceMuid); if (!peer) return;
      peers.set(message.sourceMuid, Object.freeze({ ...peer, ...(message.subtype === 115 ? { endpointInformation: Object.freeze({ status: message.status, data: Object.freeze([...message.informationData]) }) } : { processFeatures: message.supportedFeatures }), lastVerifiedMs: now() })); emit();
    } else if (message.subtype === 127) {
      for (const [key, request] of pending) if (request.peerMuid === message.sourceMuid && request.scope === message.scope && (message.version === 1 || message.transaction === request.transaction)) { pending.delete(key); clearTimeout(request.timer); request.reject(new Error('Device declined MIDI-CI request: ' + (message.message || 'NAK'))); }
    }
  };
  const drain = async () => {
    if (receiveRunning) return; receiveRunning = true;
    try {
      while (receive.length && current()) {
        const entry = receive.shift(); receiveBytes -= entry.bytes; const capturedEpoch = epoch;
        if (entry.observation) { for (const observer of protocolObservers) { try { observer(Object.freeze({ kind: 'observation', observation: entry.observation, epoch, connectionEpoch: initial.connectionEpoch, inputGrant, group })); } catch {} } continue; }
        try { const message = await routes.client.decodeCi(inputGrant, entry.payload); if (current() && capturedEpoch === epoch) await handle(message, entry.group); }
        catch (error) { if (current() && capturedEpoch === epoch) { reason = 'Malformed or unavailable MIDI-CI response: ' + error.message; for (const observer of protocolObservers) { try { observer(Object.freeze({ kind: 'malformed-ci', reason, epoch, connectionEpoch: initial.connectionEpoch, inputGrant, group: entry.group })); } catch {} } emit(); } }
      }
    } finally { receiveRunning = false; }
  };
  const unsubscribe = routes.input.subscribe(event => {
    if (event.grant !== inputGrant) return;
    if (event.event === 'ingress-loss') { stale(event.reason); return; }
    if (event.event !== 'native-payload' || event.message.kind !== 'sysex7' || !(input.groupMask & 1 << event.message.group) || event.message.payload[0] !== 126 || event.message.payload[2] !== 13) return;
    const payload = event.message.payload; if (payload.length > maximumMessageBytes || receive.length >= 2048 || receiveBytes + payload.length * 2 + 512 > 1048576) { stale('MIDI-CI receive capacity exceeded'); return; }
    const bytes = payload.length * 2 + 512; receive.push({ payload, bytes, group: event.message.group }); receiveBytes += bytes; if (!receiveRunning) receiveTail = drain();
  });
  return Object.freeze({
    discover, invalidate: stale,
    getPeer(muid) { const peer = peers.get(muid); return current() && peer?.state === 'discovered' && now() - peer.lastVerifiedMs <= 300000 ? peer : null; },
    sendReadControl(peerMuid, { operation, parameters = [], deviceScope = scope, isCurrent = () => true }) { const peer = peers.get(peerMuid); if (!current() || peer?.state !== 'discovered' || peer.version !== 2 || now() - peer.lastVerifiedMs > 300000 || !['message-report', 'profile-inquiry', 'profile-details'].includes(operation)) return Promise.reject(new Error('Unsupported or stale CI read operation')); const category = operation === 'message-report' ? 16 : 4; if (!(peer.categories & category)) return Promise.reject(new Error('Device did not advertise this CI category')); return send(operation, { destinationMuid: peerMuid, deviceScope, parameters, isCurrent }); },
    sendProfileControl(peerMuid, { operation, parameters = [], deviceScope = scope, isCurrent = () => true }) {
      const peer = peers.get(peerMuid);
      if (!current() || peer?.state !== 'discovered' || peer.version !== 2 || !(peer.categories & 4) || !['profile-on', 'profile-off'].includes(operation) || now() - peer.lastVerifiedMs > 300000) return Promise.reject(new Error('Unsupported or stale CI profile mutation'));
      return send(operation, { destinationMuid: peerMuid, parameters, deviceScope, isCurrent });
    },
    subscribeProtocol(observer) { if (disposed || typeof observer !== 'function' || protocolObservers.size >= 8) throw new Error('CI protocol observer capacity'); protocolObservers.add(observer); return () => protocolObservers.delete(observer); },
    enqueueObservation(observation) { if (!current() || receive.length >= 2048 || receiveBytes + 528 > 1048576) { stale('CI ordered observation queue exceeded'); return false; } receive.push({ observation, bytes: 528 }); receiveBytes += 528; if (!receiveRunning) receiveTail = drain(); return true; },
    endpointInformation: (peerMuid, status = 0) => request(peerMuid, 'endpoint-inquiry', 115, [status], 127),
    processCapabilities: peerMuid => request(peerMuid, 'process-inquiry', 65, [], 127),
    subscribe(listener) { if (disposed || typeof listener !== 'function' || listeners.size >= 8) throw new Error('MIDI-CI observer capacity'); listeners.add(listener); return () => listeners.delete(listener); },
    state: () => Object.freeze({ status, reason, connectionEpoch: initial.connectionEpoch, ingressEpoch: inputIdentity.ingressEpoch, epoch, inputGrant, outputGrant, group, scope, localMuid, advertisedCategories: 0,
      codec: 'pinned-ni-midi2-CI-v1.2', cancellationError, conformance: 'awaiting-consolidated-qualification-and-v1.2.1-errata-review', identityTier: 'non-commercial-development-id', lastVerifiedMs,
      peers: Object.freeze([...peers.values()].map(peer => Object.freeze({ ...peer, freshness: current() && now() - peer.lastVerifiedMs <= 300000 ? 'current' : 'stale' }))), pendingRequests: pending.size, pendingReceiveMessages: receive.length, pendingReceiveBytes: receiveBytes }),
    dispose() { if (disposal) return disposal; disposed = true; epoch++; unsubscribe(); clearTimeout(discoveryTimer); discoveryTimer = null; discovery?.reject(new Error('MIDI-CI session retired')); discovery = null; clearPending(new Error('MIDI-CI session retired')); receive.length = receiveBytes = 0; listeners.clear(); protocolObservers.clear(); status = 'disposed'; disposal = Promise.all([cancelOwnedExecution(execution), sendTail, receiveTail]).then(() => {}); return disposal; }
  });
}
