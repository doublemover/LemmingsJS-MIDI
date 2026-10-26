import { RESONATOR_MORPH_KERNEL_REVISION, pairedModalBodyIdentity, verifyPairedModalBodyProfile } from '../../midi/content/PairedModalBodyProfile.js';
import { validateSpectralCaptureReceipt } from '../../midi/content/SpectralCaptureReceipt.js';
import { RECTANGULAR_MEMBRANE_REVISION, rectangularMembraneIdentity, MEMBRANE_LIVE_CONTROLS, membraneControlValid, membraneInitialControl, membraneTouchSupported, membraneControlTarget } from '../../midi/content/RectangularMembraneProfile.js';
import { canonicalDataText } from '../../core/CanonicalData.js';
import { SYMPATHETIC_NETWORK_REVISION, sympatheticNetworkIdentity, NETWORK_LOSS_CONTROLS, NETWORK_PICKUP_CONTROLS } from '../../midi/content/SympatheticNetworkProfile.js';
import { SPECTRAL_FREEZE_REVISION, spectralFreezeIdentity } from '../../midi/content/SpectralFreezeProfile.js';
import { ALLPASS_NOTCH_REVISION, allpassNotchIdentity } from '../../midi/content/AllpassNotchProfile.js';
import { RING_MODULATOR_REVISION, ringModulatorIdentity } from '../../midi/content/RingModulatorProfile.js';
import { validateEffectSourceBindings } from './EffectSourceBindings.js';
import { VOCODER_BANK_REVISION, vocoderBankIdentity, vocoderRealizationKey } from '../../midi/content/VocoderBankProfile.js';
import { ENVELOPE_DETECTOR_REVISION, envelopeDetectorIdentity } from '../../midi/content/EnvelopeDetectorProfile.js';
import { ENVELOPE_MAPPING_REVISION, envelopeMappingIdentity } from '../../midi/content/EnvelopeMappingProfile.js';
import { validateOfflineEffectCompletion, OFFLINE_EFFECT_COMPLETION_REVISION } from './worklet/OfflineEffectCompletion.js';
import { prepareNativeImpulseMaterial } from './NativeImpulseMaterial.js';
import { getActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { createSmoothedAudioParameter } from './SmoothedAudioParameter.js';
import { prepareEffectGraphRevision, effectGraphHash } from '../../midi/content/EffectGraphRevision.js';
import { loadOwnedWorkletModule, retireClosedOwnedWorkletContext } from './OwnedWorkletModuleCache.js';
import { DELAY_KERNEL_REVISION } from './worklet/BoundedDelayProcessor.js';
import { ALIGNMENT_KERNEL_REVISION } from '../../midi/content/EffectRuntimeRevisions.js';
import { fixedFractionalDelayIdentity } from './worklet/FixedFractionalDelayProcessor.js';
import { NONLINEAR_KERNEL_REVISION, nonlinearChainIdentity } from '../../midi/content/NonlinearChainProfile.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { createMembraneStrikeTransport } from './MembraneStrikeTransport.js';

const delayModule = Object.freeze({ id: 'effect-delay', moduleClass: 'effect', heapEstimate: 524288,
  runtime: Object.freeze({ workletUrl: new URL('./worklet/BoundedDelayProcessor.js', import.meta.url).href }) });
const failure = (code, message) => Object.assign(new Error(message), { name: 'EffectGraphError', code });

// A prepared graph has no connection to a live destination. The owner decides
// when inputs/outputs become audible and owns all transition/tail overlap.
export async function prepareNativeEffectGraph(definition, { context, resources, owner, generation = 0, signal, isCurrent = () => true,
  getMaterialProvider = null, resolveSidechainSource = null, jobs, createWorkletNode = (ctx, name, options) => new globalThis.AudioWorkletNode(ctx, name, options), onFault = () => {}, onBodyReceipt = () => {}, onEffectReceipt = () => {}, initializationTimeoutMs = 5000, offlineEndFrame = null, offlineReturnNodeIds = [], offlineSourceBindings = null, retireOfflineContext = null } = {}) {
  let fault = null;
  const guard = () => { signal?.throwIfAborted(); if (fault) throw fault; if (!isCurrent() || context?.state === 'closed') throw failure('stale-effect-graph', 'The effect graph request no longer belongs to this context.'); };
  guard();
  if (!context?.createGain || !resources?.reserve || typeof createWorkletNode !== 'function' || typeof onFault !== 'function' || typeof onBodyReceipt !== 'function' || typeof onEffectReceipt !== 'function' || resolveSidechainSource !== null && typeof resolveSidechainSource !== 'function' ||
      !Number.isSafeInteger(initializationTimeoutMs) || initializationTimeoutMs < 1 || initializationTimeoutMs > 30000) throw new TypeError('Effect graphs need an owned native context and resource budget.');
  const offline = offlineEndFrame !== null;
  if (offline && (!Number.isSafeInteger(offlineEndFrame) || offlineEndFrame < 1 || offlineEndFrame > context.sampleRate * 150 || context.state !== 'suspended' ||
      typeof context.startRendering !== 'function' || typeof retireOfflineContext !== 'function' || !Array.isArray(offlineReturnNodeIds) || offlineReturnNodeIds.length > 8)) throw new TypeError('Offline effect initialization requires a private bounded OfflineAudioContext and its retirement owner.');
  const workspace = resources.reserve({ kind: 'effect-graph-preparation', owner, generation, estimateBytes: 2 * 1048576, consumerOwned: true });
  let plan, hash, storage = null, preparationError = null;
  try {
    plan = prepareEffectGraphRevision(definition, { sampleRate: context.sampleRate }); hash = await effectGraphHash(plan); guard();
    for (const entry of plan.nodes) if (entry.pairedBody) { await verifyPairedModalBodyProfile(entry.pairedBody); guard(); }
    if (offline && plan.sidechainInputs.length) validateEffectSourceBindings(plan, offlineSourceBindings);
    storage = resources.reserve({ kind: 'effects-graph', owner, generation, bytes: plan.stateBytes, estimateBytes: plan.nativeNodeEstimateBytes + 1048576, consumerOwned: true });
  } catch (caught) { preparationError = caught; }
  const preparationScope = createProcgenRetirementScope();
  const prepared = preparationScope.retire([{ name: 'effect-preparation-workspace', run: () => workspace.release() },
    { name: 'unused-effect-graph-reservation', run: () => { if (preparationError || preparationScope.getReceipt().resources[0].status !== 'completed') return storage?.release(); } }]);
  if (prepared.outcome !== 'complete') throw Object.assign(failure('effect-preparation-retirement', 'Effect metadata preparation retirement is unresolved.'), { cause: preparationError, retirement: prepared });
  if (preparationError) throw preparationError;
  const scope = createProcgenRetirementScope({ deadlineMs: offline ? 180000 + initializationTimeoutMs : initializationTimeoutMs + 1000 }), nodes = [], processors = [], impulses = [], instances = new Map(), nodeOutputs = new Map(), inputs = new Map(), outputs = new Map(), sidechainInputs = new Map();
  let disposed = false, controlSequence = 0, initializationConfirmed = false, offlineCompletionConfirmed = false, sidechainsActivated = false, lastInspectionTime = -Infinity, refreshSourcePresence = () => {};
  const audible = new Set([...plan.outputs, ...offlineReturnNodeIds]);
  for (let changed = true; changed;) { changed = false; for (const edge of plan.edges) if (audible.has(edge.to.nodeId) && !audible.has(edge.from.nodeId)) { audible.add(edge.from.nodeId); changed = true; } }
  const sidechainBindings = new Map(plan.sidechainInputs.map(id => [id, { id, pin: null, unsubscribe: null, connected: false, status: 'unbound' }]));
  const disconnectSidechain = binding => {
    if (binding.connected) { binding.pin.node.disconnect(sidechainInputs.get(binding.id)); binding.connected = false; }
    binding.status = 'disconnected';
  };
  const deactivateSidechains = () => { for (const binding of sidechainBindings.values()) disconnectSidechain(binding); sidechainsActivated = false; refreshSourcePresence(); };
  const controls = new Map(), gainControls = new Map(), sidechainGates = new Map(), parameterControls = new Map(), execution = getActiveExecutionIdentity('browser-native-audio');
  const initialPresence = new Map();
  if (offline) for (const entry of plan.nodes) {
    const has = port => plan.edges.some(edge => edge.to.nodeId === entry.id && (!port || edge.to.port === port) && initialPresence.get(edge.from.nodeId));
    initialPresence.set(entry.id, entry.kind === 'bus-in' || entry.kind === 'sidechain-in' ? entry.kind === 'bus-in' || offlineSourceBindings.routes.find(route => route.nodeId === entry.id).available :
      ['feedback-delay', 'nonlinear-chain', 'convolution-native', 'multiband-vocoder', 'ring-modulator', 'allpass-notch', 'spectral-freeze', 'sympathetic-network', 'paired-modal-body', 'rectangular-membrane'].includes(entry.kind) || has(null));
  }
  const sourceSeed = entry => {
    if (!offline) return {};
    const has = port => plan.edges.some(edge => edge.to.nodeId === entry.id && edge.to.port === port && initialPresence.get(edge.from.nodeId));
    return ['envelope-detector', 'spectral-freeze'].includes(entry.kind) ? { sourceAvailable: has('audio') } : ['multiband-vocoder', 'ring-modulator'].includes(entry.kind) ? { donorAvailable: has('donorAudio'), carrierAvailable: has('carrierAudio') } : {};
  };
  const node = value => { nodes.push(value); return value; };
  const dispose = () => scope.retire([{ name: 'effect-native-retirement', run: async () => {
    disposed = true;
    try {
      deactivateSidechains();
      if (offline && context.state !== 'closed') {
        for (const entry of processors) entry.node.port.postMessage({ type: 'panic' });
        for (const entry of impulses) if (entry.convolver) entry.convolver.buffer = null;
        for (const value of nodes) value.disconnect();
        await retireOfflineContext();
      }
      if (offline) { const modules = retireClosedOwnedWorkletContext(context); if (modules) { await modules.completion; if (modules.outcome !== 'complete') throw failure('effect-module-retirement-unknown', 'Closed offline module ownership remains unresolved.'); } }
      const results = await Promise.allSettled(processors.map(async entry => {
        if (context.state === 'closed') return;
        entry.node.port.postMessage({ type: 'dispose' }); await entry.waitDisposed();
      }));
      const rejected = results.find(result => result.status === 'rejected'); if (rejected) throw rejected.reason;
      const native = createProcgenRetirementScope().retire([
        ...impulses.map((entry, i) => ({ name: 'convolver-buffer-' + i, run: () => { if (entry.convolver) entry.convolver.buffer = null; } })),
        ...nodes.map((value, i) => ({ name: 'effect-node-' + i, run: () => value.disconnect() })),
        ...processors.map((entry, i) => ({ name: 'delay-port-' + i, run: () => { entry.cleanup(); entry.node.port.onmessage = null; entry.node.onprocessorerror = null; entry.node.port.close(); } }))
      ]); await native.completion;
      if (native.outcome !== 'complete') throw failure('effect-retirement-unknown', 'Native effect nodes did not retire completely; impulse pins remain owned.');
      const materials = impulses.map(entry => entry.material.release()); await Promise.all(materials.map(receipt => receipt.completion));
      if (materials.some(receipt => receipt.outcome !== 'complete')) throw failure('effect-retirement-unknown', 'Impulse material remains owned after native retirement.');
      for (const binding of sidechainBindings.values()) {
        binding.unsubscribe?.(); binding.unsubscribe = null;
        if (binding.pin) { await binding.pin.release(); binding.pin = null; }
      }
      storage.release();
    } catch (error) { storage.retainUnknown(error); throw error; }
  } }]);

  const prepareProcessor = async (entry, { processorName, parameterData = {}, processorOptions = {}, revision, configurationKey = null, inputChannels = 2, outputChannels = 2, numberOfInputs = 1, realizationKey = null }) => {
    guard();
    const value = node(createWorkletNode(context, processorName, { numberOfInputs, numberOfOutputs: 1, outputChannelCount: [outputChannels], channelCount: inputChannels, channelCountMode: 'explicit', parameterData,
      processorOptions: { ...processorOptions, ...sourceSeed(entry), ...(offline ? { offlineEndFrame } : {}) } }));
    let resolveReady, rejectReady, resolveDisposed, rejectDisposed, resolveComplete, rejectComplete;
    let readyTimer = null, completeTimer = null, retireTimer = null, readySettled = false, completeSettled = false;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }); ready.catch(() => {});
    const terminal = new Promise((resolve, reject) => { resolveComplete = resolve; rejectComplete = reject; }); terminal.catch(() => {});
    const retired = new Promise((resolve, reject) => { resolveDisposed = resolve; rejectDisposed = reject; }); retired.catch(() => {});
    const failReady = error => { if (readySettled) return; readySettled = true; clearTimeout(readyTimer); readyTimer = null; fault ||= error; rejectReady(error); };
    const failComplete = error => { if (completeSettled) return; completeSettled = true; clearTimeout(completeTimer); completeTimer = null; fault ||= error; rejectComplete(error); };
    const abort = () => { failReady(signal.reason); failComplete(signal.reason); };
    const closed = () => { if (context.state === 'closed') resolveDisposed(); };
    const cleanup = () => {
      clearTimeout(readyTimer); clearTimeout(completeTimer); clearTimeout(retireTimer);
      context.removeEventListener?.('statechange', closed); signal?.removeEventListener('abort', abort);
      if (!readySettled) failReady(failure('effect-retired-before-ready', 'Effect initialization retired before its acknowledgment.'));
      if (!completeSettled) { completeSettled = true; rejectComplete(failure('effect-retired-before-complete', 'Effect completion retired before publication.')); }
    };
    const processor = { node: value, nodeId: entry.id, kind: entry.kind, profile: entry.nonlinear || null, vocoderProfile: entry.vocoder || null, revision, configurationKey, stateBytes: entry.stateBytes,
      ready: false, completion: null, spectralSerial: 0, offlineActive: entry.offlineActive ?? audible.has(entry.id), cleanup, health: null,
      awaitReady: () => { if (!readySettled && readyTimer === null) readyTimer = setTimeout(() => failReady(failure('effect-initialization-timeout', 'Effect initialization did not acknowledge its source profile.')), initializationTimeoutMs); return ready; },
      awaitComplete: () => { if (!completeSettled && completeTimer === null) completeTimer = setTimeout(() => failComplete(failure('effect-completion-timeout', 'Offline effect omitted its terminal frame and fault receipt.')), initializationTimeoutMs); return terminal; },
      waitDisposed: () => Promise.race([retired, new Promise((_, reject) => { retireTimer = setTimeout(() => reject(failure('effect-retirement-timeout', 'The effect processor did not acknowledge retirement.')), initializationTimeoutMs); })])
    }; processors.push(processor);
    if (entry.membrane) processor.strikes = createMembraneStrikeTransport({ profile: entry.membrane, node: value, context, nodeId: entry.id, graphDefinitionHash: hash, offline, onReceipt: onBodyReceipt,
      onUnknown: error => { processor.health = Object.freeze({ muted: true, containment: 'body-only', reason: error.code }); try { value.port.postMessage({ type: 'panic' }); } catch {} if (offline) { fault ||= error; failComplete(error); } } });
    context.addEventListener?.('statechange', closed); signal?.addEventListener('abort', abort, { once: true });
    value.port.onmessage = event => {
      const data = event.data;
      if (processor.strikes?.consume(data)) return;
      if (data?.type === 'spectral-capture') {
        if (!entry.spectral || data.sourceEpoch !== generation || !processor.ready) return;
        try {
          const capture = validateSpectralCaptureReceipt(data.capture, entry.spectral);
          if (capture.serial <= processor.spectralSerial) { value.port.postMessage({ type: 'spectral-capture-consumed', sourceEpoch: generation, serial: capture.serial }); return; }
          if (capture.serial !== processor.spectralSerial + 1) throw failure('effect-spectral-capture-gap', 'The spectral processor omitted an acknowledged window.');
          processor.spectralSerial = capture.serial; processor.health = Object.freeze({ ...processor.health, lastCapture: capture });
          value.port.postMessage({ type: 'spectral-capture-consumed', sourceEpoch: generation, serial: capture.serial });
          onEffectReceipt(Object.freeze({ status: 'accepted', stage: 'spectral-capture-applied', nodeId: entry.id, graphDefinitionHash: hash, sampleRate: context.sampleRate, targetFrame: capture.endFrame, spectralCapture: capture, acousticReceipt: false }));
        } catch (error) { fault ||= error; try { onFault(fault); } catch {} }
        return;
      }
      if (data?.type === 'disposed') { resolveDisposed(); return; }
      if (data?.type === 'ready') {
        if (data.revision !== revision || data.sampleRate !== context.sampleRate || data.stateBytes !== entry.stateBytes || configurationKey != null && data.configurationKey !== configurationKey || realizationKey !== null && data.realizationKey !== realizationKey) failReady(failure('effect-abi-mismatch', 'The effect runtime differs from its admitted graph.'));
        else if (!readySettled) { readySettled = true; processor.ready = true; clearTimeout(readyTimer); readyTimer = null; resolveReady(); }
      } else if (data?.type === 'offline-complete' && offline) {
        try { processor.strikes?.assertComplete(); processor.completion = validateOfflineEffectCompletion(data, { revision, sampleRate: context.sampleRate, stateBytes: entry.stateBytes, configurationKey, endFrame: offlineEndFrame });
          if (!completeSettled) { completeSettled = true; clearTimeout(completeTimer); completeTimer = null; resolveComplete(); }
        } catch (error) { failComplete(error); }
      } else if (['delay-fault', 'effect-fault'].includes(data?.type) && data.revision === revision) { if ((entry.membrane || entry.network || entry.pairedBody) && !offline) { processor.health = Object.freeze({ ...data, muted: true, containment: 'body-only' }); return; } fault ||= failure('effect-state-containment', 'The ' + entry.kind + ' branch cleared excessive or nonfinite internal state.'); try { onFault(fault); } catch {}
      } else if (['delay-health', 'effect-health'].includes(data?.type) && data.revision === revision) processor.health = Object.freeze({ ...data });
    };
    value.onprocessorerror = () => { const error = failure('effect-processor-fault', 'The owned effect processor failed.'); fault = error; failReady(error); failComplete(error); rejectDisposed(error); try { onFault(error); } catch {} };
    if (!offline) { await processor.awaitReady(); signal?.removeEventListener('abort', abort); guard(); }
    const adapters = new Map();
    for (const [name, initialValue] of Object.entries(parameterData)) {
      const param = value.parameters.get(name); if (!param?.setValueAtTime || !param.cancelScheduledValues) throw failure('effect-control-unavailable', 'Effect automation lacks bounded native queue replacement.');
      adapters.set(name, createSmoothedAudioParameter({ param, initialValue, startTime: context.currentTime, smoothingSeconds: 0, maxEvents: 128 }));
    } parameterControls.set(entry.id, adapters);
    return value;
  };
  const checkPublication = () => { signal?.throwIfAborted(); if (disposed || !offline && context.state === 'closed' || !isCurrent() || fault) throw fault || failure('stale-effect-publication', 'Prepared effect publication no longer belongs to its owner.'); };
  const confirmReady = async () => { await Promise.all(processors.map(entry => entry.awaitReady())); checkPublication(); initializationConfirmed = true; };
  const confirmOfflineCompletion = async () => {
    if (!offline) throw failure('offline-completion-unavailable', 'This effect graph has no offline completion boundary.');
    await confirmReady(); await Promise.all(processors.filter(entry => entry.offlineActive).map(entry => entry.awaitComplete())); checkPublication(); offlineCompletionConfirmed = true;
  };

  try {
    if (plan.alignmentStateBytes || plan.nodes.some(entry => ['feedback-delay', 'nonlinear-chain', 'envelope-detector', 'envelope-mapping', 'multiband-vocoder', 'ring-modulator', 'allpass-notch', 'spectral-freeze', 'sympathetic-network', 'paired-modal-body', 'rectangular-membrane'].includes(entry.kind))) { await loadOwnedWorkletModule(context, delayModule, resources); guard(); }
    for (const entry of plan.nodes) {
      guard(); let value, outputValue = null;
      if (entry.kind === 'convolution-native') {
        if (typeof getMaterialProvider !== 'function' || typeof context.createConvolver !== 'function') throw failure('convolution-unavailable', 'This owner cannot prepare its exact native impulse response.');
        const material = await prepareNativeImpulseMaterial(entry.impulse, { provider: getMaterialProvider(), resources, context, owner, generation, signal, isCurrent, jobs });
        const record = { material, convolver: null, nodeId: entry.id }; impulses.push(record); guard();
        value = node(context.createGain()); value.gain.setValueAtTime(entry.impulse.referenceGain01, context.currentTime);
        const convolver = node(context.createConvolver()); record.convolver = convolver;
        convolver.channelCount = 2; convolver.channelCountMode = 'clamped-max'; convolver.channelInterpretation = 'speakers';
        convolver.normalize = entry.impulse.normalizationMode === 'native-rms'; convolver.buffer = material.pin.buffer;
        if (entry.impulse.predelaySeconds) { const predelay = node(context.createDelay(0.1)); predelay.delayTime.setValueAtTime(entry.impulse.predelaySeconds, context.currentTime); value.connect(predelay); predelay.connect(convolver); }
        else value.connect(convolver);
        outputValue = convolver;
      } else if (entry.kind === 'paired-modal-body') {
        value = await prepareProcessor(entry, { processorName: 'lemmings-paired-modal-body-v1', revision: RESONATOR_MORPH_KERNEL_REVISION, configurationKey: pairedModalBodyIdentity(entry.pairedBody),
          parameterData: { morph: entry.parameters.morph01 }, processorOptions: { parameters: entry.parameters } });
      } else if (entry.kind === 'rectangular-membrane') {
        value = await prepareProcessor(entry, { processorName: 'lemmings-rectangular-membrane-v1', revision: RECTANGULAR_MEMBRANE_REVISION, configurationKey: rectangularMembraneIdentity(entry.membrane),
          parameterData: Object.fromEntries(MEMBRANE_LIVE_CONTROLS.map(key => [key, membraneInitialControl(key, entry.parameters)] )), processorOptions: { parameters: entry.parameters } });
      } else if (entry.kind === 'sympathetic-network') {
        value = await prepareProcessor(entry, { processorName: 'lemmings-sympathetic-network-v1', revision: SYMPATHETIC_NETWORK_REVISION, configurationKey: sympatheticNetworkIdentity(entry.network),
          parameterData: { couple: entry.parameters.couple01, damp: entry.parameters.damp01, ...Object.fromEntries(NETWORK_LOSS_CONTROLS.map(name => [name, 0])),
            ...Object.fromEntries(NETWORK_PICKUP_CONTROLS.map((name, index) => [name, entry.network.pickupGrid ? (index < 2 ? entry.network.pickupGrid.leftPosition : entry.network.pickupGrid.rightPosition)[index % 2 ? 'y01' : 'x01'] : 0.5])) }, processorOptions: { parameters: entry.parameters } });
      } else if (entry.kind === 'spectral-freeze') {
        value = await prepareProcessor(entry, { processorName: 'lemmings-spectral-freeze-v1', revision: SPECTRAL_FREEZE_REVISION, configurationKey: spectralFreezeIdentity(entry.spectral),
          parameterData: { hold: 0 }, processorOptions: { parameters: entry.parameters, sourceEpoch: generation } });
      } else if (entry.kind === 'allpass-notch') {
        value = await prepareProcessor(entry, { processorName: 'lemmings-allpass-notch-v1', revision: ALLPASS_NOTCH_REVISION, configurationKey: allpassNotchIdentity(entry.allpass),
          parameterData: { frequencyHz: entry.parameters.baseFrequencyHz, feedback: entry.parameters.feedback, wet: entry.parameters.wet01 }, processorOptions: { parameters: entry.parameters } });
      } else if (entry.kind === 'ring-modulator') {
        value = await prepareProcessor(entry, { processorName: 'lemmings-ring-modulator-v1', revision: RING_MODULATOR_REVISION, configurationKey: ringModulatorIdentity(entry.ring),
          numberOfInputs: 2, inputChannels: 2, outputChannels: 2, processorOptions: { parameters: entry.parameters, sourceEpoch: generation } });
      } else if (entry.kind === 'multiband-vocoder') {
        value = await prepareProcessor(entry, { processorName: 'lemmings-multiband-vocoder-v1', revision: VOCODER_BANK_REVISION, configurationKey: vocoderBankIdentity(entry.vocoder), realizationKey: vocoderRealizationKey(entry.vocoder),
          numberOfInputs: 2, inputChannels: 2, outputChannels: 2, processorOptions: { parameters: entry.parameters, sourceEpoch: generation } });
      } else if (entry.kind === 'envelope-detector' || entry.kind === 'envelope-mapping') {
        const detector = entry.kind === 'envelope-detector';
        value = await prepareProcessor(entry, { processorName: detector ? 'lemmings-envelope-follower-v1' : 'lemmings-envelope-gain-map-v1',
          revision: detector ? ENVELOPE_DETECTOR_REVISION : ENVELOPE_MAPPING_REVISION,
          configurationKey: detector ? envelopeDetectorIdentity(entry.detector) : envelopeMappingIdentity(entry.mapping, context.sampleRate),
          inputChannels: detector && entry.parameters.inputLayout === 'audioStereo' ? 2 : 1, outputChannels: 1,
          processorOptions: { parameters: entry.parameters, sourceEpoch: generation } });
      } else if (entry.kind === 'stereo-to-mono') {
        value = node(context.createGain()); value.channelCount = 1; value.channelCountMode = 'explicit'; value.channelInterpretation = 'speakers';
      } else if (entry.kind === 'mono-to-stereo') {
        value = node(context.createGain()); value.channelCount = 1; value.channelCountMode = 'explicit'; value.channelInterpretation = 'discrete';
        const copy = node(context.createChannelMerger(2)); value.connect(copy, 0, 0); value.connect(copy, 0, 1); outputValue = copy;
      } else if (['feedback-delay', 'nonlinear-chain'].includes(entry.kind)) {
        const p = entry.parameters, nonlinear = entry.kind === 'nonlinear-chain';
        value = await prepareProcessor(entry, { processorName: nonlinear ? 'lemmings-nonlinear-chain-v1' : 'lemmings-bounded-delay-v1', revision: nonlinear ? NONLINEAR_KERNEL_REVISION : DELAY_KERNEL_REVISION,
          configurationKey: nonlinear ? nonlinearChainIdentity(entry.nonlinear) : null,
          parameterData: nonlinear ? { driveDb: p.driveDb, outputTrim01: p.outputTrim01 } : { delayFrames: p.delaySeconds * context.sampleRate, feedback: p.feedback, wet: p.wet01, feedbackLowpassHz: p.feedbackLowpassHz },
          processorOptions: nonlinear ? { parameters: p } : { maxDelayFrames: Math.ceil(p.maxDelaySeconds * context.sampleRate), delayFrames: p.delaySeconds * context.sampleRate,
            transitionFrames: Math.max(2, Math.round(p.transitionSeconds * context.sampleRate)), mode: p.mode, interpolation: p.interpolation, jumpPolicy: p.jumpPolicy, maximumSlew: p.maximumSlew,
            feedback: p.feedback, feedbackMaximum: p.feedbackMaximum, feedbackLowpassHz: p.feedbackLowpassHz, feedbackHighpassHz: p.feedbackHighpassHz, wet: p.wet01 } });
      } else { value = node(context.createGain()); value.gain.setValueAtTime(entry.kind === 'modulated-gain' ? 0 : entry.kind === 'polarity-invert' ? -1 : entry.kind === 'gain' ? entry.parameters.gain01 : 1, context.currentTime); }
      instances.set(entry.id, value); nodeOutputs.set(entry.id, outputValue || value); controls.set(entry.id, Object.freeze({ ...entry.parameters }));
      if (entry.kind === 'gain') gainControls.set(entry.id, createSmoothedAudioParameter({ param: value.gain, initialValue: entry.parameters.gain01, startTime: context.currentTime, smoothingSeconds: 0.008, maxEvents: 128 }));
      if (entry.kind === 'sidechain-in') { sidechainGates.set(entry.id, createSmoothedAudioParameter({ param: value.gain, initialValue: offline ? 1 : 0, startTime: context.currentTime, smoothingSeconds: 0.02, maxEvents: 32 })); value.channelCount = entry.parameters.inputLayout === 'audioMono' ? 1 : 2; value.channelCountMode = 'explicit'; value.channelInterpretation = 'discrete'; sidechainInputs.set(entry.id, value); }
      if (entry.kind === 'bus-in') inputs.set(entry.id, value); if (entry.kind === 'bus-out') outputs.set(entry.id, value);
    }
    const entries = new Map(plan.nodes.map(entry => [entry.id, entry]));
    for (const [edgeIndex, edge] of plan.edges.entries()) {
      const sourcePort = entries.get(edge.from.nodeId).ports.outputs[edge.from.port], targetPort = entries.get(edge.to.nodeId).ports.inputs[edge.to.port];
      const gain = node(context.createGain()); gain.gain.setValueAtTime(edge.gain01, context.currentTime);
      gain.channelCount = sourcePort.channels; gain.channelCountMode = 'explicit'; gain.channelInterpretation = 'discrete';
      nodeOutputs.get(edge.from.nodeId).connect(gain, sourcePort.outputIndex, 0);
      const connect = output => targetPort.parameter ? output.connect(instances.get(edge.to.nodeId)[targetPort.parameter]) : output.connect(instances.get(edge.to.nodeId), 0, targetPort.inputIndex);
      if (edge.alignmentFrames) {
        const align = await prepareProcessor({ id: '@alignment:' + edgeIndex, kind: 'fixed-fractional-delay', offlineActive: audible.has(edge.to.nodeId), stateBytes: (Math.ceil(edge.alignmentFrames) + 2) * 8 }, {
          processorName: 'lemmings-fixed-fractional-delay-v1', revision: ALIGNMENT_KERNEL_REVISION, processorOptions: { delayFrames: edge.alignmentFrames },
          inputChannels: sourcePort.channels, outputChannels: sourcePort.channels,
          configurationKey: fixedFractionalDelayIdentity(context.sampleRate, edge.alignmentFrames) });
        gain.connect(align); connect(align);
      } else connect(gain);
    }
    guard();
  } catch (error) {
    const receipt = dispose(); await receipt.completion;
    if (receipt.outcome !== 'complete') throw Object.assign(failure('effect-retirement-unknown', 'Prepared effect cleanup is unresolved.'), { cause: error, retirement: receipt, retainedGraph: { nodes, processors, context } });
    throw error;
  }
  const update = (nodeId, values, targetFrame = null) => {
    const now = context.currentTime; targetFrame ??= Math.ceil(now * context.sampleRate); guard(); if (disposed || fault || !Number.isSafeInteger(targetFrame) || targetFrame < Math.ceil(now * context.sampleRate) || targetFrame > (now + 1) * context.sampleRate ||
        !values || Object.getPrototypeOf(values) !== Object.prototype || !Object.keys(values).length || Object.keys(values).length > 4) throw failure('invalid-effect-control', 'Effect controls require a bounded owned native frame target.');
    const entry = plan.nodes.find(entry => entry.id === nodeId), next = { ...controls.get(nodeId), ...values }, changes = [];
    if (entry?.kind === 'gain') {
      if (Object.keys(values).some(key => key !== 'gain01') || !Number.isFinite(next.gain01) || next.gain01 < 0 || next.gain01 > entry.parameters.gainMaximum01 || !gainControls.get(nodeId).canInsert(now)) throw failure('invalid-effect-control', 'Gain control exceeds its admitted amplitude or queue domain.');
    } else if (entry?.kind === 'rectangular-membrane') {
      if (processors.find(processor => processor.nodeId === nodeId)?.health?.muted) throw failure('stale-prepared-body', 'This membrane has cleared its energy and requires new preparation.');
      if (Object.keys(values).some(key => !membraneControlValid(key, values[key]))) throw failure('invalid-effect-control', 'Membrane positions and loss require normalized coordinates.');
      for (let index = 0; index < 4; index++) { const key = 'touch' + index, x = membraneControlTarget(key + 'X01', next[key + 'X01'] ?? 0.5), y = membraneControlTarget(key + 'Y01', next[key + 'Y01'] ?? 0.5), radius = membraneControlTarget(key + 'Radius01', next[key + 'Radius01'] ?? 0.12); if ((next[key + 'Amount01'] ?? 0) > 0 && !membraneTouchSupported(entry.parameters.gridSize, x, y, radius)) throw failure('unsupported-touch-position', 'This touch patch has no interior grid support.'); }
      for (const key of Object.keys(values)) { const adapter = parameterControls.get(nodeId)?.get(key); if (!adapter?.canInsert(now)) throw failure('effect-control-capacity', 'Membrane control automation is full.'); changes.push([adapter, values[key]]); }
    } else if (entry?.kind === 'sympathetic-network') {
      if (processors.find(processor => processor.nodeId === nodeId)?.health?.muted) throw failure('effect-body-quarantined', 'Prepare a new shared body after its state was quarantined.');
      if (Object.keys(values).some(key => !['couple01', 'damp01'].includes(key) && (!NETWORK_LOSS_CONTROLS.slice(0, entry.network.lossMasks.length).includes(key) && !(entry.network.pickupGrid && NETWORK_PICKUP_CONTROLS.includes(key)) || !Number.isFinite(values[key]) || values[key] < 0 || values[key] > 1)) || !Number.isFinite(next.couple01) || next.couple01 < 0 || next.couple01 > 1 || !Number.isFinite(next.damp01) || next.damp01 < 0 || next.damp01 > 1) throw failure('invalid-effect-control', 'Shared-body controls exceed their prepared loss or observation domain.');
      for (const [key, name] of [['couple01', 'couple'], ['damp01', 'damp']]) if (values[key] != null) { const adapter = parameterControls.get(nodeId)?.get(name); if (!adapter?.canInsert(now)) throw failure('effect-control-capacity', 'Shared-body automation is full.'); changes.push([adapter, next[key]]); }
      for (const key of [...NETWORK_LOSS_CONTROLS, ...NETWORK_PICKUP_CONTROLS]) if (values[key] != null) { const adapter = parameterControls.get(nodeId)?.get(key); if (!adapter?.canInsert(now)) throw failure('effect-control-capacity', 'Body loss or observation automation is full.'); next[key] = Math.fround(values[key]); changes.push([adapter, next[key]]); }
    } else if (entry?.kind === 'paired-modal-body') {
      if (Object.keys(values).some(key => key !== 'morph01') || !Number.isFinite(values.morph01) || values.morph01 < 0 || values.morph01 > 1 || processors.find(processor => processor.nodeId === nodeId)?.health?.muted) throw failure('invalid-effect-control', 'MORPH requires its active reviewed held body and normalized position.');
      const adapter = parameterControls.get(nodeId)?.get('morph'); if (!adapter?.canInsert(now)) throw failure('effect-control-capacity', 'MORPH automation is full.'); changes.push([adapter, values.morph01]);
    } else if (entry?.kind === 'spectral-freeze') {
      if (Object.keys(values).some(key => key !== 'hold01') || (values.hold01 !== 0 && values.hold01 !== 1)) throw failure('invalid-effect-control', 'Spectral capture is a discrete hold or thaw command.');
      const adapter = parameterControls.get(nodeId)?.get('hold'); if (!adapter?.canInsert(now)) throw failure('effect-control-capacity', 'Spectral capture automation is full.'); changes.push([adapter, values.hold01]);
    } else if (entry?.kind === 'allpass-notch') {
      if (Object.keys(values).some(key => !['baseFrequencyHz', 'feedback', 'wet01'].includes(key)) || !Number.isFinite(next.baseFrequencyHz) || next.baseFrequencyHz < 160 || next.baseFrequencyHz > 1600 || !Number.isFinite(next.feedback) || Math.abs(next.feedback) > entry.parameters.feedbackMaximum || !Number.isFinite(next.wet01) || next.wet01 < 0 || next.wet01 > 1) throw failure('invalid-effect-control', 'Allpass control exceeds its frequency, feedback or mix domain.');
      for (const [key, parameter] of [['baseFrequencyHz', 'frequencyHz'], ['feedback', 'feedback'], ['wet01', 'wet']]) if (values[key] != null) {
        const adapter = parameterControls.get(nodeId)?.get(parameter); if (!adapter?.canInsert(now)) throw failure('effect-control-capacity', 'Allpass automation slots are exhausted.'); changes.push([adapter, next[key]]);
      }
    } else if (entry?.kind === 'feedback-delay') {
      if (Object.keys(values).some(key => !['delaySeconds', 'feedback', 'wet01', 'feedbackLowpassHz'].includes(key)) || !Number.isFinite(next.delaySeconds) || next.delaySeconds < (entry.parameters.interpolation === 'lagrange3' ? 2 : 1) / context.sampleRate || next.delaySeconds > entry.parameters.maxDelaySeconds ||
          !Number.isFinite(next.feedback) || Math.abs(next.feedback) > entry.parameters.feedbackMaximum || !Number.isFinite(next.wet01) || next.wet01 < 0 || next.wet01 > 1 || !Number.isFinite(next.feedbackLowpassHz) || next.feedbackLowpassHz < 200 || next.feedbackLowpassHz > context.sampleRate * 0.4) throw failure('invalid-effect-control', 'Delay control exceeds its admitted range.');
      for (const [key, parameter, factor] of [['delaySeconds', 'delayFrames', context.sampleRate], ['feedback', 'feedback', 1], ['wet01', 'wet', 1], ['feedbackLowpassHz', 'feedbackLowpassHz', 1]]) if (values[key] != null) {
        const adapter = parameterControls.get(nodeId)?.get(parameter); if (!adapter?.canInsert(now)) throw failure('effect-control-capacity', 'This effect parameter has no remaining bounded future automation slots.'); changes.push([adapter, next[key] * factor]);
      }
    } else if (entry?.kind === 'nonlinear-chain') {
      if (Object.keys(values).some(key => !['driveDb', 'outputTrim01'].includes(key)) || !Number.isFinite(next.driveDb) || next.driveDb < 0 || next.driveDb > 24 || !Number.isFinite(next.outputTrim01) || next.outputTrim01 < 0 || next.outputTrim01 > 1) throw failure('invalid-effect-control', 'Nonlinear control exceeds its admitted drive or trim range.');
      for (const key of Object.keys(values)) { const adapter = parameterControls.get(nodeId)?.get(key); if (!adapter?.canInsert(now)) throw failure('effect-control-capacity', 'This nonlinear parameter has no remaining bounded future automation slots.'); changes.push([adapter, next[key]]); }
    } else throw failure('effect-control-unavailable', 'This graph node has no live control adapter.');
    const time = targetFrame / context.sampleRate;
    try {
      if (entry.kind === 'gain') { if (!gainControls.get(nodeId).insert(next.gain01, time, now)) throw failure('effect-control-capacity', 'Effect gain automation could not be admitted.'); }
      else for (const [adapter, amount] of changes) if (!adapter.insert(amount, time, now)) throw failure('effect-control-capacity', 'Effect automation could not be admitted.');
    } catch (caught) {
      if ((entry.membrane || entry.network || entry.pairedBody) && !offline) { const processor = processors.find(processor => processor.nodeId === nodeId); processor.node.port.postMessage({ type: 'panic' }); processor.health = Object.freeze({ muted: true, containment: 'body-only', reason: caught.message }); }
      else { fault = caught; for (const entry of processors) entry.node.port.postMessage({ type: 'panic' }); try { onFault(caught); } catch {} }
      throw failure('effect-control-failed', 'Native effect control scheduling failed.');
    }
    controls.set(nodeId, Object.freeze(next));
    return Object.freeze({ status: 'accepted', stage: 'native-control-submitted', nodeId, targetFrame, sequence: ++controlSequence, graphDefinitionHash: hash, appliedFrame: null, acousticReceipt: false });
  };
  refreshSourcePresence = () => {
    const present = new Map();
    for (const entry of plan.nodes) {
      const incoming = plan.edges.filter(edge => edge.to.nodeId === entry.id), has = port => incoming.some(edge => (!port || edge.to.port === port) && present.get(edge.from.nodeId));
      if (['envelope-detector', 'spectral-freeze'].includes(entry.kind)) processors.find(processor => processor.nodeId === entry.id).node.port.postMessage({ type: 'source-status', sourceEpoch: generation, present: has('audio') });
      if (['multiband-vocoder', 'ring-modulator'].includes(entry.kind)) for (const [port, role] of [['donorAudio', 'donor'], ['carrierAudio', 'carrier']])
        processors.find(processor => processor.nodeId === entry.id).node.port.postMessage({ type: 'source-status', sourceEpoch: generation, role, present: has(port) });
      present.set(entry.id, entry.kind === 'bus-in' || entry.kind === 'sidechain-in' ? entry.kind === 'bus-in' || sidechainBindings.get(entry.id).connected :
        ['feedback-delay', 'nonlinear-chain', 'convolution-native', 'multiband-vocoder', 'ring-modulator', 'allpass-notch', 'spectral-freeze', 'sympathetic-network', 'paired-modal-body', 'rectangular-membrane'].includes(entry.kind) || has(null));
    }
  };
  if (!offline) refreshSourcePresence();
  const gateSidechains = (gain01, time = context.currentTime, seconds = 0.02) => {
    const now = context.currentTime; guard();
    if (disposed || !Number.isFinite(gain01) || gain01 < 0 || gain01 > 1 || !Number.isFinite(time) || time < now || time > now + 1 || !Number.isFinite(seconds) || seconds < 0 || seconds > 0.2 || [...sidechainGates.values()].some(gate => !gate.canInsert(now))) throw failure('sidechain-gate-capacity', 'Sidechain publication requires bounded owned gain ramps.');
    try { for (const gate of sidechainGates.values()) if (!gate.insert(gain01, time, now, seconds)) throw new Error('Sidechain gate queue rejected activation.'); }
    catch (caught) { fault = caught; try { onFault(caught); } catch {} throw failure('sidechain-gate-failed', 'Sidechain gate scheduling failed.'); }
  };
  const activateSidechains = async ({ silent = false } = {}) => {
    if (typeof silent !== 'boolean') throw new TypeError('Invalid sidechain staging mode.');
    guard(); if (disposed || sidechainsActivated) return;
    for (const binding of sidechainBindings.values()) {
      const parameters = plan.nodes.find(entry => entry.id === binding.id).parameters;
      if (!binding.pin && resolveSidechainSource) binding.pin = await resolveSidechainSource(Object.freeze({ ...parameters, owner, generation }));
      guard(); if (disposed) throw failure('stale-sidechain-activation', 'The prepared source route retired before activation.');
      const pin = binding.pin;
      if (!pin) { binding.status = 'missing'; if (parameters.voiceSelection) throw failure('selected-source-unavailable', 'A selected voice has ended or was not admitted locally.'); continue; }
      if (!pin.node?.connect || pin.context !== context || pin.owner !== owner || pin.generation !== generation || pin.sourceBusId !== parameters.sourceBusId ||
          pin.tap !== parameters.tap || pin.layout !== parameters.inputLayout || parameters.voiceSelection && canonicalDataText(pin.voiceSelection).text !== canonicalDataText(parameters.voiceSelection).text || pin.stage !== 'upstream-owner-effects' || typeof pin.release !== 'function' || typeof pin.isActive !== 'function')
        throw failure('sidechain-source-boundary', 'A sidechain pin must identify the exact upstream owner, context, generation, bus, tap and layout.');
      binding.routing = await pin.confirmReady?.({ signal }) || null; guard(); if (disposed) throw failure('stale-sidechain-source', 'Source routing retired during preparation.');
      if (!pin.isActive()) { binding.status = 'stale'; if (parameters.voiceSelection) throw failure('selected-source-unavailable', 'The selected source retired during preparation.'); continue; }
      pin.node.connect(sidechainInputs.get(binding.id)); binding.connected = true; binding.status = 'connected';
      binding.unsubscribe = pin.onUnavailable?.(() => {
        if (!disposed && binding.pin === pin) { try { disconnectSidechain(binding); binding.status = 'missing'; refreshSourcePresence(); } catch (caught) { fault ||= caught; try { onFault(caught); } catch {} } }
      }) || null;
      if (!pin.isActive()) { disconnectSidechain(binding); binding.status = 'stale'; }
    }
    if (!silent) gateSidechains(1, context.currentTime, 0);
    sidechainsActivated = true; refreshSourcePresence();
  };
  const requestInspection = () => {
    if (disposed || context.state !== 'running' || context.currentTime - lastInspectionTime < 0.25) return false;
    lastInspectionTime = context.currentTime;
    for (const binding of sidechainBindings.values()) if (binding.connected && !binding.pin.isActive()) { disconnectSidechain(binding); binding.status = 'stale'; refreshSourcePresence(); }
    for (const entry of processors) entry.node.port.postMessage({ type: 'inspect' });
    return true;
  };
  return Object.freeze({ plan, hash, update, checkPublication, confirmReady, confirmOfflineCompletion, activateSidechains, deactivateSidechains, gateSidechains, requestInspection, getInput: id => disposed ? null : inputs.get(id) || null, getOutput: id => disposed ? null : outputs.get(id) || null,
    getNodeOutput: id => disposed ? null : nodeOutputs.get(id) || null, getSidechainInput: id => disposed ? null : sidechainInputs.get(id) || null,
    isBodyQuarantined: nodeId => processors.find(processor => processor.nodeId === nodeId && ['rectangular-membrane', 'sympathetic-network', 'paired-modal-body'].includes(processor.kind))?.health?.muted === true,
    bodyLossTargets: nodeId => NETWORK_LOSS_CONTROLS.map(key => Math.max(controls.get(nodeId)?.[key] ?? 0, parameterControls.get(nodeId)?.get(key)?.valueAt(context.currentTime) ?? 0)),
    bodyLossFuture: nodeId => NETWORK_LOSS_CONTROLS.map(key => parameterControls.get(nodeId)?.get(key)?.hasFutureEvents(context.currentTime) === true),
    bodyPickupControls: nodeId => Object.fromEntries(NETWORK_PICKUP_CONTROLS.map(key => [key, { target01: controls.get(nodeId)?.[key] ?? parameterControls.get(nodeId)?.get(key)?.valueAt(context.currentTime) ?? 0.5, pendingFuture: parameterControls.get(nodeId)?.get(key)?.hasFutureEvents(context.currentTime) === true }])),
    enqueueBodyStrike(nodeId, command) {
      checkPublication(); const processor = processors.find(entry => entry.nodeId === nodeId && entry.strikes);
      if (!processor || processor.health?.muted) throw failure('stale-prepared-body', 'The exact finite-strike body is unavailable.');
      return processor.strikes.enqueue(command);
    },
    lastBodyDriveFrame: () => Math.max(0, ...processors.map(entry => entry.strikes?.lastDriveFrame() || 0)),
    panicBody(nodeId) {
      const processor = processors.find(processor => processor.nodeId === nodeId && (processor.kind === 'rectangular-membrane' || processor.kind === 'paired-modal-body' || processor.kind === 'sympathetic-network' && (plan.nodes.find(node => node.id === nodeId).network.lossMasks.length || plan.nodes.find(node => node.id === nodeId).network.pickupGrid)));
      if (disposed || !processor) throw failure('stale-prepared-body', 'The named body is unavailable.'); processor.node.port.postMessage({ type: 'panic' }); processor.health = Object.freeze({ muted: true, containment: 'body-only' });
      return Object.freeze({ status: 'accepted', stage: 'body-panic-submitted', nodeId, graphDefinitionHash: hash, appliedFrame: null, acousticReceipt: false });
    },
    panic() { for (const entry of processors) entry.node.port.postMessage({ type: 'panic' }); for (const entry of impulses) if (entry.convolver) entry.convolver.buffer = null; },
    diagnostics: () => Object.freeze({ hash, graphId: plan.definition.id, revision: plan.definition.revision, sampleRate: plan.sampleRate, disposed, fault: fault?.code || null,
      runtime: { pairedBodyRevision: plan.processingRevisions.pairedBody ?? null, membraneRevision: plan.processingRevisions.membrane ?? null, networkRevision: plan.processingRevisions.network ?? null, spectralRevision: plan.processingRevisions.spectral ?? null, allpassRevision: processors.some(entry => entry.kind === 'allpass-notch') ? ALLPASS_NOTCH_REVISION : null, ringRevision: processors.some(entry => entry.kind === 'ring-modulator') ? RING_MODULATOR_REVISION : null, hostRevision: 'owned-native-effect-host-v2', alignmentRevision: plan.processingRevisions.alignment, delayRevision: processors.some(entry => entry.kind === 'feedback-delay') ? DELAY_KERNEL_REVISION : null, nonlinearRevision: processors.some(entry => entry.kind === 'nonlinear-chain') ? NONLINEAR_KERNEL_REVISION : null, detectorRevision: processors.some(entry => entry.kind === 'envelope-detector') ? ENVELOPE_DETECTOR_REVISION : null, envelopeMappingRevision: processors.some(entry => entry.kind === 'envelope-mapping') ? ENVELOPE_MAPPING_REVISION : null, vocoderRevision: processors.some(entry => entry.kind === 'multiband-vocoder') ? VOCODER_BANK_REVISION : null, convolution: impulses.length ? 'browser-native-unpinned-dsp' : null, applicationBuildId: execution.buildId || null, activeExecution: execution.activeExecution },
      initialization: { mode: offline ? 'offline-before-publication' : 'live-before-route', confirmed: offline ? initializationConfirmed : processors.every(entry => entry.ready),
        offlineEndFrame, completionConfirmed: offlineCompletionConfirmed, completionProtocol: offline ? OFFLINE_EFFECT_COMPLETION_REVISION : null },
      processors: processors.map(entry => ({ nodeId: entry.nodeId, kind: entry.kind, revision: entry.revision, stateBytes: entry.stateBytes, configurationKey: entry.configurationKey, ready: entry.ready,
        offlineActive: entry.offlineActive, completion: entry.completion, nonlinearProfile: entry.profile, vocoderProfile: entry.vocoderProfile, health: entry.health, strikes: entry.strikes?.state() || null })),
      sidechainGating: { source: 'owned-API-automation-not-a-render-receipt', gains: [...sidechainGates].map(([id, gate]) => ({ id, gain01: gate.valueAt(context.currentTime) })) },
      sidechains: plan.sidechainInputs.map(id => ({ id, ...plan.nodes.find(entry => entry.id === id).parameters, status: sidechainBindings.get(id).status, sourceRouting: sidechainBindings.get(id).routing || null, connected: sidechainBindings.get(id).connected, faderScope: sidechainBindings.get(id).pin?.faderScope || 'owner-channel', missingPolicy: 'zero-input-detector-release-to-neutral' })),
      impulses: impulses.map(entry => ({ nodeId: entry.nodeId, descriptor: entry.material.descriptor, analysis: entry.material.analysis })),
      controls: Object.fromEntries(controls), controlSequence, controlEvidence: 'native-control-submission-not-applied-acknowledgment',
      processingCost: plan.processingCost, latencyFrames: plan.latencyFrames, maximumTailFrames: plan.maximumTailFrames, stateBytes: plan.stateBytes, protection: 'external-shared-master', qualification: 'implementation-awaiting-full-graph-qualification' }),
    dispose });
}
