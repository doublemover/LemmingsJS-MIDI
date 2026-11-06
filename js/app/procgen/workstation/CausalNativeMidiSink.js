import { createOrganRotaryPart } from '../../../midi/native/OrganRotaryPart.js';
import { pianoControllerWords, pianoNoteWords, pianoPedalValues, pianoTuningWords } from '../../../midi/native/PianoProfileAdapter.js';
import { orchestralOnset, orchestralRelease } from '../../../midi/native/OrchestralProfileAdapter.js';
import { resolvePercussionHit } from '../../../midi/native/DrumProfileAdapter.js';
import { sameDevicePatchIntent } from '../../../midi/native/DevicePatchIntent.js';
import { createNativeMidiBatchQueue } from '../../../midi/native/NativeMidiBatchQueue.js';
import { mpeAxisWords, mpeManagerGainWords, mpeManagerSetup, mpePitchWords } from '../../../midi/native/MpeProfileAdapter.js';
import { encodeIntent } from '../../../midi/protocol/UmpPacketCodec.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

const reject = reason => Object.freeze({ status: 'rejected', reason });
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
const causal = intent => Object.freeze({ worldId: intent.worldId, generation: intent.generation, batchId: intent.batchId, intentId: intent.intentId, voiceId: intent.voiceId,
  onsetId: intent.onsetId, pitch: intent.pitch, ...(intent.percussionHit ? { percussionHit: intent.percussionHit } : {}), ...(intent.orchestralArticulation ? { orchestralArticulation: intent.orchestralArticulation } : {}), ...(intent.pianoPerformance ? { pianoPerformance: intent.pianoPerformance } : {}), expression: intent.expression, scoreTime: intent.scoreTime, eventId: intent.eventId ?? null, sourceEventIds: intent.sourceEventIds, sourceOrder: intent.sourceOrder, sourceBoundary: Object.freeze({ tick: intent.scoreTime.simTick, generation: intent.generation }) });
const midi1 = (route, status, index, value = 0) => [(0x20000000 | route.group << 24 | status << 20 | route.channel << 16 | index << 8 | value) >>> 0];
const noteWords = (route, status, note, velocity, pitch = note) => route.protocol === 'midi2' ?
  encodeIntent({ group: route.group, channel: route.channel, status, note, velocity: { value: Math.round(velocity * 65535), bits: 16 },
    ...(status === 'noteOn' && pitch !== note ? { attributeType: 3, attributeData: Math.min(65535, Math.round(pitch * 512)) } : {}) }) :
  midi1(route, status === 'noteOn' ? 9 : 8, note, status === 'noteOn' ? Math.max(1, Math.round(velocity * 127)) : Math.round(velocity * 127));
