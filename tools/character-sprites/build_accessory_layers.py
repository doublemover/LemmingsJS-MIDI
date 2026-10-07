"""Build sparse wearable layers around the unchanged reviewed sprite frames."""
from pathlib import Path
from PIL import Image
import importlib.util, json, hashlib, math
import build_shape as shapes

ROOT = Path(__file__).resolve().parents[2]
FITS = json.loads(Path(__file__).with_name('accessory-fits.json').read_text())['shapes']
CATALOG = json.loads((ROOT/'assets/characters/catalog.json').read_text())
COLORS = {'p': (231, 92, 166, 255), 'd': (32, 34, 40, 255), 'h': (177, 197, 211, 255)}
REVERSE = {v: k for k, v in COLORS.items()}
TRIANGLE_SPEC = importlib.util.spec_from_file_location('triangle_baseline', Path(__file__).with_name('hydro_baseline.py'))
triangle = importlib.util.module_from_spec(TRIANGLE_SPEC)
TRIANGLE_SPEC.loader.exec_module(triangle)
POSE = None

def capture_character(original, cropped=False):
    def character(width=16, height=10, bottom=9, hop=0, squat=False, direction=1, xshift=0, eyes='normal', scale=None):
        global POSE
        image = original(width, height, bottom, hop, squat, direction, xshift, eyes, scale)
        ow, oh = 11, 7 if squat else 8
        crop = (0, 0, ow, 8)
        if cropped and scale and scale[0] <= 4:
            box = shapes.body_master(squat, eyes).getbbox()
            crop = (box[0], box[1]*8/oh, box[2], box[3]*8/oh)
        pw, ph = scale or (ow, oh)
        POSE = {'x': (width-pw+1)//2+xshift, 'y': bottom-hop-ph+1, 'w': pw, 'h': ph,
                'crop': crop, 'body': image}
        return image
    return character

shapes.base.character = capture_character(shapes.character, True)
triangle.character = capture_character(triangle.character)

def overlay(shape, item, pose, width, height, padding):
    im = Image.new('RGBA', (width, height))
    if pose is None or pose['w'] < 5: return im
    fit = FITS[shape][item]
    left, top, right, bottom = pose['crop']
    sx, sy = pose['w']/(right-left), pose['h']/(bottom-top)
    fx, fy = fit['x'], fit['y']
    if shape == 'rounded_triangle' and pose.get('floating') and item not in ['headphones', 'bow']:
        # The original Hydro floating body was separately pixel-cleaned at 9x7.
        # Its eye centers are (4,3)/(6,3), not a second resize of the 11x8 face.
        sx = sy = 1; left = top = 0; fx -= 2; fy -= 1
    # Sample on the body's exact lattice. Independently rounding a small rim's
    # resized bounding box shifts the eye center during seven-pixel squash.
    for y in range(height):
        for x in range(width):
            ux = math.floor(left+(x-pose['x']+0.5)/sx)
            uy = math.floor(top+(y-pose['y']-padding+0.5)/sy)
            if shape == 'donut' and 3 <= ux < 7 and 3 <= uy < 5: continue
            px, py = ux-fx, uy-fy
            if 0 <= py < len(fit['rows']) and 0 <= px < len(fit['rows'][0]):
                symbol = fit['rows'][py][px]
                if symbol != '.': im.putpixel((x,y), COLORS[symbol])
    return im

