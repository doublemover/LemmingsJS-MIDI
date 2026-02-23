import crypto from 'node:crypto';

const nowIso = () => new Date().toISOString();
const normalizeInteger = (value, fallback, min = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const integer = Math.trunc(numeric);
  return integer >= min ? integer : fallback;
};

const cloneMeta = (value) => {
  if (value == null || typeof value !== 'object') return {};
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // fall through
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
};

const makeId = (bytes = 9) => crypto.randomBytes(bytes)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

class ResourceStore {
  constructor({
    maxBytes = 256 * 1024 * 1024,
    ttlMs = 10 * 60 * 1000,
    maxItems = 5000,
    idFactory = makeId,
    timeFactory = nowIso
  } = {}) {
    this.maxBytes = normalizeInteger(maxBytes, 256 * 1024 * 1024, 1);
    this.defaultTtlMs = normalizeInteger(ttlMs, 10 * 60 * 1000, 0);
    this.maxItems = normalizeInteger(maxItems, 5000, 1);
    this.idFactory = typeof idFactory === 'function' ? idFactory : makeId;
    this.timeFactory = typeof timeFactory === 'function' ? timeFactory : nowIso;
    this.items = new Map();
    this.totalBytes = 0;
  }

  put({ sessionId, bytes, mimeType, meta = {}, ttlMs } = {}) {
    if (!sessionId || bytes == null) return null;
    let buffer;
    try {
      // Always clone to avoid storing mutable caller-owned buffers by reference.
      buffer = Buffer.from(bytes);
    } catch {
      return null;
    }
    const sizeBytes = buffer.length;
    if (sizeBytes > this.maxBytes) return null;
    const normalizedMimeType = typeof mimeType === 'string' && mimeType.trim()
      ? mimeType.trim()
      : 'application/octet-stream';
    const id = this.idFactory();
    const uri = `lemmings://sessions/${sessionId}/resources/${id}`;
    const ttl = normalizeInteger(ttlMs, this.defaultTtlMs, 0);
    const expiresAt = ttl > 0 ? Date.now() + ttl : null;
    const item = {
      id,
      uri,
      sessionId,
      mimeType: normalizedMimeType,
      meta: cloneMeta(meta),
      bytes: buffer,
      sizeBytes,
      createdAt: this.timeFactory(),
      expiresAt
    };
    this.items.set(id, item);
    this.totalBytes += sizeBytes;
    this._evictIfNeeded();
    return {
      uri,
      sizeBytes,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
    };
  }

  get(uri) {
    const match = /^lemmings:\/\/sessions\/([^/]+)\/resources\/([^/]+)$/.exec(String(uri || ''));
    if (!match) return null;
    const sessionId = match[1];
    const id = match[2];
    const item = this.items.get(id);
    if (!item) return null;
    if (item.sessionId !== sessionId) return null;
    if (item.expiresAt && Date.now() >= item.expiresAt) {
      this._remove(id);
      return null;
    }
    this.items.delete(id);
    this.items.set(id, item);
    return {
      ...item,
      meta: cloneMeta(item.meta),
      bytes: Buffer.from(item.bytes)
    };
  }

  list({ limit = 200 } = {}) {
    const safeLimit = normalizeInteger(limit, 200, 0);
    if (safeLimit === 0) return [];
    const out = [];
    for (const item of this.items.values()) {
      if (item.expiresAt && Date.now() >= item.expiresAt) {
        this._remove(item.id);
        continue;
      }
      out.push({
        uri: item.uri,
        name: item.meta?.tag || item.meta?.kind || item.id,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt ? new Date(item.expiresAt).toISOString() : null
      });
      if (out.length >= safeLimit) break;
    }
    return out;
  }

  clearSession(sessionId) {
    if (!sessionId) return;
    for (const [id, item] of this.items.entries()) {
      if (item.sessionId === sessionId) {
        this._remove(id);
      }
    }
  }

  _remove(id) {
    const item = this.items.get(id);
    if (!item) return;
    this.items.delete(id);
    this.totalBytes = Math.max(0, this.totalBytes - item.sizeBytes);
  }

  _evictIfNeeded() {
    while (this.totalBytes > this.maxBytes || this.items.size > this.maxItems) {
      const firstKey = this.items.keys().next().value;
      if (!firstKey) break;
      this._remove(firstKey);
    }
  }
}

export { ResourceStore };
