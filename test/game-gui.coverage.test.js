import { expect } from 'chai';
import { EventHandler } from '../js/util/EventHandler.js';
import { GameGui } from '../js/game/GameGui.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { CommandNuke } from '../js/commands/CommandNuke.js';
import { CommandSelectSkill } from '../js/commands/CommandSelectSkill.js';
import { CommandReleaseRateIncrease } from '../js/commands/CommandReleaseRateIncrease.js';
import { CommandReleaseRateDecrease } from '../js/commands/CommandReleaseRateDecrease.js';
import { setDependency, resetDependencies } from './helpers/lemmings.js';

const makeSprites = () => {
  const panelSprite = {
    width: 320,
    height: 40,
    getData() { return new Uint8ClampedArray(320 * 40 * 4); }
  };
  return {
    getPanelSprite() { return panelSprite; },
    getNumberSpriteEmpty() { return { id: 'empty' }; },
    getNumberSpriteLeft(n) { return { id: `L${n}` }; },
    getNumberSpriteRight(n) { return { id: `R${n}` }; },
    getLetterSprite(ch) { return { id: `G${ch}` }; }
  };
};

const makeDisplay = () => ({
  worldDataSize: { width: 320, height: 40 },
  initCalls: [],
  backgroundCalls: 0,
  rects: [],
  frames: [],
  covered: [],
  resized: [],
  stipples: 0,
  ants: 0,
  hlines: 0,
  pixels: 0,
  redrawCalls: 0,
  stage: { updateStageSize() { this.updated = true; } },
  onMouseDown: new EventHandler(),
  onMouseUp: new EventHandler(),
  onMouseRightDown: new EventHandler(),
  onMouseRightUp: new EventHandler(),
  onDoubleClick: new EventHandler(),
  onMouseMove: new EventHandler(),
  initSize(width, height) {
    this.initCalls.push({ width, height });
    this.worldDataSize = { width, height };
  },
  setBackground() { this.backgroundCalls += 1; },
  redraw() { this.redrawCalls += 1; },
  drawRect(...args) { this.rects.push(args); },
  drawFrame(frame) { this.frames.push(frame); },
  drawFrameCovered(frame) { this.covered.push(frame); },
  drawFrameResized(...args) { this.resized.push(args); },
  drawStippleRect() { this.stipples += 1; },
  drawMarchingAntRect() { this.ants += 1; },
  drawHorizontalLine() { this.hlines += 1; },
  setPixel() { this.pixels += 1; }
});

const makeGui = (options = {}) => {
  const skillCounts = { [SkillTypes.CLIMBER]: 2, [SkillTypes.BASHER]: 1 };
  let selectedSkill = SkillTypes.UNKNOWN;
  const skills = {
    onCountChanged: new EventHandler(),
    onSelectionChanged: new EventHandler(),
    getSelectedSkill() { return selectedSkill; },
    setSelectedSkill(skill) { selectedSkill = skill; },
    clearSelectedSkill() { selectedSkill = SkillTypes.UNKNOWN; return true; },
    getSkill(skill) { return skillCounts[skill] || 0; }
  };

  const timer = {
    speedFactor: options.speedFactor ?? 1,
    tickIndex: 5,
    eachGameSecond: new EventHandler(),
    isRunning() { return options.running ?? true; },
    getGameTime() { return 0; },
    getGameLeftTimeString() { return '1-00'; },
    getGameLeftTimeSString() { return '1-00'; },
    toggle() { this.toggled = true; }
  };

  const victory = {
    releaseRate: 20,
    getMinReleaseRate() { return 10; },
    getCurrentReleaseRate() { return this.releaseRate; },
    getMaxReleaseRate() { return 99; },
    setCurrentReleaseRate(val) { this.releaseRate = val; },
    getReleaseCount() { return 5; },
    getSurvivorPercentage() { return 50; }
  };

  const game = {
    commands: [],
    queueCommand(cmd) { this.commands.push(cmd); },
    showDebug: false,
    gameDisplay: { hoverLemming: null },
    level: {
      width: 100,
      height: 50,
      objects: [],
      getGroundMaskLayer() { return { countMaskInRect() { return 0; } }; }
    },
    lemmingManager: { setMiniMap() {} },
    getLemmingManager() { return { spawnTotal: 5, getLemmings() { return []; } }; }
  };

  return {
    gui: new GameGui(game, makeSprites(), skills, timer, victory),
    game,
    skills,
    timer,
    victory
  };
};

