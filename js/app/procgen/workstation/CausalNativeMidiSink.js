import { sameDevicePatchIntent } from '../../../midi/native/DevicePatchIntent.js';
import { createNativeMidiBatchQueue } from '../../../midi/native/NativeMidiBatchQueue.js';
import { mpeAxisWords, mpeManagerGainWords, mpeManagerSetup, mpePitchWords } from '../../../midi/native/MpeProfileAdapter.js';
import { encodeIntent } from '../../../midi/protocol/UmpPacketCodec.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

const reject = reason => Object.freeze({ status: 'rejected', reason });
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
const causal = intent => Object.freeze({ worldId: intent.worldId, generation: intent.generation, batchId: intent.batchId, intentId: intent.intentId, voiceId: intent.voiceId,
  onsetId: intent.onsetId, pitch: intent.pitch, expression: intent.expression, scoreTime: intent.scoreTime, eventId: intent.eventId ?? null, sourceEventIds: intent.sourceEventIds, sourceOrder: intent.sourceOrder, sourceBoundary: Object.freeze({ tick: intent.scoreTime.simTick, generation: intent.generation }) });
const midi1 = (route, status, index, value = 0) => [(0x20000000 | route.group << 24 | status << 20 | route.channel << 16 | index << 8 | value) >>> 0];
const noteWords = (route, status, note, velocity, pitch = note) => route.protocol === 'midi2' ?
  encodeIntent({ group: route.group, channel: route.channel, status, note, velocity: { value: Math.round(velocity * 65535), bits: 16 },
    ...(status === 'noteOn' && pitch !== note ? { attributeType: 3, attributeData: Math.min(65535, Math.round(pitch * 512)) } : {}) }) :
  midi1(route, status === 'noteOn' ? 9 : 8, note, status === 'noteOn' ? Math.max(1, Math.round(velocity * 127)) : Math.round(velocity * 127));
