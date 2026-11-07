import { createCausalTakeAudioRenderer } from './CausalTakeAudioRender.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ownershipUnknown = error => error?.name === 'ResourceOwnershipError' || ['view-retirement-unknown', 'source-retirement-unknown'].includes(error?.code);
let ordinal = 0;
export function createTakeReadoutComparisonOwner({ journal, resourceBudget, jobs, getCatalog, getMaterialProvider = null, onState = () => {},
  createRenderer = createCausalTakeAudioRenderer, name, schema, code = 'take-comparison-unavailable', buildPlan, verifyReadout = () => {}, describeComparison } = {}) {
  if (!resourceBudget?.reserve || typeof createRenderer !== 'function' || typeof buildPlan !== 'function' || typeof describeComparison !== 'function' || typeof verifyReadout !== 'function' || typeof onState !== 'function' || !name || !schema) throw new TypeError('A take comparison needs its shared owners and bounded readout policy.');
  const fail = message => Object.assign(new Error(name + ': ' + message), { code });
  const ownerId = 'take-readout-comparison-' + (++ordinal), lifetime = createProcgenRetirementScope(), unknown = new Set();
  let active = null, current = null, disposed = false, phase = 'idle', error = null, renderingRole = null;
  const state = () => Object.freeze({ active: !!active, disposed, phase, error, renderingRole, unknownRetirement: unknown.size, prepared: current?.bundle.metadata() ?? null });
  const report = () => { if (!disposed) try { onState(state()); } catch {} };
  const readers = record => record?.bundle?.files.some(file => file.artifact.metadata().activeLeases) ?? false;
  const retire = record => {
    if (record.scope.getReceipt()) return record.scope.getReceipt();
    const producers = record.renderers.map(renderer => Promise.resolve().then(async () => { const receipt = renderer.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('A renderer retains unresolved ownership.'); }));
    const stopped = Promise.all(producers);
    const receipt = record.scope.retire([...producers.map((producer, index) => ({ name: 'comparison-renderer-' + index, run: () => producer })), { name: 'comparison-metadata', run: async () => { await stopped; record.workspace.release(); } }]);
    receipt.completion.then(() => { if (receipt.outcome !== 'complete') { unknown.add(record); phase = 'ownership-unknown'; error = 'Comparison producer or file-reader retirement remains unresolved.'; report(); } });
    return receipt;
  };
  const prepare = (request = {}) => {
    const { takeId, takeRevision, sampleRate = 48000, startSeconds = 0, endSeconds, isCurrent = () => true } = request;
    if (disposed || active || unknown.size || readers(current) || typeof isCurrent !== 'function' || typeof takeId !== 'string' || !takeId || takeId.length > 256 || !Number.isSafeInteger(takeRevision) || takeRevision < 1 || ![44100, 48000, 96000].includes(sampleRate) || !Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds > 120 || endSeconds - startSeconds > 16)
      return Promise.reject(fail('Choose a saved take revision and at most sixteen seconds; retire previous file readers first.'));
    let snapshot, workspace;
    try {
      workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: ownerId, kind: 'comparison-immutable-plan-and-manifests', category: 'candidate', bytes: 8 * 1048576 });
      const { isCurrent: ignored, ...data } = request; void ignored;
      snapshot = JSON.parse(canonicalDataText({ ...data, takeId, takeRevision, sampleRate, startSeconds, endSeconds }, { maxBytes: 262144, maxNodes: 32768 }).text);
    } catch (caught) { if (ownershipUnknown(caught)) unknown.add({ workspace, failure: caught }); try { workspace?.release(); } catch (cleanup) { unknown.add({ workspace, cleanup }); } if (unknown.size) { phase = 'ownership-unknown'; error = String(caught.message).slice(0, 512); report(); } return Promise.reject(caught); }
    const controller = new AbortController(), operation = { controller, promise: null, next: { scope: createProcgenRetirementScope(), workspace, renderers: [], bundle: null } };
    const check = () => { controller.signal.throwIfAborted(); if (disposed || active !== operation || !isCurrent()) throw fail('The take or comparison request changed.'); };
    active = operation; phase = 'preparing-comparison'; error = null; report();
    operation.promise = (async () => {
      let failure;
      try {
        check(); const proposed = await buildPlan(snapshot, { signal: controller.signal, check, ownerId, retainUnknown: failure => { unknown.add({ failure }); } }); check();
        const inventory = canonicalDataText(proposed, { maxBytes: 1048576, maxNodes: 65536 }); workspace.resize(8 * 1048576 + inventory.bytes.length * 4 + inventory.nodes * 64);
        const plan = freezeData(JSON.parse(inventory.text)), variants = plan.variants;
        if (!Array.isArray(variants) || variants.length < 2 || variants.length > 4 || new Set(variants.map(variant => variant.id)).size !== variants.length || variants.some(variant => typeof variant.id !== 'string' || !/^[a-zA-Z0-9._:-]{1,96}$/.test(variant.id) || typeof variant.label !== 'string' || !variant.label || variant.label.length > 256 || !hash(variant.definitionHash) || !variant.input || Object.getPrototypeOf(variant.input) !== Object.prototype)) throw fail('Choose two to four exact bounded readouts.');
        const files = [], readouts = []; let baseline = null, bytes = 0;
        for (const variant of variants) {
          check(); renderingRole = variant.id; phase = 'rendering-' + variant.id; report();
          const renderer = createRenderer({ journal, resourceBudget, jobs, getCatalog, getMaterialProvider, onState: report }); operation.next.renderers.push(renderer);
          const result = await renderer.prepare({ ...variant.input, takeId, takeRevision, sampleRate, startSeconds, endSeconds, restorationMode: 'forward-preroll', signal: controller.signal, isCurrent: () => !disposed && active === operation && isCurrent() }); check();
          const bundle = result.bundle, manifest = bundle?.manifest, file = bundle?.files?.[0];
          const dryTap = manifest?.engineRequirement?.engineId === 'worklet-sine' ? 'complete-sine-graph-pre-master' : 'complete-owned-source-graph-pre-master';
          if (renderer.state().active || renderer.state().unresolvedRetirement || result.receipt?.method !== 'dedicated-worker' || result.receipt.executionIdentity?.activeExecution !== 'bound' || !hash(manifest?.applicationBuildId) || manifest.applicationBuildId !== result.receipt.executionIdentity.buildId || manifest.schema !== 'lemmings-causal-audio-render/v1' || manifest.operation !== 'sound-only-revoice' || manifest.originalRecordMutated !== false || manifest.acousticReceipt !== false || manifest.takeId !== takeId || manifest.takeRevision !== takeRevision || !hash(manifest.sourceCanonicalHash) || manifest.definitionHash !== variant.definitionHash || !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => manifest.engineRequirement?.[key] === variant.engineRequirement?.[key]) || !file?.artifact.metadata().retained || bundle.files.length !== 1 || file.manifest.tap !== (variant.input.effectGraph ? 'complete-owned-effect-graph-pre-master' : dryTap) || !hash(file.manifest.pcmHash) || file.manifest.definitionHash !== variant.definitionHash || file.manifest.sourceCanonicalHash !== manifest.sourceCanonicalHash || !Number.isSafeInteger(manifest.frames) || manifest.frames < 1 || manifest.frames > sampleRate * 20 || manifest.sampleRate !== sampleRate || manifest.timelineZeroSourceFrame !== Math.round(startSeconds * sampleRate) || manifest.exactEndSourceFrame !== Math.round(endSeconds * sampleRate)) throw fail('A readout differs from its admitted source, renderer or frame inventory.');
          await verifyReadout(result, variant, plan, snapshot); check();
          if (file.manifest.frames !== manifest.frames || file.manifest.sampleRate !== sampleRate || manifest.tail.mode === 'exact-crop' && manifest.frames !== Math.round(endSeconds * sampleRate) - Math.round(startSeconds * sampleRate)) throw fail('A readout changed the complete file frame domain.');
          const binding = { takeId, takeRevision, sourceCanonicalHash: manifest.sourceCanonicalHash, applicationBuildId: manifest.applicationBuildId, sampleRate, frames: manifest.frames, timelineZeroSourceFrame: manifest.timelineZeroSourceFrame, exactEndSourceFrame: manifest.exactEndSourceFrame, tail: { mode: manifest.tail.mode, maxSeconds: manifest.tail.maxSeconds } };
          if (baseline && canonicalDataText(binding).text !== canonicalDataText(baseline).text) throw fail('Readouts have different source history, build, crop or tail coordinates.'); baseline ||= binding;
          const metadata = file.artifact.metadata(); if (!Number.isSafeInteger(metadata.byteLength) || metadata.byteLength < manifest.frames * 8 || (bytes += metadata.byteLength) > 64 * 1048576) throw fail('Comparison output exceeds its 64 MiB cap.');
          const artifactHash = await file.artifact.digest(); check(); if (!hash(artifactHash)) throw fail('A readout lacks its immutable file digest.');
          files.push({ ...file, id: variant.id, label: variant.label });
          readouts.push({ id: variant.id, tail: manifest.tail, artifactHash, pcmHash: file.manifest.pcmHash, definitionHash: manifest.definitionHash, engineRequirement: manifest.engineRequirement, ...(variant.sourceReference ? { sourceReference: variant.sourceReference } : {}), ...(manifest.timbreTuningReadout ? { timbreTuningReadout: manifest.timbreTuningReadout } : {}), ...(result.comparison ? { comparison: result.comparison } : {}) });
        }
        const description = await describeComparison({ plan, files, readouts, request: snapshot }); check();
        const manifest = { schema, ...baseline, readouts, outputBytes: bytes, source: 'same-exact-captured-intents;new-isolated-realizations;not-recorded-live-PCM', acousticReceipt: false, quality: 'listening-unqualified', ...description };
        const serialized = canonicalDataText(manifest, { maxBytes: 262144, maxNodes: 32768 }), comparisonHash = await hashData(manifest, { maxBytes: 262144, maxNodes: 32768 }); check();
        const levels = manifest.calibration?.levels;
        if (levels && (!Array.isArray(levels) || levels.length !== files.length || levels.some(level => !Number.isFinite(level) || level <= 0 || level > 1))) throw fail('Preview calibration must be finite attenuation for every actual file.');
        workspace.resize(1048576 + serialized.bytes.length * 8); const record = operation.next;
        record.bundle = Object.freeze({ files: Object.freeze(files.map((file, index) => Object.freeze({ ...file, ...(levels ? { previewGain01: levels[index] } : {}) }))), manifest: freezeData({ ...manifest, comparisonHash }),
          metadata: () => Object.freeze({ comparisonHash, takeId, takeRevision, sourceCanonicalHash: baseline.sourceCanonicalHash, sampleRate, frames: baseline.frames, outputBytes: bytes, discarded: !!record.scope.getReceipt(), readouts: Object.freeze(variants.map(variant => variant.id)), ...(manifest.calibration ? { calibration: manifest.calibration, sourceDefinitionHash: manifest.sourceDefinitionHash, sourceIntentHash: manifest.sourceIntentHash, bodyRevisions: manifest.bodyRevisions } : {}) }), discard: () => { if (current === record) current = null; return retire(record); } });
        check(); if (readers(current)) throw fail('A previous readout gained an active file reader.');
        const previous = current; current = record; phase = 'prepared'; renderingRole = null; report();
        if (previous) { const receipt = retire(previous); await receipt.completion; if (receipt.outcome !== 'complete') { unknown.add(previous); error = 'Previous readout retirement remains unresolved.'; } }
        return record.bundle;
      } catch (caught) { failure = caught; if (ownershipUnknown(caught)) unknown.add({ failure: caught }); }
      const receipt = retire(operation.next); await receipt.completion; if (receipt.outcome !== 'complete') unknown.add(operation.next);
      phase = unknown.size ? 'ownership-unknown' : current ? 'previous-comparison-retained' : 'failed'; renderingRole = null; error = String(failure.message).slice(0, 512); report(); throw failure;
    })(); operation.promise.finally(() => { if (active === operation) active = null; report(); }).catch(() => {}); return operation.promise;
  };
  const cancel = () => { active?.controller.abort(fail('Comparison canceled.')); for (const renderer of active?.next.renderers || []) renderer.cancel(); };
  return Object.freeze({ prepare, state, getPrepared: () => current?.bundle || null, cancel,
    dispose() { if (lifetime.getReceipt()) return lifetime.getReceipt(); disposed = true; cancel(); return lifetime.retire([{ name: 'comparison-work-and-files', run: async () => { await active?.promise.catch(() => {}); if (current) { const receipt = retire(current); await receipt.completion; if (receipt.outcome !== 'complete') unknown.add(current); } if (unknown.size) throw fail('Comparison producers or file readers remain unresolved.'); current = null; } }]); }
  });
}
