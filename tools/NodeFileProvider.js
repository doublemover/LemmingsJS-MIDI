import { Lemmings } from '../js/LemmingsNamespace.js';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { createExtractorFromFile } from 'node-unrar-js';

class NodeFileProvider {
  constructor(rootPath = '.') {
    this.rootPath = rootPath;
    this.zipCache = new Map();
    this.tarCache = new Map();
    this.rarCache = new Map();
  }

  /**
   * Clear all archive caches.
   */
  clearCache() {
    this.zipCache.clear();
    this.tarCache.clear();
    this.rarCache.clear();
  }

  _validateEntry(name) {
    if (path.isAbsolute(name) || name.includes('..')) {
      throw new Error(`Invalid file path ${name}`);
    }
    return name.replace(/\\/g, '/');
  }

  _getZip(zipPath) {
    const abs = path.resolve(this.rootPath, zipPath);
    let zip = this.zipCache.get(abs);
    if (!zip) {
      zip = new AdmZip(abs);
      this.zipCache.set(abs, zip);
    }
    return zip;
  }

  async _getTar(tarPath) {
    const abs = path.resolve(this.rootPath, tarPath);
    let map = this.tarCache.get(abs);
    if (!map) {
      map = new Map();
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
      this.tarCache.set(abs, map);
    }
    return map;
  }

  async _getRar(rarPath) {
    const abs = path.resolve(this.rootPath, rarPath);
    let map = this.rarCache.get(abs);
    if (!map) {
      map = new Map();
      const extractor = await createExtractorFromFile({ filepath: abs });
      const list = extractor.getFileList();
      for (const h of list.fileHeaders) {
        if (h.flags.directory) continue;
        const res = extractor.extract({ files: [h.name] });
        const f = [...res.files][0];
        if (f && f.state === 'SUCCESS') {
          map.set(h.name.replace(/\\/g, '/'), Buffer.from(f.extraction));
        }
      }
      this.rarCache.set(abs, map);
    }
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
    if (/\.zip$/i.test(dir)) {
      const zip = this._getZip(dir);
      const entry = this._findZipEntry(zip, filename);
      if (!entry) throw new Error(`File ${filename} not found in ${dir}`);
      const buffer = entry.getData();
      const arr = new Uint8Array(buffer);
      return new Lemmings.BinaryReader(arr, 0, arr.length, filename, dir);
    } else if (/(\.tar\.gz|\.tgz|\.tar)$/i.test(dir)) {
      const map = await this._getTar(dir);
      const buf = this._findEntry(map, filename);
      if (!buf) throw new Error(`File ${filename} not found in ${dir}`);
      const arr = new Uint8Array(buf);
      return new Lemmings.BinaryReader(arr, 0, arr.length, filename, dir);
    } else if (/\.rar$/i.test(dir)) {
      const map = await this._getRar(dir);
      const buf = this._findEntry(map, filename);
      if (!buf) throw new Error(`File ${filename} not found in ${dir}`);
      const arr = new Uint8Array(buf);
      return new Lemmings.BinaryReader(arr, 0, arr.length, filename, dir);
    }
    const fullPath = path.isAbsolute(dir)
      ? path.join(dir, filename)
      : path.join(this.rootPath, dir, filename);
    const buffer = fs.readFileSync(fullPath);
    const arr = new Uint8Array(buffer);
    return new Lemmings.BinaryReader(arr, 0, arr.length, filename, dir);
  }

  async loadString(file) {
    const m = file.match(/^(.*\.(?:zip|tar(?:\.gz)?|tgz|rar))\/(.+)$/i);
    if (m) {
      const archive = m[1];
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
      }
    }
    const fullPath = path.isAbsolute(file)
      ? file
      : path.join(this.rootPath, file);
    return fs.readFileSync(fullPath, 'utf8');
  }
}

export { NodeFileProvider };
