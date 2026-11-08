const ROUTES = Symbol('audioObservationRoutes');

const snapshotContext = source => {
  try {
    const value = typeof source === 'function' ? source() : source;
    if (!value || typeof value !== 'object') return { fields: Object.freeze({}), projection: null };
    const fields = {}, omittedFields = [], truncatedFields = [], entries = Object.entries(value);
    for (const [key, item] of entries.slice(0, 64)) {
      if (typeof item === 'string') {
        fields[key] = item.slice(0, 1024); if (item.length > 1024) truncatedFields.push(key.slice(0, 128));
      } else if (item == null || ['number', 'boolean'].includes(typeof item)) fields[key] = item;
      else if (Array.isArray(item)) {
        fields[key] = Object.freeze(item.slice(0, 32).filter(entry =>
          entry == null || ['string', 'number', 'boolean'].includes(typeof entry)).map(entry => typeof entry === 'string' ? entry.slice(0, 1024) : entry));
        if (item.length > fields[key].length || item.some(entry => typeof entry === 'string' && entry.length > 1024)) truncatedFields.push(key.slice(0, 128));
      } else omittedFields.push(key.slice(0, 128));
    }
    return { fields: Object.freeze(fields), projection: Object.freeze({
      omittedFields: Object.freeze(omittedFields), truncatedFields: Object.freeze(truncatedFields),
      omittedFieldCount: omittedFields.length + Math.max(0, entries.length - 64), contextOnly: true, canonicalJournal: false }) };
  } catch { return { fields: Object.freeze({}), projection: Object.freeze({ reason: 'context-unavailable', canonicalJournal: false }) }; }
};

// Leases select observation recipients. Their immutable admission snapshots
// outlive document selection changes, while revocation still blocks callbacks.
export function createAudioObservationLeases({ maxLeases = 16 } = {}) {
  if (!Number.isSafeInteger(maxLeases) || maxLeases < 1 || maxLeases > 256) throw new Error('Invalid audio observer limit.');
  const leases = new Set();
  let projectedContexts = 0;
  const active = lease => {
    try { return lease.active && (typeof lease.capture.isActive !== 'function' || lease.capture.isActive()); }
    catch { return false; }
  };
  const attach = (capture, context, owner = undefined) => {
    if (typeof capture?.record !== 'function') throw new TypeError('An audio observer requires record().');
    if (leases.size >= maxLeases) throw new RangeError('Audio observer limit reached.');
    const lease = { capture, context, owner, active: true };
    leases.add(lease);
    return () => { lease.active = false; leases.delete(lease); };
  };
  const enabled = owner => [...leases].some(lease => active(lease) &&
    (owner === undefined || lease.owner === undefined || lease.owner === owner));
  const stamp = (fields, owner = null) => {
    if (fields?.[ROUTES]) return { ...fields, owner };
    const routes = [];
    for (const lease of leases) if (active(lease) && (lease.owner === undefined || lease.owner === owner)) {
      const snapshot = snapshotContext(lease.context);
      routes.push(Object.freeze({ lease, context: snapshot.fields, projection: snapshot.projection }));
      projectedContexts++;
    }
    return { ...fields, owner, [ROUTES]: Object.freeze(routes) };
  };
  const emit = (stage, fields) => {
    const stamped = fields?.[ROUTES] ? fields : stamp(fields, fields?.owner ?? null);
    const { [ROUTES]: routes, ...payload } = stamped;
    let result = null;
    const recipients = new Set();
    for (const route of routes) {
      const { lease, context, projection } = route;
      if (!active(lease) || recipients.has(lease.capture)) continue;
      recipients.add(lease.capture);
      try {
        const record = lease.capture.record(stage, { ...context, ...payload,
          observationScope: lease.owner === undefined ? 'mix' : 'owner',
          ...(projection ? { contextProjection: projection } : {}),
          evidenceClass: payload.evidenceClass || 'scheduled-api', acousticReceipt: false });
        if (result == null) result = record ?? null;
      } catch { /* An observer cannot prevent audio delivery or another observer. */ }
    }
    return result;
  };
  const revokeOwner = owner => { for (const lease of leases) if (lease.owner === owner) { lease.active = false; leases.delete(lease); } };
  const clear = () => { for (const lease of leases) lease.active = false; leases.clear(); };
  const diagnostics = () => Object.freeze({ leases: leases.size, maxLeases, projectedContexts,
    contextProjection: 'bounded-scalars-and-arrays', canonicalJournal: false });
  return { attach, enabled, stamp, emit, revokeOwner, clear, diagnostics };
}