describe('GameGui coverage', function() {
  const originalWindow = globalThis.window;
  const originalPerformance = globalThis.performance;
  const originalLemmings = globalThis.lemmings;

  beforeEach(function() {
    globalThis.window = {
      requestAnimationFrame() { return 1; },
      cancelAnimationFrame() {}
    };
    globalThis.performance = {
      now() { return 0; },
      measure() {}
    };
  });

  afterEach(function() {
    resetDependencies();
    globalThis.window = originalWindow;
    globalThis.performance = originalPerformance;
    globalThis.lemmings = originalLemmings;
  });

  it('applies release rate changes and queues commands', function() {
    const { gui, game, victory } = makeGui({ running: true });
    gui.deltaReleaseRate = 5;
    gui._applyReleaseRateAuto();
    expect(victory.releaseRate).to.equal(25);
    expect(game.commands[0]).to.be.instanceOf(CommandReleaseRateIncrease);

    gui.deltaReleaseRate = -3;
    gui._applyReleaseRateAuto();
    expect(game.commands[1]).to.be.instanceOf(CommandReleaseRateDecrease);
  });

  it('handles skill mouse actions', function() {
    const { gui, game, skills, timer, victory } = makeGui({ running: true });
    victory.releaseRate = 10;
    gui.handleSkillMouseDown({ x: 0, y: 20 });
    expect(gui.skillSelectionChanged).to.equal(true);

    gui.handleSkillMouseDown({ x: 160, y: 10 });
    expect(timer.toggled).to.equal(true);

    gui.handleSkillMouseDown({ x: 176, y: 20 });
    gui.handleSkillMouseDown({ x: 176, y: 20 });
    const nukeCmd = game.commands.find(cmd => cmd instanceof CommandNuke);
    expect(nukeCmd).to.not.equal(undefined);

    skills.setSelectedSkill(SkillTypes.UNKNOWN);
    gui.handleSkillMouseDown({ x: 32, y: 20 });
    const selectCmd = game.commands.find(cmd => cmd instanceof CommandSelectSkill);
    expect(selectCmd).to.not.equal(undefined);
  });

  it('handles right-click actions and hover state', function() {
    const { gui, game, timer, victory } = makeGui({ running: true });
    gui.handleSkillMouseRightDown({ x: 0, y: 20 });
    expect(game.commands[0]).to.be.instanceOf(CommandReleaseRateDecrease);

    gui.handleSkillMouseRightDown({ x: 16, y: 20 });
    expect(game.commands[1]).to.be.instanceOf(CommandReleaseRateIncrease);

    timer.speedFactor = 2;
    gui.drawSpeedChange = () => { gui.speedDrawn = true; };
    gui.handleSkillMouseRightDown({ x: 160, y: 20 });
    expect(gui.speedDrawn).to.equal(true);

    gui.handleSkillMouseRightDown({ x: 176, y: 20 });
    expect(game.showDebug).to.equal(true);

    victory.releaseRate = victory.getMinReleaseRate();
    gui.handleMouseMove({ x: 0, y: 20 });
    expect(gui._hoverPanelIdx).to.equal(-1);

    timer.speedFactor = 1;
    gui.handleMouseMove({ x: 168, y: 40 });
    expect(gui._hoverSpeedUp || gui._hoverSpeedDown).to.equal(true);
  });

  it('renders normal and bench HUD states', function() {
    const display = makeDisplay();
    const miniMap = { renderCalls: 0, render() { this.renderCalls += 1; } };
    setDependency('MiniMap', class {
      constructor() {}
      render() { miniMap.render(); }
      dispose() {}
    });

    const { gui, game, timer } = makeGui({ running: false, speedFactor: 0.5 });
    gui.setGuiDisplay(display);
    gui.display = display;
    gui.miniMap = miniMap;
    gui.backgroundChanged = true;
    gui.gameTimeChanged = true;
    gui.gameSpeedChanged = true;
    gui.skillsCountChanged = true;
    gui.releaseRateChanged = true;
    gui.nukePrepared = true;
    gui._hoverPanelIdx = 11;
    gui._hoverSpeedDown = true;
    gui._selectionCounter = gui.selectionAnimDelay - 1;
    gui.render();
    expect(display.backgroundCalls).to.be.greaterThan(0);
    expect(display.ants).to.be.greaterThan(0);
    expect(miniMap.renderCalls).to.equal(1);

    globalThis.lemmings = { bench: true, performanceAPI: true, tps: 60, steps: 1 };
    game.getLemmingManager = () => ({ getLemmings() { return [1, 2]; }, spawnTotal: 2 });
    timer.isRunning = () => true;
    gui.gameTimeChanged = true;
    gui.render();
    expect(display.frames.length).to.be.greaterThan(0);
  });

  it('runs the GUI loop once', function() {
    const display = makeDisplay();
    const { gui } = makeGui({ running: true });
    gui.setGuiDisplay(display);
    gui.display = display;
    gui._guiLoop();
    expect(display.redrawCalls).to.equal(1);
  });
});
