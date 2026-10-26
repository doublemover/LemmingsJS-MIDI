import { prepareOwnedSourceBanks } from './OwnedSourceBanks.js';
import { retainOwnedSampleDiagnostics } from './OwnedSampleDiagnostics.js';
import { planSampleTraversal, sampleTraversalBeginFields } from '../../midi/content/SampleTraversal.js';
import { acceptsSampleCursorSegment, SAMPLE_CURSOR_DISCONTINUITIES } from '../../midi/content/SampleCursorProfile.js';
import { prepareOwnedPcmSet } from './OwnedPcmSet.js';
import { retireOwnedProcessorState } from './OwnedProcessorRetirement.js';
import { planSeedLayerContactBegin, planSeedLayerContactMotion, advanceSeedLayerContactMotion, seedLayerContactBeginFields, seedLayerContactMotionFields } from '../../midi/content/SeedLayerMotion.js';
import { prepareSeedLayerPlan } from './SeedLayerPlan.js';
import { validateSeedLayerProfile } from '../../midi/content/SeedLayerProfile.js';
import { prepareOwnedSamplePlan } from './OwnedSamplePlan.js';
import { validateSampleInstrumentMap, OWNED_SAMPLE_MAP_PROFILE } from '../../midi/content/SampleInstrumentMap.js';
import { sourceVoiceMatches } from '../../midi/content/EffectVoiceSelection.js';
import { LIVE_LANE_TAP_LIMIT, LIVE_LANE_TAP_PROTOCOL } from './OwnedSourceLayout.js';
import { validVoiceLaneMix } from './VoiceLaneMix.js';
import { validVoiceTransition, transitionAttackSeconds } from './VoiceTransition.js';
import { getOwnedSourceProfile } from './OwnedSourceProfiles.js';
import { prepareOwnedSourceBank } from './OwnedSourceBankPreparation.js';
import { getOwnedSourceBankIdentity } from './OwnedSourceBank.js';
import { prepareOwnedPcmBank } from './OwnedPcmBank.js';
import { loadOwnedWorkletModule, inspectOwnedWorkletModule } from './OwnedWorkletModuleCache.js';
import { createAudioCommandQueue } from './AudioCommandQueue.js';
import { createInstrumentExecutionLifecycle, isManagedExecutionEpoch } from './InstrumentExecutionLifecycle.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';
import { createAudioDisplayTelemetry } from './AudioDisplayTelemetry.js';
import { compileInstrumentPerformance, retainInstrumentCause } from '../../midi/content/InstrumentPerformance.js';
import { ownedSourceSeed } from './OwnedSourceSeed.js';
import { resolveOwnedArticulationPolicy } from './OwnedArticulationPolicy.js';
import { PROTOCOL, WIDTH as SINE_WIDTH, CAPACITY, MAX_VOICES as SINE_MAX_VOICES, RECEIPT_WIDTH, BEGIN, UPDATE, END, CANCEL, LEASE, MIX,
  SCHEDULED, APPLIED, REJECTED, ENDED, CANCELLED, FAULTED, DISPLAY_PROTOCOL, DISPLAY_WIDTH, DISPLAY_VOICES } from './worklet/OwnedSineProcessor.js';

const sineCapabilities = Object.freeze({ independentSamePitch: true, perVoicePitch: true, perVoicePressure: true, perVoicePan: true,
  perVoiceTimbre: false, offlineRender: true, ownedGates: true, renderAcknowledgment: true,
  maximumVoices: SINE_MAX_VOICES, latencyFrames: 0, sustainPedal: false, sostenuto: false, releaseVelocity: false, displayTelemetry: true,
  supportedParameterIds: Object.freeze(['attackSeconds', 'decaySeconds', 'sustain01', 'releaseSeconds', 'gain01', 'pan01']) });
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const keyFor = (epoch, id) => JSON.stringify([epoch, id]);
const kernelReasons = Object.freeze({ 1: 'invalid-command', 2: 'kernel-queue-full', 3: 'generation-cancelled', 4: 'late-command',
  5: 'kernel-voice-budget-or-range', 6: 'stale-voice-slot', 7: 'owner-lease-expired', 8: 'nonfinite-dsp', 9: 'pending-onset-cancelled', 10: 'kernel-excitation-budget', 11: 'execution-lease-too-late', 12: 'stale-execution-lease', 13: 'source-forced-release' });

