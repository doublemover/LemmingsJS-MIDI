import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/Position2D.js';
import { UserInputManager } from '../js/UserInputManager.js';

// minimal element stub
const element = {
  addEventListener() {},
  removeEventListener() {},
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 480 };
  }
};

globalThis.lemmings = { game: { showDebug: false } };

describe('UserInputManager', function() {
  it('emits zoom events with cursor position', function(done) {
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
});
