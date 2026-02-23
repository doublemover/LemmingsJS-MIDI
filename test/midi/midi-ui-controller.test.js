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

describe('midiUiController', function() {
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

  it('stores the input channel and updates overrides', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    registerElement(doc, 'input', 'midiEnabledToggle');
    const inputChannel = registerElement(doc, 'select', 'midiInputChannel');
    registerElement(doc, 'div', 'errorDisplay');

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => ({})
    });
    controller.bindMidiUi();

    inputChannel.value = '2';
    inputChannel.dispatchEvent({ type: 'change', target: inputChannel });

    expect(win.localStorage.getItem('lemmings.midi.inputChannel')).to.equal('2');
    expect(controller.getMidiOverrides().input.channel).to.equal(2);
  });

  it('resets stored overrides when schema hash changes', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    win.localStorage.setItem('lemmings.midi.overrides', JSON.stringify({ timing: { bpmBase: 90 } }));
    win.localStorage.setItem('lemmings.midi.schemaHash', 'old');
    const applied = [];
    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => ({
        getMidiSchemaHash: () => 'new',
        applyMidiOverrides(patch) { applied.push(patch); }
      })
    });

    controller.bindMidiUi();

    expect(win.localStorage.getItem('lemmings.midi.overrides')).to.equal(null);
    expect(win.localStorage.getItem('lemmings.midi.schemaHash')).to.equal('new');
    expect(controller.getMidiOverrides()).to.eql({});
    expect(applied).to.eql([{}]);
  });

  it('collapses the left panel when the MIDI title is clicked', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const panel = registerElement(doc, 'div', 'controlLeft');
    const toggle = registerElement(doc, 'div', 'midiPanelToggle');

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => ({})
    });

    controller.bindMidiUi();
    toggle.dispatchEvent({ type: 'click' });
    expect(panel.classList.contains('collapsed')).to.equal(true);
    expect(win.localStorage.getItem('lemmings.midi.panelCollapsed')).to.equal('true');
  });

  it('uses config defaults when storage is empty', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const viewPan = registerElement(doc, 'input', 'midiViewPanToggle');
    const inputChannel = registerElement(doc, 'select', 'midiInputChannel');

    const config = {
      position: { viewPan: true },
      input: { channel: 3 },
      timing: { bpmBase: 120 }
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => config
    });

    controller.bindMidiUi();
    controller.refreshMidiUiFromConfig();

    expect(viewPan.checked).to.equal(true);
    expect(inputChannel.value).to.equal('3');
    expect(win.localStorage.getItem('lemmings.midi.viewPan')).to.equal(null);
    expect(win.localStorage.getItem('lemmings.midi.inputChannel')).to.equal(null);
  });

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

  it('populates key, scale, and event lists with default data', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const keySelect = registerElement(doc, 'select', 'midiKeySelect');
    const scaleSelect = registerElement(doc, 'select', 'midiScaleSelect');
    const eventList = registerElement(doc, 'div', 'midiEventList');

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => ({ timing: { bpmBase: 120 }, sfx: {} })
    });

    controller.refreshMidiUiFromConfig();

    expect(keySelect.children.length).to.be.greaterThan(1);
    expect(scaleSelect.children.length).to.be.greaterThan(0);
    expect(eventList.children.length).to.be.greaterThan(0);
  });

  it('updates current bpm when base bpm changes', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const bpmBase = registerElement(doc, 'input', 'midiBpmBase');
    const bpmCurrent = registerElement(doc, 'span', 'midiBpmCurrent');
    registerElement(doc, 'input', 'midiEnabledToggle');
    registerElement(doc, 'div', 'errorDisplay');

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => ({ gameSpeedFactor: 2 }),
      getMidiConfig: () => ({ timing: { bpmBase: 120 } })
    });

    controller.bindMidiUi();
    bpmBase.value = '100';
    bpmBase.dispatchEvent({ type: 'input', target: bpmBase });

    expect(bpmCurrent.textContent).to.contain('2x 100 = 200 BPM');
  });

  it('populates position mapping defaults when ranges are missing', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const positionList = registerElement(doc, 'div', 'midiPositionList');

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => ({
        position: {
          mappings: [{ axis: 'x', target: 'pan' }],
          panRange: { min: -50, max: 50 }
        },
        timing: { bpmBase: 120 }
      })
    });

    controller.refreshMidiUiFromConfig();

    const rangeRow = findElement(positionList, el => (
      el.tagName === 'LABEL' && el.children?.[0]?.textContent === 'Min / Max'
    ));
    const rangeInputs = rangeRow?.children?.[1] || null;
    const minInput = rangeInputs?.children?.[0] || null;
    const maxInput = rangeInputs?.children?.[1] || null;
    expect(minInput).to.be.ok;
    expect(maxInput).to.be.ok;
    expect(minInput.value).to.equal('');
    expect(maxInput.value).to.equal('');
    expect(minInput.placeholder).to.equal('-50');
    expect(maxInput.placeholder).to.equal('50');
  });

  it('populates MIDI device selects and attaches inputs', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const inputSelect = registerElement(doc, 'select', 'midiInSelect');
    const outputSelect = registerElement(doc, 'select', 'midiOutSelect');
    registerElement(doc, 'input', 'midiViewPanToggle');
    registerElement(doc, 'select', 'midiInputChannel');
    registerElement(doc, 'div', 'errorDisplay');

    const inputDevice = { id: 'in-1', name: 'Input 1' };
    const outputDevice = { id: 'out-1', name: 'Output 1' };
    const webMidi = {
      enabled: true,
      inputs: [inputDevice],
      outputs: [outputDevice],
      getInputById(id) { return this.inputs.find(dev => dev.id === id); },
      getOutputById(id) { return this.outputs.find(dev => dev.id === id); }
    };

    let attached = null;
    const midiInputController = {
      attach(input) { attached = input; },
      detach() {}
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => ({}),
      getWebMidi: () => webMidi
    });
    controller.setMidiInputController(midiInputController);
    controller.onEnabled();

    expect(inputSelect.value).to.equal('in-1');
    expect(outputSelect.value).to.equal('out-1');
    expect(attached).to.equal(inputDevice);
  });

  it('supports map-based WebMIDI device collections', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const inputSelect = registerElement(doc, 'select', 'midiInSelect');
    const outputSelect = registerElement(doc, 'select', 'midiOutSelect');
    registerElement(doc, 'input', 'midiViewPanToggle');
    registerElement(doc, 'select', 'midiInputChannel');
    registerElement(doc, 'div', 'errorDisplay');

    const inputDevice = { id: 'in-1', name: 'Input 1' };
    const outputDevice = { id: 'out-1', name: 'Output 1' };
    const webMidi = {
      enabled: true,
      inputs: new Map([[inputDevice.id, inputDevice]]),
      outputs: new Map([[outputDevice.id, outputDevice]]),
      getInputById(id) { return this.inputs.get(id) || null; },
      getOutputById(id) { return this.outputs.get(id) || null; }
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => ({}),
      getWebMidi: () => webMidi
    });
    controller.onEnabled();

    expect(inputSelect.disabled).to.equal(false);
    expect(outputSelect.disabled).to.equal(false);
    expect(inputSelect.value).to.equal('in-1');
    expect(outputSelect.value).to.equal('out-1');
  });

  it('builds event lists and wires updates into overrides', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    registerElement(doc, 'select', 'midiKeySelect');
    registerElement(doc, 'select', 'midiScaleSelect');
    const eventList = registerElement(doc, 'div', 'midiEventList');
    const triggerList = registerElement(doc, 'div', 'midiTriggerList');
    registerElement(doc, 'select', 'midiEnvTarget');
    registerElement(doc, 'select', 'midiRepeatTarget');
    registerElement(doc, 'input', 'midiRepeatAmount');
    registerElement(doc, 'div', 'errorDisplay');

    const config = {
      scale: { name: 'minor', root: 2 },
      position: { mappings: [{ axis: 'x', target: 'note', min: -12, max: 12, enabled: true }] },
      velocityRange: { default: 90 },
      density: { velocityBoost: 0.2 },
      repeat: { maxRepeats: 2, spacingTicks: 3 },
      envelope: { attack: 1, decay: 0.2, sustain: 0.5, release: 1 },
      sfx: { '1': { note: 60, name: 'Test' } },
      triggers: { '1': { note: 62 } },
      timing: { bpmBase: 120 }
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => config
    });

    expect(controller.refreshMidiUiFromConfig()).to.equal(true);
    expect(eventList.children.length).to.equal(1);
    expect(triggerList.children.length).to.be.greaterThan(0);

    const notePicker = findRowInputByLabel(eventList.children[0], 'Keyboard');
    const keyButton = findElement(notePicker, el => (
      el.tagName === 'BUTTON' && el.dataset?.noteValue === '5'
    ));
    expect(notePicker).to.be.ok;
    expect(keyButton).to.be.ok;
    keyButton.dispatchEvent({ type: 'click', target: keyButton });
    expect(controller.getMidiOverrides().sfx['1'].note).to.equal(65);

    const triggerIndependent = findElement(triggerList, el => (
      el.tagName === 'SPAN' && el.textContent === 'Independent arp'
    ));
    const eventIndependent = findElement(eventList, el => (
      el.tagName === 'SPAN' && el.textContent === 'Independent arp'
    ));
    expect(triggerIndependent).to.be.ok;
    expect(eventIndependent).to.equal(null);
  });

  it('uses expressive mapping controls by default and exposes feature flags', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const eventList = registerElement(doc, 'div', 'midiEventList');
    registerElement(doc, 'div', 'midiTriggerList');
    registerElement(doc, 'select', 'midiEnvTarget');
    registerElement(doc, 'div', 'errorDisplay');

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => ({
        sfx: { '1': { note: 60 } },
        timing: { bpmBase: 120 }
      })
    });

    controller.refreshMidiUiFromConfig();
    const mapping = eventList.children[0];
    expect(findRowInputByLabel(mapping, 'Keyboard')).to.be.ok;
    expect(findRowInputByLabel(mapping, 'Key')).to.equal(null);
    expect(controller.getFeatureFlags().expressiveControls).to.equal(true);
  });

  it('falls back to legacy mapping controls when query flag is set', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    win.location = { search: '?mlc=true' };
    const eventList = registerElement(doc, 'div', 'midiEventList');
    registerElement(doc, 'div', 'midiTriggerList');
    registerElement(doc, 'select', 'midiEnvTarget');
    registerElement(doc, 'div', 'errorDisplay');

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => ({
        sfx: { '1': { note: 60 } },
        timing: { bpmBase: 120 }
      })
    });

    controller.refreshMidiUiFromConfig();
    const mapping = eventList.children[0];
    expect(findRowInputByLabel(mapping, 'Keyboard')).to.equal(null);
    expect(findRowInputByLabel(mapping, 'Key')).to.be.ok;
    expect(controller.getFeatureFlags().legacyControls).to.equal(true);
  });

  it('updates disabled toggles when re-enabled', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const eventList = registerElement(doc, 'div', 'midiEventList');
    registerElement(doc, 'select', 'midiEnvTarget');
    registerElement(doc, 'div', 'errorDisplay');

    const config = {
      sfx: { '1': { note: 60, disabled: true } },
      timing: { bpmBase: 120 }
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => config
    });

    controller.refreshMidiUiFromConfig();
    const enabledRow = findElement(eventList, el => (
      el.tagName === 'LABEL' && el.children?.[0]?.textContent === 'Enabled'
    ));
    const enabledToggle = enabledRow?.children?.[1] || null;
    expect(enabledToggle).to.be.ok;
    enabledToggle.checked = true;
    enabledToggle.dispatchEvent({ type: 'change', target: enabledToggle });
    expect(controller.getMidiOverrides().sfx['1'].disabled).to.equal(false);
  });

  it('updates repeat target and amount overrides', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const repeatTarget = registerElement(doc, 'select', 'midiRepeatTarget');
    const repeatAmount = registerElement(doc, 'input', 'midiRepeatAmount');
    const repeatSpacing = registerElement(doc, 'select', 'midiRepeatSpacing');
    const repeatCount = registerElement(doc, 'input', 'midiRepeatCount');

    const config = {
      repeat: { maxRepeats: 2, windowBeats: 0.5, target: 'note', amount: 0.25 },
      timing: { bpmBase: 120 }
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => config
    });

    controller.bindMidiUi();
    controller.refreshMidiUiFromConfig();
    expect(repeatTarget.value).to.equal('note');

    repeatTarget.value = 'velocity';
    repeatTarget.dispatchEvent({ type: 'change', target: repeatTarget });
    repeatAmount.value = '0.4';
    repeatAmount.dispatchEvent({ type: 'change', target: repeatAmount });
    repeatSpacing.value = '0.5';
    repeatSpacing.dispatchEvent({ type: 'change', target: repeatSpacing });
    repeatCount.value = '3';
    repeatCount.dispatchEvent({ type: 'change', target: repeatCount });

    const overrides = controller.getMidiOverrides();
    expect(overrides.repeat.target).to.equal('velocity');
    expect(overrides.repeat.amount).to.equal(0.4);
    expect(overrides.repeat.windowBeats).to.equal(0.5);
    expect(overrides.repeat.maxRepeats).to.equal(3);
  });

  it('updates ADSR overrides for selected targets', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const envTarget = registerElement(doc, 'select', 'midiEnvTarget');
    const envAttack = registerElement(doc, 'input', 'midiEnvAttack');
    const envDecay = registerElement(doc, 'input', 'midiEnvDecay');
    const envSustain = registerElement(doc, 'input', 'midiEnvSustain');
    const envRelease = registerElement(doc, 'input', 'midiEnvRelease');
    registerElement(doc, 'div', 'midiEventList');
    registerElement(doc, 'div', 'midiTriggerList');

    const config = {
      envelope: { attack: 0.5, decay: 0.2, sustain: 1, release: 0.8 },
      sfx: { '1': { name: 'Test', envelope: { attack: 1.5 } } },
      triggers: { '5': { envelope: { release: 0.3 } } },
      timing: { bpmBase: 120 }
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => config
    });

    controller.bindMidiUi();
    controller.refreshMidiUiFromConfig();
    expect(envTarget.value).to.equal('global');
    expect(envAttack.value).to.equal('0.5');

    envTarget.value = 'sfx:1';
    envTarget.dispatchEvent({ type: 'change', target: envTarget });
    expect(win.localStorage.getItem('lemmings.midi.adsrTarget')).to.equal('sfx:1');
    expect(envAttack.value).to.equal('1.5');

    envAttack.value = '1.2';
    envAttack.dispatchEvent({ type: 'change', target: envAttack });
    expect(controller.getMidiOverrides().sfx['1'].envelope.attack).to.equal(1.2);

    envTarget.value = 'trigger:5';
    envTarget.dispatchEvent({ type: 'change', target: envTarget });
    expect(envRelease.value).to.equal('0.3');
    envAttack.value = '0.8';
    envAttack.dispatchEvent({ type: 'change', target: envAttack });
    expect(controller.getMidiOverrides().triggers['5'].envelope.attack).to.equal(0.8);

    envTarget.value = 'global';
    envTarget.dispatchEvent({ type: 'change', target: envTarget });
    envAttack.value = '0.7';
    envAttack.dispatchEvent({ type: 'change', target: envAttack });
    expect(controller.getMidiOverrides().envelope.attack).to.equal(0.7);

    envTarget.value = 'nonsense';
    envTarget.dispatchEvent({ type: 'change', target: envTarget });
    expect(envAttack.value).to.equal('0.5');
  });

  it('filters events and triggers based on level context', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const eventList = registerElement(doc, 'div', 'midiEventList');
    const triggerList = registerElement(doc, 'div', 'midiTriggerList');
    registerElement(doc, 'select', 'midiEnvTarget');
    registerElement(doc, 'div', 'errorDisplay');

    const skills = {
      cheatMode: false,
      skills: [0, 0, 0, 0, 0, 1, 0, 0, 0],
      getSkill(type) { return type === SkillTypes.BUILDER ? 1 : 0; }
    };
    const level = {
      triggers: [{ type: TriggerTypes.DROWN, disableTicksCount: 0 }],
      steelRanges: new Int32Array(0),
      arrowRanges: new Int32Array(0)
    };
    const lemmings = { game: { level, getGameSkills() { return skills; } } };

    const config = {
      sfx: {
        [SoundEffectIds.SKILL_SELECT]: { name: 'skill-select' },
        [SoundEffectIds.BUILDER_STEP]: { name: 'builder-step' },
        [SoundEffectIds.STEEL_HIT]: { name: 'steel-hit' },
        [SoundEffectIds.DROWN]: { name: 'drown' }
      },
      triggers: { '5': { note: 60 } },
      timing: { bpmBase: 120 }
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => lemmings,
      getMidiConfig: () => config
    });

    controller.refreshMidiUiFromConfig();
    expect(eventList.children.length).to.equal(3);
    expect(triggerList.children.length).to.equal(1);
  });

  it('reads stored enabled state and storage keys', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    win.localStorage.setItem('lemmings.midi.enabled', 'false');

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => ({ enabled: true })
    });

    expect(controller.getStoredEnabled()).to.equal(false);
    win.localStorage.removeItem('lemmings.midi.enabled');
    expect(controller.getStoredEnabled()).to.equal(true);

    const fallback = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => ({})
    });

    expect(fallback.getStoredEnabled()).to.equal(false);
    expect(controller.getStorageKeys()).to.have.property('enabled');
  });

  it('uses lemmings base config when no provider is supplied', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const baseConfig = { timing: { bpmBase: 110 } };
    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => ({ getMidiBaseConfig: () => baseConfig })
    });

    expect(controller.getMidiConfig()).to.equal(baseConfig);
  });

  it('drops invalid stored overrides', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    win.localStorage.setItem('lemmings.midi.overrides', JSON.stringify(['bad']));

    const controller = createMidiUiController({
      document: doc,
      window: win
    });

    expect(controller.getMidiOverrides()).to.eql({});
  });

  it('applies stored section states via test hook', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    installRichSelectors(doc);
    const section = doc.createElement('details');
    section.dataset.sectionKey = 'alpha';
    section.setAttribute = (name, value) => section.attributes.set(name, value);
    section.hasAttribute = (name) => section.attributes.has(name);
    section.setAttribute('open', '');
    section.open = true;
    win.localStorage.setItem('lemmings.midi.sectionStates', JSON.stringify({ alpha: false }));

    const controller = createMidiUiController({
      document: doc,
      window: win
    });

    controller.__test__.applySectionStates({ useStored: true });
    expect(section.dataset.defaultOpen).to.equal('true');
    expect(section.open).to.equal(false);
  });

  it('clears schema hash when reset defaults does not persist', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const lemmings = { applyMidiOverrides() {}, getMidiSchemaHash: () => 'hash' };
    win.localStorage.setItem('lemmings.midi.schemaHash', 'old');

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getLemmings: () => lemmings
    });

    controller.__test__.resetMidiDefaults(false);
    expect(win.localStorage.getItem('lemmings.midi.schemaHash')).to.equal(null);
  });

  it('persists tab and section state and resets on input change', function() {
    const doc = new TestDocument();
    installRichSelectors(doc);
    doc.body = doc.createElement('body');
    const win = createTestWindow();
    registerElement(doc, 'input', 'midiEnabledToggle');
    const inputSelect = registerElement(doc, 'select', 'midiInSelect');
    registerElement(doc, 'select', 'midiInputChannel');
    registerElement(doc, 'div', 'controlLeft');
    registerElement(doc, 'div', 'midiPanelToggle');
    registerElement(doc, 'div', 'midiEventList');
    registerElement(doc, 'div', 'midiTriggerList');
    registerElement(doc, 'select', 'midiEnvTarget');
    registerElement(doc, 'div', 'errorDisplay');

    const sectionA = doc.createElement('details');
    sectionA.dataset.sectionKey = 'a';
    sectionA.open = true;
    sectionA.setAttribute = (name, value) => sectionA.attributes.set(name, value);
    sectionA.hasAttribute = (name) => sectionA.attributes.has(name);
    sectionA.setAttribute('open', '');

    const sectionB = doc.createElement('details');
    sectionB.dataset.sectionKey = 'b';
    sectionB.open = false;
    sectionB.setAttribute = (name, value) => sectionB.attributes.set(name, value);
    sectionB.hasAttribute = (name) => sectionB.attributes.has(name);

    const buttonA = registerElement(doc, 'button', 'tabA', 'tab-button');
    buttonA.dataset.tabGroup = 'midi-left';
    buttonA.dataset.tabTarget = 'panelA';
    const buttonB = registerElement(doc, 'button', 'tabB', 'tab-button');
    buttonB.dataset.tabGroup = 'midi-left';
    buttonB.dataset.tabTarget = 'panelB';
    const panelA = registerElement(doc, 'div', 'panelA', 'tab-panel');
    panelA.dataset.tabGroup = 'midi-left';
    const panelB = registerElement(doc, 'div', 'panelB', 'tab-panel');
    panelB.dataset.tabGroup = 'midi-left';

    win.localStorage.setItem('lemmings.midi.tabLeft', 'panelB');
    win.localStorage.setItem('lemmings.midi.sectionStates', JSON.stringify({ a: false, b: true }));

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => ({ timing: { bpmBase: 120 } })
    });

    controller.bindMidiUi();
    expect(buttonB.classList.contains('active')).to.equal(true);
    expect(panelB.classList.contains('active')).to.equal(true);
    expect(sectionA.open).to.equal(false);
    expect(sectionB.open).to.equal(true);

    sectionA.open = true;
    sectionA.dispatchEvent({ type: 'toggle' });
    expect(JSON.parse(win.localStorage.getItem('lemmings.midi.sectionStates')).a).to.equal(true);

    buttonA.dispatchEvent({ type: 'click' });
    expect(win.localStorage.getItem('lemmings.midi.tabLeft')).to.equal('panelA');

    inputSelect.value = 'device';
    inputSelect.dispatchEvent({ type: 'change', target: inputSelect });
    expect(win.localStorage.getItem('lemmings.midi.tabLeft')).to.equal(null);
    expect(win.localStorage.getItem('lemmings.midi.sectionStates')).to.equal(null);
  });

  it('captures notes and updates mapping entries', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const eventList = registerElement(doc, 'div', 'midiEventList');
    registerElement(doc, 'div', 'midiTriggerList');
    registerElement(doc, 'select', 'midiEnvTarget');
    registerElement(doc, 'div', 'errorDisplay');

    const trapId = SoundEffectIds.TRAP_ZAP;
    const config = {
      scale: { name: 'major', root: 0, degrees: [0, 2, 4, 5, 7, 9, 11] },
      sfx: {
        [trapId]: {
          name: 'Trap',
          degree: 1,
          octave: 2,
          arp: { enabled: true, mode: 'up', length: 2, independent: true },
          priority: 2
        }
      },
      triggers: { '1': { note: 60 } },
      timing: { bpmBase: 120 }
    };

    let noteCaptureHandler = null;
    const midiInputController = {
      setNoteCapture(handler) {
        noteCaptureHandler = handler;
      }
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => config
    });

    controller.setMidiInputController(midiInputController);
    controller.refreshMidiUiFromConfig();

    const mapping = eventList.children[0];
    const summary = findElement(mapping, el => el.tagName === 'SUMMARY');
    const enabledToggle = findElement(mapping, el => (
      el.tagName === 'INPUT' && el.type === 'checkbox'
    ));
    const enabledLabel = findElement(mapping, el => el.className === 'panel-title-toggle');
    summary.dispatchEvent({ type: 'click', target: enabledToggle, preventDefault() {} });
    summary.dispatchEvent({ type: 'click', target: summary.children[0], preventDefault() {} });
    enabledLabel.dispatchEvent({ type: 'click', stopPropagation() {} });
    enabledToggle.dispatchEvent({ type: 'click', stopPropagation() {} });

    const modeSelect = findRowInputByLabel(mapping, 'Mode');
    const keyboardPicker = findRowInputByLabel(mapping, 'Keyboard');
    const keyButton = findElement(keyboardPicker, el => (
      el.tagName === 'BUTTON' && el.dataset?.noteValue === '0'
    ));
    const degreeInput = findRowInputByLabel(mapping, 'Degree');
    const scaleOctave = findRowInputByLabel(mapping, 'Scale octave');
    const chordSelect = findRowInputByLabel(mapping, 'Chord');
    const arpToggle = findRowInputByLabel(mapping, 'Arp');
    const arpPreset = findRowInputByLabel(mapping, 'Arp preset');
    const arpDownPreset = findElement(arpPreset, el => (
      el.tagName === 'BUTTON' && el.dataset?.value === 'down'
    ));
    const arpLength = findRowInputByLabel(mapping, 'Arp length');
    const arpIndependent = findRowInputByLabel(mapping, 'Independent arp');
    const priorityInput = findRowInputByLabel(mapping, 'Priority');
    expect(keyboardPicker).to.be.ok;
    expect(keyButton).to.be.ok;
    expect(arpDownPreset).to.be.ok;

    keyButton.focus = () => keyButton.dispatchEvent({ type: 'focus', target: keyButton });
    degreeInput.focus = () => degreeInput.dispatchEvent({ type: 'focus', target: degreeInput });
    const keyboardRow = findElement(mapping, el => (
      el.tagName === 'LABEL' && el.children?.[0]?.textContent === 'Keyboard'
    ));
    keyboardRow?.children?.[0]?.dispatchEvent({
      type: 'click',
      preventDefault() {},
      stopPropagation() {}
    });

    modeSelect.value = 'degree';
    modeSelect.dispatchEvent({ type: 'change', target: modeSelect });
    degreeInput.dispatchEvent({ type: 'focus', target: degreeInput });
    expect(noteCaptureHandler).to.be.a('function');
    noteCaptureHandler(61);

    modeSelect.value = 'note';
    modeSelect.dispatchEvent({ type: 'change', target: modeSelect });
    keyButton.dispatchEvent({ type: 'focus', target: keyButton });
    expect(noteCaptureHandler).to.be.a('function');
    noteCaptureHandler(60);
    degreeInput.dispatchEvent({ type: 'focus', target: degreeInput });
    degreeInput.dispatchEvent({ type: 'blur', target: degreeInput });

    config.scale.degrees = null;
    modeSelect.value = 'degree';
    modeSelect.dispatchEvent({ type: 'change', target: modeSelect });
    degreeInput.dispatchEvent({ type: 'focus', target: degreeInput });
    expect(noteCaptureHandler).to.be.a('function');
    noteCaptureHandler(62);

    modeSelect.value = 'chord';
    modeSelect.dispatchEvent({ type: 'change', target: modeSelect });
    chordSelect.value = 'seventh';
    chordSelect.dispatchEvent({ type: 'change', target: chordSelect });

    arpToggle.checked = true;
    arpDownPreset.dispatchEvent({ type: 'click', target: arpDownPreset });
    arpLength.value = '4';
    arpIndependent.checked = true;
    priorityInput.value = '3';
    enabledToggle.checked = false;
    [arpToggle, arpLength, arpIndependent, priorityInput, enabledToggle]
      .forEach(el => el.dispatchEvent({ type: 'change', target: el }));

    expect(controller.getMidiOverrides().sfx[trapId].priority).to.equal(3);
    expect(controller.getMidiOverrides().sfx[trapId].disabled).to.equal(true);
    expect(noteCaptureHandler).to.equal(null);
  });

  it('updates position mappings and defaults', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const positionList = registerElement(doc, 'div', 'midiPositionList');
    const positionAdd = registerElement(doc, 'button', 'midiPositionAdd');
    const intensity = registerRangeInput(doc, 'midiIntensity');
    const accent = registerRangeInput(doc, 'midiAccent');
    const repeatEnabled = registerElement(doc, 'input', 'midiRepeatEnabled');
    const repeatSection = registerElement(doc, 'details', 'midiRepeatSection');
    repeatSection.dataset.sectionKey = 'repeat';
    const repeatCount = registerElement(doc, 'input', 'midiRepeatCount');
    const repeatSpacing = registerElement(doc, 'select', 'midiRepeatSpacing');
    const repeatTarget = registerElement(doc, 'select', 'midiRepeatTarget');
    const repeatAmount = registerElement(doc, 'input', 'midiRepeatAmount');
    const keySelect = registerElement(doc, 'select', 'midiKeySelect');
    const scaleSelect = registerElement(doc, 'select', 'midiScaleSelect');
    registerElement(doc, 'div', 'midiEventList');
    registerElement(doc, 'div', 'midiTriggerList');
    registerElement(doc, 'select', 'midiEnvTarget');
    registerElement(doc, 'div', 'errorDisplay');

    const config = {
      position: {
        xNoteRange: { min: 1, max: 12 },
        panRange: { min: -1, max: 1 },
        timbreRange: { min: 10, max: 100 },
        mappings: [
          { axis: 'x', target: 'note', min: 1, max: 12 },
          { axis: 'y', target: 'velocity' },
          { axis: 'xy', target: 'timbre' },
          { axis: 'x', axisX: false, axisY: false, target: 'pan' },
          { axis: 'x', target: 'duration' },
          { axis: 'x', target: 'pitchBend' },
          { axis: 'x', target: 'attack' },
          { axis: 'x', target: 'sustain' },
          { axis: 'x', target: 'unknown' }
        ]
      },
      velocityRange: { min: 2, max: 120, default: 80 },
      repeat: { windowBeats: 0.3 },
      durationTicks: { min: 2, max: 16 },
      timing: { bpmBase: 120 }
    };

    let throwRefresh = false;
    const originalGet = doc.getElementById.bind(doc);
    doc.getElementById = (id) => {
      if (throwRefresh && id === 'midiEventList') {
        throw new Error('boom');
      }
      return originalGet(id);
    };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => config
    });
    const errors = [];
    const restoreConsole = withConsoleStub({
      error: (...args) => errors.push(args)
    });

    try {
      controller.bindMidiUi();
      controller.refreshMidiUiFromConfig();
      controller.refreshMidiUiFromConfig();
      expect(repeatSpacing.children.some(child => child.value === '0.3')).to.equal(true);
      accent.input.value = '0.4';
      accent.input.dispatchEvent({ type: 'change', target: accent.input });
      intensity.input.value = '75';
      intensity.input.dispatchEvent({ type: 'change', target: intensity.input });
      keySelect.value = '5';
      keySelect.dispatchEvent({ type: 'change', target: keySelect });
      scaleSelect.value = 'major';
      scaleSelect.dispatchEvent({ type: 'change', target: scaleSelect });
      repeatTarget.value = 'duration';
      repeatTarget.dispatchEvent({ type: 'change', target: repeatTarget });
      repeatAmount.value = '0.5';
      repeatAmount.dispatchEvent({ type: 'change', target: repeatAmount });
      repeatCount.value = '2';
      repeatCount.dispatchEvent({ type: 'change', target: repeatCount });
      const firstMapping = positionList.children[0];
      const axisX = findElement(firstMapping, el => (
        el.tagName === 'LABEL' && el.children?.[1]?.textContent === 'X'
      ))?.children?.[0];
      const axisY = findElement(firstMapping, el => (
        el.tagName === 'LABEL' && el.children?.[1]?.textContent === 'Y'
      ))?.children?.[0];
      const axisOp = findElement(firstMapping, el => (
        el.tagName === 'SELECT' && el.children?.[0]?.textContent === '+'
      ));
      const targetSelect = findElement(firstMapping, el => (
        el.tagName === 'SELECT' &&
        Array.from(el.children || []).some(child => child.textContent === 'Note offset')
      ));
      const minInput = findElement(firstMapping, el => (
        el.tagName === 'INPUT' && el.type === 'number'
      ));
      const maxInput = findElement(firstMapping, el => (
        el.tagName === 'INPUT' && el.type === 'number' && el !== minInput
      ));
      const removeButton = findElement(firstMapping, el => (
        el.tagName === 'BUTTON' && el.textContent === 'Remove'
      ));

      axisX.checked = false;
      axisY.checked = false;
      axisX.dispatchEvent({ type: 'change', target: axisX });
      axisY.dispatchEvent({ type: 'change', target: axisY });
      axisOp.value = 'sub';
      axisOp.dispatchEvent({ type: 'change', target: axisOp });
      targetSelect.value = 'pan';
      targetSelect.dispatchEvent({ type: 'change', target: targetSelect });
      minInput.value = '4';
      maxInput.value = '8';
      maxInput.dispatchEvent({ type: 'change', target: maxInput });
      minInput.value = '';
      maxInput.value = '';
      minInput.dispatchEvent({ type: 'change', target: minInput });
      throwRefresh = true;
      removeButton.dispatchEvent({ type: 'click', target: removeButton });
      throwRefresh = false;

      repeatEnabled.checked = true;
      repeatEnabled.dispatchEvent({ type: 'click', stopPropagation() {} });
      repeatEnabled.dispatchEvent({ type: 'change', target: repeatEnabled });

      throwRefresh = true;
      positionAdd.dispatchEvent({ type: 'click' });
      throwRefresh = false;
      const overrides = controller.getMidiOverrides();
      expect(overrides.position.mappings[overrides.position.mappings.length - 1].min).to.equal(1);
      expect(errors.length).to.be.greaterThan(0);
    } finally {
      restoreConsole();
    }
  });

  it('builds axis defaults from explicit position mappings', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const positionList = registerElement(doc, 'div', 'midiPositionList');
    registerElement(doc, 'select', 'midiKeySelect');
    registerElement(doc, 'select', 'midiScaleSelect');
    registerElement(doc, 'div', 'midiEventList');
    registerElement(doc, 'div', 'midiTriggerList');
    registerElement(doc, 'select', 'midiEnvTarget');
    registerElement(doc, 'div', 'errorDisplay');

    const config = { timing: { bpmBase: 120 } };

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => config
    });

    controller.__test__.buildPositionMappingList(positionList, [
      { axis: 'xy', target: 'velocity' },
      { axis: 'y', target: 'note' },
      { axis: 'x', target: 'pan' }
    ], config);
    expect(positionList.children.length).to.be.greaterThan(0);
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
    const errorText = doc.getElementById('errorDisplay').innerHTML;
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
    expect(win.__LEMMINGS_MIDI_UI__.getFeatureFlags()).to.have.property('legacyControls');
    const previewResult = win.__LEMMINGS_MIDI_UI__.auditionMapping({ targetKey: 'sfx', id: 1 });
    expect(previewResult).to.equal(false);
  });
});

