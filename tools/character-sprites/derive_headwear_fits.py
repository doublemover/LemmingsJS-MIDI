"""Native crown/lobe placements for the five remaining headwear styles."""
from pathlib import Path
from PIL import Image
import json, sys

SOURCE = Path(sys.argv[1])
INDEX = json.loads((SOURCE/'index.json').read_text())
SHAPES = json.loads(Path(__file__).with_name('shape-definitions.json').read_text())['shapes']
SHAPES = [{'id':'rounded_triangle','mask':['...........','.....#.....','....###....','...####....','...#####...','..#######..','.#########.','..#######..']}, *SHAPES]
ITEMS = ['beanie','hat','orb','three_lobe','crown']

def layer(placement):
    index,x,y=placement;sha,w,h=INDEX['files'][index]
    im=Image.open(SOURCE/'images'/f'{sha}.png').convert('RGBA')
    assert im.size==(w,h)
    return im,x,y,sha

profiles={}
for shape in SHAPES:
    sid=shape['id'];profiles[sid]={}
    for item in ITEMS:
        if sid in ['circle_two_ears','rounded_head_two_ears']:continue
        key=f'{"circle" if sid=="donut" else sid}/accessory/{item}/light'
        recipe=INDEX['entries'][key]
        body,bx,by,bsha=layer(recipe[0]);patch,px,py,psha=layer(recipe[1])
        mask=Image.new('L',patch.size)
        for y in range(patch.height):
            for x in range(patch.width):
                r,g,b,a=patch.getpixel((x,y))
                if max(r,g,b)<128:mask.putpixel((x,y),a)
        box=mask.getbbox();bodybox=body.getbbox()
        occupied=[(x,y) for y,row in enumerate(shape['mask']) for x,p in enumerate(row) if p=='#']
        left,top=min(x for x,y in occupied),min(y for x,y in occupied)
        right,bottom=max(x for x,y in occupied),max(y for x,y in occupied)
        sx,sy=(right-left+1)/(bodybox[2]-bodybox[0]),(bottom-top+1)/(bodybox[3]-bodybox[1])
        native_width,native_height=box[2]-box[0],box[3]-box[1]
        w=max(3,round(native_width*sx));h=max(3,round(native_height*sy))
        x=round(left+(px+box[0]-bx-bodybox[0])*sx)
        base_y=round(top+(py+box[3]-by-bodybox[1])*sy)
        if item=='orb':w=h=3
        if item=='three_lobe':w=max(5,w);h=max(4,h)
        if item=='crown':w=max(5,w);h=max(4,h)
        y=base_y-h
        small=mask.crop(box).resize((w,h),Image.Resampling.BOX)
        pixels={(xx,yy) for yy in range(h) for xx in range(w) if small.getpixel((xx,yy))>80}
        if item=='orb':pixels={(1,0),(0,1),(1,1),(2,1),(1,2)}
        if item=='crown':
            pixels={(w//2,0),(0,1),(w//2,1),(w-1,1)}
            pixels.update((xx,h-2) for xx in range(w))
            pixels.update((xx,h-1) for xx in range(1,w-1))
        rows=[''.join('.' if (xx,yy) not in pixels else 'o' if (xx,yy+1) not in pixels else 'Y' if item!='three_lobe' and (xx-1,yy) not in pixels and yy<h-1 else 'O' for xx in range(w)) for yy in range(h)]
        profiles[sid][item]={'source':'custom ring adaptation of native circle' if sid=='donut' else 'native picker composition','recipe':key,
          'bodyLayerHash':bsha,'accessoryLayerHash':psha,'nativeBounds':[px+box[0],py+box[1],native_width,native_height],
          'nativeBodyBounds':[bx+bodybox[0],by+bodybox[1],bodybox[2]-bodybox[0],bodybox[3]-bodybox[1]],
          'x':x,'y':y,'rows':rows,'reason':'Use this item’s native crown/lobe and width; its lowest band contacts that contour. Pixel cleanup preserves the dome or three-lobe/three-prong identity.'}

# Neither ear shape has native headwear recipes. The actual crown is below the
# ear tips; caps contact that crown and the blue ear tips occlude their edges.
for sid,crown_y,ear_pixels in [('circle_two_ears',1,[[4,0],[6,0]]),('rounded_head_two_ears',2,[[2,0],[3,0],[7,0],[8,0],[1,1],[2,1],[3,1],[7,1],[8,1],[9,1]])]:
    patterns={'beanie':['.OOO.','YOOOO','ooooo'], 'hat':['..OO..','.YOOO.','.OOOO.','oooooo'],
      'orb':['.Y.','YOO','.o.'], 'three_lobe':['..OO.','.OOOO','OOOOO','.ooo.'], 'crown':['..Y..','Y.O.O','OOOOO','.ooo.']}
    for item,rows in patterns.items():
        x=4 if item=='orb' else 3
        profiles[sid][item]={'source':'custom; native headwear recipe unavailable','x':x,'y':crown_y-len(rows)+1,
            'rows':rows,'foregroundPixels':ear_pixels,'reason':'Rest the band on the actual head crown between/around the ear bases; retain both ear tips in front. No floating ear-tip perch.'}

Path(__file__).with_name('headwear-fits.json').write_text(json.dumps({'format':'hydro-headwear-fits-v1','shapes':profiles},indent=2)+'\n')
print(f'Wrote {len(profiles)} bodies × five crown profiles; native fits and custom ear/ring fits labeled separately.')
