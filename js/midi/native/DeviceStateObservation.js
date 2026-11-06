export function createDeviceStateObservationStore({ maximumScopes = 32, maximumValues = 4096 } = {}) {
  const scopes = new Map(), indexes = new Map(), localEdits = new Map();
  let retainedValues = 0, editRevision = 0, observationRevision = 0;
  const key = scope => JSON.stringify([scope.connectionEpoch, scope.inputGrant, scope.ciEpoch, scope.ingressEpoch, scope.peerMuid, scope.group, scope.channel]);
  return Object.freeze({
    editRevision: () => editRevision,
    markLocalEdit(address, value) {
      if (typeof address !== 'string' || address.length > 256 || !Number.isFinite(value) || localEdits.size >= maximumValues && !localEdits.has(address)) throw new Error('Invalid or excessive local device edit');
      const entry = Object.freeze({ address, value, revision: ++editRevision }); localEdits.set(address, entry); return entry;
    },
    commit(observation, expectedEditRevision) {
      if (observation?.complete !== true || observation.schema !== 'lemmings-device-state-observation/v1' || !Array.isArray(observation.values) || observation.values.length > maximumValues) throw new Error('A complete bounded device observation is required');
      const scopeKey = key(observation.scope);
      if (!scopes.has(scopeKey) && scopes.size >= maximumScopes) throw new Error('Device observation scope capacity');
      const nextRetained = retainedValues - (scopes.get(scopeKey)?.values.length || 0) + observation.values.length; if (nextRetained > maximumValues) throw new Error('Aggregate device observation value capacity');
      const conflicts = Object.freeze(observation.values.filter(entry => (localEdits.get(entry.address)?.revision || 0) > expectedEditRevision).map(entry => entry.address));
      const record = Object.freeze({ ...observation, revision: ++observationRevision, capturedEditRevision: expectedEditRevision, conflicts, baselineUsable: !conflicts.length,
        values: Object.freeze(observation.values.map(entry => Object.freeze({ ...entry }))) });
      scopes.set(scopeKey, record); indexes.set(scopeKey, new Map(record.values.map(entry => [entry.address, entry]))); retainedValues = nextRetained; return record;
    },
    get(scope) { return scopes.get(key(scope)) || null; },
    value(scope, address) {
      const observation = scopes.get(key(scope)); if (!observation) return Object.freeze({ known: false, reason: 'no-complete-observation' });
      const local = localEdits.get(address);
      if (local && local.revision > observation.capturedEditRevision) return Object.freeze({ known: false, reason: 'newer-local-edit', local });
      const entry = indexes.get(key(scope))?.get(address);
      return entry ? entry.baselineUsable === false ? Object.freeze({ known: false, reason: 'unverified-message-combination', observation: entry }) : Object.freeze({ known: true, observationRevision: observation.revision, ...entry }) : Object.freeze({ known: false, reason: 'not-reported' });
    },
    clear() { scopes.clear(); indexes.clear(); localEdits.clear(); retainedValues = 0; },
    state: () => Object.freeze({ scopes: scopes.size, retainedValues, localEdits: localEdits.size, editRevision, observationRevision })
  });
}
