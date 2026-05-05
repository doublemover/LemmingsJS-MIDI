import * as Lemmings from '../js/exports.js';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { createExtractorFromFile, createExtractorFromData } from 'node-unrar-js';

const DEFAULT_MAX_ARCHIVE_CACHE_ENTRIES = 8;
const DEFAULT_MAX_ARCHIVE_CACHE_BYTES = 64 * 1024 * 1024;

class NodeFileProvider {
  constructor(rootPath = '.', options = {}) {
    this.rootPath = rootPath;
    this.zipCache = new Map();
    this.tarCache = new Map();
    this.rarCache = new Map();
    this.nxpCache = new Map();
    this._rar = options.rar || { createExtractorFromData, createExtractorFromFile };
    this._archiveCacheLimits = {
      maxEntries: Number.isFinite(options.maxArchiveCacheEntries) && options.maxArchiveCacheEntries > 0
        ? Math.floor(options.maxArchiveCacheEntries)
        : DEFAULT_MAX_ARCHIVE_CACHE_ENTRIES,
      maxBytes: Number.isFinite(options.maxArchiveCacheBytes) && options.maxArchiveCacheBytes > 0
        ? Math.floor(options.maxArchiveCacheBytes)
        : DEFAULT_MAX_ARCHIVE_CACHE_BYTES
    };
    this._archiveCacheBytes = {
      zip: 0,
      tar: 0,
      rar: 0,
      nxp: 0
    };
  }

  /**
   * Clear all archive caches.
   */
  clearCache() {
    this.zipCache.clear();
    this.tarCache.clear();
    this.rarCache.clear();
    this.nxpCache.clear();
    this._archiveCacheBytes.zip = 0;
    this._archiveCacheBytes.tar = 0;
    this._archiveCacheBytes.rar = 0;
    this._archiveCacheBytes.nxp = 0;
  }

  getCacheStats() {
    return {
      maxEntries: this._archiveCacheLimits.maxEntries,
      maxBytes: this._archiveCacheLimits.maxBytes,
      zip: { entries: this.zipCache.size, bytes: this._archiveCacheBytes.zip },
      tar: { entries: this.tarCache.size, bytes: this._archiveCacheBytes.tar },
      rar: { entries: this.rarCache.size, bytes: this._archiveCacheBytes.rar },
      nxp: { entries: this.nxpCache.size, bytes: this._archiveCacheBytes.nxp }
    };
  }

  _estimateMapBytes(map) {
    let total = 0;
    for (const value of map?.values?.() || []) {
      total += value?.byteLength ?? value?.length ?? 0;
    }
    return total;
  }

