import { validateSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'SoundTransactionError', code });
const fingerprint = lane => JSON.stringify([lane?.family, lane?.role, lane?.patch, lane?.instrumentRef?.packHash,
  lane?.instrumentRef?.definitionHash, lane?.instrumentControls, lane?.soundChangePolicy]);
let nextOwner = 0;

export function createLaneSoundTransaction({ getSource, prepare, publish, resourceBudget = null, onState = () => {} } = {}) {
  if ([getSource, prepare, publish, onState].some(value => typeof value !== 'function')) throw new TypeError('Invalid sound transaction owner.');
  const id = ++nextOwner, operations = new Set(), retirement = createProcgenRetirementScope();
  let active = null, preview = null, serial = 0, disposed = false, publishing = false, unknown = false;
  const report = (state, operation, reason = null) => { try { onState(Object.freeze({ state, laneId: operation?.laneId || null, reason })); } catch { /* Presentation cannot own a sound transaction. */ } };
  const current = operation => {
    const source = getSource(operation.laneId);
    return !disposed && active === operation && operation.reviewIsCurrent() && source.available && source.owner === operation.owner &&
      source.documentGeneration === operation.documentGeneration && source.worldGeneration === operation.worldGeneration &&
      source.selectedLaneId === operation.laneId && fingerprint(source.lane) === operation.baseline;
  };
  const check = operation => { operation.controller.signal.throwIfAborted(); if (!current(operation)) throw failure('sound-source-conflict', 'The sound selection, controls or document changed. Unrelated accepted edits are preserved.'); };
  const finish = operation => {
    if (operation.retirement.getReceipt()) return operation.retirement.getReceipt();
    if (operation.preparing) return operation.finished;
    if (active === operation) active = null;
    if (preview === operation) preview = null;
    operation.externalSignal?.removeEventListener('abort', operation.abort);
    let candidate;
    const receipt = operation.retirement.retire([
      { name: 'prepared-instrument', run: () => candidate = createProcgenRetirementScope().retire([{ name: 'renderer', run: () => operation.prepared?.release() }, { name: 'preparation-failure', run: () => operation.preparationFailure }, { name: 'source-candidate', run: () => operation.sourceCandidate?.release?.() }]) },
      { name: 'sound-inputs', run: async () => { if (candidate?.completion) await candidate.completion; if (candidate?.outcome && candidate.outcome !== 'complete') throw failure('retirement-unknown', 'Sound transaction inputs retain an unresolved renderer.'); operation.reservation.release(); } }
    ]);
    receipt.completion.then(result => { if (result.outcome !== 'complete') { unknown = true; report('retirement-unknown', operation, 'Unacknowledged sound resources remain charged.'); }
    else operations.delete(operation); operation.resolveFinished(result); });
    return receipt;
  };
  const cancelOperation = (operation, reason = 'Sound preview canceled.') => {
    if (!operation) return null;
    if (active === operation) active = null;
    if (preview === operation) preview = null;
    operation.controller.abort(failure('sound-canceled', reason));
    const result = finish(operation); report('restoring', operation); return result;
  };
  const commit = operation => {
    try { check(operation); } catch (error) { cancelOperation(operation, error.message); throw error; }
    publishing = true; let acceptAttempted = false;
    try {
      const result = publish(operation.laneId, operation.reference, operation.patch);
      if (result === false) throw failure('sound-publication-rejected', 'The sound edit was not admitted.');
      const selected = getSource(operation.laneId).lane?.instrumentRef;
      if (selected?.packHash !== operation.reference.packHash || selected?.definitionHash !== operation.reference.definitionHash)
        throw failure('sound-publication-rejected', 'The committed sound label differs from the prepared renderer.');
      acceptAttempted = true; operation.prepared.accept(); report('committed', operation); return operation.reference;
    } catch (error) {
      const selected = getSource(operation.laneId).lane?.instrumentRef;
      if (!acceptAttempted && selected?.packHash === operation.reference.packHash && selected?.definitionHash === operation.reference.definitionHash) {
        operation.prepared.accept(); report('committed-presentation-fault', operation, error.message); return operation.reference;
      }
      throw error;
    } finally { publishing = false; finish(operation); }
  };
  const select = async (candidate, { laneId, signal, hold = false, patch = {}, isCurrent = () => true } = {}) => {
    signal?.throwIfAborted();
    if (typeof isCurrent !== 'function') throw new TypeError('A sound review fence must be a function.');
    if (disposed || unknown) throw failure('sound-owner-unavailable', 'Sound transaction resources are unavailable.');
    const reference = typeof candidate === 'function' ? null : validateSoundContentReference({ ...candidate.reference, definition: candidate.definition || candidate.reference?.definition });
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['family', 'role', 'patch', 'performanceRecipeId', 'linkedThemePresetId'].includes(key)) || Object.values(patch).some(value => value != null && (typeof value !== 'string' || value.length > 128))) throw failure('invalid-sound-patch', 'A sound transaction cannot alter physical or hardware routing fields.');
    patch = Object.freeze({ ...patch });
    const source = getSource(laneId); laneId ||= source.selectedLaneId;
    if (!source.available || !source.lane || source.selectedLaneId !== laneId) throw failure('sound-source-unavailable', source.reason || 'Finish the world/history/take operation before selecting sound.');
    if (source.lane.soundChangePolicy !== 'new-notes-only') throw failure('sound-policy-unsupported', 'Held crossfade is not supported. Choose the named new-notes-only policy; the world will not change.');
    if (!Number.isSafeInteger(serial + 1)) throw failure('sound-identity-exhausted', 'Sound transaction identity exhausted.');
    cancelOperation(active, 'A newer sound selection superseded this candidate.');
    if (operations.size >= 2) throw failure('sound-preparation-capacity', 'Wait for the canceled sound preparation to acknowledge retirement.');
    const reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: `sound-transaction-${id}:${++serial}`, kind: 'sound-transaction-inputs', category: 'audio', bytes: 262144 });
    let resolveFinished;
    const operation = { laneId, reference, patch, reviewIsCurrent: isCurrent, owner: source.owner, documentGeneration: source.documentGeneration, worldGeneration: source.worldGeneration,
      baseline: fingerprint(source.lane), externalSignal: signal, controller: new AbortController(), reservation, preparing: true, retirement: createProcgenRetirementScope(),
      finished: new Promise(resolve => { resolveFinished = resolve; }), resolveFinished: result => resolveFinished(result) };
    operation.abort = () => cancelOperation(operation, 'The sound gesture was released.');
    operations.add(operation); active = operation; signal?.addEventListener('abort', operation.abort, { once: true }); if (signal?.aborted) operation.abort();
    report('preparing', operation);
    try {
      check(operation); if (typeof candidate === 'function') { operation.sourceCandidate = await candidate(operation.controller.signal); check(operation); operation.reference = validateSoundContentReference({ ...operation.sourceCandidate.reference, definition: operation.sourceCandidate.definition || operation.sourceCandidate.reference?.definition }); }
      operation.prepared = await prepare(laneId, operation.reference, { signal: operation.controller.signal, retainPrevious: true }); operation.preparing = false; check(operation);
      operation.prepared.commit(); preview = operation;
      if (!hold) return commit(operation);
      report('preview', operation);
      return Object.freeze({ reference: operation.reference, commit: () => commit(operation), cancel: () => cancelOperation(operation), isCurrent: () => current(operation) });
    } catch (error) { operation.preparing = false; operation.preparationFailure = error.retirement; finish(operation); report('rejected', operation, error.message); throw error; }
  };
  return Object.freeze({ select,
    lanes(lanes) {
      if (!preview) return lanes;
      if (!publishing && !current(preview)) { cancelOperation(preview, 'The sound preview source changed.'); return lanes; }
      return lanes.map(lane => lane.id === preview.laneId ? { ...lane, ...preview.patch, instrumentRef: preview.reference, instrumentPatchId: preview.reference.patchId, instrumentControls: { macros: {} } } : lane);
    },
    reconcile() { if (!publishing && active && !current(active)) cancelOperation(active, 'The sound preview source changed.'); },
    cancel: reason => cancelOperation(active, reason),
    diagnostics: () => Object.freeze({ active: !!active, preview: !!preview, pendingOwners: operations.size, unknownRetirement: unknown, disposed }),
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true;
      return retirement.retire([...operations].map((operation, index) => ({ name: 'sound-' + index, run: () => cancelOperation(operation, 'Sound transaction owner retired.') })));
    }
  });
}
