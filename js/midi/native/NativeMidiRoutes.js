import { assertNativeTransportGrant, inspectNativeEndpointTransport } from './NativeEndpointTransport.js';
import { hashData } from '../../core/CanonicalData.js';
import { validateNativeRouteIntent } from './NativeRouteIntent.js';
import { createNativeControllerPolicies } from './NativeControllerPolicies.js';
import { encodeNativeSubmittedClip } from './NativeSubmittedClip.js';
import { createOwnedResourceReservation } from '../../app/resources/OwnedResourceReservation.js';
import { createNativeUmpCapture } from './NativeUmpCapture.js';
import { createOrganRotaryBinding, DRAWBAR_PROFILE_IDS } from './OrganRotaryProfileAdapter.js';
import { createPianoProfileBinding } from './PianoProfileAdapter.js';
import { createOrchestralBinding } from './OrchestralProfileAdapter.js';
import { createDrumMapBinding } from './DrumProfileAdapter.js';
import { createDeviceParameterCatalog } from './DeviceParameterCatalog.js';
import { createMidiEndpointRegistry } from './MidiEndpointRegistry.js';
import { createDevicePatchCatalog } from './DevicePatchCatalog.js';
import { createPropertyClient } from './PropertyClient.js';
import { createMpeProfileBinding } from './MpeProfileAdapter.js';
import { createProfileSession } from './ProfileSession.js';
import { createMidiMessageReportSession } from './MidiMessageReportSession.js';
import { createMidiCiSession } from './MidiCiSession.js';
import { createNativeMidiIngress } from './NativeMidiIngress.js';
import { UMP_WORD_COUNTS } from '../protocol/UmpPacketCodec.js';
import { NativeMidiBridgeClient } from './NativeMidiBridgeClient.js';

const baselineIndexes = new WeakMap();
const controllerBaselineIndex = observation => {
  let index = baselineIndexes.get(observation); if (index) return index;
  index = new Map(); const conflicts = new Set(observation.conflicts);
  for (const row of observation.values) {
    if (conflicts.has(row.address)) continue;
    const key = row.group + ':' + row.channel; let bucket = index.get(key);
    if (!bucket) { bucket = { registered: {}, pedals: {} }; index.set(key, bucket); }
    if (row.kind === 'registeredController' && (row.wireBits === 32 || row.lowBitsKnown === true)) bucket.registered[Math.floor(row.index / 128) + ':' + row.index % 128] = Object.freeze({ value: row.value, bits: row.wireBits, revision: observation.revision, completedHostMs: observation.completedHostMs });
    const name = ({ 64: 'sustain01', 66: 'sostenuto01', 67: 'unaCorda01' })[row.index];
    if (name && row.kind === 'controlChange') bucket.pedals[name] = Object.freeze({ known: true, value: row.value / (2 ** row.wireBits - 1), revision: observation.revision, wireBits: row.wireBits, origin: 'isolated-message-report' });
  }
  baselineIndexes.set(observation, index); return index;
};

