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
});
