import { expect } from 'chai';
import { UserInputManager } from '../../js/input/UserInputManager.js';
import { Position2D } from '../../js/util/Position2D.js';

const makeElement = () => {
  const listeners = new Map();
  return {
    width: 100,
    height: 100,
    style: {},
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 100 };
    },
    _listeners: listeners
  };
};

const makeEvent = (fields = {}) => ({
  stopPropagation() {},
  preventDefault() {},
  ...fields
});

const touch = (x, y) => ({ clientX: x, clientY: y });

describe('UserInputManager', function() {
  it('tracks mouse movement and buttons', function() {
    const element = makeElement();
    const manager = new UserInputManager(element);
    const moves = [];
    manager.onMouseMove.on((evt) => moves.push(evt));

    manager.handleMouseMove(new Position2D(5, 5));
    expect(moves[0].button).to.equal(false);

    manager.handleMouseDown(new Position2D(10, 10));
    manager.handleMouseMove(new Position2D(12, 13));
    expect(moves[1].button).to.equal(true);
    expect(moves[1].deltaX).to.equal(-2);
    expect(moves[1].deltaY).to.equal(-3);

    manager.handleMouseUp(new Position2D(0, 0));
    expect(manager.mouseButton).to.equal(false);
  });

  it('handles mouse events from listeners', function() {
    const element = makeElement();
    const manager = new UserInputManager(element);
    const rightDown = [];
    const rightUp = [];
    manager.onMouseRightDown.on((pos) => rightDown.push(pos));
    manager.onMouseRightUp.on((pos) => rightUp.push(pos));

    element._listeners.get('mousemove')(makeEvent({ clientX: 1, clientY: 2 }));
    element._listeners.get('mousedown')(makeEvent({ clientX: 5, clientY: 6, button: 2 }));
    element._listeners.get('mouseup')(makeEvent({ clientX: 7, clientY: 8, button: 2 }));
    expect(rightDown[0].x).to.equal(5);
    expect(rightUp[0].y).to.equal(8);

    element._listeners.get('mousedown')(makeEvent({ clientX: 1, clientY: 2, button: 1 }));
    element._listeners.get('mouseup')(makeEvent({ clientX: 1, clientY: 2, button: 1 }));
    element._listeners.get('mousedown')(makeEvent({ clientX: 3, clientY: 4, button: 0 }));
    element._listeners.get('mouseup')(makeEvent({ clientX: 3, clientY: 4, button: 0 }));
    element._listeners.get('mouseleave')(makeEvent());
    element._listeners.get('dblclick')(makeEvent({ clientX: 2, clientY: 3 }));
    element._listeners.get('wheel')(makeEvent({ clientX: 2, clientY: 3, deltaY: 5 }));
  });

  it('handles touch gestures and cleanup', function() {
    const element = makeElement();
    const manager = new UserInputManager(element);
    const zoomEvents = [];
    manager.onZoom.on((evt) => zoomEvents.push(evt));

    element._listeners.get('touchstart')(makeEvent({ touches: [touch(1, 2), touch(3, 4), touch(5, 6)] }));
    element._listeners.get('touchstart')(makeEvent({ touches: [] }));
    element._listeners.get('touchmove')(makeEvent({ touches: [touch(1, 2), touch(4, 6)] }));
    element._listeners.get('touchmove')(makeEvent({ touches: [touch(2, 3)] }));

    manager.handleMouseClear();
    element._listeners.get('touchstart')(makeEvent({ touches: [touch(1, 2)] }));
    element._listeners.get('touchmove')(makeEvent({ touches: [touch(2, 3)] }));
    element._listeners.get('touchstart')(makeEvent({ touches: [touch(1, 2), touch(4, 6)] }));
    element._listeners.get('touchmove')(makeEvent({ touches: [touch(2, 3), touch(5, 7)] }));
    element._listeners.get('touchmove')(makeEvent({ touches: [touch(1, 2), touch(3, 4), touch(5, 6)] }));

    element._listeners.get('touchend')(makeEvent({ touches: [touch(9, 9)] }));
    element._listeners.get('touchstart')(makeEvent({ touches: [touch(1, 2), touch(4, 6)] }));
    element._listeners.get('touchend')(makeEvent({ touches: [] }));
    element._listeners.get('touchend')(makeEvent({ touches: [], changedTouches: [] }));
    element._listeners.get('touchend')(makeEvent({ touches: [], changedTouches: [touch(4, 5)] }));

    element._listeners.get('touchleave')(makeEvent());
    element._listeners.get('touchcancel')(makeEvent());

    expect(zoomEvents.length).to.be.greaterThan(0);
  });

  it('handles wheel zoom with and without stage targets', function() {
    const element = makeElement();
    const manager = new UserInputManager(element);
    const zoomEvents = [];
    manager.onZoom.on((evt) => zoomEvents.push(evt));

    const stageImage = { display: { worldDataSize: { width: 1600 } } };
    const stage = {
      getStageImageAt() { return stageImage; },
      updateViewPoint() { stage.updated = true; }
    };
    const originalLemmings = globalThis.lemmings;
    globalThis.lemmings = { stage };
    manager.handleWheel(new Position2D(5, 5), 1);
    expect(stage.updated).to.equal(true);

    stage.getStageImageAt = () => null;
    manager.handleWheel(new Position2D(5, 5), 1);
    expect(zoomEvents.length).to.equal(2);

    globalThis.lemmings = originalLemmings;
    manager.handleWheel(new Position2D(5, 5), 1);
    expect(zoomEvents.length).to.equal(3);
  });

  it('disposes listeners safely', function() {
    const element = makeElement();
    const manager = new UserInputManager(element);
    manager.dispose();
    expect(element._listeners.size).to.equal(0);
  });
});
