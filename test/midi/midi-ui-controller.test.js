import { expect } from 'chai';
import { createMidiUiController } from '../../js/app/midiUiController.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { SkillTypes } from '../../js/game/SkillTypes.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';
import { TestDocument, TestElement, createTestWindow } from '../helpers/test-dom.js';

const register = (doc, tag, id, className = '') => {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  doc.registerElement(id, el);
  return el;
};

if (!TestElement.prototype.contains) {
  TestElement.prototype.contains = function(target) {
    if (!target) return false;
    if (target === this) return true;
    return (this.children || []).some(child => (
      typeof child.contains === 'function' ? child.contains(target) : child === target
    ));
  };
}

const findElement = (root, predicate) => {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
};

const findRowInputByLabel = (root, labelText) => {
  const row = findElement(root, el => (
    el.tagName === 'LABEL' && el.children?.[0]?.textContent === labelText
  ));
  return row?.children?.[1] || null;
};

const setupRichSelectors = (doc) => {
  doc.querySelectorAll = (selector) => {
    const all = doc._all || [];
    if (selector === 'details[data-section-key]') {
      return all.filter(el => el.tagName === 'DETAILS' && el.dataset?.sectionKey);
    }
    const tabMatch = selector.match(/^\.(tab-button|tab-panel)\[data-tab-group(?:="([^"]*)")?\]$/);
    if (tabMatch) {
      const className = tabMatch[1];
      const group = tabMatch[2];
      return all.filter(el => (
        el.classList?.contains(className) &&
        el.dataset?.tabGroup &&
        (!group || el.dataset.tabGroup === group)
      ));
    }
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return all.filter(el => el.classList?.contains(className));
    }
    return [];
  };
};

const registerRangeInput = (doc, id) => {
  const wrapper = doc.createElement('div');
  const minLabel = doc.createElement('span');
  minLabel.className = 'range-label';
  const input = doc.createElement('input');
  const maxLabel = doc.createElement('span');
  maxLabel.className = 'range-label';
  wrapper.appendChild(minLabel);
  wrapper.appendChild(input);
  wrapper.appendChild(maxLabel);
  doc.registerElement(id, input);
  return { wrapper, input, minLabel, maxLabel };
};

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

