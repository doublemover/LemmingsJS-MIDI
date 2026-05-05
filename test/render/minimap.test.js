import { expect } from 'chai';
import { MiniMap } from '../../js/render/MiniMap.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';
import { useGlobalLemmings, withGlobalLemmings } from '../helpers/lemmings.js';

const makeGuiDisplay = () => ({
  worldDataSize: { width: 200, height: 120 },
  setScreenPositionCalls: [],
  drawFrameCalls: [],
  setScreenPosition(x, y, options) {
    this.setScreenPositionCalls.push({ x, y, options });
  },
  drawFrame(frame, x, y) {
    this.drawFrameCalls.push({ frame, x, y });
  },
  onMouseDown: new EventHandler(),
  onMouseUp: new EventHandler(),
  onMouseMove: new EventHandler()
});

const makeLevel = (counter) => ({
  width: 100,
  height: 50,
  screenPositionX: 0,
  objects: [],
  getGroundMaskLayer() {
    return { countMaskInRect: () => counter.value };
  }
});

describe('MiniMap', function() {
  useGlobalLemmings({});

  it('builds terrain and responds to updates', function() {
    const counter = { value: 100 };
    const level = makeLevel(counter);
    const guiDisplay = makeGuiDisplay();
    const miniMap = new MiniMap({}, level, guiDisplay);

    expect(miniMap.terrain[0]).to.equal(72);

    const idx = ((1 * miniMap.scaleY) | 0) * miniMap.width +
      ((1 * miniMap.scaleX) | 0);
    miniMap.onGroundChanged(1, 1, true);
    expect(miniMap.terrain[idx]).to.equal(71);
    miniMap.onGroundChanged(1, 1, false);
    expect(miniMap.terrain[idx]).to.equal(72);

    counter.value = 5;
    miniMap.invalidateRegion(0, 0, 2, 2);
    withGlobalLemmings({
      stage: { getGameViewRect() { return { x: 0, y: 0, w: 50, h: 25 }; } },
      game: { timeTravel: { isReversing: false } }
    }, () => {
      miniMap.render();
    });
    expect(miniMap.terrain[0]).to.equal(5);

    miniMap.fog.fill(0);
    miniMap.reveal(0, 10);
    expect(miniMap.fog[0]).to.equal(1);
    miniMap.fog.fill(0);
    miniMap.reveal(-10, 5);
    expect(Object.prototype.hasOwnProperty.call(miniMap.fog, '-1')).to.equal(false);
    expect(miniMap.fog[0]).to.equal(0);
  });

  it('handles pointer events and death tracking', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    const guiDisplay = makeGuiDisplay();
    const records = [];
    const miniMap = new MiniMap({}, level, guiDisplay, {
      history: { recordMinimapDeath: (entry) => records.push(entry) }
    });

    const destX = guiDisplay.worldDataSize.width - miniMap.width;
    const destY = guiDisplay.worldDataSize.height - miniMap.height;

    guiDisplay.onMouseDown.trigger({ x: destX + 10, y: destY + 5 });
    const expectedX = Math.max(
      0,
      Math.min(
        level.width - guiDisplay.worldDataSize.width,
        ((level.width - guiDisplay.worldDataSize.width) * (10 / (miniMap.width - 1))) | 0
      )
    );
    expect(level.screenPositionX).to.equal(expectedX);

    guiDisplay.onMouseMove.trigger({ x: destX + 15, y: destY + 5 });
    expect(guiDisplay.setScreenPositionCalls.length).to.equal(2);

    guiDisplay.onMouseUp.trigger({ x: destX + 20, y: destY + 5 });
    expect(guiDisplay.setScreenPositionCalls.length).to.equal(3);

    guiDisplay.onMouseMove.trigger({ x: destX + miniMap.width - 1, y: destY + 5 });
    expect(level.screenPositionX).to.equal(0);

    guiDisplay.onMouseDown.trigger({ x: destX + 1, y: destY + miniMap.height - 1 });
    expect(guiDisplay.setScreenPositionCalls.length).to.equal(4);

    guiDisplay.onMouseDown.trigger({ x: 1, y: 1 });
    expect(guiDisplay.setScreenPositionCalls.length).to.equal(4);
    guiDisplay.onMouseDown.trigger({ x: Number.NaN, y: destY + 1 });
    expect(guiDisplay.setScreenPositionCalls.length).to.equal(4);

    miniMap.deadCount = miniMap.deadTTLs.length;
    miniMap.addDeath(5, 5);
    expect(records.length).to.equal(1);
    expect(miniMap.deadTTLs.length).to.be.greaterThan(32);
  });

  it('uses stage viewport width for pointer mapping when available', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    level.width = 500;
    const guiDisplay = makeGuiDisplay();
    const miniMap = new MiniMap({}, level, guiDisplay);
    const destX = guiDisplay.worldDataSize.width - miniMap.width;
    const destY = guiDisplay.worldDataSize.height - miniMap.height;
    const stageWidth = 120;

    withGlobalLemmings({
      stage: {
        getGameViewRect() {
          return { x: 0, y: 0, w: stageWidth, h: 25 };
        }
      }
    }, () => {
      guiDisplay.onMouseDown.trigger({ x: destX + 10, y: destY + 5 });
    });

    const expectedX = Math.max(
      0,
      Math.min(
        level.width - stageWidth,
        ((level.width - stageWidth) * (10 / (miniMap.width - 1))) | 0
      )
    );
    expect(level.screenPositionX).to.equal(expectedX);
  });

  it('normalizes invalid level dimensions to finite minimap scales', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    level.width = 0;
    level.height = Number.NaN;
    const guiDisplay = makeGuiDisplay();
    const miniMap = new MiniMap({}, level, guiDisplay);

    expect(Number.isFinite(miniMap.scaleX)).to.equal(true);
    expect(Number.isFinite(miniMap.scaleY)).to.equal(true);
    expect(miniMap.scaleX).to.be.greaterThan(0);
    expect(miniMap.scaleY).to.be.greaterThan(0);

    const destX = guiDisplay.worldDataSize.width - miniMap.width;
    const destY = guiDisplay.worldDataSize.height - miniMap.height;
    miniMap.invalidateRegion(0, 0, 4, 4);
    withGlobalLemmings({
      stage: { getGameViewRect() { return { x: 0, y: 0, w: 50, h: 25 }; } },
      game: { timeTravel: { isReversing: false } }
    }, () => {
      expect(() => miniMap.render()).to.not.throw();
      guiDisplay.onMouseDown.trigger({ x: destX + 20, y: destY + 5 });
    });
    expect(Number.isFinite(level.screenPositionX)).to.equal(true);
  });

  it('renders viewport, dots, and death flashes', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    level.objects = [
      { x: 10, y: 5, ob: { id: 1 } },
      { x: 20, y: 8, triggerType: TriggerTypes.EXIT_LEVEL }
    ];
    const guiDisplay = makeGuiDisplay();
    const miniMap = new MiniMap({}, level, guiDisplay);

    miniMap.setLiveDots(Uint8Array.from([1, 1, 2, 2]));
    miniMap.setSelectedDot([3, 3]);
    miniMap.deadCount = 2;
    miniMap.deadDots[0] = 4;
    miniMap.deadDots[1] = 4;
    miniMap.deadDots[2] = 5;
    miniMap.deadDots[3] = 5;
    miniMap.deadTTLs[0] = 5;
    miniMap.deadTTLs[1] = 1;

    const app = {
      stage: { getGameViewRect() { return { x: 0, y: 0, w: 50, h: 25 }; } },
      game: { timeTravel: { isReversing: true } }
    };
    withGlobalLemmings(app, () => {
      miniMap.render();
      expect(guiDisplay.drawFrameCalls.length).to.equal(1);

      app.game.timeTravel.isReversing = false;
      miniMap.render();
      expect(miniMap.deadCount).to.equal(1);
    });
  });

  it('advances viewport dash and clamps viewport width', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    const guiDisplay = makeGuiDisplay();
    const miniMap = new MiniMap({}, level, guiDisplay);
    let rectArgs = null;
    miniMap.frame.drawMarchingAntRect = (...args) => { rectArgs = args; };
    miniMap._viewportCounter = miniMap.viewportDashDelay - 1;
    miniMap.viewportDashOffset = 3;

    withGlobalLemmings({
      stage: { getGameViewRect() { return { x: 0, y: 0, w: level.width, h: level.height }; } },
      game: { timeTravel: { isReversing: false } }
    }, () => {
      miniMap.render();
      expect(miniMap._viewportCounter).to.equal(0);
      expect(miniMap.viewportDashOffset).to.equal(4);
      expect(rectArgs[2]).to.equal(miniMap.width - 1);
    });
  });

  it('disposes display listeners', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    const guiDisplay = makeGuiDisplay();
    const miniMap = new MiniMap({}, level, guiDisplay);

    expect(guiDisplay.onMouseDown.handlers.size).to.be.greaterThan(0);
    miniMap.dispose();
    expect(guiDisplay.onMouseDown.handlers.size).to.equal(0);
  });

  it('clamps terrain counts and handles missing history', function() {
    const counter = { value: 100 };
    const level = makeLevel(counter);
    const guiDisplay = makeGuiDisplay();
    const miniMap = new MiniMap({}, level, guiDisplay);
    miniMap.invalidateRegion(0, 0, 1, 1);
    withGlobalLemmings({
      stage: { getGameViewRect() { return { x: 0, y: 0, w: 50, h: 25 }; } },
      game: { timeTravel: { isReversing: false } }
    }, () => {
      miniMap.render();
    });
    expect(miniMap.terrain[0]).to.equal(72);

    withGlobalLemmings(null, () => {
      miniMap.addDeath(0, 0);
    });
  });

  it('returns early without a gui display and skips expired death dots', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    const miniMap = new MiniMap({}, level, null);
    expect(() => miniMap.render()).to.not.throw();

    const guiDisplay = makeGuiDisplay();
    const activeMap = new MiniMap({}, level, guiDisplay);
    activeMap.deadCount = 1;
    activeMap.deadTTLs[0] = 0;
    activeMap.deadDots[0] = 1;
    activeMap.deadDots[1] = 1;
    withGlobalLemmings({
      stage: { getGameViewRect() { return { x: 0, y: 0, w: 50, h: 25 }; } },
      game: { timeTravel: { isReversing: true } }
    }, () => {
      activeMap.render();
    });
  });

  it('returns early for invalid pointer state and bounds', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    const guiDisplay = makeGuiDisplay();
    const miniMap = new MiniMap({}, level, guiDisplay);
    const destX = guiDisplay.worldDataSize.width - miniMap.width;
    const destY = guiDisplay.worldDataSize.height - miniMap.height;

    miniMap.guiDisplay = null;
    guiDisplay.onMouseDown.trigger({ x: destX + 1, y: destY + 1 });
    guiDisplay.onMouseMove.trigger({ x: destX + 1, y: destY + 1 });
    guiDisplay.onMouseUp.trigger({ x: destX + 1, y: destY + 1 });

    miniMap.guiDisplay = guiDisplay;
    guiDisplay.onMouseUp.trigger({ x: 1, y: 1 });

    miniMap._mouseDown = false;
    guiDisplay.onMouseMove.trigger({ x: destX + 1, y: destY + 1 });

    miniMap._mouseDown = true;
    guiDisplay.onMouseMove.trigger({ x: 1, y: 1 });
  });

  it('reuses cached minimap frame composition when inputs are unchanged', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    const guiDisplay = makeGuiDisplay();
    const miniMap = new MiniMap({}, level, guiDisplay);
    withGlobalLemmings({
      stage: { getGameViewRect() { return { x: 0, y: 0, w: 50, h: 25 }; } },
      game: { timeTravel: { isReversing: false } }
    }, () => {
      miniMap.render();
      miniMap.render();
    });
    const diagnostics = miniMap.getRenderDiagnostics();
    expect(diagnostics.composes).to.be.greaterThan(0);
    expect(diagnostics.reuses).to.be.greaterThan(0);
  });

  it('bounds terrain revalidation queue growth under heavy updates', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    const guiDisplay = makeGuiDisplay();
    const miniMap = new MiniMap({}, level, guiDisplay);

    const updates = miniMap.width * miniMap.height + 10;
    for (let i = 0; i < updates; i += 1) {
      const miniMapX = i % miniMap.width;
      const miniMapY = 0;
      miniMap.invalidateRegion(
        Math.floor(miniMapX / miniMap.scaleX),
        Math.floor(miniMapY / miniMap.scaleY),
        1 / miniMap.scaleX,
        1 / miniMap.scaleY
      );
    }

    expect(miniMap.getRenderDiagnostics().terrainDirtyCount).to.be.at.most(miniMap.size);

    withGlobalLemmings({
      stage: { getGameViewRect() { return { x: 0, y: 0, w: 50, h: 25 }; } },
      game: { timeTravel: { isReversing: false } }
    }, () => {
      miniMap.render();
    });

    expect(miniMap.getRenderDiagnostics().terrainDirtyCount).to.be.at.least(0);
  });

  it('keeps viewport pinned when map width does not exceed visible width', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    level.width = 120;
    const guiDisplay = makeGuiDisplay();
    guiDisplay.worldDataSize.width = 200;
    const miniMap = new MiniMap({}, level, guiDisplay);
    const destX = guiDisplay.worldDataSize.width - miniMap.width;
    const destY = guiDisplay.worldDataSize.height - miniMap.height;

    guiDisplay.onMouseDown.trigger({ x: destX + miniMap.width - 1, y: destY + 5 });
    expect(level.screenPositionX).to.equal(0);
    expect(guiDisplay.setScreenPositionCalls.at(-1).x).to.equal(0);
  });

  it('evicts overwritten dirty indices when queue is saturated', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    const guiDisplay = makeGuiDisplay();
    const miniMap = new MiniMap({}, level, guiDisplay);

    const overwritten = 17;
    miniMap._terrainDirtyCount = miniMap.size;
    miniMap._terrainDirtyRead = 0;
    miniMap._terrainDirtyWrite = 0;
    miniMap._terrainDirtyFlags.fill(0);
    miniMap._terrainDirtyIndices[0] = overwritten;
    miniMap._terrainDirtyFlags[overwritten] = 1;

    const miniMapX = 22;
    miniMap.invalidateRegion(
      Math.floor(miniMapX / miniMap.scaleX),
      0,
      1 / miniMap.scaleX,
      1 / miniMap.scaleY
    );

    expect(miniMap._terrainDirtyFlags[overwritten]).to.equal(0);
    expect(miniMap._terrainDirtyCount).to.equal(miniMap.size);
  });
});
