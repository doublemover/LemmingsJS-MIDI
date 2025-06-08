import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/DisplayImage.js';
import '../js/SkillTypes.js';

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

  it('dispose removes optional move handler', function() {
    const { lm, om, tm, level } = createManagers({ x: 0, y: 0 });
    const gd = new Lemmings.GameDisplay({ showDebug: false }, level, lm, om, tm);
    const display = createDisplay();

    gd.setGuiDisplay(display);
    gd._moveHandler = () => {};
    display.onMouseMove.on(gd._moveHandler);
    expect(display.onMouseMove.handlers.has(gd._moveHandler)).to.be.true;
    gd.dispose();
    expect(display.onMouseMove.handlers.has(gd._moveHandler)).to.be.false;
  });

  it('renderDebug early returns without a display', function() {
    const { lm, om, tm, level } = createManagers({ x: 0, y: 0 });
    const gd = new Lemmings.GameDisplay({ showDebug: false }, level, lm, om, tm);
    gd.renderDebug();
    expect(level.debugCalled).to.equal(0);
    expect(lm.debugCalled).to.equal(0);
    expect(tm.debugCalled).to.equal(0);
  });

  it('draws yellow selection when action matches selected skill', function() {
    class DummyAction {}
    Lemmings.ActionBashSystem = DummyAction;
    const selected = { x: 5, y: 5, removed: false, action: new DummyAction() };
    const lm = {
      render() {},
      renderDebug() {},
      getSelectedLemming() { return selected; },
      getNearestLemming() { return null; }
    };
    const level = { render() {}, renderDebug() {}, screenPositionX: 0 };
    const game = {
      showDebug: false,
      getGameSkills() { return { getSelectedSkill() { return Lemmings.SkillTypes.BASHER; } }; }
    };
    const gd = new Lemmings.GameDisplay(game, level, lm, { render() {} }, { renderDebug() {} });
    const display = createDisplay();
    gd.setGuiDisplay(display);

    gd.render();
    const args = display.drawCornerRectCalls[0];
    expect(args.slice(3, 6)).to.eql([0x00, 0xff, 0xff]);
  });
});
