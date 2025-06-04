import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

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

let packs;
if (process.argv.length > 2) {
  packs = process.argv.slice(2).map(p => ({ name: p, path: p }));
} else if (defaultPacks.length) {
  packs = defaultPacks;
} else {
  packs = [{ name: 'lemmings', path: 'lemmings' }];
}

for (const pack of packs) {
  const outDir = `export_${pack.name.replace(/\W+/g, '_')}`;
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Exporting ${pack.path} -> ${outDir}`);
  spawnSync('node', ['tools/exportAllSprites.js', pack.path, outDir], { stdio: 'inherit' });
}