export function createCausalNativeMidiSink({ routes, getLanes, now, onReceipt = () => {}, maxVoices = 1024, delayMs = 24 } = {}) {
  const batches = createNativeMidiBatchQueue({ client: routes.client });
  const invalidatingGrants = new Map();
  const invalidateGrant = grant => {
    if (invalidatingGrants.has(grant)) return invalidatingGrants.get(grant);
    const completion = (async () => {
      const results = await Promise.allSettled([...executions.values()].filter(state => state.grants.has(grant)).map(async state => {
        const wireExecution = state.grantExecutions.get(grant); batches.cancelExecution(grant, wireExecution);
        const receipt = await routes.client.cancelExecution(grant, wireExecution);
        if (receipt.kind !== 'cancelled-execution' || receipt.cleanupUnconfirmedNotes) throw new Error('Native device-change cleanup remains unconfirmed');
        for (const entry of state.voices.values()) if (entry.route.grant === grant) removeVoice(entry);
        state.grants.delete(grant); state.grantExecutions.delete(grant);
        for (const key of state.programs.keys()) if (key.startsWith(grant + ':')) state.programs.delete(key);
        for (const key of state.mpeSetups) if (key.startsWith(grant + ':')) { state.mpeSetups.delete(key); state.mpeGains.delete(key); }
      }));
      const failures = results.filter(row => row.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(row => row.reason), 'Native device-change retirement failed');
    })(); invalidatingGrants.set(grant, completion); completion.then(() => invalidatingGrants.delete(grant), () => {}); return completion;
  };
  const executions = new Map(), wireVoices = new Map(), channelVoices = new Map(), retirement = createProcgenRetirementScope();
  let disposed = false, anchor = null, latestReceipt = null, laneSource = null, laneIds = new Map(), soloCount = 0;
  let ownerFailure = null, removeOwner = null;
  try { removeOwner = routes.registerPerformanceOwner({ invalidateGrant, isQuiescent: grant => !batches.hasPendingGrant(grant) && ![...executions.values()].some(state => [...state.voices.values()].some(entry => entry.route.grant === grant)) }); } catch (error) { ownerFailure = error.message; }
  const enabled = () => !disposed && !ownerFailure && routes.enabled();
  const readLanes = () => { const lanes = getLanes(); if (lanes !== laneSource) { laneSource = lanes; laneIds = new Map(lanes.map(lane => [lane.id, lane])); soloCount = lanes.reduce((count, lane) => count + Number(lane.solo && !lane.mute), 0); } return lanes; };
  const laneFor = id => { readLanes(); return laneIds.get(id); };
  const unavailable = lane => !lane ? 'native-lane-unavailable' : lane.mute || (lane.gain ?? 1) <= 0 || soloCount && !lane.solo ? 'native-lane-muted' : null;
  const keyFor = (route, note) => [route.grant, route.group, route.channel, note].join(':');
  const channelKey = route => [route.grant, route.group, route.channel].join(':');
  const removeVoice = entry => { if (entry.state.voices.get(entry.voiceId) !== entry) return; entry.state.voices.delete(entry.voiceId); wireVoices.delete(keyFor(entry.route, entry.note)); const address = channelKey(entry.route), count = channelVoices.get(address) || 0; if (count > 1) channelVoices.set(address, count - 1); else channelVoices.delete(address); };
  const report = (entry, intent, admission, receipt, words) => {
    const provenance = causal(intent); const successful = receipt.kind === 'driver-submitted';
    if (Number.isSafeInteger(receipt.acceptedWords)) routes.recordSubmission({ words, receipt, provenance });
    latestReceipt = Object.freeze({ ...provenance, sinkId: 'physical-native-midi:' + intent.route, executionEpoch: entry.state.epoch,
      connectionEpoch: entry.route.connectionEpoch, routeRevision: entry.route.routeRevision, outputId: entry.route.outputId,
      status: receipt.kind === 'queued' ? 'accepted' : successful ? entry.losses.length ? 'degraded' : 'accepted' : 'rejected', stage: receipt.kind === 'queued' ? 'queued' : successful ? 'driver-submitted' : receipt.acceptedWords ? 'driver-submitted-prefix' : 'rejected-before-send',
      acknowledgement: receipt.kind, certainty: receipt.failedPacketUnconfirmed ? 'unconfirmed-packet' : receipt.acceptedWords ? 'driver-accepted-prefix' : 'not-submitted',
      receipt, losses: Object.freeze(entry.losses), targetTimeDomain: 'performance-microseconds', submittedAtMs: now() });
    if (successful) admission?.acknowledge?.({ ackState: 'driver-submitted', acknowledgedTime: now(), acknowledgementTimeDomain: 'performance-ms' });
    try { onReceipt(latestReceipt); } catch {}
  };
  const send = (entry, intent, admission, words, targetMicroseconds, priority = 1, terminal = false, onset = false) => {
    const provenance = causal(intent);
    const submission = batches.enqueue({ grant: entry.route.grant, execution: entry.wireExecution, targetTimeMs: targetMicroseconds / 1000, priority, words, provenance,
      onReceipt: receipt => { if (receipt.kind === 'queued') report(entry, intent, admission, receipt, words); } });
    if (submission.status !== 'accepted') { report(entry, intent, admission, { kind: 'rejected', reason: submission.reason, acceptedWords: 0, acceptedPackets: 0, failedPacketUnconfirmed: false }, words); return reject(submission.reason); }
    submission.completion.then(receipt => {
      report(entry, intent, admission, receipt, words);
      if (receipt.kind !== 'driver-submitted') { if (entry.setupRequested) entry.state.programs.delete(channelKey(entry.route)); if (entry.mpeSetupRequested) entry.state.mpeSetups.delete(entry.mpeSetupRequested); entry.uncertain = !onset || !!receipt.acceptedWords || !!receipt.failedPacketUnconfirmed; if (!entry.uncertain) removeVoice(entry); }
      else { if (entry.mpeSetupRequested) { const gain = entry.state.mpeGains.get(entry.mpeSetupRequested); if (gain) gain.pending = false; } if (terminal) removeVoice(entry); }
    }, error => {
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
  const retireExecution = execution => {
    const state = executions.get(execution); if (!state) return createProcgenRetirementScope().retire(); if (state.retirement) return state.retirement.getReceipt();
    state.closed = true; state.retirement = createProcgenRetirementScope();
    const receipt = state.retirement.retire([...state.grants].map(grant => ({ name: 'native-grant-' + grant, run: async () => {
      batches.cancelExecution(grant, state.grantExecutions.get(grant));
      const receipt = await routes.client.cancelExecution(grant, state.grantExecutions.get(grant));
      if (receipt.kind !== 'cancelled-execution' || receipt.cleanupUnconfirmedNotes) throw new Error('Native owned-note cleanup is unconfirmed');
      for (const entry of state.voices.values()) if (entry.route.grant === grant) removeVoice(entry);
    } }))); 
    receipt.completion.then(done => { if (done.outcome === 'complete') { executions.delete(execution); if (!executions.size) anchor = null; } });
    return receipt;
  };
  const backend = {
    executionIncarnation: () => routes.client.session,
    registerExecution({ executionEpoch, generation }) {
      if (!enabled() || typeof executionEpoch !== 'string' || !executionEpoch || !Number.isSafeInteger(generation) || generation < 0) return reject('native-execution-unavailable');
      for (const [execution, state] of executions) if (state.epoch === executionEpoch && state.generation === generation && !state.closed) return { status: 'accepted', execution };
      if (executions.size >= 2) return reject('native-execution-capacity');
      const execution = Object.freeze({ schema: 'causal-native-midi-execution/v1', epoch: executionEpoch, generation });
      executions.set(execution, { epoch: executionEpoch, generation, grantExecutions: new Map(), mpeSetups: new Set(), mpeGains: new Map(), voices: new Map(), grants: new Set(), programs: new Map(), closed: false, retirement: null }); return { status: 'accepted', execution };
    },
    begin(intent, targetMicroseconds, execution, admission) {
      const state = executions.get(execution), lane = laneFor(intent.laneId); let route = routes.resolve(lane?.outputId, lane?.id);
      if (!enabled() || !state || state.closed || intent.generation !== state.generation || !route) return reject('native-route-unavailable');
      if (lane.devicePatch && (!sameDevicePatchIntent(lane.devicePatch, route.patchBinding?.intent) || lane.externalProgram !== lane.devicePatch.bankPC[2] || lane.bankMSB !== lane.devicePatch.bankPC[0] || lane.bankLSB !== lane.devicePatch.bankPC[1])) return reject('explicit-current-device-patch-recall-required');
      const silence = unavailable(lane); if (silence) return reject(silence);
      if (!routes.allowsPerformance(route.grant)) return reject('native-device-observation-active');
      if (!Number.isSafeInteger(targetMicroseconds) || routes.client.clockStatus().status !== 'synchronized') return reject('native-clock-unavailable');
      if (state.voices.has(intent.voiceId) || state.voices.size >= maxVoices || [...state.voices.values()].some(entry => entry.uncertain)) return reject('native-voice-capacity-or-ownership');
      const pitch = (intent.pitch?.cents + (intent.expression?.pitchOffsetCents ?? 0)) / 100 + 12 * Math.log2((intent.pitch?.referenceHz ?? 440) / 440), note = Math.min(127, Math.round(pitch));
      if (!Number.isFinite(pitch) || pitch < 0 || pitch >= 128 || !unit(intent.velocity01)) return reject('native-pitch-or-velocity-unrepresentable');
      if (route.mpe) {
        const available = route.mpe.members.find(address => !channelVoices.has(channelKey({ ...route, ...address })));
        if (!available) return reject('ci-mpe-member-capacity');
        route = Object.freeze({ ...route, ...available });
      }
      const wireKey = keyFor(route, note);
      if (wireVoices.has(wireKey)) return reject('native-same-pitch-voice-overlap');
      if (!state.grantExecutions.has(route.grant)) state.grantExecutions.set(route.grant, routes.allocateExecutionEpoch());
      const entry = { state, route, wireExecution: state.grantExecutions.get(route.grant), intent, voiceId: intent.voiceId, laneId: lane.id, note, pitch, baseOffset: intent.expression?.pitchOffsetCents ?? 0, losses: [], uncertain: false, ending: false, setupRequested: false };
      if (!route.mpe && route.protocol === 'midi1-in-ump' && pitch !== note) entry.losses.push(Object.freeze({ kind: 'midi1-pitch-quantization', requested: pitch, represented: note }));
      if (lane.devicePatch) entry.losses.push(Object.freeze({ kind: 'device-patch-reported-under-user-declared-address-mapping', requested: lane.devicePatch.title }));
      entry.losses.push(Object.freeze({ kind: 'receiver-protocol-unverified', requested: route.protocol }));
      const words = [], program = JSON.stringify([lane.externalProgram, lane.bankMSB, lane.bankLSB]), address = channelKey(route);
      if (!route.mpe && !lane.devicePatch && state.programs.get(address) !== program && lane.externalProgram != null) {
        if (channelVoices.has(address)) return reject('native-program-change-would-affect-held-voices');
        if (route.protocol === 'midi2') words.push(...encodeIntent({ group: route.group, channel: route.channel, status: 'programChange', program: lane.externalProgram,
          bankValid: lane.bankMSB != null || lane.bankLSB != null, bankMSB: lane.bankMSB ?? 0, bankLSB: lane.bankLSB ?? 0 }));
        else { if (lane.bankMSB != null) words.push(...midi1(route, 11, 0, lane.bankMSB)); if (lane.bankLSB != null) words.push(...midi1(route, 11, 32, lane.bankLSB)); words.push(...midi1(route, 12, lane.externalProgram)); }
        entry.setupRequested = true;
      }
      if (route.mpe) {
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
      } else words.push(...noteWords(route, 'noteOn', note, intent.velocity01, pitch));
      if (!route.mpe && unit(intent.expression?.pressure01)) words.push(...(route.protocol === 'midi2' ? encodeIntent({ group: route.group, channel: route.channel, status: 'polyPressure', note, controllerValue: { value: Math.round(intent.expression.pressure01 * 0xffffffff), bits: 32 } }) : midi1(route, 10, note, Math.round(intent.expression.pressure01 * 127))));
      state.voices.set(intent.voiceId, entry); wireVoices.set(wireKey, entry); channelVoices.set(address, (channelVoices.get(address) || 0) + 1); state.grants.add(route.grant);
      const queued = send(entry, intent, admission, words, targetMicroseconds, 1, false, true); if (queued.status !== 'accepted') { removeVoice(entry); return queued; } if (entry.setupRequested) state.programs.set(address, program); if (entry.mpeSetupRequested) { state.mpeSetups.add(entry.mpeSetupRequested); state.mpeGains.set(entry.mpeSetupRequested, { value: Math.min(1, lane.gain ?? 1), pending: true, fault: null }); }
      return Object.freeze({ status: 'degraded', stage: 'accepted', losses: Object.freeze(entry.losses), outputId: route.outputId, channel: route.channel + 1, group: route.group });
    },
    update(voiceId, expression, targetMicroseconds, execution, slewSeconds, causeIntent, admission) {
      const entry = executions.get(execution)?.voices.get(voiceId);
      if (!enabled() || !entry || entry.state.closed || entry.uncertain || entry.ending) return reject('native-voice-unavailable');
      const words = [], losses = [];
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
        if (name === 'pressure01') {
          if (!unit(value)) return reject('invalid-native-pressure');
          words.push(...(entry.route.protocol === 'midi2' ? encodeIntent({ group: entry.route.group, channel: entry.route.channel, status: 'polyPressure', note: entry.note, controllerValue: { value: Math.round(value * 0xffffffff), bits: 32 } }) : midi1(entry.route, 10, entry.note, Math.round(value * 127))));
        } else if (name === 'pitchOffsetCents' && value === entry.baseOffset) continue;
        else losses.push(Object.freeze({ kind: 'native-expression-unavailable', field: name, requested: value }));
      }
      if (words.length) { const queued = send(entry, causeIntent || entry.intent, admission, words, targetMicroseconds); if (queued.status !== 'accepted') return queued; }
      return Object.freeze({ status: losses.length ? 'degraded' : 'accepted', stage: words.length ? 'accepted' : 'semantic-observation', outputRequested: !!words.length, losses: Object.freeze(losses) });
    },
    updatePhysical: () => Object.freeze({ status: 'degraded', stage: 'semantic-observation', outputRequested: false, reason: 'physical-audio-control-unrepresented-in-native-midi' }),
    updateCanonicalTravel: () => Object.freeze({ status: 'degraded', stage: 'semantic-observation', outputRequested: false, reason: 'travel-audio-realization-unrepresented-in-native-midi' }),
    transferVoiceLane(voiceId, laneId, targetMicroseconds, execution) {
      const entry = executions.get(execution)?.voices.get(voiceId), lane = laneFor(laneId), route = routes.resolve(lane?.outputId);
      if (!entry || unavailable(lane)) return reject('native-voice-unavailable');
      if (route?.outputId !== entry.route.outputId) return Object.freeze({ status: 'degraded', stage: 'semantic-observation', outputRequested: false, reason: 'held-native-route-pinned-until-release' });
      entry.laneId = laneId; return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false });
    },
    end(voiceId, options, targetMicroseconds, execution, causeIntent, admission) {
      const entry = executions.get(execution)?.voices.get(voiceId); if (!entry) return Object.freeze({ status: 'accepted', stage: 'already-retired', outputRequested: false });
      if (entry.ending) return Object.freeze({ status: 'accepted', stage: 'release-pending' });
      if (!enabled() || entry.uncertain) return reject('native-release-unconfirmed');
      const tail = options?.mode === 'one-shot' ? options.tailSeconds : 0;
      if (!Number.isFinite(tail) || tail < 0 || tail > 1.9) return reject('native-release-tail-outside-horizon');
      entry.ending = true; const queued = send(entry, causeIntent || entry.intent, admission, noteWords(entry.route, 'noteOff', entry.note, 0), Math.max(Math.round(now() * 1000), targetMicroseconds + Math.round(tail * 1000000)), 0, true);
      if (queued.status !== 'accepted') { entry.ending = false; return queued; }
      return Object.freeze({ status: 'accepted', stage: 'accepted' });
    },
    cancelGenerationWithReceipt(generation, execution) { const state = executions.get(execution); return state && state.generation !== generation ? reject('foreign-native-generation') : retireExecution(execution); },
    retireExecution
  };
  return {
    enabled, lastOutcome: () => latestReceipt,
    observe(score, { bpm, executionEpoch }) { if (!enabled()) return; if (!Number.isFinite(score?.beat) || !Number.isFinite(bpm) || bpm <= 0) throw new Error('Invalid native score anchor'); if (!anchor || anchor.executionEpoch !== executionEpoch || anchor.scoreEpoch !== score.epoch || anchor.bpm !== bpm) anchor = { executionEpoch, scoreEpoch: score.epoch, beat: score.beat, hostMs: now() + delayMs, bpm }; },
    sinks: ['local', 'prepared-body'].map(route => Object.freeze({ id: 'physical-native-midi:' + route, route, backend, enabled, executionLease: false, timeDomain: 'performance-microseconds',
      acceptsIntent: intent => intent.kind === 'begin' ? !!routes.resolve(laneFor(intent.laneId)?.outputId, intent.laneId) : [...executions.values()].some(state => state.voices.has(intent.voiceId)),
      getAdmissionIdentity: intent => { const current = routes.resolve(laneFor(intent.laneId)?.outputId, intent.laneId); return { connectionEpoch: current?.connectionEpoch ?? null, routeRevision: current?.routeRevision ?? 0 }; },
      latePolicy: ({ intent, targetFrame }) => targetFrame > now() * 1000 ? { status: 'accepted', targetFrame } : intent.kind === 'end' ? { status: 'accepted', targetFrame: Math.round(now() * 1000), repair: 'late-release' } : reject('late-native-intent'),
      toTargetFrame: score => anchor && anchor.scoreEpoch === score?.epoch ? Math.round((anchor.hostMs + (score.beat - anchor.beat) * 60000 / anchor.bpm) * 1000) : null })),
    synchronizeLaneMix() {
      for (const [execution, state] of executions) if (!state.closed) for (const entry of state.voices.values()) {
        const lane = laneFor(entry.laneId); if (lane && entry.route.mpe && !entry.ending) synchronizeMpeGain(entry, lane); if (!entry.ending && (unavailable(lane) || lane.outputId !== entry.route.outputId)) backend.end(entry.voiceId, {}, Math.round(now() * 1000), execution, entry.intent);
      }
    },
    diagnostics: () => Object.freeze({ disposed, ownerFailure, enabled: enabled(), executions: executions.size, latestReceipt, queue: batches.state(), clock: routes.client.clockStatus() }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; batches.dispose(); const receipt = retirement.retire([...executions].map(([execution, state]) => ({ name: state.epoch, run: () => retireExecution(execution) }))); receipt.completion.then(done => { if (done.outcome === 'complete') { removeOwner?.(); removeOwner = null; } }); return receipt; }
  };
}