export function createNativeMidiRoutes({ client = new NativeMidiBridgeClient(), onTrace = () => {}, resourceBudget = null, canObserveInput = () => true } = {}) {
  const ingress = createNativeMidiIngress(), receivedContexts = new Map(), outputCapture = createNativeUmpCapture({ resourceBudget });
  const parameterCatalogs = new Map(), auxiliaryRoutes = new Map(), controllerChanges = new Map();
  const forgetControllerChanges = grant => { for (const key of controllerChanges.keys()) if (key.startsWith(grant + ':')) controllerChanges.delete(key); for (const [key, row] of groupInvalidations) if (row.grant === grant) groupInvalidations.delete(key); };
  const groupInvalidations = new Map(), exportArtifacts = new Set(), nativeRetirements = new Map(), reconnectReviews = new WeakMap(), fingerprintCache = new WeakMap();
  const endpointRegistries = new Map(), patchCatalogs = new Map(), patchClaims = new Map(), propertyClients = new Map(), profileClaims = new Map(), profileSessions = new Map(), deviceInvalidations = new Map();
  const reportSessions = new Map(), performanceOwners = new Set(), observationHolds = new Map(), ciSessions = new Set(), grants = new Map(), routes = new Map(), listeners = new Set(), trace = [];
  let disposal = null, notificationPending = false, executionSequence = 0, revision = 0, traceWords = 0, omittedTrace = 0, disposed = false, inventory = null;
  const controllerPolicies = createNativeControllerPolicies({ client, isGrantActive: grant => !disposed && grants.get(grant)?.connectionEpoch === client.session, onFailure: (grant, reason) => api.quarantineDeviceState(grant, reason) });
  const notify = () => { revision++; if (notificationPending) return; notificationPending = true; queueMicrotask(() => { notificationPending = false; if (disposed) return; for (const listener of listeners) { try { listener(); } catch {} } }); };
  const current = route => route && (route.groupRevisions || [[route.group, 0]]).every(([group, revision]) => (grants.get(route.grant)?.groupMask & 1 << group) && (grants.get(route.grant)?.groupRevisions?.[group] || 0) === revision) && (!patchClaims.has(route.outputId) || patchClaims.get(route.outputId).current()) && (!profileClaims.has(route.outputId) || profileClaims.get(route.outputId).current()) && grants.has(route.grant) && route.connectionEpoch === client.session && route.deviceRevision === grants.get(route.grant)?.deviceRevision && client.state === 'connected';
  const descriptor = (receipt, endpoint = null) => Object.freeze({ ...receipt, originalGroupMask: receipt.originalGroupMask ?? receipt.groupMask, deviceRevision: 0, groupRevisions: Object.freeze(new Array(16).fill(0)), logicalDestination: globalThis.crypto.randomUUID(), endpoint, transport: inspectNativeEndpointTransport(endpoint || receipt), connectionEpoch: client.session });
  const unsubscribeInput = ingress.subscribe(event => {
    const context = event.event === 'native-packet' ? event.packet?.scoreContext : event.event === 'native-payload' && event.message?.kind === 'flex-text' ? { kind: 'text', value: { text: event.message.text, bank: event.message.bank, status: event.message.status } } : null;
    if (context) { const scope = event.packet || event.message, key = JSON.stringify([event.grant, scope.group, scope.address, scope.channel ?? null, context.kind, context.value.bank ?? null, context.value.status ?? null]);
      receivedContexts.delete(key); while (receivedContexts.size >= 128) receivedContexts.delete(receivedContexts.keys().next().value);
      receivedContexts.set(key, Object.freeze({ ...context, grant: event.grant, group: scope.group, address: scope.address, channel: scope.channel ?? null, origin: 'received-device-metadata-read-only', observedHostMs: event.observedHostMs ?? client.now() }));
    }
    for (const listener of listeners) { try { listener(event); } catch {} } });
  const unsubscribe = client.subscribe(event => {
    if (event.event === 'grant-retired') { nativeRetirements.set(event.grant, Object.freeze({ grant: event.grant, reason: event.reason, nativeCloseConfirmed: event.nativeCloseConfirmed === true, cleanupUnconfirmedNotes: event.cleanupUnconfirmedNotes ?? null, cleanupUnconfirmedControls: event.cleanupUnconfirmedControls ?? null, hostOwnership: 'retiring' })); while (nativeRetirements.size > 128) nativeRetirements.delete(nativeRetirements.keys().next().value);
      void Promise.allSettled([...performanceOwners].map(owner => owner.invalidateGrant?.(event.grant, event))).then(results => { const failed = results.filter(row => row.status === 'rejected'); const current = nativeRetirements.get(event.grant); if (current) nativeRetirements.set(event.grant, Object.freeze({ ...current, hostOwnership: failed.length ? 'unconfirmed' : 'retired', failure: failed.map(row => String(row.reason?.message || row.reason)).join('; ') || null })); notify(); });
      if (outputCapture.state().capture?.grant === event.grant) outputCapture.stop({ reason: event.reason || 'captured-grant-retired', hostTimeMs: client.now() }); ingress.revoke(event.grant, event.reason); controllerPolicies.forget(event.grant); grants.delete(event.grant); for (const [id, route] of routes) if (route.grant === event.grant) { routes.delete(id); profileClaims.delete(id); patchClaims.delete(id); } forgetControllerChanges(event.grant); for (const session of ciSessions) if (session.state().outputGrant === event.grant) session.invalidate(event.reason || 'CI output grant retired'); notify(); }
    else if (event.event === 'state' && event.state === 'disconnected') { outputCapture.stop({ reason: 'native-connection-retired', hostTimeMs: client.now() }); ingress.clearGrants(); controllerPolicies.forget(); grants.clear(); controllerChanges.clear(); groupInvalidations.clear(); receivedContexts.clear(); inventory = null; notify(); }
    else if (event.event === 'clock-epoch-retired') { for (const owner of grants.values()) if (owner.direction === 'output') void api.invalidateDeviceState(owner.grant, event.reason || 'native-clock-epoch-retired').catch(error => api.quarantineDeviceState(owner.grant, error.message)); notify(); }
    else if (event.event === 'clock-updated') notify();
    else if (event.event === 'ports-changed') { inventory = null; notify(); }
    else if (event.event === 'grant-groups-retired' || event.event === 'receipt' && event.kind === 'revalidated-groups') updateGrantGroups(event);
    else if (event.event === 'native-driver-observation') acceptDriverObservation(event);
    else if (event.event === 'ingress') ingress.acceptColumns(event);
    else if (event.event === 'ingress-loss') ingress.markLoss(event);
    else if (event.event === 'receipt' && event.kind === 'heartbeat') ingress.poll();
  });
  const updateGrantGroups = event => {
    const owner = grants.get(event.grant), revalidated = event.kind === 'revalidated-groups', removed = revalidated ? 0 : event.retiredGroupMask;
    if (!owner || !Number.isInteger(event.groupMask) || event.groupMask < 0 || event.groupMask > 65535 || event.groupMask & ~owner.originalGroupMask || !revalidated && (!Number.isInteger(removed) || removed < 1 || removed > 65535 || event.groupMask !== (owner.groupMask & ~removed))) { client.disconnect(); return; }
    if (removed && outputCapture.state().capture?.grant === event.grant) outputCapture.stop({ reason: 'captured-native-group-routing-changed', hostTimeMs: client.now() });
    grants.set(event.grant, Object.freeze({ ...owner, groupMask: event.groupMask, endpointMetadata: event.endpointMetadata || owner.endpointMetadata }));
    if (owner.direction === 'input') ingress.updateGroups(event.grant, event.groupMask, { revalidated });
    if (removed) void api.invalidateDeviceGroups(event.grant, removed, event.reason || 'native-group-scope-retired', { nativeRetirement: event }).catch(error => api.quarantineDeviceState(event.grant, error.message));
    for (const registry of endpointRegistries.values()) { const state = registry.state(); if ((state.inputGrant === event.grant || state.outputGrant === event.grant) && event.endpointMetadata) registry.refreshMetadata(event.endpointMetadata); }
    notify();
  };
  const unsupportedTiming = owner => client.capabilities?.nativeJrAllowed === false && !!(owner?.endpointMetadata?.activeExtensions & 2);
  const acceptDriverObservation = row => {
    const safe = value => Number.isSafeInteger(value) && value >= 0;
    if (disposed || row.session !== client.session || !grants.has(row.grant)) return;
    const count = row.accepted?.length;
    if (!safe(row.firstSequence) || !safe(row.execution) || !safe(row.nativeBatchId) || !['batch-packet', 'jr-clock', 'jr-timestamp', 'owned-note-cleanup', 'owned-controller-cleanup'].includes(row.kind) ||
        !Array.isArray(row.accepted) || count < 1 || count > 64 || !Array.isArray(row.words) || row.words.length > 256 || row.words.some(word => !Number.isInteger(word) || word < 0 || word > 0xffffffff) ||
        !Array.isArray(row.offsets) || row.offsets.length !== count + 1 || row.offsets[0] !== 0 || row.offsets[count] !== row.words.length ||
        !['unconfirmed', 'beginMonoUs', 'endMonoUs'].every(key => Array.isArray(row[key]) && row[key].length === count)) return;
    for (let index = 0; index < count; index++) {
      const start = row.offsets[index], end = row.offsets[index + 1];
      if (!safe(start) || !safe(end) || end <= start || end - start !== UMP_WORD_COUNTS[row.words[start] >>> 28] ||
          ![0, 1].includes(row.accepted[index]) || ![0, 1].includes(row.unconfirmed[index]) || row.accepted[index] + row.unconfirmed[index] !== 1 ||
          !safe(row.beginMonoUs[index]) || !safe(row.endMonoUs[index]) || row.endMonoUs[index] < row.beginMonoUs[index]) return;
    }
    for (let index = 0; index < count; index++) {
      const words = row.words.slice(row.offsets[index], row.offsets[index + 1]), accepted = row.accepted[index] === 1;
      outputCapture.record({ session: row.session, grant: row.grant, execution: row.execution, nativeBatchId: row.nativeBatchId, driverSequence: row.firstSequence + index, kind: row.kind, words, accepted, beginMonoUs: row.beginMonoUs[index], endMonoUs: row.endMonoUs[index] });
      const first = words[0], type = first >>> 28, status = first >>> 20 & 15;
      if ((type === 2 || type === 4) && [2, 3, 4, 5, 11, 13, 14].includes(status)) controllerChanges.set(row.grant + ':' + (first >>> 24 & 15) + ':' + (first >>> 16 & 15), client.now());
      api.recordSubmission({ words, receipt: { session: row.session, grant: row.grant, execution: row.execution, nativeBatchId: row.nativeBatchId,
        kind: accepted ? 'driver-submitted' : 'uncertain-driver-call', acceptedWords: accepted ? words.length : 0, acceptedPackets: accepted ? 1 : 0,
        failedPacketUnconfirmed: !accepted, failureWordOffset: 0, beginMonoUs: row.beginMonoUs[index], endMonoUs: row.endMonoUs[index] },
      provenance: Object.freeze({ schema: 'lemmings-native-driver-observation/v1', kind: row.kind, nativeBatchId: row.nativeBatchId, driverSequence: row.firstSequence + index,
        clockDomain: 'companion-steady-microseconds', claim: 'SDK-call-observation-not-receiver-wire-or-acoustic-proof' }) });
    }
  };
  const buildRoute = ({ laneId, grant, group, channel, protocol = 'midi2', sharing = 'dedicated' }, routing = routes, routeRevision = revision + 1) => {
    const owner = grants.get(grant);
    for (const registry of endpointRegistries.values()) if (registry.state().outputGrant === grant && !registry.allowsAddress({ group, protocol })) throw new Error('Endpoint protocol, function-block direction or active groups do not permit this route; refresh and configure the endpoint');
    if (unsupportedTiming(owner)) throw new Error('This endpoint requires JR timestamps that Windows MIDI Services does not permit applications to generate');
    if (deviceInvalidations.has(grant) || [...groupInvalidations.values()].some(row => row.grant === grant && row.groupMask & 1 << group)) throw new Error('Device scope retirement remains unconfirmed');
    if (disposed || !owner || owner.direction !== 'output' || owner.connectionEpoch !== client.session || !Number.isInteger(group) || group < 0 || group > 15 || !(owner.groupMask & 1 << group) ||
        !Number.isInteger(channel) || channel < 0 || channel > 15 || !['midi2', 'midi1-in-ump'].includes(protocol) || !['dedicated', 'shared-ensemble'].includes(sharing) || typeof laneId !== 'string' || !laneId) throw new Error('Choose a current output grant, group, channel and protocol');
    const outputId = 'native-midi:' + owner.logicalDestination + ':' + group + ':' + channel;
    for (const [id, claim] of profileClaims) if (id !== outputId && claim.grant === grant && claim.current() && claim.binding.addresses.some(address => address.group === group && address.channel === channel)) throw new Error('Channel is reserved by an active CI profile allocation');
    if (profileClaims.has(outputId) && [...performanceOwners].some(owner => owner.isQuiescent(grant) !== true)) throw new Error('Stop owned notes before replacing a profile route');
    if (routing.size >= 1024 && !routing.has(outputId)) throw new Error('Native route capacity; revoke unused connections');
    const previous = routing.get(outputId);
    if (previous && previous.protocol !== protocol) throw new Error('An active native address cannot mix channel protocols');
    if (previous && previous.laneIds.some(id => id !== laneId) && (previous.sharing !== 'shared-ensemble' || sharing !== 'shared-ensemble')) throw new Error('Native channel belongs to another lane; choose sharing explicitly');
    const laneIds = Object.freeze([...new Set([...(previous?.laneIds || []), laneId])]);
    const route = Object.freeze({ outputId, grant, connectionEpoch: owner.connectionEpoch, routeRevision, logicalDestination: owner.logicalDestination, deviceRevision: owner.deviceRevision, group, channel, protocol, sharing, laneIds,
      groupRevisions: Object.freeze([[group, owner.groupRevisions[group]]]), receiverProtocol: 'unverified', transport: 'native-ump', transportProfile: owner.transport, independentSamePitchVoices: false });
    return route;
  };
  const bind = options => { const route = buildRoute(options); revision = route.routeRevision; profileClaims.delete(route.outputId); patchClaims.delete(route.outputId); routes.set(route.outputId, route); notify(); return route; };
  const reconnectIdentity = async owner => {
    if (disposed || !owner || owner.direction !== 'output' || grants.get(owner.grant) !== owner || owner.connectionEpoch !== client.session) throw new Error('A current explicitly granted output is required');
    if (typeof owner.endpoint?.reconnectKey === 'string' && owner.endpoint.reconnectKey.length > 0 && owner.endpoint.reconnectKey.length <= 2048) {
      let identity = fingerprintCache.get(owner); if (!identity) { identity = Object.freeze({ deviceFingerprint: await hashData({ domain: 'lemmings-native-os-output-reconnect/v1', key: owner.endpoint.reconnectKey, backend: client.capabilities?.selectedApi ?? null }), identitySource: 'os-endpoint-key' }); fingerprintCache.set(owner, identity); } return identity;
    }
    const registries = [...endpointRegistries.values()].filter(registry => registry.state().outputGrant === owner.grant && !registry.state().stale);
    if (registries.length !== 1) throw new Error('This device needs current Endpoint Identity and Product Instance ID discovery before its route can be remembered; names alone are insufficient');
    return registries[0].reconnectFingerprint();
  };
  const api = Object.freeze({
    client, input: ingress, outputCapture,
    startOutputCapture(grant) { const owner = grants.get(grant); if (!owner || owner.direction !== 'output' || owner.connectionEpoch !== client.session) throw new Error('Select a current owned native output to record'); return outputCapture.start({ session: client.session, grant, outputId: owner.logicalDestination, groupMask: owner.groupMask, initialOwnedNotes: [...performanceOwners].every(owner => owner.isQuiescent(grant) === true) ? 'empty-at-quiescent-boundary' : 'unknown-at-capture-start', hostTimeMs: client.now() }); },
    async exportSubmittedClip(options, controls = {}) {
      if (exportArtifacts.size >= 2) throw new Error('Release a prepared native Clip before preparing another');
      const current = () => !disposed && (controls.current?.() ?? true), lease = await outputCapture.snapshot({ signal: controls.signal, isCurrent: current }); let reservation = null, published = false;
      try {
        reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'native-clip-export-' + lease.snapshot.captureId, kind: 'native-submitted-clip-workspace', bytes: 128 * 1048576, maxBytes: 128 * 1048576 });
        const result = await encodeNativeSubmittedClip(lease.snapshot, options, { ...controls, current }); if (!current()) throw new Error('Native Clip source was retired');
        reservation.resize(Math.max(4096, 2 * (result.bytes.byteLength + result.manifestBytes.byteLength) + 16384)); let released = false;
        const artifact = Object.freeze({ ...result, release() { if (released) return false; reservation.release(); released = true; exportArtifacts.delete(artifact); return true; } }); exportArtifacts.add(artifact); published = true; return artifact;
      } finally { try { if (!published) reservation?.release(); } finally { lease.release(); } }
    },
    stopOutputCapture() { const grant = outputCapture.state().capture?.grant; return outputCapture.stop({ reason: 'explicit-stop', hostTimeMs: client.now(), finalOwnedNotes: grant != null && [...performanceOwners].every(owner => owner.isQuiescent(grant) === true) ? 'empty-at-quiescent-boundary' : 'unknown-at-capture-stop' }); },
    async setTimingPolicy(policy) {
      if ([...grants.values()].some(owner => owner.direction === 'output' && [...performanceOwners].some(performance => performance.isQuiescent(owner.grant) !== true))) throw new Error('Stop native performance before changing its clock operating budget');
      client.setTimingPolicy(policy); return client.synchronizeClock();
    },
    async saveRouteIntent(route) {
      if (!current(route)) throw new Error('Choose a current active native route before remembering it');
      const owner = grants.get(route.grant), identity = await reconnectIdentity(owner);
      if (!current(route) || grants.get(route.grant) !== owner) throw new Error('Native route changed while remembering its identity');
      return validateNativeRouteIntent({ schema: 'lemmings-native-route-intent/v1', ...identity, deviceLabel: String(owner.endpoint?.name || owner.name || 'Native output').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 256), group: route.group, channel: route.channel, protocol: route.protocol, sharing: route.sharing, allocation: route.mpe ? 'ci-mpe-profile' : 'base-channel' });
    },
    async previewReconnect(grant, lanes) {
      const owner = grants.get(grant); if (!owner || owner.direction !== 'output' || !Array.isArray(lanes) || lanes.length > 1024) throw new Error('Select an explicitly granted current output');
      const identity = await reconnectIdentity(owner); if (grants.get(grant) !== owner) throw new Error('Output changed during reconnect review');
      const staged = new Map(routes), rows = [];
      for (const lane of lanes) {
        if (!lane.nativeRouteIntent) continue;
        const intent = validateNativeRouteIntent(lane.nativeRouteIntent);
        if (intent.deviceFingerprint !== identity.deviceFingerprint || intent.identitySource !== identity.identitySource) { rows.push(Object.freeze({ laneId: lane.id, status: 'different-device', reason: 'Saved fingerprint does not match the explicitly selected output' })); continue; }
        if (intent.allocation === 'ci-mpe-profile') { rows.push(Object.freeze({ laneId: lane.id, status: 'requires-profile-route', reason: 'Re-query and explicitly activate the current MPE Profile allocation; its old manager cannot be restored as an ordinary note channel' })); continue; }
        try {
          const route = buildRoute({ laneId: lane.id, grant, ...intent }, staged);
          staged.set(route.outputId, route);
          rows.push(Object.freeze({ laneId: lane.id, status: 'ready', group: intent.group, channel: intent.channel, protocol: intent.protocol, sharing: intent.sharing, reactivation: [lane.devicePatch ? 'patch' : null, lane.percussion ? 'percussion-profile' : null, lane.orchestral ? 'orchestral-profile' : null, lane.piano ? 'piano-profile' : null, lane.organ ? 'organ-profile' : null, lane.deviceParameters?.length ? 'device-mappings' : null].filter(Boolean) }));
        } catch (error) { rows.push(Object.freeze({ laneId: lane.id, status: 'conflict', reason: error.message })); }
      }
      const plan = Object.freeze({ schema: 'lemmings-native-reconnect-review/v1', grant, connectionEpoch: client.session, deviceFingerprint: identity.deviceFingerprint, rows: Object.freeze(rows), policy: 'explicit-current-grant;no-automatic-open-or-output' });
      reconnectReviews.set(plan, { owner, expiresMs: client.now() + 60000, lanes: new Map(lanes.filter(lane => lane.nativeRouteIntent).map(lane => [lane.id, { intent: JSON.stringify(lane.nativeRouteIntent), outputId: lane.outputId }])) }); return plan;
    },
    async applyReconnect(plan, getCurrentLanes, publishAssignments) {
      const review = reconnectReviews.get(plan);
      if (!review || grants.get(plan.grant) !== review.owner || client.session !== plan.connectionEpoch || client.now() > review.expiresMs || (typeof publishAssignments !== 'function' || typeof getCurrentLanes !== 'function')) throw new Error('Prepare a fresh reconnect review for this owned output');
      await api.prepareOutput(plan.grant);
      const identity = await reconnectIdentity(review.owner), indexed = new Map(getCurrentLanes().map(lane => [lane.id, lane]));
      if (grants.get(plan.grant) !== review.owner || identity.deviceFingerprint !== plan.deviceFingerprint || client.now() > review.expiresMs || [...performanceOwners].some(owner => owner.isQuiescent(plan.grant) !== true)) throw new Error('Output identity, metadata or stopped boundary changed during reconnect review');
      const staged = new Map(routes), assignments = []; let nextRevision = revision;
      for (const row of plan.rows) if (row.status === 'ready') {
        const lane = indexed.get(row.laneId), original = review.lanes.get(row.laneId);
        if (!lane || lane.outputId !== original.outputId || JSON.stringify(lane.nativeRouteIntent) !== original.intent) throw new Error('A reviewed lane route changed before reconnect');
        const intent = validateNativeRouteIntent(lane.nativeRouteIntent), route = buildRoute({ laneId: lane.id, grant: plan.grant, ...intent }, staged, ++nextRevision);
        staged.set(route.outputId, route); assignments.push({ laneId: lane.id, status: 'assigned', route: Object.freeze({ ...route, reconnectIntent: intent }) });
      }
      if (!assignments.length) throw new Error('No saved routes can be restored on this selected output');
      publishAssignments(Object.freeze(assignments)); reconnectReviews.delete(plan);
      for (const row of assignments) { const route = staged.get(row.route.outputId); routes.set(route.outputId, route); profileClaims.delete(route.outputId); patchClaims.delete(route.outputId); }
      revision = nextRevision; notify(); return Object.freeze(assignments);
    },
    registerPerformanceOwner(owner) { if (disposed || performanceOwners.size >= 8 || typeof owner?.isQuiescent !== 'function') throw new Error('Native performance owner capacity'); performanceOwners.add(owner); return () => performanceOwners.delete(owner); },
    allowsPerformance(grant) { return !disposed && !unsupportedTiming(grants.get(grant)) && !observationHolds.has(grant) && !deviceInvalidations.has(grant); },
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
    grantState: grant => grants.get(grant) || null,
    invalidateDeviceGroups(grant, groupMask, reason, { nativeRetirement = null } = {}) {
      const owner = grants.get(grant); if (!owner || !Number.isInteger(groupMask) || groupMask < 1 || groupMask > 65535) return Promise.resolve();
      const key = grant + ':' + groupMask; if (groupInvalidations.has(key)) return groupInvalidations.get(key).completion;
      const revisions = owner.groupRevisions.map((value, group) => value + Number(!!(groupMask & 1 << group)));
      grants.set(grant, Object.freeze({ ...owner, groupRevisions: Object.freeze(revisions), groupStateReason: reason }));
      for (const session of ciSessions) { const state = session.state(); if ((state.outputGrant === grant || state.inputGrant === grant) && groupMask & 1 << state.group) session.invalidate(reason); }
      for (const [session, report] of reportSessions) if (session.state().outputGrant === grant && groupMask & 1 << session.state().group) report.invalidateOutput(grant, reason);
      const completion = Promise.allSettled([...performanceOwners].map(owner => owner.invalidateGroups?.(grant, groupMask, nativeRetirement) ?? owner.invalidateGrant?.(grant))).then(results => {
        const failures = results.filter(row => row.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(row => row.reason), 'Affected native groups remain unconfirmed'); groupInvalidations.delete(key); notify();
      }); groupInvalidations.set(key, { grant, groupMask, completion }); notify(); return completion;
    },
    isGrantActive(grant) { return !disposed && grants.get(grant)?.connectionEpoch === client.session; },
    createCiSession(options) {
      if (disposed || !client.capabilities?.ciCodec) throw new Error('Build and pair a companion with the MIDI-CI codec');
      for (const session of ciSessions) { const state = session.state(); if (state.inputGrant === options.inputGrant && state.status !== 'disposed') { if (state.outputGrant === options.outputGrant && state.group === options.group) return session; throw new Error('Close the existing CI session before changing its input scope'); } }
      if (ciSessions.size >= 8) throw new Error('MIDI-CI session capacity');
      const session = createMidiCiSession({ routes: api, ...options }); ciSessions.add(session); return session;
    },
    createEndpointRegistry({ inputGrant, outputGrant }) {
      if (disposed || client.capabilities?.umpStreamCodecVersion !== 1) throw new Error('Build and pair a companion with UMP Stream discovery');
      const key = inputGrant + ':' + outputGrant, previous = endpointRegistries.get(key);
      if (previous && !previous.state().stale) return previous;
      if (previous) { void previous.dispose().catch(() => {}); endpointRegistries.delete(key); }
      if (endpointRegistries.size >= 8) throw new Error('Endpoint registry scope capacity');
      const registry = createMidiEndpointRegistry({ routes: api, inputGrant, outputGrant }); registry.subscribe(notify); endpointRegistries.set(key, registry); notify(); return registry;
    },
    resolvePropertyChannel(ci, peerMuid, propertyChannel) {
      if (!ciSessions.has(ci)) return null; const scope = ci.state(), peer = ci.getPeer(peerMuid);
      if (!peer || !Number.isInteger(peer.functionBlock) || peer.functionBlock < 0 || peer.functionBlock > 31) return null;
      return endpointRegistries.get(scope.inputGrant + ':' + scope.outputGrant)?.resolvePropertyChannel(peer.functionBlock, propertyChannel) || null;
    },
    createDeviceParameterCatalog(ci, peerMuid) {
      if (disposed || !ciSessions.has(ci)) throw new Error('An owned CI session is required');
      const peers = parameterCatalogs.get(ci) || new Map(), previous = peers.get(peerMuid);
      if (previous && !previous.state().disposed && !previous.state().stale) return previous;
      if (previous) { void previous.dispose().catch(() => {}); peers.delete(peerMuid); }
      if ([...parameterCatalogs.values()].reduce((count, peers) => count + peers.size, 0) >= 8) throw new Error('Device controller peer capacity');
      const catalog = createDeviceParameterCatalog({ routes: api, ci, peerMuid, properties: api.createPropertyClient(ci, peerMuid) }); peers.set(peerMuid, catalog); parameterCatalogs.set(ci, peers); return catalog;
    },
    acquireControllerReleasePolicy: (grant, words, semantic) => controllerPolicies.acquire(grant, words, semantic),
    reconcileDeviceMappings(lanes) { const indexed = new Map(lanes.map(lane => [lane.id, lane])); for (const peers of parameterCatalogs.values()) for (const catalog of peers.values()) catalog.reconcile(indexed); },
    deviceParameterWords(lane, route, intent, state, targetMicroseconds, cohort) {
      const words = [], observations = [];
      for (const mapping of lane.deviceParameters || []) {
        let owner = null;
        for (const peers of parameterCatalogs.values()) { for (const catalog of peers.values()) if (catalog.ownsMapping(lane.id, mapping, route)) { owner = catalog; break; } if (owner) break; }
        if (!owner) throw new Error('Review and activate saved device-expression mappings on the current device');
        const plan = owner.voiceWords({ ...lane, deviceParameters: [mapping] }, route, intent, state, targetMicroseconds, cohort); words.push(...plan.words); observations.push(...plan.observations);
      }
      const controllerUpdate = cohort?.prepare(); if (controllerUpdate) { words.push(...controllerUpdate.words); observations.push(...controllerUpdate.observations); }
      return Object.freeze({ words, observations, controllerUpdate });
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
    async closeCiSession(session) { if (!ciSessions.has(session)) return; await Promise.allSettled([...(parameterCatalogs.get(session)?.values() || [])].map(catalog => catalog.dispose())); parameterCatalogs.delete(session); await Promise.allSettled([...(patchCatalogs.get(session)?.values() || [])].map(catalog => catalog.dispose())); patchCatalogs.delete(session); const properties = await Promise.allSettled([...(propertyClients.get(session)?.values() || [])].map(client => client.dispose())); propertyClients.delete(session); await Promise.allSettled([...(profileSessions.get(session)?.values() || [])].map(profile => profile.dispose())); profileSessions.delete(session); reportSessions.get(session)?.dispose(); reportSessions.delete(session); await session.dispose(); ciSessions.delete(session); const failures = properties.filter(row => row.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(row => row.reason), 'Property subscription retirement is unconfirmed'); },

    allocateExecutionEpoch() { if (disposed || executionSequence >= 0xffffffff) throw new Error('Native execution identity exhausted'); return ++executionSequence; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async connect(options) { if (disposed) throw new Error('Native routing owner retired'); await client.connect(options); notify(); return client.capabilities; },
    async enumerate() { const result = await client.enumerate(); if (disposed) throw new Error('Native routing owner retired'); inventory = result; notify(); return result; },
    async open(options) {
      if (disposed || !inventory || inventory.inventoryEpoch !== options.inventoryEpoch) throw new Error('Refresh and select a current native endpoint');
      const endpoint = inventory.endpoints.find(row => row.endpointToken === options.endpointToken);
      if (!endpoint) throw new Error('Select a native endpoint');
      assertNativeTransportGrant(endpoint, options);
      const receipt = await client.open(options);
      if (disposed || receipt.connectionEpoch != null && receipt.connectionEpoch !== client.session) throw new Error('Native route owner retired');
      if (receipt.direction === 'input') ingress.register(receipt);
      grants.set(receipt.grant, descriptor(receipt, endpoint)); notify(); return grants.get(receipt.grant);
    },
    async revalidateGroups(grant, groupMask) {
      const owner = grants.get(grant); if (disposed || client.capabilities?.groupRetirementVersion !== 1 || !inventory || !owner || owner.virtual || !Number.isInteger(groupMask) || groupMask < 0 || groupMask > 65535 || groupMask & ~owner.originalGroupMask) throw new Error('Refresh devices and select a subset of the original owned groups');
      await Promise.all([...groupInvalidations.values()].filter(row => row.grant === grant).map(row => row.completion));
      const receipt = await client.revalidateGroups(grant, { inventoryEpoch: inventory.inventoryEpoch, groupMask }); if (receipt.kind !== 'revalidated-groups') throw new Error('Native group revalidation was not acknowledged'); return grants.get(grant);
    },
    async publish(options) { if (disposed) throw new Error('Native routing owner retired'); const receipt = await client.publish(options); if (disposed) throw new Error('Native route owner retired'); if (receipt.direction === 'input') ingress.register(receipt); grants.set(receipt.grant, descriptor(receipt)); notify(); return grants.get(receipt.grant); },
    async prepareOutput(grant) { if (unsupportedTiming(grants.get(grant))) throw new Error('Windows MIDI Services cannot supply this endpoint’s required JR timestamps'); if (!api.isGrantActive(grant)) throw new Error('Choose a current native output'); for (const registry of endpointRegistries.values()) if (registry.state().outputGrant === grant) await registry.prepareOutput(); },
    bind,
    bindDevicePatch({ laneId, catalog, receipt }) {
      if (![...patchCatalogs.values()].some(peers => [...peers.values()].includes(catalog)) || !catalog.isReceiptCurrent(receipt)) throw new Error('Recall and confirm the patch on this current device first');
      const grant = receipt.outputGrant, target = receipt.target, owner = grants.get(grant);
      if (!owner || [...performanceOwners].some(owner => owner.isQuiescent(grant) !== true)) throw new Error('Stop owned notes before binding a hardware patch');
      const outputId = 'native-midi:' + owner.logicalDestination + ':' + target.group + ':' + target.channel, previous = routes.get(outputId);
      if ((previous?.mpe || previous?.percussion || previous?.orchestral || previous?.piano || previous?.organ) && !current(previous)) throw new Error('Patch recalled; review and rebind the accepted instrument profile before assigning this patch');
      if ((previous?.mpe || previous?.percussion || previous?.orchestral || previous?.piano || previous?.organ) && (!previous.laneIds.includes(laneId) || previous.protocol !== target.protocol)) throw new Error('Choose the explicitly bound instrument-profile lane and protocol');
      const base = previous?.mpe || previous?.percussion || previous?.orchestral || previous?.piano || previous?.organ ? previous : bind({ laneId, grant, group: target.group, channel: target.channel, protocol: target.protocol });
      const route = Object.freeze({ ...base, routeRevision: ++revision, patchBinding: Object.freeze({ intent: receipt.intent, receiverState: receipt.receiverState, target, reported: receipt.reported }) });
      patchClaims.set(outputId, { current: () => catalog.isReceiptCurrent(receipt) }); routes.set(outputId, route); notify(); return route;
    },
    bindOrganRotary({ laneId, policy, grant, group, channel, protocol = 'midi2', session }) {
      if (![...profileSessions.values()].some(peers => [...peers.values()].includes(session))) throw new Error('Choose an owned organ/rotary profile session');
      const owner = grants.get(grant), scope = session.state(); if (!owner || owner.direction !== 'output' || scope.outputGrant !== grant) throw new Error('Choose this profile session’s owned output');
      const profiles = scope.profiles.filter(row => row.group === group && row.scope === channel), organRow = profiles.find(row => DRAWBAR_PROFILE_IDS.includes(row.id) && row.enabled), rotaryRow = profiles.find(row => row.id === '7e22000101' && row.enabled);
      const organ = organRow && session.binding(organRow.profile, channel), rotary = rotaryRow && session.binding(rotaryRow.profile, channel);
      const supports = index => { for (const [ci, peers] of parameterCatalogs) { const identity = ci.state(), catalog = peers.get(scope.peerMuid); if (catalog && identity.outputGrant === grant && identity.inputGrant === scope.inputGrant && identity.epoch === scope.ciEpoch && catalog.recognizesController({ group, channel, bank: 96, index })) return true; } return false; };
      const optionalRotary = Array.from({ length: 13 }, (_, index) => index + 33).filter(supports), hold = api.holdForObservation(grant); api.releaseObservation(hold);
      const binding = createOrganRotaryBinding(organ, rotary, policy, { groupMask: owner.groupMask, group, channel, protocol, optionalRotary });
      const id = 'native-midi:' + owner.logicalDestination + ':' + group + ':' + channel;
      if (binding.controlOnly && routes.has(id) && !routes.get(id).auxiliary) throw new Error('Choose a separate owned channel for parallel rotary controls');
      const base = bind({ laneId, grant, group, channel, protocol }), route = Object.freeze({ ...base, organ: binding, auxiliary: binding.controlOnly, organInputGrant: scope.inputGrant });
      profileClaims.set(route.outputId, { grant, binding, current: () => (!binding.organ || session.isProfileBindingCurrent(binding.organ)) && (!binding.rotary || session.isProfileBindingCurrent(binding.rotary)) && optionalRotary.every(supports) });
      if (binding.controlOnly) auxiliaryRoutes.set(laneId, route.outputId); else auxiliaryRoutes.delete(laneId);
      routes.set(route.outputId, route); notify(); return route;
    },
    resolveAuxiliary(laneId) { const route = routes.get(auxiliaryRoutes.get(laneId)); return route?.auxiliary && current(route) ? route : null; },
    profileControllerBaseline(grant, group, channel, peerMuid = null) {
      const values = {};
      for (const report of reportSessions.values()) { const observation = report.state().latest?.observation;
        if (!observation?.complete || observation.scope.outputGrant !== grant || observation.scope.connectionEpoch !== client.session || observation.scope.group !== group || observation.scope.channel != null && observation.scope.channel !== channel) continue;
        if (peerMuid != null && observation.scope.peerMuid !== peerMuid || observation.completedHostMs < (controllerChanges.get(grant + ':' + group + ':' + channel) ?? -Infinity)) continue;
        Object.assign(values, controllerBaselineIndex(observation).get(group + ':' + channel)?.registered);
      }
      return Object.freeze(values);
    },
    organPerformanceState(laneId) { return Object.freeze([...performanceOwners].flatMap(owner => owner.organPerformanceState?.(laneId) || [])); },
    async restoreOrganRegistration(laneId) { const owners = [...performanceOwners].filter(owner => owner.hasOrganPart?.(laneId)); if (owners.length !== 1) throw new Error('Choose one current stopped organ/rotary part'); return owners[0].restoreOrganRegistration(laneId); },
    bindPiano({ laneId, policy, grant, group, channel, protocol = 'midi2', session, profile }) {
      if (![...profileSessions.values()].some(peers => [...peers.values()].includes(session))) throw new Error('Choose an owned receiving piano profile session');
      const owner = grants.get(grant), record = session.binding(profile, channel); if (!owner || owner.direction !== 'output') throw new Error('Choose an owned native piano output');
      const hold = api.holdForObservation(grant); api.releaseObservation(hold);
      const binding = createPianoProfileBinding(record, policy, { groupMask: owner.groupMask, group, channel, protocol, cleanupVersion: client.capabilities?.ownedPedalCleanupVersion });
      const base = bind({ laneId, grant, group, channel, protocol }), route = Object.freeze({ ...base, piano: binding, pianoInputGrant: session.state().inputGrant });
      profileClaims.set(route.outputId, { grant, binding, current: () => session.isProfileBindingCurrent(record) }); routes.set(route.outputId, route); notify(); return route;
    },
    notifyPerformanceChange() { notify(); },
    pianoBaseline(grant, group, channel, peerMuid = null) {
      const values = {};
      for (const report of reportSessions.values()) { const observation = report.state().latest?.observation;
        if (!observation?.complete || observation.scope.outputGrant !== grant || observation.scope.connectionEpoch !== client.session || observation.scope.group !== group || observation.scope.channel != null && observation.scope.channel !== channel) continue;
        if (peerMuid != null && observation.scope.peerMuid !== peerMuid || observation.completedHostMs < (controllerChanges.get(grant + ':' + group + ':' + channel) ?? -Infinity)) continue;
        Object.assign(values, controllerBaselineIndex(observation).get(group + ':' + channel)?.pedals);
      }
      return Object.freeze(values);
    },
    pianoPerformanceState(laneId) { return Object.freeze([...performanceOwners].flatMap(owner => owner.pianoPerformanceState?.(laneId) || [])); },
    bindOrchestral({ laneId, policy, grant, group, channel, protocol = 'midi2', session, profile }) {
      if (![...profileSessions.values()].some(peers => [...peers.values()].includes(session))) throw new Error('Choose an owned orchestral profile session');
      const owner = grants.get(grant), record = session.binding(profile, channel);
      if (!owner || owner.direction !== 'output') throw new Error('Choose an owned native output');
      const activeProtocol = [...endpointRegistries.values()].find(registry => registry.state().outputGrant === grant && !registry.state().stale)?.state().configuration?.protocol ?? owner.endpointMetadata?.activeProtocol;
      if (activeProtocol !== 2) throw new Error('Read or configure a current MIDI2 endpoint Stream configuration before binding orchestral attributes');
      const hold = api.holdForObservation(grant); api.releaseObservation(hold);
      const binding = createOrchestralBinding(record, policy, { groupMask: owner.groupMask, group, channel, protocol });
      const base = bind({ laneId, grant, group, channel, protocol }), route = Object.freeze({ ...base, orchestral: binding });
      profileClaims.set(route.outputId, { grant, binding, current: () => session.isProfileBindingCurrent(record) }); routes.set(route.outputId, route); notify(); return route;
    },
    bindPercussion({ laneId, policy, grant, group, channel, protocol = 'midi2', session = null, profile = null }) {
      const owner = grants.get(grant), record = session?.binding(profile, channel);
      if (session && ![...profileSessions.values()].some(peers => [...peers.values()].includes(session))) throw new Error('Choose an owned current drum profile session');
      if (!owner || owner.direction !== 'output') throw new Error('Choose an owned native output for the drum map');
      const hold = api.holdForObservation(grant); api.releaseObservation(hold);
      const binding = createDrumMapBinding(record, policy, { groupMask: owner.groupMask, group, channel, protocol });
      const base = bind({ laneId, grant, group, channel, protocol }), route = Object.freeze({ ...base, percussion: binding, independentSamePitchVoices: false });
      if (record) profileClaims.set(route.outputId, { grant, binding, current: () => session.isProfileBindingCurrent(record) });
      routes.set(route.outputId, route); notify(); return route;
    },
    bindMpe({ laneId, session, profile, scope, protocol = 'midi2', pressureForm = 'classic', thirdAxisForm = 'classic' }) {
      if (![...profileSessions.values()].some(peers => [...peers.values()].includes(session))) throw new Error('Choose an owned profile session');
      const record = session.binding(profile, scope), grant = session.state().outputGrant, owner = grants.get(grant);
      if (!owner || [...performanceOwners].some(owner => owner.isQuiescent(grant) !== true)) throw new Error('Stop owned notes before binding an MPE allocation');
      const binding = createMpeProfileBinding(record, { groupMask: owner.groupMask, protocol, pressureForm, thirdAxisForm });
      for (const registry of endpointRegistries.values()) if (registry.state().outputGrant === grant && binding.addresses.some(address => !registry.allowsAddress({ ...address, protocol }))) throw new Error('The accepted MPE span is outside the active endpoint protocol or function blocks');
      const outputId = 'native-midi:' + owner.logicalDestination + ':' + binding.manager.group + ':' + binding.manager.channel;
      for (const route of routes.values()) if (route.outputId !== outputId && route.grant === grant && current(route) &&
          (route.mpe?.addresses || [route]).some(used => binding.addresses.some(address => address.group === used.group && address.channel === used.channel))) throw new Error('Accepted MPE allocation overlaps an active application route');
      const base = bind({ laneId, grant, group: binding.manager.group, channel: binding.manager.channel, protocol });
      const route = Object.freeze({ ...base, groupRevisions: Object.freeze([...new Set(binding.addresses.map(row => row.group))].map(group => Object.freeze([group, owner.groupRevisions[group]]))), expressionMode: 'ci-mpe-profile', mpe: binding, independentSamePitchVoices: true });
      profileClaims.set(outputId, { grant, binding, current: () => session.isBindingCurrent(binding) }); routes.set(outputId, route); notify(); return route;
    },
    allocateDedicated(laneIds, { grant, protocol = 'midi2' }) {
      const owner = grants.get(grant); if (!owner || owner.direction !== 'output' || !Array.isArray(laneIds) || laneIds.length > 1024 || new Set(laneIds).size !== laneIds.length) throw new Error('Invalid native lane allocation');
      const addresses = [];
      for (let group = 0; group < 16; group++) if (owner.groupMask & 1 << group) for (let channel = 0; channel < 16; channel++) {
        const id = 'native-midi:' + owner.logicalDestination + ':' + group + ':' + channel;
        if (!routes.has(id) && [...endpointRegistries.values()].every(registry => registry.state().outputGrant !== grant || registry.allowsAddress({ group, protocol })) && routes.size + addresses.length < 1024) addresses.push({ group, channel });
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
      clock: client.clockStatus(), nativeRetirements: Object.freeze([...nativeRetirements.values()]), endpointRegistries: Object.freeze([...endpointRegistries.values()].map(registry => registry.state())), ingress: ingress.state(), traceRecords: trace.length, traceWords, omittedTrace }); },
    recordSubmission({ words, receipt, provenance }) {
      const retained = Object.freeze({ connectionEpoch: receipt.session, grant: receipt.grant, execution: receipt.execution, receipt: Object.freeze({ ...receipt }), provenance,
        words: Object.freeze(words.slice(0, receipt.acceptedWords || 0)), unconfirmedWords: receipt.submissionExtent === 'unobserved-batch' ? Object.freeze([...words]) : null, unconfirmedPacket: receipt.failedPacketUnconfirmed && receipt.submissionExtent !== 'unobserved-batch' ? Object.freeze(words.slice(receipt.failureWordOffset, receipt.failureWordOffset + UMP_WORD_COUNTS[words[receipt.failureWordOffset] >>> 28])) : null });
      traceWords += retained.words.length + (retained.unconfirmedPacket?.length || 0) + (retained.unconfirmedWords?.length || 0); trace.push(retained);
      while (trace.length > 4096 || traceWords > 65536) { const oldest = trace.shift(); traceWords -= oldest.words.length + (oldest.unconfirmedPacket?.length || 0) + (oldest.unconfirmedWords?.length || 0); omittedTrace++; }
      try { onTrace(retained); } catch {} return retained;
    },
    receivedScoreContext({ grant, group }) { return Object.freeze([...receivedContexts.values()].filter(row => row.grant === grant && row.group === group)); },
    wireTrace() { return Object.freeze({ schema: 'lemmings-native-wire-trace/v1', claim: 'native-driver-submitted-prefix-not-receiver-or-acoustic', omittedRecords: omittedTrace, records: Object.freeze([...trace]) }); },
    async closeGrant(grant) { const receipt = await client.closeGrant(grant); if (receipt.nativeCloseConfirmed !== true || (receipt.cleanupUnconfirmedNotes || receipt.cleanupUnconfirmedControls)) throw new Error('Native closure or owned-note cleanup is unconfirmed'); grants.delete(grant); forgetControllerChanges(grant); for (const [id, route] of routes) if (route.grant === grant) { routes.delete(id); profileClaims.delete(id); patchClaims.delete(id); } notify(); return receipt; },
    disconnect() { client.disconnect(); ingress.clearGrants(); grants.clear(); inventory = null; notify(); },
    dispose() { if (disposal) return disposal; disposed = true; unsubscribe(); unsubscribeInput(); for (const scopes of profileSessions.values()) for (const profile of scopes.values()) profile.dispose(); profileSessions.clear(); for (const report of reportSessions.values()) report.dispose(); reportSessions.clear(); ingress.dispose(); disposal = (async () => { const capture = await Promise.allSettled([Promise.resolve().then(() => outputCapture.dispose()), ...[...exportArtifacts].map(artifact => Promise.resolve().then(() => artifact.release()))]); await Promise.allSettled([...parameterCatalogs.values()].flatMap(peers => [...peers.values()]).map(catalog => catalog.dispose())); parameterCatalogs.clear(); const endpoints = await Promise.allSettled([...endpointRegistries.values()].map(registry => registry.dispose())); endpointRegistries.clear(); const patches = await Promise.allSettled([...patchCatalogs.values()].flatMap(peers => [...peers.values()]).map(catalog => catalog.dispose())); patchCatalogs.clear(); const properties = await Promise.allSettled([...propertyClients.values()].flatMap(peers => [...peers.values()]).map(client => client.dispose())); propertyClients.clear(); const ci = await Promise.allSettled([...ciSessions].map(session => session.dispose())); const devices = await Promise.allSettled([...grants.keys()].map(async grant => { const receipt = await client.closeGrant(grant); if (receipt.nativeCloseConfirmed !== true || (receipt.cleanupUnconfirmedNotes || receipt.cleanupUnconfirmedControls)) throw new Error('Native closure or cleanup remains unconfirmed'); })); client.disconnect(); controllerPolicies.dispose(); const failures = [...capture, ...endpoints, ...patches, ...properties, ...ci, ...devices].filter(result => result.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Native MIDI retirement has ' + failures.length + ' unconfirmed resources'); ciSessions.clear(); grants.clear(); routes.clear(); auxiliaryRoutes.clear(); controllerChanges.clear(); groupInvalidations.clear(); receivedContexts.clear(); profileClaims.clear(); patchClaims.clear(); listeners.clear(); trace.length = traceWords = 0; })(); return disposal; }
  });
  return api;
}
