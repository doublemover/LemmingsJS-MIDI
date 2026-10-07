"""Deterministic extension of the reviewed Hydro pixel pipeline.

Python 3 + Pillow. No renderer install, network, image synthesis, or game mutation.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import hashlib, json, math, sys, importlib.util

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('hydro_baseline', Path(__file__).with_name('hydro_baseline.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
DEFS = json.loads(Path(__file__).with_name('shape-definitions.json').read_text())
CONTRACT = json.loads(Path(__file__).with_name('original-sprite-contract.json').read_text())
REVIEWED = json.loads((ROOT/'assets/hydro/hydro-skin.json').read_text())
PALETTE = REVIEWED['palette']
SYMBOLS = REVIEWED['symbols']
COLOR_INDEX = {tuple(v):SYMBOLS[i] for i,v in enumerate(PALETTE)}
ORIGINAL_ACTION = base.action
SHAPE = None
FITS = json.loads(Path(__file__).with_name('beret-fits.json').read_text())
PADDING = 4
ATTACHMENT = None
HAT = ['.....oO....','...oOOOOn..','..oOOOOoo..']

def body_master(squat=False, eyes='normal', hat=True):
    rows = SHAPE['mask']
    mask = {(x,y) for y,row in enumerate(rows) for x,c in enumerate(row) if c=='#'}
    out = Image.new('RGBA',(11,8))
    for x,y in mask:
        # Fixed logical slots, matching Hydro. No resampling-generated colors.
        color = 'B'
        if (x,y+1) not in mask or (x+1,y) not in mask: color='b'
        elif (x-1,y) not in mask and y<6: color='H'
        elif y<3 and (x,y-1) not in mask: color='H'
        out.putpixel((x,y),base.PAL[color])
    for x in SHAPE['eyeColumns']:
        for y in (SHAPE['eyeRow'],SHAPE['eyeRow']+1):
            assert (x,y) in mask, (SHAPE['id'],x,y)
            if eyes!='closed' or y==SHAPE['eyeRow']+1:
                out.putpixel((x,y),base.PAL['e'])
    # Keep the original eight-pixel envelope, including its two-pixel hop.
    # The shallow beret occupies the crown only; the ring aperture starts below it.
    if squat: out=out.resize((11,7),Image.Resampling.NEAREST)
    return out

def character(width=16,height=10,bottom=9,hop=0,squat=False,direction=1,xshift=0,eyes='normal',scale=None):
    global ATTACHMENT
    out=Image.new('RGBA',(width,height))
    p=body_master(squat,eyes)
    original_size=p.size
    crop=(0,0,*p.size)
    if scale:
        # At the final 4x4 / 2x2 exit poses, sampling the padded 11px canvas
        # can miss an entire narrow body. Crop only at that tiny scale so the
        # original exit sequence remains visible through its final body tick.
        if scale[0]<=4:
            crop=p.getbbox();p=p.crop(crop)
        p=p.resize(scale,Image.Resampling.NEAREST)
    body_x=(width-p.width+1)//2+xshift;body_y=bottom-hop-p.height+1
    out.alpha_composite(p,(body_x,body_y))
    fit=FITS[SHAPE['id']];cap=base.pixels(fit['rows'])
    sx=p.width/(crop[2]-crop[0]);sy=p.height/(crop[3]-crop[1])
    cap=cap.resize((max(1,round(cap.width*sx)),max(1,round(cap.height*sy))),Image.Resampling.NEAREST)
    cap_x=body_x+round((fit['x']-crop[0])*sx)
    cap_y=body_y+round((fit['y']-crop[1])*sy)
    layer=Image.new('RGBA',(width,height+PADDING));layer.alpha_composite(cap,(cap_x,cap_y+PADDING))
    foreground=Image.new('RGBA',original_size)
    for fx,fy in fit.get('foregroundPixels',[]):
        if fx<original_size[0] and fy<original_size[1]:foreground.putpixel((fx,fy),body_master(squat,eyes).getpixel((fx,fy)))
    foreground=foreground.crop(crop).resize(p.size,Image.Resampling.NEAREST)
    occlusion=Image.new('RGBA',layer.size);occlusion.alpha_composite(foreground,(body_x,body_y+PADDING))
    ATTACHMENT=(out.copy(),layer,occlusion)
    return base.mirror_pivot(out) if direction<0 else out

def umbrella(i,w=16,h=16):
    # An action prop, with the original opening/sway timing; no wearable hat.
    out=Image.new('RGBA',(w,h)); d=ImageDraw.Draw(out)
    if i==0: cap,x,y=base.FLOAT_BERETS[0],4,8
    elif i==1: cap,x,y=base.FLOAT_BERETS[0],4,5
    elif i==2: cap,x,y=base.FLOAT_BERETS[2],4,3
    elif i==3: cap,x,y=base.FLOAT_BERETS[3],3,2
    else: cap,x,y=base.FLOAT_BERETS[4],2+{4:-1,5:0,6:1,7:0}[i],0
    if i>=2:
        base.line(d,(x+1,y+len(cap),6,11),'s')
        base.line(d,(x+len(cap[0])-2,y+len(cap),10,11),'s')
    elif i==1:
        base.line(d,(6,8,6,11),'s');base.line(d,(10,8,10,11),'s')
    body=body_master(hat=False).resize((9,7),Image.Resampling.NEAREST)
    out.alpha_composite(body,(4,9));out.alpha_composite(base.pixels(cap),(x,y))
    return out

def action(state,i,w,h,direction):
    global ATTACHMENT
    ATTACHMENT=None
    body=ORIGINAL_ACTION(state,i,w,h,1)
    out=Image.new('RGBA',(w,h+PADDING));out.alpha_composite(body,(0,PADDING))
    if ATTACHMENT:
        original,cap,occlusion=ATTACHMENT
        if state=='DIGGING' and i>=8:
            original=original.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            cap=cap.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            occlusion=occlusion.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        out.alpha_composite(cap,(0,0));out.alpha_composite(occlusion,(0,0))
        # Restore action tools/water after the cap, preserving their front layer.
        for y in range(min(h,original.height)):
            for x in range(w):
                if body.getpixel((x,y))!=original.getpixel((x,y)):
                    out.putpixel((x,y+PADDING),body.getpixel((x,y)))
    return base.mirror_pivot(out) if direction<0 else out

def landing_frame(i,direction,start_sway):
    hop=[0,0,1,2,2,1,0][i]
    squat=i in (1,6)
    body=body_master(squat,hat=False)
    top=16-body.height-hop
    out=Image.new('RGBA',(16,16));draw=ImageDraw.Draw(out)
    if i<=2:
        cap=base.pixels(base.FLOAT_BERETS[{0:4,1:3,2:2}[i]])
        x={0:2+start_sway,1:3,2:4}[i];y=[0,2,4][i]
        if i<2:
            base.line(draw,(x+1,y+cap.height,5,top+2),'s')
            base.line(draw,(x+cap.width-2,y+cap.height,11,top+2),'s')
    else:
        fit=FITS[SHAPE['id']];cap=base.pixels(fit['rows'])
        x=3+fit['x'];y=top+fit['y']+{3:-2,4:0,5:-1,6:0}[i]
    out.alpha_composite(body,(3,top))
    out.alpha_composite(cap,(x,y))
    if i>=3:
        for fx,fy in FITS[SHAPE['id']].get('foregroundPixels',[]):
            out.putpixel((3+fx,top+fy),body.getpixel((fx,fy)))
    padded=Image.new('RGBA',(16,16+PADDING));padded.alpha_composite(out,(0,PADDING))
    return base.mirror_pivot(padded) if direction<0 else padded

base.character=character
base.beret_umbrella=umbrella

def rows(im):
    return [''.join(COLOR_INDEX[im.getpixel((x,y))] for x in range(im.width)) for y in range(im.height)]

def build(shape_id):
    global SHAPE
    SHAPE = next(shape for shape in DEFS['shapes'] if shape['id'] == shape_id)
    manifest = {key:REVIEWED[key] for key in ['format','targetRevision','pixelFormat','transparentIndex','palette','symbols']}
    manifest.update({'name':'hydro '+shape_id,'version':3,'renderPaddingTop':PADDING,'shapeId':shape_id,'animations':[],
      'notes':['Native-informed crown beret fit; four-pixel cosmetic top padding leaves the body anchor and game collision unchanged.',
      'Original 337 frames, 28 strips, 18 states, pivots and gameplay timing retained.',
      'One beret lifts into the canopy, then folds and reattaches during unchanged walking motion. Final exit/death/effect poses change silhouette.']})
    for contract in CONTRACT:
        direction = -1 if contract['state']=='SHRUGGING' and contract['dir']==0 else contract['dir']
        frames = [action(contract['state'],i,contract['width'],contract['height'],direction) for i in range(contract['frames'])]
        record = {key:contract[key] for key in ['state','width','height','offsetX','offsetY']}
        record['height']+=PADDING;record['offsetY']-=PADDING
        record.update({'direction':direction,'sourceDirection':contract['dir'],'frameCount':contract['frames'], 'frames':[rows(frame) for frame in frames]})
        manifest['animations'].append(record)
    manifest['cosmetics']={'beretLanding':{'frameCount':7,'width':16,'height':16+PADDING,'offsetX':-8,'offsetY':-16-PADDING,
      'variants':[{'direction':direction,'startSway':sway,'frames':[rows(landing_frame(i,direction,sway)) for i in range(7)]}
        for direction in [-1,1] for sway in [-1,0,1]]}}
    path = ROOT/'assets/characters'/f'{shape_id}.json'
    path.write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    print(f'Built {shape_id}: {sum(len(a["frames"]) for a in manifest["animations"])} indexed frames')

if __name__ == '__main__':
    selected=sys.argv[1] if len(sys.argv)>1 else 'donut'
    for shape in DEFS['shapes']:
        if selected in ('all',shape['id']):build(shape['id'])
