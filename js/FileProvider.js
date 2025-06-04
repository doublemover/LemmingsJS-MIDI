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

    this.log.debug('loading: ' + url);

    const promise = new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const reader = new Lemmings.BinaryReader(
            xhr.response,
            0,
            null,
            this._filenameFromUrl(url),
            path,
          );
          resolve(reader);
        } else {
          this.log.log('error load file:' + url);
          reject({ status: xhr.status, statusText: xhr.statusText });
        }
      };
      xhr.onerror = () => {
        this.log.log('error load file:' + url);
        reject({ status: xhr.status, statusText: xhr.statusText });
      };
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      xhr.send();
    });

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

    // this.log.debug('loading text: ' + url);

    const promise = new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => resolve(xhr.response);
      xhr.onerror = () => {
        this.log.log('error load file:' + url);
        reject({ status: xhr.status, statusText: xhr.statusText });
      };
      xhr.open('GET', url, true);
      xhr.responseType = 'text';
      xhr.send(null);
    });

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
}

Lemmings.FileProvider = FileProvider;
export { FileProvider };
