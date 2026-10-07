"""Build alternative crown layers without replacing reviewed beret assets."""
from pathlib import Path
from PIL import Image
import json, hashlib, math
import build_accessory_layers as accessories

ROOT=Path(__file__).resolve().parents[2]
shapes=accessories.shapes
triangle=accessories.triangle
FITS=json.loads(Path(__file__).with_name('headwear-fits.json').read_text())['shapes']
PADDING=4

def bare_triangle(rows):
    # Exactly the crown reconstruction already used by the reviewed original
    # Hydro landing animation while its beret is in flight.
    rows=[list(row) for row in rows]
    for y,row in enumerate(rows):
        for x,p in enumerate(row):
            if p in 'oOn':row[x]='.'
    rows[1][5]='H'
    rows[2][4:7]=['H','B','b']
    rows[3][3]='H'
    return [''.join(row) for row in rows]

triangle.MASTER=bare_triangle(triangle.MASTER)
triangle.SQUAT=bare_triangle(triangle.SQUAT)

def headwear_image(sid,item,pose,width,height):
    im=Image.new('RGBA',(width,height))
    if pose is None or pose['w']<5:return im
    fit=FITS[sid][item];left,top,right,bottom=pose['crop']
    sx,sy=pose['w']/(right-left),pose['h']/(bottom-top)
    for y in range(height):
        for x in range(width):
            ux=math.floor(left+(x-pose['x']+0.5)/sx)
            uy=math.floor(top+(y-pose['y']-PADDING+0.5)/sy)
            if sid=='donut' and 3<=ux<7 and 3<=uy<5:continue
            if [ux,uy] in fit.get('foregroundPixels',[]):continue
            xx,yy=ux-fit['x'],uy-fit['y']
            if 0<=yy<len(fit['rows']) and 0<=xx<len(fit['rows'][0]):
                symbol=fit['rows'][yy][xx]
                if symbol!='.':im.putpixel((x,y),shapes.base.PAL[symbol])
    return im

def main():
    dest=ROOT/'assets/characters/headwear';dest.mkdir(exist_ok=True)
    for shape in accessories.CATALOG['shapes']:
        sid=shape['id'];is_triangle=sid=='rounded_triangle'
        original=json.loads((ROOT/shape['path']).read_text())
        if not is_triangle:shapes.SHAPE=next(s for s in shapes.DEFS['shapes'] if s['id']==sid)
        bare={k:original[k] for k in ['format','targetRevision','pixelFormat','transparentIndex','palette','symbols']}
        bare.update(name=sid+' alternative headwear',version=1,renderPaddingTop=PADDING,shapeId=sid,animations=[])
        patches=[None];patch_ids={None:0};animations=[]
        def encode(im,colors):
            box=im.getbbox()
            if not box:return 0
            im=im.crop(box)
            rows=[''.join(colors.get(im.getpixel((x,y)),'.') for x in range(im.width)) for y in range(im.height)]
            patch=[box[0],box[1],rows];key=json.dumps(patch,separators=(',',':'))
            if key not in patch_ids:patch_ids[key]=len(patches);patches.append(patch)
            return patch_ids[key]
        for contract in shapes.CONTRACT:
            state=contract['state'];direction=-1 if state=='SHRUGGING' and contract['dir']==0 else contract['dir']
            w,h=contract['width'],contract['height'];frames=[]
            items={key:[] for key in [*accessories.FITS[sid],*FITS[sid]]}
            for i in range(contract['frames']):
                accessories.POSE=None
                frame=(triangle.action if is_triangle else shapes.ORIGINAL_ACTION)(state,i,w,h,1)
                pose=accessories.POSE
                if state=='UMBRELLA':
                    body=Image.new('RGBA',(w,h))
                    raw=triangle.pixels(triangle.FLOAT_BODY) if is_triangle else shapes.body_master(hat=False).resize((9,7),Image.Resampling.NEAREST)
                    body.alpha_composite(raw,(4,9))
                    pose={'x':4,'y':9,'w':9,'h':7,'crop':(0,0,11,8),'body':body,'floating':True}
                # A destroyed body's hat disappears with it; do not retain the
                # old orange beret debris underneath a newly selected crown.
                if (state=='SPLATTING' and i>=3) or (state=='DROWNING' and i>=11):
                    for y in range(h):
                        for x in range(w):
                            if frame.getpixel((x,y)) in [shapes.base.PAL[k] for k in ['o','O','Y']]:frame.putpixel((x,y),(0,0,0,0))
                padded=Image.new('RGBA',(w,h+PADDING));padded.alpha_composite(frame,(0,PADDING))
                body=Image.new('RGBA',padded.size)
                if pose:body.alpha_composite(pose['body'],(0,PADDING))
                if state=='DIGGING' and i>=8:body=body.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                for item in items:
                    headwear=item in FITS[sid]
                    layer=headwear_image(sid,item,pose,w,h+PADDING) if headwear else accessories.overlay(sid,item,pose,w,h+PADDING,PADDING)
                    if state=='DIGGING' and i>=8:layer=layer.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                    for y in range(layer.height):
                        for x in range(layer.width):
                            # Preserve actual foreground action tools/strings.
                            actual=padded.getpixel((x,y))
                            if actual[3] and actual!=body.getpixel((x,y)):layer.putpixel((x,y),(0,0,0,0))
                    if direction<0:layer=shapes.base.mirror_pivot(layer)
                    colors={tuple(shapes.base.PAL[k]):k for k in ['o','O','Y']} if headwear else accessories.REVERSE
                    items[item].append(encode(layer,colors))
                if direction<0:padded=shapes.base.mirror_pivot(padded)
                frames.append(shapes.rows(padded))
            record={k:contract[k] for k in ['state','width','height','offsetX','offsetY']}
            record.update(height=h+PADDING,offsetY=contract['offsetY']-PADDING,direction=direction,frameCount=contract['frames'],frames=frames)
            bare['animations'].append(record)
            animations.append({'state':state,'direction':direction,'items':items})
        pack={'format':'hydro-headwear-layers-v1','shapeId':sid,'baseSha256':hashlib.sha256((ROOT/shape['path']).read_bytes()).hexdigest(),
          'bare':bare,'patches':patches,'animations':animations}
        (dest/f'{sid}.json').write_text(json.dumps(pack,separators=(',',':'))+'\n')
        print(f'{sid}: bare body plus {len(patches)-1} crown/attachment patches; 337 unchanged action frames')

if __name__=='__main__':main()
