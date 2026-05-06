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

describe('midiUiController 5', function() {
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

  it('refreshes devices and debug output and schedules device updates', function() {
    const doc = new TestDocument();
    installRichSelectors(doc);
    doc.body = doc.createElement('body');
    const win = createTestWindow();
    const intervals = [];
    const clearedIntervals = [];
    const timeouts = [];
    const dispatched = [];
    win.setInterval = (cb) => {
      intervals.push(cb);
      return intervals.length;
    };
    win.clearInterval = (id) => {
      clearedIntervals.push(id);
    };
    win.setTimeout = (cb) => {
      timeouts.push(cb);
      return timeouts.length;
    };
    win.dispatchEvent = (event) => dispatched.push(event.type);

    const enabledToggle = registerElement(doc, 'input', 'midiEnabledToggle');
    const inputSelect = registerElement(doc, 'select', 'midiInSelect');
    const outputSelect = registerElement(doc, 'select', 'midiOutSelect');
    const inputChannel = registerElement(doc, 'select', 'midiInputChannel');
    const viewPan = registerElement(doc, 'input', 'midiViewPanToggle');
    const resetButton = registerElement(doc, 'button', 'midiResetButton');
    const defaultsButton = registerElement(doc, 'button', 'midiDefaultsButton');
    const panelToggle = registerElement(doc, 'div', 'midiPanelToggle');
    const leftPanel = registerElement(doc, 'div', 'controlLeft');
    const bpmBase = registerElement(doc, 'input', 'midiBpmBase');
    const bpmCurrent = registerElement(doc, 'span', 'midiBpmCurrent');
    const debugInput = registerElement(doc, 'span', 'midiDebugInput');
    const debugOutput = registerElement(doc, 'span', 'midiDebugOutput');
    registerElement(doc, 'div', 'errorDisplay');

    win.localStorage.setItem('lemmings.midi.viewPan', 'true');
    win.localStorage.setItem('lemmings.midi.inputId', 'missing');
    win.localStorage.setItem('lemmings.midi.outputId', 'out-2');
    win.localStorage.setItem('lemmings.midi.inputChannel', '2');
    win.localStorage.setItem('lemmings.midi.enabled', 'true');

    const inputs = [{ id: 'in-1', name: 'Input A' }];
    const outputs = [
      { id: 'out-1', name: 'Output A' },
      { id: 'out-2', name: 'Output B' }
    ];
    const webMidi = createWebMidiStub(inputs, outputs);
    const schedulerCalls = [];
    const applied = [];
    const timerState = { tps: Infinity, speedFactor: 1 };
    const lemmings = {
      midiRouter: {
        scheduler: {
          allNotesOff() { schedulerCalls.push('off'); },
          clearQueue() { schedulerCalls.push('clear'); }
        }
      },
      applyMidiOverrides(patch) { applied.push(patch); },
      getMidiSchemaHash: () => null,
      game: { getGameTimer() { return timerState; } }
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => lemmings,
      getWebMidi: () => webMidi,
      getMidiConfig: () => ({ timing: { bpmBase: 90 } })
    });

    controller.bindMidiUi();
    controller.bindMidiUi();
    expect(win.__LEMMINGS_MIDI_UI__).to.be.ok;
    win.lastMidiInputMessage = [144, 60, 127];
    win.lastMidiOutputMessage = { note: 61, velocity: 100, channel: 2 };
    intervals.forEach(cb => cb());
    expect(debugInput.textContent).to.contain('Input: 90 3c 7f');
    expect(debugOutput.textContent).to.contain('note 61');

    delete timerState.tps;
    timerState.frameTime = 16;
    timerState.speedFactor = 0;
    win.lastMidiOutputMessage = [1, 2, 3];
    intervals.forEach(cb => cb());

    win.lastMidiInputMessage = 'raw';
    win.lastMidiOutputMessage = 'raw';
    intervals.forEach(cb => cb());

    win.lastMidiOutputMessage = { note: NaN, velocity: NaN, channel: NaN };
    intervals.forEach(cb => cb());

    win.lastMidiOutputMessage = null;
    win.lastMidiInputMessage = [];
    intervals.forEach(cb => cb());
    expect(debugOutput.textContent).to.contain('--');

    globalThis.Event = function Event(type) { this.type = type; };
    panelToggle.dispatchEvent({ type: 'click' });
    timeouts.shift()();
    expect(dispatched).to.include('resize');
    expect(leftPanel.classList.contains('collapsed')).to.equal(true);
    delete globalThis.Event;

    const midiInputController = {
      attach(device) { this.attached = device; },
      detach() { this.detached = true; },
      setNoteCapture() {}
    };
    controller.setMidiInputController(midiInputController);
    controller.onEnabled();
    controller.onEnabled();
    const timerCount = timeouts.length;
    webMidi.emit('connected');
    webMidi.emit('connected');
    expect(timeouts.length - timerCount).to.equal(1);
    expect(inputSelect.value).to.equal('in-1');
    expect(outputSelect.value).to.equal('out-2');
    expect(viewPan.checked).to.equal(true);
    expect(applied.some((patch) => patch?.position?.viewPan === true)).to.equal(true);
    expect(midiInputController.attached).to.equal(inputs[0]);
    expect(lemmings.midiOut).to.equal(outputs[1]);
    outputSelect.value = 'out-1';
    outputSelect.dispatchEvent({ type: 'change', target: outputSelect });
    viewPan.checked = false;
    viewPan.dispatchEvent({ type: 'change', target: viewPan });
    resetButton.dispatchEvent({ type: 'click' });
    defaultsButton.dispatchEvent({ type: 'click' });
    expect(applied[applied.length - 1]).to.eql({});
    enabledToggle.checked = true;
    enabledToggle.dispatchEvent({ type: 'change', target: enabledToggle });

    enabledToggle.checked = false;
    enabledToggle.dispatchEvent({ type: 'change', target: enabledToggle });
    expect(midiInputController.detached).to.equal(true);
    expect(clearedIntervals.length).to.be.at.least(2);
    expect(win.__LEMMINGS_MIDI_UI__).to.equal(undefined);

    while (timeouts.length) {
      timeouts.shift()();
    }

    webMidi.enabled = false;
    controller.setActiveMidiInput('in-1');
    controller.setActiveMidiOutput('out-1');

    webMidi.inputs = [];
    webMidi.outputs = [];
    webMidi.enabled = true;
    controller.onEnabled();
    controller.showError('nope');
    const errorText = doc.getElementById('errorDisplay').textContent;
    expect(errorText).to.contain('nope');
    controller.showError(null);
  });

  it('removes and restores MIDI UI hook when enabled state changes', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const enabledToggle = registerElement(doc, 'input', 'midiEnabledToggle');
    registerElement(doc, 'div', 'errorDisplay');
    win.localStorage.setItem('lemmings.midi.enabled', 'true');

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => ({})
    });
    controller.bindMidiUi();
    expect(win.__LEMMINGS_MIDI_UI__).to.be.ok;

    enabledToggle.checked = false;
    enabledToggle.dispatchEvent({ type: 'change', target: enabledToggle });
    expect(win.__LEMMINGS_MIDI_UI__).to.equal(undefined);

    enabledToggle.checked = true;
    enabledToggle.dispatchEvent({ type: 'change', target: enabledToggle });
    expect(win.__LEMMINGS_MIDI_UI__).to.be.ok;
  });

  it('disposes MIDI UI timers, hooks, device listeners, and bound DOM handlers', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const enabledToggle = registerElement(doc, 'input', 'midiEnabledToggle');
    registerElement(doc, 'div', 'errorDisplay');
    registerElement(doc, 'span', 'midiBpmCurrent');
    win.localStorage.setItem('lemmings.midi.enabled', 'true');
    const clearedIntervals = [];
    let nextIntervalId = 10;
    win.setInterval = () => nextIntervalId++;
    win.clearInterval = (id) => {
      clearedIntervals.push(id);
    };
    const removedDeviceEvents = [];
    const webMidi = {
      enabled: true,
      inputs: [{ id: 'in-1', name: 'Input 1' }],
      outputs: [{ id: 'out-1', name: 'Output 1' }],
      getInputById(id) {
        return this.inputs.find(input => input.id === id) || null;
      },
      getOutputById(id) {
        return this.outputs.find(output => output.id === id) || null;
      },
      addListener() {},
      removeListener(type) {
        removedDeviceEvents.push(type);
      }
    };
    const midiInputController = {
      detached: 0,
      captured: undefined,
      detach() {
        this.detached += 1;
      },
      attach() {},
      setNoteCapture(handler) {
        this.captured = handler;
      }
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getWebMidi: () => webMidi,
      getLemmings: () => ({})
    });
    controller.setMidiInputController(midiInputController);
    controller.bindMidiUi();
    controller.onEnabled();

    expect(win.__LEMMINGS_MIDI_UI__).to.be.ok;
    expect(enabledToggle.listeners.get('change')).to.have.length.greaterThan(0);

    controller.dispose();

    expect(win.__LEMMINGS_MIDI_UI__).to.equal(undefined);
    expect(enabledToggle.listeners.get('change')).to.have.lengthOf(0);
    expect(clearedIntervals).to.include.members([10, 11]);
    expect(removedDeviceEvents).to.include.members(['connected', 'disconnected', 'portschanged']);
    expect(midiInputController.detached).to.be.greaterThan(0);
    expect(midiInputController.captured).to.equal(null);
  });

  it('retries scheduled refresh after errors', function() {
    const doc = new TestDocument();
    const originalGet = doc.getElementById.bind(doc);
    let throwOnce = true;
    doc.getElementById = (id) => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error('boom');
      }
      return originalGet(id);
    };
    const win = createTestWindow();
    const timeouts = [];
    win.setTimeout = (cb) => {
      timeouts.push(cb);
      return timeouts.length;
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => ({ timing: { bpmBase: 120 } })
    });
    const errors = [];
    const restoreConsole = withConsoleStub({
      error: (...args) => errors.push(args)
    });

    try {
      controller.scheduleMidiUiRefresh();
      while (timeouts.length) {
        timeouts.shift()();
      }
      expect(errors.length).to.be.greaterThan(0);
    } finally {
      restoreConsole();
    }
  });

  it('logs refresh errors during bpm updates', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    registerElement(doc, 'span', 'midiBpmCurrent');
    let throwOnce = true;
    const originalGet = doc.getElementById.bind(doc);
    doc.getElementById = (id) => {
      if (id === 'midiEventList' && throwOnce) {
        throwOnce = false;
        throw new Error('boom');
      }
      return originalGet(id);
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => ({ timing: { bpmBase: 120 } })
    });
    const errors = [];
    const restoreConsole = withConsoleStub({
      error: (...args) => errors.push(args)
    });
    try {
      controller.bindMidiUi();
      expect(errors.length).to.be.greaterThan(0);
    } finally {
      restoreConsole();
    }
  });
});
