import { prepareEffectGraphRevision, effectGraphHash } from '../../midi/content/EffectGraphRevision.js';
import { loadOwnedWorkletModule } from './OwnedWorkletModuleCache.js';
import { DELAY_KERNEL_REVISION } from './worklet/BoundedDelayProcessor.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const delayModule = Object.freeze({ id: 'effect-delay', moduleClass: 'effect', heapEstimate: 65536,
  runtime: Object.freeze({ workletUrl: new URL('./worklet/BoundedDelayProcessor.js', import.meta.url).href }) });
const failure = (code, message) => Object.assign(new Error(message), { name: 'EffectGraphError', code });

// A prepared graph has no connection to a live destination. The owner decides
// when inputs/outputs become audible and owns all transition/tail overlap.
export async function prepareNativeEffectGraph(definition, { context, resources, owner, generation = 0, signal, isCurrent = () => true,
  createWorkletNode = (ctx, name, options) => new globalThis.AudioWorkletNode(ctx, name, options), onFault = () => {}, initializationTimeoutMs = 5000 } = {}) {
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
  const scope = createProcgenRetirementScope({ deadlineMs: initializationTimeoutMs + 1000 }), nodes = [], delays = [], instances = new Map(), inputs = new Map(), outputs = new Map();
  let disposed = false, fault = null;
  const node = value => { nodes.push(value); return value; };
  const dispose = () => scope.retire([{ name: 'effect-native-retirement', run: async () => {
    disposed = true;
    try {
      const results = await Promise.allSettled(delays.map(async entry => {
        if (context.state === 'closed') return;
        entry.node.port.postMessage({ type: 'dispose' }); await entry.waitDisposed();
      }));
      const rejected = results.find(result => result.status === 'rejected'); if (rejected) throw rejected.reason;
      for (const value of nodes) value.disconnect();
      for (const entry of delays) { entry.cleanup(); entry.node.port.onmessage = null; entry.node.onprocessorerror = null; entry.node.port.close(); }
      storage.release();
    } catch (error) { storage.retainUnknown(error); throw error; }
  } }]);

  try {
    if (plan.nodes.some(entry => entry.kind === 'feedback-delay')) { await loadOwnedWorkletModule(context, delayModule, resources); guard(); }
    for (const entry of plan.nodes) {
      guard(); let value;
      if (entry.kind === 'feedback-delay') {
        const p = entry.parameters;
        value = node(createWorkletNode(context, 'lemmings-bounded-delay-v1', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
          parameterData: { delayFrames: p.delaySeconds * context.sampleRate, feedback: p.feedback, wet: p.wet01 },
          processorOptions: { maxDelayFrames: Math.ceil(p.maxDelaySeconds * context.sampleRate), delayFrames: p.delaySeconds * context.sampleRate,
            transitionFrames: Math.max(2, Math.round(p.transitionSeconds * context.sampleRate)), mode: p.mode, maximumSlew: p.maximumSlew,
            feedback: p.feedback, feedbackMaximum: p.feedbackMaximum, feedbackLowpassHz: p.feedbackLowpassHz, feedbackHighpassHz: p.feedbackHighpassHz, wet: p.wet01 } }));
        let resolveReady, rejectReady, resolveDisposed, rejectDisposed, timer = null;
        const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
        const retired = new Promise((resolve, reject) => { resolveDisposed = resolve; rejectDisposed = reject; }); retired.catch(() => {});
        const closed = () => { if (context.state === 'closed') resolveDisposed(); };
        const timeout = () => { const error = failure('effect-initialization-timeout', 'Effect initialization did not acknowledge its source profile.'); rejectReady(error); };
        const abort = () => rejectReady(signal.reason);
        const cleanup = () => { if (timer != null) clearTimeout(timer); context.removeEventListener?.('statechange', closed); signal?.removeEventListener('abort', abort); };
        const delay = { node: value, cleanup, health: null, waitDisposed: () => {
          if (timer != null) clearTimeout(timer);
          return Promise.race([retired, new Promise((_, reject) => { timer = setTimeout(() => reject(failure('effect-retirement-timeout', 'The delay processor did not acknowledge retirement.')), initializationTimeoutMs); })]);
        } }; delays.push(delay);
        context.addEventListener?.('statechange', closed); signal?.addEventListener('abort', abort, { once: true });
        value.port.onmessage = event => {
          const data = event.data;
          if (data?.type === 'disposed') { resolveDisposed(); return; }
          if (data?.type === 'ready') {
            if (data.revision !== DELAY_KERNEL_REVISION || data.sampleRate !== context.sampleRate || data.stateBytes !== entry.stateBytes) rejectReady(failure('effect-abi-mismatch', 'The delay effect runtime differs from its admitted graph.'));
            else resolveReady();
          } else if (data?.type === 'delay-health') delay.health = Object.freeze({ ...data });
        };
        value.onprocessorerror = () => { const error = failure('effect-processor-fault', 'The creative delay processor failed.'); fault = error; rejectReady(error); rejectDisposed(error); try { onFault(error); } catch { /* UI cannot own graph retirement. */ } };
        timer = setTimeout(timeout, initializationTimeoutMs); await ready; clearTimeout(timer); timer = null; signal?.removeEventListener('abort', abort); guard();

      } else { value = node(context.createGain()); value.gain.setValueAtTime(entry.kind === 'gain' ? entry.parameters.gain01 : 1, context.currentTime); }
      instances.set(entry.id, value);
      if (entry.kind === 'bus-in') inputs.set(entry.id, value); if (entry.kind === 'bus-out') outputs.set(entry.id, value);
    }
    for (const edge of plan.edges) {
      const gain = node(context.createGain()); gain.gain.setValueAtTime(edge.gain01, context.currentTime);
      instances.get(edge.from.nodeId).connect(gain);
      if (edge.alignmentFrames) { const align = node(context.createDelay(edge.alignmentFrames / context.sampleRate)); align.delayTime.setValueAtTime(edge.alignmentFrames / context.sampleRate, context.currentTime); gain.connect(align); align.connect(instances.get(edge.to.nodeId)); }
      else gain.connect(instances.get(edge.to.nodeId));
    }
    guard();
  } catch (error) {
    const receipt = dispose(); await receipt.completion;
    if (receipt.outcome !== 'complete') throw Object.assign(failure('effect-retirement-unknown', 'Prepared effect cleanup is unresolved.'), { cause: error, retirement: receipt, retainedGraph: { nodes, delays, context } });
    throw error;
  }
  return Object.freeze({ plan, hash, getInput: id => disposed ? null : inputs.get(id) || null, getOutput: id => disposed ? null : outputs.get(id) || null,
    panic() { for (const entry of delays) entry.node.port.postMessage({ type: 'panic' }); },
    diagnostics: () => Object.freeze({ hash, graphId: plan.definition.id, revision: plan.definition.revision, sampleRate: plan.sampleRate, disposed, fault: fault?.code || null,
      latencyFrames: plan.latencyFrames, maximumTailFrames: plan.maximumTailFrames, stateBytes: plan.stateBytes, protection: 'external-shared-master', qualification: 'implementation-awaiting-full-graph-qualification' }),
    dispose });
}
