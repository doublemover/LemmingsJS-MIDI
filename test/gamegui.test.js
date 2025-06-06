import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/SkillTypes.js';
import '../js/CommandReleaseRateIncrease.js';
import '../js/CommandReleaseRateDecrease.js';
import { GameGui } from '../js/GameGui.js';

class DisplayImageStub {
  constructor() {
    this.width = 176;
    this.height = 40;
    this.onMouseDown = new Lemmings.EventHandler();
    this.onMouseUp = new Lemmings.EventHandler();
    this.onMouseRightDown = new Lemmings.EventHandler();
    this.onMouseRightUp = new Lemmings.EventHandler();
    this.onMouseMove = new Lemmings.EventHandler();
    this.onDoubleClick = new Lemmings.EventHandler();
    this.calls = [];
  }
  initSize(w, h) { this.initArgs = [w, h]; }
  setBackground(bg) { this.background = bg; }
  getWidth() { return this.width; }
  getHeight() { return this.height; }
  drawFrame(frame, x, y) { this.calls.push({ op: 'drawFrame', frame, x, y }); }
  drawFrameCovered(frame, x, y) { this.calls.push({ op: 'drawFrameCovered', frame, x, y }); }
  drawFrameResized(frame, x, y, w, h) { this.calls.push({ op: 'drawFrameResized', frame, x, y, w, h }); }
  drawRect(...args) { this.calls.push({ op: 'drawRect', args }); }
  drawStippleRect(...args) { this.calls.push({ op: 'drawStippleRect', args }); }
  drawMarchingAntRect(...args) { this.calls.push({ op: 'drawMarchingAntRect', args }); }
  drawHorizontalLine(...args) { this.calls.push({ op: 'drawHorizontalLine', args }); }
  setPixel(...args) { this.calls.push({ op: 'setPixel', args }); }
  redraw() { this.redrawCalled = true; }
  setScreenPosition(x, y) { this.pos = [x, y]; }
}

class GameTimerStub {
  constructor() {
    this.eachGameSecond = new Lemmings.EventHandler();
    this.speedFactor = 1;
    this.running = true;
  }
  isRunning() { return this.running; }
  getGameLeftTimeString() { return '1:00'; }
  getGameTime() { return 0; }
}

class GameVictoryConditionStub {
  constructor() {
    this.min = 1;
    this.max = 10;
    this.cur = 5;
    this.out = 0;
    this.survivor = 50;
  }
  getMinReleaseRate() { return this.min; }
  getMaxReleaseRate() { return this.max; }
  getCurrentReleaseRate() { return this.cur; }
  setCurrentReleaseRate(v) { this.cur = v; }
  getOutCount() { return this.out; }
  getSurvivorPercentage() { return this.survivor; }
}

class GameSkillsStub {
  constructor() {
    this.onCountChanged = new Lemmings.EventHandler();
    this.onSelectionChanged = new Lemmings.EventHandler();
    this.skills = new Array(Object.keys(Lemmings.SkillTypes).length).fill(2);
    this.selectedSkill = Lemmings.SkillTypes.CLIMBER;
  }
  getSkill(s) { return this.skills[s]; }
  setSelectedSkill(s) { this.selectedSkill = s; this.onSelectionChanged.trigger(); }
  getSelectedSkill() { return this.selectedSkill; }
  clearSelectedSkill() {
    const changed = this.selectedSkill !== Lemmings.SkillTypes.UNKNOWN;
    this.selectedSkill = Lemmings.SkillTypes.UNKNOWN;
    if (changed) this.onSelectionChanged.trigger();
    return changed;
  }
}

class SkillPanelSpritesStub {
  constructor() {
    this.panel = { width: 176, height: 40, getData() { return [0]; } };
  }
  getPanelSprite() { return this.panel; }
  getNumberSpriteLeft(n) { return 'L' + n; }
  getNumberSpriteRight(n) { return 'R' + n; }
  getNumberSpriteEmpty() { return 'E'; }
  getLetterSprite(ch) { return 'ch-' + ch; }
}

class MiniMapStub {
  constructor(gd, lvl, disp) { this.args = [gd, lvl, disp]; this.renderCalls = []; }
  render(x, w) { this.renderCalls.push({ x, w }); }
  dispose() {}
}

describe('GameGui', function() {
  let origMiniMap;
  beforeEach(function() {
    global.window = {
      requestAnimationFrame(cb) { return 1; },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
      clearTimeout
    };
    global.lemmings = { bench: false, game: { showDebug: false } };
    origMiniMap = Lemmings.MiniMap;
    Lemmings.MiniMap = MiniMapStub;
  });

  afterEach(function() {
    Lemmings.MiniMap = origMiniMap;
    delete global.window;
    delete global.lemmings;
  });

  function makeGui() {
    const game = { gameDisplay: {}, level: { width: 200, height: 100, screenPositionX: 0 }, queueCommand() {} };
    const display = new DisplayImageStub();
    const timer = new GameTimerStub();
    const vc = new GameVictoryConditionStub();
    const skills = new GameSkillsStub();
    const sprites = new SkillPanelSpritesStub();
    const gui = new GameGui(game, sprites, skills, timer, vc);
    gui.setGuiDisplay(display);
    return { gui, display, timer, vc, skills, game };
  }

  it('setGuiDisplay attaches listeners and creates MiniMap', function() {
    const { gui, display } = makeGui();
    expect(display.onMouseDown.handlers.size).to.be.greaterThan(0);
    expect(gui.miniMap).to.be.instanceOf(MiniMapStub);
    expect(gui._guiRafId).to.equal(1);
  });

  it('render draws digits and letters when flags set', function() {
    const { gui, display } = makeGui();
    display.calls = [];
    gui.gameTimeChanged = true;
    gui.skillsCountChanged = true;
    gui.releaseRateChanged = true;
    gui.render();
    const hasLetters = display.calls.some(c => c.op === 'drawFrameCovered');
    const hasNumbers = display.calls.some(c => c.op === 'drawFrame');
    expect(hasLetters).to.be.true;
    expect(hasNumbers).to.be.true;
  });

  it('mouse clicks adjust release rate and speed', function() {
    const { gui, display, timer, vc } = makeGui();
    display.onMouseDown.trigger({ x: 0, y: 20 });
    expect(gui.deltaReleaseRate).to.equal(-3);
    expect(vc.cur).to.be.below(5);

    display.onMouseRightDown.trigger({ x: 0, y: 20 });
    expect(vc.cur).to.equal(vc.min);

    display.onMouseDown.trigger({ x: 160, y: 33 });
    expect(timer.speedFactor).to.be.below(1);

    timer.speedFactor = 2;
    display.onMouseRightDown.trigger({ x: 160, y: 20 });
    expect(timer.speedFactor).to.equal(1);
  });

  it('drawSpeedChange and drawSelection trigger drawing', function() {
    const { gui, display } = makeGui();
    display.calls = [];
    gui.drawSpeedChange(true);
    gui.drawSelection(display, 2);
    const speedLines = display.calls.filter(c => c.op === 'drawHorizontalLine');
    const select = display.calls.find(c => c.op === 'drawMarchingAntRect');
    expect(speedLines.length).to.be.greaterThan(0);
    expect(select).to.exist;
  });

  it('renders minimap view', function() {
    const { gui, display, game } = makeGui();
    game.level.screenPositionX = 42;
    gui.render();
    expect(gui.miniMap.renderCalls[0].x).to.equal(42);
    expect(gui.miniMap.renderCalls[0].w).to.equal(display.getWidth());
  });
});
