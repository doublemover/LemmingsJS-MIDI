import { canonicalDataText } from '../../core/CanonicalData.js';
import { prepareSoundContentPack } from '../../midi/content/SoundContentPack.js';
import { generatePatchNeighborhood } from '../../midi/content/PatchNeighborhood.js';
import { revisePatchCandidate } from '../../midi/content/PatchForkRevision.js';
import { findPatchNeighborhood } from '../../midi/content/AuthoredPatchNeighborhoods.js';
import { planPatchComparisonLevels } from '../../midi/content/PatchComparisonLevels.js';
import { createPatchVariationSession } from './PatchVariationSession.js';
import { createNativeSoundSelection } from './NativeSoundSelection.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { createSoundContentRegistry } from './SoundContentRegistry.js';
import { createSoundContentReader } from './SoundContentReader.js';
import { createSoundContentArchiver } from './SoundContentArchive.js';
import { stagePreparedSoundContent } from './SoundContentPreparedStage.js';
import { createCausalTakeAudioRenderer } from './CausalTakeAudioRender.js';
import { createPreparedWavePrelisten } from './PreparedWavePrelisten.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { borrowCausalTake, retireCausalRead } from '../procgen/workstation/CausalReadLeases.js';

let ordinal = 0;
const failure = (code, message) => Object.assign(new Error(message), { name: 'PatchVariationError', code });
const settled = async receipt => {
  const value = await receipt, result = value?.completion ? await value.completion : value;
  if (result === false || result?.outcome && result.outcome !== 'complete') throw failure('retirement-unknown', 'Variation resource retirement is unresolved.');
  return result;
};
const stamp = source => canonicalDataText({ identity: source.identity, takeId: source.takeId || null,
  parent: source.reference ? [source.reference.packHash, source.reference.definitionHash, source.reference.patchId, source.reference.revision] : null }).text;

