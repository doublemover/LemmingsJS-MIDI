import { expect } from 'chai';
import { KeyboardShortcuts } from '../../js/input/KeyboardShortcuts.js';

describe('KeyboardShortcuts', function() {
  it('resets MIDI on reverse toggle when configured', function() {
    const originalWindow = globalThis.window;
    const originalPerformance = globalThis.performance;
    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
      requestAnimationFrame() {},
      cancelAnimationFrame() {}
    };
    globalThis.performance = { now: () => 0 };
    try {
      let allNotesOffCalls = 0;
      let clearQueueCalls = 0;
      const scheduler = {
        allNotesOff() { allNotesOffCalls += 1; },
        clearQueue() { clearQueueCalls += 1; }
      };
      const midiRouter = {
        scheduler,
        mapping: { config: { reverse: { allNotesOffOnToggle: true } } }
      };
      const game = { timeTravel: { toggleReverse() {} } };
      const view = {
        game,
        midiRouter,
        getMidiConfig() { return midiRouter.mapping.config; }
      };

      const shortcuts = new KeyboardShortcuts(view);
      shortcuts._actions.toggleReverse.down();

      expect(allNotesOffCalls).to.equal(1);
      expect(clearQueueCalls).to.equal(1);
      shortcuts.dispose();
    } finally {
      globalThis.window = originalWindow;
      globalThis.performance = originalPerformance;
    }
  });

  it('skips MIDI reset when reverse toggle config is disabled', function() {
    const originalWindow = globalThis.window;
    const originalPerformance = globalThis.performance;
    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
      requestAnimationFrame() {},
      cancelAnimationFrame() {}
    };
    globalThis.performance = { now: () => 0 };
    try {
      let allNotesOffCalls = 0;
      let clearQueueCalls = 0;
      const scheduler = {
        allNotesOff() { allNotesOffCalls += 1; },
        clearQueue() { clearQueueCalls += 1; }
      };
      const midiRouter = {
        scheduler,
        mapping: { config: { reverse: { allNotesOffOnToggle: false } } }
      };
      const game = { timeTravel: { toggleReverse() {} } };
      const view = {
        game,
        midiRouter,
        getMidiConfig() { return midiRouter.mapping.config; }
      };

      const shortcuts = new KeyboardShortcuts(view);
      shortcuts._actions.toggleReverse.down();

      expect(allNotesOffCalls).to.equal(0);
      expect(clearQueueCalls).to.equal(0);
      shortcuts.dispose();
    } finally {
      globalThis.window = originalWindow;
      globalThis.performance = originalPerformance;
    }
  });

  it('uses injected browser references for listeners and animation frames', function() {
    const listeners = new Map();
    let rafCallback = null;
    let canceled = null;
    const windowRef = {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) listeners.delete(type);
      }
    };
    const shortcuts = new KeyboardShortcuts({
      stage: {
        gameImgProps: {
          viewPoint: { x: 0, y: 0, scale: 1 },
          canvasViewportSize: { width: 100, height: 100 }
        },
        _rawScale: 1,
        applyViewport() {},
        redraw() {},
        limitValue(min, value, max) {
          return Math.max(min, Math.min(max, value));
        },
        snapScale(value) {
          return value;
        }
      }
    }, {
      window: windowRef,
      performance: { now: () => 0 },
      requestAnimationFrame(callback) {
        rafCallback = callback;
        return 7;
      },
      cancelAnimationFrame(id) {
        canceled = id;
      },
      navigator: { getGamepads: () => [] },
      storage: null
    });

    expect(listeners.has('keydown')).to.equal(true);
    shortcuts._actions.panRight.down();
    expect(rafCallback).to.be.a('function');
    shortcuts.dispose();
    expect(canceled).to.equal(7);
    expect(listeners.size).to.equal(0);
  });
});
