"""Decode classic references and export the casino neon/smoke runtime proof.
Usage: python tools/exportCasinoNeonSmokeProof.py [output-directory]
Requires the repository's Node dependencies and Pillow. No browser is needed.
"""
from pathlib import Path
import json
import subprocess
import sys
import tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'docs/previews'
OUTPUT.mkdir(parents=True, exist_ok=True)
NODE_EXPORT = r"""
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { NodeFileProvider } from './tools/NodeFileProvider.js';
import * as Lemmings from './js/exports.js';
import { createCasinoArchitecture, createCasinoSmokeHazard } from './js/decorations/CasinoArchitecture.js';
const output = process.argv[2];
function save(img, stem) {
  img.frames.forEach((frame, phase) => {
    const png = new PNG({ width: img.width, height: img.height });
    for (let i = 0; i < frame.length; i++) {
      if (frame[i] & 128) continue;
      const rgba = img.palette.getColor(frame[i]);
      png.data.set([rgba & 255, rgba >>> 8 & 255, rgba >>> 16 & 255, 255], i * 4);
    }
    fs.writeFileSync(path.join(output, `${stem}-${phase}.png`), PNG.sync.write(png));
  });
}
const provider = new NodeFileProvider('.');
await Lemmings.loadSteelSprites();
for (const [ground, object, stem] of [[2, 9, 'snow'], [3, 8, 'electric']]) {
  const dat = await provider.loadBinary('lemmings_ohNo', `GROUND${ground}O.DAT`);
  const vga = new Lemmings.FileContainer(await provider.loadBinary('lemmings_ohNo', `VGAGR${ground}.DAT`));
  const reader = new Lemmings.GroundReader(dat, vga.getPart(0), vga.getPart(1));
  save(reader.getObjectImages()[object], stem);
}
save(createCasinoSmokeHazard().image, 'smoke');
save(createCasinoArchitecture().pieces.find(p => p.id === 'casino-neon-crown').image, 'crown');
"""
try:
    TITLE = ImageFont.truetype('DejaVuSans.ttf', 24)
    TEXT = ImageFont.truetype('DejaVuSans.ttf', 17)
    SMALL = ImageFont.truetype('DejaVuSans.ttf', 14)
except OSError:
    TITLE = TEXT = SMALL = ImageFont.load_default()
BACKGROUND = '#130e1a'
WHITE = '#e9ecf2'
GOLD = '#ffdf83'

with tempfile.TemporaryDirectory(prefix='casino-neon-smoke-') as temporary:
    source = Path(temporary)
    subprocess.run(['node', '--input-type=module', '-', str(source)], input=NODE_EXPORT,
                   text=True, cwd=ROOT, check=True)

    def sprite(stem, phase, scale=1):
        image = Image.open(source / f'{stem}-{phase}.png').convert('RGBA')
        return image.resize((image.width * scale, image.height * scale), Image.Resampling.NEAREST)

    def stamp(image, stem, phase, x, y, scale=1):
        source_image = sprite(stem, phase, scale)
        image.paste(source_image, (x, y), source_image)

    reference = Image.new('RGB', (1200, 750), BACKGROUND)
    draw = ImageDraw.Draw(reference)
    draw.text((24, 16), 'CLASSIC SOURCE REVIEW / CASINO SMOKE AND NEON', font=TITLE, fill=GOLD)
    draw.text((24, 60), 'Decoded original Oh No! More Lemmings snow blower, GROUND2 object 9. 4x nearest-neighbor.', font=TEXT, fill=WHITE)
    for i, phase in enumerate([2, 4, 5, 8]):
        draw.text((24 + i * 296, 92), f'SOURCE FRAME {phase}', font=SMALL, fill=GOLD)
        stamp(reference, 'snow', phase, 24 + i * 296, 120, 4)
    draw.text((24, 240), 'Hard palette steps; irregular light clusters; open hooks and dissipating fragments.', font=TEXT, fill=WHITE)
    draw.text((24, 281), 'Original casino redraw, four gray shades. 2x nearest-neighbor; no alpha blur or ellipse puffs.', font=TEXT, fill=WHITE)
    for i, phase in enumerate([0, 4, 8, 12]):
        draw.text((24 + i * 296, 311), f'SMOKE FRAME {phase}', font=SMALL, fill=GOLD)
        stamp(reference, 'smoke', phase, 45 + i * 296, 337, 2)
    draw.text((24, 538), 'Light reference: Oh No brick electric trap, GROUND3 object 8, frame 3. 4x nearest-neighbor.', font=TEXT, fill=WHITE)
    stamp(reference, 'electric', 3, 24, 578, 4)
    draw.text((250, 606), 'Small hot core and hard color ramp informed the neon tubes.', font=TEXT, fill=WHITE)
    draw.text((250, 636), 'The five-point crown is new, continuous rounded geometry.', font=TEXT, fill=WHITE)
    reference.save(OUTPUT / 'casino-neon-smoke-source-review.png')

    frames = []
    for phase in range(16):
        image = Image.new('RGB', (1080, 740), BACKGROUND)
        draw = ImageDraw.Draw(image)
        draw.text((24, 16), 'CASINO / TUBE NEON AND CLASSIC-STYLE SMOKE', font=TITLE, fill=GOLD)
        draw.text((24, 55), 'Actual indexed runtime frames, nearest-neighbor. 16 frames x 60 ms = 960 ms loop.', font=TEXT, fill=WHITE)
        draw.text((24, 99), 'NATIVE SIZE / 192 x 80', font=SMALL, fill=GOLD)
        stamp(image, 'crown', phase, 24, 130)
        draw.text((326, 99), 'NATIVE SIZE / 96 x 88', font=SMALL, fill=GOLD)
        stamp(image, 'smoke', phase, 326, 130)
        draw.text((543, 119), f'PHASE {phase:02d} / 15', font=TEXT, fill=GOLD)
        draw.text((543, 153), 'White core stays connected through every crown bend.', font=SMALL, fill=WHITE)
        draw.text((543, 182), 'Smoke keeps gadget 11 and its original trigger contract.', font=SMALL, fill=WHITE)
        draw.text((24, 260), '3x PIXEL INSPECTION', font=TEXT, fill=GOLD)
        stamp(image, 'crown', phase, 20, 304, 3)
        stamp(image, 'smoke', phase, 745, 288, 3)
        draw.text((24, 598), 'PINK GLASS TUBE / CYAN BAND / STEADY CORE', font=SMALL, fill=GOLD)
        draw.text((24, 626), 'Rounded joins, symmetric three-pixel glow, restrained ray chase.', font=SMALL, fill=WHITE)
        draw.text((680, 598), 'CLUSTERED CURLS / OPEN NOTCHES', font=SMALL, fill=GOLD)
        draw.text((680, 626), 'Fixed four-shade palette; no smooth bubbles.', font=SMALL, fill=WHITE)
        draw.text((24, 694), 'Rendered directly from CasinoArchitecture.js. Gameplay dimensions and timing are unchanged.', font=SMALL, fill=WHITE)
        frames.append(image)
    frames[0].save(OUTPUT / 'casino-neon-smoke-proof.png')
    frames[0].save(OUTPUT / 'casino-neon-smoke-animation.gif', save_all=True,
                   append_images=frames[1:], duration=60, loop=0, optimize=False, disposal=2)
    print(json.dumps({'output': str(OUTPUT), 'frames': len(frames), 'duration_ms': 60}))
