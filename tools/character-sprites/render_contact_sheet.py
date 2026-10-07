"""Compose exact PixelSpriteSkin decoder PNGs; never synthesizes sprite pixels."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'temp/live-instrument'
SOURCE = OUT/'decoded-characters'
receipt = json.loads((SOURCE/'receipt.json').read_text())
def font(size):
    return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',size)
def checker(image, box, cell=8):
    d=ImageDraw.Draw(image)
    x,y,w,h=box
    for yy in range(y,y+h,cell):
        for xx in range(x,x+w,cell):
            d.rectangle((xx,yy,min(xx+cell-1,x+w-1),min(yy+cell-1,y+h-1)),fill='#d4dce3' if ((xx-x)//cell+(yy-y)//cell)%2 else '#eff3f7')
def paste(image, filename, x,y,scale=6):
    source=Image.open(SOURCE/filename).convert('RGBA')
    source=source.resize((source.width*scale,source.height*scale),Image.Resampling.NEAREST)
    image.paste(source,(x,y),source)

shapes=list(dict.fromkeys(f['shape'] for f in receipt['frames']))
shapes.remove('donut');shapes.insert(0,'donut')
im=Image.new('RGB',(1510,1600),'#111a27');d=ImageDraw.Draw(im)
d.text((24,20),'12 dot bodies × every current native body color',font=font(28),fill='#f5eee3')
d.text((24,62),'Actual game decoder pixels · 108 combinations · 6× nearest-neighbor · transparent holes show the checkerboard',font=font(17),fill='#b9c9da')
for ci,color in enumerate(receipt['bodyColors']):
    x=260+ci*136
    d.text((x,105),color['label'],font=font(17),fill=color['hex'])
    d.text((x,131),color['hex'],font=font(13),fill='#b9c9da')
for ri,shape in enumerate(shapes):
    y=164+ri*104
    frame=next(f for f in receipt['frames'] if f['shape']==shape)
    words=frame['label'].split();lines=['']
    for word in words:
        if len(lines[-1]+' '+word)>21:lines.append(word)
        else:lines[-1]=(lines[-1]+' '+word).strip()
    for li,line in enumerate(lines):d.text((24,y+10+li*22),line,font=font(18),fill='#f5c879' if shape=='donut' else '#f5eee3')
    for ci,color in enumerate(receipt['bodyColors']):
        x=260+ci*136
        checker(im,(x,y,112,96),8)
        p=Image.open(SOURCE/f'{shape}-{color["id"]}.png');paste(im,f'{shape}-{color["id"]}.png',x+8,y+88-p.height*6)
d.text((24,1430),'All 11 native prop colors (independent of body)',font=font(20),fill='#f5eee3')
for ci,color in enumerate(receipt['propColors']):
    x=24+ci*134
    d.rectangle((x,1470,x+108,1491),fill=color['hex'])
    d.text((x,1499),color['label'],font=font(15),fill='#f5eee3')
    d.text((x,1521),color['hex'],font=font(13),fill='#b9c9da')
d.text((24,1550),'Current native catalog: 9 body colors, 11 prop colors. Original Hydro palette and custom colors remain selectable.',font=font(16),fill='#b9c9da')
d.text((24,1575),'Sprite contact sheet, not a browser gameplay capture. Donut is the requested literal ring; eyes stay on its rim.',font=font(16),fill='#b9c9da')
im.save(OUT/'Current-Dot-Shapes-All-Native-Colors.png')

im=Image.new('RGB',(1110,810),'#111a27');d=ImageDraw.Draw(im)
d.text((24,20),'Donut: real transparent center, original action attachments',font=font(26),fill='#f5eee3')
d.text((24,64),'Current decoder · all 18 action states · terminal death / exit effects intentionally change silhouette',font=font(17),fill='#b9c9da')
for i,frame in enumerate(receipt['donutActions']):
    x=24+i%6*180;y=108+i//6*222
    checker(im,(x,y,156,164))
    scale=4 if frame['width']==32 else 7
    paste(im,frame['filename'],x+(156-frame['width']*scale)//2,y+(164-frame['height']*scale)//2,scale)
    d.text((x,y+176),frame['state'].title(),font=font(16),fill='#f5eee3')
    d.text((x,y+199),f'frame {frame["index"]}',font=font(13),fill='#b9c9da')
im.save(OUT/'Donut-Current-Decoder-Action-Sheet.png')
frames=[]
for index in range(8):
    im=Image.new('RGB',(1270,210),'#111a27');d=ImageDraw.Draw(im)
    d.text((24,16),'Donut walking: every body color, transparent centers',font=font(24),fill='#f5eee3')
    for ci,color in enumerate(receipt['bodyColors']):
        x=24+ci*138
        checker(im,(x,65,120,88))
        paste(im,f'donut-walk-{color["id"]}-{index}.png',x+4,75,7)
        d.text((x,168),color['label'],font=font(16),fill='#f5eee3')
    frames.append(im)
frames[0].save(OUT/'Donut-All-Colors-Walking.gif',save_all=True,append_images=frames[1:],duration=60,loop=0,disposal=2)
print('Composed shape-by-color sheet, donut action sheet, and 8-frame color animation.')

im=Image.new('RGB',(1780,1480),'#111a27');d=ImageDraw.Draw(im)
d.text((24,20),'Every body wears the beret · all 11 native hat colors',font=font(28),fill='#f5eee3')
d.text((24,62),'132 current-decoder combinations · independent body and hat palettes · checkerboards expose real transparency',font=font(17),fill='#b9c9da')
for ci,color in enumerate(receipt['propColors']):
    x=260+ci*136
    d.text((x,105),color['label'],font=font(17),fill=color['hex'] if color['id']!='charcoal' else '#b9c9da')
    d.text((x,131),color['hex'],font=font(13),fill='#b9c9da')
for ri,shape in enumerate(shapes):
    y=164+ri*104
    label=next(f['label'] for f in receipt['hats'] if f['shape']==shape)
    words=label.split();lines=['']
    for word in words:
        if len(lines[-1]+' '+word)>21:lines.append(word)
        else:lines[-1]=(lines[-1]+' '+word).strip()
    for li,line in enumerate(lines):d.text((24,y+10+li*22),line,font=font(18),fill='#f5eee3')
    for ci,color in enumerate(receipt['propColors']):
        x=260+ci*136
        checker(im,(x,y,112,96))
        p=Image.open(SOURCE/f'hat-{shape}-{color["id"]}.png');paste(im,f'hat-{shape}-{color["id"]}.png',x+8,y+88-p.height*6)
d.text((24,1440),'The same hat opens as the parachute and reattaches on landing. Original orange remains available too.',font=font(18),fill='#b9c9da')
im.save(OUT/'All-Bodies-All-Beret-Colors.png')

states=list(dict.fromkeys(f['state'] for f in receipt['poses']))
im=Image.new('RGB',(1880,1350),'#111a27');d=ImageDraw.Draw(im)
d.text((20,20),'Beret fit audit · all 12 bodies × all 18 action states',font=font(27),fill='#f5eee3')
for ci,state in enumerate(states):d.text((240+ci*90,85),state[:8].title(),font=font(11),fill='#b9c9da')
for ri,shape in enumerate(shapes):
    y=110+ri*100
    d.text((20,y+18),shape.replace('_',' ')[:24],font=font(14),fill='#f5eee3')
    for ci,state in enumerate(states):
        frame=next(f for f in receipt['poses'] if f['shape']==shape and f['state']==state)
        x=240+ci*90;checker(im,(x,y,84,80),6)
        scale=2 if frame['width']==32 else 4
        paste(im,frame['filename'],x+(84-frame['width']*scale)//2,y+(80-frame['height']*scale)//2,scale)
im.save(OUT/'All-Beret-Bodies-Action-Audit.png')

frames=[]
for index in range(23):
    im=Image.new('RGB',(1120,790),'#111a27');d=ImageDraw.Draw(im)
    phase='Walk' if index<8 else 'Hat lifts / opens' if index<16 else 'Hat folds / reattaches'
    d.text((24,20),f'Every body: {phase}',font=font(27),fill='#f5eee3')
    for ri,shape in enumerate(shapes):
        item=next(row for row in receipt['hatMotion'] if row['shape']==shape);frame=item['motion'][index]
        x=24+ri%4*276;y=76+ri//4*232
        checker(im,(x,y,248,174))
        # Same world-space foot anchor across 10px and 16px cells.
        paste(im,frame['filename'],x+60,y+148-frame['height']*8,8)
        d.text((x,y+182),item['label'][:23],font=font(16),fill='#f5eee3')
    if index in [8,12,16,19,22]:im.save(OUT/f'hat-motion-check-{index}.png')
    frames.append(im)
frames[0].save(OUT/'All-Bodies-Beret-Lift-And-Landing.gif',save_all=True,append_images=frames[1:],duration=110,loop=0,disposal=2)
