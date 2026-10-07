import fs from 'node:fs';
import { PNG } from 'pngjs';
import { PixelSpriteSkin } from '../../js/lemmings/PixelSpriteSkin.js';
import { SpriteTypes } from '../../js/lemmings/SpriteTypes.js';
const out='temp/live-instrument/native-beret-fits';fs.mkdirSync(out,{recursive:true});
const catalog=JSON.parse(fs.readFileSync('assets/characters/catalog.json','utf8'));
const receipt=[];
for(const shape of catalog.shapes){
 const skin=new PixelSpriteSkin(JSON.parse(fs.readFileSync(shape.path,'utf8')));const frames=[];
 const save=(frame,phase)=>{const filename=`turn-${shape.id}-${frames.length}.png`;const png=new PNG({width:frame.width,height:frame.height});png.data.set(frame.getData());fs.writeFileSync(`${out}/${filename}`,PNG.sync.write(png));frames.push({filename,width:frame.width,height:frame.height,phase});};
 for(const right of [true,false])for(let i=0;i<8;i++)save(skin.getAnimation(SpriteTypes.WALKING,right).getFrame(i),right?'Walk right':'Turn / walk left');
 for(let i=0;i<8;i++)save(skin.getAnimation(SpriteTypes.UMBRELLA,false).getFrame(i),'Hat lifts / opens');
 const actor={action:{getActionName:()=> 'walk'},frameIndex:0,getDirection:()=> 'left',x:0,y:0};
 skin.onActionChange(actor,{spriteProvider:skin,getActionName:()=> 'floating'},10);
 for(let i=0;i<7;i++){actor.frameIndex=i;skin.drawCosmeticTransition({drawFrame:frame=>save(frame,'Fold / return to crown')},actor);}
 receipt.push({...shape,frames});
}
fs.writeFileSync(`${out}/motion-review.json`,JSON.stringify(receipt,null,2));
