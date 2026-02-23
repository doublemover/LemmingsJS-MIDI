import * as Lemmings from '../js/exports.js';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { createExtractorFromFile, createExtractorFromData } from 'node-unrar-js';

class NodeFileProvider {
  constructor(rootPath = '.', options = {}) {
    this.rootPath = rootPath;
    this.zipCache = new Map();
    this.tarCache = new Map();
    this.rarCache = new Map();
    this.nxpCache = new Map();
    this._rar = options.rar || { createExtractorFromData, createExtractorFromFile };
  }

  /**
   * Clear all archive caches.
   */
  clearCache() {
    this.zipCache.clear();
    this.tarCache.clear();
    this.rarCache.clear();
    this.nxpCache.clear();
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
    if (path.isAbsolute(archivePath)) {
      return archivePath;
    }
    return this._validateEntry(archivePath);
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
    const cached = this.zipCache.get(abs);
    if (!this._isCacheValid(cached, stat)) {
      const zip = new AdmZip(abs);
      this.zipCache.set(abs, { ...stat, zip });
      return zip;
    }
    return cached.zip;
  }

  async _getTar(tarPath) {
    const abs = path.resolve(this.rootPath, tarPath);
    const stat = this._readArchiveStat(abs);
    const cached = this.tarCache.get(abs);
    if (!this._isCacheValid(cached, stat)) {
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
      this.tarCache.set(abs, { ...stat, map });
      return map;
    }
    return cached.map;
  }

  async _getRar(rarPath) {
    const abs = path.resolve(this.rootPath, rarPath);
    const stat = this._readArchiveStat(abs);
    const cached = this.rarCache.get(abs);
    if (!this._isCacheValid(cached, stat)) {
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
      this.rarCache.set(abs, { ...stat, map });
      return map;
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
    const cached = this.nxpCache.get(abs);
    if (this._isCacheValid(cached, stat)) return cached.map;

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
    this.nxpCache.set(abs, { ...stat, map });
    return map;
  }

  _findEntry(map, entryName) {
    const lower = entryName.replace(/\\/g, '/').toLowerCase();
    if (map.has(entryName)) return map.get(entryName);
    if (map.has(lower)) return map.get(lower);
    for (const [k, v] of map.entries()) {
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
        const eName = e.entryName.toLowerCase();
        return eName === lower || eName.endsWith('/' + lower);
      });
    }
    return entry;
  }

  async loadBinary(dir, filename) {
    filename = this._validateEntry(filename);
    const sourcePath = this._normalizeArchivePath(dir);
    if (/\.zip$/i.test(dir)) {
      const zip = this._getZip(sourcePath);
      const entry = this._findZipEntry(zip, filename);
      if (!entry) throw new Error(`File ${filename} not found in ${sourcePath}`);
      const buffer = entry.getData();
      const arr = new Uint8Array(buffer);
      return new Lemmings.BinaryReader(arr, 0, arr.length, filename, sourcePath);
    } else if (/(\.tar\.gz|\.tgz|\.tar)$/i.test(dir)) {
      const map = await this._getTar(sourcePath);
      const buf = this._findEntry(map, filename);
      if (!buf) throw new Error(`File ${filename} not found in ${sourcePath}`);
      const arr = new Uint8Array(buf);
      return new Lemmings.BinaryReader(arr, 0, arr.length, filename, sourcePath);
    } else if (/\.rar$/i.test(dir)) {
      const map = await this._getRar(sourcePath);
      const buf = this._findEntry(map, filename);
      if (!buf) throw new Error(`File ${filename} not found in ${sourcePath}`);
      const arr = new Uint8Array(buf);
      return new Lemmings.BinaryReader(arr, 0, arr.length, filename, sourcePath);
    } else if (/\.nxp$/i.test(dir)) {
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

  async loadString(file) {
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
