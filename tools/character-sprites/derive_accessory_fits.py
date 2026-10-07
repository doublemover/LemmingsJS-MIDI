"""Reduce verified native picker layers to explicit, reviewable pixel fits.

The source directory is the recovered runtime's orbit-thumbnails directory.
This script does not download art or change the approved body/beret manifests.
"""
from pathlib import Path
from PIL import Image
import json, sys

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(sys.argv[1])
INDEX = json.loads((SOURCE / 'index.json').read_text())
SHAPES = json.loads(Path(__file__).with_name('shape-definitions.json').read_text())['shapes']
SHAPES = [{'id': 'rounded_triangle', 'mask': ['.....#.....', '....###....', '...#####...', '...####....', '...#####...', '..#######..', '.#########.', '..#######..'], 'eyeColumns': [6, 8], 'eyeRow': 4}, *SHAPES]
ITEMS = ['headphones', 'bow', 'monocle', 'tall_oval_frames', 'separate_trapezoid_lenses', 'classic_sunglasses', 'round_sunglasses']

def layer(placement):
    number, x, y = placement
    sha, width, height = INDEX['files'][number]
    im = Image.open(SOURCE / 'images' / (sha + '.png')).convert('RGBA')
    assert im.size == (width, height)
    return im, x, y, sha

def source_fit(shape, item):
    sid = 'circle' if shape['id'] == 'donut' else shape['id']
    category = 'accessory' if item in ['headphones', 'bow'] else 'eyewear'
    key = f'{sid}/{category}/{item}/light'
    body, bx, by, bsha = layer(INDEX['entries'][key][0])
    patch, px, py, psha = layer(INDEX['entries'][key][1])
    mask = Image.new('L', patch.size)
    for y in range(patch.height):
        for x in range(patch.width):
            r, g, b, a = patch.getpixel((x, y))
            if max(r, g, b) < 128:
                mask.putpixel((x, y), a)
    box = mask.getbbox()
    assert box, key
    occupied = [(x, y) for y, row in enumerate(shape['mask']) for x, p in enumerate(row) if p == '#']
    left, top = min(x for x, y in occupied), min(y for x, y in occupied)
    right, bottom = max(x for x, y in occupied), max(y for x, y in occupied)
    bodybox = body.getbbox()
    sx, sy = (right-left+1)/(bodybox[2]-bodybox[0]), (bottom-top+1)/(bodybox[3]-bodybox[1])
    width, height = max(1, round((box[2]-box[0])*sx)), max(1, round((box[3]-box[1])*sy))
    small = mask.crop(box).resize((width, height), Image.Resampling.BOX)
    rows = [''.join('p' if small.getpixel((x, y)) > 64 else '.' for x in range(width)) for y in range(height)]
    return {'recipe': key, 'bodyLayerHash': bsha, 'accessoryLayerHash': psha,
            'nativeBounds': [px+box[0], py+box[1], box[2]-box[0], box[3]-box[1]],
            'nativeBodyBounds': [bx+bodybox[0], by+bodybox[1], bodybox[2]-bodybox[0], bodybox[3]-bodybox[1]],
            'source': 'custom donut adaptation of native circle' if shape['id'] == 'donut' else 'native picker composition',
            'x': round(left+(px+box[0]-bx-bodybox[0])*sx),
            'y': round(top+(py+box[1]-by-bodybox[1])*sy), 'rows': rows}

profiles = {}
for shape in SHAPES:
    sid = shape['id']
    profiles[sid] = {}
    for item in ITEMS:
        fit = source_fit(shape, item)
        if item == 'bow':
            # A literal 5x2 knot remains readable without extending below the feet.
            fit.update(x=3, y=6, rows=['pp.pp', 'ppdpp'], reason='Native neck slot; two cloth wings meet a shadowed one-pixel knot at the lower body contour.')
        elif item == 'headphones':
            # Retain the native headband path. Dark pads distinguish hardware
            # from the independently colored band rather than recoloring eyes.
            rows = [list(r) for r in fit['rows']]
            width = len(rows[0])
            pad_bottom = [max(y for y, row in enumerate(rows) if any(p != '.' for p in row[start:end])) for start, end in [(0,2),(width-2,width)]]
            for y, row in enumerate(rows):
                for x, p in enumerate(row):
                    if p != '.' and ((x < 2 and y >= pad_bottom[0]-1) or (x >= width-2 and y >= pad_bottom[1]-1)): row[x] = 'd'
            fit['rows'] = [''.join(r) for r in rows]
            fit['reason'] = 'Native arch and side-pad fit; pad material stays dark and the band has its own palette.'
        else:
            left_eye, right_eye = shape['eyeColumns']
            y = shape['eyeRow']
            if item == 'monocle':
                fit.update(x=right_eye-1, y=y-1, rows=['.p..', 'p.p.', '.p..', '..p.'], reason='Open lens centered on the actual near eye; native trailing cord follows the cheek.')
            else:
                # The native two-lens silhouette is cleaned around the locked
                # eye columns, with open rims or fixed dark lens material.
                width = right_eye-left_eye+3
                rows = [['.']*width for _ in range(4 if item == 'tall_oval_frames' else 3)]
                for cx in [1, width-2]:
                    if item == 'tall_oval_frames':
                        rows[0][cx] = rows[3][cx] = 'p'
                        for yy in [1, 2]: rows[yy][cx-1] = rows[yy][cx+1] = 'p'
                    else:
                        # Keep a real gap between the two lenses. At the
                        # narrowest five-pixel face, three-pixel discs overlap.
                        outer = cx-1 if cx == 1 else cx+1
                        if item == 'round_sunglasses':
                            rows[0][cx] = 'h'; rows[2][cx] = 'd'
                            rows[1][cx] = rows[1][outer] = 'd'
                        else:
                            rows[0][cx] = rows[0][outer] = 'p'
                            rows[1][cx] = rows[1][outer] = 'd'
                            rows[2][cx] = 'd'
                if item in ['classic_sunglasses', 'round_sunglasses']:
                    for xx in range(2, width-2): rows[0 if item == 'classic_sunglasses' or sid == 'donut' else 1][xx] = 'p'
                fit.update(x=left_eye-1, y=y-1, rows=[''.join(r) for r in rows], reason='Native lens/rim type fitted to the actual eye columns; lenses and highlights retain separate materials.')
            if sid == 'donut':
                # Keep the literal center open. The glasses bridge follows the
                # upper rim rather than filling the ring's aperture.
                fit['reason'] += ' Custom ring fit keeps its central aperture transparent.'
        profiles[sid][item] = fit

out = {'format': 'hydro-accessory-fits-v1', 'symbols': {'.': 'transparent', 'p': 'palette', 'd': 'dark hardware/lens', 'h': 'lens highlight'}, 'shapes': profiles}
Path(__file__).with_name('accessory-fits.json').write_text(json.dumps(out, indent=2)+'\n')
print(f'Wrote {len(SHAPES)} bodies × {len(ITEMS)} native-informed fits.')
