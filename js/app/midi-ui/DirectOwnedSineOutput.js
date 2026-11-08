import { PROTOCOL, WIDTH, CAPACITY, RECEIPT_WIDTH, BEGIN, UPDATE, END, CANCEL, LEASE, SCHEDULED, APPLIED, REJECTED, ENDED, CANCELLED, FAULTED } from './worklet/OwnedSineProcessor.js';
import { validateDirectOwnedSinePerformance } from './DirectOwnedSinePerformance.js';
import { createCausalPerformanceState } from '../procgen/workstation/CausalPerformanceState.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const fail = message => Object.assign(new Error(message), { code: 'direct-owned-audio' });
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
export async function createDirectOwnedSineOutput({ port, sampleRate, maxVoices = 8, resourceBudget, performance = null, onFailure = () => {}, onReceipt = () => {}, timers = globalThis, now = () => globalThis.performance.now() } = {}) {
  if (!port?.postMessage || ![44100, 48000, 96000].includes(sampleRate) || !Number.isInteger(maxVoices) || maxVoices < 1 || maxVoices > 8) throw fail('A direct owned source needs its transferred control port, exact rate and at most eight voices.');
  const lanePerformance = createCausalPerformanceState(validateDirectOwnedSinePerformance(performance || { version: 1, lanes: [] }));
  const storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'direct-owned-sine-output', kind: 'bounded-semantic-producer-and-in-flight-receipts', category: 'audio', bytes: 2 * 1048576 }), retirement = createProcgenRetirementScope();
  const voices = new Map(), pending = new Map(), executions = new Map(), handles = new WeakMap(), slots = new Array(maxVoices).fill(null), tokens = new Uint32Array(maxVoices), queued = [];
  let sequence = 0, packetSequence = 0, executionSequence = 0, disposed = false, failure = null, anchor = null, clock = null, poll = null, clockRequest = null, requestId = 0,
    unchangedSince = now(), previousFrame = -1, peakPending = 0, renderedCommands = 0, renderedEnds = 0, lastReceipt = null, closing = null, retirementProof = null, resolveRetired, rejectReady, resolveReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }); ready.catch(() => {});
  const retired = new Promise(resolve => { resolveRetired = resolve; });
  const reportFailure = error => {
    if (failure || disposed) return; failure = error; rejectReady(error);
    for (const command of pending.values()) { command.reject(error); command.appliedReject(error); }
    try { port.postMessage({ type: 'panic', protocol: PROTOCOL }); } catch {}
    try { onFailure(error); } catch {}
  };
  const currentFrame = () => {
    const time = now();
    if (disposed || failure || !clock || time - clock.received > 500) throw failure || fail('The independent worklet clock is unavailable or stale.');
    return Math.ceil(clock.frame + Math.max(0, time - clock.at) * sampleRate / 1000);
  };
  const targetFrame = score => {
    if (!anchor || score?.epoch !== anchor.epoch || !Number.isFinite(score.beat)) throw fail('The intent has no current direct audio score anchor.');
    const frame = Math.round(anchor.frame + (score.beat - anchor.beat) * sampleRate * 60 / anchor.bpm);
    if (!Number.isSafeInteger(frame) || frame < 0) throw fail('The direct audio score target exceeds its frame domain.'); return frame;
  };
  const key = (execution, voiceId) => execution.id + ':' + voiceId;
  const releaseSlot = voice => { if (slots[voice.slot] === voice) slots[voice.slot] = null; voices.delete(voice.key); voice.ended = true; };
  const stage = (opcode, frame, execution, voice = null, fields = {}, admission = null) => {
    if (disposed || failure || !Number.isSafeInteger(frame) || frame < 0 || !execution || execution.closed && opcode !== CANCEL || pending.size >= (opcode === END || opcode === CANCEL ? CAPACITY : CAPACITY - 64)) return { status: 'rejected', reason: failure?.message || 'direct-producer-capacity-or-identity' };
    const data = new Float64Array(WIDTH), serial = ++sequence; data[0] = execution.id; data[1] = frame; data[2] = serial; data[3] = opcode; data[4] = voice?.slot ?? -1; data[5] = voice?.token ?? 0; data[17] = execution.generation;
    for (const [index, value] of Object.entries(fields)) data[index] = value;
    let resolve, reject, appliedResolve, appliedReject;
    const accepted = new Promise((yes, no) => { resolve = yes; reject = no; }), applied = new Promise((yes, no) => { appliedResolve = yes; appliedReject = no; }); accepted.catch(() => {}); applied.catch(() => {});
    pending.set(serial, { serial, opcode, data, voice, admission, accepted, resolve, reject, applied, appliedResolve, appliedReject }); queued.push(serial); peakPending = Math.max(peakPending, pending.size);
    return { status: 'accepted', stage: 'bounded-independent-producer-queued', ackState: 'scheduled', sequence: serial, targetFrame: frame, appliedFrame: null, acousticReceipt: false };
  };
  const flush = async () => {
    if (failure || disposed) throw failure || fail('The independent producer retired.');
    if (!queued.length) return;
    const ids = queued.splice(0), data = new Float64Array(ids.length * WIDTH), commands = ids.map(id => pending.get(id));
    commands.forEach((command, index) => data.set(command.data, index * WIDTH));
    let timeout;
    try {
      port.postMessage({ type: 'commands', protocol: PROTOCOL, packetSequence: ++packetSequence, count: commands.length, data }, [data.buffer]);
      await Promise.race([Promise.all(commands.map(command => command.accepted)), new Promise((_resolve, reject) => { timeout = timers.setTimeout(() => reject(fail('The render kernel did not acknowledge the bounded source packet.')), 1000); })]);
    } catch (error) { reportFailure(error); throw error; } finally { timers.clearTimeout(timeout); }
  };
  const resolveExecution = (handle, generation) => { const execution = handles.get(handle); return execution && !execution.closed && (generation == null || execution.generation === generation) ? execution : null; };
  const backend = {
    registerExecution({ executionEpoch, generation } = {}) {
      if (disposed || failure || typeof executionEpoch !== 'string' || !executionEpoch || executionEpoch.length > 512 || !Number.isSafeInteger(generation) || generation < 0 || executions.size >= 2) return { status: 'rejected', reason: 'direct-execution-identity-or-capacity' };
      const handle = Object.freeze({ executionEpoch, generation }), execution = { id: ++executionSequence, generation, epoch: executionEpoch, closed: false, handle, retirement: null };
      handles.set(handle, execution); executions.set(execution.id, execution); return { status: 'accepted', execution: handle };
    },
    begin(intent, frame, handle, admission) {
      const execution = resolveExecution(handle, intent.generation), slot = slots.indexOf(null), expression = intent.expression || {}, mix = lanePerformance.getMix(intent.laneId) || { gain: 1, pan: 0 };
      if (intent.percussionHit || intent.orchestralArticulation || intent.pianoPerformance || !execution || slot < 0 || voices.has(key(execution, intent.voiceId)) || intent.route !== 'local' || !finite(intent.pitch?.cents, -12000, 24000) || !finite(intent.pitch.referenceHz ?? 440, 1, 20000) || !finite(intent.velocity01, 0, 1) || Object.keys(expression).some(id => !['pressure01', 'pan01', 'pitchOffsetCents'].includes(id)) ||
          expression.pressure01 != null && !finite(expression.pressure01, 0, 1) || expression.pan01 != null && !finite(expression.pan01, -1, 1) || expression.pitchOffsetCents != null && !finite(expression.pitchOffsetCents, -24000, 24000)) return { status: 'rejected', reason: 'direct-sine-capability-or-voice-capacity' };
      const baseFrequency = (intent.pitch.referenceHz ?? 440) * 2 ** ((intent.pitch.cents - 6900) / 1200), frequency = baseFrequency * 2 ** ((expression.pitchOffsetCents || 0) / 1200);
      if (!finite(frequency, .1, sampleRate / 2 - 1) || tokens[slot] === 0xffffffff) return { status: 'rejected', reason: 'direct-sine-frequency-or-token-domain' };
      const voice = { slot, token: ++tokens[slot], execution, key: key(execution, intent.voiceId), voiceId: intent.voiceId, baseFrequency, beginFrame: frame, lease: frame + sampleRate * 2, released: false, ended: false };
      const outcome = stage(BEGIN, frame, execution, voice, { 6: frequency, 7: intent.velocity01 * .12, 8: expression.pressure01 ?? 1, 9: expression.pan01 ?? 0, 10: Math.ceil(.005 * sampleRate), 11: Math.ceil(.02 * sampleRate), 12: .8, 13: Math.ceil(.04 * sampleRate), 14: mix.gain + 1, 15: mix.pan / 127, 16: voice.lease }, admission);
      if (outcome.status === 'accepted') { slots[slot] = voice; voices.set(voice.key, voice); } return outcome;
    },
    update(voiceId, expression, frame, handle, slewSeconds = .008, _intent, admission) {
      const execution = resolveExecution(handle), voice = execution && voices.get(key(execution, voiceId));
      if (!voice || voice.released || !expression || Object.getPrototypeOf(expression) !== Object.prototype || Object.keys(expression).some(id => !['pitchOffsetCents', 'pressure01', 'pan01'].includes(id)) || !finite(slewSeconds, 0, 1)) return { status: 'rejected', reason: 'direct-sine-expression-capability-or-owner' };
      const fields = { 14: Math.ceil(Math.max(.008, slewSeconds) * sampleRate) }; let mask = 0;
      if (expression.pitchOffsetCents != null) { const frequency = voice.baseFrequency * 2 ** (expression.pitchOffsetCents / 1200); if (!finite(expression.pitchOffsetCents, -24000, 24000) || !finite(frequency, .1, sampleRate / 2 - 1)) return { status: 'rejected', reason: 'direct-sine-pitch-domain' }; fields[6] = frequency; mask |= 1; }
      if (expression.pressure01 != null) { if (!finite(expression.pressure01, 0, 1)) return { status: 'rejected', reason: 'direct-sine-pressure-domain' }; fields[8] = expression.pressure01; mask |= 2; }
      if (expression.pan01 != null) { if (!finite(expression.pan01, -1, 1)) return { status: 'rejected', reason: 'direct-sine-pan-domain' }; fields[9] = expression.pan01; mask |= 4; }
      if (!mask) return { status: 'accepted', stage: 'semantic-observation', outputRequested: false }; fields[15] = mask; return stage(UPDATE, frame, execution, voice, fields, admission);
    },
    end(voiceId, release, frame, handle, _intent, admission) {
      const execution = resolveExecution(handle), voice = execution && voices.get(key(execution, voiceId));
      if (!voice) return { status: 'rejected', reason: 'direct-sine-end-owner' };
      const seconds = release?.seconds ?? .04, tail = release?.mode === 'one-shot' ? release.tailSeconds : 0;
      if (!finite(seconds, .001, 4) || !finite(tail, 0, 4)) return { status: 'rejected', reason: 'direct-sine-release-domain' };
      const end = frame + Math.ceil(tail * sampleRate), until = end + Math.ceil(seconds * sampleRate) + 1;
      if (until > voice.lease) { const renewal = stage(LEASE, Math.max(currentFrame() + 1, voice.beginFrame), execution, voice, { 16: until }); if (renewal.status !== 'accepted') return renewal; voice.lease = until; }
      const result = stage(END, end, execution, voice, { 13: Math.ceil(seconds * sampleRate) }, admission); if (result.status === 'accepted') voice.released = true; return result;
    },
    cancelGenerationWithReceipt(generation, handle) {
      const execution = handles.get(handle); if (!execution || execution.generation !== generation) return { status: 'rejected', reason: 'direct-cancel-owner' };
      if (execution.retirement) return { retirement: execution.retirement };
      const scope = createProcgenRetirementScope();
      const result = stage(CANCEL, currentFrame() + 1, execution); execution.closed = true;
      execution.retirement = scope.retire([{ name: 'direct-generation-render-cancel', run: async () => {
        if (result.status !== 'accepted') throw fail('The direct kernel could not admit its reserved generation cancellation.');
        const command = pending.get(result.sequence); await flush(); await command.applied;
        const deadline = now() + 1000;
        while ([...voices.values()].some(voice => voice.execution === execution)) { if (failure || now() >= deadline) throw failure || fail('The direct source retained an unconfirmed voice after generation cancellation.'); await new Promise(resolve => timers.setTimeout(resolve, 5)); }
        executions.delete(execution.id);
      } }]); return { retirement: execution.retirement };
    },
    retireExecution(handle) { const execution = handles.get(handle); return execution ? this.cancelGenerationWithReceipt(execution.generation, handle).retirement : null; },
    executionIncarnation: () => 1
  };
  const requestClock = () => {
    if (disposed || failure) return;
    const time = now();
    if (clockRequest && time - clockRequest.at > 500) { reportFailure(fail('The direct source clock reply timed out.')); return; }
    if (!clockRequest) { clockRequest = { id: ++requestId, at: time }; try { port.postMessage({ type: 'inspect', requestId: clockRequest.id }); } catch (error) { reportFailure(error); return; } }
    poll = timers.setTimeout(requestClock, 100);
  };
  port.onmessage = event => {
    const message = event.data;
    if (message?.type === 'processor-retired' && message.protocol === PROTOCOL && message.retirementProtocol === 1 && message.retirementId === 1 && message.stage === 'processor-state-released' && message.renderingContinues === false && Number.isSafeInteger(message.frame) && message.frame >= 0) { resolveRetired(message); return; }
    if (disposed || failure) return;
    try {
      if (message?.type === 'health' && message.protocol === PROTOCOL && message.requestId === clockRequest?.id) {
        const received = now(), elapsed = received - clockRequest.at;
        if (!Number.isSafeInteger(message.frame) || message.frame < previousFrame || elapsed < 0 || elapsed > 100 || !Array.isArray(message.counters) || message.counters.some(value => value !== 0) || message.nonfinite) throw fail('The direct source clock or containment receipt is outside its admitted bounds.');
        if (message.frame !== previousFrame) unchangedSince = received; else if (received - unchangedSince > 500) throw fail('The direct audio clock stopped; explicitly resume through a new paused owner.');
        previousFrame = message.frame; clock = { frame: message.frame, at: clockRequest.at + elapsed / 2, received }; clockRequest = null; resolveReady(); return;
      }
      if (message?.type !== 'receipts' || message.protocol !== PROTOCOL || !Number.isInteger(message.count) || message.count < 0 || message.count > 64 || !(message.data instanceof Float64Array) || message.data.length !== 64 * RECEIPT_WIDTH) throw fail('The direct source returned a malformed control or receipt packet.');
      for (let index = 0; index < message.count; index++) {
        const at = index * RECEIPT_WIDTH, [code, serial, slot, token, frame, reason] = message.data.subarray(at, at + RECEIPT_WIDTH);
        if (![SCHEDULED, APPLIED, REJECTED, ENDED, CANCELLED, FAULTED].includes(code) || ![serial, slot, token, frame, reason].every(Number.isSafeInteger) || frame < 0) throw fail('The direct source returned an invalid render receipt.');
        const command = pending.get(serial), voice = slots[slot];
        lastReceipt = { code, sequence: serial, slot, token, frame, reason }; try { onReceipt(lastReceipt); } catch {}
        if (code === ENDED) { if (voice?.token === token) releaseSlot(voice); renderedEnds++; continue; }
        if (code === FAULTED || code === REJECTED) throw fail('The direct render kernel refused or faulted command ' + serial + ', reason ' + reason + '.');
        if (!command) { if (serial === 0 && code === SCHEDULED && reason === 2) continue; throw fail('A direct render receipt has no outstanding command.'); }
        if (code === SCHEDULED) command.resolve();
        else {
          command.resolve(); command.appliedResolve(); pending.delete(serial);
          if (code === CANCELLED && voice?.token === token && command.opcode === BEGIN) releaseSlot(voice);
          if (code === APPLIED) { renderedCommands++; command.admission?.acknowledge?.({ status: 'accepted', ackState: 'applied', stage: 'applied', appliedFrame: frame }); }
        }
      }
    } catch (error) { reportFailure(error); }
  };
  port.onmessageerror = () => reportFailure(fail('The direct worklet port could not decode its message.')); port.start?.(); requestClock();
  try { await ready; } catch (error) { timers.clearTimeout(poll); port.onmessage = null; port.onmessageerror = null; port.close(); storage.release(); throw error; }
  const output = {
    backend, enabled: () => !disposed && !failure,
    observe(score, { bpm, executionEpoch, generation }) {
      const frame = currentFrame();
      if (!anchor || anchor.executionEpoch !== executionEpoch || anchor.epoch !== score.epoch) anchor = { epoch: score.epoch, executionEpoch, beat: score.beat, frame: frame + Math.ceil(sampleRate * .2), bpm };
      else if (anchor.bpm !== bpm) anchor = { ...anchor, beat: score.beat, frame: targetFrame(score), bpm };
      const target = targetFrame(score);
      for (const voice of voices.values()) if (!voice.released && voice.execution.generation === generation && voice.lease - target < sampleRate) {
        const until = target + sampleRate * 2, result = stage(LEASE, Math.max(frame + 1, voice.beginFrame), voice.execution, voice, { 16: until }); if (result.status !== 'accepted') throw fail('The direct source could not renew its bounded execution lease.'); voice.lease = until;
      }
    },
    flushSourceControls: flush, processorRetirement: () => retirementProof,
    diagnostics: () => ({ engineId: 'worklet-sine', engineVersion: 1, output: 'explicit-owned-reference-sine', maximumVoices: maxVoices, activeVoices: voices.size, inFlight: pending.size, queued: queued.length, peakPending, renderedCommands, renderedEnds, lastReceipt, failure: failure?.message || null,
      path: 'authoritative-worker-to-independent-producer-to-owned-audio-worklet;no-ui-event-relay', capabilities: 'fractional-pitch-pressure-pan;fixed-owned-envelope;no-assets-rack-body-or-live-patch-mapping', acousticEvidence: false }),
    dispose() {
      if (closing) return closing; disposed = true; timers.clearTimeout(poll);
      for (const command of pending.values()) { command.reject(fail('The direct source retired.')); command.appliedReject(fail('The direct source retired.')); }
      closing = retirement.retire([{ name: 'actual-owned-processor-state', run: async () => {
        let timeout; try { port.postMessage({ type: 'retire-processor', protocol: PROTOCOL, retirementProtocol: 1, retirementId: 1 });
          const receipt = await Promise.race([retired, new Promise((_resolve, reject) => { timeout = timers.setTimeout(() => reject(fail('The direct source processor did not confirm retirement.')), 4000); })]);
          retirementProof = receipt; port.onmessage = null; port.onmessageerror = null; port.close(); pending.clear(); queued.length = 0; voices.clear(); executions.clear(); slots.fill(null); storage.release(); return receipt;
        } finally { timers.clearTimeout(timeout); }
      } }]); return closing;
    }
  };
  const sink = { id: 'physical-direct-owned-sine', route: 'local', backend, enabled: output.enabled, timeDomain: 'audio-frame', toTargetFrame: score => targetFrame(score),
    getAdmissionIdentity: () => ({ connectionEpoch: 1, routeRevision: 1, outputId: 'owned-reference-sine' }), latePolicy: ({ intent, targetFrame }) => {
      const frame = currentFrame(); if (targetFrame > frame) return { status: 'accepted', targetFrame }; return intent.kind === 'end' ? { status: 'accepted', targetFrame: frame, repair: 'late-release' } : { status: 'rejected', reason: 'direct-owned-source-deadline' };
    } };
  return Object.freeze({ ...output, sinks: Object.freeze([Object.freeze(sink)]) });
}
