import crypto from 'node:crypto';

const nowIso = () => new Date().toISOString();

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
    this.maxBytes = maxBytes;
    this.defaultTtlMs = ttlMs;
    this.maxItems = maxItems;
    this.idFactory = typeof idFactory === 'function' ? idFactory : makeId;
    this.timeFactory = typeof timeFactory === 'function' ? timeFactory : nowIso;
    this.items = new Map();
    this.totalBytes = 0;
  }

  put({ sessionId, bytes, mimeType, meta = {}, ttlMs } = {}) {
    if (!bytes) return null;
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const id = this.idFactory();
    const uri = `lemmings://sessions/${sessionId}/resources/${id}`;
    const sizeBytes = buffer.length;
    const ttl = Number.isFinite(ttlMs) ? ttlMs : this.defaultTtlMs;
    const expiresAt = ttl > 0 ? Date.now() + ttl : null;
    const item = {
      id,
      uri,
      sessionId,
      mimeType,
      meta,
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
    const id = match[2];
    const item = this.items.get(id);
    if (!item) return null;
    if (item.expiresAt && Date.now() >= item.expiresAt) {
      this._remove(id);
      return null;
    }
    this.items.delete(id);
    this.items.set(id, item);
    return item;
  }

  list({ limit = 200 } = {}) {
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
      if (out.length >= limit) break;
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
