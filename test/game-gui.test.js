import { expect } from 'chai';
import { EventHandler } from '../js/util/EventHandler.js';
import { GameGui, SmoothScroller } from '../js/game/GameGui.js';
import { SkillTypes } from '../js/game/SkillTypes.js';

function makeGui() {
  const skills = {
    onCountChanged: new EventHandler(),
    onSelectionChanged: new EventHandler(),
    getSelectedSkill() { return SkillTypes.BASHER; }
  };
  const timer = {
    eachGameSecond: new EventHandler(),
    isRunning() { return false; },
    getGameTime() { return 0; }
  };
  const victory = {
    getMinReleaseRate() { return 10; },
    getCurrentReleaseRate() { return 20; },
    getMaxReleaseRate() { return 99; }
  };
  const skillPanelSprites = {
    getPanelSprite() { return { id: 'panel' }; },
    getNumberSpriteEmpty() { return { id: 'empty' }; },
    getNumberSpriteLeft(n) { return { id: `L${n}` }; },
    getNumberSpriteRight(n) { return { id: `R${n}` }; },
    getLetterSprite(ch) { return { id: `G${ch}` }; }
  };
  const game = { lemmingManager: { setMiniMap() {} } };
  return new GameGui(game, skillPanelSprites, skills, timer, victory);
}

describe('GameGui utilities', function() {
  it('draws numbers and caches digits', function() {
    const gui = makeGui();
    const display = {
      frames: [],
      covered: [],
      drawFrame(frame) { this.frames.push(frame); },
      drawFrameCovered(frame) { this.covered.push(frame); }
    };

    gui.drawNumber(display, 0, 1, 2);
    expect(display.frames[0].id).to.equal('empty');

    gui.drawNumber(display, 42, 1, 2);
    gui.drawNumber(display, 42, 1, 2);
    const leftCount = display.covered.filter(f => f.id === 'L4').length;
    const rightCount = display.frames.filter(f => f.id === 'R2').length;
    expect(leftCount).to.equal(2);
    expect(rightCount).to.equal(2);
  });

  it('draws green strings with cached letters', function() {
    const gui = makeGui();
    const display = { covered: [], drawFrameCovered(frame) { this.covered.push(frame); } };
    gui.drawGreenString(display, 'AA', 0, 0);
    expect(display.covered).to.have.length(2);
    expect(display.covered[0].id).to.equal('GA');
  });

  it('maps skills and panel names', function() {
    const gui = makeGui();
    expect(gui.getSkillByPanelIndex(2)).to.equal(SkillTypes.CLIMBER);
    expect(gui.getPanelIndexBySkill(SkillTypes.DIGGER)).to.equal(9);
    expect(gui._getPanelName(0)).to.equal('Decrease');
    expect(gui._getPanelName(1)).to.equal('Increase');
    expect(gui._getPanelName(10)).to.equal('Pause');
    expect(gui._getPanelName(11)).to.equal('Nuke');
    expect(gui._getPanelName(2)).to.equal('Climber');
    expect(gui._getPanelName(99)).to.equal('');
  });

  it('draws selection and hover highlights', function() {
    const gui = makeGui();
    const display = {
      ants: [],
      rects: [],
      drawMarchingAntRect(...args) { this.ants.push(args); },
      drawRect(...args) { this.rects.push(args); }
    };
    gui.drawSelection(display, -1);
    gui.drawSelection(display, 2);
    gui.drawPaused(display);
    gui.drawSkillHover(display, 3);
    expect(display.ants).to.have.length(2);
    expect(display.rects).to.have.length(1);
  });

  it('draws lock edges and speed changes', function() {
    const gui = makeGui();
    const display = {
      lines: 0,
      stipples: 0,
      drawHorizontalLine() { this.lines += 1; },
      drawStippleRect() { this.stipples += 1; }
    };
    gui.display = display;
    gui._drawLockEdge(display, 0);
    gui.drawSpeedChange(true);
    gui._hoverSpeedUp = true;
    gui.drawSpeedChange(false);
    gui._hoverSpeedUp = false;
    gui._hoverSpeedDown = true;
    gui.drawSpeedChange(false, true);
    expect(display.stipples).to.equal(4);
    expect(display.lines).to.be.greaterThan(0);
  });

  it('forwards minimap assignment to lemming manager', function() {
    const gui = makeGui();
    let called = 0;
    gui.game.lemmingManager.setMiniMap = () => { called += 1; };
    gui.setMiniMap({ id: 1 });
    expect(called).to.equal(1);
  });
});

describe('SmoothScroller', function() {
  it('handles impulses and velocity updates', function() {
    const scroller = new SmoothScroller();
    const originalLog = console.log;
    const logs = [];
    console.log = msg => logs.push(msg);
    scroller.addImpulse(0);
    scroller.addImpulse(100);
    expect(scroller.velocity).to.equal(50);
    scroller.addImpulse(-200);
    expect(scroller.velocity).to.equal(0);
    scroller.velocity = 490;
    scroller.addImpulse(1000);
    expect(scroller.velocity).to.equal(500);
    scroller.velocity = -490;
    scroller.addImpulse(-1000);
    expect(scroller.velocity).to.equal(-500);
    console.log = originalLog;

    let last = null;
    scroller.onHasVelocity.on(v => { last = v; });
    scroller.update();
    scroller.velocity = 0.01;
    scroller.update();
    expect(last).to.equal(0);
    expect(logs.length).to.equal(1);
  });

  it('reports whether velocity is active', function() {
    const scroller = new SmoothScroller();
    scroller.velocity = 0;
    expect(scroller.hasVelocity()).to.equal(false);
    scroller.velocity = scroller.minVelocity;
    expect(scroller.hasVelocity()).to.equal(true);
  });
});
