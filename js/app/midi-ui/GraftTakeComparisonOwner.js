import { createCausalTakeAudioRenderer } from './CausalTakeAudioRender.js';
import { prepareGraftComparison } from '../../midi/content/GraftComparison.js';
import { validateSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';

const fail = message => Object.assign(new Error('Graft take comparison: ' + message), { code: 'graft-take-comparison-unavailable' });
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const roles = Object.freeze(['original', 'exciter-only', 'body-only', 'full-graft']);
let ordinal = 0;

// Four ordinary isolated render owners, admitted sequentially. No live audio,
// new worker pool, synthetic backing take or gain normalization belongs here.
export function createGraftTakeComparisonOwner({ journal, resourceBudget, jobs, getCatalog, getMaterialProvider = null, onState = () => {}, createRenderer = createCausalTakeAudioRenderer } = {}) {
  if (!resourceBudget?.reserve || typeof createRenderer !== 'function' || typeof onState !== 'function') throw new TypeError('A graft comparison needs the shared render and resource owners.');
  const ownerId = 'graft-take-comparison-' + (++ordinal), scope = createProcgenRetirementScope(), unknown = new Set();
  let active = null, current = null, disposed = false, serial = 0, phase = 'idle', error = null, renderingRole = null;
  const state = () => Object.freeze({ active: !!active, disposed, phase, error, renderingRole, unknownRetirement: unknown.size, prepared: current?.bundle.metadata() ?? null });
  const report = () => { if (!disposed) try { onState(state()); } catch {} };
  const retire = record => {
    if (record.scope.getReceipt()) return record.scope.getReceipt();
    const producers = record.renderers.map(renderer => Promise.resolve().then(async () => { const receipt = renderer.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('A comparison renderer retains unresolved ownership.'); }));
    const stopped = Promise.all(producers);
    return record.scope.retire([...producers.map((producer, index) => ({ name: 'comparison-renderer-' + index, run: () => producer })), { name: 'comparison-metadata', run: async () => { await stopped; record.workspace?.release(); } }]);
  };
  const readers = record => record?.bundle?.files.some(entry => entry.artifact.metadata().activeLeases) ?? false;
  const prepare = ({ takeId, takeRevision, originalReference, graftReference, sampleRate = 48000, startSeconds = 0, endSeconds, tail = { mode: 'exact-crop' }, isCurrent = () => true } = {}) => {
    if (disposed || active || unknown.size || readers(current) || typeof isCurrent !== 'function' || typeof takeId !== 'string' || !takeId || takeId.length > 256 || !Number.isSafeInteger(takeRevision) || takeRevision < 1 || ![44100, 48000, 96000].includes(sampleRate) || !Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds > 120 || endSeconds - startSeconds > 16)
      return Promise.reject(fail('Choose an exact saved take revision, two explicit instruments and at most sixteen seconds; retire prior file readers first.'));
    let original, graft, savedTail, workspace;
    try {
      workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: ownerId, generation: serial + 1, category: 'candidate', kind: 'comparison-references-manifests-and-hashing', bytes: 8 * 1048576 });
      const copy = reference => freezeData(validateSoundContentReference(JSON.parse(canonicalDataText(reference, { maxBytes: 65536, maxNodes: 8192 }).text)));
      original = copy(originalReference); graft = copy(graftReference);
      savedTail = JSON.parse(canonicalDataText(tail, { maxBytes: 1024, maxNodes: 32 }).text);
      if (!original || !graft || !['exact-crop', 'bounded-natural', 'boundary-release'].includes(savedTail.mode) || Object.keys(savedTail).some(key => !['mode', 'maxSeconds'].includes(key)) || !Number.isFinite(savedTail.maxSeconds ?? 4) || (savedTail.maxSeconds ?? 4) < 0 || (savedTail.maxSeconds ?? 4) > 4) throw fail('Choose explicit pinned instruments and a bounded common tail policy.');
      const frames = Math.round((endSeconds - startSeconds + (savedTail.mode === 'exact-crop' ? 0 : savedTail.maxSeconds ?? 4)) * sampleRate);
      if (frames * 8 * 4 + 4 * 262208 > 64 * 1048576) throw fail('The four output files exceed the shared 64 MiB comparison cap.');
    } catch (failure) { try { workspace?.release(); } catch (releaseError) { unknown.add({ workspace, releaseError }); report(); } return Promise.reject(failure); }
    ++serial; const controller = new AbortController(), operation = { controller, promise: null, next: { scope: createProcgenRetirementScope(), workspace, renderers: [], bundle: null } };
    const check = () => { controller.signal.throwIfAborted(); if (disposed || active !== operation || !isCurrent()) throw fail('The take, instruments or comparison request changed.'); };
    active = operation; phase = 'preparing-comparison'; error = null; report();
    operation.promise = (async () => {
      let failure = null;
      try {
        check();
        for (const reference of [original, graft]) if (await hashData(reference.definition) !== reference.definitionHash) throw fail('An explicit instrument differs from its immutable definition hash.');
        const dry = await prepareGraftComparison(graft.definition, 'exciter-only'), body = await prepareGraftComparison(graft.definition, 'body-only'); check();
        const expectedHashes = [original.definitionHash, dry.comparison.definitionHash, body.comparison.definitionHash, graft.definitionHash], files = [], readouts = []; let baseline = null, bytes = 0;
        for (let index = 0; index < roles.length; index++) {
          check(); renderingRole = roles[index]; phase = 'rendering-' + renderingRole; report();
          const reference = index === 0 ? original : graft, renderer = createRenderer({ journal, resourceBudget, jobs, getCatalog, getMaterialProvider, onState: report }); operation.next.renderers.push(renderer);
          const result = await renderer.prepare({ takeId, takeRevision, definition: reference.definition, materialReference: reference, sampleRate, startSeconds, endSeconds, tail: savedTail, restorationMode: 'forward-preroll', graftComparison: index === 1 || index === 2 ? roles[index] : null, signal: controller.signal, isCurrent: () => !disposed && active === operation && isCurrent() }); check();
          const bundle = result.bundle, manifest = bundle?.manifest, file = bundle?.files?.[0];
          if (renderer.state().active || renderer.state().unresolvedRetirement || result.receipt?.method !== 'dedicated-worker' || result.receipt.executionIdentity?.activeExecution !== 'bound' || manifest?.schema !== 'lemmings-causal-audio-render/v1' || bundle.files.length !== 1 || !file?.artifact.metadata().retained || manifest.takeId !== takeId || manifest.takeRevision !== takeRevision || !hash(manifest.sourceCanonicalHash) || !hash(manifest.applicationBuildId) || manifest.definitionHash !== expectedHashes[index] || manifest.sampleRate !== sampleRate || manifest.timelineZeroSourceFrame !== Math.round(startSeconds * sampleRate) || manifest.exactEndSourceFrame !== Math.round(endSeconds * sampleRate) || manifest.tail?.mode !== savedTail.mode || manifest.tail.maxSeconds !== (savedTail.maxSeconds ?? 4) || !Number.isSafeInteger(manifest.frames) || manifest.frames < 1 || !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => manifest.engineRequirement?.[key] === reference.engineRequirement[key])) throw fail('A readout differs from its admitted take, engine, source definition or frame domain.');
          if (index === 1 || index === 2) { const expected = index === 1 ? dry.comparison : body.comparison; if (canonicalDataText(result.comparison).text !== canonicalDataText(expected).text) throw fail('The dry/body readout lacks its exact source-preserving derivation.'); }
          const binding = { takeId, takeRevision, sourceCanonicalHash: manifest.sourceCanonicalHash, applicationBuildId: manifest.applicationBuildId, sampleRate, frames: manifest.frames, timelineZeroSourceFrame: manifest.timelineZeroSourceFrame, exactEndSourceFrame: manifest.exactEndSourceFrame, tail: { mode: manifest.tail.mode, maxSeconds: manifest.tail.maxSeconds } };
          if (baseline && canonicalDataText(binding).text !== canonicalDataText(baseline).text) throw fail('Comparison readouts have different source history, build, crop or tail coordinates.'); baseline ||= binding;
          const metadata = file.artifact.metadata(); if (!Number.isSafeInteger(metadata.byteLength) || metadata.byteLength < manifest.frames * 8 || (bytes += metadata.byteLength) > 64 * 1048576) throw fail('The actual comparison inventory exceeds its bounded output bytes.');
          const artifactHash = await file.artifact.digest(); check(); if (!hash(artifactHash)) throw fail('A readout lacks its actual immutable file digest.');
          files.push(Object.freeze({ ...file, id: roles[index], label: roles[index] === 'body-only' ? 'Body only · after the same excitation' : roles[index], manifest: file.manifest }));
          readouts.push({ tail: manifest.tail, role: roles[index], artifactHash, bytes: metadata.byteLength, definitionHash: manifest.definitionHash, engineRequirement: manifest.engineRequirement, sourceReference: { packHash: reference.packHash, patchId: reference.patchId, revision: reference.revision, definitionHash: reference.definitionHash }, comparison: result.comparison ?? null });
        }
        const manifest = { schema: 'lemmings-graft-take-comparison/v1', ...baseline, originalDefinitionHash: original.definitionHash, graftDefinitionHash: graft.definitionHash, readouts, outputBytes: bytes, level: 'fixed-authored-gain;no-loudness-normalization', effects: 'dry-sources;no-external-rack', source: 'same-exact-captured-intents;new-isolated-realizations;not-recorded-live-PCM', acousticReceipt: false, quality: 'unqualified-numerical-and-listening-result' }, inventory = canonicalDataText(manifest, { maxBytes: 262144, maxNodes: 8192 }), comparisonHash = await hashData(manifest, { maxBytes: 262144, maxNodes: 8192 }); check();
        operation.next.workspace.resize(1048576 + inventory.bytes.length * 8); const record = operation.next;
        record.bundle = Object.freeze({ files: Object.freeze(files), manifest: freezeData({ ...manifest, comparisonHash }), metadata: () => Object.freeze({ comparisonHash, takeId, takeRevision, sourceCanonicalHash: baseline.sourceCanonicalHash, sampleRate, frames: baseline.frames, outputBytes: bytes, discarded: !!record.scope.getReceipt(), readouts: Object.freeze(roles.slice()) }), discard: () => { if (current === record) current = null; return retire(record); } });
        check(); if (readers(current)) throw fail('A previous comparison gained an active file reader; retain it until that reader retires.');
        const previous = current; current = record; phase = 'prepared'; renderingRole = null; report();
        if (previous) { const receipt = retire(previous); await receipt.completion; if (receipt.outcome !== 'complete') { unknown.add(previous); error = 'The prior comparison retains unresolved ownership.'; } }
        return current.bundle;
      } catch (caught) { failure = caught; }
      const receipt = retire(operation.next); await receipt.completion; if (receipt.outcome !== 'complete') unknown.add(operation.next);
      phase = unknown.size ? 'ownership-unknown' : current ? 'previous-comparison-retained' : 'failed'; renderingRole = null; error = String(failure.message).slice(0, 512); report(); throw failure;
    })(); operation.promise.finally(() => { if (active === operation) active = null; report(); }).catch(() => {}); return operation.promise;
  };
  const cancel = () => { active?.controller.abort(fail('Comparison canceled.')); for (const renderer of active?.next.renderers || []) renderer.cancel(); };
  return Object.freeze({ prepare, state, getPrepared: () => current?.bundle || null, cancel,
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; cancel(); return scope.retire([{ name: 'comparison-work-and-files', run: async () => { await active?.promise.catch(() => {}); if (current) { const receipt = retire(current); await receipt.completion; if (receipt.outcome !== 'complete') unknown.add(current); } if (unknown.size) throw fail('Comparison producers or file readers remain unresolved.'); current = null; } }]); }
  });
}
