"""Label real source-object/action captures without inventing gameplay screenshots."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path('temp/character-hazards/proof')
out = root.parent
receipt = json.loads((root/'receipt.json').read_text())
shapes = receipt['shapes']
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
heading = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)

for fixture in receipt['fixtures']:
    kind = fixture['kind']
    frames = []
    for index in range(56 if kind == 'water' else 32):
        canvas = Image.new('RGB', (1200, 822), '#141c2c')
        draw = ImageDraw.Draw(canvas)
        draw.text((14, 12), fixture['label']+' | all 12 custom shapes', font=heading, fill='#edf1fa')
        draw.text((14, 44), 'Real source object + native collision/action/render pipeline. Controlled fixture, not browser gameplay.', font=small, fill='#bac8df')
        draw.text((14, 65), f'{fixture["pack"]} / GROUND{fixture["ground"]}O.DAT / object {fixture["object"]} | tick {index+1}, {(index+1)*60} ms', font=small, fill='#bac8df')
        for i, shape in enumerate(shapes):
            x = i%4*300+6; y = i//4*242+96
            draw.text((x+4,y),shape['label'],font=font,fill='#edf1fa')
            im = Image.open(root/f'{kind}-{shape["id"]}-{index}.png').convert('RGB')
            canvas.paste(im.resize((288,216),Image.Resampling.NEAREST),(x,y+24))
        frames.append(canvas)
    frames[0].save(out/f'{kind}-12-shapes.gif',save_all=True,append_images=frames[1:],duration=60,loop=0,disposal=2)

    ticks = [1, 7, 13, 15, 24, 40] if kind == 'water' else [1, 4, 7, 10, 13, 16]
    canvas = Image.new('RGB',(1160,815),'#141c2c'); draw=ImageDraw.Draw(canvas)
    draw.text((14,12),fixture['label']+' | contact to removal',font=heading,fill='#edf1fa')
    draw.text((14,44),'Native hazard/action close-ups, 60 ms per tick. Original gameplay duration and movement.',font=small,fill='#bac8df')
    for c,tick in enumerate(ticks): draw.text((15+c*192,78),f'Tick {tick} / {tick*60} ms',font=font,fill='#bac8df')
    for r,shape in enumerate([shapes[0],shapes[2],shapes[5],shapes[-1]]):
        y=106+r*176;draw.text((12,y),shape['label'],font=font,fill='#edf1fa')
        for c,tick in enumerate(ticks):
            im=Image.open(root/f'{kind}-{shape["id"]}-{tick-1}.png').convert('RGB')
            if kind == 'crush':
                im=im.resize((192,144),Image.Resampling.NEAREST)
            else:
                im=im.crop((24,28,72,64)).resize((192,144),Image.Resampling.NEAREST)
            canvas.paste(im,(c*192,y+23))
    canvas.save(out/f'{kind}-timeline.png')

    canvas = Image.new('RGB',(1160,2220),'#141c2c'); draw=ImageDraw.Draw(canvas)
    draw.text((14,12),fixture['label']+' | all 12 shapes, exact action ticks',font=heading,fill='#edf1fa')
    draw.text((14,44),'Native hazard/action close-ups. 60 ms per tick. Controlled fixture, not browser gameplay.',font=small,fill='#bac8df')
    for c,tick in enumerate(ticks): draw.text((15+c*192,78),f'Tick {tick} / {tick*60} ms',font=font,fill='#bac8df')
    for r,shape in enumerate(shapes):
        y=106+r*176;draw.text((12,y),shape['label'],font=font,fill='#edf1fa')
        for c,tick in enumerate(ticks):
            im=Image.open(root/f'{kind}-{shape["id"]}-{tick-1}.png').convert('RGB')
            if kind == 'crush':
                im=im.resize((192,144),Image.Resampling.NEAREST)
            else:
                im=im.crop((24,28,72,64)).resize((192,144),Image.Resampling.NEAREST)
            canvas.paste(im,(c*192,y+23))
    canvas.save(out/f'{kind}-12-shapes-timeline.png')
print('Wrote 12 real-hazard GIFs and labeled timelines.')
