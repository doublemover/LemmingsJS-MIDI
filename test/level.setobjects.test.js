import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Level } from '../js/Level.js';
import { Range } from '../js/Range.js';
import '../js/ColorPalette.js';
import '../js/Animation.js';
import '../js/Frame.js';

const miniMapStub = { onGroundChanged() {} };

function makeObjectImage(opts = {}) {
  const pal = new Lemmings.ColorPalette();
  pal.setColorRGB(0, 0, 0, 0);
  return Object.assign({
    width: 1,
    height: 1,
    frames: [Uint8Array.from([0])],
    palette: pal,
    animationLoop: true,
    firstFrameIndex: 0,
    frameCount: 1,
    trigger_left: 0,
    trigger_top: 0,
    trigger_width: 0,
    trigger_height: 0,
    trigger_effect_id: 0,
    trap_sound_effect_id: 0,
  }, opts);
}

describe('Level setMapObjects', function() {
  let saved;
  beforeEach(function() {
    saved = globalThis.lemmings;
    globalThis.lemmings = { game: { lemmingManager: { miniMap: miniMapStub }, showDebug: false } };
  });
  afterEach(function() { globalThis.lemmings = saved; });

  it('builds triggers and entrances', function() {
    const level = new Level(10, 10);

    const objects = [
      { id: 1, x: 1, y: 2, drawProperties: {} },
      { id: 2, x: 3, y: 4, drawProperties: {} },
      { id: 3, x: 5, y: 6, drawProperties: {} },
    ];

    const objectImg = {
      1: makeObjectImage(),
      2: makeObjectImage({
        trigger_left: 0, trigger_top: 0, trigger_width: 2, trigger_height: 2,
        trigger_effect_id: Lemmings.TriggerTypes.TRAP, frameCount: 2,
      }),
      3: makeObjectImage({
        trigger_left: 1, trigger_top: 1, trigger_width: 1, trigger_height: 1,
        trigger_effect_id: Lemmings.TriggerTypes.ONEWAY_RIGHT,
      }),
    };

    level.setMapObjects(objects, objectImg);

    expect(level.objects).to.have.lengthOf(3);
    expect(level.entrances).to.have.lengthOf(1);
    expect(level.entrances[0]).to.equal(objects[0]);

    expect(level.triggers).to.have.lengthOf(2);
    expect(level.triggers[0].type).to.equal(Lemmings.TriggerTypes.TRAP);
    expect(level.triggers[1].type).to.equal(Lemmings.TriggerTypes.ONEWAY_RIGHT);

    expect(level.arrowTriggers).to.have.lengthOf(1);
    expect(level.arrowTriggers[0].type).to.equal(Lemmings.TriggerTypes.ONEWAY_RIGHT);

    expect(Array.from(level.arrowRanges)).to.eql([
      objects[2].x + 1, objects[2].y + 1, 1, 1, 1,
    ]);
  });
});
