"""Arrange actual decoder PNGs; no invented or synthesized sprite pixels."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json

OUT = Path(__file__).resolve().parents[2]/'temp/live-instrument/accessory-review'
DATA = json.loads((OUT/'receipt.json').read_text())
FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
SMALL = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 10)

def cell(sheet, image, x, y, scale=6, height=84):
    for yy in range(height):
        for xx in range(image.width*scale):
            sheet.putpixel((x+xx,y+yy), (52,64,81) if (xx//scale+yy//scale)%2 else (45,57,74))
    expanded = image.resize((image.width*scale, image.height*scale), Image.Resampling.NEAREST)
    sheet.paste(expanded, (x,y+height-expanded.height), expanded)
    sheet.paste(image, (x+(image.width*scale-image.width)//2,y+height+3), image)

items = DATA['items']
sheet = Image.new('RGB', (170+len(items)*122,72+len(DATA['shapes'])*106), '#172234')
draw = ImageDraw.Draw(sheet)
draw.text((12,8), 'Actual decoder pixels · enlarged 6× and native 1× · one accessory at a time', font=FONT, fill='white')
for j,item in enumerate(items):
    label=item['label'].replace('Separate trapezoid lenses','Trapezoid lenses')
    draw.text((173+j*122,35), label, font=SMALL, fill='white')
for i,shape in enumerate(DATA['shapes']):
    draw.text((8,100+i*106), shape['label'].replace('Rounded','Rnd'), font=SMALL, fill='white')
    for j,item in enumerate(items):
        image=Image.open(OUT/f'{shape["id"]}-{item["id"]}-WALKING-right-3.png')
        cell(sheet,image,174+j*122,58+i*106)
sheet.save(OUT/'Accessory-All-Bodies.png')

sheet=Image.new('RGB',(170+len(DATA['colors'])*106,70+len(DATA['items'])*110),'#172234')
draw=ImageDraw.Draw(sheet)
draw.text((12,8),'All 11 native accessory colors · donut center remains transparent',font=FONT,fill='white')
for j,color in enumerate(DATA['colors']):draw.text((176+j*106,35),color['label'],font=SMALL,fill='white')
for i,item in enumerate(DATA['items']):
    draw.text((8,105+i*110),item['label'],font=SMALL,fill='white')
    for j,color in enumerate(DATA['colors']):cell(sheet,Image.open(OUT/f'color-{item["id"]}-{color["id"]}.png'),174+j*106,56+i*110)
sheet.save(OUT/'Accessory-All-Colors.png')

poses=[('WALKING',True,3),('WALKING',False,6),('CLIMBING',True,4),('CLIMBING',False,4),('UMBRELLA',True,5),('LANDING',True,3),('LANDING',False,6)]
for item in items:
    sheet=Image.new('RGB',(170+len(poses)*115,70+len(DATA['shapes'])*155),'#172234');draw=ImageDraw.Draw(sheet)
    draw.text((12,8),item['label']+' · current walk, turn, wall, float and reattachment pixels',font=FONT,fill='white')
    for j,(state,right,frame) in enumerate(poses):draw.text((174+j*115,35),('return walk' if state=='LANDING' else state.lower())+(' R' if right else ' L'),font=SMALL,fill='white')
    for i,shape in enumerate(DATA['shapes']):
        draw.text((8,120+i*155),shape['label'].replace('Rounded','Rnd'),font=SMALL,fill='white')
        for j,(state,right,frame) in enumerate(poses):
            file=OUT/f'{shape["id"]}-{item["id"]}-{state}-{"right" if right else "left"}-{frame}.png'
            if not file.exists():file=OUT/f'{shape["id"]}-{item["id"]}-WALKING-{"right" if right else "left"}-{frame}.png'
            image=Image.open(file)
            cell(sheet,image,174+j*115,55+i*155,height=120)
    sheet.save(OUT/f'Accessory-Poses-{item["id"]}.png')

motion=[]
sequence=[('WALKING',True,i) for i in range(8)]+[('WALKING',False,i) for i in range(8)]+[('UMBRELLA',False,i) for i in range(8)]+[('LANDING',False,i) for i in range(7)]
for step,(state,right,index) in enumerate(sequence):
    item=items[(step//5)%len(items)]
    sheet=Image.new('RGB',(800,680),'#172234');draw=ImageDraw.Draw(sheet)
    draw.text((16,10),'One accessory at a time · '+item['label'],font=FONT,fill='white')
    draw.text((16,30),f'{state.lower()} · {"right" if right else "left"} · frame {index}',font=FONT,fill='white')
    for i,shape in enumerate(DATA['shapes']):
        x=18+(i%4)*196;y=58+(i//4)*205
        file=OUT/f'{shape["id"]}-{item["id"]}-{state}-{"right" if right else "left"}-{index}.png'
        if not file.exists():file=OUT/f'{shape["id"]}-{item["id"]}-WALKING-{"right" if right else "left"}-{index}.png'
        image=Image.open(file)
        cell(sheet,image,x+34,y,scale=8,height=160)
        draw.text((x+2,y+182),shape['label'].replace('Rounded','Rnd'),font=SMALL,fill='white')
    motion.append(sheet)
motion[0].save(OUT/'Accessory-Individual-Motion.gif',save_all=True,append_images=motion[1:],duration=130,loop=0,disposal=2)
print('Saved all-body, all-color, individual pose sheets and a turn/float motion GIF.')
