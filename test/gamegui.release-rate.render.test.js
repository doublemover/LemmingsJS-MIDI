import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/SkillTypes.js';
import { GameGui } from '../js/GameGui.js';

class DisplayStub {
  constructor() {
    this.calls = [];
    this.onMouseDown = new Lemmings.EventHandler();
    this.onMouseUp = new Lemmings.EventHandler();
    this.onMouseRightDown = new Lemmings.EventHandler();
    this.onMouseRightUp = new Lemmings.EventHandler();
    this.onMouseMove = new Lemmings.EventHandler();
    this.onDoubleClick = new Lemmings.EventHandler();
    this.stage = { updateStageSize() {} };
  }
  initSize() {}
  setBackground() {}
  get worldDataSize() { return { width: 200, height: 40 }; }
  drawFrame(...args) { this.calls.push({ op: 'drawFrame', args }); }
  drawFrameCovered(...args) { this.calls.push({ op: 'drawFrameCovered', args }); }
  drawFrameResized(...args) { this.calls.push({ op: 'drawFrameResized', args }); }
  drawRect(...args) { this.calls.push({ op: 'drawRect', args }); }
  drawStippleRect(...args) { this.calls.push({ op: 'drawStippleRect', args }); }
  drawMarchingAntRect(...args) { this.calls.push({ op: 'drawMarchingAntRect', args }); }
  drawHorizontalLine(...args) { this.calls.push({ op: 'drawHorizontalLine', args }); }
  setPixel(...args) { this.calls.push({ op: 'setPixel', args }); }
  redraw() {}
}

class TimerStub {
  constructor() { this.running = true; this.speedFactor = 1; this.eachGameSecond = { on() {}, off() {} }; }
  isRunning() { return this.running; }
}

class VictoryStub {
  constructor() { this.min = 1; this.max = 10; this.cur = 5; }
  getMinReleaseRate() { return this.min; }
  getMaxReleaseRate() { return this.max; }
  getCurrentReleaseRate() { return this.cur; }
  setCurrentReleaseRate(v) { this.cur = v; }
  getOutCount() { return 0; }
  getSurvivorPercentage() { return 0; }
}

class SkillsStub {
  constructor() {
    this.onCountChanged = new Lemmings.EventHandler();
    this.onSelectionChanged = new Lemmings.EventHandler();
    this.selectedSkill = Lemmings.SkillTypes.UNKNOWN;
  }
  getSkill() { return 1; }
  getSelectedSkill() { return this.selectedSkill; }
}

class SpritesStub {
  getPanelSprite() { return { width: 176, height: 40, getData() { return [0]; } }; }
  getNumberSpriteLeft(n) { return 'L' + n; }
  getNumberSpriteRight(n) { return 'R' + n; }
  getNumberSpriteEmpty() { return 'E'; }
  getLetterSprite(ch) { return 'ch-' + ch; }
}

class MiniMapStub {
  constructor() { this.renderCalls = []; }
  render(x, w) { this.renderCalls.push({ x, w }); }
  dispose() {}
}

function makeGui() {
  const game = { gameDisplay: {}, level: { screenPositionX: 42 }, queueCommand() {} };
  const display = new DisplayStub();
  const timer = new TimerStub();
  const victory = new VictoryStub();
  const skills = new SkillsStub();
  const sprites = new SpritesStub();
  const gui = new GameGui(game, sprites, skills, timer, victory);
  gui.setGuiDisplay(display);
  gui.setMiniMap(new MiniMapStub());
  return { gui, display, victory };
}

describe('GameGui release-rate render', function() {
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

  it('renders digits and lock edges when release rate changes', function() {
    const { gui, display, victory } = makeGui();
    victory.min = 1;
    victory.max = 5;
    victory.cur = 1;
    gui.releaseRateChanged = true;
    const locks = [];
    gui._drawLockEdge = (d, idx) => { locks.push(idx); };
    gui.render();
    const drawn = display.calls.filter(c => c.op === 'drawFrame' || c.op === 'drawFrameResized');
    expect(drawn.length).to.be.greaterThan(0);
    expect(locks).to.deep.equal([0]);
    expect(gui._rrLockMin).to.equal(true);
    expect(gui.miniMap.renderCalls[0].x).to.equal(42);
  });

  it('clears lock edges when rate moves away from min', function() {
    const { gui, victory } = makeGui();
    victory.min = 1;
    victory.max = 5;
    victory.cur = 1;
    gui.releaseRateChanged = true;
    gui.render();
    victory.cur = 3;
    gui.releaseRateChanged = true;
    gui.backgroundChanged = false;
    gui.render();
    expect(gui._rrLockMin).to.equal(false);
    expect(gui.backgroundChanged).to.equal(true);
  });

  it('drawSpeedChange respects hover flags', function() {
    const { gui, display } = makeGui();
    gui._hoverSpeedUp = true;
    gui.drawSpeedChange(true);
    expect(display.calls.filter(c => c.op === 'drawHorizontalLine').length).to.be.greaterThan(0);
    display.calls = [];
    gui._hoverSpeedUp = false;
    gui._hoverSpeedDown = true;
    gui.drawSpeedChange(false);
    expect(display.calls.filter(c => c.op === 'drawHorizontalLine').length).to.be.greaterThan(0);
    expect(gui.gameSpeedChanged).to.equal(true);
  });

  it('drawNukeHover draws marching rectangle', function() {
    const { gui, display } = makeGui();
    gui.selectionDashLen = 4;
    gui._selectionOffset = 2;
    gui.drawNukeHover(display);
    expect(display.calls[0]).to.deep.equal({
      op: 'drawMarchingAntRect',
      args: [16 * 11, 16, 16, 23, 4, 4, 0xFF0080FF, 0xFF00FFFF]
    });
  });
});
