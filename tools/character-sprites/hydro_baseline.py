from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json, math, hashlib

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT
PRE=ROOT/'previews'
PAL={'.':(0,0,0,0),'n':(19,29,67,255),'b':(36,65,195,255),'B':(43,111,246,255),'H':(105,187,255,255),'e':(15,25,53,255),'o':(183,65,25,255),'O':(255,129,61,255),'Y':(255,205,133,255),'s':(174,212,224,255),'w':(250,243,210,255)}

# Hand-cleaned logical pixels after studying the 11x8 nearest-neighbor reduction.
# Each row is one literal game-pixel row. The low beret brim is deliberately
# asymmetric, and the rising edges preserve a triangular rather than round body.
MASTER=[
 '.....oO....',
 '...oOOOOn..',
 '..oOOOOoo..',
 '...oBBb....',
 '...HBeBe...',
 '..HBBEBEb..',
 '.bBBBBBBbb.',
 '..bbbbbbb..',
]
# E is a dark eye. Lowercase e reserved for identical explicit eye mapping.
PAL['E']=PAL['e']
SQUAT=[
 '.....oO....',
 '...oOOOOn..',
 '..oOOOOoo..',
 '...oBBb....',
 '...HBEBEb..',
 '.bBBBBBBbb.',
 '..bbbbbbb..',
]

def pixels(rows):
 im=Image.new('RGBA',(len(rows[0]),len(rows)))
 for y,row in enumerate(rows):
  for x,c in enumerate(row): im.putpixel((x,y),PAL[c])
 return im

def character(width=16,height=10,bottom=9,hop=0,squat=False,direction=1,xshift=0,eyes='normal',scale=None):
 im=Image.new('RGBA',(width,height))
 p=pixels(SQUAT if squat else MASTER)
 if eyes=='closed':
  # One-pixel blink, replacing the upper eyes with body blue.
  a=ImageDraw.Draw(p)
  for x,y in [(6,4),(8,4)]:
   if y<p.height: a.point((x,y),PAL['B'])
 if scale: p=p.resize(scale,Image.Resampling.NEAREST)
 x=(width-p.width+1)//2+xshift
 y=bottom-hop-p.height+1
 im.alpha_composite(p,(x,y))
 if direction<0: im=mirror_pivot(im)
 return im

def mirror_pivot(im):
 # World anchor is local x=8. Reflect x to 16-x, not 15-x, so a wall
 # contact at world x=0 stays at x=0 in the other direction.
 mirrored=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
 shifted=Image.new('RGBA',im.size);shifted.alpha_composite(mirrored,(1,0))
 return shifted

def walk(i,direction=1):
 return character(hop=[0,0,1,2,2,1,0,0][i%8],squat=i%8 in (1,6),direction=direction)

def sheet(frames):
 w,h=frames[0].size
 im=Image.new('RGBA',(w*len(frames),h))
 for i,f in enumerate(frames): im.alpha_composite(f,(i*w,0))
 return im

def font(size=16):
 try:return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',size)
 except:return ImageFont.load_default()

def proof():
 OUT.mkdir(exist_ok=True);PRE.mkdir(exist_ok=True)
 walkframes=[walk(i) for i in range(8)]
 sheet(walkframes).save(PRE/'hydro-walk-1x.png')
 canvas=Image.new('RGB',(1180,590),'#111a30'); d=ImageDraw.Draw(canvas)
 d.text((28,22),'hydro lemmings / pixel proof',font=font(29),fill='#f5eee3')
 d.text((28,65),'Actual runtime cell: 16 x 10 px | 8-frame hopping loop | nearest-neighbor only',font=font(17),fill='#a8bbd5')
 d.text((28,110),'Game-size 1x strip',font=font(16),fill='#a8bbd5')
 canvas.paste(sheet(walkframes),(230,113),sheet(walkframes))
 d.text((28,148),'Same pixels at 8x',font=font(16),fill='#a8bbd5')
 for i,f in enumerate(walkframes):
  x=28+i*142;y=184
  d.rectangle((x,y,x+127,y+79),fill='#26334b')
  d.line((x,y+80,x+127,y+80),fill='#778197')
  f8=f.resize((128,80),Image.Resampling.NEAREST);canvas.paste(f8,(x,y),f8)
  d.text((x+3,y+92),str(i),font=font(14),fill='#a8bbd5')
 d.text((28,318),'Source reduction vs pixel-cleaned master (12x)',font=font(18),fill='#a8bbd5')
 raw=Image.open(ROOT/'source/downsample-raw-0.png')
 r=raw.resize((132,96),Image.Resampling.NEAREST); canvas.paste(r,(28,360),r)
 p=pixels(MASTER).resize((132,96),Image.Resampling.NEAREST);canvas.paste(p,(225,360),p)
 d.text((28,468),'raw 11 x 8',font=font(15),fill='#a8bbd5');d.text((225,468),'cleaned 11 x 8',font=font(15),fill='#a8bbd5')
 d.text((428,365),'Locked:',font=font(19),fill='#f5eee3')
 for j,s in enumerate(['Blue triangle + orange beret','Fixed eye pixels; no limbs','Binary alpha; one shared palette','Stable pivot; hop uses spare cell rows']):
  d.text((428,399+j*31),s,font=font(17),fill='#a8bbd5')
 canvas.save(PRE/'hydro-pixel-proof.png')
 gifs=[]
 for f in walkframes:
  c=Image.new('RGB',(320,200),'#111a30'); z=f.resize((320,200),Image.Resampling.NEAREST);c.paste(z,(0,0),z);gifs.append(c)
 gifs[0].save(PRE/'hydro-hop-preview.gif',save_all=True,append_images=gifs[1:],duration=100,loop=0,disposal=2)

