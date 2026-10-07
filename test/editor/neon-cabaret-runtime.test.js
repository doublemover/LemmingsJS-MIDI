import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NxlvParser } from '../../js/editor/NxlvParser.js';
import { EditorLevel } from '../../js/editor/EditorLevel.js';
import { EditorAssetCache } from '../../js/editor/EditorAssetCache.js';
import { loadEditorLevel, createClassicLevelData } from '../../js/editor/EditorLevelLoader.js';
import { registerStyle, getStyle } from '../../js/editor/StyleRegistry.js';
import { NEON_CABARET_STYLE, createNeonCabaretGroundSet } from '../../js/decorations/NeonCabaretGroundSet.js';
import { ParticleTable } from '../../js/render/ParticleTable.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';
import { lemmingManagerInteractionMethods } from '../../js/lemmings/lemming-manager/LemmingManagerInteraction.js';
import { LemmingStateType } from '../../js/lemmings/LemmingStateType.js';
const entry = (PIECE, X, Y) => ({ props: { PIECE, X, Y } });
const provider = { loadBinary() { throw new Error('Custom theme must not fetch DAT files'); } };
function levelData() { const l = new EditorLevel(); for (const [k,v] of Object.entries({ STYLE:'neon-cabaret', WIDTH:640, HEIGHT:160, LEMMINGS:10, SAVE_REQUIREMENT:5 })) l.setHeader(k,v); l.terrains=[entry(0,0,128),entry(1,64,128),entry(3,96,96)];l.gadgets=[entry(1,8,40),entry(0,500,80),entry(2,160,96),entry(3,280,80),entry(4,376,120),entry(5,0,0)];return l; }
describe('Neon Cabaret operational groundset', () => {
  beforeEach(() => registerStyle('neon-cabaret', NEON_CABARET_STYLE));
  it('loads editor palette and all named terrain, scenery and triggers without DAT files', async () => {
    const a = await new EditorAssetCache().loadStyleAssets('NEON-CABARET', {path:'lemmings'}, provider);
    assert.equal(a.styleName,'neon-cabaret');assert.equal(a.terrain.length,6);assert.equal(a.gadgets.length,11);assert.equal(a.entranceId,1);assert.equal(a.exitId,0);assert.equal(a.triggers.length,4);assert.equal(getStyle('neon-cabaret').customAssets,true);
    assert.doesNotThrow(()=>new ParticleTable(a.terrainImages[0].palette));
  });
  it('builds a real Level with walkable colored terrain, steel, entrance, exit and operational hazards', async () => {
    const l=await loadEditorLevel(levelData(),{path:'lemmings',gametype:1},provider);
    assert.equal(l.entrances.length,1);assert.equal(l.objects.length,6);assert.equal(l.triggers.length,4);
    assert.ok(l.getGroundMaskLayer().hasGroundAt(70,132));assert.ok(l.isSteelAt(100,100));
    const arc=l.triggers.find(t=>t.type===TriggerTypes.FRYING),press=l.triggers.find(t=>t.type===TriggerTypes.TRAP),bath=l.triggers.find(t=>t.type===TriggerTypes.DROWN);
    assert.equal(arc.trigger(180,120,100),TriggerTypes.FRYING);assert.equal(bath.trigger(390,130,100),TriggerTypes.DROWN);
    assert.equal(press.trigger(302,120,100),TriggerTypes.TRAP);assert.equal(press.trigger(302,120,101),TriggerTypes.DISABLED);assert.equal(press.trigger(302,120,116),TriggerTypes.TRAP);
    assert.equal(press.owner.animation.loop,false);assert.equal(arc.owner.animation.loop,true);
    assert.equal(arc.owner.animation.objectImg.characterHazard,'electric');assert.equal(bath.owner.animation.objectImg.characterHazard,'acid');
    const pixels=new Uint32Array(l.groundImage.buffer);assert.equal(pixels[132*640+70], createNeonCabaretGroundSet().groundPalette.getColor(19));
  });
  it('uses unmodified engine drowning, frying and trap action transitions', async () => {
    const l=await loadEditorLevel(levelData(),{path:'lemmings'},provider);
    for(const [kind,state] of [[TriggerTypes.FRYING,LemmingStateType.FRYING],[TriggerTypes.DROWN,LemmingStateType.DROWNING],[TriggerTypes.TRAP,LemmingStateType.SPLATTING]]){
      const t=l.triggers.find(t=>t.type===kind),actor={x:t.x1+1,y:t.y1+1,isRemoved:()=>false,isDisabled:()=>false};
      const result=lemmingManagerInteractionMethods.runTrigger.call({triggerManager:{trigger:(x,y,lem,tick)=>t.trigger(x,y,tick,lem)}},actor,100);
      assert.equal(result,state);
    }
  });
  it('warns that classic export cannot embed custom assets and provides a complete starter level', async () => {
    assert.ok(createClassicLevelData(levelData()).warnings.some(w=>w.code==='classic_custom_style'));
    const source=fs.readFileSync(new URL('../../examples/neon-cabaret/opening-night.nxlv',import.meta.url),'utf8');
    const demo=await loadEditorLevel(NxlvParser.parse(source),{path:'lemmings'},provider);
    assert.equal(demo.entrances.length,1);assert.equal(demo.triggers.length,4);assert.equal(demo.needCount,5);
    assert.equal(demo.getGroundMaskLayer().hasGroundAt(410,128),false);
    const g=createNeonCabaretGroundSet();assert.deepEqual(g.getObjectImages()[3].frames[15],g.getObjectImages()[3].frames[0]);
  });
});
