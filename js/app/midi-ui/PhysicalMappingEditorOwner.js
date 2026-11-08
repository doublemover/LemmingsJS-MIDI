import { canonicalDataText, cloneData, freezeData } from '../../core/CanonicalData.js';
import { captureInstrumentCause, compileInstrumentPerformance, evaluateInstrumentBinding, INSTRUMENT_PHYSICAL_QUANTITIES, validateInstrumentBindings } from '../../midi/content/InstrumentPerformance.js';
import { prepareSoundContentPack } from '../../midi/content/SoundContentPack.js';
import { createSoundContentRegistry } from './SoundContentRegistry.js';
import { createSoundContentReader } from './SoundContentReader.js';
import { createSoundContentArchiver } from './SoundContentArchive.js';
import { stagePreparedSoundContent } from './SoundContentPreparedStage.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { createNativeSoundSelection } from './NativeSoundSelection.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const failure = (code, message) => Object.assign(new Error(message), { code });
const stamp = source => JSON.stringify([source.documentGeneration, source.historyEpoch, source.worldId, source.worldGeneration, source.laneId, source.reference?.packHash, source.reference?.definitionHash]);
const bounds = { maxBytes: 131072, maxNodes: 16384 };
const settle = async raw => {
  const value = await raw, receipt = value?.completion ? await value.completion : value;
  if (receipt === false || receipt?.outcome && receipt.outcome !== 'complete') throw Object.assign(failure('retirement-unknown', 'Mapping resources retain unacknowledged ownership.'), { retirement: receipt });
};
let nextOwner = 0;
export function createPhysicalMappingEditorOwner({ window, resourceBudget, getSource, subscribePhysical, acquireInputLease, onApply, onState = () => {},
  getCatalog = getNativeInstrumentCatalog, jobs = backgroundJobService } = {}) {
  if (!window?.fetch || !resourceBudget || [getSource, subscribePhysical, acquireInputLease, onApply, onState, getCatalog].some(value => typeof value !== 'function'))
    throw new TypeError('The mapping editor needs an exact source, physical observation lease and canonical Apply owner.');
  const id = 'physical-mappings-' + (++nextOwner), registry = createSoundContentRegistry({ indexedDB: window.indexedDB, keyRange: window.IDBKeyRange, resourceBudget }),
    reader = createSoundContentReader({ resourceBudget, jobs }), archiver = createSoundContentArchiver({ resourceBudget, jobs }),
    native = createNativeSoundSelection({ fetch: window.fetch.bind(window), jobs, resourceBudget, getCatalog }), scope = createProcgenRetirementScope();
  const quantities = new Map(INSTRUMENT_PHYSICAL_QUANTITIES.map(value => [value.id, value])), latest = new Map(), rangeReview = new Set();
  let disposed = false, unknown = null, phase = 'idle', source = null, descriptor = null, parent = null, bindings = [], serial = 0, sequence = 0, metadata = null,
    operation = null, listener = null, learning = null, lastError = null, lastCommit = null, observationOmitted = 0, bindingView = null, bindingViewSerial = -1,
    parentRetirement = Promise.resolve();
  const publish = () => { try { onState(); } catch {} };
  const isCurrent = () => {
    if (disposed || unknown || !source) return false; const current = getSource();
    return current.available !== false && current.reference === source.reference && stamp(current) === source.stamp;
  };
  const check = signal => { signal?.throwIfAborted(); if (!isCurrent()) throw failure('mapping-source-stale', 'The selected lane, world or pinned instrument changed. The current sound is preserved.'); };
  const cancelLearn = (reason = 'canceled') => {
    const previous = learning; learning = null;
    if (previous) { window.clearTimeout(previous.timer); previous.lease.release(); lastError = reason; publish(); }
  };
  const observe = batch => {
    if (!isCurrent()) { cancelLearn('The original mapping target changed.'); return; }
    if (batch.worldId !== source.worldId || batch.generation !== source.worldGeneration) return;
    let inspected = 0;
    for (const fact of batch.facts) {
      if (++inspected > 4096) { observationOmitted++; cancelLearn('Physical observation coverage was capped; the candidate is unavailable.'); break; }
      if (fact.kind === 'ActorTerminated') {
        for (const value of latest.values()) if (value.actorId === fact.actorId) value.terminated = true;
        if (learning?.candidate?.actorId === fact.actorId || learning?.actorId === fact.actorId) cancelLearn('The learned actor ended before acceptance.');
        continue;
      }
      if (fact.laneId !== source.laneIndex) continue;
      const cause = captureInstrumentCause(fact); if (!cause) continue;
      for (const [payloadField, quantity] of Object.entries(cause.values)) {
        const quantityId = cause.sourceKind + '.' + payloadField;
        const sample = { quantityId, sourceKind: cause.sourceKind, payloadField, value: quantity.value, unit: quantity.unit,
          evidence: 'live-completed-physical-fact', eventId: fact.eventId, actorId: fact.actorId, worldId: batch.worldId, generation: batch.generation,
          tick: batch.tick, sourceTimeMs: batch.sourceTimeMs, terminated: false };
        latest.set(quantityId, sample);
        const learn = learning;
        if (!learn || learn.quantityId !== quantityId || learn.actorId !== null && learn.actorId !== fact.actorId || !learn.lease.isCurrent()) continue;
        if (learn.candidate && learn.candidate.actorId !== fact.actorId) continue;
        learn.count++; learn.minimum = Math.min(learn.minimum, sample.value); learn.maximum = Math.max(learn.maximum, sample.value);
        if (!learn.candidate) learn.candidate = Object.freeze({ ...sample });
      }
    }
    publish();
  };
  const prepare = async () => {
    if (disposed || unknown || operation) throw failure('mapping-owner-busy', 'Mapping preparation is unavailable or busy.');
    const captured = getSource();
    if (!captured.reference || captured.available === false) throw failure('mapping-source-unavailable', 'Select a supported pinned lane instrument first.');
    if (source && parent && stamp(captured) === source.stamp && phase === 'ready') { listener ||= subscribePhysical(observe); return state(); }
    const keepDraft = !!source && stamp(captured) === source.stamp && phase === 'ready';
    cancelLearn(); listener?.(); listener = null;
    source = { ...captured, stamp: stamp(captured) }; phase = 'preparing'; lastError = null;
    if (!keepDraft) { bindings = cloneData(source.reference.definition.causalBindings || [], bounds); rangeReview.clear(); serial++; }
    metadata ||= createOwnedResourceReservation({ budget: resourceBudget, owner: id, kind: 'mapping-drafts-and-source-observations', category: 'candidate', bytes: 2 * 1048576 });
    const controller = new AbortController(), current = { controller, completion: null }; operation = current; publish();
    current.completion = (async () => {
      try {
        await parentRetirement; check(controller.signal);
        if (parent) { const previous = parent; parent = null; await settle(previous.release()); }
        const catalog = await getCatalog(); check(controller.signal);
        descriptor = catalog.descriptors.find(value => value.engineId === source.reference.engineRequirement.engineId &&
          value.artifactHash === source.reference.engineRequirement.artifactHash && value.parameterSchemaHash === source.reference.engineRequirement.parameterSchemaHash);
        if (!descriptor) throw failure('mapping-engine-unavailable', 'The exact executing engine and parameter schema are unavailable.');
        if (descriptor.capabilities?.causalBindings !== true) throw failure('mapping-adapter-unavailable', 'This exact renderer has no admitted typed physical-binding adapter.');
        parent = await registry.loadPack(source.reference.packHash, { engineDescriptors: catalog.descriptors, signal: controller.signal }); check(controller.signal);
        if (!parent) {
          const prepared = await native.prepare(source.reference.patchId, { signal: controller.signal, includePrepared: true });
          parent = prepared; check(controller.signal);
          if (prepared.prepared.contentHash !== source.reference.packHash) { parent = null; await settle(prepared.release()); throw failure('mapping-parent-unavailable', 'Install the exact parent sound pack before editing its mappings.'); }
        }
        latest.clear();
        listener?.(); listener = subscribePhysical(observe); phase = 'ready'; return state();
      } catch (error) { phase = 'unavailable'; lastError = error.message; throw error; }
      finally { if (operation === current) operation = null; publish(); }
    })(); return current.completion;
  };
  const edit = raw => {
    check(); if (operation) throw failure('mapping-owner-busy', 'Finish the current preparation before editing a mapping.');
    if (!descriptor || phase !== 'ready') throw failure('mapping-owner-not-ready', 'The exact target schema must be ready before editing.');
    const next = cloneData(raw, bounds); if (!Array.isArray(next) || next.length > 64) throw failure('mapping-inventory-capacity', 'Use at most 64 stable mapping rows.');
    if (learning) cancelLearn('The mapping draft changed.');
    for (const binding of next) {
      const previous = bindings.find(value => value.id === binding.id);
      if (!previous || previous.sourceKind !== binding.sourceKind || previous.payloadField !== binding.payloadField || previous.unit !== binding.unit) rangeReview.add(binding.id);
      else if (previous.inputMin !== binding.inputMin || previous.inputMax !== binding.inputMax) rangeReview.delete(binding.id);
    }
    for (const id of rangeReview) if (!next.some(binding => binding.id === id)) rangeReview.delete(id);
    bindings = next; serial++; lastError = null; publish();
  };
  const inspect = bindingId => {
    const binding = bindings.find(value => value.id === bindingId); if (!binding || !descriptor) return null;
    try {
      const validated = validateInstrumentBindings([binding], descriptor.parameters)[0], sample = latest.get(validated.sourceKind + '.' + validated.payloadField), schema = descriptor.parameters.find(value => value.id === binding.target);
      const curve = Array.from({ length: 65 }, (_, index) => { const input = validated.inputMin + (validated.inputMax - validated.inputMin) * index / 64; return Object.freeze({ input, output: evaluateInstrumentBinding(validated, input).mappedValue }); });
      const cause = sample && !sample.terminated ? { sourceKind: sample.sourceKind, eventId: sample.eventId, evidence: 'completed-world-fact', values: { [sample.payloadField]: { value: sample.value, unit: sample.unit } } } : null;
      const performance = compileInstrumentPerformance({ ...source.reference.definition, causalBindings: validateInstrumentBindings(bindings, descriptor.parameters) }, descriptor.parameters);
      const identity = cause ? { worldId: sample.worldId, generation: sample.generation, actorId: sample.actorId, performanceCause: cause } : null;
      const resolved = performance.resolve(getSource().controls || source.controls || {}, 0, identity);
      return Object.freeze({ valid: true, source: sample ? Object.freeze({ ...sample }) : null, curve: Object.freeze(curve), curveEvidence: 'hypothetical-engine-transform;no-audio-or-world-output',
        unit: schema.unit, baseValue: source.reference.definition.parameters[binding.target] ?? schema.default, hypotheticalEffectiveValue: resolved.values[binding.target],
        contributions: Object.freeze(resolved.deltas.filter(delta => delta.parameterId === binding.target)), bindingOutcomes: resolved.bindingOutcomes,
        rangeReviewRequired: rangeReview.has(binding.id), compositionOrder: 'macro-replacements-then-macro-ID;authored-variation;onset-physical-binding-ID;continuous-physical-binding-ID;final-parameter-clamp',
        runtimeEvidence: 'hypothetical-application-of-current-authored-controls-and-last-observed-source;not-an-applied-target-receipt' });
    } catch (error) { return Object.freeze({ valid: false, reason: error.message }); }
  };
  const armLearn = (bindingId, quantityId, actorId = null) => {
    check(); cancelLearn(); const binding = bindings.find(value => value.id === bindingId), quantity = quantities.get(quantityId);
    if (!binding || !quantity || operation || actorId !== null && (!Number.isSafeInteger(actorId) || actorId < 0)) throw failure('mapping-learn-target-invalid', 'Choose an actual typed quantity and stable target before Learn.');
    const target = descriptor?.parameters.find(value => value.id === binding.target);
    if (!target || target.discrete || binding.mode === 'continuous' && !target.causalLiveSafe) throw failure('mapping-learn-target-invalid', 'The named target does not support this binding policy.');
    const lease = acquireInputLease({ laneId: source.laneId, definitionHash: source.reference.definitionHash, targetId: binding.target, worldId: source.worldId, generation: source.worldGeneration },
      reason => cancelLearn(reason));
    const learn = { bindingId, quantityId, actorId, lease, count: 0, minimum: Infinity, maximum: -Infinity, candidate: null, timer: null };
    learning = learn; learn.timer = window.setTimeout(() => { if (learning === learn) cancelLearn('No accepted observation within the 30 second window; the target is unchanged.'); }, 30000); publish();
  };
  const acceptLearn = ({ actorScoped = true } = {}) => {
    check(); const learn = learning, candidate = learn?.candidate;
    if (!candidate || !learn.lease.isCurrent() || candidate.terminated || actorScoped && !Number.isSafeInteger(candidate.actorId)) throw failure('mapping-learn-stale', 'Observe and review one current scoped physical source first.');
    const current = bindings.find(value => value.id === learn.bindingId); if (!current) throw failure('mapping-learn-stale', 'The named mapping row was removed.');
    const next = { ...current, sourceKind: candidate.sourceKind, payloadField: candidate.payloadField, unit: candidate.unit,
      sourceScope: actorScoped ? { kind: 'actor', worldId: candidate.worldId, generation: candidate.generation, actorId: candidate.actorId } : { kind: 'voice-owner' } };
    if (current.unit !== candidate.unit) rangeReview.add(current.id);
    cancelLearn(); bindings = bindings.map(value => value.id === next.id ? next : value); serial++; publish(); return next;
  };
  const commit = async () => {
    check(); if (operation || rangeReview.size) throw failure('mapping-not-ready', 'Finish preparation and review every changed input-unit range before Apply.');
    validateInstrumentBindings(bindings, descriptor.parameters); cancelLearn();
    const controller = new AbortController(), current = { controller, completion: null }; operation = current; phase = 'committing'; publish();
    current.completion = (async () => {
      let job = null, stage = null;
      try {
        const input = { schema: 'lemmings-physical-mapping-revision-request/v1', pack: parent.prepared.pack, reference: source.reference, bindings };
        const encoded = canonicalDataText(input, { maxBytes: 4 * 1048576, maxNodes: 200000 });
        job = await jobs.compute({ kind: 'compile-sound-content', ownerId: id, ownerEpoch: ++sequence, sourceRevision: source.reference.definitionHash + ':' + serial,
          inputBytes: encoded.bytes.byteLength, maxBytes: 4 * 1048576, estimatedPeakBytes: 64 * 1048576, deadlineMs: 30000,
          signal: controller.signal, budgetAdapter: resourceBudget, isCurrent, prepareInput: () => input }); check(controller.signal);
        if (job.value.state === 'unchanged') { phase = 'ready'; return job.value.reference; }
        const catalog = await getCatalog(); check(controller.signal);
        const prepared = await prepareSoundContentPack(job.value.pack, { engineDescriptors: catalog.descriptors, signal: controller.signal }); check(controller.signal);
        if (prepared.contentHash !== job.value.contentHash || prepared.patches[0].definitionHash !== job.value.reference.definitionHash) throw failure('mapping-result-unbound', 'The worker mapping revision changed its immutable identity.');
        stage = await stagePreparedSoundContent({ prepared, reader, archiver, engineDescriptors: catalog.descriptors, signal: controller.signal, isCurrent }); check(controller.signal);
        const saved = await registry.commitStage(stage, { signal: controller.signal, isCurrent }); check(controller.signal);
        lastCommit = Object.freeze({ reference: job.value.reference, storage: saved, liveAdmission: 'pending' });
        await onApply({ reference: job.value.reference, definition: prepared.patches[0].archivedDefinition }, { signal: controller.signal, isCurrent });
        lastCommit = Object.freeze({ ...lastCommit, liveAdmission: 'committed' }); phase = 'committed'; return job.value.reference;
      } catch (error) {
        if (error.backgroundRetirementCompletion) error.backgroundRetirement = await error.backgroundRetirementCompletion;
        if (error.backgroundRetirement && !['released', 'canceled'].includes(error.backgroundRetirement.phase)) unknown = error;
        lastError = error.message; phase = unknown ? 'retirement-unknown' : 'ready'; throw error;
      }
      finally {
        try {
          if (stage) await settle(stage.discard());
          if (job) { job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) throw failure('retirement-unknown', 'The mapping worker result remains owned.'); }
        } catch (error) { unknown = error; phase = 'retirement-unknown'; throw error; }
        finally { if (operation === current) operation = null; publish(); }
      }
    })(); return current.completion;
  };
  const state = () => {
    if (bindingViewSerial !== serial) { bindingView = freezeData(cloneData(bindings, bounds)); bindingViewSerial = serial; }
    return Object.freeze({ phase, current: isCurrent(), laneId: source?.laneId || null, laneName: source?.laneName || null,
      definitionHash: source?.reference?.definitionHash || null, serial, bindings: bindingView,
      parameters: descriptor?.parameters || Object.freeze([]), parameterSchemaHash: descriptor?.parameterSchemaHash || null, quantities: INSTRUMENT_PHYSICAL_QUANTITIES, observations: Object.freeze([...latest.values()].map(value => Object.freeze({ ...value }))),
      learning: learning ? Object.freeze({ bindingId: learning.bindingId, quantityId: learning.quantityId, actorId: learning.actorId, candidate: learning.candidate,
        observations: learning.count, minimum: Number.isFinite(learning.minimum) ? learning.minimum : null, maximum: Number.isFinite(learning.maximum) ? learning.maximum : null,
        rangeCoverage: 'observed-window-only;not-global-range-calibration' }) : null, rangeReview: Object.freeze([...rangeReview]), observationOmitted, error: lastError, lastCommit });
  };
  return Object.freeze({ prepare, edit, inspect, armLearn, cancelLearn, acceptLearn, commit, state,
    keepListening() { if (learning) { learning.candidate = null; learning.count = 0; learning.minimum = Infinity; learning.maximum = -Infinity; publish(); } },
    reset() { check(); if (operation) throw failure('mapping-owner-busy', 'Finish the current preparation before discarding its draft.'); cancelLearn();
      bindings = cloneData(source.reference.definition.causalBindings || [], bounds); rangeReview.clear(); serial++; publish(); },
    confirmRange(bindingId) { rangeReview.delete(bindingId); publish(); },
    suspend(reason = 'Mapping editor closed.') {
      const running = operation; running?.controller.abort(failure('mapping-canceled', reason)); cancelLearn(reason); listener?.(); listener = null; latest.clear();
      parentRetirement = parentRetirement.then(async () => { if (running) await Promise.allSettled([running.completion]); const previous = parent; parent = null; if (previous) await settle(previous.release()); });
      parentRetirement.catch(error => { unknown = error; lastError = error.message; phase = 'retirement-unknown'; publish(); });
    },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; operation?.controller.abort(); cancelLearn(); listener?.(); listener = null;
      return scope.retire([{ name: 'mapping-producer', run: async () => { if (operation) await Promise.allSettled([operation.completion]); if (unknown) throw unknown; } },
        { name: 'mapping-parent', run: async () => { await parentRetirement; if (operation) await Promise.allSettled([operation.completion]); if (parent) await settle(parent.release()); parent = null; } },
        { name: 'mapping-archive-readers', run: () => reader.dispose() }, { name: 'mapping-archive-producer', run: () => archiver.dispose() },
        { name: 'mapping-catalog-producer', run: () => native.dispose() }, { name: 'mapping-storage', run: () => registry.close() },
        { name: 'mapping-metadata', run: async () => { await parentRetirement; if (operation) await Promise.allSettled([operation.completion]); if (unknown) throw unknown;
          bindings = []; bindingView = null; source = null; descriptor = null; lastCommit = null; latest.clear(); rangeReview.clear(); metadata?.release(); } }]); }
  });
}
