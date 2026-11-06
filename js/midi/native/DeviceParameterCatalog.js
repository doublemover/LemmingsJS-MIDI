import { normalizeDeviceParameters, normalizeControllerMap, validateDeviceParameterMappings, mapDeviceParameterSource, encodeDeviceParameter } from './DeviceParameter.js';
import { scaleMidiResolution } from '../protocol/MidiProtocolLowering.js';

const fingerprint = peer => JSON.stringify(peer?.identity || null);
const intentSignature = mapping => JSON.stringify([mapping.stableId, mapping.signature, mapping.deviceFingerprint, mapping.source, mapping.inputMinimum, mapping.inputMaximum, mapping.curve, mapping.exponent, mapping.smoothingMs, mapping.deadband, mapping.pickup, mapping.scope]);
const result = (status, reason = null, fields = {}) => Object.freeze({ status, reason, ...fields });
export function createDeviceParameterCatalog({ routes, ci, properties, peerMuid } = {}) {
  const scope = ci.state(), initialPeer = ci.getPeer(peerMuid), listeners = new Set(), values = new Map(), active = new Map();
  if (!initialPeer || properties.state().ciEpoch !== scope.epoch) throw new Error('Choose a current discovered Property Exchange peer');
  let closing = false, writeCompletion = Promise.resolve(), finishWrite = null;
  let disposed = false, loading = false, generation = 0, parameters = [], revision = 0, deviceRevision = null, latest = null, writing = false, disposal = null;
  const currentRevision = () => routes.state().grants.find(row => row.grant === scope.outputGrant)?.deviceRevision ?? null;
  const current = () => !disposed && !closing && routes.isGrantActive(scope.outputGrant) && ci.state().epoch === scope.epoch && !!ci.getPeer(peerMuid) && !properties.state().stale;
  const ready = () => current() && deviceRevision === currentRevision() && !properties.state().resourcesStale;
  const emit = () => { for (const listener of listeners) { try { listener(); } catch {} } };
  const valueKey = (parameter, note) => parameter.stableId + ':' + (parameter.scope === 'note' ? note : '-');
  const baseline = (parameter, note = null) => values.get(valueKey(parameter, note)) || Object.freeze({ known: false, value: null, revision: 0, reason: 'not-observed', pending: false });
  const observe = (parameter, value, { note = null, delta = null, origin = 'device-input' } = {}) => {
    const key = valueKey(parameter, note), previous = baseline(parameter, note);
    if (!values.has(key) && values.size >= 4096) return;
    const next = delta == null ? value : previous.known ? Math.max(parameter.minimum, Math.min(parameter.maximum, previous.value + delta)) : null;
    values.set(key, Object.freeze({ known: next != null, value: next, revision: ++revision, origin, pending: false,
      reason: next == null ? 'relative-change-without-observed-baseline' : 'device-changed-value', relativeTotal: delta != null && next == null ? Math.max(-Number.MAX_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, (previous.relativeTotal || 0) + delta)) : 0,
      desired: previous.desired ?? null, editRevision: previous.editRevision || 0 }));
  };
  const address = parameter => routes.resolvePropertyChannel(ci, peerMuid, parameter.propertyChannel);
  const parameterFor = stableId => parameters.find(row => row.stableId === stableId);
  const invalidate = reason => { generation++; active.clear(); deviceRevision = null; for (const [key, value] of values) values.set(key, Object.freeze({ ...value, known: false, pending: false, reason, revision: ++revision })); latest = result('stale', reason); emit(); };
  const getRecord = async (resource, options, owned) => {
    const response = await properties.get(resource, { ...options, isCurrent: () => current() && generation === owned });
    if (!current() || generation !== owned) throw new Error('Device controller discovery changed');
    if (response.status !== 'ok' || !response.record || response.record.mediaType !== 'application/json' || response.record.stale) throw new Error(response.reason || resource + ' is unavailable');
    return response.record;
  };
  const consumePacket = event => {
    if (!ready() || event.grant !== scope.inputGrant || event.event !== 'native-packet' || !routes.allowsOrdinaryInput() || !event.dispatchable) return;
    const packet = event.packet, midi2 = packet.kind === 'midi2-channel-voice';
    if (!midi2 && packet.kind !== 'midi1-channel-voice') return;
    const status = packet.status, data = packet.data, note = midi2 ? packet.note : data?.[0];
    for (const parameter of parameters) {
      const target = address(parameter); if (!parameter.readable || !target || target.group !== packet.group || target.channel !== packet.channel) continue;
      const type = parameter.ctrlType, index = parameter.ctrlIndex;
      let value = null, delta = null;
      if (type === 'cc' && status === 'controlChange' && (midi2 ? packet.controller : data[0]) === index[0] && (midi2 || index.length === 1)) value = midi2 ? packet.controllerValue.value : scaleMidiResolution(data[1], 7, 32);
      else if (type === 'chPress' && status === 'channelPressure') value = midi2 ? packet.controllerValue.value : scaleMidiResolution(data[0], 7, 32);
      else if (type === 'pPress' && status === 'polyPressure') value = midi2 ? packet.controllerValue.value : scaleMidiResolution(data[1], 7, 32);
      else if (type === 'pBend' && status === 'pitchBend') value = midi2 ? packet.controllerValue.value : scaleMidiResolution(data[0] | data[1] << 7, 14, 32);
      else if (midi2 && ['rpn', 'nrpn'].includes(type) && packet.bank === index[0] && packet.index === index[1]) {
        if (status === (type === 'rpn' ? 'registeredController' : 'assignableController')) value = packet.controllerValue.value;
        else if (status === (type === 'rpn' ? 'relativeRegisteredController' : 'relativeAssignableController')) delta = packet.controllerValue.value;
      } else if (midi2 && ['pnrc', 'pnac', 'pnp'].includes(type) && status === ({ pnrc: 'registeredPerNoteController', pnac: 'assignablePerNoteController', pnp: 'perNotePitchBend' })[type] &&
          (type === 'pnp' || packet.controller === index[0])) value = packet.controllerValue.value;
      if (value != null && ['absolute', 'both'].includes(parameter.transmit)) observe(parameter, value, { note });
      else if (delta != null && ['relative', 'both'].includes(parameter.transmit)) observe(parameter, null, { note, delta });
    }
    emit();
  };
  const removeInput = routes.input.subscribe(event => { if (event.grant !== scope.inputGrant) return; if (event.event === 'ingress-loss') invalidate(event.reason); else consumePacket(event); });
  const removeCi = ci.subscribe(() => { if (!current()) invalidate('Device controller peer changed'); });
  const removeProperties = properties.subscribeObservations(event => {
    if (!current()) { invalidate('Device controller resource peer is stale'); return; }
    if (!loading && event?.record && ['AllCtrlList', 'ChCtrlList', 'CtrlMapList', 'ChannelList'].includes(event.record.resource)) invalidate('Device controller metadata changed; review mappings again');
  });
  const removeRoutes = routes.subscribe(() => { if (deviceRevision != null && currentRevision() !== deviceRevision) invalidate('Device state changed; rediscover controllers'); });
  const api = Object.freeze({
    async load({ resource = 'AllCtrlList', propertyChannel = null, resId = null } = {}) {
      if (loading || writing || !current()) return result('rejected', 'Device controller discovery is busy or stale');
      loading = true; const owned = ++generation; active.clear(); emit();
      try {
        const discovered = await properties.discoverResources(); if (discovered.status !== 'ok') throw new Error(discovered.reason || 'Resource discovery failed');
        if (resource === 'ChCtrlList') {
          const channels = await getRecord('ChannelList', {}, owned), row = channels.data?.find(value => value.channel === propertyChannel);
          if (!row || !Array.isArray(row.links) || !row.links.some(link => link.resource === 'ChCtrlList' && link.resId === resId && link.role !== 'cluster')) throw new Error('Select a channel-owned ChCtrlList link from ChannelList');
        } else if (resource !== 'AllCtrlList') throw new Error('Unsupported controller resource');
        const record = await getRecord(resource, resId ? { resId } : {}, owned), maps = new Map();
        if (!Array.isArray(record.data) || record.data.length > 512) throw new Error('Controller-list capacity');
        const ids = [...new Set(record.data.map(row => row.ctrlMapId).filter(Boolean))]; if (ids.length > 32) throw new Error('Controller-map capacity');
        for (const id of ids) { const map = await getRecord('CtrlMapList', { resId: id }, owned); maps.set(id, normalizeControllerMap(map.data)); }
        const next = normalizeDeviceParameters(record.data, { resource, resId, channel: propertyChannel, mapValues: maps, revision: record.revision });
        if (JSON.stringify(next).length > 1048576) throw new Error('Aggregate controller descriptor capacity');
        parameters = next; values.clear(); deviceRevision = currentRevision(); latest = result('ok', null, { count: next.length }); return latest;
      } catch (error) { parameters = []; deviceRevision = null; latest = result('incomplete', error.message); return latest; }
      finally { loading = false; emit(); }
    },
    async channelLinks() {
      if (!current()) throw new Error('Device controller peer is stale');
      const owned = generation, discovery = await properties.discoverResources(); if (discovery.status !== 'ok') throw new Error(discovery.reason || 'Resource discovery failed');
      const record = await getRecord('ChannelList', {}, owned);
      if (!Array.isArray(record.data) || record.data.length > 256) throw new Error('ChannelList capacity');
      return Object.freeze(record.data.flatMap(row => (row.links || []).filter(link => link.resource === 'ChCtrlList' && link.role !== 'cluster' && typeof link.resId === 'string').map(link => Object.freeze({ propertyChannel: row.channel, resId: link.resId, title: row.title }))).slice(0, 256));
    },
    intent(stableId, mapping) {
      const parameter = parameterFor(stableId); if (!ready() || !parameter) throw new Error('Refresh this device controller before saving its mapping');
      return validateDeviceParameterMappings([{ ...mapping, schema: 'lemmings-device-parameter-intent/v1', stableId, signature: parameter.signature,
        cachedDescriptor: parameter, deviceFingerprint: fingerprint(initialPeer), scope: parameter.scope }])[0];
    },
    activate(laneId, intent, route) {
      const mapping = validateDeviceParameterMappings([intent])[0], parameter = parameterFor(mapping.stableId), target = parameter && address(parameter);
      if (!ready() || !parameter || parameter.signature !== mapping.signature || mapping.deviceFingerprint !== fingerprint(ci.getPeer(peerMuid)) || !parameter.writable ||
          !target || route.grant !== scope.outputGrant || route.group !== target.group || route.channel !== target.channel || route.mpe ||
          parameter.type === 'enum' && !parameter.enumValues.length || ['momentary', 'toggle'].includes(parameter.type) && parameter.scope === 'channel' || !['absolute', 'both'].includes(parameter.recognize)) throw new Error('Review a matching current channel route and an absolute writable controller; shared momentary and toggle mappings require a controller-release lease');
      const hold = routes.holdForObservation(scope.outputGrant); routes.releaseObservation(hold);
      if (active.size >= 256 && !active.has(laneId + ':' + mapping.stableId)) throw new Error('Active device-expression mapping capacity');
      active.set(laneId + ':' + mapping.stableId, Object.freeze({ mapping, intentSignature: intentSignature(mapping), outputId: route.outputId, routeRevision: route.routeRevision }));
      emit(); return mapping;
    },
    ownsMapping(laneId, mapping, route) { const claim = active.get(laneId + ':' + mapping.stableId); return ready() && !!claim && claim.outputId === route.outputId && claim.routeRevision === route.routeRevision && claim.intentSignature === intentSignature(mapping); },
    voiceWords(lane, route, intent, state, targetMicroseconds) {
      const words = [], observations = [];
      for (const mapping of lane.deviceParameters || []) {
        const claim = active.get(lane.id + ':' + mapping.stableId), parameter = parameterFor(mapping.stableId);
        if (!ready() || !claim || !parameter || claim.outputId !== route.outputId || claim.routeRevision !== route.routeRevision || claim.intentSignature !== intentSignature(mapping)) throw new Error('Device-expression mapping requires current explicit review');
        const key = mapping.stableId, previous = state.get(key) || { pickedUp: !mapping.pickup };
        state.set(key, previous); const observed = baseline(parameter, route.note), value = mapDeviceParameterSource(parameter, mapping, intent, previous, targetMicroseconds, observed);
        if (value == null) continue;
        words.push(...encodeDeviceParameter(parameter, route, { value })); observations.push(Object.freeze({ stableId: parameter.stableId, value, source: mapping.source, sourceResolution: parameter.sourceResolution }));
      }
      return Object.freeze({ words: Object.freeze(words), observations: Object.freeze(observations) });
    },
    async write(stableId, { target, value, delta = null, expectedRevision, confirmed = false } = {}) {
      const parameter = parameterFor(stableId), before = parameter && baseline(parameter, target?.note), resolved = parameter && address(parameter);
      if (!ready() || !parameter || !resolved || writing || confirmed !== true || target?.grant !== scope.outputGrant || target.group !== resolved.group || target.channel !== resolved.channel ||
          expectedRevision !== before.revision || parameter.scope === 'note') return result('rejected', 'Review this current channel control and its latest observed revision at a stopped boundary');
      let hold, wireExecution = null, sent = false; writing = true; writeCompletion = new Promise(resolve => { finishWrite = resolve; });
      try {
        hold = routes.holdForObservation(scope.outputGrant);
        let requested = value, increment = delta;
        if (delta != null && !['relative', 'both'].includes(parameter.recognize)) { if (!before.known) throw new Error('An observed baseline is required to convert this increment to an absolute value'); requested = Math.max(parameter.minimum, Math.min(parameter.maximum, before.value + delta)); increment = null; }
        const words = encodeDeviceParameter(parameter, target, { value: requested, delta: increment }), key = valueKey(parameter);
        const edit = Object.freeze({ ...before, desired: increment == null ? requested : null, desiredDelta: increment, editRevision: ++revision, revision, pending: true, reason: 'pending-driver-submission' });
        values.set(key, edit); emit(); wireExecution = routes.allocateExecutionEpoch();
        const provenance = Object.freeze({ schema: 'lemmings-device-parameter-write/v1', stableId, descriptorRevision: parameter.revision, expectedObservationRevision: expectedRevision, value: requested, delta: increment, sourceResolution: parameter.sourceResolution });
        let receipt;
        try { sent = true; receipt = await routes.client.sendBatch({ grant: scope.outputGrant, execution: wireExecution, priority: 2, targetTimeMs: routes.client.now() + 10, words, provenance }); }
        catch (error) { receipt = { session: scope.connectionEpoch, grant: scope.outputGrant, execution: wireExecution, kind: 'error', acceptedWords: 0, acceptedPackets: 0, failedPacketUnconfirmed: error.notSubmitted !== true, submissionExtent: error.notSubmitted ? 'observed-prefix' : 'unobserved-batch', reason: error.message }; }
        routes.recordSubmission({ words, receipt, provenance });
        if (values.get(key) === edit) values.set(key, Object.freeze({ ...edit, pending: false, reason: receipt.kind === 'driver-submitted' ? 'driver-submitted-receiver-value-unconfirmed' : 'rejected-or-unconfirmed' }));
        latest = result(receipt.kind === 'driver-submitted' ? 'submitted' : 'incomplete', receipt.reason, { receipt, receiverState: 'unknown' }); return latest;
      } catch (error) { latest = result('rejected', error.message); return latest; }
      finally {
        try { if (sent && routes.client.session === scope.connectionEpoch && routes.isGrantActive(scope.outputGrant) && wireExecution != null) { const receipt = await routes.client.cancelExecution(scope.outputGrant, wireExecution); if (receipt.kind !== 'cancelled-execution' || (receipt.cleanupUnconfirmedNotes || receipt.cleanupUnconfirmedControls)) throw new Error('Device-control retirement remains unconfirmed'); } }
        catch (error) { routes.quarantineDeviceState(scope.outputGrant, error.message); latest = result('incomplete', error.message); }
        if (hold) routes.releaseObservation(hold); writing = false; finishWrite?.(); finishWrite = null; emit(); return latest;
      }
    },
    async readBaseline({ propertyChannel, quiescent = false } = {}) {
      const target = routes.resolvePropertyChannel(ci, peerMuid, propertyChannel);
      if (!ready() || !target || target.group !== scope.group || !routes.allowsOrdinaryInput()) return result('unsupported', 'Use a current isolated CI scope on the controller’s actual group for a message report');
      const captured = revision, report = routes.createMessageReportSession(ci), response = await report.read({ peerMuid, channel: target.channel, controllers: 63, quiescent });
      if (response.status === 'complete' && response.observation && ready()) {
        for (const parameter of parameters) {
          if (parameter.propertyChannel !== propertyChannel || parameter.scope !== 'channel' || baseline(parameter).editRevision > captured) continue;
          const kind = ({ cc: 'controlChange', rpn: 'registeredController', nrpn: 'assignableController', pBend: 'pitchBend', chPress: 'channelPressure' })[parameter.ctrlType];
          const index = ['rpn', 'nrpn'].includes(parameter.ctrlType) ? parameter.ctrlIndex[0] * 128 + parameter.ctrlIndex[1] : parameter.ctrlType === 'cc' ? parameter.ctrlIndex[0] : '';
          const row = response.observation.values.find(row => row.group === target.group && row.channel === target.channel && row.kind === kind && row.index === index && row.baselineUsable !== false);
          if (row && !(parameter.ctrlType === 'cc' && parameter.ctrlIndex.length === 2 && row.wireBits < 32)) observe(parameter, scaleMidiResolution(row.value, row.wireBits, 32), { origin: 'isolated-message-report' });
        }
        emit();
      }
      return response;
    },
    baseline: (stableId, note = null) => { const parameter = parameterFor(stableId); return parameter ? baseline(parameter, note) : Object.freeze({ known: false, revision: 0, reason: 'missing-parameter' }); },
    state: () => Object.freeze({ disposed, stale: !ready(), loading, writing, peerMuid, outputGrant: scope.outputGrant, parameters, activeBindings: active.size, revision, latest }),
    subscribe(listener) { if (disposed || listeners.size >= 8 || typeof listener !== 'function') throw new Error('Controller observer capacity'); listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { if (disposal) return disposal; closing = true; generation++; active.clear(); removeInput(); removeCi(); removeProperties(); removeRoutes(); disposal = writeCompletion.then(() => { disposed = true; parameters = []; values.clear(); listeners.clear(); }); return disposal; }
  });
  return api;
}
