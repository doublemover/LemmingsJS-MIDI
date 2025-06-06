import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/DisplayImage.js';

globalThis.lemmings = { game: { showDebug: false } };

function createDisplay() {
  return {
    onMouseMove: new Lemmings.EventHandler(),
    drawCornerRectCalls: [],
    drawDashedRectCalls: [],
    drawCornerRect(...args) { this.drawCornerRectCalls.push(args); },
    drawDashedRect(...args) { this.drawDashedRectCalls.push(args); }
  };
}

function createManagers(lem) {
  const lm = {
    renderCalled: 0,
    debugCalled: 0,
    render() { this.renderCalled++; },
    renderDebug() { this.debugCalled++; },
    getSelectedLemming() { return null; },
    getNearestLemming() { return lem; }
  };
  const om = { renderCalled: 0, render(d) { this.renderCalled++; } };
  const tm = { debugCalled: 0, renderDebug(d) { this.debugCalled++; } };
  const level = {
    renderCalled: 0,
    debugCalled: 0,
    screenPositionX: 0,
    render() { this.renderCalled++; },
    renderDebug() { this.debugCalled++; }
  };
  return { lm, om, tm, level };
}

describe('GameDisplay extra', function() {
  it('render draws components and uses _mouseMoveHandler for hover', function() {
    const hovered = { x: 10, y: 20, removed: false };
    const { lm, om, tm, level } = createManagers(hovered);
    const gd = new Lemmings.GameDisplay({ showDebug: false }, level, lm, om, tm);
    const display = createDisplay();

    gd.setGuiDisplay(display);
    expect(display.onMouseMove.handlers.has(gd._mouseMoveHandler)).to.be.true;

    display.onMouseMove.trigger({ x: 1, y: 2 });
    expect(gd.hoverLemming).to.equal(hovered);

    gd.render();
    expect(level.renderCalled).to.equal(1);
    expect(om.renderCalled).to.equal(1);
    expect(lm.renderCalled).to.equal(1);
    expect(display.drawCornerRectCalls).to.have.lengthOf(1);
  });

  it('renderDebug draws rectangles and increments dash offset', function() {
    const hovered = { x: 5, y: 5 };
    const { lm, om, tm, level } = createManagers(hovered);
    const gd = new Lemmings.GameDisplay({ showDebug: false }, level, lm, om, tm);
    const display = createDisplay();
    gd.setGuiDisplay(display);
    gd.hoverLemming = hovered;

    expect(gd._dashOffset).to.equal(0);
    gd.renderDebug();
    expect(level.debugCalled).to.equal(1);
    expect(lm.debugCalled).to.equal(1);
    expect(tm.debugCalled).to.equal(1);
    expect(display.drawDashedRectCalls[0][5]).to.equal(0);
    expect(gd._dashOffset).to.equal(1);

    gd.renderDebug();
    expect(display.drawDashedRectCalls[1][5]).to.equal(1);
    expect(gd._dashOffset).to.equal(2);
  });

  it('dispose removes display listeners', function() {
    const hovered = { x: 1, y: 1 };
    const { lm, om, tm, level } = createManagers(hovered);
    const gd = new Lemmings.GameDisplay({ showDebug: false }, level, lm, om, tm);
    const display = createDisplay();

    gd.setGuiDisplay(display);
    expect(display.onMouseMove.handlers.size).to.equal(1);
    gd.dispose();
    expect(display.onMouseMove.handlers.size).to.equal(0);
    expect(gd._mouseMoveHandler).to.equal(null);
  });
});
