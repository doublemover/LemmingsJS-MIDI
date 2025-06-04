import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { archiveDir } from './archiveDir.js';

function loadConfig() {
    try {
        const cfgPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'config.json');
        const txt = fs.readFileSync(cfgPath, 'utf8');
        return JSON.parse(txt);
    } catch {
        return [];
    }
}

const defaultPacks = loadConfig().map(p => ({ name: p.name, path: p.path }));

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
