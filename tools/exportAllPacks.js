import { spawnSync } from 'child_process';
import fs from 'fs';

const packs = process.argv.length > 2 ? process.argv.slice(2) : [
    'lemmings',
    'lemmings_ohNo',
    'holiday93',
    'holiday94',
    'xmas91',
    'xmas92'
];

for (const pack of packs) {
    const outDir = `export_${pack.replace(/\W+/g, '_')}`;
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`Exporting ${pack} -> ${outDir}`);
    spawnSync('node', ['tools/exportAllSprites.js', pack, outDir], { stdio: 'inherit' });
}
