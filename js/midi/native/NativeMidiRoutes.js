import { createDevicePatchCatalog } from './DevicePatchCatalog.js';
import { createPropertyClient } from './PropertyClient.js';
import { createMpeProfileBinding } from './MpeProfileAdapter.js';
import { createProfileSession } from './ProfileSession.js';
import { createMidiMessageReportSession } from './MidiMessageReportSession.js';
import { createMidiCiSession } from './MidiCiSession.js';
import { createNativeMidiIngress } from './NativeMidiIngress.js';
import { UMP_WORD_COUNTS } from '../protocol/UmpPacketCodec.js';
import { NativeMidiBridgeClient } from './NativeMidiBridgeClient.js';

export function createNativeMidiRoutes({ client = new NativeMidiBridgeClient(), onTrace = () => {}, canObserveInput = () => true } = {}) {
  const ingress = createNativeMidiIngress();
  const patchCatalogs = new Map(), patchClaims = new Map(), propertyClients = new Map(), profileClaims = new Map(), profileSessions = new Map(), deviceInvalidations = new Map();
  const reportSessions = new Map(), performanceOwners = new Set(), observationHolds = new Map(), ciSessions = new Set(), grants = new Map(), routes = new Map(), listeners = new Set(), trace = [];
  let disposal = null, notificationPending = false, executionSequence = 0, revision = 0, traceWords = 0, omittedTrace = 0, disposed = false, inventory = null;
  const notify = () => { revision++; if (notificationPending) return; notificationPending = true; queueMicrotask(() => { notificationPending = false; if (disposed) return; for (const listener of listeners) { try { listener(); } catch {} } }); };
  const current = route => route && (!patchClaims.has(route.outputId) || patchClaims.get(route.outputId).current()) && (!profileClaims.has(route.outputId) || profileClaims.get(route.outputId).current()) && grants.has(route.grant) && route.connectionEpoch === client.session && route.deviceRevision === grants.get(route.grant)?.deviceRevision && client.state === 'connected';
  const descriptor = (receipt, endpoint = null) => Object.freeze({ ...receipt, deviceRevision: 0, logicalDestination: globalThis.crypto.randomUUID(), endpoint, connectionEpoch: client.session });
  const unsubscribeInput = ingress.subscribe(event => { for (const listener of listeners) { try { listener(event); } catch {} } });
  const unsubscribe = client.subscribe(event => {
    if (event.event === 'grant-retired') { ingress.revoke(event.grant, event.reason); grants.delete(event.grant); for (const session of ciSessions) if (session.state().outputGrant === event.grant) session.invalidate(event.reason || 'CI output grant retired'); notify(); }
    else if (event.event === 'state' && event.state === 'disconnected') { ingress.clearGrants(); grants.clear(); inventory = null; notify(); }
    else if (event.event === 'ports-changed') { inventory = null; notify(); }
    else if (event.event === 'ingress') ingress.acceptColumns(event);
    else if (event.event === 'ingress-loss') ingress.markLoss(event);
    else if (event.event === 'receipt' && event.kind === 'heartbeat') ingress.poll();
  });
  const bind = ({ laneId, grant, group, channel, protocol = 'midi2', sharing = 'dedicated' }) => {
    const owner = grants.get(grant);
    if (deviceInvalidations.has(grant)) throw new Error('Device state retirement remains unconfirmed');
    if (!owner || owner.direction !== 'output' || owner.connectionEpoch !== client.session || !Number.isInteger(group) || group < 0 || group > 15 || !(owner.groupMask & 1 << group) ||
        !Number.isInteger(channel) || channel < 0 || channel > 15 || !['midi2', 'midi1-in-ump'].includes(protocol) || !['dedicated', 'shared-ensemble'].includes(sharing) || typeof laneId !== 'string' || !laneId) throw new Error('Choose a current output grant, group, channel and protocol');
    if (routes.size >= 1024) throw new Error('Native route capacity; revoke unused connections');
    const outputId = 'native-midi:' + owner.logicalDestination + ':' + group + ':' + channel;
    for (const [id, claim] of profileClaims) if (id !== outputId && claim.grant === grant && claim.current() && claim.binding.addresses.some(address => address.group === group && address.channel === channel)) throw new Error('Channel is reserved by an active CI MPE allocation');
    if (profileClaims.has(outputId) && [...performanceOwners].some(owner => owner.isQuiescent(grant) !== true)) throw new Error('Stop owned notes before replacing a profile route');
    profileClaims.delete(outputId); patchClaims.delete(outputId);
    const previous = routes.get(outputId);
    if (previous && previous.protocol !== protocol) throw new Error('An active native address cannot mix channel protocols');
    if (previous && previous.laneIds.some(id => id !== laneId) && (previous.sharing !== 'shared-ensemble' || sharing !== 'shared-ensemble')) throw new Error('Native channel belongs to another lane; choose sharing explicitly');
    const laneIds = Object.freeze([...new Set([...(previous?.laneIds || []), laneId])]);
    const route = Object.freeze({ outputId, grant, connectionEpoch: owner.connectionEpoch, routeRevision: ++revision, logicalDestination: owner.logicalDestination, deviceRevision: owner.deviceRevision, group, channel, protocol, sharing, laneIds,
      receiverProtocol: 'unverified', transport: 'native-ump', independentSamePitchVoices: false });
    routes.set(outputId, route); notify(); return route;
  };
  const api = Object.freeze({
    client, input: ingress,
    registerPerformanceOwner(owner) { if (disposed || performanceOwners.size >= 8 || typeof owner?.isQuiescent !== 'function') throw new Error('Native performance owner capacity'); performanceOwners.add(owner); return () => performanceOwners.delete(owner); },
    allowsPerformance(grant) { return !disposed && !observationHolds.has(grant) && !deviceInvalidations.has(grant); },
    allowsOrdinaryInput() { return !disposed && observationHolds.size === 0; },
    holdForObservation(grant) { if (canObserveInput() !== true) throw new Error('Disconnect the ordinary MIDI input before reading isolated device state'); if (disposed || !grants.has(grant) || observationHolds.has(grant) || deviceInvalidations.has(grant) || [...performanceOwners].some(owner => owner.isQuiescent(grant) !== true)) throw new Error('Stop native performance and wait for owned notes before reading device state'); const token = Object.freeze({ grant, connectionEpoch: client.session }); observationHolds.set(grant, token); return token; },
    releaseObservation(token) { if (observationHolds.get(token?.grant) !== token) return false; observationHolds.delete(token.grant); return true; },
    quarantineDeviceState(grant, reason) { const owner = grants.get(grant); if (!owner) return; const failure = Promise.reject(new Error(reason)); failure.catch(() => {}); deviceInvalidations.set(grant, failure); grants.set(grant, Object.freeze({ ...owner, deviceRevision: owner.deviceRevision + 1, deviceStateReason: reason })); notify(); },
    invalidateDeviceState(grant, reason) {
      if (deviceInvalidations.has(grant)) return deviceInvalidations.get(grant);
      const owner = grants.get(grant); if (!owner) return;
      grants.set(grant, Object.freeze({ ...owner, deviceRevision: owner.deviceRevision + 1, deviceStateReason: reason }));
      for (const report of reportSessions.values()) report.invalidateOutput(grant, reason);
      if (reason.includes('program-recall') || reason.includes('property-set')) for (const peers of profileSessions.values()) for (const profile of peers.values()) if (profile.state().outputGrant === grant) profile.invalidateEvidence(reason);
      notify();
      const completion = Promise.allSettled([...performanceOwners].map(owner => owner.invalidateGrant?.(grant))).then(settled => {
        const failures = settled.filter(row => row.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(row => row.reason), 'Owned native notes could not be confirmed retired');
        deviceInvalidations.delete(grant); notify();
      }); deviceInvalidations.set(grant, completion); return completion;
    },
    isGrantActive(grant) { return !disposed && grants.get(grant)?.connectionEpoch === client.session; },
    createCiSession(options) {
      if (disposed || !client.capabilities?.ciCodec) throw new Error('Build and pair a companion with the MIDI-CI codec');
      for (const session of ciSessions) { const state = session.state(); if (state.inputGrant === options.inputGrant && state.status !== 'disposed') { if (state.outputGrant === options.outputGrant && state.group === options.group) return session; throw new Error('Close the existing CI session before changing its input scope'); } }
      if (ciSessions.size >= 8) throw new Error('MIDI-CI session capacity');
      const session = createMidiCiSession({ routes: api, ...options }); ciSessions.add(session); return session;
    },
    createDevicePatchCatalog(ci, peerMuid) {
      if (disposed || !ciSessions.has(ci)) throw new Error('An owned CI session is required');
      const peers = patchCatalogs.get(ci) || new Map(); if (peers.has(peerMuid)) return peers.get(peerMuid);
      if ([...patchCatalogs.values()].reduce((count, peers) => count + peers.size, 0) >= 8) throw new Error('Device patch catalog capacity');
      const catalog = createDevicePatchCatalog({ routes: api, ci, peerMuid, properties: api.createPropertyClient(ci, peerMuid) }); peers.set(peerMuid, catalog); patchCatalogs.set(ci, peers); return catalog;
    },
    createPropertyClient(ci, peerMuid) {
      if (disposed || !ciSessions.has(ci)) throw new Error('An owned CI session is required');
      const peers = propertyClients.get(ci) || new Map(), existing = peers.get(peerMuid);
      if (existing && !existing.state().stale && !existing.state().disposed) return existing;
      if (existing) { void existing.dispose().catch(() => {}); peers.delete(peerMuid); }
      if ([...propertyClients.values()].reduce((count, peers) => count + peers.size, 0) >= 8) throw new Error('Property client peer capacity');
      const client = createPropertyClient({ routes: api, ci, peerMuid }); peers.set(peerMuid, client); propertyClients.set(ci, peers); return client;
    },
    createProfileSession(ci, peerMuid) {
      if (disposed || !ciSessions.has(ci)) throw new Error('An owned CI session is required');
      const scopes = profileSessions.get(ci) || new Map();
      if (scopes.has(peerMuid)) { const existing = scopes.get(peerMuid); if (!existing.state().stale && !existing.state().disposed) return existing; existing.dispose(); scopes.delete(peerMuid); }
      if (scopes.size >= 8) throw new Error('Profile peer capacity');
      const session = createProfileSession({ routes: api, ci, peerMuid }); scopes.set(peerMuid, session); profileSessions.set(ci, scopes); return session;
    },
    createMessageReportSession(ci) { if (disposed || !ciSessions.has(ci)) throw new Error('An owned CI session is required'); if (reportSessions.has(ci)) return reportSessions.get(ci); if (reportSessions.size >= 8) throw new Error('Device report session capacity'); const report = createMidiMessageReportSession({ routes: api, ci }); reportSessions.set(ci, report); return report; },
    async closeCiSession(session) { if (!ciSessions.has(session)) return; await Promise.allSettled([...(patchCatalogs.get(session)?.values() || [])].map(catalog => catalog.dispose())); patchCatalogs.delete(session); const properties = await Promise.allSettled([...(propertyClients.get(session)?.values() || [])].map(client => client.dispose())); propertyClients.delete(session); await Promise.allSettled([...(profileSessions.get(session)?.values() || [])].map(profile => profile.dispose())); profileSessions.delete(session); reportSessions.get(session)?.dispose(); reportSessions.delete(session); await session.dispose(); ciSessions.delete(session); const failures = properties.filter(row => row.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(row => row.reason), 'Property subscription retirement is unconfirmed'); },

    allocateExecutionEpoch() { if (disposed || executionSequence >= 0xffffffff) throw new Error('Native execution identity exhausted'); return ++executionSequence; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async connect(options) { if (disposed) throw new Error('Native routing owner retired'); await client.connect(options); notify(); return client.capabilities; },
    async enumerate() { const result = await client.enumerate(); if (disposed) throw new Error('Native routing owner retired'); inventory = result; notify(); return result; },
    async open(options) {
      if (disposed || !inventory || inventory.inventoryEpoch !== options.inventoryEpoch) throw new Error('Refresh and select a current native endpoint');
      const endpoint = inventory.endpoints.find(row => row.endpointToken === options.endpointToken);
      if (!endpoint) throw new Error('Select a native endpoint');
      const receipt = await client.open(options);
      if (disposed || receipt.connectionEpoch != null && receipt.connectionEpoch !== client.session) throw new Error('Native route owner retired');
      if (receipt.direction === 'input') ingress.register(receipt);
      grants.set(receipt.grant, descriptor(receipt, endpoint)); notify(); return grants.get(receipt.grant);
    },
    async publish(options) { if (disposed) throw new Error('Native routing owner retired'); const receipt = await client.publish(options); if (disposed) throw new Error('Native route owner retired'); if (receipt.direction === 'input') ingress.register(receipt); grants.set(receipt.grant, descriptor(receipt)); notify(); return grants.get(receipt.grant); },
    bind,
    bindDevicePatch({ laneId, catalog, receipt }) {
      if (![...patchCatalogs.values()].some(peers => [...peers.values()].includes(catalog)) || !catalog.isReceiptCurrent(receipt)) throw new Error('Recall and confirm the patch on this current device first');
      const grant = receipt.outputGrant, target = receipt.target, owner = grants.get(grant);
      if (!owner || [...performanceOwners].some(owner => owner.isQuiescent(grant) !== true)) throw new Error('Stop owned notes before binding a hardware patch');
      const outputId = 'native-midi:' + owner.logicalDestination + ':' + target.group + ':' + target.channel, previous = routes.get(outputId);
      if (previous?.mpe && !current(previous)) throw new Error('Patch recalled; review and rebind the accepted MPE profile before assigning this patch');
      if (previous?.mpe && (!previous.laneIds.includes(laneId) || previous.protocol !== target.protocol)) throw new Error('Choose the explicitly bound MPE lane and protocol');
      const base = previous?.mpe ? previous : bind({ laneId, grant, group: target.group, channel: target.channel, protocol: target.protocol });
      const route = Object.freeze({ ...base, routeRevision: ++revision, patchBinding: Object.freeze({ intent: receipt.intent, receiverState: receipt.receiverState, target, reported: receipt.reported }) });
      patchClaims.set(outputId, { current: () => catalog.isReceiptCurrent(receipt) }); routes.set(outputId, route); notify(); return route;
    },
    bindMpe({ laneId, session, profile, scope, protocol = 'midi2', pressureForm = 'classic', thirdAxisForm = 'classic' }) {
      if (![...profileSessions.values()].some(peers => [...peers.values()].includes(session))) throw new Error('Choose an owned profile session');
      const record = session.binding(profile, scope), grant = session.state().outputGrant, owner = grants.get(grant);
      if (!owner || [...performanceOwners].some(owner => owner.isQuiescent(grant) !== true)) throw new Error('Stop owned notes before binding an MPE allocation');
      const binding = createMpeProfileBinding(record, { groupMask: owner.groupMask, protocol, pressureForm, thirdAxisForm });
      const outputId = 'native-midi:' + owner.logicalDestination + ':' + binding.manager.group + ':' + binding.manager.channel;
      for (const route of routes.values()) if (route.outputId !== outputId && route.grant === grant && current(route) &&
          (route.mpe?.addresses || [route]).some(used => binding.addresses.some(address => address.group === used.group && address.channel === used.channel))) throw new Error('Accepted MPE allocation overlaps an active application route');
      const base = bind({ laneId, grant, group: binding.manager.group, channel: binding.manager.channel, protocol });
      const route = Object.freeze({ ...base, expressionMode: 'ci-mpe-profile', mpe: binding, independentSamePitchVoices: true });
      profileClaims.set(outputId, { grant, binding, current: () => session.isBindingCurrent(binding) }); routes.set(outputId, route); notify(); return route;
    },
    allocateDedicated(laneIds, { grant, protocol = 'midi2' }) {
      const owner = grants.get(grant); if (!owner || owner.direction !== 'output' || !Array.isArray(laneIds) || laneIds.length > 1024 || new Set(laneIds).size !== laneIds.length) throw new Error('Invalid native lane allocation');
      const addresses = [];
      for (let group = 0; group < 16; group++) if (owner.groupMask & 1 << group) for (let channel = 0; channel < 16; channel++) {
        const id = 'native-midi:' + owner.logicalDestination + ':' + group + ':' + channel;
        if (!routes.has(id)) addresses.push({ group, channel });
      }
      return Object.freeze(laneIds.map(laneId => {
        const previous = [...routes.values()].find(route => route.grant === grant && route.laneIds.includes(laneId));
        if (previous) return Object.freeze({ laneId, status: 'assigned', route: previous });
        const address = addresses.shift(); return address ? Object.freeze({ laneId, status: 'assigned', route: bind({ laneId, grant, protocol, ...address }) }) :
          Object.freeze({ laneId, status: 'local-only', reason: 'native-channel-capacity', outputId: 'native-midi:unassigned:' + owner.logicalDestination + ':' + laneId });
      }));
    },
    resolve(outputId, laneId = null) { const route = routes.get(outputId); return current(route) && (laneId == null || route.laneIds.includes(laneId)) ? route : null; },
    enabled() { return !disposed && [...routes.values()].some(current); },
    state() { return Object.freeze({ state: client.state, connectionEpoch: client.session, revision, inventory, grants: Object.freeze([...grants.values()]), routes: Object.freeze([...routes.values()].map(route => Object.freeze({ ...route, active: !!current(route) }))),
      clock: client.clockStatus(), ingress: ingress.state(), traceRecords: trace.length, traceWords, omittedTrace }); },
    recordSubmission({ words, receipt, provenance }) {
      const retained = Object.freeze({ connectionEpoch: receipt.session, grant: receipt.grant, execution: receipt.execution, receipt: Object.freeze({ ...receipt }), provenance,
        words: Object.freeze(words.slice(0, receipt.acceptedWords || 0)), unconfirmedWords: receipt.submissionExtent === 'unobserved-batch' ? Object.freeze([...words]) : null, unconfirmedPacket: receipt.failedPacketUnconfirmed && receipt.submissionExtent !== 'unobserved-batch' ? Object.freeze(words.slice(receipt.failureWordOffset, receipt.failureWordOffset + UMP_WORD_COUNTS[words[receipt.failureWordOffset] >>> 28])) : null });
      traceWords += retained.words.length + (retained.unconfirmedPacket?.length || 0) + (retained.unconfirmedWords?.length || 0); trace.push(retained);
      while (trace.length > 4096 || traceWords > 65536) { const oldest = trace.shift(); traceWords -= oldest.words.length + (oldest.unconfirmedPacket?.length || 0) + (oldest.unconfirmedWords?.length || 0); omittedTrace++; }
      try { onTrace(retained); } catch {} return retained;
    },
    wireTrace() { return Object.freeze({ schema: 'lemmings-native-wire-trace/v1', claim: 'native-driver-submitted-prefix-not-receiver-or-acoustic', omittedRecords: omittedTrace, records: Object.freeze([...trace]) }); },
    async closeGrant(grant) { const receipt = await client.closeGrant(grant); if (receipt.nativeCloseConfirmed !== true || receipt.cleanupUnconfirmedNotes) throw new Error('Native closure or owned-note cleanup is unconfirmed'); grants.delete(grant); for (const [id, route] of routes) if (route.grant === grant) { routes.delete(id); profileClaims.delete(id); patchClaims.delete(id); } notify(); return receipt; },
    disconnect() { client.disconnect(); ingress.clearGrants(); grants.clear(); inventory = null; notify(); },
    dispose() { if (disposal) return disposal; disposed = true; unsubscribe(); unsubscribeInput(); for (const scopes of profileSessions.values()) for (const profile of scopes.values()) profile.dispose(); profileSessions.clear(); for (const report of reportSessions.values()) report.dispose(); reportSessions.clear(); ingress.dispose(); disposal = (async () => { const patches = await Promise.allSettled([...patchCatalogs.values()].flatMap(peers => [...peers.values()]).map(catalog => catalog.dispose())); patchCatalogs.clear(); const properties = await Promise.allSettled([...propertyClients.values()].flatMap(peers => [...peers.values()]).map(client => client.dispose())); propertyClients.clear(); const ci = await Promise.allSettled([...ciSessions].map(session => session.dispose())); const devices = await Promise.allSettled([...grants.keys()].map(async grant => { const receipt = await client.closeGrant(grant); if (receipt.nativeCloseConfirmed !== true || receipt.cleanupUnconfirmedNotes) throw new Error('Native closure or cleanup remains unconfirmed'); })); client.disconnect(); const failures = [...patches, ...properties, ...ci, ...devices].filter(result => result.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Native MIDI retirement has ' + failures.length + ' unconfirmed resources'); ciSessions.clear(); grants.clear(); routes.clear(); profileClaims.clear(); patchClaims.clear(); listeners.clear(); trace.length = traceWords = 0; })(); return disposal; }
  });
  return api;
}
