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

describe('midiUiController 1', function() {
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

  it('batches queued MIDI UI refreshes into a single timer flush', function() {
    const doc = new TestDocument();
    const win = createDeferredWindow();
    registerElement(doc, 'input', 'midiEnabledToggle');
    registerElement(doc, 'div', 'errorDisplay');
  
    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => ({})
    });
    controller.bindMidiUi();
  
    controller.setMidiOverrides({ timing: { bpmBase: 110 } });
    controller.setMidiOverrides({ scale: { name: 'major' } });
    controller.setMidiOverrides({ velocityRange: { default: 95 } });
    expect(win.__timerCount()).to.equal(1);
  
    win.__runNextTimer();
    expect(win.__timerCount()).to.equal(0);
  
    controller.setMidiOverrides({ repeat: { enabled: true } });
    expect(win.__timerCount()).to.equal(1);
  });

  it('debounces device refresh scheduling while a refresh timer is pending', function() {
    const doc = new TestDocument();
    const win = createDeferredWindow();
    registerElement(doc, 'select', 'midiInSelect');
    registerElement(doc, 'select', 'midiOutSelect');
    registerElement(doc, 'input', 'midiViewPanToggle');
    registerElement(doc, 'div', 'errorDisplay');
    const webMidi = createWebMidiStub(
      [{ id: 'in-1', name: 'Input 1' }],
      [{ id: 'out-1', name: 'Output 1' }]
    );
  
    const controller = createMidiUiController({
      document: doc,
      window: win,
      getWebMidi: () => webMidi,
      getLemmings: () => ({})
    });
  
    controller.onEnabled();
    webMidi.emit('connected');
    webMidi.emit('portschanged');
    expect(win.__timerCount()).to.equal(1);
    expect(win.__scheduledDelays.at(-1)).to.equal(100);
  
    win.__runNextTimer();
    webMidi.emit('disconnected');
    expect(win.__timerCount()).to.equal(1);
    expect(win.__scheduledDelays.filter(delay => delay === 100).length).to.equal(2);
  });

  it('avoids reattaching unchanged devices during scheduled refreshes', function() {
    const doc = new TestDocument();
    const win = createDeferredWindow();
    registerElement(doc, 'select', 'midiInSelect');
    registerElement(doc, 'select', 'midiOutSelect');
    registerElement(doc, 'input', 'midiViewPanToggle');
    registerElement(doc, 'div', 'errorDisplay');
  
    const inputDevice = { id: 'in-1', name: 'Input 1' };
    const outputDevice = { id: 'out-1', name: 'Output 1' };
    const webMidi = createWebMidiStub([inputDevice], [outputDevice]);
    const schedulerCalls = [];
    const lemmings = {
      midiRouter: {
        scheduler: {
          allNotesOff() { schedulerCalls.push('off'); },
          clearQueue() { schedulerCalls.push('clear'); }
        }
      }
    };
    const midiInputController = {
      attachCount: 0,
      detachCount: 0,
      attach() { this.attachCount += 1; },
      detach() { this.detachCount += 1; }
    };
  
    const controller = createMidiUiController({
      document: doc,
      window: win,
      getWebMidi: () => webMidi,
      getLemmings: () => lemmings
    });
    controller.setMidiInputController(midiInputController);
    controller.onEnabled();
    expect(midiInputController.attachCount).to.equal(1);
    expect(schedulerCalls.filter(call => call === 'off').length).to.equal(1);
  
    webMidi.emit('connected');
    win.__runNextTimer();
  
    expect(midiInputController.attachCount).to.equal(1);
    expect(midiInputController.detachCount).to.equal(0);
    expect(schedulerCalls.filter(call => call === 'off').length).to.equal(1);
  });

  it('handles missing input devices when no input controller is attached', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    registerElement(doc, 'select', 'midiInSelect');
    registerElement(doc, 'select', 'midiOutSelect');
    registerElement(doc, 'input', 'midiViewPanToggle');
    registerElement(doc, 'div', 'errorDisplay');
  
    const webMidi = createWebMidiStub(
      [{ id: 'in-1', name: 'Input 1' }],
      [{ id: 'out-1', name: 'Output 1' }]
    );
    const controller = createMidiUiController({
      document: doc,
      window: win,
      getWebMidi: () => webMidi,
      getLemmings: () => ({})
    });
  
    controller.onEnabled();
    webMidi.inputs = [];
    expect(() => controller.setActiveMidiInput('in-1')).to.not.throw();
  });

  it('avoids rewriting stored device ids when selections are unchanged', function() {
    const doc = new TestDocument();
    const win = createDeferredWindow();
    registerElement(doc, 'select', 'midiInSelect');
    registerElement(doc, 'select', 'midiOutSelect');
    registerElement(doc, 'input', 'midiViewPanToggle');
    registerElement(doc, 'div', 'errorDisplay');
    const writes = [];
    const originalSetItem = win.localStorage.setItem.bind(win.localStorage);
    win.localStorage.setItem = (key, value) => {
      if (key === 'lemmings.midi.inputId' || key === 'lemmings.midi.outputId') {
        writes.push({ key, value });
      }
      originalSetItem(key, value);
    };
  
    const webMidi = createWebMidiStub(
      [{ id: 'in-1', name: 'Input 1' }],
      [{ id: 'out-1', name: 'Output 1' }]
    );
    const controller = createMidiUiController({
      document: doc,
      window: win,
      getWebMidi: () => webMidi,
      getLemmings: () => ({})
    });
  
    controller.onEnabled();
    const initialWrites = writes.length;
    controller.onEnabled();
    expect(writes.length).to.equal(initialWrites);
  });

  it('keeps tab state when stale stored ids resolve before any active selection exists', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    registerElement(doc, 'select', 'midiInSelect');
    registerElement(doc, 'select', 'midiOutSelect');
    registerElement(doc, 'input', 'midiViewPanToggle');
    registerElement(doc, 'div', 'errorDisplay');
  
    win.localStorage.setItem('lemmings.midi.tabLeft', 'panelB');
    win.localStorage.setItem('lemmings.midi.sectionStates', JSON.stringify({ alpha: false }));
    win.localStorage.setItem('lemmings.midi.inputId', 'missing-input');
    win.localStorage.setItem('lemmings.midi.outputId', 'out-1');
  
    const webMidi = createWebMidiStub(
      [{ id: 'in-1', name: 'Input 1' }],
      [{ id: 'out-1', name: 'Output 1' }]
    );
    const controller = createMidiUiController({
      document: doc,
      window: win,
      getWebMidi: () => webMidi,
      getLemmings: () => ({})
    });
  
    controller.onEnabled();
  
    expect(win.localStorage.getItem('lemmings.midi.tabLeft')).to.equal('panelB');
    expect(win.localStorage.getItem('lemmings.midi.sectionStates')).to.equal('{"alpha":false}');
  });

  it('attaches the active input when controller is set after enable', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    registerElement(doc, 'select', 'midiInSelect');
    registerElement(doc, 'select', 'midiOutSelect');
    registerElement(doc, 'input', 'midiViewPanToggle');
    registerElement(doc, 'div', 'errorDisplay');
  
    const inputDevice = { id: 'in-1', name: 'Input 1' };
    const webMidi = createWebMidiStub([inputDevice], [{ id: 'out-1', name: 'Output 1' }]);
    const attached = [];
    const controller = createMidiUiController({
      document: doc,
      window: win,
      getWebMidi: () => webMidi,
      getLemmings: () => ({})
    });
  
    controller.onEnabled();
    controller.setMidiInputController({
      attach(device) { attached.push(device); },
      detach() {}
    });
  
    expect(attached).to.eql([inputDevice]);
  });

  it('queues a UI refresh when dispatching midi intents while bound', function() {
    const doc = new TestDocument();
    const win = createDeferredWindow();
    registerElement(doc, 'input', 'midiEnabledToggle');
    registerElement(doc, 'div', 'errorDisplay');
    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => ({})
    });
  
    controller.bindMidiUi();
    controller.dispatchMidiIntent({
      type: 'overrides.merge',
      patch: { repeat: { enabled: true } }
    });
    expect(win.__timerCount()).to.equal(1);
    expect(controller.getMidiOverrides().repeat.enabled).to.equal(true);
  });

  it('does not reapply stored view-pan overrides during unchanged device refreshes', function() {
    const doc = new TestDocument();
    const win = createDeferredWindow();
    registerElement(doc, 'select', 'midiInSelect');
    registerElement(doc, 'select', 'midiOutSelect');
    registerElement(doc, 'input', 'midiViewPanToggle');
    registerElement(doc, 'div', 'errorDisplay');
    win.localStorage.setItem('lemmings.midi.viewPan', 'true');
  
    const applied = [];
    const webMidi = createWebMidiStub(
      [{ id: 'in-1', name: 'Input 1' }],
      [{ id: 'out-1', name: 'Output 1' }]
    );
    const controller = createMidiUiController({
      document: doc,
      window: win,
      getWebMidi: () => webMidi,
      getLemmings: () => ({
        applyMidiOverrides(patch) { applied.push(patch); }
      })
    });
  
    controller.onEnabled();
    expect(applied.filter(patch => patch?.position?.viewPan === true).length).to.equal(1);
  
    webMidi.emit('connected');
    win.__runNextTimer();
    expect(applied.filter(patch => patch?.position?.viewPan === true).length).to.equal(1);
  });

  it('persists the enabled toggle and disables controls', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const enabledToggle = registerElement(doc, 'input', 'midiEnabledToggle');
    const inputSelect = registerElement(doc, 'select', 'midiInSelect');
    const outputSelect = registerElement(doc, 'select', 'midiOutSelect');
    const inputChannel = registerElement(doc, 'select', 'midiInputChannel');
    const resetButton = registerElement(doc, 'button', 'midiResetButton');
    const viewPan = registerElement(doc, 'input', 'midiViewPanToggle');
    registerElement(doc, 'div', 'errorDisplay');
  
    const calls = [];
    const lemmings = { setMidiEnabled(value) { calls.push(value); } };
    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => lemmings
    });
  
    controller.bindMidiUi();
    enabledToggle.checked = false;
    enabledToggle.dispatchEvent({ type: 'change', target: enabledToggle });
  
    expect(win.localStorage.getItem('lemmings.midi.enabled')).to.equal('false');
    expect(calls).to.eql([false]);
    expect(inputSelect.disabled).to.equal(true);
    expect(outputSelect.disabled).to.equal(true);
    expect(inputChannel.disabled).to.equal(true);
    expect(resetButton.disabled).to.equal(true);
    expect(viewPan.disabled).to.equal(true);
  });

  it('clears pending refresh timers when MIDI is disabled', async function() {
    const doc = new TestDocument();
    const win = createCancellableWindow();
    const enabledToggle = registerElement(doc, 'input', 'midiEnabledToggle');
    registerElement(doc, 'select', 'midiInSelect');
    registerElement(doc, 'select', 'midiOutSelect');
    registerElement(doc, 'select', 'midiInputChannel');
    registerElement(doc, 'button', 'midiResetButton');
    registerElement(doc, 'input', 'midiViewPanToggle');
    registerElement(doc, 'div', 'errorDisplay');
    const webMidi = createWebMidiStub(
      [{ id: 'in-1', name: 'Input 1' }],
      [{ id: 'out-1', name: 'Output 1' }]
    );
  
    const controller = createMidiUiController({
      document: doc,
      window: win,
      getWebMidi: () => webMidi,
      getLemmings: () => ({ setMidiEnabled: async () => {} })
    });
  
    controller.bindMidiUi();
    controller.setMidiOverrides({ timing: { bpmBase: 128 } });
    controller.onEnabled();
    webMidi.emit('connected');
    expect(win.__timerCount()).to.be.greaterThan(0);
  
    enabledToggle.checked = false;
    enabledToggle.dispatchEvent({ type: 'change', target: enabledToggle });
    await Promise.resolve();
  
    expect(win.__timerCount()).to.equal(0);
  });
});
