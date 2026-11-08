import { createDeviceStateObservationStore } from './DeviceStateObservation.js';
import { createMidiMessageReportValues } from './MidiMessageReportValues.js';

const categoryMask = (value, maximum) => Number.isInteger(value) && value >= 0 && value <= maximum;
export function createMidiMessageReportSession({ routes, ci, store: suppliedStore = null, now = () => performance.now(), timeoutMs = 2000, maximumMessages = 1024 } = {}) {
  const store = suppliedStore || createDeviceStateObservationStore();
  const listeners = new Set(), capabilities = new Map();
  let readGeneration = 0, active = null, busy = false, disposed = false, serial = 0, latest = null;
  const emit = () => { for (const listener of listeners) { try { listener(); } catch {} } };
  const finish = (status, reason = null, quarantine = false) => {
    const transaction = active; if (!transaction) return; active = null; clearTimeout(transaction.timer);
    routes.input.releaseObservations(transaction.claim); routes.releaseObservation(transaction.hold);
    if (quarantine) routes.input.markLoss({ grant: transaction.scope.inputGrant, session: transaction.scope.connectionEpoch, reason: 'incomplete-message-report' });
    let observation = null;
    if (status === 'complete' && !transaction.probe) {
      try {
        const values = transaction.values.finish();
        observation = store.commit(Object.freeze({ schema: 'lemmings-device-state-observation/v1', complete: true, readOnly: true,
          scope: transaction.scope, requestedCategories: transaction.requested, reportedCategories: transaction.reported,
          missingCategories: Object.freeze(Object.fromEntries(['system', 'controllers', 'notes'].map(key => [key, transaction.requested[key] & ~transaction.reported[key]]))),
          values, policy: 'user-confirmed-isolated-input-and-quiescent-owned-output', startedHostMs: transaction.started, completedHostMs: now(), messageCount: transaction.messages }), transaction.editRevision);
      } catch (error) { status = 'incomplete'; reason = error.message; routes.input.markLoss({ grant: transaction.scope.inputGrant, session: transaction.scope.connectionEpoch, reason: 'incomplete-message-report' }); }
    }
    latest = Object.freeze({ status, reason, observation, reportedCategories: transaction.reported, requestedCategories: transaction.requested,
      scope: transaction.scope, probe: transaction.probe, complete: status === 'complete', messageCount: transaction.messages });
    transaction.resolve(latest); emit();
  };
  const transactionCurrent = transaction => !disposed && active === transaction && ci.state().epoch === transaction.scope.ciEpoch &&
    routes.input.scope(transaction.scope.inputGrant)?.ingressEpoch === transaction.scope.ingressEpoch && !!ci.getPeer(transaction.scope.peerMuid);
  const receive = event => {
    const transaction = active; if (!transaction) return;
    if (!transactionCurrent(transaction) || event.epoch !== transaction.scope.ciEpoch) { finish('incomplete', 'Device report owner changed', true); return; }
    if (event.kind === 'observation') {
      if (transaction.phase !== 'collecting' || transaction.probe) { finish('incomplete', 'Unexpected live/body data outside report brackets', true); return; }
      if (++transaction.messages > maximumMessages || (transaction.bytes += 128 + event.observation.packet.wordCount * 4) > 1048576) { finish('incomplete', 'Device report exceeds its bounded observation budget', true); return; }
      try { transaction.values.accept(event.observation); } catch (error) { finish('incomplete', error.message, true); } return;
    }
    if (event.kind !== 'ci') { finish('incomplete', 'Malformed, foreign or unknown CI activity during isolated report', true); return; }
    const message = event.message;
    if ( message.sourceMuid !== transaction.scope.peerMuid || message.scope !== transaction.deviceScope) { finish('incomplete', 'Ambiguous concurrent CI activity on isolated input', true); return; }
    if (message.subtype === 127 && (message.version === 1 || message.transaction === 66)) { finish(transaction.phase === 'requested' ? 'unsupported' : 'incomplete', 'Device declined the message report', transaction.phase !== 'requested'); return; }
    if (message.subtype === 67) {
      if (transaction.phase !== 'requested') { finish('incomplete', 'Duplicate report begin bracket', true); return; }
      const reported = { system: message.systemTypes, controllers: message.controllerTypes, notes: message.noteTypes };
      if (!categoryMask(reported.system, 7) || !categoryMask(reported.controllers, 63) || !categoryMask(reported.notes, 31) ||
          ['system', 'controllers', 'notes'].some(key => (reported[key] & ~transaction.sent[key]) !== 0)) { finish('incomplete', 'Device report categories exceed the requested subset', true); return; }
      transaction.reported = Object.freeze(reported); transaction.phase = 'collecting'; transaction.values = createMidiMessageReportValues({ scope: transaction.scope, categories: transaction.reported, maximumValues: 4096 }); emit(); return;
    }
    if (message.subtype === 68) {
      if (transaction.phase !== 'collecting') { finish('incomplete', 'Report end without matching begin', true); return; }
      finish('complete'); return;
    }
    finish('incomplete', 'Unexpected CI message during isolated state report', true);
  };
  const unsubscribeProtocol = ci.subscribeProtocol(receive);
  const unsubscribeCi = ci.subscribe(() => { if (active && !transactionCurrent(active)) finish('incomplete', 'Device session or peer became stale', true); });
  const unsubscribeInput = routes.input.subscribe(event => {
    const transaction = active; if (!transaction || event.grant !== transaction.scope.inputGrant) return;
    if (event.event === 'ingress-loss') { finish('incomplete', event.reason || 'Native input loss', true); return; }
    if (event.event === 'native-payload' && event.message.group !== transaction.scope.group ||
        event.event === 'native-packet' && (event.category === 'framing-only' || event.packet.kind === 'stream' && [6, 17].includes(event.packet.status))) finish('incomplete', 'Input metadata or scope changed during device report', true);
  });
  const run = ({ peerMuid, channel, requested, sent, probe, quiescent }) => {
    const state = ci.state(), inputScope = routes.input.scope(state.inputGrant);
    if (!inputScope || !ci.getPeer(peerMuid)) return Promise.resolve(Object.freeze({ status: 'stale', reason: 'Device report scope is stale' }));
    let hold, claim;
    const scope = Object.freeze({ connectionEpoch: state.connectionEpoch, inputGrant: state.inputGrant, outputGrant: state.outputGrant, ciEpoch: state.epoch, ingressEpoch: inputScope.ingressEpoch,
      peerMuid, group: state.group, channel });
    const transaction = { scope, deviceScope: channel == null ? 126 : channel, requested, sent, probe, phase: 'requested', messages: 0, bytes: 0, started: now(), editRevision: store.editRevision(), reported: null, values: null };
    try {
      hold = routes.holdForObservation(state.outputGrant);
      claim = routes.input.claimObservations(state.inputGrant, { token: 'message-report-' + ++serial, groupMask: 1 << state.group, quiescent, maximumPackets: maximumMessages, timeoutMs,
        consume: event => ci.enqueueObservation(event) });
    } catch (error) { if (hold) routes.releaseObservation(hold); return Promise.resolve(Object.freeze({ status: 'rejected', reason: error.message })); }
    let resolve; const completion = new Promise(done => { resolve = done; }); transaction.resolve = resolve; transaction.claim = claim; transaction.hold = hold;
    active = transaction; transaction.timer = setTimeout(() => { if (active === transaction) finish('incomplete', 'Message report timed out before its matching end', true); }, timeoutMs);
    ci.sendReadControl(peerMuid, { operation: 'message-report', deviceScope: transaction.deviceScope, parameters: [probe ? 0 : 127, sent.system, sent.controllers, sent.notes],
      isCurrent: () => transactionCurrent(transaction) }).catch(error => { if (active === transaction) finish('incomplete', error.message, true); });
    emit(); return completion;
  };
  return Object.freeze({
    async read({ peerMuid, channel = 0, controllers = 63, notes = 0, compliance = false, quiescent = false } = {}) {
      if (disposed || busy) return Object.freeze({ status: 'rejected', reason: 'Device report owner is retired or busy' });
      if (routes.client.capabilities?.ciMessageReportCodecVersion !== 1) return Object.freeze({ status: 'unsupported', reason: 'Rebuild the companion for message-report decoding' });
      if (quiescent !== true || !(channel == null || Number.isInteger(channel) && channel >= 0 && channel <= 15) || !categoryMask(controllers, 63) || !categoryMask(notes, 31) || !controllers && !notes || notes && compliance !== true) return Object.freeze({ status: 'rejected', reason: 'Choose an isolated channel/group and explicit controller categories; note reports require compliance mode' });
      const requested = Object.freeze({ system: 0, controllers, notes }), generation = ++readGeneration; busy = true; emit();
      try {
        let peer = ci.getPeer(peerMuid); if (!peer || peer.version !== 2 || !(peer.categories & 16)) return Object.freeze({ status: 'unsupported', reason: 'Device did not advertise Process Inquiry' });
        if (peer.processFeatures == null) { await ci.processCapabilities(peerMuid); peer = ci.getPeer(peerMuid); }
        if (disposed || generation !== readGeneration) return Object.freeze({ status: 'cancelled', reason: 'Device report cancelled during capability inquiry' });
        if (!peer || !(peer.processFeatures & 1)) return Object.freeze({ status: 'unsupported', reason: 'Device did not confirm Message Report support' });
        const state = ci.state(), key = [state.connectionEpoch, state.epoch, peerMuid, state.group, channel].join(':');
        let supported = capabilities.get(key);
        if (!supported) {
          const probe = await run({ peerMuid, channel, requested, sent: requested, probe: true, quiescent });
          if (disposed || generation !== readGeneration) return Object.freeze({ status: 'cancelled', reason: 'Device report cancelled' });
          if (probe.status !== 'complete') return probe; supported = probe.reportedCategories;
          if (capabilities.size >= 32) capabilities.delete(capabilities.keys().next().value); capabilities.set(key, supported);
        }
        const sent = Object.freeze({ system: 0, controllers: requested.controllers & supported.controllers, notes: requested.notes & supported.notes });
        if (!sent.controllers && !sent.notes) return Object.freeze({ status: 'unsupported', reason: 'Device declined the selected report categories' });
        return await run({ peerMuid, channel, requested, sent, probe: false, quiescent });
      } catch (error) { return Object.freeze({ status: 'incomplete', reason: error.message }); }
      finally { if (generation === readGeneration) { busy = false; emit(); } }
    },
    state: () => Object.freeze({ disposed, busy, phase: active?.phase || latest?.status || 'idle', probe: active?.probe || false, messageCount: active?.messages || latest?.messageCount || 0, latest, observationStore: store.state() }),
    store,
    invalidateOutput(grant, reason) { if (ci.state().outputGrant !== grant) return; readGeneration++; busy = false; if (active) finish('incomplete', reason, false); capabilities.clear(); store.clear(); latest = Object.freeze({ status: 'stale', reason, observation: null }); emit(); },
    subscribe(listener) { if (disposed || typeof listener !== 'function' || listeners.size >= 8) throw new Error('Device report observer capacity'); listeners.add(listener); return () => listeners.delete(listener); },
    cancel() { readGeneration++; busy = false; if (active) finish('cancelled', 'Device report cancelled', true); emit(); },
    dispose() { if (disposed) return; disposed = true; readGeneration++; busy = false; if (active) finish('cancelled', 'Device report owner retired', true); unsubscribeProtocol(); unsubscribeCi(); unsubscribeInput(); capabilities.clear(); listeners.clear(); latest = null; if (!suppliedStore) store.clear(); }
  });
}