export function createWorkletInstrumentBackend(preview, owner = null, { leadSeconds = 0.25, smoothingSeconds = 0.008,
  traceLimit = 128, createWorkletNode = null, initializationTimeoutMs = 5000, engineId = 'worklet-sine', prepareSourceBank = prepareOwnedSourceBank } = {}) {
  const source = getOwnedSourceProfile(engineId), WIDTH = source.width, MAX_VOICES = source.voices, fields = source.fields, isExtended = source.extended;
  const isSampler = engineId === 'worklet-sample', isLayered = engineId === 'worklet-seed-layers';
  const performanceParameters = source.parameters, liveSourceIds = source.liveIds;
  const expressionIds = new Set(['pressure01', 'pan01', 'pitchOffsetCents', ...liveSourceIds]);
  const runtime = Object.freeze({ ...source.runtime, hostProtocolVersion: PROTOCOL, retirementProtocol: 1 });
  const capabilities = Object.freeze({ ...sineCapabilities, maximumVoices: MAX_VOICES, sampleMaps: isSampler, feedforwardSampleBody: isSampler, positionDrivenSamples: isSampler, canonicalTravelSamples: isSampler, releaseVelocity: isSampler, offlineRender: source.offlineRender, continuousPhysicalBindings: isExtended && !source.requiresPCMSet && !['worklet-texture', 'worklet-friction', 'worklet-wind'].includes(engineId), sealedWindModel: engineId === 'worklet-wind', pressureDrivenWind: engineId === 'worklet-wind', experimentalRegisterPolicy: engineId === 'worklet-wind', sealedFrictionModel: engineId === 'worklet-friction', canonicalFrictionTravel: engineId === 'worklet-friction', decomposedSeedLayers: isLayered, canonicalContactGrains: isLayered, livePitchUpdates: !['worklet-seed-layers', 'worklet-texture', 'worklet-friction', 'worklet-wind'].includes(engineId), proceduralTextures: engineId === 'worklet-texture', feedforwardTextureBody: engineId === 'worklet-texture', canonicalTextureTravel: engineId === 'worklet-texture', restoration: source.restoration, perVoicePitch: engineId !== 'worklet-texture',
    perVoiceDamping: source.damping, perVoiceTimbre: source.perVoiceTimbre, supportedParameterIds: Object.freeze(Object.keys(fields)) });
  if (!finite(leadSeconds, 0.01, 2) || !finite(smoothingSeconds, 0, 1) || !Number.isSafeInteger(traceLimit) || traceLimit < 0 || traceLimit > 4096 ||
      !finite(initializationTimeoutMs, 1, 30000)) throw new Error('Invalid worklet backend options.');
  let node = null, context = null, ready = false, disposed = false, preparing = 0, patch = null, sequence = 0, packetSequence = 0;
  let sourceInspection = null, sourceInspectionSerial = 0, lastSourceInspection = null;
  let pumpTimer = null, fault = null, truncated = 0, nextEpoch = 0, cancellationHistoryFull = false;
  let ownerStopped = false, ownerStopReceipt = null;
  let runtimeResourceLease = null, pcmDescriptor = null, samplePlan = null;
  let pumpQueued = false;
  let lifecycle = null;
  let faultRetirement = null;
  let retirementContext = null;
  const nodeRetirements = new WeakMap();
  const retirementAware = new WeakSet(), nodeContexts = new WeakMap();
  const retirement = createProcgenRetirementScope();
  const voices = new Map(), epochs = new Map(), leases = new Map(), cancelled = new Set(), inFlight = new Map(), traces = [];
  const cancellationReceipts = new Map();
  const pendingInitializations = new Set(), pendingPreparations = new Set();
  const commandObservers = new Set(); let commandObservationFailures = 0, commandObserverSequence = 0;
  const kernelQueued = new Set();
  const slots = new Array(MAX_VOICES).fill(null), slotTokens = new Uint32Array(MAX_VOICES);
  const counters = { queued: 0, applied: 0, late: 0, rejected: 0, faults: 0, ended: 0, producerCancelled: 0, kernelCancelled: 0, stopRequests: 0, stopQueued: 0 };
  const display = createAudioDisplayTelemetry({ owner, engineId, getContext: () => context || preview.getAudioContext(), getContextEpoch: () => preview._contextEpoch ?? 0,
    getRouteState: () => ({ muted: !preview._ownerReady(owner) || preview.getState().masterVolume === 0, evidenceClass: 'owner-routing-state' }),
    getVoices: () => voices.values(), resources: preview._audioResources, send: message => { if (!node || disposed) return false; node.port.postMessage(message); return true; } });
  let queue = null, laneProducer = null, laneRegistry = null, releaseLaneProducer = null;
  const attachedLaneBuses = new Map(), routeBarriers = new Map(), laneTapsEnabled = typeof preview._laneSourcesFor === 'function'; let nextRouteBarrier = 0;
  const voiceRouteMask = voice => { let mask = 0; for (const bus of attachedLaneBuses.keys()) if (bus.voiceSelection && sourceVoiceMatches(bus.voiceSelection, voice.voiceId, voice.semanticGeneration)) mask |= 1 << bus.index; return mask; };
  const sendLaneRoute = (voice, route, producer = node) => producer.port.postMessage({ type: 'lane-route', protocol: LIVE_LANE_TAP_PROTOCOL, slot: voice.slot, token: voice.slotToken, laneToken: voice.onsetLaneToken, route });
  const sendLaneTap = (bus, enabled, producer) => producer.port.postMessage({ type: 'lane-tap', protocol: LIVE_LANE_TAP_PROTOCOL, index: bus.index, laneToken: bus.laneToken, enabled });
  const routeBarrier = (producer, bus) => {
    if (routeBarriers.size >= LIVE_LANE_TAP_LIMIT || nextRouteBarrier === Number.MAX_SAFE_INTEGER) throw new Error('Source route barrier capacity exceeded.');
    const barrierId = ++nextRouteBarrier; let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => {});
    const timer = setTimeout(() => { routeBarriers.delete(barrierId); reject(new Error('Source route acknowledgement timed out.')); markFault('source-route-timeout'); }, 5000);
    routeBarriers.set(barrierId, { producer, bus, resolve, reject, timer });
    try { producer.port.postMessage({ type: 'lane-route-barrier', protocol: LIVE_LANE_TAP_PROTOCOL, barrierId, index: bus.index }); }
    catch (error) { clearTimeout(timer); routeBarriers.delete(barrierId); reject(error); markFault('source-route-port-failed'); }
    return promise;
  };
  const ensureLaneProducer = () => {
    if (!laneTapsEnabled || !node) return;
    const registry = preview._laneSourcesFor(owner, context);
    if (laneRegistry === registry && laneProducer === node) return;
    releaseLaneProducer?.(); laneRegistry = registry; laneProducer = node; const producer = node;
    releaseLaneProducer = registry.registerRenderer({
      hasVoice(member) { for (const voice of voices.values()) if (voice.voiceId === member.voiceId && voice.semanticGeneration === member.generation) return true; return false; },
      attach(bus) {
        if (attachedLaneBuses.has(bus)) return;
        attachedLaneBuses.set(bus, { pre: false, post: false }); const connected = attachedLaneBuses.get(bus);
        producer.connect(bus.pre, 1 + bus.index * 2, 0); connected.pre = true;
        producer.connect(bus.post, 2 + bus.index * 2, 0); connected.post = true;
        sendLaneTap(bus, true, producer);
        for (const voice of voices.values()) sendLaneRoute(voice, voiceRouteMask(voice), producer); return routeBarrier(producer, bus);
      },
      detach(bus) {
        const connected = attachedLaneBuses.get(bus); if (!connected) return; attachedLaneBuses.delete(bus);
        sendLaneTap(bus, false, producer);
        for (const [id, barrier] of routeBarriers) if (barrier.bus === bus) { clearTimeout(barrier.timer); barrier.reject(new Error('Source route retired before publication.')); routeBarriers.delete(id); }
        for (const voice of voices.values()) sendLaneRoute(voice, voiceRouteMask(voice), producer);
        if (connected.pre) { producer.disconnect(bus.pre, 1 + bus.index * 2, 0); connected.pre = false; }
        if (connected.post) { producer.disconnect(bus.post, 2 + bus.index * 2, 0); connected.post = false; }
      }
    });
  };
  const epochSettled = epoch => {
    if (faultRetirement?.outcome === 'partial' || preview._retirementFaults?.has(owner)) return false;
    if (ownerStopped && node || slots.some(voice => voice?.semanticEpoch === epoch) || queue?.some(item => item.epoch === epoch)) return false;
    for (const item of inFlight.values()) if (item.epoch === epoch) return false;
    return true;
  };
  const frameNow = () => context && context === preview.getAudioContext() ? Math.ceil(context.currentTime * context.sampleRate) : null;
  const record = value => {
    const outcome = Object.freeze(value);
    if (traceLimit) { if (traces.length === traceLimit) { traces.shift(); truncated++; } traces.push(Object.freeze({ owner,
      engineId: runtime.engineId, engineVersion: 1, acousticReceipt: false, ...value })); }
    const cutoff = commandObserverSequence;
    for (const observer of commandObservers) if (observer.id <= cutoff) { try { observer.listener(outcome); } catch { commandObservationFailures++; } }
    return outcome;
  };
  const reject = (reason, voiceId = null) => { counters.rejected++; return record({ status: 'rejected', reason, voiceId, stage: 'none' }); };
  const clearTimer = () => { if (pumpTimer != null) clearTimeout(pumpTimer); pumpTimer = null; };
  const retireNode = (retiringNode, resourceLease) => {
    if (retiringNode && nodeRetirements.has(retiringNode)) return nodeRetirements.get(retiringNode);
    let nativeRetirement;
    const receipt = createProcgenRetirementScope().retire([
      { name: 'native-worklet', run: () => { nativeRetirement = createProcgenRetirementScope().retire([
        { name: 'source-route-barriers', run: () => { for (const [id, barrier] of routeBarriers) if (barrier.producer === retiringNode) { clearTimeout(barrier.timer); barrier.reject(new Error('Source producer retired during routing.')); routeBarriers.delete(id); } } },
        { name: 'lane-source-producer', run: () => { if (laneProducer === retiringNode) { releaseLaneProducer?.(); releaseLaneProducer = null; laneRegistry = laneProducer = null; } } },
        { name: 'processor-state', run: () => retirementAware.has(retiringNode) ? retireOwnedProcessorState(retiringNode, nodeContexts.get(retiringNode)) : null },
        { name: 'processor-handler', run: () => { if (retiringNode) retiringNode.onprocessorerror = null; } },
        { name: 'message-handler', run: () => { if (retiringNode && !retirementAware.has(retiringNode)) retiringNode.port.onmessage = null; } },
        { name: 'disconnect', run: () => retiringNode?.disconnect() },
        { name: 'message-port', run: () => { if (retiringNode && !retirementAware.has(retiringNode)) retiringNode.port.close(); } }
      ]); return nativeRetirement; } },
      { name: 'runtime-reservation', run: () => releaseAudioResourceAfterRetirement(resourceLease, nativeRetirement) }
    ]);
    if (retiringNode) nodeRetirements.set(retiringNode, receipt);
    return receipt;
  };
  const markFault = reason => {
    if (fault || disposed) return faultRetirement;
    fault = reason; ready = false; counters.faults++; retirementContext = context;
    faultRetirement = createProcgenRetirementScope().retire([
      { name: 'display', run: () => display.stop() }, { name: 'timer', run: clearTimer },
      { name: 'commands', run: () => { queue?.clear(); inFlight.clear(); kernelQueued.clear(); } },
      { name: 'panic-request', run: () => node?.port.postMessage({ type: 'panic', protocol: PROTOCOL }) },
      ...[...voices.values()].map(voice => ({ name: 'voice-' + voice.id, run: () => preview._destroyVoice(voice, 'kernel-fault') })),
      { name: 'native-runtime', run: () => retireNode(node, runtimeResourceLease) },
      { name: 'executions', run: () => lifecycle?.invalidate() }
    ]);
    const failedNode = node, settled = receipt => {
      if (receipt.outcome === 'complete') { if (node === failedNode) { slots.fill(null); node = null; runtimeResourceLease = null; } }
      else preview._retirementFaults?.add(owner);
    };
    if (faultRetirement.state === 'retired') settled(faultRetirement); else faultRetirement.completion.then(settled);
    record({ status: 'faulted', reason, stage: 'runtime', appliedFrame: null });
    return faultRetirement;
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
    if (ownerStopped) return reject('kernel-stop-pending', voice?.voiceId);
    const now = frameNow();
    if (!Number.isSafeInteger(now)) return reject('context-replaced', voice?.voiceId);
    const terminal = opcode === END || opcode === CANCEL || opcode === LEASE;
    const outstanding = inFlight.size + queue.diagnostics().queued;
    if (outstanding >= (terminal ? CAPACITY : CAPACITY - SINE_MAX_VOICES)) {
      if (terminal) markFault('terminal-credit-exhausted');
      return reject(terminal ? 'terminal-credit-exhausted' : 'kernel-acknowledgment-pressure', voice?.voiceId);
    }
    if (!Number.isSafeInteger(sequence + 1)) return reject('command-sequence-exhausted', voice?.voiceId);
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
  const reconcileLease = voice => {
    if (voice.released) return;
    const reserved = Math.max(voice.effectiveLeaseEndFrame ?? voice.initialLeaseEndFrame, ...voice.pendingLeases.values());
    voice.end = reserved / context.sampleRate; voice.releaseAt = voice.end - voice.release;
  };
  const forceSampleEnd = (voice, frame, silentAtOnset = false) => {
    frame = Math.max(frameNow(), frame, Math.round(voice.start * context.sampleRate));
    const frames = Math.min(Math.ceil(context.sampleRate * 0.005), Math.max(1, Math.round(voice.end * context.sampleRate) - frame));
    const outcome = command(END, frame, voice, { 13: frames, 16: frame + frames, 20: 1, 21: Number(silentAtOnset) });
    if (outcome.status === 'accepted') { voice.released = true; voice.releaseAt = Math.min(voice.releaseAt, frame / context.sampleRate); voice.end = Math.min(voice.end, (frame + frames) / context.sampleRate); }
    return outcome;
  };
  const onReceipts = data => {
    if (data.protocol !== PROTOCOL || !(data.data instanceof Float64Array) || !Number.isInteger(data.count) || data.count < 0 ||
        data.count * RECEIPT_WIDTH > data.data.length || data.count > 64) { markFault('invalid-kernel-receipt'); return; }
    for (let index = 0; index < data.count; index++) {
      const at = index * RECEIPT_WIDTH, code = data.data[at], serial = data.data[at + 1], slot = data.data[at + 2], token = data.data[at + 3];
      const frame = data.data[at + 4], reason = data.data[at + 5], original = inFlight.get(serial);
      const voice = slots[slot]?.slotToken === token ? slots[slot] : null;
      if (code === SCHEDULED) {
        if (reason === 2 && slot === -1) { counters.stopQueued++; record({ status: 'accepted', stage: 'kernel-stop-queued', appliedFrame: null, targetFrame: frame }); }
        if (original) kernelQueued.add(serial);
        if (original) record({ status: 'accepted', stage: 'kernel-queued', sequence: serial, voiceId: original.voiceId,
          executionEpoch: original.epoch, generation: original.generation, targetFrame: original.frame, appliedFrame: null });
        continue;
      }
      kernelQueued.delete(serial); voice?.positionCommands?.delete(serial);
      if (code === APPLIED) {
        if (reason === 2 && slot === -1) { ownerStopped = false; ownerStopReceipt = null; }
        counters.applied++; inFlight.delete(serial);
        if (voice) {
          voice.appliedFrame = frame; voice.lastAppliedSequence = serial;
          if (original?.opcode === BEGIN || original?.opcode === LEASE) {
            voice.effectiveLeaseEndFrame = Math.max(voice.effectiveLeaseEndFrame || 0, original.data[16]);
            voice.pendingLeases.delete(serial); reconcileLease(voice);
          }
        }
      } else if (code === ENDED || code === FAULTED) {
        counters.ended++; if (code === FAULTED) counters.faults++;
        if (voice) { voice.kernelEnded = true; voice.appliedFrame = frame;
          preview._destroyVoice(voice, kernelReasons[reason] || 'worklet-source-ended'); slots[slot] = null; }
        inFlight.delete(serial);
      } else if (code === REJECTED || code === CANCELLED) {
        if (code === REJECTED) counters.rejected++;
        if (reason === 4) counters.late++; if (code === CANCELLED) counters.kernelCancelled++;
        if (voice && original?.opcode === LEASE) {
          voice.pendingLeases.delete(serial); voice.leaseFailure = kernelReasons[reason] || 'lease-not-applied'; reconcileLease(voice);
        }
        if (voice && (original?.opcode === BEGIN || reason === 9)) {
          voice.kernelEnded = true; preview._destroyVoice(voice, kernelReasons[reason] || 'kernel-rejected'); slots[slot] = null;
        }
        inFlight.delete(serial);
        if (code === REJECTED && original?.opcode === MIX && original.data[6]) markFault('source-lane-transfer-rejected');
        if (code === REJECTED && voice?.circularTravel && original?.opcode === UPDATE && original.data[15] & 64) markFault('circular-travel-control-rejected');
        if (code === REJECTED && isSampler && original?.opcode === UPDATE && original.data[15] & 8) markFault('source-position-control-rejected');
      }
      record({ status: code === REJECTED ? 'rejected' : code === FAULTED ? 'faulted' : code === CANCELLED ? 'cancelled' : 'accepted',
        stage: code === APPLIED ? 'render-kernel-applied' : code === ENDED ? 'render-kernel-ended' : 'render-kernel-outcome',
        voiceId: voice?.voiceId ?? original?.voiceId ?? null, executionEpoch: voice?.semanticEpoch ?? original?.epoch ?? null,
        generation: voice?.semanticGeneration ?? original?.generation ?? null, sequence: serial, appliedFrame: frame,
        targetFrame: original?.frame ?? null,
        ...(original?.opcode === LEASE ? { operation: 'execution-lease', requestedLeaseEndFrame: original.data[16],
          effectiveLeaseEndFrame: voice?.effectiveLeaseEndFrame ?? null, renewalSemantics: 'per-voice' } : {}), reason: reason === 2 && code !== REJECTED ? 'panic' : kernelReasons[reason] || null });
    }
  };
  const validate = resolution => {
    const input = resolution?.patch;
    if (!['ready', 'degraded'].includes(resolution?.status) || input?.engineId !== runtime.engineId || input.engineVersion !== 1 ||
        typeof input.id !== 'string' || !input.id || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
        resolution.receipt?.patchId !== input.id || resolution.receipt?.revision !== input.revision || !Array.isArray(input.sampleRefs) ||
        (source.requiresPCM ? input.sampleRefs.length < 1 || input.sampleRefs.length > (source.requiresPCMSet ? 32 : 1) || input.sampleRefs.some(ref => !/^[a-f0-9]{64}$/.test(ref?.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 44 || ref.bytes > 16 * 1048576) : input.sampleRefs.length !== 0) ||
        input.modulations?.length || !isExtended && (input.macros?.length || input.causalBindings?.length || input.variation) ||
        !Number.isSafeInteger(input.voicePolicy?.maxVoices) || input.voicePolicy.maxVoices < 1 || input.voicePolicy.maxVoices > MAX_VOICES ||
        input.voicePolicy.steal != null && input.voicePolicy.steal !== 'reject' ||
        !finite(input.mix?.gain01, 0, 1) || !finite(input.mix?.pan01, -1, 1)) return null;
    const parameters = Object.fromEntries(Object.entries(fields).map(([id, spec]) => [id, spec[2]]));
    for (const [id, value] of Object.entries(input.parameters || {})) {
      if (!fields[id] || !finite(value, fields[id][0], fields[id][1])) return null; parameters[id] = value;
    }
    if (!source.acceptsParameters(parameters)) return null;
    let performance = null;
    if (isExtended) { try { performance = compileInstrumentPerformance(input, performanceParameters); } catch { return null; } }
    let samplePatch = null;
    if (source.requiresPCMSet) { try { samplePatch = Object.freeze({ id: input.id, revision: input.revision, engineId, engineVersion: 1, parameters: Object.freeze({ ...parameters }),
      voicePolicy: Object.freeze({ maxVoices: input.voicePolicy.maxVoices }), sampleRefs: Object.freeze(input.sampleRefs.map(ref => Object.freeze({ ...ref }))),
      ...(isLayered ? { seedLayers: validateSeedLayerProfile(input.seedLayers, input.sampleRefs) } : { sampleMap: validateSampleInstrumentMap(input.sampleMap, input.sampleRefs, { rendererProfile: OWNED_SAMPLE_MAP_PROFILE }) }) }); } catch { return null; } }
    return Object.freeze({ samplePatch, id: input.id, revision: input.revision, parameters: Object.freeze(parameters), performance,
      maxVoices: input.voicePolicy.maxVoices, gain01: input.mix.gain01, pan01: input.mix.pan01, sampleRef: source.requiresPCM ? Object.freeze({ ...input.sampleRefs[0] }) : null });
  };
  const prepareSource = async (resolution, assets = []) => {
    if (disposed) return reject('disposed');
    if (faultRetirement && faultRetirement.outcome !== 'complete' && (retirementContext || context)?.state !== 'closed') return reject(faultRetirement.state === 'retired' ? 'audio-retirement-unknown' : 'audio-retirement-pending');
    if (pendingInitializations.size >= 2) return reject('source-preparation-capacity');
    const next = validate(resolution); if (!next) return reject('unsupported-patch-or-engine');
    if (!Array.isArray(assets) || assets.length !== (source.requiresPCMSet ? new Set(next.samplePatch.sampleRefs.map(ref => ref.sha256)).size : source.requiresPCM ? 1 : 0)) return reject('required-source-assets-unavailable');
    if (source.requiresPCM && (!preview._audioResources || assets.some(pin => { const ref = source.requiresPCMSet ? next.samplePatch.sampleRefs.find(ref => ref.sha256 === pin?.ref?.contentHash) : next.sampleRef; return !pin?.isActive?.() || !ref || pin.ref.contentHash !== ref.sha256 || pin.ref.bytes !== ref.bytes; }))) return reject('required-pcm-source-unavailable');
    const candidateContext = preview.getAudioContext();
    if (!candidateContext?.audioWorklet?.addModule) return reject('audio-worklet-unavailable');
    if (candidateContext.state === 'closed') return reject('audio-context-closed');
    if (runtime.supportedSampleRates && !runtime.supportedSampleRates.includes(candidateContext.sampleRate)) return reject('source-sample-rate-unavailable');
    if (context && context !== candidateContext) {
      if (context.state === 'closed') { node = null; ready = false; voices.clear(); slots.fill(null); runtimeResourceLease = null; pcmDescriptor = null; samplePlan = null; }
      else { markFault('context-replaced'); if (faultRetirement?.outcome !== 'complete') return reject('audio-retirement-unknown'); }
    }
    if (ready && source.requiresPCM && (source.requiresPCMSet ? pcmDescriptor?.assetHashes?.length !== assets.length || assets.some(pin => { const bank = pcmDescriptor.banks.find(bank => bank.assetHash === pin.ref.contentHash); return !bank || bank.decoderVersion !== pin.variant?.decoderVersion || bank.sampleRate !== pin.buffer?.sampleRate || bank.frames !== pin.buffer?.length || bank.channels !== pin.buffer?.numberOfChannels; }) : pcmDescriptor?.assetHash !== next.sampleRef.sha256)) return reject('source-requires-new-renderer');
    for (const cancel of pendingInitializations) cancel();
    const revision = ++preparing, generation = preview._generation, ownerGeneration = preview._sessions.get(owner)?.generation;
    let candidate = null, timer = null, cancelInitialization = null, candidateResourceLease = null, bank = null, inputCopy = null, candidatePcm = pcmDescriptor, sourceFailureRetirement = null, fixedBank = null, candidatePlan = null;
    const assetController = new AbortController(), current = () => !disposed && revision === preparing && generation === preview._generation && ownerGeneration === preview._sessions.get(owner)?.generation && preview.getAudioContext() === candidateContext;
    let interrupt;
    const interrupted = new Promise((_resolve, rejectInterrupted) => { interrupt = rejectInterrupted; });
    interrupted.catch(() => {});
    const abortPreparation = error => { assetController.abort(error); interrupt(error); };
    cancelInitialization = () => abortPreparation(new Error('preparation-cancelled')); pendingInitializations.add(cancelInitialization);
    try {
      if (!ready && source.bankId) fixedBank = await prepareOwnedSourceBanks(source, next.parameters, { prepareBank: prepareSourceBank, resources: preview._audioResources, owner, generation, signal: assetController.signal, isCurrent: current });
      if (!ready && source.requiresPCM) {
        bank = await (source.requiresPCMSet ? prepareOwnedPcmSet : prepareOwnedPcmBank)(source.requiresPCMSet ? assets : assets[0], { resources: preview._audioResources, owner: owner ?? 'unscoped-source', generation,
          signal: assetController.signal, isCurrent: current });
        inputCopy = await bank.copyForProcessor({ signal: assetController.signal, isCurrent: current }); candidatePcm = bank.descriptor;
      }
      if (source.requiresPCMSet) { candidatePlan = (isLayered ? prepareSeedLayerPlan : prepareOwnedSamplePlan)(next.samplePatch, candidatePcm, candidateContext.sampleRate); if (ready && candidatePlan.identity !== samplePlan?.identity) return reject('source-requires-new-renderer'); }
      assetController.signal.throwIfAborted(); if (!current()) return reject('preparation-cancelled');
      timer = setTimeout(() => abortPreparation(new Error('kernel-initialization-timeout')), initializationTimeoutMs);
      if (!ready) candidateResourceLease = preview._audioResources?.reserveWorkletRuntime(owner, preview._generation,
        source.sourceBytes({ sampleRate: candidateContext.sampleRate, pcm: candidatePcm, voices: MAX_VOICES }) + (laneTapsEnabled ? 65536 : 0) + CAPACITY * (WIDTH - SINE_WIDTH) * 8, source.heapEstimate + (source.requiresPCMSet ? 131072 : 0), true) || null;
      await Promise.race([loadOwnedWorkletModule(candidateContext, source, preview._audioResources), interrupted]);
      if (!current()) return reject('preparation-cancelled');
      if (!ready) {
        const channel = preview._channel(0, owner), destination = channel.sourceInput || channel.gain;
        const create = createWorkletNode || ((audioContext, name, options) => new globalThis.AudioWorkletNode(audioContext, name, options));
        candidate = create(candidateContext, 'lemmings-owned-' + engineId.slice('worklet-'.length) + '-v1', { numberOfInputs: 0, numberOfOutputs: laneTapsEnabled ? 1 + LIVE_LANE_TAP_LIMIT * 2 : 1, outputChannelCount: new Array(laneTapsEnabled ? 1 + LIVE_LANE_TAP_LIMIT * 2 : 1).fill(2),
          processorOptions: { maxVoices: MAX_VOICES, ...(source.requiresPCMSet ? { samplePatch: next.samplePatch } : {}), ...(laneTapsEnabled ? { laneTapProtocol: LIVE_LANE_TAP_PROTOCOL } : {}), ...(fixedBank ? { sourceBank: fixedBank.payload, ...(fixedBank.identities.length > 1 ? { auxiliarySourceBanks: fixedBank.auxiliary } : {}) } : {}), ...(inputCopy ? { pcm: inputCopy.payload } : {}) } });
        nodeContexts.set(candidate, candidateContext); if (source.requiresPCMSet) retirementAware.add(candidate);
        await Promise.race([new Promise((resolve, rejectReady) => {
          candidate.onprocessorerror = () => rejectReady(new Error('processor-error-during-prepare'));
          candidate.port.onmessage = event => {
            const data = event.data;
            if (data?.type === 'ready' && data.retirementProtocol === 1) retirementAware.add(candidate);
            if (data?.type !== 'ready' || data.protocol !== PROTOCOL || data.engineId !== runtime.engineId || data.engineVersion !== 1 ||
                data.runtimeABI !== runtime.runtimeABI || data.buildId !== runtime.buildId || laneTapsEnabled && (data.laneTapProtocol !== LIVE_LANE_TAP_PROTOCOL || data.maxLaneTaps !== LIVE_LANE_TAP_LIMIT) || data.maxVoices !== MAX_VOICES ||
                data.sampleRate !== candidateContext.sampleRate || data.width !== WIDTH || data.capacity !== CAPACITY ||
                source.requiresPCMSet && (data.samplePlanIdentity !== candidatePlan.identity || data.retirementProtocol !== 1) || data.displayProtocol !== DISPLAY_PROTOCOL || data.displayWidth !== DISPLAY_WIDTH || data.displayVoices !== DISPLAY_VOICES ||
                isLayered && data.auxiliarySourceBankHashes?.['grain-window-v1'] !== getOwnedSourceBankIdentity('grain-window-v1').hash || source.requiresPCM && data.pcmBankHash !== candidatePcm?.bankHash || source.bankId && data.sourceBankHash !== getOwnedSourceBankIdentity(source.bankId).hash) return rejectReady(new Error('kernel-abi-mismatch'));
            resolve();
          };
        }), interrupted]);
        if (inputCopy || bank || fixedBank) {
          const sourceRetirement = createProcgenRetirementScope().retire([{ name: 'fixed-source-bank', run: () => fixedBank?.release() }, { name: 'pcm-processor-input', run: () => inputCopy?.release() }, { name: 'pcm-preparation-bank', run: () => bank?.discard() }]);
          await sourceRetirement.completion;
          if (sourceRetirement.outcome !== 'complete') throw Object.assign(new Error('pcm-source-retirement-unknown'), { retirement: sourceRetirement });
          inputCopy = null; bank = null; fixedBank = null;
        }
        assetController.signal.throwIfAborted();
        if (!current()) {
          return reject('preparation-cancelled');
        }
        candidate.connect(destination);
        node = candidate; candidate = null; context = candidateContext;
        queue = createAudioCommandQueue({ capacity: CAPACITY, terminalReserve: SINE_MAX_VOICES, maxHorizonFrames: Math.ceil(context.sampleRate * 10) });
        const connectedNode = node;
        node.port.onmessage = event => {
          if (disposed || !ready || node !== connectedNode) return;
          if (event.data?.type === 'receipts') onReceipts(event.data);
          else if (event.data?.type === 'lane-route-ready' && event.data.protocol === LIVE_LANE_TAP_PROTOCOL && event.data.stage === 'rendered-source-routing' && Number.isSafeInteger(event.data.frame) && event.data.frame >= 0) { const barrier = routeBarriers.get(event.data.barrierId); if (barrier?.producer === connectedNode) { clearTimeout(barrier.timer); routeBarriers.delete(event.data.barrierId); barrier.resolve(Object.freeze({ protocol: LIVE_LANE_TAP_PROTOCOL, appliedFrame: event.data.frame, stage: event.data.stage, acousticReceipt: false })); } }
          else if (event.data?.type === 'health' && event.data.protocol === PROTOCOL && sourceInspection?.producer === connectedNode && event.data.requestId === sourceInspection.requestId) {
            try { settleSourceInspection(retainOwnedSampleDiagnostics(event.data, samplePlan)); } catch (error) { settleSourceInspection(null, error); }
          }
          else if (event.data?.type === 'display-samples') display.consume(event.data);
          else if (event.data?.type === 'protocol-error') markFault('kernel-protocol-error');
        };
        node.onprocessorerror = () => { if (node === connectedNode) markFault('processor-error'); };
        runtimeResourceLease = candidateResourceLease; candidateResourceLease = null; pcmDescriptor = candidatePcm; samplePlan = candidatePlan;
        ready = true; fault = null; faultRetirement = null; retirementContext = null; ownerStopped = false; display.configure(true);
      }
      try { ensureLaneProducer(); } catch (error) { markFault('lane-source-admission-failed'); throw error; }
      patch = next; if (candidatePlan) samplePlan = candidatePlan; return Object.freeze({ status: 'ready', patchId: next.id, revision: next.revision, capabilities, runtime, ...(pcmDescriptor ? { sourceBank: pcmDescriptor } : {}) });
    } catch (error) {
      sourceFailureRetirement = error?.retirement || null;
      return reject(error?.name === 'ResourceBudgetError' ? 'audio-resource-budget' : String(error?.message || 'worklet-initialization-failed').slice(0, 160));
    } finally {
      const cleanup = createProcgenRetirementScope().retire([
        { name: 'pcm-producer-retirement', run: () => sourceFailureRetirement },
        { name: 'fixed-source-bank', run: () => fixedBank?.release() },
        { name: 'pcm-processor-input', run: () => inputCopy?.release() },
        { name: 'pcm-preparation-bank', run: () => bank?.discard() },
        { name: 'pcm-preparation-source', run: () => assetController.abort(new Error('Source preparation finished.')) },
        { name: 'candidate-runtime', run: () => retireNode(candidate, candidateResourceLease) },
        { name: 'initialization-timer', run: () => { if (timer != null) clearTimeout(timer); } }
      ]);
      await cleanup.completion;
      pendingInitializations.delete(cancelInitialization);
      if (cleanup.outcome !== 'complete') { faultRetirement = cleanup; retirementContext = candidateContext; fault = 'preparation-retirement-unknown'; ready = false; preview._retirementFaults?.add(owner); return reject('preparation-retirement-unknown'); }
    }
  };
  const prepare = (...args) => {
    if (pendingPreparations.size >= 2) return Promise.resolve(reject('source-preparation-capacity'));
    const work = prepareSource(...args); pendingPreparations.add(work);
    work.then(() => pendingPreparations.delete(work), () => pendingPreparations.delete(work)); return work;
  };
  const epochToken = epoch => {
    if (epochs.has(epoch)) return epochs.get(epoch);
    for (const existing of epochs.keys()) if (epochSettled(existing)) epochs.delete(existing);
    if (epochs.size >= 64 || nextEpoch === Number.MAX_SAFE_INTEGER) return null;
    const token = ++nextEpoch; epochs.set(epoch, token); return token;
  };
  const renewExecutionLease = (generation, executionEpoch, validUntilFrame) => {
    const now = frameNow();
    if (!ready || !preview._ownerReady(owner)) return reject('audio-not-ready');
    if (!Number.isSafeInteger(generation) || generation < 0 || typeof executionEpoch !== 'string' || !executionEpoch ||
        !Number.isSafeInteger(validUntilFrame) || validUntilFrame <= now || validUntilFrame - now > context.sampleRate * 120) return reject('invalid-execution-lease');
    const key = keyFor(executionEpoch, generation);
    if (cancelled.has(key)) return reject('generation-cancelled');
    if (cancellationHistoryFull && !isManagedExecutionEpoch(executionEpoch)) return reject('execution-registration-required');
    const prior = leases.get(key); if (prior && validUntilFrame <= prior) return reject('stale-execution-lease');
    if (!prior && leases.size >= 64) return reject('execution-lease-budget');
    if ([...voices.values()].some(voice => voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch &&
        !voice.released && ((voice.effectiveLeaseEndFrame ?? voice.initialLeaseEndFrame) - Math.max(1, Math.round(voice.release * context.sampleRate)) <= now || voice.leaseFailure === 'execution-lease-too-late'))) return reject('execution-lease-too-late');
    const changes = new Map(), commands = []; let serial = sequence;
    for (const voice of voices.values()) if (voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch && !voice.released) {
      if (++serial > Number.MAX_SAFE_INTEGER) return reject('command-sequence-exhausted');
      const frame = Math.max(now, Math.round(voice.start * context.sampleRate)), data = new Array(WIDTH).fill(0);
      data[0] = voice.epochToken; data[1] = frame; data[2] = serial; data[3] = LEASE; data[4] = voice.slot; data[5] = voice.slotToken;
      data[16] = validUntilFrame; data[17] = voice.semanticGeneration;
      commands.push({ opcode: LEASE, frame, sequence: serial, data: Object.freeze(data), epoch: voice.semanticEpoch,
        generation: voice.semanticGeneration, voiceId: voice.voiceId, slotToken: voice.slotToken });
      changes.set(voice, { end: validUntilFrame / context.sampleRate, releaseAt: validUntilFrame / context.sampleRate - voice.release });
    }
    const admission = preview._inspectVoiceExtensions(changes, { patchVoices: voices.values(), patchLimit: patch?.maxVoices ?? MAX_VOICES });
    if (!admission.accepted) return reject(admission.reason);
    if (commands.length) {
      if (inFlight.size + queue.diagnostics().queued + commands.length > CAPACITY) return reject('kernel-acknowledgment-pressure');
      const queued = queue.enqueueMany(commands, now); if (queued.status !== 'accepted') return reject(queued.reason);
      sequence = serial; counters.queued += commands.length; schedulePump();
    }
    leases.set(key, validUntilFrame);
    for (const item of commands) {
      const voice = voices.get(keyFor(item.epoch, item.voiceId));
      voice.requestedLeaseEndFrame = validUntilFrame; voice.pendingLeases.set(item.sequence, validUntilFrame); reconcileLease(voice);
    }
    return Object.freeze({ status: 'accepted', generation, executionEpoch, validUntilFrame, stage: commands.length ? 'queued' : 'registered',
      renewalSemantics: 'per-voice', applied: false,
      voices: Object.freeze(commands.map(item => Object.freeze({ voiceId: item.voiceId, sequence: item.sequence,
        requestedLeaseEndFrame: validUntilFrame, effectiveLeaseEndFrame: voices.get(keyFor(item.epoch, item.voiceId))?.effectiveLeaseEndFrame ?? null }))) });
  };
  const begin = (intent, targetFrame, executionEpoch = 'live') => {
    if (!validVoiceLaneMix(intent?.laneMix)) return reject('invalid-lane-mix', intent?.voiceId);
    if (!validVoiceTransition(intent?.voiceTransition)) return reject('invalid-voice-transition', intent?.voiceId);
    if (!isExtended && (Object.keys(intent?.performanceControls?.macros || {}).length || Object.keys(intent?.performanceControls || {}).some(key => key !== 'macros'))) return reject('performance-controls-unavailable', intent?.voiceId);
    if (!ready || !patch || !preview._ownerReady(owner) || context !== preview.getAudioContext()) return reject(fault || 'audio-not-ready', intent?.voiceId);
    if (ownerStopped) return reject('kernel-stop-pending', intent?.voiceId);
    try { ensureLaneProducer(); } catch { return reject('lane-source-admission-failed', intent?.voiceId); }
    const now = frameNow();
    if (intent?.version !== 1 || intent.kind !== 'begin' || typeof intent.voiceId !== 'string' || !intent.voiceId || intent.voiceId.length > 512 ||
        !Number.isSafeInteger(intent.generation) || intent.generation < 0 || !finite(intent.velocity01, 0, 1) || !finite(intent.pitch?.cents, -24000, 24000) ||
        !finite(intent.pitch?.referenceHz ?? 440, 0.1, 20000) || typeof executionEpoch !== 'string' || !executionEpoch ||
        !Number.isSafeInteger(targetFrame) || targetFrame < now) return reject('invalid-or-late-intent', intent?.voiceId);
    let performance = null, initialCause = null;
    if (isExtended) { try {
      initialCause = intent.performanceCause ? retainInstrumentCause(intent.performanceCause) : null;
      performance = patch.performance.resolve(intent.performanceControls, targetFrame, { ...intent, performanceCause: initialCause });
    } catch { return reject('unsupported-performance-controls', intent.voiceId); } }
    const parameters = performance?.values || patch.parameters;
    if (!source.acceptsParameters(parameters)) return reject('unsupported-source-parameter-layout', intent.voiceId);
    const expression = intent.expression || {}, pressure = expression.pressure01 ?? 1, pan = expression.pan01 ?? parameters.pan01,
      offset = expression.pitchOffsetCents ?? 0;
    if (typeof expression !== 'object' || Array.isArray(expression) || Object.getPrototypeOf(expression) !== Object.prototype ||
        !finite(pressure, 0, 1) || !finite(pan, -1, 1) || !finite(offset, -24000, 24000) ||
        Object.keys(expression).some(id => !['pressure01', 'pan01', 'pitchOffsetCents'].includes(id))) return reject('unsupported-expression', intent.voiceId);
    const frequency = (intent.pitch.referenceHz ?? 440) * 2 ** ((intent.pitch.cents - 6900 + offset) / 1200);
    if (!finite(frequency, source.minHz, Math.min(source.maxHz ?? Infinity, context.sampleRate / 2 - 1)) || Math.abs(offset) > source.bendCents) return reject('pitch-out-of-range', intent.voiceId);
    if (!source.acceptsOnset(parameters, frequency, pcmDescriptor, context.sampleRate) || isLayered && !samplePlan.acceptsOnset(frequency)) return reject('source-region-or-pitch-out-of-range', intent.voiceId);
    let circularTravel = null;
    if (source.travelPlanner) { try { circularTravel = source.travelPlanner(parameters, intent, targetFrame, context.sampleRate); } catch (error) { return reject(error.message, intent.voiceId); } }
    let seedLayerMotion = null;
    if (isLayered) { try { seedLayerMotion = planSeedLayerContactBegin(samplePlan, intent, targetFrame); } catch (error) { return reject(error.message, intent.voiceId); } }
    let sampleSelection = null;
    if (isSampler) { try { sampleSelection = samplePlan.select(intent); } catch (error) { return reject(error.message || 'sample-selection-unavailable', intent.voiceId); } }
    let traversal = null;
    if (sampleSelection) { const entry = samplePlan.entries[sampleSelection.zoneIndex];
      if (entry.attack.traversal && intent.samplePositionMode !== 'authored-control-fixture') {
        try { traversal = planSampleTraversal(entry.attack, intent, targetFrame, context.sampleRate); } catch (error) { return reject(error.message, intent.voiceId); }
      }
    }
    const key = keyFor(executionEpoch, intent.voiceId), generationKey = keyFor(executionEpoch, intent.generation);
    if (cancelled.has(generationKey)) return reject('generation-cancelled', intent.voiceId);
    if (cancellationHistoryFull && !isManagedExecutionEpoch(executionEpoch)) return reject('execution-registration-required', intent.voiceId);
    if (voices.has(key) || preview._semanticVoiceOwners.has(JSON.stringify([owner, executionEpoch, intent.voiceId]))) return reject('duplicate-owner-voice', intent.voiceId);
    const slot = slots.findIndex(voice => voice == null);
    const renderCost = source.cost(parameters);
    if (slot < 0 || !source.requiresPCMSet && voices.size >= patch.maxVoices || preview._renderVoiceCount() + renderCost > preview._maxScheduledVoices) return reject('shared-voice-budget', intent.voiceId);
    if (slotTokens[slot] === 0xffffffff) return reject('voice-slot-generation-exhausted', intent.voiceId);
    const endFrame = leases.get(generationKey) ?? targetFrame + Math.ceil(preview._maxNoteSeconds * context.sampleRate);
    if (endFrame <= targetFrame + parameters.releaseSeconds * context.sampleRate) return reject('execution-lease-expired', intent.voiceId);
    if (circularTravel && circularTravel.endFrame >= endFrame - Math.ceil(parameters.releaseSeconds * context.sampleRate)) return reject(source.travelDomain + '-travel-lease-expired', intent.voiceId);
    if (traversal && traversal.segment.endOutputFrame >= endFrame - Math.ceil(parameters.releaseSeconds * context.sampleRate)) return reject('sample-travel-lease-expired', intent.voiceId);
    const chokeOverrides = sampleSelection ? new Map() : null, chokeVictims = sampleSelection ? [] : null; let nextChoke = Infinity;
    if (sampleSelection?.region.chokeGroup) for (const member of voices.values()) {
      const region = member.sampleSelection?.region;
      if (member.semanticEpoch !== executionEpoch || region?.chokeGroup !== sampleSelection.region.chokeGroup || region.chokeScope !== sampleSelection.region.chokeScope || member.end * context.sampleRate <= targetFrame) continue;
      const start = Math.round(member.start * context.sampleRate);
      if (start > targetFrame || start === targetFrame && member.voiceId > intent.voiceId) nextChoke = Math.min(nextChoke, start);
      else { chokeVictims.push(member); chokeOverrides.set(member, { releaseAt: Math.min(member.releaseAt, targetFrame / context.sampleRate), end: Math.min(member.end, targetFrame / context.sampleRate + 0.005) }); }
    }
    const admission = preview._inspectVoiceInterval(owner, { start: targetFrame / context.sampleRate, end: Math.min(endFrame / context.sampleRate, nextChoke / context.sampleRate + 0.005),
      releaseAt: Math.min(endFrame / context.sampleRate - parameters.releaseSeconds, nextChoke / context.sampleRate), overrides: chokeOverrides,
      cost: renderCost, patchVoices: voices.values(), patchLimit: patch.maxVoices });
    if (!admission.accepted) return reject(admission.reason, intent.voiceId);
    let onsetLaneToken = 0;
    try { if (laneTapsEnabled && intent.audioLaneId != null) onsetLaneToken = laneRegistry.laneToken(intent.audioLaneId); }
    catch { return reject('lane-source-identity-capacity', intent.voiceId); }
    let resourceLease = null;
    try { resourceLease = preview._audioResources?.reserveWorkletVoice(owner, intent.generation, source.requiresPCMSet ? 16384 : isExtended ? 8192 : 0) || null; }
    catch { return reject('audio-resource-budget', intent.voiceId); }
    const token = epochToken(executionEpoch);
    if (token == null) { resourceLease?.release(); return reject('execution-identity-capacity', intent.voiceId); }
    const voice = { owner, seedLayerMotion, circularTravel: circularTravel ? { ownerIdentity: circularTravel.ownerIdentity, lastEndFrame: circularTravel.endFrame, lastPhase: circularTravel.to, lastSequence: circularTravel.sequence } : null, traversalIdentity: traversal?.ownerIdentity ?? null, sampleSelection, samplePitch: sampleSelection ? Object.freeze({ ...intent.pitch }) : null, positionFrontier: null, positionCommands: isSampler ? new Set() : null, audioLaneId: intent.audioLaneId ?? null, onsetLaneToken, laneTransferUntil: 0, renderCost, workloadClass: preview._workloadClass(owner), number: 0, voiceId: intent.voiceId, semanticGeneration: intent.generation, semanticEpoch: executionEpoch,
      resourceLease, initialLeaseEndFrame: endFrame, requestedLeaseEndFrame: endFrame, effectiveLeaseEndFrame: null,
      pendingLeases: new Map(), leaseFailure: null,
      epochToken: token, slot, slotToken: ++slotTokens[slot], id: ++preview._voiceSequence, start: targetFrame / context.sampleRate,
      note: Math.round(intent.pitch.cents / 100), velocity: intent.velocity01 * 127,
      startMs: preview._nowMs() + (targetFrame - now) * 1000 / context.sampleRate,
      captureMeta: preview._captureMetadata({ semanticVoiceId: intent.voiceId, generation: intent.generation, executionEpoch,
        onsetId: intent.onsetId, intentId: intent.intentId, sourceEventIds: intent.sourceEventIds?.slice(0, 32) }, owner),
      end: endFrame / context.sampleRate, release: parameters.releaseSeconds, releaseAt: endFrame / context.sampleRate - parameters.releaseSeconds,
      released: false, attack: transitionAttackSeconds(intent, parameters.attackSeconds), decay: parameters.decaySeconds, sustain: parameters.sustain01,
      peak: intent.velocity01 * parameters.gain01 * patch.gain01, priority: 1, laneIndex: intent.laneId ?? 0,
      baseFrequency: frequency / 2 ** (offset / 1200), mixPan: patch.pan01, patchRevision: patch.revision, patchId: patch.id,
      stringT60Seconds: parameters.stringT60Seconds, bodyT60Seconds: parameters.bodyT60Seconds, sourceParameters: parameters,
      sourceChannels: source.requiresPCMSet ? pcmDescriptor.banks.some(bank => bank.channels === 2) ? 2 : 1 : pcmDescriptor?.channels || 1,
      performancePlan: patch.performance, continuousBase: performance?.continuousBase,
      physicalCauses: isExtended ? new Map(initialCause ? [[initialCause.sourceKind, initialCause]] : []) : null, physicalFrame: targetFrame,
      startedAt: targetFrame / context.sampleRate, requestRelease: (time, force, reason) => {
        if (voice.released) return; voice.released = true; voice.releaseAt = Math.max(voice.start, time); voice.terminationCause = reason;
        command(END, Math.max(frameNow(), Math.round(time * context.sampleRate)), voice, { 13: Math.max(1, Math.round(voice.release * context.sampleRate)), ...(source.requiresPCMSet ? { 20: 1 } : {}) });
      },
      onDestroy: reason => {
        if (voices.get(key) === voice) voices.delete(key);
        if (laneTapsEnabled) { if (voice.kernelEnded && node && !fault && !disposed) sendLaneRoute(voice, 0); laneRegistry?.refreshSources(); }
        display.retire(voice);
        const shared = JSON.stringify([owner, executionEpoch, intent.voiceId]);
        if (preview._semanticVoiceOwners.get(shared) === voice) preview._semanticVoiceOwners.delete(shared);
        const removed = queue?.invalidate(item => item.slotToken === voice.slotToken && item.voiceId === voice.voiceId && item.epoch === executionEpoch) || 0;
        counters.producerCancelled += removed;
        if (!voice.kernelEnded && ready && !disposed && !fault && !ownerStopped) command(END, frameNow(), voice, { 13: Math.ceil(context.sampleRate * 0.005), ...(source.requiresPCMSet ? { 20: 1 } : {}) });
        if (voice.kernelEnded || removed && !voice.submitted) slots[slot] = null;
        record({ status: 'ended', stage: voice.kernelEnded ? 'render-kernel-ended' : 'stop-requested', voiceId: intent.voiceId, executionEpoch,
          generation: intent.generation, reason, appliedFrame: voice.kernelEnded ? voice.appliedFrame : null });
      } };
    if (sampleSelection) { const profile = samplePlan.entries[sampleSelection.zoneIndex].attack.cursorProfile; if (profile) voice.positionFrontier = { frame: targetFrame, released: false, length: 0, lastSequence: 0, lastEndFrame: targetFrame, lastEndPosition: traversal?.initialSourceFrame ?? profile.regionStartFrame, lastSeekFrame: -profile.slewFrames };
      if (traversal) { voice.positionFrontier.lastSequence = traversal.segment.sequence; voice.positionFrontier.lastEndFrame = traversal.segment.endOutputFrame; voice.positionFrontier.lastEndPosition = traversal.segment.endSourceFrame; } }
    const excitationSeed = ownedSourceSeed(source, patch, intent, performance);
    const sourceFields = { ...source.beginFields(parameters, excitationSeed, pcmDescriptor, sampleSelection, circularTravel), ...sampleTraversalBeginFields(traversal), ...seedLayerContactBeginFields(seedLayerMotion) };
    if (laneTapsEnabled) { try { sendLaneRoute(voice, voiceRouteMask(voice)); } catch { resourceLease?.release(); markFault('lane-route-port-failed'); return reject('lane-route-port-failed', intent.voiceId); } }
    const result = command(BEGIN, targetFrame, voice, { 6: frequency, 7: voice.peak, 8: pressure, 9: Math.max(-1, Math.min(1, pan + patch.pan01)),
      10: Math.round(transitionAttackSeconds(intent, parameters.attackSeconds) * context.sampleRate), 11: Math.round(parameters.decaySeconds * context.sampleRate),
      14: 1 + (intent.laneMix?.gain ?? 1), 15: intent.laneMix?.pan ?? 0, 12: parameters.sustain01, 13: Math.round(parameters.releaseSeconds * context.sampleRate), 16: endFrame, ...sourceFields });
    if (result.status === 'rejected') {
      if (laneTapsEnabled && node) { try { sendLaneRoute(voice, 0); } catch { markFault('lane-route-port-failed'); } }
      resourceLease?.release();
      if (![...slots].some(existing => existing?.semanticEpoch === executionEpoch)) epochs.delete(executionEpoch);
      return result;
    }
    voices.set(key, voice); slots[slot] = voice; preview._voices.add(voice);
    display.admit(voice, intent); display.configure();
    preview._semanticVoiceOwners.set(JSON.stringify([owner, executionEpoch, intent.voiceId]), voice); voice.submitted = inFlight.has(result.sequence);
    if (chokeVictims) for (const member of chokeVictims) if (forceSampleEnd(member, targetFrame, Math.round(member.start * context.sampleRate) === targetFrame).status !== 'accepted') {
      markFault('sample-choke-control-failed'); return reject('sample-choke-control-failed', intent.voiceId);
    }
    if (Number.isFinite(nextChoke) && forceSampleEnd(voice, nextChoke, nextChoke === targetFrame).status !== 'accepted') {
      markFault('sample-choke-control-failed'); return reject('sample-choke-control-failed', intent.voiceId);
    }
    if (circularTravel) return Object.freeze({ ...result, [source.travelReceiptKey]: circularTravel.receipt, performance, articulation: resolveOwnedArticulationPolicy({ engineId, parameters, seedLayers: patch.samplePatch?.seedLayers }) });
    if (sampleSelection) return Object.freeze({ ...result, region: sampleSelection.region, rateRatio: sampleSelection.rateRatio, readDerivative: sampleSelection.readDerivative, sourceRenderer: 'owned-sample', ...(traversal ? { sampleTraversal: traversal.receipt } : {}), sourceBank: pcmDescriptor, articulation: sampleSelection.articulation });
    return isExtended ? Object.freeze({ ...result, performance, articulation: resolveOwnedArticulationPolicy({ engineId, parameters, seedLayers: patch.samplePatch?.seedLayers }), ...(pcmDescriptor ? { sourceBank: pcmDescriptor } : {}), ...(seedLayerMotion ? { seedLayerContact: seedLayerMotion.receipt } : {}) }) : result;
  };
  const update = (voiceId, expression, targetFrame, executionEpoch = 'live', rampSeconds = smoothingSeconds) => {
    const voice = voices.get(keyFor(executionEpoch, voiceId)), now = frameNow();
    if (!ready || !voice || voice.released && voice.releaseAt <= context.currentTime || !preview._ownerReady(owner)) return reject('voice-not-active', voiceId);
    if (!expression || typeof expression !== 'object' || Array.isArray(expression) || Object.getPrototypeOf(expression) !== Object.prototype ||
        Object.keys(expression).some(id => !expressionIds.has(id))) return reject('unsupported-expression', voiceId);
    if (!Number.isSafeInteger(targetFrame) || targetFrame < Math.max(now, Math.round(voice.start * context.sampleRate)) || targetFrame >= voice.releaseAt * context.sampleRate) return reject('stale-or-outside-gate-expression', voiceId);
    if (!finite(rampSeconds, 0, 60)) return reject('invalid-control-ramp', voiceId);
    let mask = 0; const values = { 14: Math.ceil(Math.max(smoothingSeconds, runtime.minimumControlSeconds || 0, rampSeconds) * context.sampleRate) };
    if (expression.pitchOffsetCents != null) {
      const frequency = voice.baseFrequency * 2 ** (expression.pitchOffsetCents / 1200);
      if (!finite(expression.pitchOffsetCents, -source.bendCents, source.bendCents) || !finite(frequency, 0.1, context.sampleRate / 2 - 1)) return reject('invalid-expression', voiceId);
      if (isSampler) { const entry = samplePlan.entries[voice.sampleSelection.zoneIndex]; if (entry.attack.mode === 'positionDriven' && expression.pitchOffsetCents !== 0 || !samplePlan.rateFor(entry.attack, voice.samplePitch, expression.pitchOffsetCents) || entry.release && !samplePlan.rateFor(entry.release, voice.samplePitch, expression.pitchOffsetCents)) return reject('sample-pitch-out-of-range', voiceId); }
      mask |= 1; values[6] = frequency;
    }
    if (expression.pressure01 != null) { if (!finite(expression.pressure01, 0, 1)) return reject('invalid-expression', voiceId); mask |= 2; values[8] = expression.pressure01; }
    if (expression.pan01 != null) { if (!finite(expression.pan01, -1, 1)) return reject('invalid-expression', voiceId); mask |= 4; values[9] = Math.max(-1, Math.min(1, expression.pan01 + voice.mixPan)); }
    const sourceMask = source.writeUpdate(expression, voice, values); if (sourceMask == null) return reject('invalid-expression', voiceId); mask |= sourceMask;
    values[15] = mask; return command(UPDATE, targetFrame, voice, values);
  };
  const queueSamplePosition = (voiceId, segment, targetFrame, executionEpoch = 'live', canonicalTravel = false) => {
    const voice = voices.get(keyFor(executionEpoch, voiceId)), now = frameNow();
    if (!isSampler || !ready || !voice?.positionFrontier || !preview._ownerReady(owner) || !segment || Object.getPrototypeOf(segment) !== Object.prototype ||
        Object.keys(segment).some(key => !['firstOutputFrame', 'endOutputFrame', 'firstSourceFrame', 'endSourceFrame', 'sequence', 'discontinuity'].includes(key)) ||
        !Number.isSafeInteger(targetFrame) || targetFrame < now || targetFrame !== segment.firstOutputFrame || targetFrame >= voice.releaseAt * context.sampleRate) return reject('sample-position-admission', voiceId);
    if (voice.traversalIdentity && !canonicalTravel) return reject('sample-travel-binding-requires-canonical-observation', voiceId);
    if (segment.endOutputFrame >= Math.round(voice.releaseAt * context.sampleRate)) return reject('sample-position-lease-expired', voiceId);
    const p = samplePlan.entries[voice.sampleSelection.zoneIndex].attack.cursorProfile, frontier = voice.positionFrontier, discontinuity = segment.discontinuity ?? 'continuous';
    frontier.frame = Math.max(now, Math.round(voice.start * context.sampleRate)); frontier.length = voice.positionCommands.size;
    if (!acceptsSampleCursorSegment(p, frontier, segment.firstOutputFrame, segment.endOutputFrame, segment.firstSourceFrame, segment.endSourceFrame, segment.sequence, discontinuity)) return reject('sample-position-segment', voiceId);
    const outcome = command(UPDATE, targetFrame, voice, { 15: 8, 18: segment.firstOutputFrame, 19: segment.endOutputFrame, 20: segment.firstSourceFrame,
      21: segment.endSourceFrame, 22: segment.sequence, 23: SAMPLE_CURSOR_DISCONTINUITIES.indexOf(discontinuity) });
    if (outcome.status === 'accepted') { frontier.lastSequence = segment.sequence; frontier.lastEndFrame = segment.endOutputFrame; frontier.lastEndPosition = segment.endSourceFrame;
      if (discontinuity !== 'continuous') frontier.lastSeekFrame = targetFrame; voice.positionCommands.add(outcome.sequence); }
    return outcome;
  };
  const updateSamplePosition = (...args) => queueSamplePosition(...args);
  const updateSampleTravel = (voiceId, intent, targetFrame, executionEpoch = 'live') => {
    const voice = voices.get(keyFor(executionEpoch, voiceId));
    if (isLayered && samplePlan.profile.family === 'bowed-scrap') {
      if (!voice?.seedLayerMotion || !ready || intent.voiceId !== voiceId || intent.generation !== voice.semanticGeneration || targetFrame < frameNow()) return reject('contact-motion-owner-unavailable', voiceId);
      let motion, next; try { motion = planSeedLayerContactMotion(samplePlan, intent, targetFrame); next = advanceSeedLayerContactMotion(voice.seedLayerMotion, motion, Math.round(voice.releaseAt * context.sampleRate)); } catch (error) { return reject(error.message, voiceId); }
      const outcome = command(UPDATE, motion.firstFrame, voice, seedLayerContactMotionFields(motion));
      if (outcome.status === 'accepted') voice.seedLayerMotion = next;
      return Object.freeze({ ...outcome, ...(outcome.status === 'accepted' ? { seedLayerMotion: motion.receipt } : {}) });
    }
    if (!isSampler || !voice?.sampleSelection || !samplePlan.entries[voice.sampleSelection.zoneIndex].attack.traversal) return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false, reason: 'no-sample-travel-binding' });
    let planned; try { planned = planSampleTraversal(samplePlan.entries[voice.sampleSelection.zoneIndex].attack, intent, targetFrame, context.sampleRate); } catch (error) { return reject(error.message, voiceId); }
    if (planned.ownerIdentity !== voice.traversalIdentity || intent.voiceId !== voiceId || intent.generation !== voice.semanticGeneration) return reject('sample-travel-owner-or-discontinuity-changed', voiceId);
    const outcome = queueSamplePosition(voiceId, planned.segment, planned.segment.firstOutputFrame, executionEpoch, true);
    return Object.freeze({ ...outcome, ...(outcome.status === 'accepted' ? { sampleTraversal: planned.receipt } : {}) });
  };
  const updateCanonicalTravel = (voiceId, intent, targetFrame, executionEpoch = 'live') => {
    const voice = voices.get(keyFor(executionEpoch, voiceId));
    if (!voice?.circularTravel) return updateSampleTravel(voiceId, intent, targetFrame, executionEpoch);
    let planned; try { planned = source.travelPlanner(voice.sourceValues, intent, targetFrame, context.sampleRate); } catch (error) { return reject(error.message, voiceId); }
    const frontier = voice.circularTravel;
    if (!planned || planned.ownerIdentity !== frontier.ownerIdentity || planned.sequence <= frontier.lastSequence || planned.firstFrame < frontier.lastEndFrame || Math.abs(planned.from - frontier.lastPhase) > 1e-7 || planned.endFrame >= Math.round(voice.releaseAt * context.sampleRate) || intent.voiceId !== voiceId) return reject(source.travelDomain + '-travel-owner-or-continuity', voiceId);
    const outcome = command(UPDATE, planned.firstFrame, voice, { 15: 64, 25: planned.from, 26: planned.to, 27: planned.endFrame - planned.firstFrame });
    if (outcome.status === 'accepted') { frontier.lastEndFrame = planned.endFrame; frontier.lastPhase = planned.to; frontier.lastSequence = planned.sequence; }
    return Object.freeze({ ...outcome, ...(outcome.status === 'accepted' ? { [source.travelReceiptKey]: planned.receipt } : {}) });
  };
  const updatePhysical = (voiceId, input, targetFrame, executionEpoch = 'live') => {
    const voice = voices.get(keyFor(executionEpoch, voiceId));
    if (!ready || !voice || voice.released && voice.releaseAt <= context.currentTime || !preview._ownerReady(owner)) return reject('voice-not-active', voiceId);
    if (!isExtended || !voice?.performancePlan?.continuousSourceKinds.length) return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false, reason: 'no-continuous-binding' });
    let cause;
    try { cause = retainInstrumentCause(input); } catch { return reject('invalid-physical-control-source', voiceId); }
    if (!voice.performancePlan.continuousSourceKinds.includes(cause.sourceKind)) return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false });
    if (targetFrame < voice.physicalFrame) return reject('out-of-order-physical-control', voiceId);
    const causes = new Map(voice.physicalCauses); causes.set(cause.sourceKind, cause);
    let performance;
    try { performance = voice.performancePlan.resolveContinuous(voice.continuousBase, [...causes.values()], targetFrame); } catch { return reject('invalid-physical-control', voiceId); }
    if (!performance.bindingOutcomes.some(outcome => outcome.state === 'applied' && outcome.sourceEventId === cause.eventId))
      return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false, reason: 'no-qualified-control-measurement', performance });
    const expression = {};
    for (const delta of performance.deltas) {
      if (!liveSourceIds.includes(delta.parameterId))
        return reject('unsupported-continuous-target', voiceId);
      expression[delta.parameterId] = performance.values[delta.parameterId];
    }
    if (!Object.keys(expression).length) return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false, performance });
    const result = update(voiceId, expression, targetFrame, executionEpoch, performance.smoothingMs / 1000);
    if (result.status === 'accepted') { voice.physicalCauses = causes; voice.physicalFrame = targetFrame; }
    return Object.freeze({ ...result, performance });
  };
  const updateLaneMix = (voiceId, mix, frame, epoch = 'live', laneId = undefined) => {
    const voice = voices.get(keyFor(epoch, voiceId));
    if (!ready || !voice || !mix || !validVoiceLaneMix(mix) || !Number.isSafeInteger(frame) || frame < 0) return reject('invalid-lane-mix', voiceId);
    frame = Math.max(frameNow(), frame, Math.round(voice.start * context.sampleRate));
    const transferred = laneId !== undefined && laneId !== voice.audioLaneId, fade = Math.ceil(0.008 * context.sampleRate); let laneToken = 0;
    if (transferred) {
      if (!laneTapsEnabled || frame < voice.laneTransferUntil) return reject('lane-source-transfer-admission', voiceId);
      try { laneToken = laneRegistry.laneToken(laneId); } catch { return reject('lane-source-identity-capacity', voiceId); }
    }
    const outcome = command(MIX, frame, voice, { 6: laneToken, 7: mix.gain, 9: mix.pan, 14: fade });
    if (outcome.status === 'accepted' && transferred) { voice.audioLaneId = laneId; voice.laneTransferUntil = frame + fade; }
    return outcome;
  };
  const end = (voiceId, release, targetFrame, executionEpoch = 'live') => {
    const voice = voices.get(keyFor(executionEpoch, voiceId)), now = frameNow();
    if (!voice || !ready) return reject('voice-not-active', voiceId);
    if (!Number.isSafeInteger(targetFrame) || targetFrame < 0 || !finite(release?.seconds ?? voice.release, 0, 4) || release?.velocity01 != null && (!isSampler || !finite(release.velocity01, 0, 1)) || release?.force != null && typeof release.force !== 'boolean') return reject('invalid-release', voiceId);
    let frame = Math.max(now, targetFrame);
    if (release?.mode === 'one-shot') {
      if (!finite(release.tailSeconds, 0, 4)) return reject('invalid-release', voiceId);
      frame = Math.max(frame, Math.round((voice.start + release.tailSeconds) * context.sampleRate));
    } else if (release?.mode != null) return reject('unsupported-release-mode', voiceId);
    if (voice.released && release?.force !== true && (!source.requiresPCMSet || frame >= Math.round(voice.releaseAt * context.sampleRate))) return Object.freeze({ status: 'accepted', stage: 'queued', voiceId, reason: 'already-releasing' });
    const requestedReleaseFrames = Math.max(1, Math.round((release?.seconds ?? voice.release) * context.sampleRate));
    const deadline = Math.max(now + 1, Math.round(voice.end * context.sampleRate));
    if (voice.circularTravel && release?.force !== true) frame = Math.max(frame, voice.circularTravel.lastEndFrame);
    if (voice.seedLayerMotion && release?.force !== true) frame = Math.max(frame, voice.seedLayerMotion.lastEndFrame);
    if (voice.traversalIdentity && release?.force !== true) frame = Math.max(frame, voice.positionFrontier.lastEndFrame);
    frame = Math.min(frame, deadline - 1);
    const releaseFrames = Math.min(requestedReleaseFrames, Math.max(1, deadline - frame));
    const layerTailFrames = isSampler && !release?.force && voice.sampleSelection.region.releaseRegion && release?.velocity01 !== 0 ? Math.min(Math.max(releaseFrames, Math.ceil(context.sampleRate * 4)), Math.max(1, deadline - frame)) : releaseFrames;
    const result = command(END, frame, voice, { 13: releaseFrames, ...(source.requiresPCMSet ? { 16: frame + layerTailFrames, 7: release?.velocity01 ?? 1, 8: 1, 20: release?.force ? 1 : 0 } : {}) });
    if (result.status === 'accepted') { voice.released = true; voice.releaseAt = Math.min(voice.releaseAt, frame / context.sampleRate); voice.end = (frame + layerTailFrames) / context.sampleRate; }
    return Object.freeze({ ...result, releasePolicy: 'bounded-by-admitted-interval', requestedTargetFrame: targetFrame, effectiveTargetFrame: frame,
      requestedReleaseFrames, effectiveReleaseFrames: releaseFrames, ...(source.requiresPCMSet ? { effectiveLayerTailFrames: layerTailFrames } : {}), effectiveEndFrame: frame + layerTailFrames });
  };
  const cancelGenerationWithReceipt = (generation, executionEpoch = 'live') => {
    const key = keyFor(executionEpoch, generation), previous = cancellationReceipts.get(key);
    if (previous) return Object.freeze({ ...previous, count: 0, repeated: true });
    if (cancellationReceipts.size >= 1088) {
      markFault('cancellation-receipt-capacity');
      return Object.freeze({ generation, executionEpoch, count: 0, stage: 'not-submitted', reason: 'cancellation-receipt-capacity', renderedStatus: 'unknown' });
    }
    if (!isManagedExecutionEpoch(executionEpoch) && !cancelled.has(key)) {
      if (cancelled.size < 1024) cancelled.add(key); else cancellationHistoryFull = true;
    }
    leases.delete(key);
    const removed = queue?.invalidate(item => item.generation === generation && item.epoch === executionEpoch) || 0;
    counters.producerCancelled += removed;
    const token = epochs.get(executionEpoch);
    const outcome = ready && token != null ? command(CANCEL, frameNow(), null, { epochToken: token, epoch: executionEpoch, generation }) : null;
    let count = 0;
    for (const voice of voices.values()) if (voice.semanticGeneration === generation && voice.semanticEpoch === executionEpoch) {
      if (!voice.submitted) { voice.kernelEnded = true; preview._destroyVoice(voice, 'generation-cancel-before-submission'); slots[voice.slot] = null; count++; continue; }
      voice.pendingLeases.clear(); voice.released = true; voice.releaseAt = context.currentTime; voice.end = context.currentTime + 0.005; count++;
    }
    const receipt = Object.freeze({ generation, executionEpoch, count, removedBeforeSubmission: removed, frontierFrame: frameNow(),
      stage: outcome?.status === 'accepted' ? 'scheduled-cancellation-requested' : 'not-submitted', appliedFrame: null, renderedStatus: 'unknown' });
    cancellationReceipts.set(key, receipt); return receipt;
  };
  const onOwnerStop = () => {
    if (ownerStopped && ownerStopReceipt) return ownerStopReceipt;
    ownerStopped = true; preparing++;
    return ownerStopReceipt = createProcgenRetirementScope().retire([
      { name: 'timer', run: clearTimer },
      { name: 'commands', run: () => { counters.producerCancelled += queue?.clear() || 0; leases.clear(); inFlight.clear(); kernelQueued.clear(); for (const voice of voices.values()) voice.pendingLeases.clear(); } },
      ...[...voices.values()].filter(voice => !voice.submitted).map(voice => ({ name: 'unsent-voice-' + voice.id, run: () => {
        voice.kernelEnded = true; const receipt = preview._destroyVoice(voice, 'owner-stop-before-submission'); slots[voice.slot] = null; return receipt;
      } })),
      ...[...pendingInitializations].map((cancel, index) => ({ name: 'initialization-' + index, run: cancel })),
      { name: 'initialization-registry', run: () => pendingInitializations.clear() },
      { name: 'panic-request', run: () => { try { if (node) { counters.stopRequests++; node.port.postMessage({ type: 'panic', protocol: PROTOCOL }); } }
      catch (error) { if (disposed) throw error; return markFault('terminal-port-failure'); } } },
      { name: 'display', run: () => display.stop() }
    ]);
  };
  const settleSourceInspection = (value = null, error = null) => {
    const pending = sourceInspection; if (!pending) return; sourceInspection = null; clearTimeout(pending.timer);
    if (error) pending.reject(error); else { lastSourceInspection = value; pending.resolve(value); }
  };
  const inspectSourceState = () => {
    if (!isSampler || !ready || disposed || !node || sourceInspectionSerial === Number.MAX_SAFE_INTEGER) return Promise.reject(new Error('Prepared sample source diagnostics are unavailable.'));
    if (sourceInspection) return sourceInspection.promise;
    let resolve, reject; const promise = new Promise((accept, deny) => { resolve = accept; reject = deny; });
    const pending = sourceInspection = { requestId: ++sourceInspectionSerial, producer: node, promise, resolve, reject, timer: null };
    pending.timer = setTimeout(() => { if (sourceInspection === pending) settleSourceInspection(null, new Error('Sample processor diagnostics timed out.')); }, 1000);
    try { node.port.postMessage({ type: 'inspect', protocol: PROTOCOL, requestId: pending.requestId }); } catch (error) { settleSourceInspection(null, error); }
    return promise;
  };
  const renderDiagnostics = ({ includeTraces = false } = {}) => Object.freeze({ engineId: runtime.engineId, runtime, capabilities,
    module: inspectOwnedWorkletModule(context || preview.getAudioContext(), runtime.workletUrl),
    readiness: disposed ? 'disposed' : fault || !ready ? fault || 'runtime-unprepared' : ownerStopped ? 'kernel-stop-pending' : !preview._ownerReady(owner) ? 'audio-not-ready' : 'ready',
    activeVoices: voices.size, queued: queue?.diagnostics() || null, inFlight: inFlight.size, outstandingCommands: inFlight.size + (queue?.diagnostics().queued || 0), outstandingCapacity: CAPACITY, terminalReserve: SINE_MAX_VOICES, cancellationReceipts: cancellationReceipts.size, counters: Object.freeze({ ...counters }), pendingPreparations: pendingPreparations.size,
    ...(pcmDescriptor ? { sourceBank: pcmDescriptor } : {}),
    sourceState: lastSourceInspection, sourceInspectionPending: !!sourceInspection,
    executionLeases: Object.freeze([...voices.values()].map(voice => Object.freeze({ voiceId: voice.voiceId, executionEpoch: voice.semanticEpoch,
      generation: voice.semanticGeneration, requestedLeaseEndFrame: voice.requestedLeaseEndFrame, effectiveLeaseEndFrame: voice.effectiveLeaseEndFrame,
      pending: voice.pendingLeases.size, failure: voice.leaseFailure, released: voice.released }))),
    awaitingKernelAdmission: inFlight.size - kernelQueued.size,
    traceCount: traces.length, truncatedTraces: truncated, cancellationHistoryFull, display: display.diagnostics(),
    commandObservers: commandObservers.size, commandObservationFailures,
    retirement: faultRetirement ? Object.freeze({ state: faultRetirement.state, outcome: faultRetirement.outcome }) : null,
    ...(includeTraces ? { traces: Object.freeze([...traces]) } : {}) });
  const dispose = () => {
    if (retirement.getReceipt()) return retirement.getReceipt();
    const retiringNode = node;
    const receipt = retirement.retire([
      { name: 'admission', run: () => { disposed = true; ready = false; settleSourceInspection(null, new Error('Sample diagnostic owner retired.')); } },
      { name: 'kernel-stop', run: onOwnerStop },
      { name: 'pending-source-preparation', run: async () => {
        await Promise.allSettled([...pendingPreparations]); if (faultRetirement?.outcome === 'partial') return faultRetirement;
      } },
      ...[...voices.values()].map(voice => ({ name: `voice-${voice.id}`, run: () => preview._destroyVoice(voice, 'backend-disposed') })),
      { name: 'native-runtime', run: () => retireNode(retiringNode, runtimeResourceLease) },
      { name: 'display', run: () => display.dispose() },
      { name: 'command-observers', run: () => commandObservers.clear() },
      { name: 'identities', run: () => { slots.fill(null); patch = null; } }
    ]);
    const settled = value => { if (value.outcome === 'complete') node = null; else preview._retirementFaults?.add(owner); };
    if (receipt.state === 'retired') settled(receipt); else receipt.completion.then(settled);
    return receipt;
  };
  lifecycle = createInstrumentExecutionLifecycle({ capabilities, runtime, prepare, begin, update, updateLaneMix, updatePhysical, updateSamplePosition, updateSampleTravel, updateCanonicalTravel, end, renewExecutionLease, cancelGenerationWithReceipt,
    observeCommandOutcomes(listener) {
      if (disposed || typeof listener !== 'function' || commandObservers.size >= 8 || commandObserverSequence === Number.MAX_SAFE_INTEGER) throw new Error('Command observation is unavailable.');
      const observer = { id: ++commandObserverSequence, listener }; commandObservers.add(observer); let active = true;
      return () => { if (!active) return; active = false; commandObservers.delete(observer); };
    },
    cancelGeneration: (generation, epoch) => cancelGenerationWithReceipt(generation, epoch).count,
    setDisplayContext: display.setContext, observeDisplaySamples: display.observe, getDisplaySamples: display.inspect,
    onOwnerStop, renderDiagnostics, inspectSourceState, dispose }, {
    getContext: () => preview.getAudioContext(), getGeneration: () => preview._sessions.get(owner)?.generation ?? preview._generation,
    isSettled: epochSettled,
    isVoiceSettled: (voiceId, epoch) => faultRetirement?.outcome !== 'partial' && !voices.has(keyFor(epoch, voiceId)),
    forget: (epoch, generation) => { epochs.delete(epoch); leases.delete(keyFor(epoch, generation)); cancellationReceipts.delete(keyFor(epoch, generation)); }
  });
  return lifecycle.api;
}
