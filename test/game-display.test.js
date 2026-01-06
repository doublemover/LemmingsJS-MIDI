import { expect } from 'chai';
import { EventHandler } from '../js/util/EventHandler.js';
import { GameDisplay } from '../js/game/GameDisplay.js';
import { SkillTypes } from '../js/game/SkillTypes.js';

describe('GameDisplay', function() {
  let originalWindow;

  function makeDisplay(overrides = {}) {
    return {
      onMouseDown: new EventHandler(),
      onMouseMove: new EventHandler(),
      drawCornerRect() {},
      drawDashedRect() {},
      ...overrides
    };
  }

  function makeLemming(id = 1) {
    return {
      id,
      x: 10,
      y: 20,
      removed: false,
      disabled: false,
      action: null,
      getClickDistance() { return 1; }
    };
  }

  function makeContext(overrides = {}) {
    const game = {
      showDebug: false,
      gameGui: { backgroundChanged: false, gameTimeChanged: false },
      ...overrides.game
    };
    const lemmingManager = {
      render() {},
      renderDebug() {},
      getNearestLemming() { return null; },
      getSelectedLemming() { return null; },
      ...overrides.lemmingManager
    };
    const level = { render() {}, renderDebug() {}, ...overrides.level };
    const objectManager = { render() {}, ...overrides.objectManager };
    const triggerManager = { renderDebug() {}, ...overrides.triggerManager };
    return { game, lemmingManager, level, objectManager, triggerManager };
  }

  beforeEach(function() {
    originalWindow = globalThis.window;
    globalThis.window = {
      requestAnimationFrame(cb) { cb(); return 1; },
      cancelAnimationFrame() {}
    };
  });

  afterEach(function() {
    globalThis.window = originalWindow;
  });

  it('wires mouse handlers and updates hover position', function() {
    const lem = makeLemming(3);
    const calls = [];
    const { game, lemmingManager, level, objectManager, triggerManager } = makeContext({
      game: { queueCommand(cmd) { calls.push(cmd); } },
      lemmingManager: { getNearestLemming() { return lem; } }
    });
    const gd = new GameDisplay(game, level, lemmingManager, objectManager, triggerManager);

    const display = makeDisplay();
    gd.setGuiDisplay(display);
    display.onMouseDown.trigger({ x: 1, y: 2 });
    display.onMouseMove.trigger({ x: 7, y: 9 });

    expect(calls.length).to.equal(1);
    expect(calls[0].lemmingId).to.equal(3);
    expect(gd.hoverLemming).to.equal(lem);
  });

  it('updates hover and flags gui changes', function() {
    const prev = makeLemming(1);
    prev.removed = true;
    const next = makeLemming(2);
    const { game, lemmingManager, level, objectManager, triggerManager } = makeContext({
      lemmingManager: { getNearestLemming() { return next; } }
    });
    const gd = new GameDisplay(game, level, lemmingManager, objectManager, triggerManager);

    gd.hoverLemming = prev;
    gd._hoverX = 0;
    gd._hoverY = 0;
    gd._updateHover();

    expect(gd.hoverLemming).to.equal(next);
    expect(game.gameGui.backgroundChanged).to.equal(true);
    expect(game.gameGui.gameTimeChanged).to.equal(true);
  });

  it('ignores exploding lemmings when hovering', function() {
    const lem = makeLemming(5);
    lem.action = { getActionName() { return 'exploding'; } };
    const { game, lemmingManager, level, objectManager, triggerManager } = makeContext({
      lemmingManager: { getNearestLemming() { return lem; } }
    });
    const gd = new GameDisplay(game, level, lemmingManager, objectManager, triggerManager);

    gd._hoverX = 0;
    gd._hoverY = 0;
    gd._updateHover();
    expect(gd.hoverLemming).to.equal(null);
  });

  it('renders selection and hover decorations', function() {
    const calls = [];
    const display = makeDisplay({ drawCornerRect(...args) { calls.push(args); } });
    const DummyAction = class {};
    const skills = { getSelectedSkill() { return SkillTypes.BASHER; } };
    const selected = makeLemming(1);
    selected.action = new DummyAction();
    const hover = makeLemming(2);
    const { game, lemmingManager, level, objectManager, triggerManager } = makeContext({
      game: { getGameSkills() { return skills; } },
      lemmingManager: {
        render() { this.rendered = true; },
        getSelectedLemming() { return selected; }
      },
      level: { render() { this.rendered = true; } },
      objectManager: { render() { this.rendered = true; } }
    });
    const gd = new GameDisplay(game, level, lemmingManager, objectManager, triggerManager);
    gd._redundantActions[SkillTypes.BASHER] = DummyAction;
    gd.display = display;
    gd.hoverLemming = hover;

    gd.render();

    expect(level.rendered).to.equal(true);
    expect(objectManager.rendered).to.equal(true);
    expect(lemmingManager.rendered).to.equal(true);
    expect(calls.length).to.equal(2);
    expect(calls[0][3]).to.equal(0);
    expect(calls[0][4]).to.equal(255);
    expect(calls[0][5]).to.equal(255);
  });

  it('exposes drawCorner test hook', function() {
    const display = makeDisplay({ drawRect(...args) { this.args = args; } });
    const { game, lemmingManager, level, objectManager, triggerManager } = makeContext();
    const gd = new GameDisplay(game, level, lemmingManager, objectManager, triggerManager);
    gd.display = display;

    GameDisplay.__test__.drawCorner(gd, 1, 2, 3, 4, 5);

    expect(display.args).to.eql([1, 2, 2, 2, 3, 4, 5, true]);
  });

  it('renders debug overlays and advances dash offset', function() {
    const display = { drawDashedRect(...args) { this.args = args; } };
    const { game, lemmingManager, level, objectManager, triggerManager } = makeContext({
      lemmingManager: { renderDebug() { this.called = true; } },
      level: { renderDebug() { this.called = true; } },
      triggerManager: { renderDebug() { this.called = true; } }
    });
    const gd = new GameDisplay(game, level, lemmingManager, objectManager, triggerManager);
    gd.display = display;
    gd.hoverLemming = makeLemming(1);
    gd.renderDebug();

    expect(display.args).to.have.length(6);
    expect(gd._dashOffset).to.equal(1);
  });

  it('skips input when disabled and uses fallback hover scheduling', function() {
    const display = makeDisplay();
    let queued = 0;
    let nearestCalls = 0;
    const { game, lemmingManager, level, objectManager, triggerManager } = makeContext({
      game: {
        inputEnabled: false,
        queueCommand() { queued += 1; }
      },
      lemmingManager: {
        getNearestLemming() { nearestCalls += 1; return makeLemming(2); }
      }
    });
    const gd = new GameDisplay(game, level, lemmingManager, objectManager, triggerManager);
    gd.setGuiDisplay(display);

    display.onMouseDown.trigger({ x: 1, y: 2 });
    display.onMouseMove.trigger({ x: 3, y: 4 });
    expect(queued).to.equal(0);

    let distanceCalls = 0;
    const prev = makeLemming(1);
    prev.getClickDistance = () => { distanceCalls += 1; return -1; };
    gd.hoverLemming = prev;
    gd._hoverX = 1;
    gd._hoverY = 1;
    gd._updateHover();
    expect(distanceCalls).to.equal(1);
    expect(nearestCalls).to.equal(1);

    const originalWindow = globalThis.window;
    globalThis.window = {};
    let scheduled = 0;
    gd._updateHover = () => { scheduled += 1; };
    gd._hoverRafId = 0;
    gd._scheduleHoverUpdate();
    expect(scheduled).to.equal(1);
    gd._hoverRafId = 123;
    gd._scheduleHoverUpdate();
    expect(scheduled).to.equal(1);
    globalThis.window = originalWindow;
  });

  it('skips rendering when no display is assigned', function() {
    const { game, lemmingManager, level, objectManager, triggerManager } = makeContext();
    const gd = new GameDisplay(game, level, lemmingManager, objectManager, triggerManager);
    gd.render();
    gd.renderDebug();
    expect(gd.display).to.equal(null);
  });

  it('disposes handlers and clears references', function() {
    const display = makeDisplay();
    let cancelled = 0;
    globalThis.window.cancelAnimationFrame = () => { cancelled += 1; };
    globalThis.window.requestAnimationFrame = () => 2;
    const { game, lemmingManager, level, objectManager, triggerManager } = makeContext();
    const gd = new GameDisplay(game, level, lemmingManager, objectManager, triggerManager);
    gd.setGuiDisplay(display);
    display.onMouseMove.trigger({ x: 1, y: 2 });

    gd.dispose();

    expect(display.onMouseDown.handlers.size).to.equal(0);
    expect(display.onMouseMove.handlers.size).to.equal(0);
    expect(cancelled).to.equal(1);
    expect(gd.display).to.equal(null);
  });
});
