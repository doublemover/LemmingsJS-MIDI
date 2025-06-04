import { Lemmings } from '../js/LemmingsNamespace.js';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

class NodeFileProvider {
    constructor(rootPath = '.') {
        this.rootPath = rootPath;
        this.zipCache = new Map();
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

    loadBinary(dir, filename) {
        if (/\.zip$/i.test(dir)) {
            const zip = this._getZip(dir);
            const entry = this._findZipEntry(zip, filename);
            if (!entry) throw new Error(`File ${filename} not found in ${dir}`);
            const data = entry.getData();
            const arr = new Uint8Array(data);
            return Promise.resolve(new Lemmings.BinaryReader(arr, 0, arr.length, filename, dir));
        }
        const fullPath = path.join(this.rootPath, dir, filename);
        const data = fs.readFileSync(fullPath);
        const arr = new Uint8Array(data);
        return Promise.resolve(new Lemmings.BinaryReader(arr, 0, arr.length, filename, dir));
    }

    loadString(file) {
        const m = file.match(/^(.*\.zip)\/(.+)$/i);
        if (m) {
            const zip = this._getZip(m[1]);
            const entry = this._findZipEntry(zip, m[2]);
            if (!entry) throw new Error(`File ${m[2]} not found in ${m[1]}`);
            return Promise.resolve(entry.getData().toString('utf8'));
        }
        const fullPath = path.join(this.rootPath, file);
        const txt = fs.readFileSync(fullPath, 'utf8');
        return Promise.resolve(txt);
    }
}

export { NodeFileProvider };
