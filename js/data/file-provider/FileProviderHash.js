import {
  BaseLogger,
  BinaryReader,
  IDB_MAX_BYTES,
  IDB_NAME,
  IDB_STORE_ENTRIES,
  IDB_STORE_META,
  IDB_STORE_PAYLOADS,
  IDB_VERSION,
  LOCAL_STORAGE_MAX_BYTES,
  LOCAL_STORAGE_PREFIX,
  appendRevisionParam,
  getDependency,
  getRuntimeDependency,
  sanitizeCacheBust
} from './FileProviderShared.js';
const fileProviderHashMethods = {
  async _tryHashBuffer(buffer) {
    const cryptoRef = this._crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (cryptoRef?.subtle) {
      try {
        const hashBuf = await cryptoRef.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(hashBuf))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      } catch (e) {
        return null;
      }
    }
    return null;
  },

  async _tryHashString(str) {
    if (typeof TextEncoder === 'undefined') return null;
    const enc = new TextEncoder();
    return this._tryHashBuffer(enc.encode(str));
  },

  async _hashBuffer(buffer) {
    const hash = await this._tryHashBuffer(buffer);
    if (hash != null) {
      return hash;
    }
    throw new Error('crypto API not available');
  },

  async _hashString(str) {
    if (typeof TextEncoder !== 'undefined') {
      const enc = new TextEncoder();
      return this._hashBuffer(enc.encode(str));
    }
    throw new Error('crypto API not available');
  },

  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    const chunks = [];
    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      chunks.push(String.fromCharCode(...chunk));
    }
    return btoa(chunks.join(''));
  },

  _base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
};
export { fileProviderHashMethods };