import { createNativeSoundSelection } from './NativeSoundSelection.js';
import { planMidiLocalInstrumentMigration, validateMidiLocalInstrumentMigration } from '../../midi/content/MidiLocalInstrumentMigration.js';
import { canonicalDataText } from '../../core/CanonicalData.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope, afterProcgenRetirement } from '../procgen/ProcgenRetirement.js';
const VERSION = 1, REFERENCE_BYTES = 262144, fail = message => Object.assign(new Error(message), { name: 'SoundContentError', code: 'local-instrument-migration' });
let ownerSerial = 0;

export function createMidiLocalInstrumentMigration({ fetch, resourceBudget, jobs, getCatalog } = {}) {
  const owner = 'native-default-migration-' + (++ownerSerial), selection = createNativeSoundSelection({ fetch, resourceBudget, ...(jobs ? { jobs } : {}), ...(getCatalog ? { getCatalog } : {}) }), retirement = createProcgenRetirementScope();
  const operations = new Set(); let disposed = false;
  const prepare = async (project, { signal: externalSignal, isCurrent = () => true } = {}) => {
    if (disposed || operations.size) throw fail('Finish the current native default conversion first.'); externalSignal?.throwIfAborted();
    const plan = planMidiLocalInstrumentMigration(project); if (!plan.entries.length) return Object.freeze({ project, plan, changed: false, receipt: project.localInstrumentMigration || null });
    const references = new Map(), candidates = new Set(), failedReaders = new Set(), controller = new AbortController(), cancel = () => controller.abort(externalSignal.reason);
    const staging = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'bounded-native-default-reference-staging', category: 'audio', bytes: 4096 + new Set(plan.entries.map(row => row.patchId)).size * REFERENCE_BYTES });
    let finish; const operation = { controller, references, completion: new Promise(resolve => { finish = resolve; }) }; operations.add(operation); externalSignal?.addEventListener('abort', cancel, { once: true }); if (externalSignal?.aborted) cancel();
    const check = () => { controller.signal.throwIfAborted(); if (disposed || !isCurrent()) throw fail('The project changed during local sound conversion.'); };
    try {
      for (const row of plan.entries) if (!references.has(row.patchId)) {
        check(); const candidate = await selection.prepare(row.patchId, { signal: controller.signal }); candidates.add(candidate); check();
        canonicalDataText(candidate.reference, { maxBytes: 32768, maxNodes: 1024 }); references.set(row.patchId, candidate.reference);
        const released = candidate.release(); await released.completion;
        if (released.outcome !== 'complete') throw Object.assign(fail('Native default source readers retain unresolved resources.'), { retirement: released });
        candidates.delete(candidate); check();
      }
      const previous = validateMidiLocalInstrumentMigration(project.localInstrumentMigration), liveTracks = new Set(project.tracks.map(track => track.id)), replaced = new Set(plan.entries.map(row => row.trackId));
      const entries = [...(previous?.entries || []).filter(row => liveTracks.has(row.trackId) && !replaced.has(row.trackId)), ...plan.entries.map(row => ({ ...row, revision: references.get(row.patchId).revision, definitionHash: references.get(row.patchId).definitionHash }))];
      const receipt = validateMidiLocalInstrumentMigration({ schema: 'midi-local-instrument-migration/v1', version: VERSION, entries, legacyEnvelopePolicy: plan.legacyEnvelopePolicy, physicalMutation: false, externalProgramChanged: false });
      const byTrack = new Map(plan.entries.map(row => [row.trackId, row])), tracks = project.tracks.map(track => byTrack.has(track.id) ? { ...track, instrumentRef: references.get(byTrack.get(track.id).patchId), instrumentControls: { macros: {} } } : track);
      check(); return Object.freeze({ project: { ...project, tracks, localInstrumentMigration: receipt }, plan, changed: true, receipt });
    } catch (error) { if (error.retirement && error.retirement.outcome !== 'complete') failedReaders.add(error.retirement); throw error; }
    finally {
      externalSignal?.removeEventListener('abort', cancel);
      const sources = createProcgenRetirementScope().retire([...candidates].map((candidate, index) => ({ name: 'native-default-' + index, run: candidate.release })).concat([...failedReaders].map((receipt, index) => ({ name: 'failed-reader-' + index, run: () => receipt }))));
      const released = createProcgenRetirementScope().retire([{ name: 'sources', run: () => sources }, { name: 'staged-references', run: () => afterProcgenRetirement([sources], () => { references.clear(); staging.release(); }) }]);
      await released.completion; if (released.outcome === 'complete') operations.delete(operation); finish(released);
      if (released.outcome !== 'complete') throw Object.assign(fail('Native default source readers retain unresolved resources.'), { retirement: released });
      check();
    }
  };
  return Object.freeze({ prepare, state: () => Object.freeze({ pending: operations.size, disposed }), dispose() {
    if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; for (const operation of operations) operation.controller.abort(fail('Native default conversion retired.'));
    const sources = createProcgenRetirementScope().retire([...operations].map((operation, index) => ({ name: 'conversion-' + index, run: () => operation.completion })));
    return retirement.retire([{ name: 'sources', run: () => sources }, { name: 'selector', run: () => afterProcgenRetirement([sources], () => selection.dispose()) }]);
  } });
}
