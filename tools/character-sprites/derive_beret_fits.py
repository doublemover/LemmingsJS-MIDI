"""Derive pixel attachment profiles from verified native picker placement recipes."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json,sys,math
ROOT=Path(__file__).resolve().parents[2]
SOURCE=Path(sys.argv[1])
index=json.loads((SOURCE/'index.json').read_text())
shapes=json.loads(Path(__file__).with_name('shape-definitions.json').read_text())['shapes']
profiles={}
def image_layer(placement):
    file,x,y=placement;sha,w,h=index['files'][file]
    image=Image.open(SOURCE/'images'/f'{sha}.png').convert('RGBA')
    assert image.size==(w,h)
    return image,x,y,sha
for shape in shapes:
    sid=shape['id'];key=f'{sid}/accessory/beret/light';recipe=index['entries'].get(key)
    if not recipe:continue
    body,bx,by,bsha=image_layer(recipe[0]);patch,px,py,psha=image_layer(recipe[1])
    # Native neutral body is white; the beret patch is charcoal. Keep real alpha.
    hat=Image.new('RGBA',patch.size)
    for y in range(patch.height):
        for x in range(patch.width):
            r,g,b,a=patch.getpixel((x,y))
            if a>127 and max(r,g,b)<128:hat.putpixel((x,y),(r,g,b,255))
    box=hat.getbbox();hat=hat.crop(box)
    mask={(x,y) for y,row in enumerate(shape['mask']) for x,v in enumerate(row) if v=='#'}
    left=min(x for x,y in mask);right=max(x for x,y in mask);top=min(y for x,y in mask);bottom=max(y for x,y in mask)
    bodybox=body.getbbox();sx=(right-left+1)/(bodybox[2]-bodybox[0]);sy=(bottom-top+1)/(bodybox[3]-bodybox[1])
    x=round(left+(px+box[0]-bx-bodybox[0])*sx);y=round(top+(py+box[1]-by-bodybox[1])*sy)
    width=max(4,round(hat.width*sx));height=max(3,round(hat.height*sy))
    small=hat.resize((width,height),Image.Resampling.NEAREST)
    shades=sorted(sum(p[:3])/3 for p in small.getdata() if p[3]);low=shades[len(shades)//3];high=shades[len(shades)*2//3]
    rows=[]
    for yy in range(height):
        row=''
        for xx in range(width):
            r,g,b,a=small.getpixel((xx,yy));v=(r+g+b)/3
            row+='.' if not a else 'o' if v<=low else 'Y' if v>=high else 'O'
        rows.append(row)
    # Repaint the native charcoal mask with the reviewed logical cloth slots.
    # A dominant orange dome and a shadowed lower brim read at one game pixel.
    occupied={(xx,yy) for yy,row in enumerate(rows) for xx,c in enumerate(row) if c!='.'}
    rows=[''.join('.' if (xx,yy) not in occupied else 'o' if (xx,yy+1) not in occupied else 'Y' if (xx-1,yy) not in occupied and yy<2 else 'O' for xx in range(width)) for yy in range(height)]
    profiles[sid]={'source':'native picker composition','recipe':key,'bodyLayer':{'hash':bsha,'x':bx,'y':by,'width':body.width,'height':body.height},'hatLayer':{'hash':psha,'x':px,'y':py,'width':patch.width,'height':patch.height},'nativeHatBounds':[px+box[0],py+box[1],hat.width,hat.height],'x':x,'y':y,'rows':rows,'reason':'Rest on the native upper-left crown/lobe; preserve the source slope and exposed right-hand contour.'}
# No native recipes exist for the two ear bodies. These are explicit custom fits.
profiles['circle_two_ears']={'source':'custom; native recipe unavailable','x':2,'y':-1,'rows':['...O.','.OOOO','oOOOo','o....'],'foregroundPixels':[[4,0],[6,0]],'reason':'Cap brim contacts the actual three-pixel head crown below the ear tips; both ear tips draw in front through the cap edge.'}
profiles['rounded_head_two_ears']={'source':'custom; native recipe unavailable','x':0,'y':-2,'rows':['...O..','.OOOOO','oOOOOo','oo....'],'reason':'Perch over the left crown lobe; leave the tall right lobe exposed rather than bridging both ears.'}
profiles['donut']={**profiles['circle'],'source':'custom ring adaptation of native circle fit','reason':'Rest above the ring upper-left outer crown. Keep the entire central aperture clear; do not use it as a forehead.'}
profiles['rounded_triangle']={'source':'reviewed original Hydro manifest retained','reason':'Preserve the established original silhouette and beret; no regenerated replacement.'}
Path(__file__).with_name('beret-fits.json').write_text(json.dumps(profiles,indent=2)+'\n')
print(json.dumps({k:{p:v for p,v in x.items() if p in ['x','y','rows','source']} for k,x in profiles.items()},indent=2))
