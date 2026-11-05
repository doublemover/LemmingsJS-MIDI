const labels = Object.freeze({ selecting: 'Choose a project', reading: 'Reading project', validating: 'Validating project', 'loading-assets': 'Loading world assets',
  preparing: 'Preparing world', committing: 'Committing world', finalizing: 'Finalizing project save', naming: 'Name the saved project', quiescing: 'Finishing pending writes',
  encoding: 'Preparing project file', connecting: 'Connecting selected output', 'loading-sounds': 'Preparing lane sounds', canceling: 'Canceling; waiting for owned work to retire' });

export function createProcgenOperationView({ id, kind, phase, cancelable = false, blockingScopes = [], errorCode = null, retryAction = null } = {}) {
  if (typeof id !== 'string' || !id || id.length > 1024 || typeof kind !== 'string' || !labels[phase] || !Array.isArray(blockingScopes) || blockingScopes.length > 8) throw new Error('Invalid operation presentation.');
  return Object.freeze({ id, kind, phase, label: labels[phase], progressKind: 'indeterminate', completed: null, total: null,
    cancelable: cancelable === true && !['committing', 'finalizing', 'canceling'].includes(phase), blockingScopes: Object.freeze([...blockingScopes]), errorCode, retryAction });
}
