import { createDeviceMutationOwner } from './DeviceMutation.js';
import { createPropertyChunkTransfer } from './PropertyChunkTransfer.js';
import { PROPERTY_LIMITS, decodePropertyData, encodePropertyData, propertyJsonBytes } from './PropertyDataCodec.js';

const resourceName = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,36}$/.test(value);
const resourceId = value => value == null || typeof value === 'string' && /^[A-Za-z0-9_]{1,36}$/.test(value);
const subscriptionId = value => typeof value === 'string' && /^[a-z0-9_]{1,8}$/.test(value);
const result = (status, reason, extra = {}) => Object.freeze({ status, ...(reason ? { reason } : {}), ...extra });
export function createPropertyClient({ routes, ci, peerMuid, now = () => performance.now(), maximumConcurrent = 4 } = {}) {
  const identity = ci.state(), peer = ci.getPeer(peerMuid);
  if (!peer || peer.version !== 2 || !(peer.categories & 8) || routes.client.capabilities?.ciPropertyCodecVersion !== 1 ||
      !Number.isInteger(maximumConcurrent) || maximumConcurrent < 1 || maximumConcurrent > 4) throw new Error('Discover a current Property Exchange peer using a companion with PE decoding');
  const pending = new Map(), queue = [], resources = new Map(), cache = new Map(), subscriptions = new Map(), incoming = new Map(), retiredIds = new Set(), cooldown = new Map(), listeners = new Set();
  const mutation = createDeviceMutationOwner({ routes, ci, now });
  let disposed = false, stale = false, closing = false, disposal = null, capabilityRequest = null, capabilities = null, sequence = 0, cacheRevision = 0;
  const finishing = new Set(), refreshes = new Map(), refreshedAt = new Map(), ownerAbort = new AbortController();
  let descriptorRevision = null, preparingWrite = false;
  let subscriptionTail = Promise.resolve(), subscriptionJobs = 0, subscriptionQueueBytes = 0, queuedReceiveBytes = 0;
  let retainedCache = 0, retainedWire = 0, outgoingBytes = 0, latest = null, notifyWindow = now(), notifyCount = 0;
  const deviceRevision = () => routes.state().grants.find(row => row.grant === identity.outputGrant)?.deviceRevision ?? null;
  let observedDeviceRevision = deviceRevision();
  const current = () => !disposed && !stale && ci.state().epoch === identity.epoch && !!ci.getPeer(peerMuid);
  const emit = observation => { for (const listener of listeners) { try { listener(observation); } catch {} } };
  const cacheKey = ({ resource, resId = null, scope = null, offset = null, limit = null }) => JSON.stringify([resource, resId, scope, offset, limit]);
  const deleteCache = key => { const previous = cache.get(key); if (previous) { retainedCache -= previous.retainedEstimate; cache.delete(key); } };
  const staleResource = (resource, resId = null) => {
    for (const [key, record] of cache) if (record.resource === resource && (resId == null || record.resId === resId)) cache.set(key, Object.freeze({ ...record, stale: true }));
  };
  const save = (entry, header, decoded, origin = 'get-reply') => {
    const key = cacheKey(entry), estimate = decoded.retainedEstimate + 512, ttl = Number.isFinite(header.cacheTime) && header.cacheTime >= 0 ? Math.min(header.cacheTime * 1000, 300000) : 0;
    if (estimate > 2097152) throw new Error('Property cache entry capacity');
    deleteCache(key);
    while (cache.size >= 64 || retainedCache + estimate > 2097152) deleteCache(cache.keys().next().value);
    const record = Object.freeze({ schema: 'lemmings-property-observation/v1', resource: entry.resource, resId: entry.resId ?? null, scope: entry.scope ?? null,
      offset: entry.offset ?? null, limit: entry.limit ?? null, peerMuid, connectionEpoch: identity.connectionEpoch, ciEpoch: identity.epoch, deviceRevision: entry.deviceRevision,
      revision: ++cacheRevision, observedHostMs: now(), expiresHostMs: now() + ttl, stale: false, header, data: decoded.value, mediaType: decoded.mediaType,
      byteSize: decoded.byteSize, retainedEstimate: estimate, origin, interpretation: decoded.interpretation || 'read-only-device-json', externalReferences: 'never-fetched-or-executed' });
    cache.set(key, record); retainedCache += estimate; return record;
  };
  const sendChunk = (entry, subtype, index, total, header, bytes, isCurrent = () => true) =>
    ci.sendPropertyControl(peerMuid, { operation: 'pe-chunk', execution: entry.wireExecution ?? null, parameters: [subtype, entry.requestId, total, index, header.length, ...header, bytes.length, ...bytes],
      isCurrent: () => current() && isCurrent() });
  const sendStatus = (entry, subtype, code, data = 0, chunk = 0) => ci.sendPropertyControl(peerMuid, {
    operation: 'pe-status', parameters: [subtype, entry.subtype, code, data, entry.requestId, chunk & 127, chunk >> 7, 0, 0], isCurrent: current
  });
  const finish = (entry, outcome) => {
    if (pending.get(entry.requestId) !== entry && !queue.includes(entry)) return;
    pending.delete(entry.requestId); const queued = queue.indexOf(entry); if (queued >= 0) queue.splice(queued, 1);
    clearTimeout(entry.timer); entry.controller.abort(); entry.awaitAck?.resolve('cancelled'); entry.awaitAck = null;
    retainedWire -= entry.transfer.state().size; entry.transfer.clear(); outgoingBytes -= entry.body.length;
    queuedReceiveBytes -= entry.receiveBytes; entry.receiveBytes = 0; entry.receives.length = 0;
    if (outcome.status === 'ok') cooldown.set(entry.requestId, now() + 6000); else retiredIds.add(entry.requestId);
    latest = result(outcome.status, outcome.reason, { ...outcome, resource: entry.resource, resId: entry.resId, requestId: entry.requestId,
      connectionEpoch: identity.connectionEpoch, ciEpoch: identity.epoch, scope: entry.scope });
    const outcomeRecord = latest;
    const fence = (async () => {
      if (routes.client.session === identity.connectionEpoch && routes.isGrantActive(identity.outputGrant)) {
        try { const receipt = await routes.client.cancelExecution(identity.outputGrant, entry.wireExecution); if (receipt.kind !== 'cancelled-execution' || receipt.cleanupUnconfirmedNotes) throw new Error('Property control cancellation remains unconfirmed'); }
        catch (error) { routes.quarantineDeviceState(identity.outputGrant, error.message); entry.resolve(result('incomplete', error.message, { ...outcomeRecord, status: 'incomplete', reason: error.message, receiverState: 'unknown' })); return; }
      }
      entry.resolve(outcomeRecord);
    })(); finishing.add(fence); fence.finally(() => { finishing.delete(fence); emit(); }).catch(() => {}); emit(); queueMicrotask(pump);
  };
  const terminate = (entry, status, reason) => {
    if (pending.get(entry.requestId) === entry && current()) void sendStatus(entry, 127, 32, 1).catch(() => {});
    finish(entry, result(status, reason, { receiverState: entry.subtype === 54 ? 'unknown' : 'unchanged-by-read' }));
  };
  const arm = (entry, deadline = now() + 3000) => {
    if (pending.get(entry.requestId) !== entry) return;
    entry.deadline = Math.min(deadline, entry.started + 30000); clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (pending.get(entry.requestId) !== entry) return;
      if (entry.awaitAck && entry.retries < 3 && now() < entry.started + 30000) { const ack = entry.awaitAck; entry.awaitAck = null; entry.retries++; ack.resolve('retry'); }
      else terminate(entry, 'timeout', 'Property transaction exceeded its response, flow-control or absolute deadline');
    }, Math.max(1, entry.deadline - now()));
  };
  const sendEntry = async entry => {
    const header = propertyJsonBytes(entry.header, PROPERTY_LIMITS.headerBytes), maximum = Math.min(ci.getPeer(peerMuid)?.maximumMessageBytes || 128, 2048) - 24;
    if (header.length > maximum) throw new Error('Property header exceeds the peer message capacity');
    const firstCapacity = maximum - header.length, followingCapacity = maximum;
    const total = Math.max(1, 1 + Math.ceil(Math.max(0, entry.body.length - firstCapacity) / followingCapacity));
    if (total > PROPERTY_LIMITS.chunks || entry.body.length && firstCapacity < 1) throw new Error('Property chunk capacity');
    let offset = 0;
    for (let index = 1; index <= total; index++) {
      const bytes = entry.body.subarray(offset, offset + (index === 1 ? firstCapacity : followingCapacity)), headerBytes = index === 1 ? header : [];
      entry.retries = 0; let action;
      do {
        if (!current() || pending.get(entry.requestId) !== entry || !entry.isCurrent()) return;
        let ack = null;
        if (entry.flow && entry.subtype === 54 && index < total) {
          let resolve; const completion = new Promise(done => { resolve = done; }); ack = { chunk: index, resolve, completion }; entry.awaitAck = ack;
        }
        await sendChunk(entry, entry.subtype, index, total, headerBytes, bytes, () => pending.get(entry.requestId) === entry && entry.isCurrent());
        arm(entry);
        action = ack ? await ack.completion : 'next';
        if (action === 'cancelled') return;
      } while (action === 'retry' && entry.retries <= 3);
      offset += bytes.length;
    }
    arm(entry);
  };
  function pump() {
    if (!current() || !capabilities) return;
    const concurrency = Math.min(maximumConcurrent, capabilities.maximumRequests);
    while (queue.length && pending.size < concurrency) {
      const entry = queue.shift();
      if (!entry.isCurrent() || entry.deviceRevision !== deviceRevision()) { queue.unshift(entry); finish(entry, result('cancelled', 'Property selection or device revision changed')); continue; }
      pending.set(entry.requestId, entry); entry.started = now(); arm(entry);
      sendEntry(entry).catch(error => { if (pending.get(entry.requestId) === entry) terminate(entry, 'incomplete', error.message); });
    }
  }
  const enqueue = ({ subtype, header, body = new Uint8Array(), resource = header.resource, resId = header.resId ?? null, scope = null, offset = null, limit = null, isCurrent = () => true }) => {
    if (!current() || !capabilities || queue.length + pending.size >= 32 || outgoingBytes + body.length > 1048576) return Promise.resolve(result('rejected', 'Property request queue is stale or full'));
    let requestId = null;
    for (let count = 0; count < 128; count++) {
      const candidate = sequence++ % 128;
      if (!retiredIds.has(candidate) && !pending.has(candidate) && !queue.some(entry => entry.requestId === candidate) && (cooldown.get(candidate) || 0) <= now()) { requestId = candidate; break; }
    }
    if (requestId == null) return Promise.resolve(result('rejected', 'Property request IDs are quarantined; rediscover the peer before more requests'));
    let resolve; const completion = new Promise(done => { resolve = done; });
    const entry = { requestId, wireExecution: routes.allocateExecutionEpoch(), subtype, header, body, resource, resId, scope, offset, limit, resolve, isCurrent, completion,
      deviceRevision: deviceRevision(), transfer: createPropertyChunkTransfer(), controller: new AbortController(), receiving: false, receives: [], receiveBytes: 0, deadline: null, timer: null, retries: 0, awaitAck: null, flow: header.flowControl === true };
    queue.push(entry); outgoingBytes += body.length; pump(); emit(); return completion;
  };
  const prepare = (resource, options = {}, operation = 'get') => {
    const descriptor = resource === 'ResourceList' ? { resource, canGet: true, encodings: ['ASCII'], mediaTypes: ['application/json'] } : resources.get(resource);
    if (resource !== 'ResourceList' && descriptorRevision !== deviceRevision()) throw new Error('Reload the resource list after the device state change');
    if (!resourceName(resource) || !descriptor || !resourceId(options.resId) || descriptor.requireResId && options.resId == null) throw new Error('Choose an advertised resource and its required resource ID');
    if (operation === 'get' && descriptor.canGet === false || operation === 'set' && !['full', 'partial'].includes(descriptor.canSet) || operation === 'subscribe' && descriptor.canSubscribe !== true) throw new Error('Device did not permit this resource operation');
    if (options.isCurrent != null && typeof options.isCurrent !== 'function' || options.scope != null && (typeof options.scope !== 'string' || options.scope.length > 128)) throw new Error('Invalid property selection scope');
    const encoding = options.encoding || 'ASCII', mediaType = options.mediaType || 'application/json';
    if (!['ASCII', 'Mcoded7', 'zlib+Mcoded7'].includes(encoding) || !(descriptor.encodings || ['ASCII']).includes(encoding) || !(descriptor.mediaTypes || ['application/json']).includes(mediaType)) throw new Error('Resource did not advertise the selected encoding and media type');
    if (options.offset != null || options.limit != null) {
      if (!descriptor.canPaginate || !Number.isSafeInteger(options.offset) || options.offset < 0 || !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 256) throw new Error('Choose supported bounded resource pagination');
    }
    const header = { resource, ...(options.resId == null ? {} : { resId: options.resId }), mutualEncoding: encoding, ...(mediaType === 'application/json' ? {} : { mediaType }),
      ...(options.offset == null ? {} : { offset: options.offset, limit: options.limit }) };
    if (operation === 'get' && descriptor.fcOnGet === true || operation === 'set' && descriptor.fcOnSet === true) header.flowControl = true;
    return { descriptor, header, encoding, mediaType };
  };
  const installResources = value => {
    if (!Array.isArray(value) || value.length > 128) throw new Error('ResourceList must be a bounded resource array');
    const staged = new Map();
    for (const descriptor of value) {
      if (!descriptor || !resourceName(descriptor.resource) || staged.has(descriptor.resource) || descriptor.resource === 'ResourceList' ||
          descriptor.canGet != null && typeof descriptor.canGet !== 'boolean' || descriptor.canSet != null && !['none', 'full', 'partial'].includes(descriptor.canSet) ||
          descriptor.encodings && (!Array.isArray(descriptor.encodings) || descriptor.encodings.length > 8) ||
          descriptor.mediaTypes && (!Array.isArray(descriptor.mediaTypes) || descriptor.mediaTypes.length > 8)) throw new Error('Malformed resource capabilities');
      staged.set(descriptor.resource, descriptor);
    }
    resources.clear(); for (const row of staged) resources.set(...row); descriptorRevision = deviceRevision();
  };
  const consumeReply = async (entry, message) => {
    const before = entry.transfer.state().size;
    if (retainedWire + queuedReceiveBytes + subscriptionQueueBytes + message.propertyData.length > 1048576) throw new Error('Aggregate property receive capacity');
    const transfer = entry.transfer.accept(message); retainedWire += transfer.size - before; arm(entry);
    if (entry.flow && entry.subtype === 52 && !transfer.done) await sendStatus(entry, 125, 17, 0, message.chunkNumber);
    if (!transfer.done || pending.get(entry.requestId) !== entry) return;
    const header = transfer.header, status = header.status;
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error('Property reply status is missing or invalid');
    if (status < 200 || status >= 300) { finish(entry, result(status === 404 || status === 405 ? 'unsupported' : status === 343 ? 'busy' : 'rejected', header.message || 'Device property status ' + status, { header })); return; }
    if (status !== 200) { finish(entry, result('pending', 'Device accepted the transaction without guaranteeing its result', { header, receiverState: 'unknown' })); return; }
    if (entry.deviceRevision !== deviceRevision() || !entry.isCurrent()) { finish(entry, result('cancelled', 'Property reply belongs to an old device revision')); return; }
    if (header.mutualEncoding != null && header.mutualEncoding !== entry.header.mutualEncoding || header.mediaType != null && header.mediaType !== (entry.header.mediaType || 'application/json')) throw new Error('Property response changed negotiated encoding or media type');
    const decoded = transfer.bytes.length ? await decodePropertyData(transfer.bytes, { encoding: entry.header.mutualEncoding || 'ASCII', mediaType: entry.header.mediaType || 'application/json', signal: entry.controller.signal }) : null;
    if (!current() || pending.get(entry.requestId) !== entry || entry.deviceRevision !== deviceRevision() || !entry.isCurrent()) return;
    if (entry.flow && entry.subtype === 52) await sendStatus(entry, 125, 17, 0, message.chunkNumber);
    if (!current() || pending.get(entry.requestId) !== entry || entry.deviceRevision !== deviceRevision()) return;
    if (entry.subtype === 52) {
      if (!decoded) throw new Error('Property GET completed without data');
      if (entry.resource === 'ResourceList') installResources(decoded.value);
      const record = save(entry, header, decoded); finish(entry, result('ok', null, { record, header, receiverState: 'reported' }));
    } else if (entry.subtype === 54) {
      staleResource(entry.resource, entry.resId);
      finish(entry, result(status === 201 || status === 202 ? 'pending' : 'ok', status === 201 || status === 202 ? 'Device accepted the write without guaranteeing its applied state' : null, { header, receiverState: status === 201 || status === 202 ? 'unknown' : 'acknowledged-property-write' }));
    } else if (entry.header.command === 'start') {
      if (!subscriptionId(header.subscribeId) || subscriptions.has(header.subscribeId) || subscriptions.size >= 16) throw new Error('Invalid, duplicate or excessive subscription ID');
      const subscription = Object.freeze({ subscribeId: header.subscribeId, resource: entry.resource, resId: entry.resId, scope: entry.scope, encoding: entry.header.mutualEncoding, mediaType: entry.header.mediaType || 'application/json', deviceRevision: entry.deviceRevision, state: 'active' });
      subscriptions.set(header.subscribeId, subscription); finish(entry, result('ok', null, { subscription, header }));
    } else { subscriptions.delete(entry.header.subscribeId); finish(entry, result('ok', null, { header })); }
  };
  const subscriptionReply = (requestId, status) => {
    const header = propertyJsonBytes({ status }, PROPERTY_LIMITS.headerBytes);
    return sendChunk({ requestId }, 57, 1, 1, header, [], current);
  };
  const refreshSubscription = subscription => {
    const id = subscription.subscribeId;
    if (refreshes.has(id) || refreshes.size >= 16) return;
    refreshes.set(id, setTimeout(() => {
      refreshes.delete(id);
      if (!current() || subscriptions.get(id) !== subscription || subscription.deviceRevision !== deviceRevision()) return;
      refreshedAt.set(id, now());
      void api.get(subscription.resource, { resId: subscription.resId, scope: subscription.scope, encoding: subscription.encoding, mediaType: subscription.mediaType,
        isCurrent: () => subscriptions.get(id) === subscription && subscription.deviceRevision === deviceRevision() }).then(outcome => {
        if (current() && subscriptions.get(id) === subscription) emit(Object.freeze({ kind: 'property-subscription-refresh', subscription, outcome, record: outcome.record || null, observedHostMs: now() }));
      });
    }, Math.max(100, (refreshedAt.get(id) || 0) + 1000 - now())));
  };
  const consumeSubscription = async message => {
    const stamp = now(); if (stamp - notifyWindow >= 1000) { notifyWindow = stamp; notifyCount = 0; }
    if (++notifyCount > 64) throw new Error('Property subscription update rate exceeded');
    let transfer = incoming.get(message.requestId);
    if (!transfer) {
      if (incoming.size >= 8 || message.chunkNumber !== 1) throw new Error('Subscription transfer capacity or missing first chunk');
      transfer = { collector: createPropertyChunkTransfer(), timer: setTimeout(() => {
        if (incoming.get(message.requestId) !== transfer) return; incoming.delete(message.requestId); retainedWire -= transfer.collector.state().size; transfer.collector.clear(); void subscriptionReply(message.requestId, 408).catch(() => {});
      }, 3000) }; incoming.set(message.requestId, transfer);
    }
    const before = transfer.collector.state().size;
    if (retainedWire + message.propertyData.length > 1048576) throw new Error('Aggregate property receive capacity');
    const complete = transfer.collector.accept(message); retainedWire += complete.size - before;
    if (!complete.done) return;
    incoming.delete(message.requestId); clearTimeout(transfer.timer); retainedWire -= complete.size;
    const header = complete.header, subscription = subscriptions.get(header.subscribeId);
    if (!subscription || subscription.deviceRevision !== deviceRevision() || !['full', 'partial', 'notify', 'end'].includes(header.command)) { await subscriptionReply(message.requestId, 404); return; }
    if (header.command === 'end') { subscriptions.delete(header.subscribeId); await subscriptionReply(message.requestId, 200); emit(Object.freeze({ kind: 'subscription-ended', subscription, observedHostMs: now() })); return; }
    const decoded = complete.bytes.length ? await decodePropertyData(complete.bytes, { encoding: subscription.encoding, mediaType: subscription.mediaType, signal: ownerAbort.signal }) : null;
    if (!current() || subscriptions.get(header.subscribeId) !== subscription || subscription.deviceRevision !== deviceRevision()) return;
    staleResource(subscription.resource, subscription.resId);
    let record = null;
    if (header.command === 'full') { if (!decoded) throw new Error('Full subscription update has no data'); record = save(subscription, header, decoded, 'subscription-full'); }
    await subscriptionReply(message.requestId, 200);
    if (header.command === 'partial' || header.command === 'notify') refreshSubscription(subscription);
    emit(Object.freeze({ kind: 'property-subscription-observation', subscription, command: header.command, data: decoded?.value ?? null, record,
      origin: 'device-read-only-not-project-or-setter', observedHostMs: now(), header, partialRequiresRefresh: header.command === 'partial' }));
  };
  const invalidate = reason => {
    if (stale || disposed) return; stale = true; ownerAbort.abort();
    capabilityRequest?.finish(result('cancelled', reason));
    for (const entry of [...pending.values(), ...queue]) finish(entry, result('cancelled', reason));
    for (const transfer of incoming.values()) { clearTimeout(transfer.timer); transfer.collector.clear(); } incoming.clear(); retainedWire = 0;
    for (const timer of refreshes.values()) clearTimeout(timer); refreshes.clear(); refreshedAt.clear();
    subscriptions.clear(); resources.clear(); cache.clear(); retainedCache = 0; mutation.cancel(); latest = result('stale', reason); emit();
  };
  const receiveCost = message => 512 + (message.headerData.length + message.propertyData.length) * 8;
  const drainReply = entry => {
    if (entry.receiving) return; entry.receiving = true;
    void (async () => {
      while (entry.receives.length && pending.get(entry.requestId) === entry && current()) {
        const message = entry.receives.shift(), bytes = receiveCost(message); entry.receiveBytes -= bytes; queuedReceiveBytes -= bytes;
        await consumeReply(entry, message);
      }
    })().catch(error => terminate(entry, 'malformed', error.message)).finally(() => {
      entry.receiving = false;
      if (entry.receives.length && pending.get(entry.requestId) === entry && current()) queueMicrotask(() => drainReply(entry));
    });
  };
  const receive = event => {
    if (!current()) { invalidate('Property peer or CI epoch is stale'); return; }
    if (event.kind === 'malformed-ci') { for (const entry of [...pending.values()]) terminate(entry, 'malformed', event.reason); return; }
    if (event.kind !== 'ci' || event.epoch !== identity.epoch || event.group !== identity.group) return;
    const message = event.message;
    if (message.sourceMuid !== peerMuid || message.destinationMuid !== identity.localMuid || message.scope !== 127) return;
    if (message.subtype === 49) {
      if (capabilityRequest) capabilityRequest.finish(message.maximumRequests > 0 && message.peVersionMajor === 0 ?
        result('ok', null, { capabilities: Object.freeze({ maximumRequests: Math.min(maximumConcurrent, message.maximumRequests), advertisedMaximumRequests: message.maximumRequests, peVersionMajor: message.peVersionMajor, peVersionMinor: message.peVersionMinor, applicationRules: 'M2-103-v1.2' }) }) : result('unsupported', 'Device PE concurrency or major version is unsupported')); return;
    }
    if ([125, 127].includes(message.subtype)) {
      if (capabilityRequest && message.subtype === 127 && (message.version === 1 || message.transaction === 48)) { capabilityRequest.finish(result('unsupported', 'Device declined Property Exchange')); return; }
      const entry = pending.get(message.details?.[0]); if (!entry || message.transaction !== entry.subtype) return;
      if (message.subtype === 125 && message.statusCode === 16) { const extended = entry.deadline + message.statusData * 100; if (extended > entry.started + 30000) terminate(entry, 'timeout', 'Requested timeout extension exceeds the application deadline'); else arm(entry, extended); return; }
      const chunk = (message.details?.[1] || 0) | (message.details?.[2] || 0) << 7;
      if (message.subtype === 125 && message.statusCode === 17 && message.statusData === 0 && entry.awaitAck?.chunk === chunk) { const ack = entry.awaitAck; entry.awaitAck = null; ack.resolve('next'); arm(entry); }
      else if (message.subtype === 127 && message.statusCode === 18 && entry.awaitAck && chunk === entry.awaitAck.chunk - 1 && entry.retries < 3) { const ack = entry.awaitAck; entry.awaitAck = null; entry.retries++; ack.resolve('retry'); }
      else if (message.subtype === 127) terminate(entry, 'rejected', message.message || 'Device terminated the property transaction');
      return;
    }
    if (message.subtype === 56) {
      const bytes = receiveCost(message);
      if (subscriptionJobs >= 64 || subscriptionQueueBytes + queuedReceiveBytes + retainedWire + bytes > 1048576) { invalidate('Property subscription receive capacity'); return; }
      subscriptionJobs++; subscriptionQueueBytes += bytes;
      subscriptionTail = subscriptionTail.then(async () => { subscriptionJobs--; subscriptionQueueBytes -= bytes; if (current()) await consumeSubscription(message); }).catch(error => {
        for (const transfer of incoming.values()) { clearTimeout(transfer.timer); retainedWire -= transfer.collector.state().size; transfer.collector.clear(); } incoming.clear(); latest = result('malformed', error.message); if (current()) void subscriptionReply(message.requestId, 400).catch(() => {}); emit();
      }); return;
    }
    const entry = pending.get(message.requestId); if (!entry) return;
    if (message.subtype === 63) {
      try { const transfer = createPropertyChunkTransfer().accept(message); if (transfer.done && transfer.header.status === 144) terminate(entry, 'cancelled', 'Device terminated the property transaction'); else if (transfer.done && transfer.header.status === 100) arm(entry, entry.deadline + 3000); else if (transfer.done && transfer.header.status === 408) terminate(entry, 'timeout', 'Device reported a property timeout'); } catch (error) { terminate(entry, 'malformed', error.message); } return;
    }
    if (message.subtype !== ({ 52: 53, 54: 55, 56: 57 })[entry.subtype]) return;
    const bytes = receiveCost(message);
    if (entry.receives.length >= 512 || retainedWire + queuedReceiveBytes + subscriptionQueueBytes + bytes > 1048576) { terminate(entry, 'malformed', 'Property ordered receive queue capacity'); return; }
    entry.receives.push(message); entry.receiveBytes += bytes; queuedReceiveBytes += bytes; drainReply(entry);
  };
  const unsubscribeProtocol = ci.subscribeProtocol(receive), unsubscribeCi = ci.subscribe(() => { if (!current()) invalidate('Property peer or CI epoch changed'); }), unsubscribeMutation = mutation.subscribe(() => emit());
  const unsubscribeRoutes = routes.subscribe(() => {
    if (!current()) return;
    const revision = deviceRevision(); if (revision === observedDeviceRevision) return; observedDeviceRevision = revision;
    for (const entry of [...pending.values(), ...queue]) if (entry.deviceRevision !== revision) finish(entry, result('cancelled', 'Device state changed during property request'));
    for (const [key, record] of cache) cache.set(key, Object.freeze({ ...record, stale: true })); emit();
  });
  const expiryTimer = setInterval(() => { if (!current()) invalidate('Property evidence expired'); }, 1000); expiryTimer.unref?.();
  const api = Object.freeze({
    negotiate() {
      if (!current() || closing) return Promise.resolve(result('stale', 'Property client is retired'));
      if (capabilities) return Promise.resolve(result('ok', null, { capabilities }));
      if (capabilityRequest) return capabilityRequest.completion;
      let resolve; const completion = new Promise(done => { resolve = done; });
      const request = { completion, timer: null, finish(outcome) { if (capabilityRequest !== request) return; clearTimeout(request.timer); capabilityRequest = null; if (outcome.status === 'ok') capabilities = outcome.capabilities; latest = outcome; resolve(outcome); emit(); pump(); } };
      capabilityRequest = request; request.timer = setTimeout(() => request.finish(result('timeout', 'Property capability inquiry timed out')), 3000);
      ci.sendPropertyControl(peerMuid, { operation: 'pe-capabilities', parameters: [maximumConcurrent], isCurrent: () => capabilityRequest === request && current() }).catch(error => request.finish(result('incomplete', error.message)));
      return completion;
    },
    async discoverResources() { const negotiation = await api.negotiate(); return negotiation.status === 'ok' ? api.get('ResourceList') : negotiation; },
    get(resource, options = {}) {
      try { if (closing) throw new Error('Property client is closing'); const prepared = prepare(resource, options); return enqueue({ subtype: 52, header: prepared.header, resource, resId: options.resId, scope: options.scope, offset: options.offset, limit: options.limit, isCurrent: options.isCurrent }); }
      catch (error) { return Promise.resolve(result('unsupported', error.message)); }
    },
    async set(resource, value, options = {}) {
      if (preparingWrite || mutation.state().busy) return result('rejected', 'Finish the current device write before preparing another');
      preparingWrite = true;
      try {
        if (closing) throw new Error('Property client is closing'); const prepared = prepare(resource, options, 'set');
        if (options.partial === true) { if (prepared.descriptor.canSet !== 'partial') throw new Error('Resource did not permit partial writes'); prepared.header.setPartial = true; }
        const body = await encodePropertyData(value, { encoding: prepared.encoding, binary: prepared.mediaType !== 'application/json', signal: options.signal });
        return await mutation.run({ confirmed: options.confirmed, requested: { kind: 'property-set', resource, resId: options.resId ?? null, mediaType: prepared.mediaType, byteSize: body.length, partial: options.partial === true },
          isCurrent: () => current() && !closing && (options.isCurrent?.() ?? true),
          send: isCurrent => enqueue({ subtype: 54, header: prepared.header, body, resource, resId: options.resId, scope: options.scope, isCurrent }) });
      } catch (error) { return result('rejected', error.message, { receiverState: 'unchanged-before-admission' }); }
      finally { preparingWrite = false; emit(); }
    },
    subscribe(resource, options = {}) {
      try { if (closing || subscriptions.size >= 16) throw new Error('Property subscriptions are closing or full'); const prepared = prepare(resource, options, 'subscribe'); return enqueue({ subtype: 56, header: { ...prepared.header, command: 'start' }, resource, resId: options.resId, scope: options.scope, isCurrent: options.isCurrent }); }
      catch (error) { return Promise.resolve(result('unsupported', error.message)); }
    },
    unsubscribe(subscribeId) {
      const subscription = subscriptions.get(subscribeId); if (!subscription) return Promise.resolve(result('ok', null, { alreadyEnded: true }));
      if (!current()) { subscriptions.delete(subscribeId); return Promise.resolve(result('stale', 'Subscription peer is stale')); }
      return enqueue({ subtype: 56, header: { command: 'end', subscribeId, endedBy: 'initiator' }, resource: subscription.resource, resId: subscription.resId, scope: subscription.scope });
    },
    cancelResource(resource, resId = null) { for (const entry of [...pending.values(), ...queue]) if (entry.resource === resource && (resId == null || entry.resId === resId)) terminate(entry, 'cancelled', 'Resource selection changed'); },
    cancel() { for (const entry of [...pending.values(), ...queue]) terminate(entry, 'cancelled', 'Property request cancelled'); mutation.cancel(); },
    cached(resource, options = {}) { const record = cache.get(cacheKey({ resource, ...options })); return record ? Object.freeze({ ...record, stale: record.stale || record.deviceRevision !== deviceRevision() || !current() || now() >= record.expiresHostMs }) : null; },
    state: () => Object.freeze({ disposed, stale, closing, peerMuid, inputGrant: identity.inputGrant, outputGrant: identity.outputGrant, connectionEpoch: identity.connectionEpoch, ciEpoch: identity.epoch, capabilities,
      pendingRequests: pending.size, settlingRequests: finishing.size, queuedRequests: queue.length, retainedWireBytes: retainedWire, queuedReceiveBytes, subscriptionQueueBytes, subscriptionJobs, outgoingBytes, retainedCacheEstimate: retainedCache, cacheEntries: cache.size, quarantinedRequestIds: retiredIds.size,
      resourcesStale: descriptorRevision !== deviceRevision(), resources: Object.freeze([...resources.values()]), subscriptions: Object.freeze([...subscriptions.values()]), preparingWrite, refreshes: refreshes.size, mutation: mutation.state(), latest }),
    subscribeObservations(listener) { if (disposed || listeners.size >= 8 || typeof listener !== 'function') throw new Error('Property observer capacity'); listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      if (disposal) return disposal; closing = true; api.cancel();
      disposal = (async () => {
        if (current()) await Promise.allSettled([...subscriptions.keys()].map(id => api.unsubscribe(id)));
        await Promise.allSettled([...finishing]); disposed = true; ownerAbort.abort(); await subscriptionTail; clearInterval(expiryTimer); capabilityRequest?.finish(result('cancelled', 'Property client retired')); mutation.dispose();
        unsubscribeProtocol(); unsubscribeCi(); unsubscribeRoutes(); unsubscribeMutation(); for (const timer of refreshes.values()) clearTimeout(timer); refreshes.clear(); refreshedAt.clear();
        for (const transfer of incoming.values()) { clearTimeout(transfer.timer); transfer.collector.clear(); } incoming.clear(); subscriptions.clear(); resources.clear(); cache.clear(); retainedCache = retainedWire = 0; listeners.clear();
      })(); return disposal;
    }
  });
  return api;
}