  _readCachedArchive(kind, cache, key, stat) {
    const cached = cache.get(key);
    if (!cached) return null;
    if (!this._isCacheValid(cached, stat)) {
      cache.delete(key);
      this._archiveCacheBytes[kind] = Math.max(
        0,
        this._archiveCacheBytes[kind] - (cached.cacheBytes || 0)
      );
      return null;
    }
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  _rememberArchive(kind, cache, key, entry, cacheBytes = entry?.size || 0) {
    const previous = cache.get(key);
    if (previous) {
      cache.delete(key);
      this._archiveCacheBytes[kind] = Math.max(
        0,
        this._archiveCacheBytes[kind] - (previous.cacheBytes || 0)
      );
    }
    const next = {
      ...entry,
      cacheBytes: Math.max(0, Number.isFinite(cacheBytes) ? cacheBytes : 0)
    };
    cache.set(key, next);
    this._archiveCacheBytes[kind] += next.cacheBytes;
    while (
      cache.size > 1
      && (
        cache.size > this._archiveCacheLimits.maxEntries
        || this._archiveCacheBytes[kind] > this._archiveCacheLimits.maxBytes
      )
    ) {
      const oldestKey = cache.keys().next().value;
      const oldest = cache.get(oldestKey);
      cache.delete(oldestKey);
      this._archiveCacheBytes[kind] = Math.max(
        0,
        this._archiveCacheBytes[kind] - (oldest?.cacheBytes || 0)
      );
    }
    return next;
  }

  _validateEntry(name) {
    if (typeof name !== 'string') {
      throw new Error(`Invalid file path ${name}`);
    }
    if (path.isAbsolute(name)) {
      throw new Error(`Invalid file path ${name}`);
    }
    const normalized = name.replace(/\\/g, '/');
    if (
      normalized.includes('\0') ||
      normalized.split('/').some(segment => segment === '..')
    ) {
      throw new Error(`Invalid file path ${name}`);
    }
    return normalized;
  }

  _normalizeArchivePath(archivePath) {
    if (archivePath == null || archivePath === '') {
      return '.';
    }
    const normalizedPath = String(archivePath);
    if (path.isAbsolute(normalizedPath)) {
      return normalizedPath;
    }
    return this._validateEntry(normalizedPath);
  }

  /**
   * Normalize source paths like `pack.zip/` to `pack.zip` so archive detection
   * still works when callers append trailing separators.
   * @param {string} filePath
   * @returns {string}
   */
  _trimTrailingSeparators(filePath) {
    const trimmed = String(filePath).replace(/[\\/]+$/, '');
    return trimmed || filePath;
  }

  /**
   * Detect explicit `..` path traversal segments in a normalized archive key.
   * @param {string} filePath
   * @returns {boolean}
   */
  _containsTraversalSegment(filePath) {
    const normalized = String(filePath).replace(/\\/g, '/');
    return normalized.split('/').some(segment => segment === '..');
  }

  /**
   * Read the archive stat fields used by cache validation.
   * @param {string} absPath
   * @returns {{mtimeMs:number,size:number,ctimeMs:number}}
   */
  _readArchiveStat(absPath) {
    const stat = fs.statSync(absPath);
    return {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      ctimeMs: stat.ctimeMs
    };
  }

  /**
   * Determine whether a cached archive entry still matches filesystem metadata.
   * @param {object} cached
   * @param {{mtimeMs:number,size:number,ctimeMs:number}} stat
   * @returns {boolean}
   */
  _isCacheValid(cached, stat) {
    return !!cached &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size &&
      cached.ctimeMs === stat.ctimeMs;
  }

  _getZip(zipPath) {
    const abs = path.resolve(this.rootPath, zipPath);
    const stat = this._readArchiveStat(abs);
    const cached = this._readCachedArchive('zip', this.zipCache, abs, stat);
    if (!cached) {
      const zip = new AdmZip(abs);
      return this._rememberArchive('zip', this.zipCache, abs, { ...stat, zip }, stat.size).zip;
    }
    return cached.zip;
  }

  async _getTar(tarPath) {
    const abs = path.resolve(this.rootPath, tarPath);
    const stat = this._readArchiveStat(abs);
    const cached = this._readCachedArchive('tar', this.tarCache, abs, stat);
    if (!cached) {
      const map = new Map();
      await tar.t({
        file: abs,
        gzip: /(\.tar\.gz|\.tgz)$/i.test(tarPath),
        onentry: entry => {
          if (entry.type !== 'File') return;
          const chunks = [];
          entry.on('data', c => chunks.push(c));
          entry.on('end', () => {
            map.set(entry.path.replace(/\\/g, '/'), Buffer.concat(chunks));
          });
        },
      });
      return this._rememberArchive(
        'tar',
        this.tarCache,
        abs,
        { ...stat, map },
        this._estimateMapBytes(map)
      ).map;
    }
    return cached.map;
  }

  async _getRar(rarPath) {
    const abs = path.resolve(this.rootPath, rarPath);
    const stat = this._readArchiveStat(abs);
    const cached = this._readCachedArchive('rar', this.rarCache, abs, stat);
    if (!cached) {
      const map = new Map();
      const data = fs.readFileSync(abs);
      const extractor = await this._rar.createExtractorFromData({ data });
      const list = extractor.getFileList();
      const headers = [...list.fileHeaders];
      for (const h of headers) {
        if (h.flags.directory) continue;
        const res = extractor.extract({ files: [h.name] });
        const f = [...res.files][0];
        if (f && f.extraction) {
          map.set(h.name.replace(/\\/g, '/'), Buffer.from(f.extraction));
        }
      }
      return this._rememberArchive(
        'rar',
        this.rarCache,
        abs,
        { ...stat, map },
        this._estimateMapBytes(map)
      ).map;
    }
    return cached.map;
  }

  /**
   * Parse legacy Flexi Toolkit `.nxp` archives:
   * - uint32le entry count
   * - table entries (36 bytes): name[28], offset uint32le, size uint32le
   * - payload bytes follow immediately after the table
   */
  _getNxp(nxpPath) {
    const abs = path.resolve(this.rootPath, nxpPath);
    const stat = this._readArchiveStat(abs);
    const cached = this._readCachedArchive('nxp', this.nxpCache, abs, stat);
    if (cached) return cached.map;

    const data = fs.readFileSync(abs);
    if (data.length < 4) {
      throw new Error(`Invalid NXP archive: ${nxpPath}`);
    }
    const entryCount = data.readUInt32LE(0);
    const TABLE_ENTRY_SIZE = 36;
    const tableSize = 4 + (entryCount * TABLE_ENTRY_SIZE);
    if (tableSize > data.length) {
      throw new Error(`Invalid NXP table size in ${nxpPath}`);
    }

    const map = new Map();
    for (let i = 0; i < entryCount; i += 1) {
      const base = 4 + (i * TABLE_ENTRY_SIZE);
      const nameRaw = data.subarray(base, base + 28);
      const zero = nameRaw.indexOf(0);
      const name = nameRaw.subarray(0, zero >= 0 ? zero : nameRaw.length)
        .toString('utf8')
        .replace(/\\/g, '/');
      const offset = data.readUInt32LE(base + 28);
      const size = data.readUInt32LE(base + 32);
      if (!name) continue;
      if ((offset + size) > data.length) {
        throw new Error(`Invalid NXP entry bounds for ${name} in ${nxpPath}`);
      }
      map.set(name, data.subarray(offset, offset + size));
    }
    return this._rememberArchive(
      'nxp',
      this.nxpCache,
      abs,
      { ...stat, map },
      this._estimateMapBytes(map)
    ).map;
  }

  _findEntry(map, entryName) {
    const lower = entryName.replace(/\\/g, '/').toLowerCase();
    if (map.has(entryName)) return map.get(entryName);
    if (map.has(lower)) return map.get(lower);
    for (const [k, v] of map.entries()) {
      if (this._containsTraversalSegment(k)) continue;
      const l = k.toLowerCase();
      if (l === lower || l.endsWith('/' + lower)) return v;
    }
    return null;
  }

  _findZipEntry(zip, entryName) {
    const lower = entryName.replace(/\\/g, '/').toLowerCase();
    let entry = zip.getEntry(entryName) || zip.getEntry(lower);
    if (!entry) {
      entry = zip.getEntries().find(e => {
        if (this._containsTraversalSegment(e.entryName)) return false;
        const eName = e.entryName.toLowerCase();
        return eName === lower || eName.endsWith('/' + lower);
      });
    }
    return entry;
  }

  /**
   * Load a binary file either from a directory or from a supported archive.
   * @param {string} [dir='.'] Directory or archive path.
   * @param {string} filename Archive entry or file name.
   * @returns {Promise<Lemmings.BinaryReader>}
   */
  async loadBinary(dir = '.', filename) {
    filename = this._validateEntry(filename);
    const sourcePath = this._trimTrailingSeparators(this._normalizeArchivePath(dir));
    if (/\.zip$/i.test(sourcePath)) {
      const zip = this._getZip(sourcePath);
      const entry = this._findZipEntry(zip, filename);
      if (!entry) throw new Error(`File ${filename} not found in ${sourcePath}`);
      const buffer = entry.getData();
      const arr = new Uint8Array(buffer);
      return new Lemmings.BinaryReader(arr, 0, arr.length, filename, sourcePath);
    } else if (/(\.tar\.gz|\.tgz|\.tar)$/i.test(sourcePath)) {
      const map = await this._getTar(sourcePath);
      const buf = this._findEntry(map, filename);
      if (!buf) throw new Error(`File ${filename} not found in ${sourcePath}`);
      const arr = new Uint8Array(buf);
      return new Lemmings.BinaryReader(arr, 0, arr.length, filename, sourcePath);
    } else if (/\.rar$/i.test(sourcePath)) {
      const map = await this._getRar(sourcePath);
      const buf = this._findEntry(map, filename);
      if (!buf) throw new Error(`File ${filename} not found in ${sourcePath}`);
      const arr = new Uint8Array(buf);
      return new Lemmings.BinaryReader(arr, 0, arr.length, filename, sourcePath);
    } else if (/\.nxp$/i.test(sourcePath)) {
      const map = this._getNxp(sourcePath);
      const buf = this._findEntry(map, filename);
      if (!buf) throw new Error(`File ${filename} not found in ${sourcePath}`);
      const arr = new Uint8Array(buf);
      return new Lemmings.BinaryReader(arr, 0, arr.length, filename, sourcePath);
    }
    const fullPath = path.isAbsolute(sourcePath)
      ? path.join(sourcePath, filename)
      : path.join(this.rootPath, sourcePath, filename);
    const buffer = fs.readFileSync(fullPath);
    const arr = new Uint8Array(buffer);
    return new Lemmings.BinaryReader(arr, 0, arr.length, filename, sourcePath);
  }

  /**
   * Load UTF-8 text from either the filesystem or an archive URL-like path.
   * @param {string} file
   * @returns {Promise<string>}
   */
  async loadString(file) {
    if (typeof file !== 'string') {
      throw new Error(`Invalid file path ${file}`);
    }
    file = file.replace(/\\/g, '/');
    const m = file.match(/^(.*\.(?:zip|tar(?:\.gz)?|tgz|rar|nxp))\/(.+)$/i);
    if (m) {
      const archive = this._normalizeArchivePath(m[1]);
      const entryName = this._validateEntry(m[2]);
      if (/\.zip$/i.test(archive)) {
        const zip = this._getZip(archive);
        const entry = this._findZipEntry(zip, entryName);
        if (!entry) throw new Error(`File ${entryName} not found in ${archive}`);
        return entry.getData().toString('utf8');
      } else if (/(\.tar\.gz|\.tgz|\.tar)$/i.test(archive)) {
        const map = await this._getTar(archive);
        const buf = this._findEntry(map, entryName);
        if (!buf) throw new Error(`File ${entryName} not found in ${archive}`);
        return Buffer.from(buf).toString('utf8');
      } else if (/\.rar$/i.test(archive)) {
        const map = await this._getRar(archive);
        const buf = this._findEntry(map, entryName);
        if (!buf) throw new Error(`File ${entryName} not found in ${archive}`);
        return Buffer.from(buf).toString('utf8');
      } else if (/\.nxp$/i.test(archive)) {
        const map = this._getNxp(archive);
        const buf = this._findEntry(map, entryName);
        if (!buf) throw new Error(`File ${entryName} not found in ${archive}`);
        return Buffer.from(buf).toString('utf8');
      }
    }
    const fullPath = path.isAbsolute(file)
      ? file
      : path.join(this.rootPath, this._validateEntry(file));
    return fs.readFileSync(fullPath, 'utf8');
  }
}

export { NodeFileProvider };