def line(draw, xy, color='s', width=1): draw.line(xy,fill=PAL[color],width=width)
def dot(draw, xy, color='Y'): draw.point(xy,fill=PAL[color])

# Floating keeps a bare blue point beneath a single traveling beret. The engine
# visits opening frames 0, 1, 3, 5, then loops 5, 6, 7, 7, 6, 5, 4, 4.
# Landing goes straight to WALKING frame 0: its original beret is reattached.
FLOAT_BODY=[
 '....H....',
 '...HBb...',
 '..HBBb...',
 '..HBeBe..',
 '..BBeBe..',
 '.bBBBBBb.',
 '..bbbbb..',
]
FLOAT_BERETS={
 0:[
  '....oO...',
  '..oOOOO..',
  '..OOOOo..',
  '..o......',
 ],
 2:[
  '....oO...',
  '..oOOOO..',
  '.oOOOOOo.',
  'oOOOOoooo',
 ],
 3:[
  '....oO.....',
  '..oOOOOOn..',
  '.oOOOOOOOo.',
  'oOOOOOOoooo',
 ],
 4:[
  '.....oO......',
  '...oOOOOOn...',
  '..oOOOOOOOo..',
  '.oOOOOOOOOOo.',
  'oOOOOOOOOoooo',
 ],
}

def beret_umbrella(i,w=16,h=16):
 im=Image.new('RGBA',(w,h)); d=ImageDraw.Draw(im)
 if i==0:
  cap,x,y=FLOAT_BERETS[0],4,8
 elif i==1:
  cap,x,y=FLOAT_BERETS[0],4,5
 elif i==2:
  cap,x,y=FLOAT_BERETS[2],4,3
 elif i==3:
  cap,x,y=FLOAT_BERETS[3],3,2
 else:
  sway={4:-1,5:0,6:1,7:0}[i]
  cap,x,y=FLOAT_BERETS[4],2+sway,0
 if i>=2:
  line(d,(x+1,y+len(cap),6,11),'s')
  line(d,(x+len(cap[0])-2,y+len(cap),10,11),'s')
 elif i==1:
  line(d,(6,8,6,11),'s');line(d,(10,8,10,11),'s')
 im.alpha_composite(pixels(FLOAT_BODY),(4,9))
 im.alpha_composite(pixels(cap),(x,y))
 return im

def landing_frame(i,direction=1,start_sway=0):
 # These cosmetic frames follow walking indices 0..6. Feet, body squash and
 # hopping stay on the original walking motion while only the hat travels.
 hop=[0,0,1,2,2,1,0,0][i]
 squat=i in (1,6)
 rows=SQUAT if squat else MASTER
 top=16-len(rows)-hop
 body=character(16,16,bottom=15,hop=hop,squat=squat)
 cap=Image.new('RGBA',(16,16))
 for y,row in enumerate(rows):
  for x,symbol in enumerate(row):
   if symbol in ('o','O','n'):
    pos=(x+3,top+y)
    cap.putpixel(pos,PAL[symbol]);body.putpixel(pos,PAL['.'])
 d=ImageDraw.Draw(body)
 dot(d,(8,top+1),'H')
 line(d,(7,top+2,9,top+2),'B');dot(d,(7,top+2),'H');dot(d,(9,top+2),'b')
 dot(d,(6,top+3),'H')
 im=Image.new('RGBA',(16,16));d=ImageDraw.Draw(im)
 if i<=2:
  shape=FLOAT_BERETS[{0:4,1:3,2:2}[i]]
  x={0:2+start_sway,1:3,2:4}[i];y=[0,2,4][i]
  if i<2:
   line(d,(x+1,y+len(shape),6,top+3),'s')
   line(d,(x+len(shape[0])-2,y+len(shape),10,top+3),'s')
  im.alpha_composite(body)
  im.alpha_composite(pixels(shape),(x,y))
 else:
  im.alpha_composite(body)
  im.alpha_composite(cap,(0,{3:-3,4:0,5:-2,6:0}[i]))
 if direction<0:im=mirror_pivot(im)
 return im

