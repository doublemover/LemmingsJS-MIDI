"""Produce PNG/GIF review proofs from actual runtime atlas and scene frames.
Run node tools/exportCasinoShowcase.js <frames-directory> first. Requires Pillow.
"""
from pathlib import Path
import json, sys
from PIL import Image, ImageDraw, ImageFont
root = Path(__file__).resolve().parent.parent
manifest = json.loads((root/'assets/decorations/old-vegas/pack.json').read_text())
atlas = Image.open(root/'assets/decorations/old-vegas/atlas.png')
frames_dir = Path(sys.argv[1])
try:
    title_font = ImageFont.truetype('DejaVuSans.ttf', 24)
    small_font = ImageFont.truetype('DejaVuSans.ttf', 17)
except OSError:
    title_font = small_font = ImageFont.load_default()
pieces = {p['id']: p for p in manifest['pieces']}
def sprite(identifier, phase):
    p = pieces[identifier]; x, y = phase*manifest['cellWidth'], p['atlasRow']*manifest['cellHeight']
    return atlas.crop((x,y,x+p['width'],y+p['height']))
dance_ids=['hydro-showgirl','hydro-showgirl-charleston','hydro-showgirl-kickline']
dance_bounds={}
for identifier in dance_ids:
    boxes=[sprite(identifier,phase).getbbox() for phase in range(16)]
    dance_bounds[identifier]=(min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes))
frames=[]
for phase in range(16):
    image = Image.new('RGB',(1280,780),'#120b12'); draw = ImageDraw.Draw(image)
    draw.text((20,10),'HYDRO / CASINO GRAND REVUE',font=title_font,fill='#ffdf83')
    draw.text((765,15),'Actual playable level and runtime sprite frames',font=small_font,fill='#fff5df')
    image.paste(Image.open(frames_dir/f'scene-{phase}.png').convert('RGB'),(0,48))
    draw.text((22,393),'Articulated chrome revue / 8 poses / 60ms engine frames',font=small_font,fill='#ffdf83')
    draw.text((868,393),'Rebuilt neon tubes and classic smoke',font=small_font,fill='#ffdf83')
    for i, identifier in enumerate(dance_ids):
        dancer=sprite(identifier,phase); dancer=dancer.crop(dance_bounds[identifier]); dancer=dancer.resize((round(dancer.width*1.5),round(dancer.height*1.5)),Image.Resampling.NEAREST)
        image.paste(dancer,(135+i*252-dancer.width//2,433),dancer)
        draw.text((77+i*252,733),['HIP SHIMMY','CHARLESTON','KICKLINE'][i],font=small_font,fill='#fff5df')
    crown=sprite('casino-neon-crown',phase).resize((384,160),Image.Resampling.NEAREST)
    image.paste(crown,(868,427),crown)
    smoke=Image.open(frames_dir/f'smoke-{phase}.png').convert('RGBA').resize((192,176),Image.Resampling.NEAREST)
    image.paste(smoke,(962,595),smoke)
    frames.append(image)
frames[0].save(root/'docs/previews/casino-spectacle-proof.png')
frames[0].save(root/'assets/decorations/old-vegas/contact-sheet.png')
frames[0].save(root/'docs/previews/old-vegas-animation.gif',save_all=True,append_images=frames[1:],duration=60,loop=0,optimize=True)
