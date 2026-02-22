import { expect } from 'chai';
import { useGlobalLemmings } from './helpers/lemmings.js';
import { ObjectManager } from '../js/level/ObjectManager.js';

useGlobalLemmings({ game: { showDebug: false } });

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

  it('skips off-screen objects once frame bounds are cached', function () {
    const timer = { getGameTicks() { return 10; } };
    const manager = new ObjectManager(timer);
    const calls = { visible: 0, hidden: 0 };
    const visible = {
      x: 4,
      y: 4,
      drawProperties: {},
      animation: {
        getFrame() {
          calls.visible += 1;
          return { width: 8, height: 8 };
        }
      }
    };
    const hidden = {
      x: 200,
      y: 4,
      drawProperties: {},
      animation: {
        getFrame() {
          calls.hidden += 1;
          return { width: 8, height: 8 };
        }
      }
    };
    manager.addRange([visible, hidden]);

    const draws = [];
    const display = {
      stage: {
        getGameViewRect() {
          return { x: 0, y: 0, w: 50, h: 20 };
        }
      },
      drawFrameFlags(frame, x, y, cfg) {
        draws.push({ frame, x, y, cfg });
      }
    };

    manager.render(display);
    manager.render(display);

    expect(calls.visible).to.equal(2);
    expect(calls.hidden).to.equal(1);
    expect(draws).to.have.length(2);
    expect(draws[0].x).to.equal(4);
    expect(draws[1].x).to.equal(4);
  });
});
