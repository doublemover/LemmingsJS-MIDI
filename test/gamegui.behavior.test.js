import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/SkillTypes.js';
import '../js/GameSkills.js';
import '../js/CommandSelectSkill.js';
import '../js/CommandNuke.js';
import '../js/CommandReleaseRateIncrease.js';
import '../js/CommandReleaseRateDecrease.js';
import { GameGui } from '../js/GameGui.js';

// global minimal environment
globalThis.lemmings = { game: { showDebug: false } };

class TimerStub {
  constructor() {
    this.running = true;
    this.speedFactor = 1;
    this.eachGameSecond = { on() {}, off() {} };
  }
  isRunning() { return this.running; }
  toggle() { this.running = !this.running; }
  getGameTime() { return 0; }
  getGameLeftTimeString() { return '0'; }
}

class VictoryStub {
  constructor() {
    this.min = 0;
    this.max = 99;
    this.current = 10;
  }
  getMinReleaseRate() { return this.min; }
  getMaxReleaseRate() { return this.max; }
  getCurrentReleaseRate() { return this.current; }
  setCurrentReleaseRate(v) { this.current = v; }
  getOutCount() { return 0; }
  getSurvivorPercentage() { return 0; }
}

class PanelSpritesStub {
  getPanelSprite() { return { width: 320, height: 40 }; }
  getNumberSpriteEmpty() { return {}; }
  getLetterSprite() { return {}; }
  getNumberSpriteLeft() { return {}; }
  getNumberSpriteRight() { return {}; }
}

function createSkills() {
  const skills = {
    selectedSkill: Lemmings.SkillTypes.UNKNOWN,
    counts: new Array(Object.keys(Lemmings.SkillTypes).length).fill(2),
    onCountChanged: new Lemmings.EventHandler(),
    onSelectionChanged: new Lemmings.EventHandler(),
    getSkill(type) { return this.counts[type] ?? 0; },
    setSelectedSkill(skill) {
      if (this.selectedSkill === skill) return false;
      this.selectedSkill = skill;
      this.onSelectionChanged.trigger();
      return true;
    },
    getSelectedSkill() { return this.selectedSkill; },
    clearSelectedSkill() {
      if (this.selectedSkill !== Lemmings.SkillTypes.UNKNOWN) {
        this.selectedSkill = Lemmings.SkillTypes.UNKNOWN;
        this.onSelectionChanged.trigger();
        return true;
      }
      return false;
    }
  };
  return skills;
}

class GameStub {
  constructor() { this.commands = []; this.showDebug = false; }
  queueCommand(cmd) { this.commands.push(cmd); }
}

function createDisplay() {
  return {
    lines: [],
    marching: [],
    drawHorizontalLine(...args) { this.lines.push(args); },
    drawMarchingAntRect(...args) { this.marching.push(args); },
    drawRect() {}, drawFrame() {}, drawFrameResized() {},
    drawFrameCovered() {}, setPixel() {}, initSize() {},
    setBackground() {}, drawStippleRect() {}, redraw() {}
  };
}

describe('GameGui behavior', function() {
  let timer, sprites, skills, victory, game, gui;

  beforeEach(function() {
    timer = new TimerStub();
    sprites = new PanelSpritesStub();
    skills = createSkills();
    victory = new VictoryStub();
    game = new GameStub();
    gui = new GameGui(game, sprites, skills, timer, victory);
    gui.display = createDisplay();
  });

  it('selects a skill on left click', function() {
    gui.handleSkillMouseDown({ x: 16 * 4 + 1, y: 20 }); // BOMBER panel
    expect(skills.getSelectedSkill()).to.equal(Lemmings.SkillTypes.BOMBER);
    expect(game.commands[0]).to.be.instanceOf(Lemmings.CommandSelectSkill);
  });

  it('adjusts release rate when clicking increase/decrease', function() {
    gui.handleSkillMouseDown({ x: 1, y: 20 }); // decrease
    expect(victory.getCurrentReleaseRate()).to.equal(4);
    expect(gui.deltaReleaseRate).to.equal(-3);
    expect(game.commands[0]).to.be.instanceOf(Lemmings.CommandReleaseRateDecrease);

    game.commands = [];
    gui.handleSkillMouseDown({ x: 16 + 1, y: 20 }); // increase
    expect(victory.getCurrentReleaseRate()).to.equal(10);
    expect(gui.deltaReleaseRate).to.equal(3);
    expect(game.commands[0]).to.be.instanceOf(Lemmings.CommandReleaseRateIncrease);
  });

  it('sets release rate to min/max on right click', function() {
    victory.min = 5;
    victory.max = 20;
    victory.current = 10;
    gui.handleSkillMouseRightDown({ x: 1, y: 20 });
    expect(victory.getCurrentReleaseRate()).to.equal(5);
    expect(game.commands[0]).to.be.instanceOf(Lemmings.CommandReleaseRateDecrease);

    game.commands = [];
    gui.handleSkillMouseRightDown({ x: 16 + 1, y: 20 });
    expect(victory.getCurrentReleaseRate()).to.equal(20);
    expect(game.commands[0]).to.be.instanceOf(Lemmings.CommandReleaseRateIncrease);
  });

  it('changes speed with pause button', function() {
    timer.speedFactor = 2;
    gui.handleSkillMouseDown({ x: 161, y: 33 }); // speed down
    expect(timer.speedFactor).to.equal(1);
    expect(gui.display.lines.length).to.be.greaterThan(0);

    gui.display.lines = [];
    gui.handleSkillMouseDown({ x: 171, y: 33 }); // speed up
    expect(timer.speedFactor).to.equal(2);
    expect(gui.display.lines.length).to.be.greaterThan(0);
  });

  it('toggles nuke confirmation', function() {
    gui.handleSkillMouseDown({ x: 16 * 11 + 1, y: 20 });
    expect(gui.nukePrepared).to.equal(true);
    gui.handleSkillMouseDown({ x: 16 * 11 + 1, y: 20 });
    expect(gui.nukePrepared).to.equal(false);
    expect(game.commands[0]).to.be.instanceOf(Lemmings.CommandNuke);
  });

  it('updates hover states', function() {
    gui.handleMouseMove({ x: 16 * 2 + 1, y: 20 });
    expect(gui._hoverPanelIdx).to.equal(2);
    gui.handleMouseMove({ x: 160 + 1, y: 33 });
    expect(gui._hoverSpeedDown || gui._hoverSpeedUp).to.equal(true);

    timer.running = false;
    gui.handleMouseMove({ x: 16 * 2 + 1, y: 20 });
    expect(gui._hoverPanelIdx).to.equal(-1);
  });

  it('draws selection around selected skill', function() {
    skills.setSelectedSkill(Lemmings.SkillTypes.BASHER);
    const idx = gui.getPanelIndexBySkill(skills.getSelectedSkill());
    gui.drawSelection(gui.display, idx);
    const [x] = gui.display.marching[0];
    expect(x).to.equal(16 * idx);
  });
});