export function createPatchVariationOwner({ window, audio, resourceBudget, getSource, getJournal, onApply, onReveal = () => {},
  jobs = backgroundJobService, getCatalog = getNativeInstrumentCatalog } = {}) {
  if (!window?.fetch || !resourceBudget || typeof getSource !== 'function' || typeof getJournal !== 'function' || typeof onApply !== 'function') throw new TypeError('Invalid variation integration owner.');
  const ownerId = 'patch-variations-' + (++ordinal), listeners = new Set(), unknown = new Set(), admissions = new WeakMap(), operations = new Set();
  const retirement = createProcgenRetirementScope(), reader = createSoundContentReader({ resourceBudget, jobs }), archiver = createSoundContentArchiver({ resourceBudget, jobs });
  const registry = createSoundContentRegistry({ indexedDB: window.indexedDB, keyRange: window.IDBKeyRange, resourceBudget });
  const native = createNativeSoundSelection({ fetch: window.fetch.bind(window), jobs, resourceBudget, getCatalog });
  const cue = createPreparedWavePrelisten({ audio, resourceBudget, onState: () => publish() });
  let disposed = false, phase = 'idle', error = null, parentLease = null, preparedSource = null, take = null, serial = 0, preparing = null, retained = null;
  let parentRenderer = null, candidateRenderer = null, activeComparison = null, playing = null;
  const identity = () => {
    const source = getSource();
    return { ...source.identity, available: source.available !== false, parentHash: source.reference?.definitionHash || null,
      parentPackHash: source.reference?.packHash || null, takeId: source.takeId || null, takeRevision: take?.takeId === source.takeId ? take.revision : null };
  };
  const publish = () => { if (!disposed) for (const listener of listeners) try { listener(state()); } catch {} };
  const check = (signal, isCurrent) => { signal?.throwIfAborted(); if (disposed || unknown.size || !isCurrent()) throw failure('changed-source', 'The variation source changed or retains unresolved work.'); };
  const compile = async (source, { targets, signal }) => {
    let job = null;
    try {
      const encoded = canonicalDataText(source, { maxBytes: 4 * 1048576, maxNodes: 200000 });
      job = await jobs.compute({ kind: 'compile-sound-content', ownerId, ownerEpoch: serial, sourceRevision: source.pack.origin.contentHash + ':' + source.recipes[0].id,
        inputBytes: encoded.bytes.byteLength, maxBytes: 4 * 1048576, estimatedPeakBytes: 64 * 1048576, deadlineMs: 30000,
        signal, budgetAdapter: resourceBudget, isCurrent: () => !disposed && !signal.aborted, prepareInput: () => source });
      signal.throwIfAborted();
      const prepared = await prepareSoundContentPack(job.value.pack, { engineDescriptors: targets.map(target => target.descriptor), signal });
      if (prepared.contentHash !== job.value.contentHash) throw failure('content-mismatch', 'Compiled variation identity changed.');
      return Object.freeze({ schema: 'lemmings-compiled-sound/v1', compilerRevision: prepared.pack.compilation.compilerRevision,
        sourceHash: job.value.sourceHash, artifacts: prepared.pack.compilation.artifacts, prepared, qualification: job.value.qualification });
    } finally {
      if (job) { job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) { unknown.add(job); throw failure('retirement-unknown', 'Variation compiler result retirement is unresolved.'); } }
    }
  };
  const releaseComparison = record => {
    if (record.scope.getReceipt()) return record.scope.getReceipt();
    const playback = cue.stop();
    const receipt = record.scope.retire([{ name: 'cue', run: () => playback }, { name: 'rendered-pair', run: async () => {
      await settled(playback); await settled(record.parent?.bundle.discard()); await settled(record.candidate?.bundle.discard());
    } }]);
    receipt.completion.then(result => { if (result.outcome !== 'complete') unknown.add(record); if (activeComparison === record) { activeComparison = null; playing = null; } publish(); });
    return receipt;
  };
  const listen = async side => {
    const record = activeComparison;
    if (!record || !['parent', 'candidate'].includes(side)) throw failure('comparison-unavailable', 'Prepare a candidate comparison first.');
    const choice = (record.choiceSerial || 0) + 1; record.choiceSerial = choice;
    const currentChoice = () => activeComparison === record && record.choiceSerial === choice && record.isCurrent();
    check(record.signal, currentChoice); await settled(cue.stop()); check(record.signal, currentChoice);
    const index = side === 'parent' ? 0 : 1, file = record.files[index];
    const result = await cue.play({ file, level01: record.levels.levels[index], isCurrent: currentChoice, onReveal,
      source: { name: side === 'parent' ? 'A · ' + record.source.reference.definition.name : 'B · ' + record.sound.name,
        kind: 'same-take-patch-comparison', revision: String(record.sound.reference.revision), sourceRef: file.manifest.pcmHash } });
    check(record.signal, currentChoice); playing = side; publish(); return result;
  };
  const compare = async ({ candidate: sound, source, signal, isCurrent }) => {
    check(signal, isCurrent);
    if (!source.take || source.take.unavailable) throw failure('reference-coverage-unavailable', source.take?.unavailable || 'Select a finalized captured physical take.');
    const record = { sound, source, signal, isCurrent, parent: null, candidate: null, files: null, levels: null, scope: createProcgenRetirementScope() };
    try {
      const options = { journal: getJournal(), resourceBudget, jobs, getCatalog, getMaterialProvider: () => audio.getSoundMaterialProvider() };
      parentRenderer ||= createCausalTakeAudioRenderer(options); candidateRenderer ||= createCausalTakeAudioRenderer(options);
      const request = { takeId: source.take.takeId, takeRevision: source.take.revision, sampleRate: 48000, startSeconds: 0,
        endSeconds: Math.min(8, source.take.seconds), tail: { mode: 'exact-crop' }, stemLaneIds: [source.identity.laneId], signal, isCurrent };
      record.parent = await parentRenderer.prepare({ ...request, definition: source.reference.definition, materialReference: source.reference }); check(signal, isCurrent);
      record.candidate = await candidateRenderer.prepare({ ...request, definition: sound.reference.definition, materialReference: sound.reference }); check(signal, isCurrent);
      record.files = [record.parent, record.candidate].map(result => result.bundle.files.find(file => file.manifest.laneId === source.identity.laneId));
      if (record.files.some(file => !file)) throw failure('reference-lane-unavailable', 'The saved physical take has no renderable selected-lane stem.');
      record.levels = planPatchComparisonLevels(...record.files.map(file => file.manifest)); activeComparison = record;
      await listen('candidate'); check(signal, isCurrent);
      const admission = Object.freeze({ candidateHash: sound.reference.definitionHash, takeId: source.take.takeId, takeRevision: source.take.revision,
        sourceCanonicalHash: record.files[0].manifest.sourceCanonicalHash, levels: record.levels, pcmHashes: record.files.map(file => file.manifest.pcmHash), acousticReceipt: false });
      admissions.set(admission, { candidateHash: sound.reference.definitionHash, identity: canonicalDataText(source.identity).text });
      return Object.freeze({ admission, release: () => releaseComparison(record) });
    } catch (caught) {
      try { await settled(releaseComparison(record)); } catch (retirementError) { unknown.add(record); throw retirementError; }
      throw caught;
    }
  };
  const keep = async ({ candidate, signal, isCurrent }) => {
    check(signal, isCurrent); let stage = null;
    try {
      const catalog = await getCatalog(); check(signal, isCurrent);
      stage = await stagePreparedSoundContent({ prepared: candidate.compiled.prepared, reader, archiver, engineDescriptors: catalog.descriptors, signal, isCurrent }); check(signal, isCurrent);
      if (stage.metadata().contentHash !== candidate.reference.packHash) throw failure('content-mismatch', 'The saved selection differs from the exact generated candidate.');
      const receipt = await registry.commitStage(stage, { signal, isCurrent }); check(signal, isCurrent);
      return Object.freeze({ ...receipt, reference: candidate.reference, qualification: 'saved-exact-reference;audio-admission-separate' });
    } finally { if (stage) try { await settled(stage.discard()); } catch (caught) { unknown.add(stage); throw caught; } }
  };
  const session = createPatchVariationSession({ getSourceIdentity: identity, generate: options => generatePatchNeighborhood({ ...options, compile }), compare, keep,
    revise: ({ candidate, source, changes, signal, isCurrent }) => revisePatchCandidate({ ...changes, candidate, descriptor: source.descriptor, signal, isCurrent, compile }),
    apply: async ({ candidate, source, admission, signal, isCurrent }) => {
      check(signal, isCurrent); const owned = admissions.get(admission);
      if (!owned || owned.candidateHash !== candidate.reference.definitionHash || owned.identity !== canonicalDataText(source.identity).text) throw failure('admission-unavailable', 'Re-compare this exact candidate and physical take.');
      const result = await onApply({ reference: candidate.reference, definition: candidate.reference.definition }, { signal, isCurrent, laneId: source.identity.laneId });
      await settled(session.stop());
      return result;
    }, onChange: publish });
  const state = () => Object.freeze({ phase, error, take, sourceCurrent: !!preparedSource && canonicalDataText(preparedSource.identity).text === canonicalDataText(identity()).text,
    parentOptions: preparedSource ? { parameters: preparedSource.descriptor.parameters.map(parameter => parameter.id), macros: preparedSource.reference.definition.macros.map(macro => ({ id: macro.id, name: macro.name })) } : null,
    neighborhood: preparedSource ? findPatchNeighborhood(preparedSource.descriptor.engineId) : null,
    session: session.snapshot(), playing: cue.state().playing ? playing : null, comparison: activeComparison ? Object.freeze({ levels: activeComparison.levels, takeId: activeComparison.source.take.takeId,
      takeRevision: activeComparison.source.take.revision, sourceCanonicalHash: activeComparison.files[0].manifest.sourceCanonicalHash,
      pcmHashes: Object.freeze(activeComparison.files.map(file => file.manifest.pcmHash)), candidateHash: activeComparison.sound.reference.definitionHash, selectedSide: playing }) : null,
    unresolvedRetirement: unknown.size, disposed });
  const prepare = async () => {
    if (disposed || unknown.size || operations.size >= 2) throw failure('owner-unavailable', 'Variation preparation is unavailable or busy.');
    preparing?.controller.abort(failure('superseded', 'A newer parent preparation superseded this one.'));
    const source = getSource();
    if (source.available === false || !source.reference) throw failure('parent-unavailable', 'Choose an exact native or installed instrument in the lane before preparing variations.');
    const sourceStamp = stamp(source), operation = { serial: ++serial, controller: new AbortController(), finished: null };
    operations.add(operation); preparing = operation; phase = 'preparing-parent'; error = null; publish();
    const signal = operation.controller.signal, isCurrent = () => preparing === operation && stamp(getSource()) === sourceStamp;
    operation.finished = (async () => {
      let next = null;
      try {
        session.cancel(); await session.drainGeneration(); check(signal, isCurrent);
        retained ||= createOwnedResourceReservation({ budget: resourceBudget, owner: ownerId, kind: 'retained-variation-data', category: 'candidate', bytes: 16 * 1048576 });
        const catalog = await getCatalog(); check(signal, isCurrent);
        const descriptor = catalog.descriptors.find(entry => entry.engineId === source.reference.engineRequirement.engineId && entry.engineVersion === source.reference.engineRequirement.engineVersion);
        if (!descriptor || !findPatchNeighborhood(descriptor.engineId)) throw failure('unsupported-neighborhood', 'This exact instrument has no authored neighborhood.');
        next = await registry.loadPack(source.reference.packHash, { engineDescriptors: catalog.descriptors, signal }); check(signal, isCurrent);
        if (!next) { next = await native.prepare(source.reference.patchId, { signal, includePrepared: true }); check(signal, isCurrent); }
        if (next.prepared.contentHash !== source.reference.packHash) throw failure('parent-revision-unavailable', 'The current catalog differs from the pinned parent. Reopen its exact installed content.');
        let referenceTake = null;
        if (source.takeId) {
          const loan = await borrowCausalTake(getJournal(), source.takeId, { signal });
          try {
            const manifest = loan.value, start = manifest.boundaryState?.sourceTimeMs, end = manifest.stopBoundaryState?.sourceTimeMs;
            const seconds = Number.isFinite(start) && Number.isFinite(end) ? (end - start) / 1000 : null;
            const unavailable = !['finalized', 'partial'].includes(manifest.state) ? 'Finish recording this physical take.' :
              !Number.isFinite(seconds) || seconds <= 0 ? 'The take has no exact source-clock duration.' : !Array.isArray(manifest.boundaryState?.voices) || manifest.boundaryState.voices.length ? 'The take starts with unknown or held voices.' : null;
            referenceTake = Object.freeze({ takeId: manifest.takeId, revision: manifest.revision, seconds, unavailable });
          } finally { try { retireCausalRead(loan); } catch (caught) { unknown.add(loan); throw caught; } }
        }
        check(signal, isCurrent); take = referenceTake;
        const binding = { prepared: next.prepared, reference: source.reference, descriptor, identity: identity(), take: referenceTake };
        await session.bind(binding); check(signal, isCurrent);
        try { await settled(parentLease?.release()); } catch (caught) { if (parentLease) unknown.add(parentLease); throw caught; }
        parentLease = next; next = null; preparedSource = binding; phase = 'ready'; publish(); return state();
      } catch (caught) { if (preparing === operation) { phase = 'unavailable'; error = String(caught.message).slice(0, 1024); publish(); } throw caught; }
      finally { if (next) try { await settled(next.release()); } catch (caught) { unknown.add(next); error = caught.message; }
        operations.delete(operation); if (preparing === operation) preparing = null; publish(); }
    })();
    return operation.finished;
  };
  return Object.freeze({ state, prepare, listen, revealMonitor: onReveal, pin: session.pin, unpin: session.unpin, keep: session.keep, compare: session.compare, apply: session.apply, revise: session.revise,
    generate: options => { if (phase !== 'ready' || preparing) return Promise.reject(failure('parent-unavailable', 'Prepare the current parent before generating.')); return session.generate(options); },
    cancel: session.cancel, stop: session.stop,
    subscribe(listener) { if (listeners.size >= 4) throw failure('listener-capacity', 'Variation observer capacity reached.'); listeners.add(listener); listener(state()); return () => listeners.delete(listener); },
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; preparing?.controller.abort(failure('disposed', 'Variation owner retired.')); session.cancel();
      const actions = createProcgenRetirementScope().retire([{ name: 'session', run: () => session.dispose() }, { name: 'parent-preparations', run: () => Promise.allSettled([...operations].map(operation => operation.finished)) }]);
      return retirement.retire([{ name: 'actions', run: () => actions }, { name: 'owned-resources', run: async () => {
        await settled(actions); await settled(cue.dispose()); await settled(parentRenderer?.dispose()); await settled(candidateRenderer?.dispose());
        await settled(archiver.dispose()); await settled(reader.dispose()); await settled(native.dispose()); await settled(parentLease?.release());
        if (unknown.size) throw failure('retirement-unknown', 'Variation inputs retain unresolved owners.');
        await settled(registry.close()); retained?.release(); listeners.clear(); preparedSource = null; parentLease = null;
      } }]);
    }
  });
}
