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
import { fileProviderBudgetMethods } from './FileProviderBudget.js';
let nextProviderOwner = 0;
class FileProvider extends BaseLogger {
  constructor(rootPath, options = {}) {
    super();
    this.rootPath = rootPath;
    this._cacheBustRevision = sanitizeCacheBust(
      options.cacheBustRevision ?? options.cacheBust ?? null
    );

    /** Cached immutable acquisition promises. Binary and text use distinct keys. */
    this._cache = new Map();
    this._cacheSources = new Map();
    this._sourceRecords = new WeakMap();
    this._budgetAdapter = options.budgetAdapter || null;
    this._backgroundJobs = options.backgroundJobs || null;
    if (this._budgetAdapter && (typeof this._budgetAdapter.reserve !== 'function' || typeof this._budgetAdapter.release !== 'function')) throw new TypeError('A synchronous resource budget adapter is required');
    this._budgetOwner = options.budgetOwner || `asset-provider-${++nextProviderOwner}`;
    this._rawByteLeases = new Set();
    this._rawByteMetrics = { reservations: 0, denials: 0, retiredStorageCount: 0, evictedStorageCount: 0, evictedBytes: 0, peakReservedBytes: 0,
      binaryNetworkResponses: 0, binaryNetworkBytes: 0, hashInputCopies: 0, hashInputBytes: 0 };
    this._rawByteMetrics.byobResponses = 0; this._rawByteMetrics.estimatedStreamResponses = 0;
    this._rawByteMetrics.streamBufferAllocations = 0; this._rawByteMetrics.streamBufferCopies = 0; this._rawByteMetrics.streamBufferCopyBytes = 0;
    this._binaryTransport = options.binaryTransport ?? 'auto';
    if (!['auto', 'stream', 'xhr'].includes(this._binaryTransport)) throw new TypeError('Unknown binary resource transport');
    this._binaryChunkBytes = Number.isSafeInteger(options.binaryChunkBytes) ? Math.max(1, Math.min(1024 * 1024, options.binaryChunkBytes)) : 64 * 1024;
    this._requireByob = options.requireByob === true;
    this._unregisterBudgetEvictor = this._budgetAdapter?.registerEvictor?.(this._budgetOwner, request => this._evictRawCache(request));
    this._cacheEpoch = 0;
    this._requestVersions = new Map();
    this._disposed = false;
    this._pendingCacheWrites = new Set();
    this._retireCacheWrites = new Set();
    this._requests = new Set();
    this._requestQueue = [];
    this._activeRequestCount = 0;
    this._maxConcurrentRequests = Number.isInteger(options.maxConcurrentRequests) ? Math.max(1, options.maxConcurrentRequests) : 16;
    this._maxQueuedRequests = Number.isInteger(options.maxQueuedRequests) ? Math.max(0, options.maxQueuedRequests) : 128;
    this._consumerCounts = new Map();
    this._acquisitionRecords = new WeakMap();
    this._contentHashes = new WeakMap();
    this._failedHashPromises = new WeakSet();
    this._acquisitions = new Set();
    this._nextRequestId = 0;
    this._cacheTransactions = new Set();
    this._cacheTouchTimes = new Map();
    this._resourceLeases = new Set();
    this._disposeRequested = false;
    this._requestTimeoutMs = Number.isFinite(options.requestTimeoutMs) ? Math.max(1, options.requestTimeoutMs) : 15000;
    this._maxResponseBytes = Number.isSafeInteger(options.maxResponseBytes) ? Math.max(1, options.maxResponseBytes) : 64 * 1024 * 1024;
    this._idbPromise = null;
    this._idb = null;
    this._idbDisabled = false;
    this._idbOpenEpoch = 0;
    this._cacheProbeMs = Number.isFinite(options.cacheProbeMs) ? Math.max(1, options.cacheProbeMs) : 300;
    this._validationPromises = new Map();
    this._refreshes = new Map();
    this._cacheStats = { localStorageBytes: 0, indexedDbBytes: 0 };
    this._storage = Object.hasOwn(options, 'localStorage')
      ? options.localStorage
      : undefined;
    this._cacheLockManager = Object.hasOwn(options, 'cacheLockManager') ? options.cacheLockManager :
      (typeof navigator !== 'undefined' ? navigator.locks : null);
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
  fileProviderBudgetMethods,
  fileProviderHashMethods
]) {
  Object.defineProperties(FileProvider.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { FileProvider };
