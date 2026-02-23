import { expect } from 'chai';
import { EventHandler } from '../js/util/EventHandler.js';
import { GameGui } from '../js/game/GameGui.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { CommandNuke } from '../js/commands/CommandNuke.js';
import { CommandSelectSkill } from '../js/commands/CommandSelectSkill.js';
import { CommandReleaseRateIncrease } from '../js/commands/CommandReleaseRateIncrease.js';
import { CommandReleaseRateDecrease } from '../js/commands/CommandReleaseRateDecrease.js';
import {
  resetDependencies,
  setDependency,
  useGlobalLemmings,
  withGlobalLemmings
} from './helpers/lemmings.js';

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
      mechanics: options.mechanics ?? {},
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
  useGlobalLemmings({});

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

  it('tracks nuke countdown and skill change flags', function() {
    const { gui, game, skills } = makeGui({ running: true });
    withGlobalLemmings({ nukeAfter: 1 }, () => {
      gui.nukePrepared = true;

      gui._onEachGameSecond();
      const nukeCommands = game.commands.filter(cmd => cmd instanceof CommandNuke);
      expect(nukeCommands.length).to.equal(1);
      expect(gui.nukePrepared).to.equal(false);

      gui.nukePrepared = true;
      gui._onEachGameSecond();
      const repeatedNukes = game.commands.filter(cmd => cmd instanceof CommandNuke);
      expect(repeatedNukes.length).to.equal(2);
      expect(gui.nukePrepared).to.equal(false);

      gui.backgroundChanged = false;
      gui._selectionOffset = 5;
      skills.onCountChanged.trigger();
      skills.onSelectionChanged.trigger();
      expect(gui.backgroundChanged).to.equal(true);
      expect(gui._selectionOffset).to.equal(0);
    });
  });

  it('fires nuke countdown when threshold drops below accumulated seconds', function() {
    const { gui, game } = makeGui({ running: true });
    const app = { nukeAfter: 5 };
    withGlobalLemmings(app, () => {
      gui._nukeAfterCountdown = 4;
      app.nukeAfter = 3;
      gui._onEachGameSecond();
      const nukeCommands = game.commands.filter(cmd => cmd instanceof CommandNuke);
      expect(nukeCommands.length).to.equal(1);
      expect(gui._nukeAfterCountdown).to.equal(0);
    });
  });

  it('adjusts release rate and speed from panel clicks', function() {
    const { gui, timer, victory, skills } = makeGui({ running: true });
    const app = { gameSpeedFactor: 1 };
    withGlobalLemmings(app, () => {
      gui.drawSpeedChange = () => {};

      victory.releaseRate = 20;
      gui.releaseRateChanged = false;
      gui.handleSkillMouseDown({ x: 0, y: 20 });
      expect(victory.releaseRate).to.equal(14);
      expect(gui.releaseRateChanged).to.equal(true);

      victory.releaseRate = 20;
      gui.releaseRateChanged = false;
      gui.handleSkillMouseDown({ x: 16, y: 20 });
      expect(victory.releaseRate).to.equal(26);
      expect(gui.releaseRateChanged).to.equal(true);

      timer.speedFactor = 11;
      gui.handleSkillMouseDown({ x: 160, y: 32 });
      expect(timer.speedFactor).to.equal(1);
      timer.speedFactor = 2;
      gui.handleSkillMouseDown({ x: 160, y: 32 });
      expect(timer.speedFactor).to.equal(1);
      timer.speedFactor = 1;
      gui.handleSkillMouseDown({ x: 160, y: 32 });
      expect(timer.speedFactor).to.equal(0.9);

      timer.speedFactor = 0.5;
      gui.handleSkillMouseDown({ x: 170, y: 32 });
      expect(timer.speedFactor).to.equal(0.6);
      timer.speedFactor = 20;
      gui.handleSkillMouseDown({ x: 170, y: 32 });
      expect(timer.speedFactor).to.equal(30);
      timer.speedFactor = 5;
      gui.handleSkillMouseDown({ x: 170, y: 32 });
      expect(timer.speedFactor).to.equal(6);

      skills.getSkill = () => 0;
      gui.handleSkillMouseDown({ x: 32, y: 20 });
      expect(gui.skillSelectionChanged).to.equal(true);

      gui.handleSkillDoubleClick({ x: 176, y: 20 });
      const doubleNuke = gui.game.commands.find(cmd => cmd instanceof CommandNuke);
      expect(doubleNuke).to.not.equal(undefined);
    });
  });

  it('does not redraw zero-skill stipples when counts are unchanged', function() {
    const display = makeDisplay();
    const { gui } = makeGui({ running: true });
    gui.setGuiDisplay(display);
    gui.display = display;
    gui.backgroundChanged = true;
    gui.skillsCountChanged = true;
    gui.gameTimeChanged = false;
    gui.releaseRateChanged = false;
    gui.gameSpeedChanged = false;
    gui.render();

    const stipplesAfterFirstRender = display.stipples;
    gui.backgroundChanged = false;
    gui.skillsCountChanged = false;
    gui.gameTimeChanged = false;
    gui.releaseRateChanged = false;
    gui.gameSpeedChanged = false;
    gui.render();

    expect(display.stipples).to.equal(stipplesAfterFirstRender);
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

  it('clears release-rate delta on right mouse up', function() {
    const display = makeDisplay();
    const { gui } = makeGui({ running: true });
    gui.setGuiDisplay(display);
    gui.deltaReleaseRate = 9;

    display.onMouseRightUp.trigger({});
    expect(gui.deltaReleaseRate).to.equal(0);
  });

  it('disables glitch actions when mechanics flags are off', function() {
    const { gui, game, timer, victory } = makeGui({
      running: false,
      mechanics: {
        rightClickGlitch: false,
        nukeGlitch: false,
        pauseGlitch: false
      }
    });

    gui.deltaReleaseRate = 3;
    gui._applyReleaseRateAuto();
    expect(game.commands.length).to.equal(0);

    timer.speedFactor = 2;
    gui.drawSpeedChange = () => { gui.speedDrawn = true; };
    gui.handleSkillMouseRightDown({ x: 0, y: 20 });
    gui.handleSkillMouseRightDown({ x: 16, y: 20 });
    gui.handleSkillMouseRightDown({ x: 160, y: 20 });
    gui.handleSkillMouseRightDown({ x: 176, y: 20 });
    expect(game.commands.length).to.equal(0);
    expect(victory.releaseRate).to.equal(20);
    expect(gui.speedDrawn).to.equal(undefined);
    expect(game.showDebug).to.equal(false);

    gui.handleSkillDoubleClick({ x: 176, y: 20 });
    expect(game.commands.length).to.equal(0);
  });

  it('suppresses hover when paused or skill counts are empty', function() {     
    const { gui, skills, timer } = makeGui({ running: false });
    timer.isRunning = () => false;
    gui.handleMouseMove({ x: 32, y: 20 });
    expect(gui._hoverPanelIdx).to.equal(-1);

    timer.isRunning = () => true;
    skills.getSkill = () => 0;
    gui.handleMouseMove({ x: 32, y: 20 });
    expect(gui._hoverPanelIdx).to.equal(-1);
  });

  it('covers clamping, fallbacks, and helper branches', function() {
    const { gui, victory, game } = makeGui({ running: true });
    victory.getMinReleaseRate = () => 10;
    victory.getMaxReleaseRate = () => 20;
    victory.releaseRate = 10;
    gui.deltaReleaseRate = -5;
    gui._applyReleaseRateAuto();
    expect(victory.releaseRate).to.equal(10);
    expect(game.commands.length).to.equal(0);

    victory.releaseRate = 20;
    gui.deltaReleaseRate = 5;
    gui._applyReleaseRateAuto();
    expect(victory.releaseRate).to.equal(20);
    expect(game.commands.length).to.equal(0);

    victory.releaseRate = 15;
    gui.deltaReleaseRate = -5;
    gui._applyReleaseRateAuto();
    expect(victory.releaseRate).to.equal(10);
    expect(game.commands.length).to.equal(1);

    gui.handleSkillMouseDown({ x: 500, y: 20 });
    gui.handleMouseMove({ x: 0, y: 0 });

    gui.gameVictoryCondition = {};
    gui.handleMouseMove({ x: 0, y: 20 });

    expect(gui._composeStatusText('', '')).to.equal('');
    expect(gui._pad(1234, 2)).to.equal('1234');
    gui.drawSelection(makeDisplay(), -1);

    expect(gui.getSkillByPanelIndex(3)).to.equal(SkillTypes.FLOATER);
    expect(gui.getSkillByPanelIndex(4)).to.equal(SkillTypes.BOMBER);
    expect(gui.getSkillByPanelIndex(5)).to.equal(SkillTypes.BLOCKER);
    expect(gui.getSkillByPanelIndex(6)).to.equal(SkillTypes.BUILDER);
    expect(gui.getSkillByPanelIndex(7)).to.equal(SkillTypes.BASHER);
    expect(gui.getSkillByPanelIndex(8)).to.equal(SkillTypes.MINER);
    expect(gui.getSkillByPanelIndex(9)).to.equal(SkillTypes.DIGGER);
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

    withGlobalLemmings({ bench: true, performanceAPI: true, tps: 60, steps: 1 }, () => {
      game.getLemmingManager = () => ({ getLemmings() { return [1, 2]; }, spawnTotal: 2 });
      timer.isRunning = () => true;
      gui.gameTimeChanged = true;
      gui.render();
      expect(display.frames.length).to.be.greaterThan(0);
    });
  });

  it('draws marching-ants overlays on the dedicated GUI overlay plane when available', function() {
    const display = makeDisplay();
    const overlayDisplay = makeDisplay();
    overlayDisplay.clearCalls = 0;
    overlayDisplay.clear = function() { this.clearCalls += 1; };
    display.stage.getGuiOverlayDisplay = () => overlayDisplay;
    display.stage.setGuiOverlayVisible = (value) => { display.stage.overlayVisible = value; };

    const { gui } = makeGui({ running: false, speedFactor: 1 });
    gui.setGuiDisplay(display);
    gui.display = display;
    gui.backgroundChanged = true;
    gui.gameTimeChanged = true;
    gui.nukePrepared = true;
    gui._hoverPanelIdx = 11;
    gui._selectionCounter = gui.selectionAnimDelay - 1;

    gui.render();

    expect(overlayDisplay.clearCalls).to.equal(1);
    expect(overlayDisplay.ants).to.be.greaterThan(0);
    expect(display.ants).to.equal(0);
    expect(display.stage.overlayVisible).to.equal(true);
  });

  it('throttles marching-ant offset updates while paused and idle', function() {
    const display = makeDisplay();
    const { gui } = makeGui({ running: false });
    gui.setGuiDisplay(display);
    gui.display = display;
    gui.backgroundChanged = true;
    gui.gameTimeChanged = true;
    gui.selectionAnimDelay = 2;
    gui.selectionAnimIdleMultiplier = 2;
    gui._selectionOffset = 0;
    gui._selectionCounter = gui.selectionAnimDelay - 1;

    gui.render();
    expect(gui._selectionOffset).to.equal(0);

    gui._selectionCounter = (gui.selectionAnimDelay * gui.selectionAnimIdleMultiplier) - 1;
    gui.gameTimeChanged = true;
    gui.render();
    expect(gui._selectionOffset).to.equal(1);
  });

  it('renders status text, speed, and lock variations', function() {
    const display = makeDisplay();
    const { gui, game, skills, timer, victory } = makeGui({ running: true, speedFactor: 12 });
    gui.setGuiDisplay(display);
    gui.display = display;
    const miniMap = { args: null, render(x, w) { this.args = { x, w }; } };
    gui.miniMap = miniMap;
    game.level.screenPositionX = 3;

    gui.backgroundChanged = true;
    gui.gameTimeChanged = true;
    gui.gameSpeedChanged = true;
    gui.skillsCountChanged = true;
    gui.releaseRateChanged = true;
    gui._hoverPanelIdx = 10;
    gui._hoverSpeedUp = true;
    timer.speedFactor = 12;
    gui.render();
    gui._hoverSpeedUp = false;
    gui._hoverSpeedDown = true;
    gui.gameTimeChanged = true;
    gui.render();

    gui._hoverPanelIdx = -1;
    gui._hoverSpeedUp = false;
    game.gameDisplay.hoverLemming = { action: { getActionName() { return 'walking'; } } };
    gui.gameTimeChanged = true;
    gui.render();

    game.gameDisplay.hoverLemming = null;
    gui.nukePrepared = true;
    gui.gameTimeChanged = true;
    gui.render();

    gui.nukePrepared = false;
    timer.isRunning = () => false;
    gui.gameTimeChanged = true;
    gui.render();

    timer.isRunning = () => true;
    skills.setSelectedSkill(SkillTypes.BUILDER);
    withGlobalLemmings({ endless: true }, () => {
      gui.gameTimeChanged = true;
      gui.render();
    });

    timer.speedFactor = 0.5;
    gui._hoverSpeedDown = true;
    gui.gameSpeedChanged = true;
    gui.render();

    timer.speedFactor = 120;
    gui._hoverSpeedDown = false;
    gui.gameSpeedChanged = true;
    gui.render();

    timer.speedFactor = 0.1;
    gui.gameSpeedChanged = true;
    gui.render();

    victory.releaseRate = victory.getMinReleaseRate();
    gui.releaseRateChanged = true;
    gui.render();
    gui._rrLockMin = true;
    victory.releaseRate = victory.getMinReleaseRate() + 1;
    gui.render();

    victory.releaseRate = victory.getMaxReleaseRate();
    gui.releaseRateChanged = true;
    gui.render();
    gui._rrLockMax = true;
    victory.releaseRate = victory.getMaxReleaseRate() - 1;
    gui.render();

    const originalPerformance = globalThis.performance;
    globalThis.performance = { now() { return 0; }, measure() { throw new Error('boom'); } };
    withGlobalLemmings({ performanceAPI: true }, () => {
      gui.gameTimeChanged = true;
      gui.render();
    });
    globalThis.performance = originalPerformance;

    expect(miniMap.args).to.eql({ x: 3, w: display.worldDataSize.width });
  });

  it('returns early when display is missing with perf enabled', function() {    
    const { gui } = makeGui({ running: true });
    let measured = 0;
    const originalPerformance = globalThis.performance;
    globalThis.performance = { now() { return 0; }, measure() { measured += 1; } };
    withGlobalLemmings({ performanceAPI: true }, () => {
      gui.display = null;
      gui.render();
      expect(measured).to.equal(1);

      gui._onEachGameSecond();
    });
    globalThis.performance = originalPerformance;
  });

  it('swallows perf errors when display is missing', function() {
    const { gui } = makeGui({ running: true });
    let measured = 0;
    const originalPerformance = globalThis.performance;
    globalThis.performance = {
      now() { return 0; },
      measure() { measured += 1; throw new Error('boom'); }
    };
    withGlobalLemmings({ performanceAPI: true }, () => {
      gui.display = null;
      gui.render();

      expect(measured).to.equal(1);
    });
    globalThis.performance = originalPerformance;
  });

  it('runs the GUI loop once', function() {
    const display = makeDisplay();
    const { gui } = makeGui({ running: true });
    gui.setGuiDisplay(display);
    gui.display = display;
    gui._guiLoop();
    expect(display.redrawCalls).to.equal(1);
  });

  it('removes old display listeners when swapping displays', function() {
    const displayA = makeDisplay();
    const displayB = makeDisplay();
    setDependency('MiniMap', class { constructor() {} render() {} dispose() {} });
    const { gui } = makeGui({ running: true });
    gui.setGuiDisplay(displayA);
    expect(displayA.onMouseDown.handlers.size).to.equal(1);
    gui.setGuiDisplay(displayB);
    expect(displayA.onMouseDown.handlers.size).to.equal(0);
    expect(displayB.onMouseDown.handlers.size).to.equal(1);
  });

  it('returns early in gui loop when display is missing', function() {
    const { gui } = makeGui({ running: true });
    gui.display = null;
    gui._guiLoop();
  });

  it('disposes handlers and cached sprites', function() {
    const display = makeDisplay();
    let canceled = 0;
    let miniDisposed = 0;
    globalThis.window.cancelAnimationFrame = () => { canceled += 1; };
    setDependency('MiniMap', class {
      constructor() {}
      render() {}
      dispose() { miniDisposed += 1; }
    });

    const { gui, skills, timer } = makeGui({ running: true });
    gui.setGuiDisplay(display);
    gui._guiRafId = 5;
    gui.dispose();

    expect(canceled).to.equal(1);
    expect(timer.eachGameSecond.handlers.size).to.equal(0);
    expect(skills.onCountChanged.handlers.size).to.equal(0);
    expect(skills.onSelectionChanged.handlers.size).to.equal(0);
    expect(display.onMouseDown.handlers.size).to.equal(0);
    expect(display.onMouseMove.handlers.size).to.equal(0);
    expect(gui.miniMap).to.equal(null);
    expect(miniDisposed).to.equal(1);
    expect(gui._panelSprite).to.equal(null);
  });

  it('draws fractional speed indicators and hover defaults', function() {
    const display = makeDisplay();
    const { gui } = makeGui({ speedFactor: 0.5, running: true });
    gui.setGuiDisplay(display);
    gui.display = display;
    gui.gameSpeedChanged = true;
    gui.render();
    expect(display.pixels).to.be.greaterThan(0);

    const rectCount = display.rects.length;
    gui.drawSkillHover(display, -1);
    expect(display.rects.length).to.equal(rectCount);
  });

  it('renders the tens place with left-digit sprites in speed HUD', function() {
    const display = makeDisplay();
    const { gui, timer } = makeGui({ speedFactor: 12, running: true });
    gui.setGuiDisplay(display);
    gui.display = display;
    timer.speedFactor = 12;
    gui.gameSpeedChanged = true;

    gui.render();

    const hasLeftDigit = display.resized.some((args) => args?.[0]?.id === 'L1');
    expect(hasLeftDigit).to.equal(true);
  });

  it('renders status text safely when victory helpers are missing', function() {
    const display = makeDisplay();
    const { gui, game } = makeGui({ running: true });
    gui.setGuiDisplay(display);
    gui.display = display;
    gui.gameTimeChanged = true;
    gui.backgroundChanged = false;
    game.gameDisplay = { hoverLemming: null };
    gui.gameVictoryCondition = {
      getCurrentReleaseRate() { return 10; },
      getMinReleaseRate() { return 0; },
      getMaxReleaseRate() { return 99; }
    };

    expect(() => gui.render()).to.not.throw();
  });

  it('skips survivor HUD text when survivor percentage is not finite', function() {
    const display = makeDisplay();
    const { gui } = makeGui({ running: true });
    gui.setGuiDisplay(display);
    gui.display = display;
    gui.backgroundChanged = false;
    gui.gameTimeChanged = true;
    const drawnText = [];
    gui.drawGreenString = (_display, text) => {
      drawnText.push(text);
    };
    gui.gameVictoryCondition = {
      getCurrentReleaseRate() { return 10; },
      getMinReleaseRate() { return 0; },
      getMaxReleaseRate() { return 99; },
      getReleaseCount() { return 5; },
      getSurvivorPercentage() { return Number.NaN; }
    };

    gui.render();
    expect(drawnText.some((text) => text.startsWith('In'))).to.equal(false);
  });

  it('handles speed flash and dispose safely when no display/window is available', function() {
    const { gui } = makeGui({ running: true });
    gui.display = null;
    expect(() => gui.drawSpeedChange(true)).to.not.throw();
    expect(gui.gameSpeedChanged).to.equal(true);

    const previousWindow = globalThis.window;
    globalThis.window = undefined;
    gui._guiRafId = 7;
    expect(() => gui.dispose()).to.not.throw();
    expect(gui._guiRafId).to.equal(0);
    globalThis.window = previousWindow;
  });

  it('formats status text and panel names', function() {
    const { gui } = makeGui();
    const text = gui._composeStatusText('123456789012345', 'OK');
    expect(text.length).to.equal(14);
    expect(gui._getPanelName(2)).to.equal('Climber');
    expect(gui._getPanelName(99)).to.equal('');
  });

  it('reacts to skill count changes and formats tick indicators', function() {
    const { gui, skills, timer, game } = makeGui();
    gui.backgroundChanged = false;
    skills.onCountChanged.trigger();
    expect(gui.backgroundChanged).to.equal(true);

    timer.tickIndex = -5;
    game.timeTravel = { isReversing: true };
    expect(gui._formatTickIndicator()).to.equal('T0<');
    expect(gui._getPanelName(0)).to.equal('Decrease');
    expect(gui._getPanelName(11)).to.equal('Nuke');
  });
});
