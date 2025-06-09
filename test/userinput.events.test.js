import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/Position2D.js';
import { UserInputManager } from '../js/UserInputManager.js';

class StubElement extends EventTarget {
  constructor(width = 100, height = 100) {
    super();
    this.width = width;
    this.height = height;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
}

function mouseEvent(type, opts = {}) {
  const e = new Event(type);
  Object.assign(e, opts);
  return e;
}

function touchEvent(type, touches = [], changed = null) {
  const mk = (arr) => arr.map(([x, y]) => ({ clientX: x, clientY: y }));
  const e = new Event(type);
  e.touches = mk(touches);
  e.changedTouches = changed ? mk(changed) : mk(touches);
  return e;
}

describe('UserInputManager DOM events', function() {
  it('tracks mouse events and emits handlers', function() {
    const el = new StubElement(200, 100);
    const uim = new UserInputManager(el);
    const downs = [], moves = [], ups = [], zooms = [];
    uim.onMouseDown.on((e) => downs.push(e));
    uim.onMouseMove.on((e) => moves.push(e));
    uim.onMouseUp.on((e) => ups.push(e));
    uim.onZoom.on((e) => zooms.push(e));

    el.dispatchEvent(mouseEvent('mousedown', { clientX: 20, clientY: 10, button: 0 }));
    expect(uim.mouseButton).to.be.true;
    expect(uim.mouseDownX).to.equal(20);
    expect(uim.lastMouseX).to.equal(20);
    expect(downs).to.have.lengthOf(1);

    el.dispatchEvent(mouseEvent('mousemove', { clientX: 30, clientY: 25 }));
    expect(moves).to.have.lengthOf(1);
    expect(moves[0].deltaX).to.equal(-10);
    expect(moves[0].deltaY).to.equal(-15);
    expect(uim.lastMouseX).to.equal(30);
    expect(uim.lastMouseY).to.equal(25);

    el.dispatchEvent(mouseEvent('wheel', { clientX: 30, clientY: 25, deltaY: -40 }));
    expect(zooms).to.have.lengthOf(1);
    expect(zooms[0].deltaZoom).to.equal(40);

    el.dispatchEvent(mouseEvent('mouseup', { clientX: 30, clientY: 25, button: 0 }));
    expect(ups).to.have.lengthOf(1);
    expect(uim.mouseButton).to.be.false;
    expect(uim.lastMouseX).to.equal(0);
  });

  it('handles single-touch input', function() {
    const el = new StubElement();
    const uim = new UserInputManager(el);
    const downs = [], moves = [], ups = [];
    uim.onMouseDown.on((e) => downs.push(e));
    uim.onMouseMove.on((e) => moves.push(e));
    uim.onMouseUp.on((e) => ups.push(e));

    el.dispatchEvent(touchEvent('touchstart', [[10, 5]]));
    expect(uim.mouseDownX).to.equal(10);
    expect(downs).to.have.lengthOf(1);

    el.dispatchEvent(touchEvent('touchmove', [[15, 10]]));
    expect(moves).to.have.lengthOf(1);
    expect(moves[0].deltaX).to.equal(-5);
    expect(moves[0].deltaY).to.equal(-5);

    el.dispatchEvent(touchEvent('touchend', [], [[15, 10]]));
    expect(ups).to.have.lengthOf(1);
    expect(uim.mouseButton).to.be.false;
  });

  it('handles multi-touch pinch zoom', function() {
    const el = new StubElement();
    const uim = new UserInputManager(el);
    const downs = [], moves = [], ups = [], zooms = [];
    uim.onMouseDown.on((e) => downs.push(e));
    uim.onMouseMove.on((e) => moves.push(e));
    uim.onMouseUp.on((e) => ups.push(e));
    uim.onZoom.on((e) => zooms.push(e));

    el.dispatchEvent(touchEvent('touchstart', [[10, 10], [30, 10]]));
    expect(uim.twoTouch).to.be.true;
    expect(uim.lastTouchDistance).to.equal(20);
    expect(downs).to.have.lengthOf(1);

    el.dispatchEvent(touchEvent('touchmove', [[12, 10], [40, 10]]));
    expect(moves).to.have.lengthOf(1);
    expect(zooms).to.have.lengthOf(1);
    expect(Math.round(zooms[0].deltaZoom)).to.equal(-8);
    expect(uim.lastTouchDistance).to.equal(28);

    el.dispatchEvent(touchEvent('touchend', [], [[12, 10], [40, 10]]));
    expect(ups).to.have.lengthOf(1);
    expect(uim.twoTouch).to.be.false;
  });

  it('handles middle clicks and double clicks', function() {
    const el = new StubElement();
    const uim = new UserInputManager(el);
    let dbl = 0;
    uim.onDoubleClick.on(() => { dbl++; });

    el.dispatchEvent(mouseEvent('mousedown', { clientX: 5, clientY: 5, button: 1 }));
    expect(uim.mouseButton).to.be.true;
    expect(uim.mouseButtonNumber).to.equal(1);

    el.dispatchEvent(mouseEvent('mouseup', { clientX: 5, clientY: 5, button: 1 }));
    expect(uim.mouseButton).to.be.false;

    el.dispatchEvent(mouseEvent('dblclick', { clientX: 5, clientY: 5 }));
    expect(dbl).to.equal(1);
  });

  it('clears state on touchleave and touchcancel', function() {
    const el = new StubElement();
    const uim = new UserInputManager(el);
    el.dispatchEvent(touchEvent('touchstart', [[0, 0], [10, 0]]));
    expect(uim.twoTouch).to.be.true;

    el.dispatchEvent(touchEvent('touchleave'));
    expect(uim.twoTouch).to.be.false;

    el.dispatchEvent(touchEvent('touchstart', [[0, 0], [10, 0]]));
    expect(uim.twoTouch).to.be.true;
    el.dispatchEvent(touchEvent('touchcancel'));
    expect(uim.twoTouch).to.be.false;
  });
});
