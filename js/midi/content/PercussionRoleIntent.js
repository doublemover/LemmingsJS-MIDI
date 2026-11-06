const named = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
export function validatePercussionIntentPolicy(value) {
  if (!value || value.schema !== 'lemmings-percussion-role-policy/v1' || !named(value.instrumentRole) ||
      !Array.isArray(value.actions) || value.actions.length > 32 || !['profile-default', 'named-gm', 'custom'].includes(value.map?.kind) ||
      typeof value.map.name !== 'string' || !value.map.name.trim() || value.map.name.length > 128 || !Array.isArray(value.map.notes) || value.map.notes.length > 128 ||
      value.overlapPolicy !== 'refuse-same-note' || !Number.isFinite(value.releaseVelocity01) || value.releaseVelocity01 < 0 || value.releaseVelocity01 > 1) throw new Error('Invalid explicit percussion role/map policy');
  const actions = new Set(), roles = new Set(), notes = new Set();
  const rows = value.map.notes.map(row => {
    if (!row || !named(row.instrumentRole) || roles.has(row.instrumentRole) || !Number.isInteger(row.note) || row.note < 0 || row.note > 127 || notes.has(row.note)) throw new Error('Percussion roles and note addresses must be unambiguous');
    roles.add(row.instrumentRole); notes.add(row.note); return Object.freeze({ instrumentRole: row.instrumentRole, note: row.note });
  });
  const rules = value.actions.map(row => {
    if (!row || !named(row.action) || actions.has(row.action) || !named(row.instrumentRole) || !named(row.articulation)) throw new Error('Duplicate or malformed physical percussion action');
    actions.add(row.action); return Object.freeze({ action: row.action, instrumentRole: row.instrumentRole, articulation: row.articulation });
  });
  if (value.map.kind === 'custom' && (!roles.has(value.instrumentRole) || rules.some(row => !roles.has(row.instrumentRole)))) throw new Error('Every authored percussion role needs a custom note mapping');
  return Object.freeze({ schema: value.schema, instrumentRole: value.instrumentRole, actions: Object.freeze(rules), map: Object.freeze({ kind: value.map.kind, name: value.map.name, notes: Object.freeze(rows) }),
    overlapPolicy: value.overlapPolicy, releaseVelocity01: value.releaseVelocity01, reconnect: 'explicit-map-review-required' });
}
export function createPercussionHitIntent(policy, { action, velocity01, sourceContactId, sourceActionId } = {}) {
  if (!policy) return null;
  const selected = policy.actions.find(row => row.action === action);
  if (!Number.isFinite(velocity01) || velocity01 < 0 || velocity01 > 1) throw new Error('Invalid physical percussion velocity');
  return Object.freeze({ schema: 'lemmings-percussion-hit/v1', instrumentRole: selected?.instrumentRole || policy.instrumentRole, articulation: selected?.articulation || 'default',
    velocity01, releaseVelocity01: policy.releaseVelocity01, chokeGroup: 'resolved-by-explicit-map', sourceContactId: sourceContactId ?? null, sourceActionId: sourceActionId ?? null });
}