def main():
    global POSE
    dest = ROOT/'assets/characters/accessories'
    dest.mkdir(exist_ok=True)
    for shape in CATALOG['shapes']:
        sid = shape['id']; manifest = json.loads((ROOT/shape['path']).read_text())
        is_triangle = sid == 'rounded_triangle'; padding = manifest.get('renderPaddingTop', 0)
        if not is_triangle: shapes.SHAPE = next(s for s in shapes.DEFS['shapes'] if s['id'] == sid)
        patches = [None]; patch_ids = {None: 0}
        def encode(im):
            box = im.getbbox()
            if not box: return 0
            im = im.crop(box)
            rows = [''.join(REVERSE.get(im.getpixel((x,y)), '.') for x in range(im.width)) for y in range(im.height)]
            patch = [box[0], box[1], rows]
            key = json.dumps(patch, separators=(',', ':'))
            if key not in patch_ids: patch_ids[key] = len(patches); patches.append(patch)
            return patch_ids[key]
        def layers(record, frame, state, index, direction, pose):
            body = Image.new('RGBA', (record['width'], record['height']))
            if pose: body.alpha_composite(pose['body'], (0, padding))
            if state == 'DIGGING' and index >= 8: body = body.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if direction < 0: body = shapes.base.mirror_pivot(body)
            result = {}
            for item in FITS[sid]:
                im = overlay(sid, item, pose, record['width'], record['height'], padding)
                if state == 'DIGGING' and index >= 8: im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                if direction < 0: im = shapes.base.mirror_pivot(im)
                for y in range(im.height):
                    for x in range(im.width):
                        if not im.getpixel((x,y))[3]: continue
                        symbol = frame[y][x]
                        actual = tuple(manifest['palette'][manifest['symbols'].index(symbol)])
                        # Keep the approved cap, moving canopy, foreground tools,
                        # water and effects in front of the wearable attachment.
                        if symbol in '16789A' or (actual[3] and actual != body.getpixel((x,y))):
                            im.putpixel((x,y), (0,0,0,0))
                result[item] = encode(im)
            return result
        animations = []
        for record in manifest['animations']:
            items = {key: [] for key in FITS[sid]}
            for i, frame in enumerate(record['frames']):
                POSE = None
                if record['state'] == 'UMBRELLA':
                    body = Image.new('RGBA', (record['width'], record['height']-padding))
                    raw = triangle.pixels(triangle.FLOAT_BODY) if is_triangle else shapes.body_master(hat=False).resize((9,7), Image.Resampling.NEAREST)
                    body.alpha_composite(raw, (4,9))
                    POSE = {'x':4, 'y':9, 'w':9, 'h':7, 'crop':(0,0,11,8), 'body':body, 'floating':True}
                else:
                    render = triangle.action if is_triangle else shapes.action
                    rendered = render(record['state'], i, record['width'], record['height']-padding, 1)
                    if record['direction'] >= 0:
                        expected = shapes.rows(rendered)
                        assert expected == frame, (sid, record['state'], i, 'baseline generator drift')
                current = layers(record, frame, record['state'], i, record['direction'], POSE)
                for item, patch in current.items(): items[item].append(patch)
            animations.append({'state':record['state'], 'direction':record['direction'], 'items':items})
        landing = []
        record = manifest['cosmetics']['beretLanding']
        for variant in record['variants']:
            items = {key: [] for key in FITS[sid]}
            for i, frame in enumerate(variant['frames']):
                raw = triangle.pixels(triangle.SQUAT if i in (1,6) else triangle.MASTER) if is_triangle else shapes.body_master(i in (1,6),hat=False)
                top = 16-raw.height-[0,0,1,2,2,1,0][i]
                body = Image.new('RGBA', (16,16)); body.alpha_composite(raw,(3,top))
                pose = {'x':3, 'y':top, 'w':11, 'h':raw.height, 'crop':(0,0,11,8), 'body':body}
                current = layers(record, frame, 'LANDING', i, variant['direction'], pose)
                for item, patch in current.items(): items[item].append(patch)
            landing.append({'direction':variant['direction'], 'startSway':variant['startSway'], 'items':items})
        pack = {'format':'hydro-accessory-layers-v1', 'shapeId':sid,
                'baseSha256':hashlib.sha256((ROOT/shape['path']).read_bytes()).hexdigest(),
                'patches':patches, 'animations':animations, 'landing':landing}
        (dest/f'{sid}.json').write_text(json.dumps(pack,separators=(',',':'))+'\n')
        print(f'{sid}: {len(patches)-1} unique patches across 379 frames; approved base matched')

if __name__ == '__main__': main()
