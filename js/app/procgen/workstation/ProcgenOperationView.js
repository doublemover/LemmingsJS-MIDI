const labels = Object.freeze({ reviewing: 'Review project replacement', selecting: 'Choose a project', reading: 'Reading project', validating: 'Validating project', 'loading-assets': 'Loading world assets',
  preparing: 'Preparing world', committing: 'Committing world', finalizing: 'Finalizing project save', naming: 'Name the saved project', quiescing: 'Finishing pending writes',
  encoding: 'Preparing project file', connecting: 'Connecting selected output', 'loading-sounds': 'Preparing lane sounds', canceling: 'Canceling; waiting for owned work to retire' });

export function createProcgenOperationView({ id, kind, phase, cancelable = false, blockingScopes = [], errorCode = null, retryAction = null } = {}) {
  if (typeof id !== 'string' || !id || id.length > 1024 || typeof kind !== 'string' || !labels[phase] || !Array.isArray(blockingScopes) || blockingScopes.length > 8) throw new Error('Invalid operation presentation.');
  return Object.freeze({ id, kind, phase, label: labels[phase], progressKind: ['reviewing', 'selecting', 'naming'].includes(phase) ? 'none' : 'indeterminate', completed: null, total: null,
    cancelable: cancelable === true && !['committing', 'finalizing', 'canceling'].includes(phase), blockingScopes: Object.freeze([...blockingScopes]), errorCode, retryAction });
}

const boundary = value => {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || typeof value.documentIdentity !== 'string' || !value.documentIdentity ||
      !Number.isSafeInteger(value.projectRevision) || value.projectRevision < 0 || !Number.isSafeInteger(value.editRevision) || value.editRevision < 0) throw new Error('Incomplete operation boundary.');
  return Object.freeze(Object.fromEntries(
    ['documentIdentity', 'documentId', 'projectRevision', 'editRevision', 'worldId', 'generation', 'tick', 'storedRevision'].map(key => {
      const field = value[key];
      if (field == null) return [key, null];
      if (['documentIdentity', 'documentId', 'worldId'].includes(key)) {
        if (typeof field !== 'string' || field.length > 512) throw new Error('Invalid operation boundary identity.');
      } else if (!Number.isSafeInteger(field) || field < 0) throw new Error('Invalid operation boundary revision.');
      return [key, field];
    })));
};

export function createProcgenOperationReceipt({ id, kind, outcome, source, captured = null, accepted = null, errorCode = null } = {}) {
  if (typeof id !== 'string' || !id || id.length > 128 || typeof kind !== 'string' || !kind || kind.length > 64 ||
      !['committed', 'committed-with-error', 'prepared', 'canceled', 'failed', 'unknown', 'retired'].includes(outcome) ||
      errorCode != null && (typeof errorCode !== 'string' || errorCode.length > 96) || !source ||
      ['committed', 'committed-with-error'].includes(outcome) && !accepted ||
      !['committed', 'committed-with-error'].includes(outcome) && accepted != null) throw new Error('Invalid operation receipt.');
  return Object.freeze({ version: 1, id, kind, outcome, source: boundary(source), captured: boundary(captured), accepted: boundary(accepted), errorCode,
    resourceRetirement: 'reported-separately', acousticDelivery: false });
}
