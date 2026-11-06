import { createMidiControllerMutations } from '../protocol/MidiControllerMutations.js';
import { encodeIntent } from '../protocol/UmpPacketCodec.js';
import { normalizeDeviceParameters, normalizeControllerMap, validateDeviceParameterMappings, mapDeviceParameterSource, encodeDeviceParameter, quantizeDeviceParameter } from './DeviceParameter.js';
import { scaleMidiResolution } from '../protocol/MidiProtocolLowering.js';

const projected = (parameter, raw) => quantizeDeviceParameter(parameter, raw, { projectEnumeration: true });
const fingerprint = peer => JSON.stringify(peer?.identity || null);
const intentSignature = mapping => JSON.stringify([mapping.stableId, mapping.signature, mapping.deviceFingerprint, mapping.source, mapping.inputMinimum, mapping.inputMaximum, mapping.curve, mapping.exponent, mapping.smoothingMs, mapping.deadband, mapping.pickup, mapping.scope]);
const result = (status, reason = null, fields = {}) => Object.freeze({ status, reason, ...fields });
export function createDeviceParameterCatalog({ routes, ci, properties, peerMuid } = {}) {
  const scope = ci.state(), initialPeer = ci.getPeer(peerMuid), listeners = new Set(), values = new Map(), active = new Map(), wireParameters = new Map(), mutations = createMidiControllerMutations({ maximumEntries: 512 }), automation = [];
  let capturing = false, automationBytes = 0, mutationSequence = 0, observedGroupRevisions = null;
  const parameterScopes = new Map();
  if (!initialPeer || properties.state().ciEpoch !== scope.epoch) throw new Error('Choose a current discovered Property Exchange peer');
  let closing = false, writeCompletion = Promise.resolve(), finishWrite = null;
  let disposed = false, loading = false, generation = 0, parameters = [], revision = 0, deviceRevision = null, latest = null, writing = false, disposal = null;
  const grantState = () => routes.grantState?.(scope.outputGrant) || routes.state().grants.find(row => row.grant === scope.outputGrant);
  const currentRevision = () => grantState()?.deviceRevision ?? null;
  const current = () => !disposed && !closing && routes.isGrantActive(scope.outputGrant) && ci.state().epoch === scope.epoch && !!ci.getPeer(peerMuid) && !properties.state().stale;
  const ready = () => current() && deviceRevision === currentRevision() && !properties.state().resourcesStale;
  const emit = () => { for (const listener of listeners) { try { listener(); } catch {} } };
  const valueKey = (parameter, note) => parameter.stableId + ':' + (parameter.scope === 'note' ? note : '-');
  const baseline = (parameter, note = null) => values.get(valueKey(parameter, note)) || Object.freeze({ known: false, value: null, revision: 0, reason: 'not-observed', pending: false });
  const wireKey = parameter => JSON.stringify([parameter.propertyChannel, parameter.ctrlType, parameter.ctrlIndex]);
  const mutationAddress = (parameter, previousTarget = null) => { const target = previousTarget || address(parameter); return target && ['rpn', 'nrpn'].includes(parameter.ctrlType) ? { endpointId: 'native-grant:' + scope.outputGrant + ':peer:' + peerMuid, connectionEpoch: scope.connectionEpoch, group: target.group, channel: target.channel + 1, kind: parameter.ctrlType === 'rpn' ? 'registered' : 'assignable', bank: parameter.ctrlIndex[0], index: parameter.ctrlIndex[1] } : null; };
  const observe = (parameter, value, { note = null, delta = null, origin = 'device-input', packet = null } = {}) => {
    const key = valueKey(parameter, note), previous = baseline(parameter, note);
    if (!values.has(key) && values.size >= 4096) return;
    const next = delta == null ? value : previous.known ? Math.max(parameter.minimum, Math.min(parameter.maximum, previous.value + delta)) : null;
    const controllerParameter = wireParameters.get(wireKey(parameter))?.find(row => row.writable) || parameter;
    const controller = mutationAddress(controllerParameter); if (controller) {
      mutations.invalidate(controller);
      if (next != null && next >= controllerParameter.minimum && next <= controllerParameter.maximum) mutations.bind({ address: controller, descriptor: { significantBits: controllerParameter.sourceResolution, absolute: true, relative: true, minimumRaw: controllerParameter.minimum, maximumRaw: controllerParameter.maximum, quantization: 'nearest' }, rawValue: next, authority: 'device-report', sourceRef: origin });
    }
    values.set(key, Object.freeze({ known: next != null, value: next, observedValue: next, revision: ++revision, origin, pending: false,
      reason: next == null ? 'relative-change-without-observed-baseline' : 'device-changed-value', relativeTotal: delta != null && next == null ? Math.max(-Number.MAX_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, (previous.relativeTotal || 0) + delta)) : 0,
      desired: previous.desired ?? null, editRevision: previous.editRevision || 0 }));
    if (capturing && packet && parameter.scope === 'channel') {
      const target = address(parameter), supported = parameter.writable && ['absolute', 'both'].includes(parameter.recognize);
      const replay = next != null && next >= parameter.minimum && next <= parameter.maximum ? Object.freeze({ operation: 'set', rawValue: next, umpWords: encodeDeviceParameter({ ...parameter, writable: true, recognize: 'absolute' }, { ...target, protocol: 'midi2' }, { value: projected(parameter, next) }), baselineDependent: false, supported }) : delta != null ? Object.freeze({ operation: 'relative', rawValue: delta, umpWords: packet.words, baselineDependent: true, supported: parameter.writable && ['relative', 'both'].includes(parameter.recognize), selection: 'explicit-baseline-dependent-replay-required' }) : null;
      const record = Object.freeze({ gesture: Object.freeze({ schema: 'lemmings-control-mutation/v1', stableId: parameter.stableId, descriptorSignature: parameter.signature, operation: delta == null ? 'set' : 'relative', rawValue: delta ?? value, sourcePrecision: parameter.sourceResolution, sequence: ++mutationSequence, epoch: scope.connectionEpoch, baselineRevision: previous.revision, gestureId: globalThis.crypto.randomUUID(), causeIds: Object.freeze([]), hostTimeMs: routes.client.now(), origin: 'native-device-input' }), accepted: true, receiverValue: next, actualWords: packet.words, replay });
      const estimate = JSON.stringify(record).length * 2;
      if (automation.length >= 512 || automationBytes + estimate > 1048576) { capturing = false; latest = result('capture-stopped', 'Controller capture capacity reached; subsequent device movements are not recorded'); }
      else { automation.push(record); automationBytes += estimate; }
    }
  };
  const receive = (parameter, value, options) => {
    const siblings = wireParameters.get(wireKey(parameter)) || [parameter], recorded = siblings.find(row => row.writable) || parameter;
    for (const row of siblings) observe(row, value, { ...options, packet: row === recorded ? options.packet : null });
  };
  const address = parameter => routes.resolvePropertyChannel(ci, peerMuid, parameter.propertyChannel);
  const parameterFor = stableId => parameters.find(row => row.stableId === stableId);
  const invalidate = reason => { generation++; active.clear(); mutations.clear(); capturing = false; deviceRevision = null; for (const [key, value] of values) values.set(key, Object.freeze({ ...value, known: false, pending: false, reason, revision: ++revision })); latest = result('stale', reason); emit(); };
  const getRecord = async (resource, options, owned) => {
    const response = await properties.get(resource, { ...options, isCurrent: () => current() && generation === owned });
    if (!current() || generation !== owned) throw new Error('Device controller discovery changed');
    if (response.status !== 'ok' || !response.record || response.record.mediaType !== 'application/json' || response.record.stale) throw new Error(response.reason || resource + ' is unavailable');
    return response.record;
  };
  const consumePacket = event => {
    if (!ready() || event.grant !== scope.inputGrant || event.event !== 'native-packet' || !event.dispatchable) return;
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
      if (value != null && ['absolute', 'both'].includes(parameter.transmit)) receive(parameter, value, { note, packet });
      else if (delta != null && ['relative', 'both'].includes(parameter.transmit)) receive(parameter, null, { note, delta, packet });
    }
    emit();
  };
  const removeInput = routes.input.subscribe(event => { if (event.grant !== scope.inputGrant) return; if (event.event === 'ingress-loss') invalidate(event.reason); else consumePacket(event); });
  const removeCi = ci.subscribe(() => { if (!current()) invalidate('Device controller peer changed'); });
  const removeProperties = properties.subscribeObservations(event => {
    if (!current()) { invalidate('Device controller resource peer is stale'); return; }
    if (!loading && event?.record && ['AllCtrlList', 'ChCtrlList', 'CtrlMapList', 'ChannelList'].includes(event.record.resource)) invalidate('Device controller metadata changed; review mappings again');
  });
  const removeRoutes = routes.subscribe(() => {
    if (deviceRevision != null && currentRevision() !== deviceRevision) { invalidate('Device state changed; rediscover controllers'); return; }
    const next = grantState()?.groupRevisions; if (!next || next === observedGroupRevisions) return;
    if (observedGroupRevisions) for (const parameter of parameters) {
      const previous = parameterScopes.get(parameter.stableId), target = address(parameter);
      if (![previous?.group, target?.group].some(group => group != null && next[group] !== observedGroupRevisions[group])) continue;
      for (const candidate of [previous, target]) { const controller = candidate && mutationAddress(parameter, candidate); if (controller) mutations.invalidate(controller); }
      for (const [key, value] of values) if (key.startsWith(parameter.stableId + ':')) values.set(key, Object.freeze({ ...value, known: false, value: null, localValue: null, rawAccumulator: null, pending: false, reason: 'device-controller-group-changed', revision: ++revision }));
      for (const [key, claim] of active) if (claim.mapping.stableId === parameter.stableId) active.delete(key);
    }
    observedGroupRevisions = next; emit();
  });
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
        parameters = next; wireParameters.clear(); for (const parameter of next) { const key = wireKey(parameter), siblings = wireParameters.get(key) || []; siblings.push(parameter); wireParameters.set(key, siblings); } values.clear(); mutations.clear(); parameterScopes.clear(); for (const parameter of next) parameterScopes.set(parameter.stableId, address(parameter)); observedGroupRevisions = grantState()?.groupRevisions || null; deviceRevision = currentRevision(); latest = result('ok', null, { count: next.length }); return latest;
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
    recognizesController({ group, channel, bank, index }) { return ready() && parameters.some(parameter => { const target = address(parameter); return parameter.ctrlType === 'rpn' && parameter.ctrlIndex[0] === bank && parameter.ctrlIndex[1] === index && ['absolute', 'both'].includes(parameter.recognize) && target?.group === group && target.channel === channel; }); },
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
        const controller = mutationAddress(parameter); if (controller) mutations.invalidate(controller);
        words.push(...encodeDeviceParameter(parameter, route, { value })); observations.push(Object.freeze({ stableId: parameter.stableId, value, source: mapping.source, sourceResolution: parameter.sourceResolution }));
      }
      return Object.freeze({ words: Object.freeze(words), observations: Object.freeze(observations) });
    },
    async write(stableId, { target, value, delta = null, expectedRevision, confirmed = false, sequence = null, gestureId = null, causeIds = [] } = {}) {
      const parameter = parameterFor(stableId), before = parameter && baseline(parameter, target?.note), resolved = parameter && address(parameter);
      if (!ready() || !parameter || !resolved || writing || confirmed !== true || target?.grant !== scope.outputGrant || target.group !== resolved.group || target.channel !== resolved.channel ||
          expectedRevision !== before.revision || parameter.scope === 'note') return result('rejected', 'Review this current channel control and its latest observed revision at a stopped boundary');
      let hold, wireExecution = null, sent = false; writing = true; writeCompletion = new Promise(resolve => { finishWrite = resolve; });
      try {
        hold = routes.holdForObservation(scope.outputGrant);
        if (sequence != null && (!Number.isSafeInteger(sequence) || sequence <= mutationSequence) || gestureId != null && (typeof gestureId !== 'string' || !gestureId || gestureId.length > 128) || !Array.isArray(causeIds) || causeIds.length > 16 || causeIds.some(id => typeof id !== 'string' || !id || id.length > 128)) throw new Error('Invalid or out-of-order controller gesture identity');
        if (delta != null && (!['rpn', 'nrpn'].includes(parameter.ctrlType) || !Number.isInteger(delta) || delta < -2147483648 || delta > 2147483647)) throw new Error('Relative gestures require a registered or assignable signed 32-bit controller');
        const controller = mutationAddress(parameter), owned = controller ? mutations.read(controller) : null;
        const semanticWords = controller ? encodeIntent({ group: target.group, channel: target.channel, status: delta == null ? parameter.ctrlType === 'rpn' ? 'registeredController' : 'assignableController' : parameter.ctrlType === 'rpn' ? 'relativeRegisteredController' : 'relativeAssignableController', bank: parameter.ctrlIndex[0], index: parameter.ctrlIndex[1], controllerValue: { value: delta ?? value, bits: 32, ...(delta == null ? {} : { signed: true }) } }) : null;
        const selectedSequence = sequence ?? mutationSequence + 1, plan = owned?.known ? mutations.prepare(semanticWords, { endpointId: controller.endpointId, connectionEpoch: controller.connectionEpoch, sequence: selectedSequence, timestamp: routes.client.now(), baselineRevision: owned.revision }) : null;
        if (plan && !plan.ok) throw new Error(plan.reason);
        let requested = value, increment = delta;
        if (delta != null && (target.protocol !== 'midi2' || !['relative', 'both'].includes(parameter.recognize))) {
          if (!plan?.ok || !['absolute', 'both'].includes(parameter.recognize)) throw new Error('This lowering requires an authoritative current baseline and recognized absolute form; CC96/97 is not substituted');
          requested = projected(parameter, plan.rawValue); increment = null;
        }
        const words = encodeDeviceParameter(parameter, target, { value: requested, delta: increment }), key = valueKey(parameter);
        const gesture = Object.freeze({ schema: 'lemmings-control-mutation/v1', stableId, descriptorSignature: parameter.signature, operation: delta == null ? 'set' : 'relative', rawValue: delta ?? value, sourcePrecision: parameter.sourceResolution,
          sequence: selectedSequence, epoch: scope.connectionEpoch, baselineRevision: owned?.revision ?? null, gestureId: gestureId || globalThis.crypto.randomUUID(), causeIds: Object.freeze([...causeIds]), hostTimeMs: routes.client.now() });
        const captureEstimate = JSON.stringify(gesture).length * 2 + words.length * 8 + 512;
        if (capturing && (automation.length >= 512 || automationBytes + captureEstimate > 1048576)) throw new Error('Controller automation capture capacity; stop or clear capture before another gesture');
        mutationSequence = selectedSequence;
        const edit = Object.freeze({ ...before, origin: 'local-request', known: false, value: null, observedValue: before.observedValue ?? before.value, desired: increment == null ? requested : null, desiredDelta: increment, editRevision: ++revision, revision, pending: true, reason: 'pending-driver-submission' });
        values.set(key, edit); emit(); wireExecution = routes.allocateExecutionEpoch();
        const provenance = Object.freeze({ schema: 'lemmings-device-parameter-write/v1', stableId, descriptorRevision: parameter.revision, expectedObservationRevision: expectedRevision, value: requested, delta: increment, sourceResolution: parameter.sourceResolution, gesture });
        let receipt;
        try { sent = true; receipt = await routes.client.sendBatch({ grant: scope.outputGrant, execution: wireExecution, priority: 2, targetTimeMs: routes.client.now() + 10, words, provenance }); }
        catch (error) { receipt = { session: scope.connectionEpoch, grant: scope.outputGrant, execution: wireExecution, kind: 'error', acceptedWords: 0, acceptedPackets: 0, failedPacketUnconfirmed: error.notSubmitted !== true, submissionExtent: error.notSubmitted ? 'observed-prefix' : 'unobserved-batch', reason: error.message }; }
        routes.recordSubmission({ words, receipt, provenance });
        const accepted = receipt.kind === 'driver-submitted', unchanged = values.get(key) === edit && ready();
        let resolved = null;
        if (controller) {
          if (accepted && unchanged && plan?.ok) { const committed = mutations.commit(plan); if (committed.ok) resolved = committed.rawValue; }
          else if (accepted && unchanged && delta == null) { const bound = mutations.bind({ address: controller, descriptor: { significantBits: parameter.sourceResolution, absolute: true, relative: true, minimumRaw: parameter.minimum, maximumRaw: parameter.maximum, quantization: 'nearest' }, rawValue: requested, authority: 'local-authored', sourceRef: gesture.gestureId, expectedRevision: owned?.revision ?? null }); if (bound.ok) resolved = bound.rawValue; }
          else if (!accepted && (receipt.acceptedWords > 0 || receipt.failedPacketUnconfirmed || receipt.submissionExtent === 'unobserved-batch')) mutations.invalidate(controller);
        } else if (accepted && unchanged && delta == null) resolved = requested;
        if (unchanged) values.set(key, Object.freeze({ ...edit, pending: false, localValue: resolved == null ? null : projected(parameter, resolved), rawAccumulator: resolved, rawRemainder: resolved == null ? null : resolved - projected(parameter, resolved),
          reason: accepted ? 'driver-submitted-receiver-value-unconfirmed' : 'rejected-or-unconfirmed' }));
        const absolute = resolved == null ? null : encodeDeviceParameter({ ...parameter, writable: true, recognize: 'absolute' }, { ...target, protocol: 'midi2' }, { value: projected(parameter, resolved) });
        const record = Object.freeze({ gesture, accepted, receiverValue: null, actualWords: Object.freeze([...words]), replay: resolved != null && accepted ? Object.freeze({ operation: 'set', rawValue: resolved, umpWords: absolute, baselineDependent: false, supported: parameter.writable && ['absolute', 'both'].includes(parameter.recognize) }) : delta != null && accepted ? Object.freeze({ operation: 'relative', rawValue: delta, umpWords: semanticWords, baselineDependent: true, supported: true, selection: 'explicit-baseline-dependent-replay-required' }) : null });
        if (capturing) { automation.push(record); automationBytes += captureEstimate; }
        latest = result(accepted ? 'submitted' : 'incomplete', receipt.reason, { receipt, receiverState: 'unknown', controllerMutation: record }); return latest;
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
    replayMutation(record, { target, confirmed = false, allowBaselineDependent = false } = {}) {
      const parameter = parameterFor(record?.gesture?.stableId), replay = record?.replay;
      if (!ready() || !record?.accepted || !parameter || parameter.signature !== record.gesture.descriptorSignature || !replay?.supported || replay.baselineDependent && allowBaselineDependent !== true || capturing) return Promise.resolve(result('rejected', 'Review this descriptor and explicitly select any baseline-dependent raw replay with capture stopped'));
      return api.write(parameter.stableId, { target, ...(replay.operation === 'set' ? { value: projected(parameter, replay.rawValue) } : { delta: replay.rawValue }), expectedRevision: baseline(parameter).revision, confirmed, causeIds: record.gesture.causeIds || [], gestureId: globalThis.crypto.randomUUID() });
    },
    startAutomationCapture() { if (!ready() || writing || capturing) throw new Error('Choose an idle current controller catalog'); capturing = true; emit(); },
    stopAutomationCapture() { capturing = false; emit(); },
    clearAutomation() { if (writing) throw new Error('Wait for the current gesture before clearing capture'); automation.length = automationBytes = 0; emit(); },
    automation({ includeBaselineDependent = false } = {}) { if (automation.some(row => row.replay?.baselineDependent) && includeBaselineDependent !== true) throw new Error('This capture includes unknown-baseline relative replay; explicitly include it or capture resolved absolute controls'); return Object.freeze({ schema: 'lemmings-device-controller-automation/v1', deviceIdentity: Object.freeze({ ...initialPeer.identity }), connectionEpoch: scope.connectionEpoch, claim: 'ordered-local-requested-state-not-receiver-confirmation', baselineDependent: automation.some(row => row.replay?.baselineDependent), records: Object.freeze([...automation]) }); },
    baseline: (stableId, note = null) => { const parameter = parameterFor(stableId); return parameter ? baseline(parameter, note) : Object.freeze({ known: false, revision: 0, reason: 'missing-parameter' }); },
    state: () => Object.freeze({ disposed, stale: !ready(), loading, writing, peerMuid, outputGrant: scope.outputGrant, parameters, activeBindings: active.size, revision, latest, capturing, automationRecords: automation.length, automationBytes, controllerOwner: mutations.diagnostics() }),
    subscribe(listener) { if (disposed || listeners.size >= 8 || typeof listener !== 'function') throw new Error('Controller observer capacity'); listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { if (disposal) return disposal; closing = true; generation++; active.clear(); removeInput(); removeCi(); removeProperties(); removeRoutes(); disposal = writeCompletion.then(() => { disposed = true; parameters = []; values.clear(); wireParameters.clear(); parameterScopes.clear(); mutations.dispose(); automation.length = automationBytes = 0; listeners.clear(); }); return disposal; }
  });
  return api;
}
