import { createNativeSoundSelection } from './NativeSoundSelection.js';
import { planMidiLocalInstrumentMigration, validateMidiLocalInstrumentMigration } from '../../midi/content/MidiLocalInstrumentMigration.js';
import { createProcgenRetirementScope, afterProcgenRetirement } from '../procgen/ProcgenRetirement.js';
const VERSION = 1, fail = message => Object.assign(new Error(message), { name: 'SoundContentError', code: 'local-instrument-migration' });

export function createMidiLocalInstrumentMigration({ fetch, resourceBudget, jobs, getCatalog } = {}) {
  const selection = createNativeSoundSelection({ fetch, resourceBudget, ...(jobs ? { jobs } : {}), ...(getCatalog ? { getCatalog } : {}) }), retirement = createProcgenRetirementScope();
  const operations = new Set(); let disposed = false;
  const prepare = async (project, { signal: externalSignal, isCurrent = () => true } = {}) => {
    if (disposed || operations.size) throw fail('Finish the current native default conversion first.'); externalSignal?.throwIfAborted();
    const plan = planMidiLocalInstrumentMigration(project); if (!plan.entries.length) return Object.freeze({ project, plan, changed: false, receipt: project.localInstrumentMigration || null });
    const controller = new AbortController(), cancel = () => controller.abort(externalSignal.reason), candidates = [], retiredCandidates = createProcgenRetirementScope();
    let finish; const operation = { controller, completion: new Promise(resolve => { finish = resolve; }) }; operations.add(operation); externalSignal?.addEventListener('abort', cancel, { once: true });
    const check = () => { controller.signal.throwIfAborted(); if (disposed || !isCurrent()) throw fail('The project changed during local sound conversion.'); };
    const release = () => retiredCandidates.retire(candidates.map((candidate, index) => ({ name: 'native-default-' + index, run: candidate.release })));
    try {
      const references = new Map();
      for (const row of plan.entries) if (!references.has(row.patchId)) { check(); const candidate = await selection.prepare(row.patchId, { signal: controller.signal }); candidates.push(candidate); check(); references.set(row.patchId, candidate.reference); }
      const previous = validateMidiLocalInstrumentMigration(project.localInstrumentMigration), liveTracks = new Set(project.tracks.map(track => track.id)), replaced = new Set(plan.entries.map(row => row.trackId));
      const entries = [...(previous?.entries || []).filter(row => liveTracks.has(row.trackId) && !replaced.has(row.trackId)), ...plan.entries.map(row => ({ ...row, revision: references.get(row.patchId).revision, definitionHash: references.get(row.patchId).definitionHash }))];
      const receipt = validateMidiLocalInstrumentMigration({ schema: 'midi-local-instrument-migration/v1', version: VERSION, entries, legacyEnvelopePolicy: plan.legacyEnvelopePolicy, physicalMutation: false, externalProgramChanged: false });
      const byTrack = new Map(plan.entries.map(row => [row.trackId, row])), tracks = project.tracks.map(track => byTrack.has(track.id) ? { ...track, instrumentRef: references.get(byTrack.get(track.id).patchId), instrumentControls: { macros: {} } } : track);
      check(); const released = release(); await released.completion; check(); if (released.outcome !== 'complete') throw Object.assign(fail('Native default source readers retain unresolved resources.'), { retirement: released });
      return Object.freeze({ project: { ...project, tracks, localInstrumentMigration: receipt }, plan, changed: true, receipt });
    } finally { externalSignal?.removeEventListener('abort', cancel); const released = release(); await released.completion; if (released.outcome === 'complete') operations.delete(operation); finish(released); }
  };
  return Object.freeze({ prepare, state: () => Object.freeze({ pending: operations.size, disposed }), dispose() {
    if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; for (const operation of operations) operation.controller.abort(fail('Native default conversion retired.'));
    const sources = createProcgenRetirementScope().retire([...operations].map((operation, index) => ({ name: 'conversion-' + index, run: () => operation.completion })));
    return retirement.retire([{ name: 'sources', run: () => sources }, { name: 'selector', run: () => afterProcgenRetirement([sources], () => selection.dispose()) }]);
  } });
}
