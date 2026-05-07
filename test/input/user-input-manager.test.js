import { expect } from 'chai';
import { withGlobalLemmings } from '../helpers/lemmings.js';
import { UserInputManager } from '../../js/input/UserInputManager.js';
import { Position2D } from '../../js/util/Position2D.js';

const makeElement = () => {
  const listeners = new Map();
  const optionsByType = new Map();
  return {
    width: 100,
    height: 100,
    style: {},
    addEventListener(type, handler, options) {
      listeners.set(type, handler);
      optionsByType.set(type, options);
    },
    removeEventListener(type, handler, options) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
      if (optionsByType.get(type) === options) {
        optionsByType.delete(type);
      }
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 100 };
    },
    _listeners: listeners,
    _listenerOptions: optionsByType
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

  it('prevents native context menu events on the canvas surface', function () {
    const element = makeElement();
    new UserInputManager(element);
    let prevented = false;
    let stopped = false;
    element._listeners.get('contextmenu')({
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; }
    });
    expect(prevented).to.equal(true);
    expect(stopped).to.equal(true);
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

  it('handles wheel zoom via onZoom without directly mutating stage view', function() {
    const element = makeElement();
    const manager = new UserInputManager(element);
    const zoomEvents = [];
    manager.onZoom.on((evt) => zoomEvents.push(evt));

    const stageImage = { display: { worldDataSize: { width: 3000 } } };
    let updateCalls = 0;
    const stage = {
      gameImgProps: stageImage,
      getStageImageAt() { return stageImage; },
      updateViewPoint() { updateCalls += 1; }
    };
    withGlobalLemmings({ stage }, () => {
      manager.handleWheel(new Position2D(5, 5), 1);
      expect(updateCalls).to.equal(0);

      stage.getStageImageAt = () => null;
      manager.handleWheel(new Position2D(5, 5), 1);
      expect(zoomEvents.length).to.equal(2);
      expect(updateCalls).to.equal(0);
    });

    manager.handleWheel(new Position2D(5, 5), 1);
    expect(zoomEvents.length).to.equal(3);
    expect(updateCalls).to.equal(0);
  });

  it('configures passive listener options for touch and wheel events', function() {
    const element = makeElement();
    new UserInputManager(element);
    expect(element._listenerOptions.get('touchmove')).to.deep.equal({ passive: false });
    expect(element._listenerOptions.get('touchstart')).to.deep.equal({ passive: false });
    expect(element._listenerOptions.get('wheel')).to.deep.equal({ passive: false });
    expect(element._listenerOptions.get('mousemove')).to.deep.equal({ passive: true });
    expect(element._listenerOptions.get('mouseleave')).to.deep.equal({ passive: true });
  });

  it('uses fallback zoom event path when stage omits getStageImageAt', function() {
    const element = makeElement();
    const manager = new UserInputManager(element);
    const zoomEvents = [];
    manager.onZoom.on((evt) => zoomEvents.push(evt));
    withGlobalLemmings({ stage: {} }, () => {
      manager.handleWheel(new Position2D(4, 6), -2);
    });
    expect(zoomEvents).to.have.lengthOf(1);
    expect(zoomEvents[0].deltaZoom).to.equal(-2);
  });

  it('scales relative positions from canvas space', function() {
    const element = makeElement();
    element.width = 200;
    element.height = 300;
    element.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 150 });
    const manager = new UserInputManager(element);

    const point = manager.getRelativePosition(element, 60, 95);
    expect(point.x).to.equal(100);
    expect(point.y).to.equal(150);
  });

  it('keeps relative position finite when canvas or rect dimensions are zero', function() {
    const element = makeElement();
    element.width = 0;
    element.height = 0;
    element.getBoundingClientRect = () => ({ left: 10, top: 20, width: 0, height: 0 });
    const manager = new UserInputManager(element);

    const point = manager.getRelativePosition(element, 60, 95);
    expect(Number.isFinite(point.x)).to.equal(true);
    expect(Number.isFinite(point.y)).to.equal(true);
    expect(point.x).to.equal(50);
    expect(point.y).to.equal(75);
  });

  it('uses safe defaults when the element does not expose bounding rect APIs', function() {
    const manager = new UserInputManager(makeElement());
    const point = manager.getRelativePosition({}, 12, 34);
    expect(point.x).to.equal(12);
    expect(point.y).to.equal(34);
  });

  it('disposes listeners safely', function() {
    const element = makeElement();
    const manager = new UserInputManager(element);
    manager.dispose();
    expect(element._listeners.size).to.equal(0);
  });
});
