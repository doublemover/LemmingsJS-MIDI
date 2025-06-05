import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/Position2D.js';
import { UserInputManager } from '../js/UserInputManager.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('UserInputManager', function() {
  it('emits zoom events with cursor position', function(done) {
    const element = {
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 800, height: 480 };
      }
    };
    const uim = new UserInputManager(element);
    uim.onZoom.on((e) => {
      try {
        expect(e.x).to.equal(100);
        expect(e.y).to.equal(50);
        expect(e.deltaZoom).to.equal(120);
        done();
      } catch (err) {
        done(err);
      }
    });

    uim.handleWheel(new Lemmings.Position2D(100, 50), 120);
  });

  it('converts pointer position based on canvas size', function() {
    const scaledElement = {
      width: 400,
      height: 240,
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 200, height: 120 };
      }
    };

    const uim = new UserInputManager(scaledElement);
    const pos = uim.getRelativePosition(scaledElement, 100, 60);

    expect(pos.x).to.equal(200);
    expect(pos.y).to.equal(120);
  });

  it('accounts for offset rects', function() {
    const offsetElement = {
      width: 400,
      height: 240,
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect() {
        return { left: 50, top: 20, width: 200, height: 120 };
      }
    };
    const uim = new UserInputManager(offsetElement);
    const pos = uim.getRelativePosition(offsetElement, 150, 80);
    expect(pos.x).to.equal(200);
    expect(pos.y).to.equal(120);
  });
});
