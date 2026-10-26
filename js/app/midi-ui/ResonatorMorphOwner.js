import { validateResonatorMorphEndpoint, createResonatorMorphMap, prepareResonatorMorphMap, evaluateResonatorMorph } from '../../midi/content/ResonatorMorph.js';
import { canonicalDataText, freezeData, cloneData, hashData } from '../../core/CanonicalData.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { retireBackgroundResult } from '../resources/ResourceRetirement.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { prepareExportArtifact } from '../export/ExportArtifact.js';

const fail = message => Object.assign(new Error(message), { name: 'ResonatorMorphError', code: 'resonator-morph-unavailable' });
let ownerOrdinal = 0;
export function createResonatorMorphOwner({ resourceBudget, jobs = backgroundJobService, onState = () => {} } = {}) {
  const ownerId = 'resonator-morph-' + (++ownerOrdinal), retirement = createProcgenRetirementScope(), sources = [null, null], pending = new Set(), unknown = new Set(), exports = new Set();
  let revision = 0, sourceRevision = 0, operationOrdinal = 0, disposed = false, active = null, candidate = null, resolved = null, error = null, phase = 'choose-endpoints';
  const state = () => Object.freeze({ revision, sourceRevision, disposed, active: !!active, phase, error, unknownRetirement: unknown.size, endpoints: sources.map(record => record?.value || null), candidate: candidate?.value || null, map: resolved?.value || null, continuousRendererQualified: false });
  const report = () => { if (!disposed) try { onState(state()); } catch {} };
  const reserve = (kind, bytes) => createOwnedResourceReservation({ budget: resourceBudget, owner: ownerId, generation: revision, kind, category: 'candidate', bytes });
  const releaseRecord = record => { if (record) { try { record.workspace.release(); } catch (caught) { record.retirementError = caught; unknown.add(record); throw caught; } record.value = record.prepared = null; } };
  const invalidate = () => { revision++; active?.controller.abort(fail('The endpoint or map draft changed.')); active = null; releaseRecord(candidate); releaseRecord(resolved); candidate = resolved = null; error = null; phase = 'choose-endpoints'; };
  const begin = kind => {
    if (disposed || unknown.size || pending.size >= 4 || sources.some(record => !record?.value)) throw fail('Choose two complete endpoints and settle earlier preparation/retirement first.');
    active?.controller.abort(fail('A newer preparation replaced this request.'));
    const operation = { ordinal: ++operationOrdinal, revision, kind, controller: new AbortController(), workspace: reserve('morph-operation-overlap', 2 * 1048576), result: null, settlement: null, resolve: null };
    operation.settlement = new Promise(resolve => { operation.resolve = resolve; }); pending.add(operation); active = operation; error = null; phase = kind; report(); return operation;
  };
  const check = operation => { operation.controller.signal.throwIfAborted(); if (disposed || active !== operation || operation.revision !== revision) throw fail('The endpoint or map revision changed.'); };
  const finish = operation => {
    try { if (operation.result) { retireBackgroundResult(operation.result); operation.result = null; } operation.workspace.release(); }
    catch (caught) { unknown.add(operation); operation.retirementError = caught; error = caught.message; phase = 'retirement-unknown'; }
    finally { pending.delete(operation); if (active === operation) active = null; operation.resolve(); report(); }
    if (operation.retirementError) throw operation.retirementError;
  };
  const capture = operation => ({ a: sources[0].value, b: sources[1].value, operation });
  const execute = async (kind, task) => {
    const operation = begin(kind);
    try { return await task(operation); }
    catch (caught) { if (!disposed && active === operation) { error = caught.message; phase = operation.controller.signal.aborted ? 'canceled' : 'failed'; } throw caught; }
    finally { finish(operation); }
  };
  return Object.freeze({ state,
    setEndpoint(slot, raw) {
      if (disposed || unknown.size || ![0, 1].includes(slot)) throw fail('The endpoint owner is unavailable.');
      const workspace = reserve('morph-endpoint-and-display-metadata', 1048576); let value;
      try { value = validateResonatorMorphEndpoint(raw); workspace.resize(Math.max(4096, canonicalDataText(value).bytes.length * 12)); }
      catch (caught) { releaseRecord({ workspace }); throw caught; }
      try { invalidate(); releaseRecord(sources[slot]); sources[slot] = { value, workspace }; sourceRevision++; phase = sources.every(record => record?.value) ? 'endpoints-ready' : 'choose-endpoints'; report(); return state(); }
      catch (caught) { releaseRecord({ workspace, value }); throw caught; }
    },
    async importEndpoint(slot, file) {
      if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 65536 || typeof file.text !== 'function') throw fail('Choose an endpoint JSON file of at most 64 KiB.');
      if (disposed || pending.size || active || ![0, 1].includes(slot)) throw fail('Settle the current operation before importing an endpoint.');
      const controller = new AbortController(), ordinal = ++operationOrdinal, boundary = revision; let result = null;
      const workspace = reserve('morph-endpoint-import-overlap', 1048576), operation = { ordinal, revision: boundary, controller, workspace, result: null, settlement: null, resolve: null };
      operation.settlement = new Promise(resolve => { operation.resolve = resolve; }); pending.add(operation); active = operation; phase = 'importing-endpoint'; report();
      try { result = operation.result = await jobs.compute({ kind: 'parse-json', ownerId, ownerEpoch: ordinal, sourceRevision: 'endpoint-file:' + ordinal, inputBytes: file.size, estimatedPeakBytes: 4 * 1048576, maxBytes: 65536, maxNodes: 8192, budgetAdapter: resourceBudget, signal: controller.signal, isCurrent: () => !disposed && active === operation && revision === boundary, prepareInput: () => file.text(controller.signal) }); check(operation); const value = validateResonatorMorphEndpoint(result.value); retireBackgroundResult(result); operation.result = result = null; check(operation); return this.setEndpoint(slot, value); }
      catch (caught) { if (!disposed && active === operation) { phase = 'failed'; error = caught.message; } throw caught; }
      finally { finish(operation); }
    },
    invalidateMap() { if (disposed) return; revision++; active?.controller.abort(fail('The resolved pair draft changed.')); active = null; releaseRecord(resolved); resolved = null; error = null; phase = candidate ? 'candidate-needs-review' : 'endpoints-ready'; report(); },
    setEndpoints(a, b) {
      if (disposed || unknown.size) throw fail('The endpoint owner is unavailable.'); const records = [];
      try { for (const raw of [a, b]) { const record = { workspace: reserve('morph-endpoint-and-display-metadata', 1048576), value: null }; records.push(record); record.value = validateResonatorMorphEndpoint(raw); record.workspace.resize(Math.max(4096, canonicalDataText(record.value).bytes.length * 12)); } invalidate(); for (const old of sources) releaseRecord(old); sources[0] = records[0]; sources[1] = records[1]; sourceRevision++; phase = 'endpoints-ready'; report(); return state(); }
      catch (caught) { for (const record of records) try { releaseRecord(record); } catch {} throw caught; }
    },
    async importProof(file) {
      if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 65536 || typeof file.text !== 'function' || disposed || pending.size || active) throw fail('Choose a bounded original proof file after settling current preparation.');
      const controller = new AbortController(), operation = { ordinal: ++operationOrdinal, revision, controller, workspace: reserve('morph-proof-import-overlap', 2 * 1048576), result: null, settlement: null, resolve: null }; operation.settlement = new Promise(resolve => { operation.resolve = resolve; }); pending.add(operation); active = operation; phase = 'importing-original-proof'; report();
      try { operation.result = await jobs.compute({ kind: 'parse-json', ownerId, ownerEpoch: operation.ordinal, sourceRevision: 'original-proof:' + operation.ordinal, inputBytes: file.size, estimatedPeakBytes: 4 * 1048576, maxBytes: 65536, maxNodes: 8192, budgetAdapter: resourceBudget, signal: controller.signal, isCurrent: () => !disposed && active === operation && operation.revision === revision, prepareInput: () => file.text(controller.signal) }); check(operation); const value = cloneData(operation.result.value, { maxBytes: 65536, maxNodes: 8192 }); if (value.schema !== 'lemmings-resonator-morph-proof-source/v1' || !Array.isArray(value.sources) || value.sources.length !== 2 || await hashData(value.sources[0]) !== value.input?.a?.sourceAssetHash || await hashData(value.sources[1]) !== value.input?.b?.sourceAssetHash) throw fail('The original proof source hashes differ.'); check(operation); retireBackgroundResult(operation.result); operation.result = null; check(operation); this.setEndpoints(value.input.a, value.input.b); return freezeData({ anchors: value.input.anchors, siteCorrespondence: value.input.siteCorrespondence }); }
      catch (caught) { if (!disposed && active === operation) { phase = 'failed'; error = caught.message; } throw caught; }
      finally { finish(operation); }
    },
    analyze({ anchors = [], siteCorrespondence = {} } = {}) { return execute('analyzing-correspondence', async operation => {
      const snapshot = capture(operation), input = freezeData({ a: snapshot.a, b: snapshot.b, anchors: cloneData(anchors), siteCorrespondence: cloneData(siteCorrespondence) }), inputBytes = canonicalDataText(input, { maxBytes: 262144, maxNodes: 32768 }).bytes.length, sourceRevision = await hashData(input); check(operation);
      operation.result = await jobs.compute({ kind: 'analyze-resonator-morph', ownerId, ownerEpoch: operation.ordinal, sourceRevision, inputBytes, estimatedPeakBytes: 16 * 1048576, maxBytes: 262144, maxNodes: 32768, budgetAdapter: resourceBudget, signal: operation.controller.signal, isCurrent: () => !disposed && active === operation && operation.revision === revision, prepareInput: () => input }); check(operation);
      if (operation.result.receipt.method !== 'dedicated-worker' || operation.result.receipt.kind !== 'analyze-resonator-morph' || operation.result.receipt.sourceRevision !== sourceRevision || operation.result.receipt.executionIdentity?.activeExecution !== 'bound') throw fail('Correspondence analysis requires its shared worker owner.');
      const value = cloneData(operation.result.value, { maxBytes: 262144, maxNodes: 32768 }), workspace = reserve('morph-candidate-and-review-metadata', Math.max(4096, canonicalDataText(value).bytes.length * 12));
      try { check(operation); retireBackgroundResult(operation.result); operation.result = null; check(operation); releaseRecord(candidate); releaseRecord(resolved); candidate = { value, workspace }; resolved = null; phase = 'candidate-needs-review'; report(); return value; }
      catch (caught) { releaseRecord({ workspace }); throw caught; }
    }); },
    resolve({ pairs, siteCorrespondence, reviewed, transitionPolicy = 'next-onset-only' } = {}) { return execute('preparing-reviewed-map', async operation => {
      const snapshot = capture(operation), workspace = reserve('resolved-morph-map-and-parameter-preparation', 8 * 1048576);
      try { const value = await createResonatorMorphMap({ a: snapshot.a, b: snapshot.b, pairs: cloneData(pairs), siteCorrespondence: cloneData(siteCorrespondence), reviewed, transitionPolicy }), prepared = await prepareResonatorMorphMap(value, snapshot.a, snapshot.b); check(operation); workspace.resize(Math.max(4096, canonicalDataText({ value, a: snapshot.a, b: snapshot.b }).bytes.length * 16)); check(operation); releaseRecord(resolved); resolved = { value, prepared, workspace }; phase = 'reviewed-map-ready;render-qualification-pending'; report(); return value; }
      catch (caught) { releaseRecord({ workspace }); throw caught; }
    }); },
    referenceSource() { if (disposed || unknown.size || !resolved) throw fail('Prepare a current reviewed map before a control reference.'); return freezeData({ revision, map: resolved.value, a: sources[0].value, b: sources[1].value }); },
    preview(u, sampleRate = 48000) { if (disposed || unknown.size || !resolved || active) throw fail('Prepare the reviewed map before previewing its parameters.'); return evaluateResonatorMorph(resolved.prepared, u, sampleRate); },
    prepareExport() { if (disposed || unknown.size || !resolved || active) throw fail('Prepare the current reviewed map before exporting.'); for (const artifact of exports) if (!artifact.metadata().activeLeases) { artifact.discard(); if (artifact.metadata().budgetState === 'released' || artifact.metadata().budgetState === 'unbudgeted') exports.delete(artifact); } if (exports.size >= 8) throw fail('Earlier map deliveries still retain their bounded reader slots.'); const bytes = canonicalDataText(resolved.value, { maxBytes: 65536, maxNodes: 8192 }).bytes, artifact = prepareExportArtifact({ bytes, immutableSourceRef: 'sha256:' + resolved.value.hash, formatVersion: 'lemmings-resonator-morph-map/v1', mediaType: 'application/json', suggestedFilename: 'resonator-morph-' + resolved.value.hash.slice(0, 12) + '.json', budgetAdapter: resourceBudget }); exports.add(artifact); return artifact; },
    cancel() { active?.controller.abort(fail('Correspondence preparation canceled.')); },
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; active?.controller.abort(fail('Correspondence owner closed.'));
      const settled = Promise.all([...pending].map(operation => operation.settlement));
      return retirement.retire([{ name: 'morph-producers', run: async () => { await settled; if (unknown.size) throw fail('A correspondence producer retains unresolved storage.'); } }, { name: 'morph-metadata', run: async () => { await settled; if (unknown.size) throw fail('Source metadata remains pinned behind unknown producer retirement.'); releaseRecord(candidate); releaseRecord(resolved); for (const source of sources) releaseRecord(source); candidate = resolved = null; sources.fill(null); } },
        { name: 'morph-exports', run: async () => { for (const artifact of exports) { artifact.discard(); await artifact.digest(); const metadata = artifact.metadata(); if (metadata.budgetState === 'failed-or-unknown') throw fail('The independent export payload has unknown reservation retirement.'); } exports.clear(); } }]);
    }
  });
}
