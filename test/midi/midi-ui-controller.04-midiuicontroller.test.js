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

describe('midiUiController 4', function() {
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
});
