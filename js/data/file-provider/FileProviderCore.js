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
import { fileProviderCacheMethods } from './FileProviderCache.js';
import { fileProviderStorageMethods } from './FileProviderStorage.js';
import { fileProviderFetchMethods } from './FileProviderFetch.js';
import { fileProviderHashMethods } from './FileProviderHash.js';
class FileProvider extends BaseLogger {
  constructor(rootPath, options = {}) {
    super();
    this.rootPath = rootPath;
    this._cacheBustRevision = sanitizeCacheBust(
      options.cacheBustRevision ?? options.cacheBust ?? null
    );

    /**
       * Cache mapping full URL → Promise<BinaryReader> or Promise<string>.
       * Store the Promise itself so concurrent callers share one in‑flight XHR.
       * @type {Map<string, Promise<any>>}
       */
    this._cache = new Map();
    this._idbPromise = null;
    this._idb = null;
    this._idbDisabled = false;
    this._validationPromises = new Map();
    this._cacheStats = { localStorageBytes: 0, indexedDbBytes: 0 };
    this._storage = Object.hasOwn(options, 'localStorage')
      ? options.localStorage
      : undefined;
    this._indexedDB = Object.hasOwn(options, 'indexedDB')
      ? options.indexedDB
      : (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
    this._crypto = Object.hasOwn(options, 'crypto')
      ? options.crypto
      : null;
    this._hasFetchOverride = Object.hasOwn(options, 'fetch');
    this._fetch = this._hasFetchOverride ? options.fetch : null;
    this._hasXhrOverride = Object.hasOwn(options, 'XMLHttpRequest') ||
        Object.hasOwn(options, 'createXMLHttpRequest');
    this._XMLHttpRequest = Object.hasOwn(options, 'XMLHttpRequest')
      ? options.XMLHttpRequest
      : null;
    this._createXMLHttpRequest = typeof options.createXMLHttpRequest === 'function'
      ? options.createXMLHttpRequest
      : null;
  }

  _filenameFromUrl(url) {
    if (!url) return '';
    url = url.split('#')[0].split('?')[0];
    return url.substring(url.lastIndexOf('/') + 1);
  }
}
for (const methods of [
  fileProviderCacheMethods,
  fileProviderStorageMethods,
  fileProviderFetchMethods,
  fileProviderHashMethods
]) {
  Object.defineProperties(FileProvider.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { FileProvider };