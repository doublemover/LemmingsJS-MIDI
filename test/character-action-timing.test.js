import { expect } from 'chai';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { CharacterSpriteSet } from '../js/lemmings/CharacterSpriteSet.js';
import { LemmingsSprite } from '../js/lemmings/LemmingsSprite.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { LemmingStateType } from '../js/lemmings/LemmingStateType.js';
import { SpriteTypes } from '../js/lemmings/SpriteTypes.js';
import { ColorPalette } from '../js/render/ColorPalette.js';
import { MaskProvider } from '../js/render/MaskProvider.js';
import { BinaryReader } from '../js/data/BinaryReader.js';
import { FileContainer } from '../js/data/FileContainer.js';
import { Level } from '../js/level/Level.js';

const actionNames = ['Walk', 'Jump', 'Climb', 'Hoist', 'Fall', 'Floating', 'Build', 'Bash', 'Mine', 'Digg',
  'Blocker', 'Shrug', 'Drowning', 'Frying', 'Splatter', 'Exiting', 'OhNo', 'Exploding'];
const actions = await Promise.all(actionNames.map(async name =>
  [name, (await import(`../js/actions/Action${name}System.js`))[`Action${name}System`]]));
const read = file => fs.readFileSync(file, 'utf8');
const catalog = JSON.parse(read('assets/characters/catalog.json'));

const runActions = (sprites, masks) => {
  const results = [];
  for (const [name, Action] of actions) for (const lookRight of [true, false]) {
    const level = new Level(384, 192);
    level.colorPalette = new ColorPalette();
    level.groundImage = new Uint8ClampedArray(level.width * level.height * 4);
    for (let y = 96; y < level.height; y++) level.groundMask.mask.fill(1, y * level.width, (y + 1) * level.width);
    if (['Climb', 'Jump', 'Bash'].includes(name)) {
      for (let y = 64; y < 96; y++) for (let x = 0; x < 24; x++) {
        level.groundMask.setGroundAt(192 + (lookRight ? x : -x), y);
      }
    }
    const actor = new Lemming(192, ['Fall', 'Floating'].includes(name) ? 20 : 95, 42);
    actor.lookRight = lookRight;
    const triggers = { add() {}, removeByOwner() {} }, victory = { addSurvivor() {} };
    const action = name === 'Blocker' ? new Action(sprites, triggers)
      : name === 'Exiting' ? new Action(sprites, victory)
        : new Action(sprites, masks, triggers, { draw() {} });
    actor.setAction(action);
    const timeline = [];
    for (let tick = 0; tick < 64; tick++) {
      const before = [actor.x, actor.y, actor.frameIndex, actor.state, actor.lookRight, actor.disabled];
      actor.render({ drawFrame(frame) { expect(frame).to.exist; } });
      expect([actor.x, actor.y, actor.frameIndex, actor.state, actor.lookRight, actor.disabled]).to.deep.equal(before);
      const state = action.process(level, actor);
      timeline.push([state, actor.x, actor.y, actor.frameIndex, actor.state, actor.lookRight, actor.disabled]);
      if (state !== LemmingStateType.NO_STATE_TYPE) break;
    }
    if (name === 'Walk') {
      expect(timeline.length).to.equal(64);
      expect(actor.x - 192).to.equal(lookRight ? 64 : -64);
    }
    results.push({ name, lookRight, timeline,
      terrain: createHash('sha256').update(level.groundMask.mask).digest('hex') });
  }
  return results;
};

describe('all-shape action timing and world movement', function() {
  this.timeout(10000);

  it('matches classic across 18 action systems in both directions with unchanged ticks and terrain edits', async function() {
    const data = new FileContainer(new BinaryReader(fs.readFileSync('lemmings/MAIN.DAT')));
    const palette = new ColorPalette();
    const classic = new LemmingsSprite(data.getPart(0), palette), masks = new MaskProvider(data.getPart(1));
    const baseline = runActions(classic, masks);
    let preference = { shape: 'mixed', seed: 42, accessory: 'crown', eyewear: 'classic_sunglasses',
      bodyColor: 'random', propColor: 'random', eyewearColor: 'random' };
    const sprites = new CharacterSpriteSet(classic, catalog, read, () => preference);
    expect(await sprites.prepare()).to.equal(true);
    for (const shape of catalog.shapes) {
      preference = { ...preference, shape: shape.id };
      expect(await sprites.prepare()).to.equal(true);
      expect(runActions(sprites, masks), shape.id).to.deep.equal(baseline);
      const actor = { id: 42 };
      for (const record of JSON.parse(read(shape.path)).animations) {
        const actual = sprites.getActorAnimation(SpriteTypes[record.state], record.direction >= 0, actor);
        const original = classic.getAnimation(SpriteTypes[record.state], record.direction >= 0);
        expect(actual.frameCount, `${shape.id}/${record.state}`).to.equal(original.frameCount);
        for (let tick = 0; tick < actual.frameCount * 2; tick++) {
          expect(actual.getFrame(tick)).to.equal(actual.getFrame(tick % original.frameCount));
        }
      }
    }
  });
});
