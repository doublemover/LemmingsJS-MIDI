import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/Position2D.js';
import '../js/ViewPoint.js';
import '../js/StageImageProperties.js';
import '../js/DisplayImage.js';
import '../js/UserInputManager.js';
import { Stage } from '../js/Stage.js';
import '../js/SkillTypes.js';
import { GameGui } from '../js/GameGui.js';

function createStubCanvas(width = 800, height = 600) {
  const ctx = {
    canvas: { width, height },
    fillRect() {},
    drawImage() {},
    putImageData() {}
  };
  return {
    width,
    height,
    getContext() { return ctx; },
    addEventListener() {},
    removeEventListener() {}
  };
}

function createDocumentStub() {
  return {
    createElement() {
      const ctx = {
        canvas: {},
        fillRect() {},
        drawImage() {},
        putImageData() {},
        createImageData(w, h) {
          return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
        }
      };
      return {
        width: 0,
        height: 0,
        getContext() { ctx.canvas = this; return ctx; }
      };
    }
  };
}

class GameTimerStub {
  constructor() {
    this.eachGameSecond = new Lemmings.EventHandler();
    this.speedFactor = 1;
  }
  isRunning() { return true; }
}

class GameVictoryConditionStub {
  getMinReleaseRate() { return 1; }
  getMaxReleaseRate() { return 10; }
  getCurrentReleaseRate() { return 5; }
}

class GameSkillsStub {
  constructor() {
    this.onCountChanged = new Lemmings.EventHandler();
    this.onSelectionChanged = new Lemmings.EventHandler();
  }
  getSkill() { return 1; }
  getSelectedSkill() { return 1; }
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
  render() {}
  dispose() {}
}

globalThis.lemmings = { game: { showDebug: false } };

describe('Stage.updateStageSize', function() {
  before(function() {
    globalThis.document = createDocumentStub();
    globalThis.window = {
      requestAnimationFrame(cb) { return 1; },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {}
    };
    Lemmings.MiniMap = MiniMapStub;
  });

  after(function() {
    delete globalThis.window;
    delete Lemmings.MiniMap;
  });

  it('centers GUI panel after canvas resize', function() {
    const canvas = createStubCanvas(400, 600);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGuiDisplay();
    display.initSize(160, 40);
    const gameDisplay = stage.getGameDisplay();
    gameDisplay.initSize(1000, 1000);

    canvas.width = 800;
    canvas.getContext().canvas.width = 800;
    stage.updateStageSize();

    const scale = stage.guiImgProps.viewPoint.scale;
    const guiW = display.worldDataSize.width * scale;
    const panelH = display.worldDataSize.height * scale;
    expect(stage.guiImgProps.viewPoint.scale).to.equal(4);
    expect(stage.guiImgProps.x).to.equal((canvas.width - stage.guiImgProps.width) / 2);
    expect(stage.guiImgProps.y).to.equal(stage.gameImgProps.height);
    expect(stage.gameImgProps.height).to.equal(440);
    expect(stage.guiImgProps.height).to.equal(panelH);
    expect(stage.guiImgProps.width).to.equal(guiW);
    const viewH = stage.gameImgProps.height / stage.gameImgProps.viewPoint.scale;
    const worldH = gameDisplay.worldDataSize.height;
    expect(stage.gameImgProps.viewPoint.y).to.equal(worldH - viewH);
  });

  it('keeps panel at bottom for different zoom levels', function() {
    const canvas = createStubCanvas(400, 600);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGuiDisplay();
    display.initSize(160, 40);
    const gameDisplay = stage.getGameDisplay();
    gameDisplay.initSize(1000, 1000);

    stage.guiImgProps.viewPoint.scale = 3;
    stage.updateStageSize();

    const scale = stage.guiImgProps.viewPoint.scale;
    const panelH = display.worldDataSize.height * scale;
    expect(stage.guiImgProps.viewPoint.scale).to.equal(4);
    expect(stage.guiImgProps.x).to.equal((canvas.width - stage.guiImgProps.width) / 2);
    expect(stage.guiImgProps.y).to.equal(stage.gameImgProps.height);
    expect(stage.gameImgProps.height).to.equal(440);
    expect(stage.guiImgProps.height).to.equal(panelH);
    expect(stage.guiImgProps.width).to.equal(display.worldDataSize.width * scale);
    const viewH = stage.gameImgProps.height / stage.gameImgProps.viewPoint.scale;
    const worldH = gameDisplay.worldDataSize.height;
    expect(stage.gameImgProps.viewPoint.y).to.equal(worldH - viewH);
  });

  it('updates dimensions when canvas size changes', function() {
    const canvas = createStubCanvas(400, 600);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGuiDisplay();
    display.initSize(160, 40);
    const gameDisplay = stage.getGameDisplay();
    gameDisplay.initSize(1000, 1000);

    canvas.width = 500;
    canvas.height = 700;
    const ctx = canvas.getContext();
    ctx.canvas.width = 500;
    ctx.canvas.height = 700;
    stage.updateStageSize();

    const scale = stage.guiImgProps.viewPoint.scale;
    const panelW = display.worldDataSize.width * scale;
    const panelH = display.worldDataSize.height * scale;
    expect(stage.gameImgProps.width).to.equal(canvas.width);
    expect(stage.gameImgProps.height).to.equal(canvas.height - panelH);
    expect(stage.guiImgProps.width).to.equal(panelW);
    expect(stage.guiImgProps.height).to.equal(panelH);
    expect(stage.guiImgProps.x).to.equal((canvas.width - panelW) / 2);
    expect(stage.guiImgProps.y).to.equal(stage.gameImgProps.height);
  });

  it('centers HUD when GameGui attaches display', function() {
    const canvas = createStubCanvas(400, 600);
    const stage = new Stage(canvas);
    stage.clear = () => {};
    stage.draw = () => {};

    const display = stage.getGuiDisplay();
    display.initSize(160, 40);
    const gameDisplay = stage.getGameDisplay();
    gameDisplay.initSize(1000, 1000);

    const game = { stage, gameDisplay, level: { width: 200, height: 100 }, queueCommand() {} };
    const timer = new GameTimerStub();
    const victory = new GameVictoryConditionStub();
    const skills = new GameSkillsStub();
    const sprites = new SkillPanelSpritesStub();
    const gui = new GameGui(game, sprites, skills, timer, victory);

    gui.setGuiDisplay(display);

    const scale = stage.guiImgProps.viewPoint.scale;
    const panelW = display.worldDataSize.width * scale;
    expect(stage.guiImgProps.x).to.equal((canvas.width - panelW) / 2);
    expect(stage.guiImgProps.y).to.equal(stage.gameImgProps.height);
  });
});
