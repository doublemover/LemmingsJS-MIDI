import { canonicalDataText, freezeData, hashData } from '../../../core/CanonicalData.js';
import { inspectPerformanceScene, validatePerformanceScene, performanceSceneHash } from './PerformanceScene.js';

export function createPerformanceSceneRegistry({ maximumScenes = 4096 } = {}) {
  if (!Number.isInteger(maximumScenes) || maximumScenes < 1 || maximumScenes > 4096) throw new TypeError('Invalid scene inventory limit.');
  const entries = new Map(), latestSupported = new Map(); let revision = 0;
  return Object.freeze({
    async register(raw) {
      const metadata = inspectPerformanceScene(raw), key = metadata.id + ':' + metadata.version;
      const scene = metadata.supported ? validatePerformanceScene(raw) : null, hash = scene ? await performanceSceneHash(scene) : await hashData(raw, { maxBytes: 1048576, maxNodes: 65536 });
      const previous = entries.get(key);
      if (previous) { if (previous.hash !== hash || canonicalDataText(previous.metadata).text !== canonicalDataText(metadata).text) throw new Error('A scene version cannot be overwritten with different content.'); return previous.metadata; }
      if (entries.size >= maximumScenes) throw new Error('Scene registry capacity exceeded.');
      const entry = { metadata, scene, hash }; entries.set(key, entry);
      if (scene && (!latestSupported.has(metadata.id) || latestSupported.get(metadata.id).metadata.version < metadata.version)) latestSupported.set(metadata.id, entry);
      revision++; return metadata;
    },
    findSupported({ id, version = null } = {}) {
      if (typeof id !== 'string' || !id || id.length > 160 || version !== null && (!Number.isInteger(version) || version < 1 || version > 2147483647)) throw new TypeError('Choose a scene identity and optional exact content version.');
      const entry = version === null ? latestSupported.get(id) : entries.get(id + ':' + version);
      return entry?.scene ? freezeData({ ...entry.metadata, hash: entry.hash }) : null;
    },
    resolve({ id, version, hash }) { const entry = entries.get(id + ':' + version); if (!entry?.scene || entry.hash !== hash) throw new Error('The exact scene version is unavailable.'); return entry.scene; },
    page({ query = '', mechanism = null, density = null, lessonLevel = null, offset = 0, limit = 24, expectedRevision = revision } = {}) {
      if (typeof query !== 'string' || query.length > 256 || mechanism !== null && typeof mechanism !== 'string' || density !== null && !['sparse', 'medium', 'dense'].includes(density) || lessonLevel !== null && (!Number.isInteger(lessonLevel) || lessonLevel < 0 || lessonLevel > 5) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 64 || expectedRevision !== revision) throw new Error('Scene page filters or source revision are stale.');
      const text = query.trim().toLowerCase(), rows = [];
      for (const entry of entries.values()) { const m = entry.metadata;
        if (text && !(m.title + ' ' + (m.description || '')).toLowerCase().includes(text) || mechanism !== null && !m.mechanisms?.includes(mechanism) || density !== null && m.density !== density || lessonLevel !== null && m.lessonLevel !== lessonLevel) continue;
        rows.push({ ...m, hash: entry.hash });
      }
      rows.sort((a, b) => a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : b.version - a.version);
      return freezeData({ revision, total: rows.length, offset, rows: rows.slice(offset, offset + limit), nextOffset: offset + limit < rows.length ? offset + limit : null });
    }, revision: () => revision, size: () => entries.size
  });
}
