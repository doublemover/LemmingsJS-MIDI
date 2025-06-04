import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LemmingsBootstrap.js';
import { NodeFileProvider } from './NodeFileProvider.js';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

function loadDefaultPack() {
    try {
        const cfgPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'config.json');
        const txt = fs.readFileSync(cfgPath, 'utf8');
        const cfg = JSON.parse(txt);
        return cfg[0]?.path || 'lemmings';
    } catch {
        return 'lemmings';
    }
}

(async () => {
    const pack = process.argv[2] || loadDefaultPack();
    const outDir = process.argv[3] || 'panel_export';
    const provider = new NodeFileProvider('.');
    const res = new Lemmings.GameResources(provider, { path: pack, level: { groups: [] }});
    const pal = new Lemmings.ColorPalette();
    const sprites = await res.getSkillPanelSprite(pal);
    const panel = sprites.getPanelSprite();
    const png = new PNG({ width: panel.width, height: panel.height });
    for (let y = 0; y < panel.height; y++) {
        for (let x = 0; x < panel.width; x++) {
            const idx = y * panel.width + x;
            const rgba = panel.data[idx];
            const pidx = idx * 4;
            png.data[pidx  ] = rgba & 0xFF;
            png.data[pidx+1] = (rgba >> 8) & 0xFF;
            png.data[pidx+2] = (rgba >> 16) & 0xFF;
            png.data[pidx+3] = (rgba >> 24) & 0xFF;
        }
    }
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = `${outDir}/panelSprite.png`;
    png.pack().pipe(fs.createWriteStream(outFile));
})();
