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
