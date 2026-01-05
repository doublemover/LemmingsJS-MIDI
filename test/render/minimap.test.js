import { expect } from 'chai';
import { MiniMap } from '../../js/render/MiniMap.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';

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
  let originalLemmings;

  beforeEach(function() {
    originalLemmings = globalThis.lemmings;
  });

  afterEach(function() {
    globalThis.lemmings = originalLemmings;
  });

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
    expect(miniMap.terrain[0]).to.equal(5);

    miniMap.fog.fill(0);
    miniMap.reveal(0, 10);
    expect(miniMap.fog[0]).to.equal(1);
  });

  it('handles pointer events and death tracking', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    const guiDisplay = makeGuiDisplay();
    const miniMap = new MiniMap({}, level, guiDisplay);

    const destX = guiDisplay.worldDataSize.width - miniMap.width;
    const destY = guiDisplay.worldDataSize.height - miniMap.height - 1;

    guiDisplay.onMouseDown.trigger({ x: destX + 10, y: destY + 5 });
    const expectedX = ((level.width - guiDisplay.worldDataSize.width)
      * ((10) / miniMap.width)) | 0;
    expect(level.screenPositionX).to.equal(expectedX);

    guiDisplay.onMouseMove.trigger({ x: destX + 15, y: destY + 5 });
    expect(guiDisplay.setScreenPositionCalls.length).to.equal(2);

    guiDisplay.onMouseUp.trigger({ x: destX + 20, y: destY + 5 });
    expect(guiDisplay.setScreenPositionCalls.length).to.equal(3);

    guiDisplay.onMouseDown.trigger({ x: 1, y: 1 });
    expect(guiDisplay.setScreenPositionCalls.length).to.equal(3);

    const records = [];
    globalThis.lemmings = {
      game: {
        history: { recordMinimapDeath: (entry) => records.push(entry) }
      }
    };
    miniMap.deadCount = miniMap.deadTTLs.length;
    miniMap.addDeath(5, 5);
    expect(records.length).to.equal(1);
    expect(miniMap.deadTTLs.length).to.be.greaterThan(32);
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

    globalThis.lemmings = {
      stage: { getGameViewRect() { return { x: 0, y: 0, w: 50, h: 25 }; } },
      game: { timeTravel: { isReversing: true } }
    };
    miniMap.render();
    expect(guiDisplay.drawFrameCalls.length).to.equal(1);

    globalThis.lemmings.game.timeTravel.isReversing = false;
    miniMap.render();
    expect(miniMap.deadCount).to.equal(1);
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

    globalThis.lemmings = {
      stage: { getGameViewRect() { return { x: 0, y: 0, w: level.width, h: level.height }; } },
      game: { timeTravel: { isReversing: false } }
    };

    miniMap.render();
    expect(miniMap._viewportCounter).to.equal(0);
    expect(miniMap.viewportDashOffset).to.equal(4);
    expect(rectArgs[2]).to.equal(miniMap.width - 1);
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
    expect(miniMap.terrain[0]).to.equal(72);

    globalThis.lemmings = null;
    miniMap.addDeath(0, 0);
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
    globalThis.lemmings = {
      stage: { getGameViewRect() { return { x: 0, y: 0, w: 50, h: 25 }; } },
      game: { timeTravel: { isReversing: true } }
    };
    activeMap.render();
  });

  it('returns early for invalid pointer state and bounds', function() {
    const counter = { value: 1 };
    const level = makeLevel(counter);
    const guiDisplay = makeGuiDisplay();
    const miniMap = new MiniMap({}, level, guiDisplay);
    const destX = guiDisplay.worldDataSize.width - miniMap.width;
    const destY = guiDisplay.worldDataSize.height - miniMap.height - 1;

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
});
