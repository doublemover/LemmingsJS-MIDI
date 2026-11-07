const labels = Object.freeze({ reviewing: 'Review project replacement', selecting: 'Choose a project', reading: 'Reading project', validating: 'Validating project', 'loading-assets': 'Loading world assets',
  preparing: 'Preparing world', committing: 'Committing world', finalizing: 'Finalizing project save', naming: 'Name the saved project', quiescing: 'Finishing pending writes',
  encoding: 'Preparing project file', connecting: 'Connecting selected output', 'loading-sounds': 'Preparing lane sounds', canceling: 'Canceling; waiting for owned work to retire' });

/** @param {Partial<import('./ProcgenBoundaryContracts.js').OperationViewInput>} options @returns {import('./ProcgenBoundaryContracts.js').OperationView} */
export function createProcgenOperationView({ id, kind, phase, cancelable = false, blockingScopes = [], errorCode = null, retryAction = null } = {}) {
  if (typeof id !== 'string' || !id || id.length > 1024 || typeof kind !== 'string' || !labels[phase] || !Array.isArray(blockingScopes) || blockingScopes.length > 8) throw new Error('Invalid operation presentation.');
  return Object.freeze({ id, kind, phase, label: labels[phase], progressKind: ['reviewing', 'selecting', 'naming'].includes(phase) ? 'none' : 'indeterminate', completed: null, total: null,
    cancelable: cancelable === true && !['committing', 'finalizing', 'canceling'].includes(phase), blockingScopes: Object.freeze([...blockingScopes]), errorCode, retryAction });
}

/** @param {import('./ProcgenBoundaryContracts.js').OperationBoundaryInput | null} value @returns {import('./ProcgenBoundaryContracts.js').OperationBoundary | null} */
const boundary = value => {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || typeof value.documentIdentity !== 'string' || !value.documentIdentity ||
      !Number.isSafeInteger(value.projectRevision) || value.projectRevision < 0 || !Number.isSafeInteger(value.editRevision) || value.editRevision < 0) throw new Error('Incomplete operation boundary.');
  const projected = { documentIdentity: value.documentIdentity, documentId: value.documentId ?? null, projectRevision: value.projectRevision, editRevision: value.editRevision,
    worldId: value.worldId ?? null, generation: value.generation ?? null, tick: value.tick ?? null, storedRevision: value.storedRevision ?? null };
  for (const [key, field] of Object.entries(projected)) {
    if (field == null) continue;
    if (key === 'documentIdentity' || key === 'documentId' || key === 'worldId') { if (typeof field !== 'string' || field.length > 512) throw new Error('Invalid operation boundary identity.'); }
    else if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 0) throw new Error('Invalid operation boundary revision.');
  }
  return Object.freeze(projected);
};

/** @overload @param {import('./ProcgenBoundaryContracts.js').OperationReceiptInput} options @returns {import('./ProcgenBoundaryContracts.js').OperationReceipt} */
/** @param {Partial<import('./ProcgenBoundaryContracts.js').OperationReceiptInput>} options @returns {import('./ProcgenBoundaryContracts.js').OperationReceipt} */
export function createProcgenOperationReceipt({ id, kind, outcome, source, captured = null, accepted = null, errorCode = null } = {}) {
  if (typeof id !== 'string' || !id || id.length > 128 || typeof kind !== 'string' || !kind || kind.length > 64 ||
      !['committed', 'committed-with-error', 'prepared', 'canceled', 'failed', 'unknown', 'retired'].includes(outcome) ||
      errorCode != null && (typeof errorCode !== 'string' || errorCode.length > 96) || !source ||
      ['committed', 'committed-with-error'].includes(outcome) && !accepted ||
      !['committed', 'committed-with-error'].includes(outcome) && accepted != null) throw new Error('Invalid operation receipt.');
  const original = boundary(source), capturedBoundary = boundary(captured), acceptedBoundary = boundary(accepted);
  if (outcome === 'committed' || outcome === 'committed-with-error') return Object.freeze({ version: 1, id, kind, outcome, source: original, captured: capturedBoundary, accepted: acceptedBoundary, errorCode, resourceRetirement: 'reported-separately', acousticDelivery: false });
  return Object.freeze({ version: 1, id, kind, outcome, source: original, captured: capturedBoundary, accepted: null, errorCode, resourceRetirement: 'reported-separately', acousticDelivery: false });
}
