import { expect } from 'chai';
import { withGlobalLemmings } from './helpers/lemmings.js';
import { Level } from '../js/level/Level.js';
import { ColorPalette } from '../js/render/ColorPalette.js';
import { Range } from '../js/util/Range.js';
import '../js/render/Frame.js';
import '../js/render/Animation.js';

const makePalette = () => {
  const pal = new ColorPalette();
  for (let i = 0; i < 16; i++) pal.setColorRGB(i, i, i, i);
  return pal;
};

describe('Level extra coverage', function() {
  it('sets map objects, entrances, triggers, and arrows', function() {
    const level = new Level(64, 64);
    level._debugFrame = {};
    const palette = makePalette();
    const objectImg = [];
    objectImg[1] = {
      width: 1,
      height: 1,
      frames: [Uint8Array.from([0])],
      palette,
      animationLoop: true,
      firstFrameIndex: 0,
      frameCount: 1,
      trigger_effect_id: 0,
      trigger_left: 0,
      trigger_top: 0,
      trigger_width: 1,
      trigger_height: 1,
      trap_sound_effect_id: 0
    };
    objectImg[7] = {
      width: 1,
      height: 1,
      frames: [Uint8Array.from([0])],
      palette,
      animationLoop: true,
      firstFrameIndex: 0,
      frameCount: 1,
      trigger_effect_id: 6,
      trigger_left: 0,
      trigger_top: 0,
      trigger_width: 2,
      trigger_height: 2,
      trap_sound_effect_id: 3
    };
    objectImg[2] = {
      width: 1,
      height: 1,
      frames: [Uint8Array.from([0])],
      palette,
      animationLoop: true,
      firstFrameIndex: 0,
      frameCount: 1,
      trigger_effect_id: 7,
      trigger_left: 0,
      trigger_top: 0,
      trigger_width: 3,
      trigger_height: 3,
      trap_sound_effect_id: 0
    };
    const objects = [
      { id: 1, x: 0, y: 0, drawProperties: {} },
      { id: 7, x: 4, y: 4, drawProperties: {} },
      { id: 2, x: 8, y: 8, drawProperties: {} },
      { id: 3, x: 12, y: 12, drawProperties: {} }
    ];
    level.setMapObjects(objects, objectImg);
    expect(level.objects.length).to.equal(3);
    expect(level.entrances.length).to.equal(1);
    expect(level.triggers.some(t => t.type === 12)).to.equal(true);
    expect(level.arrowRanges.length).to.be.greaterThan(0);
    expect(level.arrowTriggers.length).to.equal(1);
    expect(level._debugFrame).to.equal(null);
  });

  it('clears ground with masks and checks steel/arrow helpers', function() {
    withGlobalLemmings({ game: { lemmingManager: { miniMap: { onGroundChanged() {} } } } }, () => {
      const level = new Level(4, 4);
      level.setPalettes(makePalette(), makePalette());
      level.setGroundImage(new Uint8ClampedArray(4 * 4 * 4));
      level.setGroundAt(1, 1, 1);

      const mask = {
        width: 1,
        height: 1,
        offsetX: 0,
        offsetY: 0,
        at() { return 0; }
      };
      const changed = level.clearGroundWithMask(mask, 1, 1);
      expect(changed).to.equal(true);

      level.setGroundAt(2, 1, 1);
      const removed = level.clearGroundWithMaskCount(mask, 2, 1);
      expect(removed).to.equal(1);

      level.steelMask.setMaskAt(2, 2);
      level.setGroundAt(2, 2, 1);
      const steelMask = {
        width: 1,
        height: 1,
        offsetX: 0,
        offsetY: 0,
        at() { return 0; }
      };
      expect(level.hasSteelUnderMask(steelMask, 2, 2)).to.equal(true);
      expect(level.isSteelGround(0, 0, true)).to.equal(undefined);
      const emptyMask = {
        width: 1,
        height: 1,
        offsetX: 0,
        offsetY: 0,
        at() { return 1; }
      };
      expect(level.hasSteelUnderMask(emptyMask, 0, 0)).to.equal(false);

      level.setArrowAreas([
        Object.assign(new Range(), { x: 0, y: 0, width: 2, height: 2, direction: 1 })
      ]);
      level.setGroundAt(0, 0, 1);
      expect(level.isArrowAt(0, 0, 0)).to.equal(true);
      expect(level.hasArrowUnderMask(mask, 0, 0, 0)).to.equal(true);
      expect(level.hasArrowUnderMask(mask, 3, 3, 0)).to.equal(false);
    });
  });

  it('builds debug frame on renderDebug', function() {
    const level = new Level(10, 10);
    level.setSteelAreas([
      Object.assign(new Range(), { x: 1, y: 1, width: 2, height: 2 })
    ]);
    level.setArrowAreas([
      Object.assign(new Range(), { x: 4, y: 4, width: 2, height: 2, direction: 0 })
    ]);
    let drawCalled = false;
    const display = {
      drawFrame() { drawCalled = true; },
      initSize() {},
      setBackground() {}
    };
    level.renderDebug(display);
    expect(drawCalled).to.equal(true);
  });

  it('rewrites trap ids and clears ground only when not steel', function() {
    withGlobalLemmings({ game: { lemmingManager: { miniMap: { onGroundChanged() {} } } } }, () => {
      const level = new Level(4, 4);
      level.setPalettes(makePalette(), makePalette());
      level.setGroundImage(new Uint8ClampedArray(4 * 4 * 4));

      const palette = makePalette();
      const objectImg = [];
      objectImg[7] = {
        width: 1,
        height: 1,
        frames: [Uint8Array.from([0])],
        palette,
        animationLoop: true,
        firstFrameIndex: 0,
        frameCount: 1,
        trigger_effect_id: 6,
        trigger_left: 0,
        trigger_top: 0,
        trigger_width: 1,
        trigger_height: 1,
        trap_sound_effect_id: 1
      };
      const objects = [{ id: 7, x: 1, y: 1, drawProperties: {} }];
      level.setMapObjects(objects, objectImg);
      expect(level.objects[0].triggerType).to.equal(12);

      level.setGroundAt(1, 1, 1);
      const mask = { width: 1, height: 1, offsetX: 0, offsetY: 0, at() { return 0; } };
      const removed = level.clearGroundWithMaskCount(mask, 1, 1);
      expect(removed).to.equal(1);

      level.steelMask.setMaskAt(2, 2);
      level.setGroundAt(2, 2, 1);
      level.clearGroundAt(2, 2);
      expect(level.hasGroundAt(2, 2)).to.equal(true);
    });
  });
});
