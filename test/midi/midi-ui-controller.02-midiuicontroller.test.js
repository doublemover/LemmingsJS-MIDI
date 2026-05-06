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

describe('midiUiController 2', function() {
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
});
