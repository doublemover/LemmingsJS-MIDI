import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/SkillTypes.js';
import { GameTimer } from '../js/GameTimer.js';
import { GameGui } from '../js/GameGui.js';
import fakeTimers from '@sinonjs/fake-timers';

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
  get worldDataSize() { return { width: this.width, height: this.height }; }
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
  constructor() { this.eachGameSecond = new Lemmings.EventHandler(); this.speedFactor = 1; this.running = true; }
  isRunning() { return this.running; }
  getGameLeftTimeString() { return '1:00'; }
  getGameTime() { return 0; }
}

class GameVictoryStub {
  constructor() { this.min = 1; this.max = 10; this.cur = 5; this.out = 0; this.survivor = 50; }
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
  clearSelectedSkill() { const changed = this.selectedSkill !== Lemmings.SkillTypes.UNKNOWN; this.selectedSkill = Lemmings.SkillTypes.UNKNOWN; if (changed) this.onSelectionChanged.trigger(); return changed; }
}

class SpritesStub {
  getPanelSprite() { return { width: 176, height: 40, getData() { return [0]; } }; }
  getNumberSpriteLeft() { return {}; }
  getNumberSpriteRight() { return {}; }
  getNumberSpriteEmpty() { return {}; }
  getLetterSprite() { return {}; }
}

class MiniMapStub {
  constructor() {}
  render() {}
  dispose() {}
}

describe('bench TPS', function() {
  let clock;
  let origMiniMap;
  beforeEach(function() {
    globalThis.lemmings = Lemmings;
    lemmings.bench = false;
    lemmings.endless = false;
    origMiniMap = Lemmings.MiniMap;
    Lemmings.MiniMap = MiniMapStub;

    globalThis.document = { visibilityState: 'visible', hasFocus() { return true; }, addEventListener() {}, removeEventListener() {} };
    globalThis.window = { requestAnimationFrame() {}, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {} };
    clock = fakeTimers.withGlobal(globalThis).install({ now: 0 });
  });

  afterEach(function() {
    clock.uninstall();
    delete globalThis.window;
    delete globalThis.document;
    Lemmings.MiniMap = origMiniMap;
    delete global.lemmings;
  });

  it('computes tps from frame time', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    expect(timer.tps).to.be.closeTo(1000 / timer.TIME_PER_FRAME_MS, 0.001);
    timer.speedFactor = 2;
    expect(timer.tps).to.be.closeTo(1000 / (timer.TIME_PER_FRAME_MS / 2), 0.001);
  });

  it('render shows queued frames and TPS in bench mode', function() {
    lemmings.bench = true;
    lemmings.steps = 3;
    lemmings.tps = 30;
    const timer = new GameTimerStub();
    const vc = new GameVictoryStub();
    const skills = new GameSkillsStub();
    const sprites = new SpritesStub();
    const game = { gameDisplay: {}, level: { width: 200, height: 100, screenPositionX: 0 }, queueCommand() {} };
    const gui = new GameGui(game, sprites, skills, timer, vc);
    const disp = new DisplayImageStub();
    gui.setGuiDisplay(disp);
    const drawn = [];
    gui.drawGreenString = (d, text, x) => { drawn.push({ text, x }); };
    gui.gameTimeChanged = true;
    gui.gameSpeedChanged = true;
    gui.render();
    const spawnCount = game.getLemmingManager?.().spawnTotal ?? 0;
    const strings = [
      'T' + lemmings.steps,
      'TPS ' + Math.round(lemmings.tps),
      'Spawn ' + spawnCount
    ];
    let xpos = 0;
    expect(drawn.length).to.equal(strings.length);
    for (let i = 0; i < strings.length; i++) {
      expect(drawn[i].text).to.equal(strings[i]);
      expect(drawn[i].x).to.equal(xpos);
      xpos += strings[i].length * 8;
    }
  });
});
