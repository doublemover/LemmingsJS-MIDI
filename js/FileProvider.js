import { Lemmings } from './LemmingsNamespace.js';

/**
 * FileProvider with transparent in‑memory caching.
 */
class FileProvider extends Lemmings.BaseLogger {
  constructor(rootPath) {
    super();
    this.rootPath = rootPath;

    /**
     * Cache mapping full URL → Promise<BinaryReader> or Promise<string>.
     * Store the Promise itself so concurrent callers share one in‑flight XHR.
     * @type {Map<string, Promise<any>>}
     */
    this._cache = new Map();
  }

  /** Empty the cache (debug helper). */
  clearCache() {
    this._cache.clear();
  }

  /**
   * Load binary data from URL( rootPath + path + filename ).
   * Returns a Promise that resolves to Lemmings.BinaryReader.
   * @param {string} path    sub‑directory below rootPath (leading slash optional)
   * @param {?string} filename  optional file name; when omitted `path` is treated as full relative URL
   * @param {{forceReload?: boolean}} [opts]
   */
  loadBinary(path, filename = null, opts = {}) {
    const url = this._buildUrl(path, filename);
    if (!opts.forceReload && this._cache.has(url)) {
      return this._cache.get(url);
    }

    let promise;
    if (!opts.forceReload) {
      const cached = this._loadFromLocalStorage(url, 'binary', path);
      if (cached) {
        promise = Promise.resolve(cached.value);
      }
    }

    if (!promise) {
      this.log.debug('loading: ' + url);
      promise = this._fetchBinary(url, path);
    }

    if (!opts.forceReload) {
      this._cache.set(url, promise);
    }
    return promise;
  }

  /**
   * Load text file as string; cached with the same rules as binary.
   */
  loadString(url, opts = {}) {
    if (!opts.forceReload && this._cache.has(url)) {
      return this._cache.get(url);
    }

    let promise;
    if (!opts.forceReload) {
      const cached = this._loadFromLocalStorage(url, 'text');
      if (cached) {
        promise = Promise.resolve(cached.value);
      }
    }

    if (!promise) {
      // this.log.debug('loading text: ' + url);
      promise = this._fetchText(url);
    }

    if (!opts.forceReload) {
      this._cache.set(url, promise);
    }
    return promise;
  }

  _buildUrl(path, filename) {
    return (
      this.rootPath +
      path +
      (filename == null ? '' : '/' + filename)
    );
  }

  _filenameFromUrl(url) {
    if (!url) return '';
    url = url.split('#')[0].split('?')[0];
    return url.substring(url.lastIndexOf('/') + 1);
  }

  _loadFromLocalStorage(url, type, path = '') {
    try {
      const item = localStorage.getItem('lem-cache:' + url);
      if (!item) return null;
      const entry = JSON.parse(item);

      // kick off async validation of cache
      this._verifyCache(url, entry);

      let value;
      if (type === 'binary') {
        const buf = this._base64ToArrayBuffer(entry.data);
        value = new Lemmings.BinaryReader(buf, 0, null, this._filenameFromUrl(url), path);
      } else {
        value = entry.data;
      }
      return { value, entry };
    } catch (e) {
      return null;
    }
  }

  async _verifyCache(url, entry) {
    const head = await this._fetchHead(url);
    if (!head) return;
    if (entry.etag && head.etag && entry.etag === head.etag) return;
    if (entry.lastModified && head.lastModified && entry.lastModified === head.lastModified) return;
    try {
      if (entry.type === 'binary') {
        await this._fetchBinary(url, '');
      } else {
        await this._fetchText(url);
      }
    } catch (e) {
      console.log('cache update error', e);
    }
  }

  async _fetchBinary(url, path) {
    const data = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const headers = {
            etag: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('ETag') : null,
            lastModified: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('Last-Modified') : null,
          };
          resolve({ buffer: xhr.response, headers });
        } else {
          const err = new Error('error load file: ' + url);
          this.log.log(err.message);
          reject(err);
        }
      };
      xhr.onerror = () => {
        const err = new Error('error load file: ' + url);
        this.log.log(err.message);
        reject(err);
      };
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      xhr.send();
    });

    const buf = data.buffer;
    const reader = new Lemmings.BinaryReader(buf, 0, null, this._filenameFromUrl(url), path);
    const hash = await this._hashBuffer(buf);
    this._storeInLocalStorage(url, { type: 'binary', data: this._arrayBufferToBase64(buf), hash, ...data.headers });
    return reader;
  }

  async _fetchText(url) {
    const data = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const headers = {
            etag: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('ETag') : null,
            lastModified: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('Last-Modified') : null,
          };
          resolve({ text: xhr.response, headers });
        } else {
          const err = new Error('error load file: ' + url);
          this.log.log(err.message);
          reject(err);
        }
      };
      xhr.onerror = () => {
        const err = new Error('error load file: ' + url);
        this.log.log(err.message);
        reject(err);
      };
      xhr.open('GET', url);
      xhr.responseType = 'text';
      xhr.send();
    });

    const text = data.text;
    const hash = await this._hashString(text);
    this._storeInLocalStorage(url, { type: 'text', data: text, hash, ...data.headers });
    return text;
  }

  async _fetchHead(url) {
    if (typeof fetch !== 'function') return null;
    try {
      const resp = await fetch(url, { method: 'HEAD' });
      return { etag: resp.headers.get('ETag'), lastModified: resp.headers.get('Last-Modified') };
    } catch (e) {
      return null;
    }
  }

  _storeInLocalStorage(url, entry) {
    try {
      localStorage.setItem('lem-cache:' + url, JSON.stringify(entry));
    } catch (e) {
      console.log('cache write error', e);
    }
  }

  async _hashBuffer(buffer) {
    const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async _hashString(str) {
    const enc = new TextEncoder();
    return this._hashBuffer(enc.encode(str));
  }

  _arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  _base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

Lemmings.FileProvider = FileProvider;
export { FileProvider };
