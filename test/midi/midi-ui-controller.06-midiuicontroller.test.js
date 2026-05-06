import { expect } from 'chai';
import { createMidiUiController } from '../../js/app/midiUiController.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { SkillTypes } from '../../js/game/SkillTypes.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';
import { withConsoleStub } from '../helpers/console.js';
import { TestDocument, TestElement, createTestWindow } from '../helpers/test-dom.js';
import {
  findElement,
  findRowInputByLabel,
  installRichSelectors,
  registerElement,
  registerRangeInput
} from '../support/dom-fixtures.js';
import { runScenarioTable } from '../support/scenario-table.js';

if (!TestElement.prototype.contains) {
  TestElement.prototype.contains = function(target) {
    if (!target) return false;
    if (target === this) return true;
    return (this.children || []).some(child => (
      typeof child.contains === 'function' ? child.contains(target) : child === target
    ));
  };
}

if (!TestElement.prototype.removeEventListener) {
  TestElement.prototype.removeEventListener = function(type, handler) {
    const handlers = this.listeners.get(type) || [];
    this.listeners.set(type, handlers.filter(next => next !== handler));
  };
}

const createWebMidiStub = (inputs, outputs) => {
  const listeners = new Map();
  return {
    enabled: true,
    inputs,
    outputs,
    getInputById(id) {
      return (inputs || []).find(device => device.id === id) || null;
    },
    getOutputById(id) {
      return (outputs || []).find(device => device.id === id) || null;
    },
    addListener(type, handler) {
      listeners.set(type, handler);
    },
    removeListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    emit(type) {
      const handler = listeners.get(type);
      if (handler) handler();
    }
  };
};

const createDeferredWindow = () => {
  const win = createTestWindow();
  const queue = [];
  const scheduledDelays = [];
  win.setTimeout = (cb, delay = 0) => {
    queue.push(cb);
    scheduledDelays.push(delay);
    return queue.length;
  };
  win.__runNextTimer = () => {
    const cb = queue.shift();
    if (typeof cb === 'function') cb();
  };
  win.__timerCount = () => queue.length;
  win.__scheduledDelays = scheduledDelays;
  return win;
};

const createCancellableWindow = () => {
  const win = createTestWindow();
  const timers = new Map();
  let nextTimerId = 1;
  win.setTimeout = (cb) => {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, cb);
    return id;
  };
  win.clearTimeout = (id) => {
    timers.delete(id);
  };
  win.__timerCount = () => timers.size;
  return win;
};

describe('midiUiController 6', function() {
  runScenarioTable([
    {
      name: 'shows omni when input channel defaults to omni',
      channel: 'omni',
      expected: 'omni'
    },
    {
      name: 'shows explicit numeric channel when provided',
      channel: 5,
      expected: '5'
    }
  ], ({ channel, expected }) => {
    const doc = new TestDocument();
    const win = createTestWindow();
    const inputChannel = registerElement(doc, 'select', 'midiInputChannel');

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => ({ input: { channel }, timing: { bpmBase: 120 } })
    });

    controller.refreshMidiUiFromConfig();
    expect(inputChannel.value).to.equal(expected);
  });

  it('exposes deterministic intent automation hooks', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    win.localStorage.setItem('lemmings.midi.enabled', 'true');
    registerElement(doc, 'div', 'midiEventList');
    registerElement(doc, 'div', 'midiTriggerList');
    registerElement(doc, 'select', 'midiEnvTarget');
    registerElement(doc, 'div', 'errorDisplay');

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => ({ timing: { bpmBase: 120 } })
    });

    controller.bindMidiUi();
    const state0 = controller.getMidiIntentState();
    expect(state0).to.have.property('revision');
    controller.dispatchMidiIntent({ type: 'overrides.merge', patch: { repeat: { enabled: true } } });
    expect(controller.getMidiOverrides().repeat.enabled).to.equal(true);
    expect(win.__LEMMINGS_MIDI_UI__).to.be.ok;
    expect(win.__LEMMINGS_MIDI_UI__.getIntentState().overrides.repeat.enabled).to.equal(true);
    expect(controller.getFeatureFlags()).to.have.property('expressiveControls');
    const previewResult = win.__LEMMINGS_MIDI_UI__.auditionMapping({ targetKey: 'sfx', id: 1 });
    expect(previewResult).to.equal(false);
  });
});
