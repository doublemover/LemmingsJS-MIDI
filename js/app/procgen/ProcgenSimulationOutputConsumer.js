import { attachProcgenSimulationConsumer } from './ProcgenSimulationConsumer.js';
import { createCausalIntentDispatcher } from './workstation/CausalIntentDispatcher.js';
import { createCausalNativeMidiSink } from './workstation/CausalNativeMidiSink.js';
import { createProcgenRetirementScope } from './ProcgenRetirement.js';
import { simulationFailure } from './ProcgenSimulationProtocol.js';

const complete = async receipt => {
  if (!receipt) return;
  const value = receipt.completion ? await receipt.completion : await receipt;
  if (value === false || value?.outcome && value.outcome !== 'complete') throw simulationFailure('output-retirement-unknown', 'The direct output owner retained unconfirmed execution cleanup.');
};
export function attachProcgenSimulationOutput({ port, manifest, outputs, resourceBudget, onReceipt = () => {}, onFailure = () => {},
  getScoreContext = () => null, allowMainThread = false } = {}) {
  if (typeof document !== 'undefined' && !allowMainThread || !Array.isArray(outputs) || !outputs.length || outputs.length > 4 ||
      outputs.some(output => !Array.isArray(output?.sinks) || typeof output.observe !== 'function' || typeof output.enabled !== 'function' || typeof output.dispose !== 'function'))
    throw new TypeError('Direct simulation output requires prepared backend owners in an independent consumer realm.');
  const scope = createProcgenRetirementScope({ deadlineMs: 15000 }); let disposed = false, failure = null, epoch = null, generation = null, worldId = null,
    tempoBpm = null, safetyRetirement = null, batches = 0, submittedIntents = 0, admissionReceipts = 0, consumer = null;
  const dispatcher = createCausalIntentDispatcher({ resourceBudget, sinks: outputs.flatMap(output => output.sinks), executionEpoch: () => epoch,
    getTempoBpm: () => tempoBpm, toTargetFrame: (score, batch, intent, sink) => sink.toTargetFrame?.(score, batch, intent) ?? null,
    latePolicy: context => context.sink.latePolicy ? context.sink.latePolicy(context) : { status: 'rejected', reason: 'direct-sink-clock-policy-unavailable' },
    onReceipt: receipt => { admissionReceipts++; try { onReceipt(receipt); } catch {} } });
  const fail = error => {
    failure ||= error;
    if (!safetyRetirement && generation !== null) { safetyRetirement = complete(dispatcher.cancelGeneration(generation, epoch)); safetyRetirement.catch(() => {}); }
    try { onFailure(error); } catch {}
  };
  try {
    consumer = attachProcgenSimulationConsumer({ port, manifest, resourceBudget, onFailure: fail, consume: async packet => {
      if (disposed || failure) throw failure || simulationFailure('output-retired', 'The direct output generation retired.');
      const batch = packet.batch, score = packet.scoreTime;
      if (!score || score.simTick !== batch.tick || !Number.isFinite(score.beat) || !Number.isFinite(packet.tempoBpm) || packet.tempoBpm <= 0 || packet.tempoBpm > 1000000)
        throw simulationFailure('output-score-boundary', 'Direct output requires the actual worker score position and tempo for this completed batch.');
      if (packet.bodyCommands.length) throw simulationFailure('output-body-adapter-unavailable', 'This direct output owner cannot apply the declared shared-body commands.');
      if (worldId !== batch.worldId || generation !== batch.generation) {
        if (generation !== null) await complete(dispatcher.cancelGeneration(generation, epoch));
        worldId = batch.worldId; generation = batch.generation; epoch = manifest.ownerId + ':' + manifest.ownerEpoch + ':' + worldId + ':' + generation;
      }
      if (!outputs.some(output => output.enabled())) throw simulationFailure('output-disabled', 'Explicitly prepare and enable the named output before resuming its authoritative simulation.');
      tempoBpm = packet.tempoBpm;
      for (const output of outputs) output.observe(score, { bpm: tempoBpm, executionEpoch: epoch, generation, worldId, batchId: batch.batchId, scoreContext: getScoreContext() });
      const receipts = dispatcher.dispatch(packet.intents, batch);
      for (const output of outputs) await output.flushSourceControls?.(batch);
      batches++; submittedIntents += packet.intents.length;
      const refused = receipts.find(receipt => receipt.status === 'rejected');
      if (refused || packet.intents.length && !receipts.length) throw simulationFailure('output-admission-refused', refused?.reason || 'The required sink did not admit its complete intent packet.');
      return Object.freeze({ accepted: true, stage: 'sink-admission', receipts: receipts.length, renderOrReceiverEvidence: 'separate' });
    } });
  } catch (error) { dispatcher.dispose(); for (const output of outputs) output.dispose(); throw error; }
  return Object.freeze({ state: () => Object.freeze({ disposed, failure: failure?.message || null, epoch, generation, worldId, batches, submittedIntents, admissionReceipts,
    input: consumer.state(), dispatch: dispatcher.diagnostics(), owners: Object.freeze(outputs.map(output => output.diagnostics?.() || null)),
    path: typeof document === 'undefined' ? 'simulation-worker-to-independent-output-owner;no-ui-relay' : 'explicit-main-thread-fallback;ui-stalls-affect-output', acousticEvidence: false }),
  dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; const readers = consumer.dispose(), producers = Promise.resolve(readers).then(async () => {
    if (safetyRetirement) await safetyRetirement;
    const dispatcherResult = await Promise.allSettled([complete(dispatcher.dispose())]);
    const outputResults = await Promise.allSettled(outputs.map(output => Promise.resolve().then(() => complete(output.dispose()))));
    const failures = [...dispatcherResult, ...outputResults].filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Direct output execution or producer retirement remains unresolved.');
  });
  return scope.retire([{ name: 'direct-causal-consumer', run: () => readers }, { name: 'direct-output-executions', run: () => producers }]);
  } });
}
export function attachProcgenNativeSimulationOutput({ routes, getLanes, now, ...options } = {}) {
  if (!routes?.client || typeof getLanes !== 'function' || typeof now !== 'function') throw new TypeError('Native worker output needs its own reviewed connected route/client owner.');
  const output = createCausalNativeMidiSink({ routes, getLanes, now, onReceipt: options.onReceipt });
  return attachProcgenSimulationOutput({ ...options, outputs: [output] });
}
