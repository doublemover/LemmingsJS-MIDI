import { createAudioCommandQueue } from './AudioCommandQueue.js';
import { PROTOCOL, WIDTH, CAPACITY, MAX_VOICES, RECEIPT_WIDTH, BEGIN, UPDATE, END, CANCEL, LEASE,
  SCHEDULED, APPLIED, REJECTED, ENDED, CANCELLED, FAULTED } from './worklet/OwnedSineProcessor.js';

const runtime = Object.freeze({ buildId: 'owned-sine-v1', hostProtocolVersion: PROTOCOL, runtimeABI: 'owned-sine-f64-command-v1',
  engineId: 'worklet-sine', engineVersion: 1, workletUrl: new URL('./worklet/OwnedSineProcessor.js', import.meta.url).href,
  transport: 'batched-transferable-message-port', sharedMemory: false });
const modules = new WeakMap();
const capabilities = Object.freeze({ independentSamePitch: true, perVoicePitch: true, perVoicePressure: true, perVoicePan: true,
  perVoiceTimbre: false, offlineRender: true, ownedGates: true, renderAcknowledgment: true,
  maximumVoices: MAX_VOICES, latencyFrames: 0, sustainPedal: false, sostenuto: false, releaseVelocity: false,
  supportedParameterIds: Object.freeze(['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds', 'gain01', 'pan01']) });
const fields = Object.freeze({ attackSeconds: [0, 2, 0.008], decaySeconds: [0, 4, 0.05], sustain01: [0, 1, 0.7],
  releaseSeconds: [0.002, 4, 0.04], gain01: [0, 1, 0.5], pan01: [-1, 1, 0] });
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const keyFor = (epoch, id) => JSON.stringify([epoch, id]);
const kernelReasons = Object.freeze({ 1: 'invalid-command', 2: 'kernel-queue-full', 3: 'generation-cancelled', 4: 'late-command',
  5: 'kernel-voice-budget-or-range', 6: 'stale-voice-slot', 7: 'owner-lease-expired', 8: 'nonfinite-dsp', 9: 'pending-onset-cancelled' });

