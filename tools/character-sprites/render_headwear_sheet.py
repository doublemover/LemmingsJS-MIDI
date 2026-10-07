"""Arrange decoded headwear and optional native source compositions for review."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json,sys

OUT=Path(__file__).resolve().parents[2]/'temp/live-instrument/headwear-review'
DATA=json.loads((OUT/'receipt.json').read_text())
FONT=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',12)
SMALL=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',10)
def cell(sheet,image,x,y,scale=6,height=84):
    for yy in range(height):
        for xx in range(image.width*scale):sheet.putpixel((x+xx,y+yy),(52,64,81) if (xx//scale+yy//scale)%2 else (45,57,74))
    expanded=image.resize((image.width*scale,image.height*scale),Image.Resampling.NEAREST)
    sheet.paste(expanded,(x,y+height-expanded.height),expanded)
    sheet.paste(image,(x+(image.width*scale-image.width)//2,y+height+3),image)

items=DATA['items']
sheet=Image.new('RGB',(165+len(items)*115,68+len(DATA['shapes'])*108),'#172234');draw=ImageDraw.Draw(sheet)
draw.text((10,9),'Actual decoder headwear · 6× + native 1×'+' · one accessory at a time',font=FONT,fill='white')
for j,item in enumerate(items):draw.text((173+j*115,33),item['label'],font=SMALL,fill='white')
for i,shape in enumerate(DATA['shapes']):
    draw.text((5,100+i*108),shape['label'].replace('Rounded','Rnd'),font=SMALL,fill='white')
    for j,item in enumerate(items):
        name=f'{shape["id"]}-{item["id"]}-'+'WALKING-right-3.png'
        cell(sheet,Image.open(OUT/name),170+j*115,54+i*108)
sheet.save(OUT/'Headwear-All-Bodies.png')

colored=[item for item in items if item['id']!='none']
sheet=Image.new('RGB',(140+len(DATA['colors'])*106,68+len(colored)*108),'#172234');draw=ImageDraw.Draw(sheet)
draw.text((10,9),'Every native headwear color · donut alpha center preserved',font=FONT,fill='white')
for j,color in enumerate(DATA['colors']):draw.text((145+j*106,33),color['label'],font=SMALL,fill='white')
for i,item in enumerate(colored):
    draw.text((7,100+i*108),item['label'],font=SMALL,fill='white')
    for j,color in enumerate(DATA['colors']):cell(sheet,Image.open(OUT/f'color-{item["id"]}-{color["id"]}.png'),144+j*106,54+i*108)
sheet.save(OUT/'Headwear-All-Colors.png')

poses=[('WALKING',True,3),('WALKING',False,6),('CLIMBING',True,4),('CLIMBING',False,4),('UMBRELLA',True,5),('UMBRELLA',False,5)]
for item in items:
    sheet=Image.new('RGB',(165+len(poses)*115,68+len(DATA['shapes'])*153),'#172234');draw=ImageDraw.Draw(sheet)
    draw.text((10,9),item['label']+' · walk, turn, wall and float contact',font=FONT,fill='white')
    for j,(state,right,index) in enumerate(poses):draw.text((172+j*115,33),state.lower()+(' R' if right else ' L'),font=SMALL,fill='white')
    for i,shape in enumerate(DATA['shapes']):
        draw.text((5,120+i*153),shape['label'].replace('Rounded','Rnd'),font=SMALL,fill='white')
        for j,(state,right,index) in enumerate(poses):
            cell(sheet,Image.open(OUT/f'{shape["id"]}-{item["id"]}-{state}-{"right" if right else "left"}-{index}.png'),170+j*115,53+i*153,height=120)
    sheet.save(OUT/f'Headwear-Poses-{item["id"]}.png')

if len(sys.argv)>1:
    source=Path(sys.argv[1]);native=json.loads((source/'index.json').read_text())
    compare=[item for item in items if item['id'] not in ['none','beret']]
    sheet=Image.new('RGB',(160+len(compare)*198,75+len(DATA['shapes'])*130),'#172234');draw=ImageDraw.Draw(sheet)
    draw.text((10,8),'Native source composition → actual pixel adaptation · custom ear/ring fits labeled',font=FONT,fill='white')
    for j,item in enumerate(compare):draw.text((168+j*198,35),item['label']+' · native / pixel',font=SMALL,fill='white')
    for i,shape in enumerate(DATA['shapes']):
        draw.text((5,104+i*130),shape['label'].replace('Rounded','Rnd'),font=SMALL,fill='white')
        for j,item in enumerate(compare):
            recipe=native['entries'].get(f'{shape["id"]}/accessory/{item["id"]}/light')
            x=164+j*198;y=60+i*130
            if recipe:
                im=Image.new('RGBA',(384,384))
                for n,(idx,px,py) in enumerate(recipe):
                    sha,w,h=native['files'][idx];layer=Image.open(source/'images'/f'{sha}.png').convert('RGBA')
                    if n:
                        box=(0 if px==0 else 1,0 if py==0 else 1,w if px+w==384 else w-1,h if py+h==384 else h-1)
                        im.paste(layer.crop(box),(px+box[0],py+box[1]))
                    else:im.alpha_composite(layer,(px,py))
                im=im.resize((96,96),Image.Resampling.LANCZOS)
                draw.rectangle((x,y,x+95,y+95),fill='#869099');sheet.paste(im,(x,y),im)
            else:draw.text((x+4,y+36),'Custom fit',font=SMALL,fill='white')
            cell(sheet,Image.open(OUT/f'{shape["id"]}-{item["id"]}-WALKING-right-3.png'),x+99,y,scale=5,height=96)
    sheet.save(OUT/'Headwear-Native-vs-Pixel.png')
print('Saved headwear body/color/pose sheets and optional native comparison.')