describe('midiUiController', function() {
  it('persists the enabled toggle and disables controls', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const enabledToggle = register(doc, 'input', 'midiEnabledToggle');
    const inputSelect = register(doc, 'select', 'midiInSelect');
    const outputSelect = register(doc, 'select', 'midiOutSelect');
    const inputChannel = register(doc, 'select', 'midiInputChannel');
    const resetButton = register(doc, 'button', 'midiResetButton');
    const viewPan = register(doc, 'input', 'midiViewPanToggle');
    register(doc, 'div', 'errorDisplay');

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
    register(doc, 'input', 'midiEnabledToggle');
    const inputChannel = register(doc, 'select', 'midiInputChannel');
    register(doc, 'div', 'errorDisplay');

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
    const panel = register(doc, 'div', 'controlLeft');
    const toggle = register(doc, 'div', 'midiPanelToggle');

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
    const viewPan = register(doc, 'input', 'midiViewPanToggle');
    const inputChannel = register(doc, 'select', 'midiInputChannel');

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

  it('shows omni when input channel defaults to omni', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const inputChannel = register(doc, 'select', 'midiInputChannel');

    const controller = createMidiUiController({
      document: doc,
      window: win,
      getMidiConfig: () => ({ input: { channel: 'omni' }, timing: { bpmBase: 120 } })
    });

    controller.refreshMidiUiFromConfig();
    expect(inputChannel.value).to.equal('omni');
  });

  it('populates key, scale, and event lists with default data', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const keySelect = register(doc, 'select', 'midiKeySelect');
    const scaleSelect = register(doc, 'select', 'midiScaleSelect');
    const eventList = register(doc, 'div', 'midiEventList');

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
    const bpmBase = register(doc, 'input', 'midiBpmBase');
    const bpmCurrent = register(doc, 'span', 'midiBpmCurrent');
    register(doc, 'input', 'midiEnabledToggle');
    register(doc, 'div', 'errorDisplay');

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
    const positionList = register(doc, 'div', 'midiPositionList');

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
    const inputSelect = register(doc, 'select', 'midiInSelect');
    const outputSelect = register(doc, 'select', 'midiOutSelect');
    register(doc, 'input', 'midiViewPanToggle');
    register(doc, 'select', 'midiInputChannel');
    register(doc, 'div', 'errorDisplay');

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

  it('builds event lists and wires updates into overrides', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    register(doc, 'select', 'midiKeySelect');
    register(doc, 'select', 'midiScaleSelect');
    const eventList = register(doc, 'div', 'midiEventList');
    const triggerList = register(doc, 'div', 'midiTriggerList');
    register(doc, 'select', 'midiEnvTarget');
    register(doc, 'select', 'midiRepeatTarget');
    register(doc, 'input', 'midiRepeatAmount');
    register(doc, 'div', 'errorDisplay');

    const config = {
      scale: { name: 'minor', root: 2 },
      position: { xToNote: true, yToVelocity: false, yToTimbre: false },
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

    const keySelect = findElement(eventList.children[0], el => {
      if (el.tagName !== 'SELECT') return false;
      return (el.children || []).some(child => child.textContent === 'C');
    });
    const noteOctave = findElement(eventList.children[0], el => (
      el.tagName === 'INPUT' && el.type === 'number' && el.max === '9' && !el.disabled
    ));
    expect(keySelect).to.be.ok;
    expect(noteOctave).to.be.ok;
    keySelect.value = '5';
    noteOctave.value = '5';
    noteOctave.dispatchEvent({ type: 'change', target: noteOctave });
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

  it('updates disabled toggles when re-enabled', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const eventList = register(doc, 'div', 'midiEventList');
    register(doc, 'select', 'midiEnvTarget');
    register(doc, 'div', 'errorDisplay');

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
    const repeatTarget = register(doc, 'select', 'midiRepeatTarget');
    const repeatAmount = register(doc, 'input', 'midiRepeatAmount');
    const repeatSpacing = register(doc, 'select', 'midiRepeatSpacing');
    const repeatCount = register(doc, 'input', 'midiRepeatCount');

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
    const envTarget = register(doc, 'select', 'midiEnvTarget');
    const envAttack = register(doc, 'input', 'midiEnvAttack');
    const envDecay = register(doc, 'input', 'midiEnvDecay');
    const envSustain = register(doc, 'input', 'midiEnvSustain');
    const envRelease = register(doc, 'input', 'midiEnvRelease');
    register(doc, 'div', 'midiEventList');
    register(doc, 'div', 'midiTriggerList');

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
    const eventList = register(doc, 'div', 'midiEventList');
    const triggerList = register(doc, 'div', 'midiTriggerList');
    register(doc, 'select', 'midiEnvTarget');
    register(doc, 'div', 'errorDisplay');

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
    setupRichSelectors(doc);
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
    setupRichSelectors(doc);
    doc.body = doc.createElement('body');
    const win = createTestWindow();
    register(doc, 'input', 'midiEnabledToggle');
    const inputSelect = register(doc, 'select', 'midiInSelect');
    register(doc, 'select', 'midiInputChannel');
    register(doc, 'div', 'controlLeft');
    register(doc, 'div', 'midiPanelToggle');
    register(doc, 'div', 'midiEventList');
    register(doc, 'div', 'midiTriggerList');
    register(doc, 'select', 'midiEnvTarget');
    register(doc, 'div', 'errorDisplay');

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

    const buttonA = register(doc, 'button', 'tabA', 'tab-button');
    buttonA.dataset.tabGroup = 'midi-left';
    buttonA.dataset.tabTarget = 'panelA';
    const buttonB = register(doc, 'button', 'tabB', 'tab-button');
    buttonB.dataset.tabGroup = 'midi-left';
    buttonB.dataset.tabTarget = 'panelB';
    const panelA = register(doc, 'div', 'panelA', 'tab-panel');
    panelA.dataset.tabGroup = 'midi-left';
    const panelB = register(doc, 'div', 'panelB', 'tab-panel');
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
    const eventList = register(doc, 'div', 'midiEventList');
    register(doc, 'div', 'midiTriggerList');
    register(doc, 'select', 'midiEnvTarget');
    register(doc, 'div', 'errorDisplay');

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
    const keySelect = findRowInputByLabel(mapping, 'Key');
    const noteOctave = findRowInputByLabel(mapping, 'Octave');
    const degreeInput = findRowInputByLabel(mapping, 'Degree');
    const scaleOctave = findRowInputByLabel(mapping, 'Scale octave');
    const chordSelect = findRowInputByLabel(mapping, 'Chord');
    const arpToggle = findRowInputByLabel(mapping, 'Arp');
    const arpMode = findRowInputByLabel(mapping, 'Arp mode');
    const arpLength = findRowInputByLabel(mapping, 'Arp length');
    const arpIndependent = findRowInputByLabel(mapping, 'Independent arp');
    const priorityInput = findRowInputByLabel(mapping, 'Priority');

    noteOctave.focus = () => noteOctave.dispatchEvent({ type: 'focus', target: noteOctave });
    degreeInput.focus = () => degreeInput.dispatchEvent({ type: 'focus', target: degreeInput });
    keySelect.focus = () => keySelect.dispatchEvent({ type: 'focus', target: keySelect });
    const keyRow = findElement(mapping, el => (
      el.tagName === 'LABEL' && el.children?.[0]?.textContent === 'Key'
    ));
    keyRow?.children?.[0]?.dispatchEvent({
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
    keySelect.dispatchEvent({ type: 'focus', target: keySelect });
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
    arpMode.value = 'down';
    arpLength.value = '4';
    arpIndependent.checked = true;
    priorityInput.value = '3';
    enabledToggle.checked = false;
    [arpToggle, arpMode, arpLength, arpIndependent, priorityInput, enabledToggle]
      .forEach(el => el.dispatchEvent({ type: 'change', target: el }));

    expect(controller.getMidiOverrides().sfx[trapId].priority).to.equal(3);
    expect(controller.getMidiOverrides().sfx[trapId].disabled).to.equal(true);
    expect(noteCaptureHandler).to.equal(null);
  });

  it('updates position mappings and defaults', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const positionList = register(doc, 'div', 'midiPositionList');
    const positionAdd = register(doc, 'button', 'midiPositionAdd');
    const intensity = registerRangeInput(doc, 'midiIntensity');
    const accent = registerRangeInput(doc, 'midiAccent');
    const repeatEnabled = register(doc, 'input', 'midiRepeatEnabled');
    const repeatSection = register(doc, 'details', 'midiRepeatSection');
    repeatSection.dataset.sectionKey = 'repeat';
    const repeatCount = register(doc, 'input', 'midiRepeatCount');
    const repeatSpacing = register(doc, 'select', 'midiRepeatSpacing');
    const repeatTarget = register(doc, 'select', 'midiRepeatTarget');
    const repeatAmount = register(doc, 'input', 'midiRepeatAmount');
    const keySelect = register(doc, 'select', 'midiKeySelect');
    const scaleSelect = register(doc, 'select', 'midiScaleSelect');
    register(doc, 'div', 'midiEventList');
    register(doc, 'div', 'midiTriggerList');
    register(doc, 'select', 'midiEnvTarget');
    register(doc, 'div', 'errorDisplay');

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
  });

  it('builds axis defaults from legacy position flags', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const positionList = register(doc, 'div', 'midiPositionList');
    register(doc, 'select', 'midiKeySelect');
    register(doc, 'select', 'midiScaleSelect');
    register(doc, 'div', 'midiEventList');
    register(doc, 'div', 'midiTriggerList');
    register(doc, 'select', 'midiEnvTarget');
    register(doc, 'div', 'errorDisplay');

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
    setupRichSelectors(doc);
    doc.body = doc.createElement('body');
    const win = createTestWindow();
    const intervals = [];
    const timeouts = [];
    const dispatched = [];
    win.setInterval = (cb) => {
      intervals.push(cb);
      return intervals.length;
    };
    win.setTimeout = (cb) => {
      timeouts.push(cb);
      return timeouts.length;
    };
    win.dispatchEvent = (event) => dispatched.push(event.type);

    const enabledToggle = register(doc, 'input', 'midiEnabledToggle');
    const inputSelect = register(doc, 'select', 'midiInSelect');
    const outputSelect = register(doc, 'select', 'midiOutSelect');
    const inputChannel = register(doc, 'select', 'midiInputChannel');
    const viewPan = register(doc, 'input', 'midiViewPanToggle');
    const resetButton = register(doc, 'button', 'midiResetButton');
    const defaultsButton = register(doc, 'button', 'midiDefaultsButton');
    const panelToggle = register(doc, 'div', 'midiPanelToggle');
    const leftPanel = register(doc, 'div', 'controlLeft');
    const bpmBase = register(doc, 'input', 'midiBpmBase');
    const bpmCurrent = register(doc, 'span', 'midiBpmCurrent');
    const debugInput = register(doc, 'span', 'midiDebugInput');
    const debugOutput = register(doc, 'span', 'midiDebugOutput');
    register(doc, 'div', 'errorDisplay');

    win.localStorage.setItem('lemmings.midi.viewPan', 'true');
    win.localStorage.setItem('lemmings.midi.inputId', 'missing');
    win.localStorage.setItem('lemmings.midi.outputId', 'out-2');
    win.localStorage.setItem('lemmings.midi.inputChannel', '2');

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
    expect(globalThis.lemmingsMidiViewPan).to.equal(true);
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

    controller.scheduleMidiUiRefresh();
    while (timeouts.length) {
      timeouts.shift()();
    }
  });

  it('logs refresh errors during bpm updates', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    register(doc, 'span', 'midiBpmCurrent');
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

    controller.bindMidiUi();
  });
});