export function createWorkletInstrumentBackend(preview, owner = null, { leadSeconds = 0.25, smoothingSeconds = 0.008,
  traceLimit = 128, createWorkletNode = null, initializationTimeoutMs = 5000 } = {}) {
  if (!finite(leadSeconds, 0.01, 2) || !finite(smoothingSeconds, 0, 1) || !Number.isSafeInteger(traceLimit) || traceLimit < 0 || traceLimit > 4096 ||
      !finite(initializationTimeoutMs, 1, 30000)) throw new Error('Invalid worklet backend options.');
  let node = null, context = null, ready = false, disposed = false, preparing = 0, patch = null, sequence = 0, packetSequence = 0;
  let pumpTimer = null, fault = null, truncated = 0, nextEpoch = 0, cancellationHistoryFull = false;
  let ownerStopped = false;
  let runtimeResourceLease = null;
  let pumpQueued = false;
  const voices = new Map(), epochs = new Map(), leases = new Map(), cancelled = new Set(), inFlight = new Map(), traces = [];
  const pendingInitializations = new Set();
  const kernelQueued = new Set();
  const slots = new Array(MAX_VOICES).fill(null), slotTokens = new Uint32Array(MAX_VOICES);
  const counters = { queued: 0, applied: 0, late: 0, rejected: 0, faults: 0, ended: 0, producerCancelled: 0, kernelCancelled: 0 };
  let queue = null;
  const frameNow = () => context && context === preview.getAudioContext() ? Math.ceil(context.currentTime * context.sampleRate) : null;
  const record = value => {
    if (traceLimit) { if (traces.length === traceLimit) { traces.shift(); truncated++; } traces.push(Object.freeze({ owner,
      engineId: runtime.engineId, engineVersion: 1, acousticReceipt: false, ...value })); }
    return Object.freeze(value);
  };
  const reject = (reason, voiceId = null) => { counters.rejected++; return record({ status: 'rejected', reason, voiceId, stage: 'none' }); };
  const clearTimer = () => { if (pumpTimer != null) clearTimeout(pumpTimer); pumpTimer = null; };
  const markFault = reason => {
    if (fault || disposed) return;
    fault = reason; ready = false; counters.faults++; clearTimer(); queue?.clear(); inFlight.clear(); kernelQueued.clear();
    try { node?.port.postMessage({ type: 'panic', protocol: PROTOCOL }); } catch { /* The processor may have failed. */ }
    for (const voice of voices.values()) preview._destroyVoice(voice, 'kernel-fault');
    voices.clear(); slots.fill(null); node?.disconnect(); node?.port.close(); node = null;
    runtimeResourceLease?.release(); runtimeResourceLease = null;
    record({ status: 'faulted', reason, stage: 'runtime', appliedFrame: null });
  };
  const pump = () => {
    clearTimer();
    const now = frameNow();
    if (!ready || disposed || !Number.isSafeInteger(now)) return;
    const batch = queue.drainThrough(now + Math.ceil(leadSeconds * context.sampleRate), CAPACITY);
    if (batch.length) {
      const packet = new Float64Array(batch.length * WIDTH);
      for (let index = 0; index < batch.length; index++) {
        const command = batch[index]; packet.set(command.data, index * WIDTH); inFlight.set(command.sequence, command);
        const voice = slots[command.data[4]]; if (voice?.slotToken === command.slotToken) voice.submitted = true;
      }
      try { node.port.postMessage({ type: 'commands', protocol: PROTOCOL, packetSequence: ++packetSequence, count: batch.length, data: packet }, [packet.buffer]); }
      catch { markFault('command-port-failure'); return; }
    }
    const first = queue.firstFrame();
    if (first != null) pumpTimer = setTimeout(pump, Math.max(1, (first - now) * 1000 / context.sampleRate - leadSeconds * 1000));
  };
  const schedulePump = () => {
    if (pumpQueued) return;
    pumpQueued = true;
    Promise.resolve().then(() => { pumpQueued = false; pump(); });
  };
  const command = (opcode, frame, voice = null, values = {}) => {
    const now = frameNow();
    if (!Number.isSafeInteger(now)) return reject('context-replaced', voice?.voiceId);
    if (inFlight.size >= CAPACITY && opcode !== END && opcode !== CANCEL) return reject('kernel-acknowledgment-pressure', voice?.voiceId);
    const data = new Array(WIDTH).fill(0), serial = ++sequence;
    data[0] = voice?.epochToken ?? values.epochToken ?? 0; data[1] = frame; data[2] = serial; data[3] = opcode;
    data[4] = voice?.slot ?? -1; data[5] = voice?.slotToken ?? 0; data[17] = voice?.semanticGeneration ?? values.generation ?? 0;
    for (const [field, value] of Object.entries(values)) if (/^\d+$/.test(field)) data[Number(field)] = value;
    const outcome = queue.enqueue({ opcode, frame, sequence: serial, data: Object.freeze(data),
      epoch: voice?.semanticEpoch ?? values.epoch, generation: data[17], voiceId: voice?.voiceId ?? null, slotToken: voice?.slotToken ?? 0 }, now);
    if (outcome.status === 'rejected') {
      if (opcode === END || opcode === CANCEL) {
        try { node.port.postMessage({ type: 'panic', protocol: PROTOCOL }); } catch { markFault('terminal-port-failure'); }
        record({ status: 'degraded', reason: 'terminal-pressure-controlled-mute', stage: 'submitted', appliedFrame: null });
      }
      return reject(outcome.reason, voice?.voiceId);
    }
    counters.queued++; schedulePump(); return record({ status: 'accepted', stage: 'queued', voiceId: voice?.voiceId ?? null,
      executionEpoch: voice?.semanticEpoch ?? values.epoch, targetFrame: frame, sequence: serial, appliedFrame: null });
  };
  const onReceipts = data => {
    if (data.protocol !== PROTOCOL || !(data.data instanceof Float64Array) || !Number.isInteger(data.count) || data.count < 0 ||
        data.count * RECEIPT_WIDTH > data.data.length || data.count > 64) { markFault('invalid-kernel-receipt'); return; }
    for (let index = 0; index < data.count; index++) {
      const at = index * RECEIPT_WIDTH, code = data.data[at], serial = data.data[at + 1], slot = data.data[at + 2], token = data.data[at + 3];
      const frame = data.data[at + 4], reason = data.data[at + 5], original = inFlight.get(serial);
      const voice = slots[slot]?.slotToken === token ? slots[slot] : null;
      if (code === SCHEDULED) {
        if (original) kernelQueued.add(serial);
        if (original) record({ status: 'accepted', stage: 'kernel-queued', sequence: serial, voiceId: original.voiceId,
          executionEpoch: original.epoch, generation: original.generation, targetFrame: original.frame, appliedFrame: null });
        continue;
      }
      kernelQueued.delete(serial);
      if (code === APPLIED) {
        if (reason === 2 && slot === -1) ownerStopped = false;
        counters.applied++; inFlight.delete(serial);
        if (voice) { voice.appliedFrame = frame; voice.lastAppliedSequence = serial; }
      } else if (code === ENDED || code === FAULTED) {
        counters.ended++; if (code === FAULTED) counters.faults++;
        if (voice) { voice.kernelEnded = true; voice.appliedFrame = frame;
          preview._destroyVoice(voice, kernelReasons[reason] || 'worklet-source-ended'); slots[slot] = null; }
        inFlight.delete(serial);
      } else if (code === REJECTED || code === CANCELLED) {
        if (code === REJECTED) counters.rejected++;
        if (reason === 4) counters.late++; if (code === CANCELLED) counters.kernelCancelled++;
        if (voice && (original?.opcode === BEGIN || reason === 9)) {
          voice.kernelEnded = true; preview._destroyVoice(voice, kernelReasons[reason] || 'kernel-rejected'); slots[slot] = null;
        }
        inFlight.delete(serial);
      }
      record({ status: code === REJECTED ? 'rejected' : code === FAULTED ? 'faulted' : code === CANCELLED ? 'cancelled' : 'accepted',
        stage: code === APPLIED ? 'render-kernel-applied' : code === ENDED ? 'render-kernel-ended' : 'render-kernel-outcome',
        voiceId: voice?.voiceId ?? original?.voiceId ?? null, executionEpoch: voice?.semanticEpoch ?? original?.epoch ?? null,
        generation: voice?.semanticGeneration ?? original?.generation ?? null, sequence: serial, appliedFrame: frame,
        targetFrame: original?.frame ?? null, reason: reason === 2 && code !== REJECTED ? 'panic' : kernelReasons[reason] || null });
    }
  };
  const validate = resolution => {
    const input = resolution?.patch;
    if (!['ready', 'degraded'].includes(resolution?.status) || input?.engineId !== runtime.engineId || input.engineVersion !== 1 ||
        typeof input.id !== 'string' || !input.id || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
        resolution.receipt?.patchId !== input.id || resolution.receipt?.revision !== input.revision || input.sampleRefs?.length || input.modulations?.length ||
        !Number.isSafeInteger(input.voicePolicy?.maxVoices) || input.voicePolicy.maxVoices < 1 || input.voicePolicy.maxVoices > MAX_VOICES ||
        !finite(input.mix?.gain01, 0, 1) || !finite(input.mix?.pan01, -1, 1)) return null;
    const parameters = Object.fromEntries(Object.entries(fields).map(([id, spec]) => [id, spec[2]]));
    for (const [id, value] of Object.entries(input.parameters || {})) {
      if (!fields[id] || !finite(value, fields[id][0], fields[id][1])) return null; parameters[id] = value;
    }
    return Object.freeze({ id: input.id, revision: input.revision, parameters: Object.freeze(parameters),
      maxVoices: input.voicePolicy.maxVoices, gain01: input.mix.gain01, pan01: input.mix.pan01 });
  };
  const prepare = async (resolution, assets = []) => {
    if (disposed) return reject('disposed');
    if (!Array.isArray(assets) || assets.length) return reject('assets-unsupported');
    const next = validate(resolution); if (!next) return reject('unsupported-patch-or-engine');
    const candidateContext = preview.getAudioContext();
    if (!candidateContext?.audioWorklet?.addModule) return reject('audio-worklet-unavailable');
    if (context && context !== candidateContext) { onOwnerStop(); node?.disconnect(); node?.port.close(); node = null; ready = false;
      runtimeResourceLease?.release(); runtimeResourceLease = null; }
    const revision = ++preparing, generation = preview._generation, ownerGeneration = preview._sessions.get(owner)?.generation;
    let candidate = null, timer = null, cancelInitialization = null, candidateResourceLease = null;
    let interrupt;
    const interrupted = new Promise((_resolve, rejectInterrupted) => { interrupt = rejectInterrupted; });
    cancelInitialization = () => interrupt(new Error('preparation-cancelled')); pendingInitializations.add(cancelInitialization);
    try {
      timer = setTimeout(() => interrupt(new Error('kernel-initialization-timeout')), initializationTimeoutMs);
      if (!ready) candidateResourceLease = preview._audioResources?.reserveWorkletRuntime(owner, preview._generation) || null;
      if (!modules.has(candidateContext)) {
        const loading = candidateContext.audioWorklet.addModule(runtime.workletUrl);
        modules.set(candidateContext, loading); loading.catch(() => { if (modules.get(candidateContext) === loading) modules.delete(candidateContext); });
      }
      await Promise.race([modules.get(candidateContext), interrupted]);
      if (disposed || revision !== preparing || generation !== preview._generation || ownerGeneration !== preview._sessions.get(owner)?.generation) return reject('preparation-cancelled');
      if (!ready) {
        const destination = preview._channel(0, owner).gain;
        const create = createWorkletNode || ((audioContext, name, options) => new globalThis.AudioWorkletNode(audioContext, name, options));
        candidate = create(candidateContext, 'lemmings-owned-sine-v1', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { maxVoices: MAX_VOICES } });
        await Promise.race([new Promise((resolve, rejectReady) => {
          candidate.onprocessorerror = () => rejectReady(new Error('processor-error-during-prepare'));
          candidate.port.onmessage = event => {
            const data = event.data;
            if (data?.type !== 'ready' || data.protocol !== PROTOCOL || data.engineId !== runtime.engineId || data.engineVersion !== 1 ||
                data.runtimeABI !== runtime.runtimeABI || data.buildId !== runtime.buildId || data.maxVoices !== MAX_VOICES ||
                data.sampleRate !== candidateContext.sampleRate || data.width !== WIDTH || data.capacity !== CAPACITY) return rejectReady(new Error('kernel-abi-mismatch'));
            resolve();
          };
        }), interrupted]);
        if (disposed || revision !== preparing || generation !== preview._generation || ownerGeneration !== preview._sessions.get(owner)?.generation) {
          candidate.disconnect(); candidate.port.close(); return reject('preparation-cancelled');
        }
        candidate.connect(destination);
        node = candidate; candidate = null; context = candidateContext;
        queue = createAudioCommandQueue({ capacity: CAPACITY, terminalReserve: MAX_VOICES, maxHorizonFrames: Math.ceil(context.sampleRate * 10) });
        const connectedNode = node;
        node.port.onmessage = event => {
          if (disposed || node !== connectedNode) return;
          if (event.data?.type === 'receipts') onReceipts(event.data);
          else if (event.data?.type === 'protocol-error') markFault('kernel-protocol-error');
        };
        node.onprocessorerror = () => { if (node === connectedNode) markFault('processor-error'); };
        runtimeResourceLease = candidateResourceLease; candidateResourceLease = null;
        ready = true; fault = null; ownerStopped = false;
      }
      patch = next; return Object.freeze({ status: 'ready', patchId: next.id, revision: next.revision, capabilities, runtime });
    } catch (error) {
      candidate?.disconnect(); candidate?.port.close();
      return reject(error?.name === 'ResourceBudgetError' ? 'audio-resource-budget' : String(error?.message || 'worklet-initialization-failed').slice(0, 160));
    } finally { candidateResourceLease?.release(); if (timer != null) clearTimeout(timer); pendingInitializations.delete(cancelInitialization); }
  };
  const epochToken = epoch => {
    if (epochs.has(epoch)) return epochs.get(epoch);
    if (epochs.size >= 64) return null;
    const token = ++nextEpoch; epochs.set(epoch, token); return token;
  };
  const renewExecutionLease = (generation, executionEpoch, validUntilFrame) => {
    const now = frameNow();
    if (!ready || !preview._ownerReady(owner)) return reject('audio-not-ready');
    if (!Number.isSafeInteger(generation) || generation < 0 || typeof executionEpoch !== 'string' || !executionEpoch ||
        !Number.isSafeInteger(validUntilFrame) || validUntilFrame <= now || validUntilFrame - now > context.sampleRate * 120) return reject('invalid-execution-lease');
    const key = keyFor(executionEpoch, generation);
    if (cancelled.has(key) || cancellationHistoryFull) return reject('generation-cancelled');
    const prior = leases.get(key); if (prior && validUntilFrame <= prior) return reject('stale-execution-lease');
    if (!prior && leases.size >= 64) return reject('execution-lease-budget');
    leases.set(key, validUntilFrame);
    for (const voice of voices.values()) if (voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch && !voice.released) {
      const result = command(LEASE, Math.max(now, Math.round(voice.start * context.sampleRate)), voice, { 16: validUntilFrame });
      if (result.status === 'rejected') return result;
      voice.end = validUntilFrame / context.sampleRate; voice.releaseAt = voice.end - voice.release;
    }
    return Object.freeze({ status: 'accepted', generation, executionEpoch, validUntilFrame, stage: 'queued' });
  };
  const begin = (intent, targetFrame, executionEpoch = 'live') => {
    if (!ready || !patch || !preview._ownerReady(owner) || context !== preview.getAudioContext()) return reject(fault || 'audio-not-ready', intent?.voiceId);
    if (ownerStopped) return reject('kernel-stop-pending', intent?.voiceId);
    const now = frameNow();
    if (intent?.version !== 1 || intent.kind !== 'begin' || typeof intent.voiceId !== 'string' || !intent.voiceId || intent.voiceId.length > 256 ||
        !Number.isSafeInteger(intent.generation) || intent.generation < 0 || !finite(intent.velocity01, 0, 1) || !finite(intent.pitch?.cents, -24000, 24000) ||
        !finite(intent.pitch?.referenceHz ?? 440, 0.1, 20000) || typeof executionEpoch !== 'string' || !executionEpoch ||
        !Number.isSafeInteger(targetFrame) || targetFrame < now) return reject('invalid-or-late-intent', intent?.voiceId);
    const expression = intent.expression || {}, pressure = expression.pressure01 ?? 1, pan = expression.pan01 ?? patch.parameters.pan01,
      offset = expression.pitchOffsetCents ?? 0;
    if (typeof expression !== 'object' || Array.isArray(expression) || Object.getPrototypeOf(expression) !== Object.prototype ||
        !finite(pressure, 0, 1) || !finite(pan, -1, 1) || !finite(offset, -24000, 24000) ||
        Object.keys(expression).some(id => !['pressure01', 'pan01', 'pitchOffsetCents'].includes(id))) return reject('unsupported-expression', intent.voiceId);
    const frequency = (intent.pitch.referenceHz ?? 440) * 2 ** ((intent.pitch.cents - 6900 + offset) / 1200);
    if (!finite(frequency, 0.1, context.sampleRate / 2 - 1)) return reject('pitch-out-of-range', intent.voiceId);
    const key = keyFor(executionEpoch, intent.voiceId), generationKey = keyFor(executionEpoch, intent.generation);
    if (cancelled.has(generationKey) || cancellationHistoryFull) return reject('generation-cancelled', intent.voiceId);
    if (voices.has(key) || preview._semanticVoiceOwners.has(JSON.stringify([owner, executionEpoch, intent.voiceId]))) return reject('duplicate-owner-voice', intent.voiceId);
    const slot = slots.findIndex(voice => voice == null), token = epochToken(executionEpoch);
    if (slot < 0 || token == null || voices.size >= patch.maxVoices || preview._renderVoiceCount() >= preview._maxScheduledVoices ||
        preview._renderVoiceCount([...preview._voices].filter(voice => !voice.stolen && (voice.renderCost > 1 || voice.start <= targetFrame / context.sampleRate &&
          voice.releaseAt > targetFrame / context.sampleRate))) >= preview._maxVoices) return reject('shared-voice-budget', intent.voiceId);
    if (slotTokens[slot] === 0xffffffff) return reject('voice-slot-generation-exhausted', intent.voiceId);
    const parameters = patch.parameters, endFrame = leases.get(generationKey) ?? targetFrame + Math.ceil(preview._maxNoteSeconds * context.sampleRate);
    if (endFrame <= targetFrame + parameters.releaseSeconds * context.sampleRate) return reject('execution-lease-expired', intent.voiceId);
    let resourceLease = null;
    try { resourceLease = preview._audioResources?.reserveWorkletVoice(owner, intent.generation) || null; }
    catch { return reject('audio-resource-budget', intent.voiceId); }
    const voice = { owner, number: 0, voiceId: intent.voiceId, semanticGeneration: intent.generation, semanticEpoch: executionEpoch,
      resourceLease,
      epochToken: token, slot, slotToken: ++slotTokens[slot], id: ++preview._voiceSequence, start: targetFrame / context.sampleRate,
      note: Math.round(intent.pitch.cents / 100), velocity: intent.velocity01 * 127,
      startMs: preview._nowMs() + (targetFrame - now) * 1000 / context.sampleRate,
      captureMeta: preview._captureMetadata({ semanticVoiceId: intent.voiceId, generation: intent.generation, executionEpoch,
        onsetId: intent.onsetId, intentId: intent.intentId, sourceEventIds: intent.sourceEventIds?.slice(0, 32) }, owner),
      end: endFrame / context.sampleRate, release: parameters.releaseSeconds, releaseAt: endFrame / context.sampleRate - parameters.releaseSeconds,
      released: false, attack: parameters.attackSeconds, decay: parameters.decaySeconds, sustain: parameters.sustain01,
      peak: intent.velocity01 * parameters.gain01 * patch.gain01, priority: 1, laneIndex: intent.laneId ?? 0,
      baseFrequency: frequency / 2 ** (offset / 1200), mixPan: patch.pan01, patchRevision: patch.revision, patchId: patch.id,
      startedAt: targetFrame / context.sampleRate, requestRelease: (time, force, reason) => {
        if (voice.released) return; voice.released = true; voice.releaseAt = Math.max(voice.start, time); voice.terminationCause = reason;
        command(END, Math.max(frameNow(), Math.round(time * context.sampleRate)), voice, { 13: Math.max(1, Math.round(voice.release * context.sampleRate)) });
      },
      onDestroy: reason => {
        if (voices.get(key) === voice) voices.delete(key);
        const shared = JSON.stringify([owner, executionEpoch, intent.voiceId]);
        if (preview._semanticVoiceOwners.get(shared) === voice) preview._semanticVoiceOwners.delete(shared);
        const removed = queue?.invalidate(item => item.slotToken === voice.slotToken && item.voiceId === voice.voiceId && item.epoch === executionEpoch) || 0;
        counters.producerCancelled += removed;
        if (!voice.kernelEnded && ready && !disposed && !fault && !ownerStopped) command(END, frameNow(), voice, { 13: Math.ceil(context.sampleRate * 0.005) });
        if (voice.kernelEnded || removed && !voice.submitted) slots[slot] = null;
        record({ status: 'ended', stage: voice.kernelEnded ? 'render-kernel-ended' : 'stop-requested', voiceId: intent.voiceId, executionEpoch,
          generation: intent.generation, reason, appliedFrame: voice.kernelEnded ? voice.appliedFrame : null });
      } };
    const result = command(BEGIN, targetFrame, voice, { 6: frequency, 7: voice.peak, 8: pressure, 9: Math.max(-1, Math.min(1, pan + patch.pan01)),
      10: Math.round(parameters.attackSeconds * context.sampleRate), 11: Math.round(parameters.decaySeconds * context.sampleRate),
      12: parameters.sustain01, 13: Math.round(parameters.releaseSeconds * context.sampleRate), 16: endFrame });
    if (result.status === 'rejected') { resourceLease?.release(); return result; }
    voices.set(key, voice); slots[slot] = voice; preview._voices.add(voice);
    preview._semanticVoiceOwners.set(JSON.stringify([owner, executionEpoch, intent.voiceId]), voice); voice.submitted = inFlight.has(result.sequence);
    return result;
  };
  const update = (voiceId, expression, targetFrame, executionEpoch = 'live') => {
    const voice = voices.get(keyFor(executionEpoch, voiceId)), now = frameNow();
    if (!ready || !voice || voice.released && voice.releaseAt <= context.currentTime || !preview._ownerReady(owner)) return reject('voice-not-active', voiceId);
    if (!expression || typeof expression !== 'object' || Array.isArray(expression) || Object.getPrototypeOf(expression) !== Object.prototype ||
        Object.keys(expression).some(id => !['pressure01', 'pan01', 'pitchOffsetCents'].includes(id))) return reject('unsupported-expression', voiceId);
    if (!Number.isSafeInteger(targetFrame) || targetFrame < Math.max(now, Math.round(voice.start * context.sampleRate)) || targetFrame >= voice.releaseAt * context.sampleRate) return reject('stale-or-outside-gate-expression', voiceId);
    let mask = 0; const values = { 14: Math.ceil(smoothingSeconds * context.sampleRate) };
    if (expression.pitchOffsetCents != null) {
      const frequency = voice.baseFrequency * 2 ** (expression.pitchOffsetCents / 1200);
      if (!finite(expression.pitchOffsetCents, -24000, 24000) || !finite(frequency, 0.1, context.sampleRate / 2 - 1)) return reject('invalid-expression', voiceId);
      mask |= 1; values[6] = frequency;
    }
    if (expression.pressure01 != null) { if (!finite(expression.pressure01, 0, 1)) return reject('invalid-expression', voiceId); mask |= 2; values[8] = expression.pressure01; }
    if (expression.pan01 != null) { if (!finite(expression.pan01, -1, 1)) return reject('invalid-expression', voiceId); mask |= 4; values[9] = Math.max(-1, Math.min(1, expression.pan01 + voice.mixPan)); }
    values[15] = mask; return command(UPDATE, targetFrame, voice, values);
  };
  const end = (voiceId, release, targetFrame, executionEpoch = 'live') => {
    const voice = voices.get(keyFor(executionEpoch, voiceId)), now = frameNow();
    if (!voice || !ready) return reject('voice-not-active', voiceId);
    if (!Number.isSafeInteger(targetFrame) || targetFrame < 0 || !finite(release?.seconds ?? voice.release, 0, 4)) return reject('invalid-release', voiceId);
    if (voice.released) return Object.freeze({ status: 'accepted', stage: 'queued', voiceId, reason: 'already-releasing' });
    let frame = Math.max(now, targetFrame);
    if (release?.mode === 'one-shot') {
      if (!finite(release.tailSeconds, 0, 4)) return reject('invalid-release', voiceId);
      frame = Math.max(frame, Math.round((voice.start + release.tailSeconds) * context.sampleRate));
    } else if (release?.mode != null) return reject('unsupported-release-mode', voiceId);
    const result = command(END, frame, voice, { 13: Math.max(1, Math.round((release?.seconds ?? voice.release) * context.sampleRate)) });
    if (result.status === 'accepted') { voice.released = true; voice.releaseAt = frame / context.sampleRate; voice.end = voice.releaseAt + (release?.seconds ?? voice.release); }
    return result;
  };
  const cancelGenerationWithReceipt = (generation, executionEpoch = 'live') => {
    const key = keyFor(executionEpoch, generation);
    if (cancelled.size < 1024) cancelled.add(key); else cancellationHistoryFull = true;
    leases.delete(key);
    const removed = queue?.invalidate(item => item.generation === generation && item.epoch === executionEpoch) || 0;
    counters.producerCancelled += removed;
    const outcome = ready ? command(CANCEL, frameNow(), null, { epochToken: epochs.get(executionEpoch) || 0, epoch: executionEpoch, generation }) : null;
    let count = 0;
    for (const voice of voices.values()) if (voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch) {
      if (!voice.submitted) { voice.kernelEnded = true; preview._destroyVoice(voice, 'generation-cancel-before-submission'); slots[voice.slot] = null; count++; continue; }
      voice.released = true; voice.releaseAt = context.currentTime; voice.end = context.currentTime + 0.005; count++;
    }
    return Object.freeze({ generation, executionEpoch, count, removedBeforeSubmission: removed, frontierFrame: frameNow(),
      stage: outcome?.status === 'accepted' ? 'scheduled-cancellation-requested' : 'not-submitted', appliedFrame: null, renderedStatus: 'unknown' });
  };
  const onOwnerStop = () => {
    ownerStopped = true; clearTimer(); preparing++; counters.producerCancelled += queue?.clear() || 0;
    leases.clear(); inFlight.clear(); kernelQueued.clear();
    for (const voice of voices.values()) if (!voice.submitted) { voice.kernelEnded = true;
      preview._destroyVoice(voice, 'owner-stop-before-submission'); slots[voice.slot] = null; }
    for (const cancel of pendingInitializations) cancel(); pendingInitializations.clear();
    try { node?.port.postMessage({ type: 'panic', protocol: PROTOCOL }); } catch { markFault('terminal-port-failure'); }
  };
  const renderDiagnostics = ({ includeTraces = false } = {}) => Object.freeze({ engineId: runtime.engineId, runtime, capabilities,
    readiness: disposed ? 'disposed' : fault || !ready ? fault || 'runtime-unprepared' : ownerStopped ? 'kernel-stop-pending' : !preview._ownerReady(owner) ? 'audio-not-ready' : 'ready',
    activeVoices: voices.size, queued: queue?.diagnostics() || null, inFlight: inFlight.size, counters: Object.freeze({ ...counters }),
    awaitingKernelAdmission: inFlight.size - kernelQueued.size,
    traceCount: traces.length, truncatedTraces: truncated, cancellationHistoryFull,
    ...(includeTraces ? { traces: Object.freeze([...traces]) } : {}) });
  const dispose = () => {
    if (disposed) return; onOwnerStop(); disposed = true; ready = false;
    for (const voice of voices.values()) preview._destroyVoice(voice, 'backend-disposed'); voices.clear(); slots.fill(null);
    node?.disconnect(); node?.port.close(); node = null; patch = null;
    runtimeResourceLease?.release(); runtimeResourceLease = null;
  };
  return Object.freeze({ capabilities, runtime, prepare, begin, update, end, renewExecutionLease, cancelGenerationWithReceipt,
    cancelGeneration: (generation, epoch) => cancelGenerationWithReceipt(generation, epoch).count,
    onOwnerStop, renderDiagnostics, dispose });
}
