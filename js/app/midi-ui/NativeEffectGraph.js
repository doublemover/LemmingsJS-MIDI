import { prepareNativeImpulseMaterial } from './NativeImpulseMaterial.js';
import { getActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { createSmoothedAudioParameter } from './SmoothedAudioParameter.js';
import { prepareEffectGraphRevision, effectGraphHash } from '../../midi/content/EffectGraphRevision.js';
import { loadOwnedWorkletModule } from './OwnedWorkletModuleCache.js';
import { DELAY_KERNEL_REVISION } from './worklet/BoundedDelayProcessor.js';
import { ALIGNMENT_KERNEL_REVISION } from '../../midi/content/EffectRuntimeRevisions.js';
import { fixedFractionalDelayIdentity } from './worklet/FixedFractionalDelayProcessor.js';
import { NONLINEAR_KERNEL_REVISION, nonlinearChainIdentity } from '../../midi/content/NonlinearChainProfile.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const delayModule = Object.freeze({ id: 'effect-delay', moduleClass: 'effect', heapEstimate: 65536,
  runtime: Object.freeze({ workletUrl: new URL('./worklet/BoundedDelayProcessor.js', import.meta.url).href }) });
const failure = (code, message) => Object.assign(new Error(message), { name: 'EffectGraphError', code });

