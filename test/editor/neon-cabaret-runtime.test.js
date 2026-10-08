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
import { CharacterSpriteSet } from '../../js/lemmings/CharacterSpriteSet.js';
import { PixelSpriteSkin } from '../../js/lemmings/PixelSpriteSkin.js';
import { CharacterParticles } from '../../js/lemmings/CharacterParticles.js';
import { Lemming } from '../../js/lemmings/Lemming.js';
import { TriggerManager } from '../../js/level/TriggerManager.js';
import { ActionWalkSystem } from '../../js/actions/ActionWalkSystem.js';
import { ActionDrowningSystem } from '../../js/actions/ActionDrowningSystem.js';
import { ActionFryingSystem } from '../../js/actions/ActionFryingSystem.js';
import { ActionSplatterSystem } from '../../js/actions/ActionSplatterSystem.js';
const entry = (PIECE, X, Y) => ({ props: { PIECE, X, Y } });
const provider = { loadBinary() { throw new Error('Custom theme must not fetch DAT files'); } };
function levelData() { const l = new EditorLevel(); for (const [k,v] of Object.entries({ STYLE:'neon-cabaret', WIDTH:640, HEIGHT:160, LEMMINGS:10, SAVE_REQUIREMENT:5 })) l.setHeader(k,v); l.terrains=[entry(0,0,128),entry(1,64,128),entry(3,96,96)];l.gadgets=[entry(1,8,40),entry(0,500,80),entry(2,160,96),entry(3,280,80),entry(4,376,120),entry(5,0,0)];return l; }
describe('Neon Cabaret operational groundset', () => {
  beforeEach(() => registerStyle('neon-cabaret', NEON_CABARET_STYLE));
  it('loads editor palette and all named terrain, scenery and triggers without DAT files', async () => {
    const a = await new EditorAssetCache().loadStyleAssets('NEON-CABARET', {path:'lemmings'}, provider);
    assert.equal(a.styleName,'neon-cabaret');assert.equal(a.terrain.length,12);assert.equal(a.gadgets.length,65);assert.equal(a.entranceId,1);assert.equal(a.exitId,0);assert.equal(a.triggers.length,5);assert.equal(getStyle('neon-cabaret').customAssets,true);
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
  it('loads the full-size Grand Revue with real architecture and the appended smoke trigger', async () => {
    const source = fs.readFileSync(new URL('../../examples/neon-cabaret/grand-revue.nxlv', import.meta.url), 'utf8');
    const level = await loadEditorLevel(NxlvParser.parse(source), { path: 'lemmings' }, provider);
    assert.equal(level.width, 1280); assert.equal(level.height, 320); assert.equal(level.entrances.length, 1);
    assert.ok(level.getGroundMaskLayer().hasGroundAt(12, 274));
    const smoke = level.triggers.find(t => t.owner?.animation?.objectImg?.characterHazard === 'smoke');
    assert.ok(smoke); assert.equal(smoke.trigger(925, 272, 100), TriggerTypes.FRYING);
    assert.ok(level.objects.some(o => o.animation.objectImg.width === 192 && o.animation.objectImg.height === 192));
  });
  it('routes custom theme contacts through the shared cosmetic hazards without filtering original theme art', async () => {
    const catalog = JSON.parse(fs.readFileSync('assets/characters/catalog.json', 'utf8'));
    const base = new PixelSpriteSkin(JSON.parse(fs.readFileSync(catalog.shapes[0].path, 'utf8')));
    const sprites = new CharacterSpriteSet(base, catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
    const preference = { shape: 'rounded_triangle', bodyColor: '#4778ff' };
    assert.equal(await sprites.prepare(), true);
    const level = await loadEditorLevel(levelData(), { path: 'lemmings' }, provider);
    const manager = new TriggerManager({ getGameTicks: () => 100 }, level.width, level.height);
    manager.addRange(level.triggers);
    for (const [type, state, kind, Action] of [
      [TriggerTypes.FRYING, LemmingStateType.FRYING, 'electric', ActionFryingSystem],
      [TriggerTypes.TRAP, LemmingStateType.SPLATTING, 'crush', ActionSplatterSystem],
      [TriggerTypes.DROWN, LemmingStateType.DROWNING, 'acid', ActionDrowningSystem]
    ]) {
      const trigger = level.triggers.find(t => t.type === type), pool = new CharacterParticles();
      const actor = new Lemming(trigger.x1 + 1, trigger.y1 + 1, type), walk = new ActionWalkSystem(sprites);
      walk.characterParticles = pool; actor.setAction(walk);
      assert.equal(lemmingManagerInteractionMethods.runTrigger.call({ triggerManager: manager }, actor, 100), state);
      const death = new Action(sprites); death.characterParticles = pool; actor.setAction(death);
      assert.equal(sprites.getActorHazardKind(actor), kind);
      assert.equal(trigger.owner.getFrame(1), trigger.owner.animation.getFrame(1));
      const before = [actor.x, actor.y, actor.frameIndex, actor.state];
      assert.ok(sprites.getActorAnimation(death.spriteType, true, actor).getFrame(1));
      assert.deepEqual([actor.x, actor.y, actor.frameIndex, actor.state], before);
    }
  });

});