def action(state,i,w,h,direction):
 """Artist-controlled pixel poses. No physics, durations or anchor edits."""
 # Directional states are rendered right first, then deterministically mirrored.
 im=Image.new('RGBA',(w,h)); d=ImageDraw.Draw(im)
 if state=='WALKING': return walk(i,direction)
 if state=='JUMPING': return character(hop=1,direction=direction)
 if state=='DIGGING':
  phase=i%8; im=character(w,h,bottom=11,squat=phase<2)
  d=ImageDraw.Draw(im)
  if phase<2:
   line(d,(10,8,10,12),'o');line(d,(9,12,12,12),'s');dot(d,(2+phase,11),'Y');dot(d,(13,10-phase),'Y')
  elif phase<5:
   line(d,(10,8,13,6),'o');line(d,(12,5,14,7),'s');dot(d,(14,5),'Y')
  else:
   line(d,(10,8,11,3),'o');line(d,(10,2,12,2),'s')
  if i>=8: im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
 elif state=='CLIMBING':
  phase=i%4
  im=character(w,h,bottom=11,hop=[0,0,1,1,0,0,1,1][i],xshift=-3,scale=(8,8))
  d=ImageDraw.Draw(im);dot(d,(8,6-phase),'H');dot(d,(8,10-phase),'b')
 elif state=='POSTCLIMBING':
  sizes=[(8,8),(8,7),(8,7),(8,6),(9,7),(9,7),(9,8),(9,8)]
  im=character(w,h,bottom=11,hop=[1,3,3,2,0,1,1,0][i],xshift=[-3,-3,-3,-2,-2,-2,-2,-2][i],scale=sizes[i])
 elif state=='BUILDING':
  # Frames 7-9 reach down; frame 9 is the unchanged engine's brick placement.
  im=character(w,h,bottom=12,squat=i in (7,8,9),hop=1 if i in (12,13) else 0,xshift=-1)
  d=ImageDraw.Draw(im)
  brick_y=[7,7,6,6,7,8,9,10,11,12,11,10,9,8,7,7][i]
  if i<9:
   d.rectangle((10,brick_y,14,brick_y),fill=PAL['O']);dot(d,(10,brick_y),'Y')
   if i<8:dot(d,(12,brick_y-1),'o')
  elif i==9:
   # Match the six engine terrain pixels at world x=0..5, y=-1 exactly.
   d.rectangle((8,12,13,12),fill=PAL['O']);dot(d,(8,12),'Y')
 elif state=='BASHING':
  phase=i%16; impact=2<=phase<=5
  im=character(w,h,bottom=9,squat=impact,xshift=1 if impact else -1 if phase<2 else 0)
  d=ImageDraw.Draw(im)
  if impact:
   line(d,(11,5,14,5),'s');line(d,(14,3,14,7),'s');dot(d,(15,2+phase%3),'Y');dot(d,(14,8),'o')
  elif phase in (0,1,6,7):
   line(d,(10,6,12,4),'o');line(d,(11,3,13,5),'s')
  # The second 16-frame pass alternates a one-pixel tool recoil.
  if i>=16 and phase in (6,7):dot(d,(13,2),'H')
 elif state=='MINING':
  phase=i; im=character(w,h,bottom=11,squat=phase in (0,1,2,3),xshift=-1)
  d=ImageDraw.Draw(im)
  if phase<=3:
   line(d,(9,7,13,11),'o');line(d,(11,11,14,9),'s')
   if phase in (1,2):dot(d,(14,12),'Y');dot(d,(12,12),'o')
  elif phase<9:
   line(d,(9,7,13,7),'o');line(d,(12,5,14,8),'s')
  elif phase<16:
   line(d,(9,7,12,3),'o');line(d,(10,2,14,4),'s')
  else:
   y=3+(phase-16)//2;line(d,(9,7,13,y),'o');line(d,(12,y-1,14,y+1),'s')
 elif state=='FALLING':
  im=character(w,h,bottom=9,hop=i%2,scale=(9,8),xshift=[0,0,1,0][i])
  d=ImageDraw.Draw(im);dot(d,(3,4+i%2),'H')
 elif state=='UMBRELLA':
  im=beret_umbrella(i,w,h)
 elif state=='BLOCKING':
  im=character(w,h,bottom=9,eyes='closed' if i in (7,8) else 'normal')
  d=ImageDraw.Draw(im)
  # Body corners extend out into the stop pose; these are not added limbs.
  line(d,(1,6,3,6),'B');line(d,(11,6,14,6),'B');dot(d,(1,5),'H');dot(d,(14,5),'H')
  if i in (3,4,11,12):dot(d,(0,5),'H');dot(d,(15,5),'H')
 elif state=='SHRUGGING':
  im=character(w,h,bottom=9,squat=i in (0,7),hop=1 if i in (3,4) else 0,xshift=[0,0,-1,0,1,0,0,0][i])
  d=ImageDraw.Draw(im)
  if 2<=i<=5:dot(d,(2,5),'H');dot(d,(13,5),'H')
 elif state=='OHNO':
  im=character(w,h,bottom=9,squat=i in (0,4,8,12),xshift=(-1 if i%4==1 else 1 if i%4==3 else 0))
  d=ImageDraw.Draw(im)
  if i%4<2:dot(d,(13,2+i%2),'H')
 elif state=='DROWNING':
  if i<11:
   # Body sinks below the waterline, then only the beret and bubbles remain.
   whole=character(w,20,bottom=9+i//2,xshift=(-1 if i%4==1 else 1 if i%4==3 else 0))
   im=whole.crop((0,0,w,h));d=ImageDraw.Draw(im)
   line(d,(3,9,12,9),'H')
  else:
   d=ImageDraw.Draw(im)
   if i<14:line(d,(6,8,9,8),'O');dot(d,(7,7),'O')
  if 1<i<15:
   d=ImageDraw.Draw(im); dot(d,(3+(i%3),max(1,8-i//2)),'s');dot(d,(12,6-i%3),'H')
 elif state=='SPLATTING':
  if i<3:im=character(w,h,bottom=9,squat=i>0)
  else:
   d=ImageDraw.Draw(im);length=[9,11,12,12,11,10,10,10,10,10,10,10,10][i-3]
   line(d,((w-length)//2,9,(w+length)//2,9),'b');line(d,((w-length)//2+1,8,(w+length)//2-1,8),'B')
   cap_y=[4,2,1,2,4,6,7,7,7,7,7,7,7][i-3]
   line(d,(6,cap_y,10,cap_y),'O');dot(d,(8,cap_y-1),'O')
   if i<7:dot(d,(1,6),'H');dot(d,(14,7),'B')
 elif state=='EXITING':
  if i<7:
   sizes=[(11,8),(10,8),(9,7),(8,6),(6,5),(4,4),(2,2)]
   im=character(w,h,bottom=12,scale=sizes[i],hop=[0,1,1,2,2,2,2][i])
  else:
   dot(d,(7,9),'Y')
 elif state=='FRYING':
  if i<9:
   im=character(w,h,bottom=9,squat=i%3==0,xshift=(-1 if i%2 else 0))
   d=ImageDraw.Draw(im)
   for k in range(4):
    x=[2,5,10,13][k];y=12-((i*2+k*3)%9)
    dot(d,(x,y),'Y');dot(d,(x,max(0,y-1)),'O')
  else:
   line(d,(4,9,12,9),'b');line(d,(7,8,10,8),'o')
   for k in range(3):dot(d,(5+k*3,11-((i+k)%5)),'o' if i>11 else 'Y')
 elif state=='EXPLODING':
  # The engine applies (-10,-8) before this frame's (-8,-10) anchor.
  # Thus center (18,18) is the original simulation point, unchanged.
  d.polygon([(18,3),(21,10),(29,7),(25,15),(31,18),(25,21),(28,28),(20,25),(17,31),(14,24),(6,28),(10,20),(3,16),(11,14),(8,6),(15,10)],fill=PAL['O'])
  d.polygon([(18,8),(20,14),(26,16),(21,20),(19,26),(15,21),(9,18),(15,14)],fill=PAL['Y'])
  d.rectangle((16,16,20,20),fill=PAL['w'])
  for x,y in [(4,5),(28,3),(3,26),(30,25),(14,1)]:dot(d,(x,y),'B')
  line(d,(24,2,27,2),'O');dot(d,(25,1),'O')
 else: raise ValueError(state)
 if direction<0:im=mirror_pivot(im)
 return im