// A prepared graph has no connection to a live destination. The owner decides
// when inputs/outputs become audible and owns all transition/tail overlap.
export async function prepareNativeEffectGraph(definition, { context, resources, owner, generation = 0, signal, isCurrent = () => true,
  getMaterialProvider = null, jobs, createWorkletNode = (ctx, name, options) => new globalThis.AudioWorkletNode(ctx, name, options), onFault = () => {}, initializationTimeoutMs = 5000 } = {}) {
  const guard = () => { signal?.throwIfAborted(); if (!isCurrent() || context?.state === 'closed') throw failure('stale-effect-graph', 'The effect graph request no longer belongs to this context.'); };
  guard();
  if (!context?.createGain || !resources?.reserve || typeof createWorkletNode !== 'function' || typeof onFault !== 'function' ||
      !Number.isSafeInteger(initializationTimeoutMs) || initializationTimeoutMs < 1 || initializationTimeoutMs > 30000) throw new TypeError('Effect graphs need an owned native context and resource budget.');
  const workspace = resources.reserve({ kind: 'effect-graph-preparation', owner, generation, estimateBytes: 2 * 1048576, consumerOwned: true });
  let plan, hash, storage = null, preparationError = null;
  try {
    plan = prepareEffectGraphRevision(definition, { sampleRate: context.sampleRate }); hash = await effectGraphHash(plan); guard();
    storage = resources.reserve({ kind: 'effects-graph', owner, generation, bytes: plan.stateBytes, estimateBytes: plan.nativeNodeEstimateBytes + 1048576, consumerOwned: true });
  } catch (caught) { preparationError = caught; }
  const preparationScope = createProcgenRetirementScope();
  const prepared = preparationScope.retire([{ name: 'effect-preparation-workspace', run: () => workspace.release() },
    { name: 'unused-effect-graph-reservation', run: () => { if (preparationError || preparationScope.getReceipt().resources[0].status !== 'completed') return storage?.release(); } }]);
  if (prepared.outcome !== 'complete') throw Object.assign(failure('effect-preparation-retirement', 'Effect metadata preparation retirement is unresolved.'), { cause: preparationError, retirement: prepared });
  if (preparationError) throw preparationError;
  const scope = createProcgenRetirementScope({ deadlineMs: initializationTimeoutMs + 1000 }), nodes = [], processors = [], impulses = [], instances = new Map(), nodeOutputs = new Map(), inputs = new Map(), outputs = new Map();
  let disposed = false, fault = null, controlSequence = 0;
  const controls = new Map(), gainControls = new Map(), parameterControls = new Map(), execution = getActiveExecutionIdentity('browser-native-audio');
  const node = value => { nodes.push(value); return value; };
  const dispose = () => scope.retire([{ name: 'effect-native-retirement', run: async () => {
    disposed = true;
    try {
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
      storage.release();
    } catch (error) { storage.retainUnknown(error); throw error; }
  } }]);

  const prepareProcessor = async (entry, { processorName, parameterData = {}, processorOptions = {}, revision, configurationKey = null }) => {
    guard();
    const value = node(createWorkletNode(context, processorName, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', parameterData, processorOptions }));
    let resolveReady, rejectReady, resolveDisposed, rejectDisposed, timer = null;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const retired = new Promise((resolve, reject) => { resolveDisposed = resolve; rejectDisposed = reject; }); retired.catch(() => {});
    const closed = () => { if (context.state === 'closed') resolveDisposed(); };
    const timeout = () => { const error = failure('effect-initialization-timeout', 'Effect initialization did not acknowledge its source profile.'); rejectReady(error); };
    const abort = () => rejectReady(signal.reason);
    const cleanup = () => { if (timer != null) clearTimeout(timer); context.removeEventListener?.('statechange', closed); signal?.removeEventListener('abort', abort); };
    const delay = { node: value, nodeId: entry.id, kind: entry.kind, profile: entry.nonlinear || null, revision, cleanup, health: null, waitDisposed: () => {
      if (timer != null) clearTimeout(timer);
      return Promise.race([retired, new Promise((_, reject) => { timer = setTimeout(() => reject(failure('effect-retirement-timeout', 'The effect processor did not acknowledge retirement.')), initializationTimeoutMs); })]);
    } }; processors.push(delay);
    context.addEventListener?.('statechange', closed); signal?.addEventListener('abort', abort, { once: true });
    value.port.onmessage = event => {
      const data = event.data;
      if (data?.type === 'disposed') { resolveDisposed(); return; }
      if (data?.type === 'ready') {
        if (data.revision !== revision || data.sampleRate !== context.sampleRate || data.stateBytes !== entry.stateBytes || configurationKey != null && data.configurationKey !== configurationKey) rejectReady(failure('effect-abi-mismatch', 'The effect runtime differs from its admitted graph.'));
        else resolveReady();
      } else if (['delay-fault', 'effect-fault'].includes(data?.type) && data.revision === revision) { fault ||= failure('effect-state-containment', 'The ' + entry.kind + ' branch cleared excessive or nonfinite internal state.'); try { onFault(fault); } catch {}
      } else if (['delay-health', 'effect-health'].includes(data?.type) && data.revision === revision) delay.health = Object.freeze({ ...data });
    };
    value.onprocessorerror = () => { const error = failure('effect-processor-fault', 'The owned effect processor failed.'); fault = error; rejectReady(error); rejectDisposed(error); try { onFault(error); } catch { /* UI cannot own graph retirement. */ } };
    timer = setTimeout(timeout, initializationTimeoutMs); await ready; clearTimeout(timer); timer = null; signal?.removeEventListener('abort', abort); guard();
    const adapters = new Map(), initial = parameterData;
    for (const [name, initialValue] of Object.entries(initial)) {
      const param = value.parameters.get(name); if (!param?.setValueAtTime || !param.cancelScheduledValues) throw failure('effect-control-unavailable', 'Effect automation lacks bounded native queue replacement.');
      adapters.set(name, createSmoothedAudioParameter({ param, initialValue, startTime: context.currentTime, smoothingSeconds: 0, maxEvents: 128 }));
    } parameterControls.set(entry.id, adapters);

    return value;
  };

  try {
    if (plan.alignmentStateBytes || plan.nodes.some(entry => ['feedback-delay', 'nonlinear-chain'].includes(entry.kind))) { await loadOwnedWorkletModule(context, delayModule, resources); guard(); }
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
      } else if (['feedback-delay', 'nonlinear-chain'].includes(entry.kind)) {
        const p = entry.parameters, nonlinear = entry.kind === 'nonlinear-chain';
        value = await prepareProcessor(entry, { processorName: nonlinear ? 'lemmings-nonlinear-chain-v1' : 'lemmings-bounded-delay-v1', revision: nonlinear ? NONLINEAR_KERNEL_REVISION : DELAY_KERNEL_REVISION,
          configurationKey: nonlinear ? nonlinearChainIdentity(entry.nonlinear) : null,
          parameterData: nonlinear ? { driveDb: p.driveDb, outputTrim01: p.outputTrim01 } : { delayFrames: p.delaySeconds * context.sampleRate, feedback: p.feedback, wet: p.wet01, feedbackLowpassHz: p.feedbackLowpassHz },
          processorOptions: nonlinear ? { parameters: p } : { maxDelayFrames: Math.ceil(p.maxDelaySeconds * context.sampleRate), delayFrames: p.delaySeconds * context.sampleRate,
            transitionFrames: Math.max(2, Math.round(p.transitionSeconds * context.sampleRate)), mode: p.mode, maximumSlew: p.maximumSlew,
            feedback: p.feedback, feedbackMaximum: p.feedbackMaximum, feedbackLowpassHz: p.feedbackLowpassHz, feedbackHighpassHz: p.feedbackHighpassHz, wet: p.wet01 } });
      } else { value = node(context.createGain()); value.gain.setValueAtTime(entry.kind === 'gain' ? entry.parameters.gain01 : 1, context.currentTime); }
      instances.set(entry.id, value); nodeOutputs.set(entry.id, outputValue || value); controls.set(entry.id, Object.freeze({ ...entry.parameters }));
      if (entry.kind === 'gain') gainControls.set(entry.id, createSmoothedAudioParameter({ param: value.gain, initialValue: entry.parameters.gain01, startTime: context.currentTime, smoothingSeconds: 0.008, maxEvents: 128 }));
      if (entry.kind === 'bus-in') inputs.set(entry.id, value); if (entry.kind === 'bus-out') outputs.set(entry.id, value);
    }
    for (const [edgeIndex, edge] of plan.edges.entries()) {
      const gain = node(context.createGain()); gain.gain.setValueAtTime(edge.gain01, context.currentTime);
      nodeOutputs.get(edge.from.nodeId).connect(gain);
      if (edge.alignmentFrames) {
        const align = await prepareProcessor({ id: 'alignment-' + edgeIndex, kind: 'fixed-fractional-delay', stateBytes: (Math.ceil(edge.alignmentFrames) + 2) * 8 }, {
          processorName: 'lemmings-fixed-fractional-delay-v1', revision: ALIGNMENT_KERNEL_REVISION, processorOptions: { delayFrames: edge.alignmentFrames },
          configurationKey: fixedFractionalDelayIdentity(context.sampleRate, edge.alignmentFrames) });
        gain.connect(align); align.connect(instances.get(edge.to.nodeId));
      }
      else gain.connect(instances.get(edge.to.nodeId));
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
    } else if (entry?.kind === 'feedback-delay') {
      if (Object.keys(values).some(key => !['delaySeconds', 'feedback', 'wet01', 'feedbackLowpassHz'].includes(key)) || !Number.isFinite(next.delaySeconds) || next.delaySeconds < 1 / context.sampleRate || next.delaySeconds > entry.parameters.maxDelaySeconds ||
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
    } catch (caught) { fault = caught; for (const entry of processors) entry.node.port.postMessage({ type: 'panic' }); try { onFault(caught); } catch {} throw failure('effect-control-failed', 'Native effect control scheduling failed.'); }
    controls.set(nodeId, Object.freeze(next));
    return Object.freeze({ status: 'accepted', stage: 'native-control-submitted', nodeId, targetFrame, sequence: ++controlSequence, graphDefinitionHash: hash, appliedFrame: null, acousticReceipt: false });
  };
  return Object.freeze({ plan, hash, update, getInput: id => disposed ? null : inputs.get(id) || null, getOutput: id => disposed ? null : outputs.get(id) || null,
    getNodeOutput: id => disposed ? null : nodeOutputs.get(id) || null,
    panic() { for (const entry of processors) entry.node.port.postMessage({ type: 'panic' }); for (const entry of impulses) if (entry.convolver) entry.convolver.buffer = null; },
    diagnostics: () => Object.freeze({ hash, graphId: plan.definition.id, revision: plan.definition.revision, sampleRate: plan.sampleRate, disposed, fault: fault?.code || null,
      runtime: { hostRevision: 'owned-native-effect-host-v1', alignmentRevision: plan.processingRevisions.alignment, delayRevision: processors.some(entry => entry.kind === 'feedback-delay') ? DELAY_KERNEL_REVISION : null, nonlinearRevision: processors.some(entry => entry.kind === 'nonlinear-chain') ? NONLINEAR_KERNEL_REVISION : null, convolution: impulses.length ? 'browser-native-unpinned-dsp' : null, applicationBuildId: execution.buildId || null, activeExecution: execution.activeExecution },
      processors: processors.map(entry => ({ nodeId: entry.nodeId, kind: entry.kind, revision: entry.revision, nonlinearProfile: entry.profile, health: entry.health })),
      impulses: impulses.map(entry => ({ nodeId: entry.nodeId, descriptor: entry.material.descriptor, analysis: entry.material.analysis })),
      controls: Object.fromEntries(controls), controlSequence, controlEvidence: 'native-control-submission-not-applied-acknowledgment',
      latencyFrames: plan.latencyFrames, maximumTailFrames: plan.maximumTailFrames, stateBytes: plan.stateBytes, protection: 'external-shared-master', qualification: 'implementation-awaiting-full-graph-qualification' }),
    dispose });
}
