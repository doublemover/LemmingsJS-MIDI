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

describe('midiUiController 3', function() {
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
});
