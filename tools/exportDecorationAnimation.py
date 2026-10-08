"""Build the reviewed animated contact sheet from the exported runtime atlas.
Requires Pillow. Run after node tools/exportDecorationPack.js.
"""
from pathlib import Path
import json
from PIL import Image

root = Path(__file__).resolve().parent.parent
assets = root / 'assets/decorations/old-vegas'
manifest = json.loads((assets / 'pack.json').read_text())
atlas = Image.open(assets / 'atlas.png')
def preview_rank(piece):
    name = piece['id']
    return (0 if name.startswith('hydro-showgirl') else 1 if name == 'slot-reels' else
            2 if name.startswith('suit-') else 3 if name.startswith('card-') else
            4 if name.startswith('chips-') else 5)

preview_pieces = sorted(manifest['pieces'], key=preview_rank)
cell_width, cell_height = manifest['cellWidth'], manifest['cellHeight']
frames = []
for frame_index in range(manifest['frameCount']):
    output = Image.new('RGB', (cell_width*3, ((len(manifest['pieces']) + 2) // 3) * cell_height), '#120b12')
    for index, piece in enumerate(preview_pieces):
        x, y = frame_index * cell_width, piece['atlasRow'] * cell_height
        sprite = atlas.crop((x, y, x + piece['width'], y + piece['height']))
        # Keep native pixels; the larger atlas includes 192px performers.
        output.paste(sprite, ((index % 3) * cell_width + (cell_width - sprite.width) // 2,
                             (index // 3) * cell_height + (cell_height - sprite.height) // 2), sprite)
    frames.append(output)
frames[0].save(root / 'docs/previews/old-vegas-animation.gif', save_all=True,
               append_images=frames[1:], duration=120, loop=0, optimize=True)