export function createCausalNativeMidiSink({ routes, getLanes, now, onReceipt = () => {}, maxVoices = 1024, delayMs = 24, mode = 'primary' } = {}) {
  if (!['primary', 'auxiliary'].includes(mode)) throw new Error('Invalid native sink role');
  const batches = createNativeMidiBatchQueue({ client: routes.client });
  const invalidatingGrants = new Map();
  const invalidateGrant = grant => {
    if (invalidatingGrants.has(grant)) return invalidatingGrants.get(grant);
    const completion = (async () => {
      const results = await Promise.allSettled([...executions.values()].filter(state => state.grants.has(grant)).map(async state => {
        const wireExecution = state.grantExecutions.get(grant); batches.cancelExecution(grant, wireExecution);
        const receipt = await routes.client.cancelExecution(grant, wireExecution);
        if (receipt.kind !== 'cancelled-execution' || (receipt.cleanupUnconfirmedNotes || receipt.cleanupUnconfirmedControls)) throw new Error('Native device-change cleanup remains unconfirmed');
        for (const entry of state.voices.values()) if (entry.route.grant === grant) removeVoice(entry);
        state.grants.delete(grant); state.grantExecutions.delete(grant); for (const [key, part] of state.organParts) if (part.route.grant === grant) { part.owner.dispose(); state.organParts.delete(key); } for (const [key, part] of state.pianoParts) if (part.route.grant === grant) state.pianoParts.delete(key);
        for (const key of state.programs.keys()) if (key.startsWith(grant + ':')) state.programs.delete(key);
        for (const key of state.mpeSetups) if (key.startsWith(grant + ':')) { state.mpeSetups.delete(key); state.mpeGains.delete(key); }
      }));
      const failures = results.filter(row => row.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(row => row.reason), 'Native device-change retirement failed');
    })(); invalidatingGrants.set(grant, completion); completion.then(() => invalidatingGrants.delete(grant), () => {}); return completion;
  };
  const executions = new Map(), wireVoices = new Map(), channelVoices = new Map(), retirement = createProcgenRetirementScope();
  let disposed = false, anchor = null, latestReceipt = null, laneSource = null, laneIds = new Map(), soloCount = 0;
  let ownerFailure = null, removeOwner = null;
  try { removeOwner = routes.registerPerformanceOwner({ invalidateGrant, organPerformanceState: laneId => [...executions.values()].filter(state => !state.closed).flatMap(state => [...state.organParts.values()].filter(part => part.laneId === laneId).map(part => part.owner.state())),
    hasOrganPart: laneId => [...executions.values()].some(state => !state.closed && [...state.organParts.values()].some(part => part.laneId === laneId)),
    restoreOrganRegistration: laneId => { const parts = [...executions.values()].filter(state => !state.closed).flatMap(state => [...state.organParts.values()].filter(part => part.laneId === laneId)); if (parts.length !== 1) throw new Error('Choose one stopped organ part'); return parts[0].owner.restore(); }, pianoPerformanceState: laneId => [...executions.values()].filter(state => !state.closed).flatMap(state => [...state.pianoParts.values()].filter(part => part.laneId === laneId).map(part => Object.freeze({ laneId, grant: part.route.grant, outputId: part.route.outputId, routeRevision: part.route.routeRevision, contributors: part.contributors.size, pending: part.pending, fault: part.fault, submitted: Object.freeze({ ...part.submitted }), observed: Object.freeze({ ...part.observed }), queued: Object.freeze({ ...part.queued }) }))), isQuiescent: grant => !batches.hasPendingGrant(grant) && ![...executions.values()].some(state => [...state.voices.values()].some(entry => entry.route.grant === grant) || [...state.pianoParts.values()].some(part => part.route.grant === grant && (part.pending || Object.values(part.queued).some(value => value > 0))) || [...state.organParts.values()].some(part => part.route.grant === grant && part.owner.pendingCount())) }); } catch (error) { ownerFailure = error.message; }
  const enabled = () => !disposed && !ownerFailure && routes.enabled();
  const readLanes = () => { const lanes = getLanes(); if (lanes !== laneSource) { laneSource = lanes; laneIds = new Map(lanes.map(lane => [lane.id, lane])); soloCount = lanes.reduce((count, lane) => count + Number(lane.solo && !lane.mute), 0); } return lanes; };
  const resolveLane = lane => mode === 'auxiliary' ? routes.resolveAuxiliary(lane?.id) : routes.resolve(lane?.outputId, lane?.id);
  const laneFor = id => { readLanes(); return laneIds.get(id); };
  const unavailable = lane => !lane ? 'native-lane-unavailable' : lane.mute || (lane.gain ?? 1) <= 0 || soloCount && !lane.solo ? 'native-lane-muted' : null;
  const keyFor = (route, note) => [route.grant, route.group, route.channel, note].join(':');
  const channelKey = route => [route.grant, route.group, route.channel].join(':');
  const removeVoice = entry => { if (entry.state.voices.get(entry.voiceId) !== entry) return; entry.state.voices.delete(entry.voiceId); entry.organPart?.owner.remove(entry.voiceId, entry.lastTarget ?? Math.round(now() * 1000)); entry.pianoPart?.contributors.delete(entry.voiceId); if (entry.controlOnly) return; wireVoices.delete(keyFor(entry.route, entry.note)); const address = channelKey(entry.route), count = channelVoices.get(address) || 0; if (count > 1) channelVoices.set(address, count - 1); else channelVoices.delete(address); };
  const report = (entry, intent, admission, receipt, words) => {
    const provenance = entry.controlProvenance || causal(intent); const successful = receipt.kind === 'driver-submitted';
    if (Number.isSafeInteger(receipt.acceptedWords)) routes.recordSubmission({ words, receipt, provenance });
    latestReceipt = Object.freeze({ ...provenance, sinkId: 'physical-native-midi' + (mode === 'auxiliary' ? '-controls' : '') + ':' + intent.route, executionEpoch: entry.state.epoch,
      connectionEpoch: entry.route.connectionEpoch, routeRevision: entry.route.routeRevision, outputId: entry.route.outputId,
      status: receipt.kind === 'queued' ? 'accepted' : successful ? entry.losses.length ? 'degraded' : 'accepted' : 'rejected', stage: receipt.kind === 'queued' ? 'queued' : successful ? 'driver-submitted' : receipt.acceptedWords ? 'driver-submitted-prefix' : 'rejected-before-send',
      acknowledgement: receipt.kind, certainty: receipt.failedPacketUnconfirmed ? 'unconfirmed-packet' : receipt.acceptedWords ? 'driver-accepted-prefix' : 'not-submitted',
      receipt, losses: Object.freeze(entry.losses), targetTimeDomain: 'performance-microseconds', submittedAtMs: now() });
    if (successful) admission?.acknowledge?.({ ackState: 'driver-submitted', acknowledgedTime: now(), acknowledgementTimeDomain: 'performance-ms' });
    try { onReceipt(latestReceipt); } catch {}
  };
  const send = (entry, intent, admission, words, targetMicroseconds, priority = 1, terminal = false, onset = false) => {
    const pianoUpdate = entry.pianoUpdate; entry.pianoUpdate = null; const organUpdate = entry.organUpdate; entry.organUpdate = null;
    const provenance = entry.controlProvenance || Object.freeze({ ...causal(intent), ...(pianoUpdate ? { pianoPartControls: pianoUpdate.values } : {}), ...(entry.parameterObservations?.length ? { deviceParameters: entry.parameterObservations } : {}), ...(entry.orchestralWire ? { orchestralWire: entry.orchestralWire } : {}) });
    const submission = batches.enqueue({ grant: entry.route.grant, execution: entry.wireExecution, targetTimeMs: targetMicroseconds / 1000, priority, words, provenance,
      onReceipt: receipt => { if (receipt.kind === 'queued') report(entry, intent, admission, receipt, words); } });
    if (submission.status !== 'accepted') { report(entry, intent, admission, { kind: 'rejected', reason: submission.reason, acceptedWords: 0, acceptedPackets: 0, failedPacketUnconfirmed: false }, words); return reject(submission.reason); }
    if (organUpdate) entry.organPart.owner.track(organUpdate, submission.completion);
    if (entry.pianoTuningRequested) entry.pianoPart.tuningQueued = true;
    if (pianoUpdate) { Object.assign(entry.pianoPart.queued, pianoUpdate.values); entry.pianoPart.pending++; }
    submission.completion.then(receipt => {
      if (pianoUpdate) { entry.pianoPart.pending--; if (receipt.kind === 'driver-submitted') Object.assign(entry.pianoPart.submitted, pianoUpdate.values); else entry.pianoPart.fault = receipt.reason || 'piano-part-control-unconfirmed'; routes.notifyPerformanceChange?.(); }
      report(entry, intent, admission, receipt, words);
      if (receipt.kind !== 'driver-submitted') { if (entry.setupRequested) entry.state.programs.delete(channelKey(entry.route)); if (entry.mpeSetupRequested) entry.state.mpeSetups.delete(entry.mpeSetupRequested); entry.uncertain = !onset || !!receipt.acceptedWords || !!receipt.failedPacketUnconfirmed; if (!entry.uncertain) removeVoice(entry); }
      else { if (onset && entry.percussion?.mutuallyExclusiveSet) for (const previous of entry.state.voices.values()) if (previous !== entry && previous.route.grant === entry.route.grant && previous.route.group === entry.route.group && previous.route.channel === entry.route.channel && previous.percussion?.mutuallyExclusiveSet === entry.percussion.mutuallyExclusiveSet) previous.choked = true;
        if (entry.mpeSetupRequested) { const gain = entry.state.mpeGains.get(entry.mpeSetupRequested); if (gain) gain.pending = false; } if (terminal) removeVoice(entry); }
    }, error => {
      if (pianoUpdate) { entry.pianoPart.pending--; entry.pianoPart.fault = error.message; routes.notifyPerformanceChange?.(); }
      entry.uncertain = true; if (entry.mpeSetupRequested) entry.state.mpeSetups.delete(entry.mpeSetupRequested); report(entry, intent, admission, { kind: 'error', reason: error.message, failedPacketUnconfirmed: true }, words);
    });
    return Object.freeze({ status: 'accepted', stage: submission.stage });
  };
  const synchronizeMpeGain = (entry, lane) => {
    const state = entry.state, route = entry.route, key = route.grant + ':' + route.routeRevision, control = state.mpeGains.get(key), value = Math.min(1, lane.gain ?? 1);
    if (!route.mpe || !control || control.pending || control.fault || control.value === value || !routes.allowsPerformance(route.grant) || entry.uncertain) return;
    const words = mpeManagerGainWords(route, route.mpe, value), provenance = Object.freeze({ schema: 'lemmings-native-cohort-control/v1', kind: 'lane-gain', laneId: lane.id,
      outputId: route.outputId, connectionEpoch: route.connectionEpoch, routeRevision: route.routeRevision, executionEpoch: state.epoch, value, observedHostMs: now() });
    const queued = batches.enqueue({ grant: route.grant, execution: entry.wireExecution, targetTimeMs: now() + 10, priority: 1, words, provenance });
    if (queued.status !== 'accepted') { control.fault = queued.reason; return; }
    control.pending = true;
    queued.completion.then(receipt => {
      routes.recordSubmission({ words, receipt, provenance }); control.pending = false;
      if (receipt.kind === 'driver-submitted') control.value = value; else control.fault = receipt.reason || 'cohort-gain-unconfirmed';
    }, error => { control.pending = false; control.fault = error.message; });
  };
  const partKey = route => route.grant + ':' + route.routeRevision;
  const pianoPart = (state, route, lane, wireExecution) => {
    const key = partKey(route); let part = state.pianoParts.get(key);
    if (!part) {
      if (state.pianoParts.size >= 1024) throw new Error('Native piano part capacity');
      const baseline = routes.pianoBaseline?.(route.grant, route.group, route.channel, route.piano.record.peerMuid) || {};
      part = { state, route, laneId: lane.id, wireExecution, contributors: new Map(), queued: {}, submitted: {}, observed: {}, pickup: {}, source: null, target: null, pending: 0, fault: null, latestIntent: null };
      for (const name of ['sustain01', 'sostenuto01', 'unaCorda01']) { part.observed[name] = baseline[name] || { known: false, value: null, revision: 0 }; part.pickup[name] = { waiting: route.piano.policy.pickup, previous: null }; }
      state.pianoParts.set(key, part);
    }
    if (part.fault) throw new Error(part.fault);
    return part;
  };
  const pianoWords = (part, lane, target, { force = false, sampleSource = false } = {}) => {
    if (part.fault || !routes.allowsPerformance(part.route.grant)) return { words: [], values: {} };
    const binding = part.route.piano, controls = lane.pianoControls || {}; let source = 0; for (const value of part.contributors.values()) source = Math.max(source, value);
    const elapsed = part.target == null ? null : Math.max(0, (target - part.target) / 1000);
    const filtered = !part.contributors.size ? 0 : !sampleSource ? part.source ?? source : part.source == null || !binding.policy.smoothingMs || elapsed == null ? source : part.source + (source - part.source) * -Math.expm1(-elapsed / binding.policy.smoothingMs);
    if (sampleSource) { part.target = Math.max(part.target ?? target, target); part.source = filtered; }
    const desired = pianoPedalValues(binding, controls, filtered), words = [], values = {};
    for (const [name, controller] of [['sustain01', 64], ['sostenuto01', 66], ['unaCorda01', 67]]) {
      const value = desired[name], observed = part.observed[name], pickup = part.pickup[name], override = controls[name] != null;
      if (pickup.waiting && !override && !force) {
        if (!observed.known || Math.abs(value - observed.value) > 0.01 && !(pickup.previous != null && (pickup.previous - observed.value) * (value - observed.value) <= 0)) { pickup.previous = value; continue; }
        pickup.waiting = false;
      }
      if (part.queued[name] != null && Math.abs(part.queued[name] - value) <= binding.policy.deadband01 && !(value === 0 && part.queued[name] !== 0)) continue;
      if (name !== 'sustain01' && !binding.features[name === 'sostenuto01' ? 'sostenuto' : 'unaCorda']) continue;
      words.push(...pianoControllerWords(part.route, controller, Math.round(value * 0xffffffff))); values[name] = value;
    }
    return { words, values };
  };
  const pianoContribution = (entry, intent, expression, target) => {
    const part = entry.pianoPart, lane = laneFor(entry.laneId); if (!part || !lane) return { words: [], values: {} };
    const policy = part.route.piano.policy;
    const value = policy.sustainSource === 'pressure01' ? Math.max(0, Math.min(1, expression?.pressure01 ?? intent.expression?.pressure01 ?? part.contributors.get(entry.voiceId) ?? 0)) :
      policy.sustainSource === 'swarm-density01' ? Math.max(0, Math.min(1, intent.swarm?.sourceCount != null ? Math.log2(intent.swarm.sourceCount + 1) / 8 : intent.pianoPerformance?.sustainContribution01 ?? part.contributors.get(entry.voiceId) ?? 0)) : 0;
    part.contributors.set(entry.voiceId, value); part.latestIntent = intent; return pianoWords(part, lane, target, { sampleSource: true });
  };
  const removePianoInput = routes.input.subscribe(event => {
    if (event.event !== 'native-packet' || !event.dispatchable || !routes.allowsOrdinaryInput() || event.packet.status !== 'controlChange') return;
    const packet = event.packet, midi2 = packet.kind === 'midi2-channel-voice', controller = midi2 ? packet.controller : packet.data?.[0], name = ({ 64: 'sustain01', 66: 'sostenuto01', 67: 'unaCorda01' })[controller];
    if (!name) return; const value = midi2 ? packet.controllerValue.value / 0xffffffff : packet.data[1] / 127;
    for (const state of executions.values()) for (const part of state.pianoParts.values()) if (event.grant === part.route.pianoInputGrant && packet.group === part.route.group && packet.channel === part.route.channel) {
      const previous = part.observed[name]; if (previous.known && previous.value === value) continue;
      part.observed[name] = { known: true, value, revision: previous.revision + 1 };
      part.pickup[name] = { waiting: part.route.piano.policy.pickup && (part.queued[name] == null || Math.abs(part.queued[name] - value) > 0.01), previous: null }; routes.notifyPerformanceChange?.();
    }
  });
  const retireExecution = execution => {
    const state = executions.get(execution); if (!state) return createProcgenRetirementScope().retire(); if (state.retirement) return state.retirement.getReceipt();
    state.closed = true; state.retirement = createProcgenRetirementScope();
    const receipt = state.retirement.retire([...state.grants].map(grant => ({ name: 'native-grant-' + grant, run: async () => {
      batches.cancelExecution(grant, state.grantExecutions.get(grant));
      const receipt = await routes.client.cancelExecution(grant, state.grantExecutions.get(grant));
      if (receipt.kind !== 'cancelled-execution' || (receipt.cleanupUnconfirmedNotes || receipt.cleanupUnconfirmedControls)) throw new Error('Native owned-note cleanup is unconfirmed');
      for (const entry of state.voices.values()) if (entry.route.grant === grant) removeVoice(entry);
    } }))); 
    receipt.completion.then(done => { if (done.outcome === 'complete') { for (const part of state.organParts.values()) part.owner.dispose(); state.organParts.clear(); executions.delete(execution); if (!executions.size) anchor = null; } });
    return receipt;
  };
  const backend = {
    executionIncarnation: () => routes.client.session,
    registerExecution({ executionEpoch, generation }) {
      if (!enabled() || typeof executionEpoch !== 'string' || !executionEpoch || !Number.isSafeInteger(generation) || generation < 0) return reject('native-execution-unavailable');
      for (const [execution, state] of executions) if (state.epoch === executionEpoch && state.generation === generation && !state.closed) return { status: 'accepted', execution };
      if (executions.size >= 2) return reject('native-execution-capacity');
      const execution = Object.freeze({ schema: 'causal-native-midi-execution/v1', epoch: executionEpoch, generation });
      executions.set(execution, { epoch: executionEpoch, generation, grantExecutions: new Map(), mpeSetups: new Set(), mpeGains: new Map(), pianoParts: new Map(), organParts: new Map(), voices: new Map(), grants: new Set(), programs: new Map(), closed: false, retirement: null }); return { status: 'accepted', execution };
    },
    begin(intent, targetMicroseconds, execution, admission) {
      const state = executions.get(execution), lane = laneFor(intent.laneId); let route = resolveLane(lane);
      if (!enabled() || !state || state.closed || intent.generation !== state.generation || !route) return reject('native-route-unavailable');
      if (mode === 'primary' && lane.devicePatch && (!sameDevicePatchIntent(lane.devicePatch, route.patchBinding?.intent) || lane.externalProgram !== lane.devicePatch.bankPC[2] || lane.bankMSB !== lane.devicePatch.bankPC[0] || lane.bankLSB !== lane.devicePatch.bankPC[1])) return reject('explicit-current-device-patch-recall-required');
      const silence = unavailable(lane); if (silence) return reject(silence);
      if (!routes.allowsPerformance(route.grant)) return reject('native-device-observation-active');
      if (!Number.isSafeInteger(targetMicroseconds) || routes.client.clockStatus().status !== 'synchronized') return reject('native-clock-unavailable');
      if (state.voices.has(intent.voiceId) || state.voices.size >= maxVoices || [...state.voices.values()].some(entry => entry.uncertain)) return reject('native-voice-capacity-or-ownership');
      let pitch = (intent.pitch?.cents + (intent.expression?.pitchOffsetCents ?? 0)) / 100 + 12 * Math.log2((intent.pitch?.referenceHz ?? 440) / 440), note = Math.min(127, Math.round(pitch));
      let percussion = null;
      if (lane.organ?.routeMode === 'primary' && mode === 'primary' || route.organ) { if (!lane.organ || !route.organ || route.organ.policySignature !== JSON.stringify(lane.organ)) return reject('explicit-current-organ-rotary-profile-required'); }
      if (mode === 'primary' && (lane.piano || route.piano)) { if (!lane.piano || !route.piano || route.piano.policySignature !== JSON.stringify(lane.piano) || route.percussion || route.orchestral || route.mpe) return reject('explicit-current-piano-profile-required'); }
      if (mode === 'primary' && (lane.orchestral || route.orchestral)) { if (!lane.orchestral || !route.orchestral || route.orchestral.policySignature !== JSON.stringify(lane.orchestral) || route.percussion || route.mpe) return reject('explicit-current-orchestral-profile-required'); }
      if (mode === 'primary' && (lane.externalPercussion || lane.percussion || route.percussion)) {
        if (!lane.percussion || !route.percussion || JSON.stringify(lane.percussion) !== route.percussion.policySignature) return reject('explicit-current-native-drum-map-required');
        try { percussion = resolvePercussionHit(route.percussion, intent.percussionHit); pitch = note = percussion.note; } catch (error) { return reject(error.message); }
      }
      if (!route.organ?.controlOnly && (!Number.isFinite(pitch) || pitch < 0 || pitch >= 128 || !unit(intent.velocity01))) return reject('native-pitch-or-velocity-unrepresentable');
      if (route.mpe) {
        const available = route.mpe.members.find(address => !channelVoices.has(channelKey({ ...route, ...address })));
        if (!available) return reject('ci-mpe-member-capacity');
        route = Object.freeze({ ...route, ...available });
      }
      const wireKey = keyFor(route, note);
      if (!route.organ?.controlOnly && wireVoices.has(wireKey)) return reject('native-same-pitch-voice-overlap');
      if (!state.grantExecutions.has(route.grant)) state.grantExecutions.set(route.grant, routes.allocateExecutionEpoch());
      const entry = { state, route, wireExecution: state.grantExecutions.get(route.grant), intent, voiceId: intent.voiceId, laneId: lane.id, note, pitch, baseOffset: intent.expression?.pitchOffsetCents ?? 0, losses: [], uncertain: false, ending: false, setupRequested: false, parameterState: new Map(), parameterObservations: [], percussion, choked: false, controlOnly: route.organ?.controlOnly === true, auxiliary: mode === 'auxiliary', lastTarget: targetMicroseconds };
      if (!route.mpe && route.protocol === 'midi1-in-ump' && pitch !== note) entry.losses.push(Object.freeze({ kind: 'midi1-pitch-quantization', requested: pitch, represented: note }));
      if (percussion) entry.losses.push(Object.freeze({ kind: 'percussion-map-qualification', ...percussion }));
      if (lane.devicePatch) entry.losses.push(Object.freeze({ kind: 'device-patch-reported-under-user-declared-address-mapping', requested: lane.devicePatch.title }));
      entry.losses.push(Object.freeze({ kind: 'receiver-protocol-unverified', requested: route.protocol }));
      const words = [], program = JSON.stringify([lane.externalProgram, lane.bankMSB, lane.bankLSB]), address = channelKey(route);
      if (!route.mpe && !route.percussion && !route.orchestral && !route.piano && !route.organ && !lane.devicePatch && state.programs.get(address) !== program && lane.externalProgram != null) {
        if (channelVoices.has(address)) return reject('native-program-change-would-affect-held-voices');
        if (route.protocol === 'midi2') words.push(...encodeIntent({ group: route.group, channel: route.channel, status: 'programChange', program: lane.externalProgram,
          bankValid: lane.bankMSB != null || lane.bankLSB != null, bankMSB: lane.bankMSB ?? 0, bankLSB: lane.bankLSB ?? 0 }));
        else { if (lane.bankMSB != null) words.push(...midi1(route, 11, 0, lane.bankMSB)); if (lane.bankLSB != null) words.push(...midi1(route, 11, 32, lane.bankLSB)); words.push(...midi1(route, 12, lane.externalProgram)); }
        entry.setupRequested = true;
      }
      if (route.organ) {
        try {
          const key = route.grant + ':' + route.routeRevision; let part = state.organParts.get(key);
          if (!part) { if (state.organParts.size >= 1024) throw new Error('Organ part capacity'); const wireExecution = entry.wireExecution;
            const owner = createOrganRotaryPart({ routes, route, laneId: lane.id, now, getLane: () => laneFor(lane.id), submit: (words, provenance, target) => {
              const accepted = batches.enqueue({ grant: route.grant, execution: wireExecution, priority: 1, targetTimeMs: target / 1000, words, provenance });
              accepted.completion?.then(receipt => routes.recordSubmission({ words, provenance, receipt }), error => routes.recordSubmission({ words, provenance, receipt: { session: route.connectionEpoch, grant: route.grant, execution: wireExecution, kind: 'error', acceptedWords: 0, failedPacketUnconfirmed: error.notSubmitted !== true, submissionExtent: error.notSubmitted ? 'observed-prefix' : 'unobserved-batch', reason: error.message } })); return accepted;
            } }); part = { owner, route, laneId: lane.id }; state.organParts.set(key, part);
          }
          if (!part.owner.canPerform()) throw new Error('Review and rebind this organ/rotary part after its fault or registration restore');
          entry.organPart = part; part.owner.touch(intent.voiceId, intent, intent.performanceCause, targetMicroseconds); entry.organUpdate = part.owner.prepare(lane); words.push(...entry.organUpdate.words);
        } catch (error) { return reject(error.message); }
      }
      if (route.piano) {
        try { entry.pianoPart = pianoPart(state, route, lane, entry.wireExecution); entry.pianoUpdate = pianoContribution(entry, intent, intent.expression, targetMicroseconds); if (!entry.pianoPart.tuningQueued) { words.push(...pianoTuningWords(route, route.piano)); entry.pianoTuningRequested = true; } words.push(...entry.pianoUpdate.words); }
        catch (error) { return reject(error.message); }
      }
      if (mode === 'primary' && lane.deviceParameters?.length) {
        try { const plan = routes.deviceParameterWords(lane, { ...route, note }, intent, entry.parameterState, targetMicroseconds); words.push(...plan.words); entry.parameterObservations = plan.observations; }
        catch (error) { entry.pianoPart?.contributors.delete(intent.voiceId); return reject(error.message); }
      }
      if (!entry.controlOnly && route.mpe) {
        const setupKey = route.grant + ':' + route.routeRevision;
        try {
          if (!state.mpeSetups.has(setupKey)) { words.push(...mpeManagerSetup(route, route.mpe, Math.min(1, lane.gain ?? 1))); entry.mpeSetupRequested = setupKey; }
          words.push(...mpePitchWords(route, route.mpe, pitch - note));
          for (const [axis, fallback] of [['pressure01', 0], ['timbre01', 0.5]]) {
            const value = intent.expression?.[axis] ?? fallback, axisWords = mpeAxisWords(route, route.mpe, axis, value);
            if (axisWords) words.push(...axisWords); else if (intent.expression?.[axis] != null) entry.losses.push(Object.freeze({ kind: 'ci-mpe-axis-unsupported', field: axis, requested: value }));
          }
        } catch (error) { return reject(error.message); }
        if (lane.externalProgram != null && !lane.devicePatch) entry.losses.push(Object.freeze({ kind: 'profile-patch-requires-separate-device-mutation', requestedProgram: lane.externalProgram }));
        words.push(...noteWords(route, 'noteOn', note, intent.velocity01, note));
      } else if (!entry.controlOnly && route.piano) {
        try { words.push(...pianoNoteWords(route, route.piano, intent, note, pitch)); } catch (error) { entry.pianoPart?.contributors.delete(intent.voiceId); return reject(error.message); }
      } else if (!entry.controlOnly && route.orchestral) {
        try { const onset = orchestralOnset(route.orchestral, intent, { ...route, note, pitch, velocity01: intent.velocity01 }); words.push(...onset.words); entry.orchestralWire = Object.freeze({ attributeType: onset.attributeType, attributeData: onset.attributeData, qualification: onset.qualification }); }
        catch (error) { return reject(error.message); }
      } else if (!entry.controlOnly) words.push(...noteWords(route, 'noteOn', note, intent.velocity01, pitch));
      if (!route.mpe && !route.percussion && !route.piano && !route.organ && unit(intent.expression?.pressure01)) words.push(...(route.protocol === 'midi2' ? encodeIntent({ group: route.group, channel: route.channel, status: 'polyPressure', note, controllerValue: { value: Math.round(intent.expression.pressure01 * 0xffffffff), bits: 32 } }) : midi1(route, 10, note, Math.round(intent.expression.pressure01 * 127))));
      state.voices.set(intent.voiceId, entry); if (!entry.controlOnly) { wireVoices.set(wireKey, entry); channelVoices.set(address, (channelVoices.get(address) || 0) + 1); } state.grants.add(route.grant);
      if (entry.controlOnly && !words.length) return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false });
      const queued = send(entry, intent, admission, words, targetMicroseconds, 1, false, true); if (queued.status !== 'accepted') { removeVoice(entry); return queued; } if (entry.setupRequested) state.programs.set(address, program); if (entry.mpeSetupRequested) { state.mpeSetups.add(entry.mpeSetupRequested); state.mpeGains.set(entry.mpeSetupRequested, { value: Math.min(1, lane.gain ?? 1), pending: true, fault: null }); }
      return Object.freeze({ status: 'degraded', stage: 'accepted', losses: Object.freeze(entry.losses), outputId: route.outputId, channel: route.channel + 1, group: route.group });
    },
    update(voiceId, expression, targetMicroseconds, execution, slewSeconds, causeIntent, admission) {
      const entry = executions.get(execution)?.voices.get(voiceId);
      if (!enabled() || !entry || entry.state.closed || entry.uncertain || entry.ending) return reject('native-voice-unavailable');
      if (entry.choked) return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false, reason: 'receiver-profile-mutually-exclusive-sound' });
      const words = [], losses = []; entry.lastTarget = targetMicroseconds; if (entry.organPart) entry.organPart.owner.touch(voiceId, causeIntent || entry.intent, null, targetMicroseconds);
      if (!routes.allowsPerformance(entry.route.grant)) return reject('native-device-observation-active');
      if (entry.pianoPart) { try { entry.pianoUpdate = pianoContribution(entry, causeIntent || entry.intent, expression, targetMicroseconds); words.push(...entry.pianoUpdate.words); } catch (error) { return reject(error.message); } }
      if (mode === 'primary' && laneFor(entry.laneId)?.deviceParameters?.length) {
        try { const plan = routes.deviceParameterWords(laneFor(entry.laneId), { ...entry.route, note: entry.note }, { ...(causeIntent || entry.intent), expression }, entry.parameterState, targetMicroseconds); words.push(...plan.words); entry.parameterObservations = plan.observations; }
        catch (error) { return reject(error.message); }
      }
      if (entry.route.mpe) {
        try {
          for (const [name, value] of Object.entries(expression || {})) {
            if (name === 'pitchOffsetCents') words.push(...mpePitchWords(entry.route, entry.route.mpe, entry.pitch - entry.note + (value - entry.baseOffset) / 100));
            else if (['pressure01', 'timbre01'].includes(name)) { const mapped = mpeAxisWords(entry.route, entry.route.mpe, name, value); if (mapped) words.push(...mapped); else losses.push(Object.freeze({ kind: 'ci-mpe-axis-unsupported', field: name, requested: value })); }
            else losses.push(Object.freeze({ kind: 'ci-mpe-expression-unavailable', field: name, requested: value }));
          }
        } catch (error) { return reject(error.message); }
        if (words.length) { const queued = send(entry, causeIntent || entry.intent, admission, words, targetMicroseconds); if (queued.status !== 'accepted') return queued; }
        return Object.freeze({ status: losses.length ? 'degraded' : 'accepted', stage: words.length ? 'accepted' : 'semantic-observation', outputRequested: !!words.length, losses: Object.freeze(losses) });
      }
      for (const [name, value] of Object.entries(expression || {})) {
        if (name === 'pressure01' && (entry.route.piano || entry.route.organ)) continue;
        else if (name === 'pressure01' && !entry.route.percussion) {
          if (!unit(value)) return reject('invalid-native-pressure');
          words.push(...(entry.route.protocol === 'midi2' ? encodeIntent({ group: entry.route.group, channel: entry.route.channel, status: 'polyPressure', note: entry.note, controllerValue: { value: Math.round(value * 0xffffffff), bits: 32 } }) : midi1(entry.route, 10, entry.note, Math.round(value * 127))));
        } else if (name === 'pitchOffsetCents' && value === entry.baseOffset) continue;
        else losses.push(Object.freeze({ kind: 'native-expression-unavailable', field: name, requested: value }));
      }
      if (words.length) { const queued = send(entry, causeIntent || entry.intent, admission, words, targetMicroseconds); if (queued.status !== 'accepted') return queued; }
      return Object.freeze({ status: losses.length ? 'degraded' : 'accepted', stage: words.length ? 'accepted' : 'semantic-observation', outputRequested: !!words.length, losses: Object.freeze(losses) });
    },
    updatePhysical(voiceId, cause, targetMicroseconds, execution, causeIntent, admission) {
      const entry = executions.get(execution)?.voices.get(voiceId), lane = entry && laneFor(entry.laneId);
      if (!enabled() || !entry || entry.state.closed || entry.uncertain || entry.ending || !routes.allowsPerformance(entry.route.grant)) return reject('native-voice-unavailable');
      if (entry.organPart) { entry.lastTarget = targetMicroseconds; entry.organPart.owner.touch(voiceId, causeIntent || entry.intent, cause, targetMicroseconds); if (mode === 'auxiliary' || !lane?.deviceParameters?.length) return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false }); }
      if (!lane?.deviceParameters?.length) return Object.freeze({ status: 'degraded', stage: 'semantic-observation', outputRequested: false, reason: 'no-discovered-device-physical-mapping' });
      try {
        const intent = { ...(causeIntent || entry.intent), performanceCause: cause }, plan = routes.deviceParameterWords(lane, { ...entry.route, note: entry.note }, intent, entry.parameterState, targetMicroseconds);
        entry.parameterObservations = plan.observations; return plan.words.length ? send(entry, intent, admission, plan.words, targetMicroseconds) : Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false });
      } catch (error) { return reject(error.message); }
    },
    updateCanonicalTravel: () => Object.freeze({ status: 'degraded', stage: 'semantic-observation', outputRequested: false, reason: 'travel-audio-realization-unrepresented-in-native-midi' }),
    transferVoiceLane(voiceId, laneId, targetMicroseconds, execution) {
      const entry = executions.get(execution)?.voices.get(voiceId), lane = laneFor(laneId), route = resolveLane(lane);
      if (!entry || unavailable(lane)) return reject('native-voice-unavailable');
      if (route?.outputId !== entry.route.outputId) return Object.freeze({ status: 'degraded', stage: 'semantic-observation', outputRequested: false, reason: 'held-native-route-pinned-until-release' });
      entry.laneId = laneId; return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false });
    },
    end(voiceId, options, targetMicroseconds, execution, causeIntent, admission) {
      const entry = executions.get(execution)?.voices.get(voiceId); if (!entry) return Object.freeze({ status: 'accepted', stage: 'already-retired', outputRequested: false });
      if (entry.ending) return Object.freeze({ status: 'accepted', stage: 'release-pending' });
      if (!enabled() || entry.uncertain) return reject('native-release-unconfirmed');
      entry.lastTarget = targetMicroseconds; entry.organPart?.owner.remove(voiceId, targetMicroseconds);
      if (entry.controlOnly) { removeVoice(entry); return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false }); }
      const tail = options?.mode === 'one-shot' ? options.tailSeconds : 0;
      if (!Number.isFinite(tail) || tail < 0 || tail > 1.9) return reject('native-release-tail-outside-horizon');
      const releaseTarget = Math.max(Math.round(now() * 1000), targetMicroseconds + Math.round(tail * 1000000));
      const releaseWords = entry.route.piano ? pianoNoteWords(entry.route, entry.route.piano, entry.intent, entry.note, entry.pitch, true) : entry.route.orchestral ? orchestralRelease(entry.route.orchestral, { ...entry.route, note: entry.note }, entry.intent.orchestralArticulation) : noteWords(entry.route, 'noteOff', entry.note, entry.percussion?.releaseVelocity01 ?? 0);
      if (entry.pianoPart) { entry.pianoPart.contributors.delete(voiceId); entry.pianoUpdate = pianoWords(entry.pianoPart, laneFor(entry.laneId) || { pianoControls: { sustain01: 0, sostenuto01: 0, unaCorda01: 0 } }, releaseTarget, { force: !entry.pianoPart.contributors.size, sampleSource: true }); }
      entry.ending = true; const queued = send(entry, causeIntent || entry.intent, admission, [...releaseWords, ...(entry.pianoUpdate?.words || [])], releaseTarget, 0, true);
      if (queued.status !== 'accepted') { entry.ending = false; return queued; }
      return Object.freeze({ status: 'accepted', stage: 'accepted' });
    },
    cancelGenerationWithReceipt(generation, execution) { const state = executions.get(execution); return state && state.generation !== generation ? reject('foreign-native-generation') : retireExecution(execution); },
    retireExecution
  };
  return {
    enabled, lastOutcome: () => latestReceipt,
    observe(score, { bpm, executionEpoch }) { if (!enabled()) return; if (!Number.isFinite(score?.beat) || !Number.isFinite(bpm) || bpm <= 0) throw new Error('Invalid native score anchor'); if (!anchor || anchor.executionEpoch !== executionEpoch || anchor.scoreEpoch !== score.epoch || anchor.bpm !== bpm) anchor = { executionEpoch, scoreEpoch: score.epoch, beat: score.beat, hostMs: now() + delayMs, bpm }; },
    sinks: ['local', 'prepared-body'].map(route => Object.freeze({ id: 'physical-native-midi' + (mode === 'auxiliary' ? '-controls' : '') + ':' + route, route, backend, enabled, executionLease: false, timeDomain: 'performance-microseconds',
      acceptsIntent: intent => intent.kind === 'begin' ? !!resolveLane(laneFor(intent.laneId)) : [...executions.values()].some(state => state.voices.has(intent.voiceId)),
      getAdmissionIdentity: intent => { const current = resolveLane(laneFor(intent.laneId)); return { connectionEpoch: current?.connectionEpoch ?? null, routeRevision: current?.routeRevision ?? 0 }; },
      latePolicy: ({ intent, targetFrame }) => targetFrame > now() * 1000 ? { status: 'accepted', targetFrame } : intent.kind === 'end' ? { status: 'accepted', targetFrame: Math.round(now() * 1000), repair: 'late-release' } : reject('late-native-intent'),
      toTargetFrame: score => anchor && anchor.scoreEpoch === score?.epoch ? Math.round((anchor.hostMs + (score.beat - anchor.beat) * 60000 / anchor.bpm) * 1000) : null })),
    flushSourceControls(batch) { for (const state of executions.values()) if (!state.closed) for (const part of state.organParts.values()) part.owner.flush(batch); },
    synchronizeLaneMix() {
      for (const [execution, state] of executions) if (!state.closed) for (const entry of state.voices.values()) {
        const lane = laneFor(entry.laneId); if (lane && entry.route.mpe && !entry.ending) synchronizeMpeGain(entry, lane); if (!entry.ending && (unavailable(lane) || !entry.auxiliary && lane.outputId !== entry.route.outputId)) backend.end(entry.voiceId, {}, Math.round(now() * 1000), execution, entry.intent);
      }
      for (const state of executions.values()) if (!state.closed) for (const part of state.organParts.values()) part.owner.synchronize();
      for (const state of executions.values()) if (!state.closed) for (const part of state.pianoParts.values()) {
        if (part.pending || part.fault || !part.latestIntent || !routes.allowsPerformance(part.route.grant)) continue;
        const lane = laneFor(part.laneId), silent = unavailable(lane) || lane?.outputId !== part.route.outputId;
        try {
          const target = Math.round((now() + 10) * 1000), actual = silent ? { pianoControls: { sustain01: 0, sostenuto01: 0, unaCorda01: 0 } } : lane, update = pianoWords(part, actual, target, { force: !!silent });
          if (!update.words.length) continue;
          const entry = { state, route: part.route, wireExecution: part.wireExecution, laneId: part.laneId, voiceId: null, losses: [], pianoPart: part, pianoUpdate: update,
            controlProvenance: Object.freeze({ schema: 'lemmings-native-piano-part-control/v1', laneId: part.laneId, outputId: part.route.outputId, executionEpoch: state.epoch, connectionEpoch: part.route.connectionEpoch, routeRevision: part.route.routeRevision, controls: Object.freeze({ ...actual.pianoControls }), represented: Object.freeze({ ...update.values }), observedHostMs: now() }) };
          const queued = send(entry, part.latestIntent, null, update.words, target); if (queued.status !== 'accepted') part.fault = queued.reason;
        } catch (error) { part.fault = error.message; }
      }
    },
    diagnostics: () => Object.freeze({ disposed, ownerFailure, enabled: enabled(), executions: executions.size, latestReceipt, queue: batches.state(), clock: routes.client.clockStatus() }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; removePianoInput(); batches.dispose(); const receipt = retirement.retire([...executions].map(([execution, state]) => ({ name: state.epoch, run: () => retireExecution(execution) }))); receipt.completion.then(done => { if (done.outcome === 'complete') { removeOwner?.(); removeOwner = null; } }); return receipt; }
  };
}
