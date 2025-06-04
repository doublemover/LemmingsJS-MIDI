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

function frameToPNG(frame) {
    const png = new PNG({ width: frame.width, height: frame.height });
    for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
            const idx = y * frame.width + x;
            const rgba = frame.data[idx];
            const p = (y * frame.width + x) * 4;
            png.data[p    ] = rgba & 0xFF;
            png.data[p + 1] = (rgba >> 8) & 0xFF;
            png.data[p + 2] = (rgba >> 16) & 0xFF;
            png.data[p + 3] = (rgba >> 24) & 0xFF;
        }
    }
    return png;
}

(async () => {
    const dataPath = process.argv[2] || loadDefaultPack();
    const outDir = process.argv[3] || path.join('exports', `${dataPath.replace(/\W+/g, '_')}_sprites`);
    fs.mkdirSync(outDir, { recursive: true });

    const provider = new NodeFileProvider('.');
    const res = new Lemmings.GameResources(provider, { path: dataPath, level: { groups: [] }});

    // Ensure steel metadata is loaded before reading ground palettes
    await Lemmings.loadSteelSprites();

    // Load a colour palette from a ground set so sprites are coloured
    let pal = new Lemmings.ColorPalette();
    for (let g = 0; g < 5; g++) {
        try {
            const groundBuf = await provider.loadBinary(dataPath, `GROUND${g}O.DAT`);
            const vgaBuf    = await provider.loadBinary(dataPath, `VGAGR${g}.DAT`);
            const vgaContainer = new Lemmings.FileContainer(vgaBuf);
            const gr = new Lemmings.GroundReader(
                groundBuf,
                vgaContainer.getPart(0),
                vgaContainer.getPart(1)
            );
            pal = gr.colorPalette;
            break;
        } catch {
            // ignore missing ground sets
        }
    }

            const spriteDir = `${outDir}/lemmings/${name}/${dirName}`;
            fs.mkdirSync(spriteDir, { recursive: true });

            const sheet = new PNG({
                width: anim.frames[0].width * anim.frames.length,
                height: anim.frames[0].height
            });
                await new Promise(res =>
                    png.pack().pipe(fs.createWriteStream(`${spriteDir}/${i}.png`)).on('finish', res)
                );
            await new Promise(res =>
                sheet.pack().pipe(fs.createWriteStream(`${spriteDir}/sheet.png`)).on('finish', res)
            );
        try {
            const groundBuf = await provider.loadBinary(dataPath, `GROUND${g}O.DAT`);
            const vgaBuf    = await provider.loadBinary(dataPath, `VGAGR${g}.DAT`);
            const vgaContainer = new Lemmings.FileContainer(vgaBuf);
            const gr = new Lemmings.GroundReader(
                groundBuf,
                vgaContainer.getPart(0),
                vgaContainer.getPart(1)
            );
            pal = gr.colorPalette;
            break;
        } catch {
            // ignore missing ground sets
        }
    }

    const spriteSet = await res.getLemmingsSprite(pal);

    for (const [name, id] of Object.entries(Lemmings.SpriteTypes)) {
        for (const dir of [true, false]) {
            const anim = spriteSet.getAnimation(id, dir);
            if (!anim || !anim.frames || anim.frames.length === 0) continue;

            const dirName = dir ? 'right' : 'left';
            const spriteDir = `${outDir}/lemmings/${name}/${dirName}`;
            fs.mkdirSync(spriteDir, { recursive: true });

            const sheet = new PNG({
                width: anim.frames[0].width * anim.frames.length,
                height: anim.frames[0].height
            });

            for (let i = 0; i < anim.frames.length; i++) {
                const frame = anim.getFrame(i);
                const png = frameToPNG(frame);
                await new Promise(res =>
                    png.pack().pipe(fs.createWriteStream(`${spriteDir}/${i}.png`)).on('finish', res)
                );
                for (let y = 0; y < frame.height; y++) {
                    for (let x = 0; x < frame.width; x++) {
                        const idx = (y * frame.width + x) * 4;
                        const dest = ((y * sheet.width) + x + i * frame.width) * 4;
                        sheet.data[dest    ] = png.data[idx];
                        sheet.data[dest + 1] = png.data[idx + 1];
                        sheet.data[dest + 2] = png.data[idx + 2];
                        sheet.data[dest + 3] = png.data[idx + 3];
                    }
                }
            }

            await new Promise(res =>
                sheet.pack().pipe(fs.createWriteStream(`${spriteDir}/sheet.png`)).on('finish', res)
            );
        }
    }
})();
