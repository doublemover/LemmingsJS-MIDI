import { expect } from 'chai';
import { ObjectManager } from '../js/ObjectManager.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('ObjectManager.render', function () {
  it('draws current frame of each object based on tick', function () {
    const timer = { getGameTicks() { return 5; } };
    const manager = new ObjectManager(timer);

    const calls = [];
    function makeObj(id, x, y) {
      return {
        x,
        y,
        drawProperties: {},
        animation: {
          getFrame(tick) { calls.push({ id, tick }); return `frame${id}`; }
        }
      };
    }

    const obj1 = makeObj(1, 10, 20);
    const obj2 = makeObj(2, 30, 40);
    manager.addRange([obj1, obj2]);

    const draws = [];
    const display = {
      drawFrameFlags(frame, x, y, cfg) { draws.push({ frame, x, y, cfg }); }
    };

    manager.render(display);

    expect(calls).to.eql([
      { id: 1, tick: 6 },
      { id: 2, tick: 6 }
    ]);
    expect(draws).to.eql([
      { frame: 'frame1', x: 10, y: 20, cfg: obj1.drawProperties },
      { frame: 'frame2', x: 30, y: 40, cfg: obj2.drawProperties }
    ]);
  });
});
