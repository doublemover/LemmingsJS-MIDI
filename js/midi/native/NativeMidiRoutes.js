import { createMidiMessageReportSession } from './MidiMessageReportSession.js';
import { createMidiCiSession } from './MidiCiSession.js';
import { createNativeMidiIngress } from './NativeMidiIngress.js';
import { UMP_WORD_COUNTS } from '../protocol/UmpPacketCodec.js';
import { NativeMidiBridgeClient } from './NativeMidiBridgeClient.js';

export function createNativeMidiRoutes({ client = new NativeMidiBridgeClient(), onTrace = () => {}, canObserveInput = () => true } = {}) {
  const ingress = createNativeMidiIngress();
  const reportSessions = new Map(), performanceOwners = new Set(), observationHolds = new Map(), ciSessions = new Set(), grants = new Map(), routes = new Map(), listeners = new Set(), trace = [];
  let disposal = null, notificationPending = false, executionSequence = 0, revision = 0, traceWords = 0, omittedTrace = 0, disposed = false, inventory = null;
  const notify = () => { revision++; if (notificationPending) return; notificationPending = true; queueMicrotask(() => { notificationPending = false; if (disposed) return; for (const listener of listeners) { try { listener(); } catch {} } }); };
  const current = route => route && grants.has(route.grant) && route.connectionEpoch === client.session && client.state === 'connected';
  const descriptor = (receipt, endpoint = null) => Object.freeze({ ...receipt, logicalDestination: globalThis.crypto.randomUUID(), endpoint, connectionEpoch: client.session });
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
    if (!owner || owner.direction !== 'output' || owner.connectionEpoch !== client.session || !Number.isInteger(group) || group < 0 || group > 15 || !(owner.groupMask & 1 << group) ||
        !Number.isInteger(channel) || channel < 0 || channel > 15 || !['midi2', 'midi1-in-ump'].includes(protocol) || !['dedicated', 'shared-ensemble'].includes(sharing) || typeof laneId !== 'string' || !laneId) throw new Error('Choose a current output grant, group, channel and protocol');
    if (routes.size >= 1024) throw new Error('Native route capacity; revoke unused connections');
    const outputId = 'native-midi:' + owner.logicalDestination + ':' + group + ':' + channel;
    const previous = routes.get(outputId);
    if (previous && previous.protocol !== protocol) throw new Error('An active native address cannot mix channel protocols');
    if (previous && previous.laneIds.some(id => id !== laneId) && (previous.sharing !== 'shared-ensemble' || sharing !== 'shared-ensemble')) throw new Error('Native channel belongs to another lane; choose sharing explicitly');
    const laneIds = Object.freeze([...new Set([...(previous?.laneIds || []), laneId])]);
    const route = Object.freeze({ outputId, grant, connectionEpoch: owner.connectionEpoch, routeRevision: ++revision, logicalDestination: owner.logicalDestination, group, channel, protocol, sharing, laneIds,
      receiverProtocol: 'unverified', transport: 'native-ump', independentSamePitchVoices: false });
    routes.set(outputId, route); notify(); return route;
  };
  const api = Object.freeze({
    client, input: ingress,
    registerPerformanceOwner(owner) { if (disposed || performanceOwners.size >= 8 || typeof owner?.isQuiescent !== 'function') throw new Error('Native performance owner capacity'); performanceOwners.add(owner); return () => performanceOwners.delete(owner); },
    allowsPerformance(grant) { return !disposed && !observationHolds.has(grant); },
    allowsOrdinaryInput() { return !disposed && observationHolds.size === 0; },
    holdForObservation(grant) { if (canObserveInput() !== true) throw new Error('Disconnect the ordinary MIDI input before reading isolated device state'); if (disposed || !grants.has(grant) || observationHolds.has(grant) || [...performanceOwners].some(owner => owner.isQuiescent(grant) !== true)) throw new Error('Stop native performance and wait for owned notes before reading device state'); const token = Object.freeze({ grant, connectionEpoch: client.session }); observationHolds.set(grant, token); return token; },
    releaseObservation(token) { if (observationHolds.get(token?.grant) !== token) return false; observationHolds.delete(token.grant); return true; },
    isGrantActive(grant) { return !disposed && grants.get(grant)?.connectionEpoch === client.session; },
    createCiSession(options) {
      if (disposed || !client.capabilities?.ciCodec) throw new Error('Build and pair a companion with the MIDI-CI codec');
      for (const session of ciSessions) { const state = session.state(); if (state.inputGrant === options.inputGrant && state.status !== 'disposed') { if (state.outputGrant === options.outputGrant && state.group === options.group) return session; throw new Error('Close the existing CI session before changing its input scope'); } }
      if (ciSessions.size >= 8) throw new Error('MIDI-CI session capacity');
      const session = createMidiCiSession({ routes: api, ...options }); ciSessions.add(session); return session;
    },
    createMessageReportSession(ci) { if (disposed || !ciSessions.has(ci)) throw new Error('An owned CI session is required'); if (reportSessions.has(ci)) return reportSessions.get(ci); if (reportSessions.size >= 8) throw new Error('Device report session capacity'); const report = createMidiMessageReportSession({ routes: api, ci }); reportSessions.set(ci, report); return report; },
    async closeCiSession(session) { if (!ciSessions.has(session)) return; reportSessions.get(session)?.dispose(); reportSessions.delete(session); await session.dispose(); ciSessions.delete(session); },

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
    async closeGrant(grant) { const receipt = await client.closeGrant(grant); if (receipt.nativeCloseConfirmed !== true || receipt.cleanupUnconfirmedNotes) throw new Error('Native closure or owned-note cleanup is unconfirmed'); grants.delete(grant); for (const [id, route] of routes) if (route.grant === grant) routes.delete(id); notify(); return receipt; },
    disconnect() { client.disconnect(); ingress.clearGrants(); grants.clear(); inventory = null; notify(); },
    dispose() { if (disposal) return disposal; disposed = true; unsubscribe(); unsubscribeInput(); for (const report of reportSessions.values()) report.dispose(); reportSessions.clear(); ingress.dispose(); disposal = (async () => { const ci = await Promise.allSettled([...ciSessions].map(session => session.dispose())); const devices = await Promise.allSettled([...grants.keys()].map(async grant => { const receipt = await client.closeGrant(grant); if (receipt.nativeCloseConfirmed !== true || receipt.cleanupUnconfirmedNotes) throw new Error('Native closure or cleanup remains unconfirmed'); })); client.disconnect(); const failures = [...ci, ...devices].filter(result => result.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Native MIDI retirement has ' + failures.length + ' unconfirmed resources'); ciSessions.clear(); grants.clear(); routes.clear(); listeners.clear(); trace.length = traceWords = 0; })(); return disposal; }
  });
  return api;
}
