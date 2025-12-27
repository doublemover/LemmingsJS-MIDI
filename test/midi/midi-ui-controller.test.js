import { expect } from 'chai';
import { createMidiUiController } from '../../js/app/midiUiController.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { SkillTypes } from '../../js/game/SkillTypes.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';
import { TestDocument, createTestWindow } from '../helpers/test-dom.js';

const register = (doc, tag, id, className = '') => {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  doc.registerElement(id, el);
  return el;
};

const findElement = (root, predicate) => {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
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

    const minRow = findElement(positionList, el => (
      el.tagName === 'LABEL' && el.children?.[0]?.textContent === 'Min'
    ));
    const maxRow = findElement(positionList, el => (
      el.tagName === 'LABEL' && el.children?.[0]?.textContent === 'Max'
    ));
    const minInput = minRow?.children?.[1] || null;
    const maxInput = maxRow?.children?.[1] || null;
    expect(minInput).to.be.ok;
    expect(maxInput).to.be.ok;
    expect(minInput.value).to.equal('-50');
    expect(maxInput.value).to.equal('50');
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
});
