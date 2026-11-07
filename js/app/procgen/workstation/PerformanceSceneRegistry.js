import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { canonicalDataText, freezeData, hashDataText } from '../../../core/CanonicalData.js';
import { inspectPerformanceScene, validatePerformanceScene, PERFORMANCE_SCENE_SCHEMA } from './PerformanceScene.js';

export function createPerformanceSceneRegistry({ maximumScenes = 4096, maximumBytes = 128 * 1048576, resourceBudget = null } = {}) {
  if (!Number.isInteger(maximumScenes) || maximumScenes < 1 || maximumScenes > 4096 || !Number.isSafeInteger(maximumBytes) || maximumBytes < 4096 || maximumBytes > 512 * 1048576) throw new TypeError('Invalid scene inventory limit.');
  const entries = new Map(), latestSupported = new Map(), pending = new Set(), blocked = new Set(), retirement = createProcgenRetirementScope(), storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'performance-scene-registry', kind: 'retained-scene-metadata-and-indexes', bytes: 4096, maxBytes: maximumBytes });
  let revision = 0, retainedBytes = 4096, closed = false;
  const current = () => { if (closed) throw new Error('The performance scene registry has retired.'); };
  const register = async raw => {
    current(); const workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'performance-scene-registration', kind: 'bounded-scene-validation-and-hash-overlap', bytes: 16 * 1048576 });
    try {
      const scene = raw?.schema === PERFORMANCE_SCENE_SCHEMA ? validatePerformanceScene(raw) : null, metadata = inspectPerformanceScene(scene || raw), key = metadata.id + ':' + metadata.version,
        encoded = canonicalDataText(scene || raw, { maxBytes: 1048576, maxNodes: 65536 }), hash = await hashDataText(encoded.text); current();
      const previous = entries.get(key);
      if (previous) { if (previous.hash !== hash || canonicalDataText(previous.metadata).text !== canonicalDataText(metadata).text) throw new Error('A scene version cannot be overwritten with different content.'); return previous.metadata; }
      if (entries.size >= maximumScenes) throw new Error('Scene registry capacity exceeded.');
      const estimate = 4096 + encoded.bytes.length * 8, nextBytes = retainedBytes + estimate;
      if (nextBytes > maximumBytes) throw new Error('Scene registry metadata byte capacity exceeded.');
      storage.resize(nextBytes); const entry = { metadata, scene, hash, estimatedBytes: estimate }; entries.set(key, entry); retainedBytes = nextBytes;
      if (scene && (!latestSupported.has(metadata.id) || latestSupported.get(metadata.id).metadata.version < metadata.version)) latestSupported.set(metadata.id, entry);
      revision++; return metadata;
    } finally { try { workspace.release(); } catch (error) { blocked.add(workspace); throw error; } }
  };
  const dispose = () => {
    if (retirement.getReceipt()) return retirement.getReceipt(); closed = true;
    const registrations = Promise.allSettled([...pending]).then(() => { if (blocked.size) throw new Error('Scene metadata validation ownership remains unresolved.'); });
    return retirement.retire([{ name: 'scene-registration-work', run: () => registrations },
      { name: 'scene-metadata-and-indexes', run: async () => { await registrations; entries.clear(); latestSupported.clear(); storage.release(); retainedBytes = 0; revision++; } }]);
  };
  return Object.freeze({
    register(raw) { if (closed) return Promise.reject(new Error('The performance scene registry has retired.')); const operation = register(raw); pending.add(operation); operation.then(() => pending.delete(operation), () => pending.delete(operation)); return operation; },
    findSupported({ id, version = null } = {}) {
      if (typeof id !== 'string' || !id || id.length > 160 || version !== null && (!Number.isInteger(version) || version < 1 || version > 2147483647)) throw new TypeError('Choose a scene identity and optional exact content version.');
      current(); const entry = version === null ? latestSupported.get(id) : entries.get(id + ':' + version);
      return entry?.scene ? freezeData({ ...entry.metadata, hash: entry.hash }) : null;
    },
    resolve({ id, version, hash }) { current(); const entry = entries.get(id + ':' + version); if (!entry?.scene || entry.hash !== hash) throw new Error('The exact scene version is unavailable.'); return entry.scene; },
    page({ query = '', mechanism = null, density = null, lessonLevel = null, offset = 0, limit = 24, expectedRevision = revision } = {}) {
      current(); if (typeof query !== 'string' || query.length > 256 || mechanism !== null && typeof mechanism !== 'string' || density !== null && !['sparse', 'medium', 'dense'].includes(density) || lessonLevel !== null && (!Number.isInteger(lessonLevel) || lessonLevel < 0 || lessonLevel > 5) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 64 || expectedRevision !== revision) throw new Error('Scene page filters or source revision are stale.');
      const text = query.trim().toLowerCase(), rows = [];
      for (const entry of entries.values()) { const m = entry.metadata;
        if (text && !(m.title + ' ' + (m.description || '')).toLowerCase().includes(text) || mechanism !== null && !m.mechanisms?.includes(mechanism) || density !== null && m.density !== density || lessonLevel !== null && m.lessonLevel !== lessonLevel) continue;
        rows.push({ ...m, hash: entry.hash });
      }
      rows.sort((a, b) => a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : b.version - a.version);
      return freezeData({ revision, total: rows.length, offset, rows: rows.slice(offset, offset + limit), nextOffset: offset + limit < rows.length ? offset + limit : null });
    }, revision: () => revision, size: () => entries.size, dispose, diagnostics: () => Object.freeze({ scenes: entries.size, pendingRegistrations: pending.size, blockedWorkspaces: blocked.size, estimatedRetainedBytes: retainedBytes, maximumBytes, maximumScenes, closed, storage: storage.receipt(), retirement: retirement.getReceipt() })
  });
}
