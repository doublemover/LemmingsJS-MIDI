import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { archiveDir } from './archiveDir.js';
let archive = null;
const packArgs = [];
for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--archive=(.+)$/);
    if (m) archive = m[1];
    else packArgs.push(arg);
}

if (packArgs.length) {
    packs = packArgs.map(p => ({ name: p, path: p }));
(async () => {
    for (const pack of packs) {
        const outDir = path.join('exports', pack.name.replace(/\W+/g, '_'));
        fs.mkdirSync(outDir, { recursive: true });
        console.log(`Exporting ${pack.path} -> ${outDir}`);
        spawnSync('node', ['tools/exportAllSprites.js', pack.path, outDir], { stdio: 'inherit' });
        if (archive) {
            await archiveDir(outDir, archive);
        }
    }
})();
        return [];
    }
}

const defaultPacks = loadConfig().map(p => ({ name: p.name, path: p.path }));

let packs;
if (process.argv.length > 2) {
    packs = process.argv.slice(2).map(p => ({ name: p, path: p }));
let archive = null;
const packArgs = [];
for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--archive=(.+)$/);
    if (m) archive = m[1];
    else packArgs.push(arg);
}

let packs;
if (packArgs.length) {
    packs = packArgs.map(p => ({ name: p, path: p }));
} else if (defaultPacks.length) {
    packs = defaultPacks;
} else {
    packs = [{ name: 'lemmings', path: 'lemmings' }];
}


(async () => {
    for (const pack of packs) {
        const outDir = path.join('exports', pack.name.replace(/\W+/g, '_'));
        fs.mkdirSync(outDir, { recursive: true });
        console.log(`Exporting ${pack.path} -> ${outDir}`);
        spawnSync('node', ['tools/exportAllSprites.js', pack.path, outDir], { stdio: 'inherit' });
        if (archive) {
            await archiveDir(outDir, archive);
        }
    }
})();
