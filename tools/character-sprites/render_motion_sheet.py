"""Assemble labeled nearest-neighbor proofs from render-motion-proof.mjs output."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json

ROOT = Path('temp/character-motion/proof')
OUT = ROOT.parent
receipt = json.loads((ROOT/'receipt.json').read_text())
shapes = receipt['shapes']
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
heading = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)

def sheet(kind, index, title, scale=4):
    first = Image.open(ROOT/f'{shapes[0]["id"]}-{kind}-{index}.png')
    width, height = first.width*scale+24, first.height*scale+38
    out = Image.new('RGB', (width*4, height*3+96), '#141c2c')
    draw = ImageDraw.Draw(out)
    draw.text((14, 12), title, font=heading, fill='#edf1fa')
    draw.text((14, 44), 'Actual action + sprite + DisplayImage pipeline. Native Node capture, not browser gameplay.', font=small, fill='#bac8df')
    draw.text((14, 65), 'One actor per scene. Original foot/collision anchors and action timing.', font=small, fill='#bac8df')
    for i, shape in enumerate(shapes):
        x=(i%4)*width+12; y=(i//4)*height+96
        draw.text((x,y), shape['label'].replace('Hydro ', ''), font=font, fill='#edf1fa')
        im=Image.open(ROOT/f'{shape["id"]}-{kind}-{index}.png').convert('RGB')
        out.paste(im.resize((im.width*scale, im.height*scale), Image.Resampling.NEAREST), (x,y+25))
    return out

for kind, title, count, scale in [
    ('dig', 'ONE digger per shape | Fun 1: Just dig! | 9-pixel channel', 16, 4),
    ('bash', 'Bashing | chips sampled from the removed Fun 1 terrain', 16, 4),
    ('exploding', 'Explosion | intact crowns + glasses, then fading fragments', 22, 3),
    ('splatter', 'Landing death | body scatter + intact wearable ejection', 22, 3),
    ('drowning', 'Drowning | splash + intact wearable ejection', 22, 3),
    ('frying', 'Fire death | sparks + intact wearable ejection', 22, 3)]:
    frames=[sheet(kind, i, title, scale) for i in range(count)]
    frames[0].save(OUT/f'{kind}-12-shapes.png')
    frames[0].save(OUT/f'{kind}-12-shapes.gif', save_all=True, append_images=frames[1:], duration=95, loop=0, disposal=2)

frames=[]
for index in range(16):
    width,height=360,154
    out=Image.new('RGB',(width*3,height*4+87),'#141c2c');draw=ImageDraw.Draw(out)
    draw.text((14,12),'Shape-specific walking / panicked double-take',font=heading,fill='#edf1fa')
    draw.text((14,44),'Each tile: walk (left), pre-explosion panic (right). Native renderer capture.',font=small,fill='#bac8df')
    for i,shape in enumerate(shapes):
        x=(i%3)*width+12;y=(i//3)*height+87
        draw.text((x,y),shape['label'],font=font,fill='#edf1fa')
        for j,kind in enumerate(['walk','panic']):
            im=Image.open(ROOT/f'{shape["id"]}-{kind}-{index%(8 if kind=="walk" else 16)}.png').convert('RGB')
            out.paste(im.resize((im.width*3,im.height*3),Image.Resampling.NEAREST),(x+j*172,y+27))
    frames.append(out)
frames[0].save(OUT/'walk-panic-12-shapes.gif',save_all=True,append_images=frames[1:],duration=100,loop=0,disposal=2)

out=Image.new('RGB',(1170,520),'#141c2c');draw=ImageDraw.Draw(out)
draw.text((18,14),'Wearables: intact ejection, fracture, fade',font=heading,fill='#edf1fa')
draw.text((18,48),'Isolated real circle crown + sunglasses particles on a checkerboard | native renderer',font=small,fill='#bac8df')
for i,(frame,label) in enumerate([(0,'0: intact launch'),(2,'2: still intact'),(3,'3: fracture'),(7,'7: tumbling pieces'),(16,'16: fading')]):
    im=Image.open(ROOT/f'isolated-wearables-{frame}.png').convert('RGB')
    im=im.resize((224,192),Image.Resampling.NEAREST)
    x=10+i*232;draw.text((x,98),label,font=font,fill='#edf1fa');out.paste(im,(x,130))
draw.text((18,358),'Each wearable stays whole for three ticks, then splits into at most three source-image pieces.',font=font,fill='#edf1fa')
draw.text((18,391),'Shared limits: 384 live particles, 72 births/tick, 2,048 sample checks/tick, 8,192 drawn pixels/frame.',font=small,fill='#bac8df')
draw.text((18,424),'Terrain chips retain the RGB of the actual terrain pixels removed by each action.',font=font,fill='#edf1fa')
out.save(OUT/'accessory-ejection-sequence.png')
print('Wrote compact native-renderer PNG / GIF proof sheets to',OUT)
