import { expect } from 'chai';
import { createMidiUiController } from '../../js/app/midiUiController.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';
import { toMidiFlagTriggerType } from '../../js/midi/MidiFlagTriggers.js';
import { PROJECT_STORAGE_KEY } from '../../js/midi/project/MidiProjectStorage.js';
import { TestDocument, createTestWindow } from '../helpers/test-dom.js';
import { registerElement } from '../support/dom-fixtures.js';

const registerSequencerDom = (doc) => {
  doc.body = doc.createElement('body');
  const ids = {
    midiProjectStatus: 'div',
    errorDisplay: 'div',
    midiEnabledToggle: 'input',
    midiInSelect: 'select',
    midiOutSelect: 'select',
    midiInputChannel: 'select',
    midiBpmBase: 'input',
    midiTimeSignatureBeats: 'input',
    midiTimeSignatureUnit: 'select',
    midiQuantize: 'select',
    midiSwing: 'input',
    midiTemplateSelect: 'select',
    midiProjectResetButton: 'button',
    midiPanicButton: 'button',
    midiTemplateSaveButton: 'button',
    midiProjectExportButton: 'button',
    midiProjectImportButton: 'button',
    midiProjectImportInput: 'input',
    midiSourceSearch: 'input',
    midiSourceKindFilter: 'select',
    midiSourceAssignFilter: 'select',
    midiSourceList: 'div',
    midiSourceCount: 'span',
    midiTrackAdd: 'button',
    midiTrackList: 'div',
    midiClipAddButton: 'button',
    midiClipList: 'div',
    midiSelectedSourceSummary: 'div',
    midiAssignTrackSelect: 'select',
    midiAssignSourceButton: 'button',
    midiAuditionButton: 'button',
    midiClipAuditionButton: 'button',
    midiTrackName: 'input',
    midiTrackInstrument: 'input',
    midiTrackOutputSelect: 'select',
    midiTrackChannel: 'input',
    midiTrackPriority: 'input',
    midiTrackVoiceBudget: 'input',
    midiTrackVelocityScale: 'input',
    midiTrackMute: 'input',
    midiTrackSolo: 'input',
    midiTrackArm: 'input',
    midiSourceRevertButton: 'button',
    midiSourceEnabled: 'input',
    midiSourceTrackSelect: 'select',
    midiSourceModeSelect: 'select',
    midiSourceClipSelect: 'select',
    midiAssignClipButton: 'button',
    midiConflictSummary: 'div',
    midiLearnPanel: 'div',
    midiLearnStatus: 'div',
    midiLearnButton: 'button',
    midiLearnConfirmButton: 'button',
    midiLearnCancelButton: 'button',
    midiEnvelopeOverrideToggle: 'input',
    midiMappingNote: 'input',
    midiMappingDegree: 'input',
    midiMappingOctave: 'input',
    midiMappingVelocity: 'input',
    midiMappingDuration: 'input',
    midiMappingChord: 'select',
    midiMappingChordInversion: 'input',
    midiMappingArp: 'select',
    midiMappingPan: 'input',
    midiMappingTimbre: 'input',
    midiMappingPitchBend: 'input',
    midiEnvAttack: 'input',
    midiEnvDecay: 'input',
    midiEnvSustain: 'input',
    midiEnvRelease: 'input',
    midiClipName: 'input',
    midiClipType: 'select',
    midiClipArpModeField: 'label',
    midiClipArpMode: 'select',
    midiClipArpPatternField: 'label',
    midiClipArpPattern: 'select',
    midiClipLengthSteps: 'input',
    midiRecordPanel: 'div',
    midiRecordStatus: 'div',
    midiRecordButton: 'button',
    midiRecordCommitButton: 'button',
    midiRecordCancelButton: 'button',
    midiStepPatternGrid: 'div',
    midiGlobalIntensity: 'input',
    midiGlobalAccent: 'input',
    midiGlobalViewPan: 'input',
    midiAutomationAddButton: 'button',
    midiAutomationList: 'div',
    midiSchedulerPressure: 'div',
    midiOutputLog: 'div'
  };
  for (const [id, tag] of Object.entries(ids)) {
    registerElement(doc, tag, id);
  }
  doc.getElementById('midiSourceKindFilter').value = 'all';
  doc.getElementById('midiSourceAssignFilter').value = 'all';
  doc.getElementById('midiSourceModeSelect').value = 'direct';
  doc.getElementById('midiMappingArp').value = '';
  doc.getElementById('midiClipType').value = 'stepPattern';
  doc.getElementById('midiClipArpMode').value = 'up';
  doc.getElementById('midiClipArpPattern').value = 'up';
  doc.getElementById('midiQuantize').value = '1/16';
  doc.getElementById('midiTemplateSelect').value = 'midi-mapping';
};

const createControllerHarness = ({
  factoryConfig = {
    enabled: false,
    input: { channel: 'omni' },
    sfx: { '1': { name: 'skill-select', note: 60, durationTicks: 4 } },
    triggers: {}
  },
  webMidi = { enabled: false, inputs: [], outputs: [] },
  lemmings = {}
} = {}) => {
  const doc = new TestDocument();
  registerSequencerDom(doc);
  const win = createTestWindow();
  const view = {
    midiEnabled: false,
    projectConfigs: [],
    getMidiBaseConfig: () => factoryConfig,
    setMidiProjectConfig(config) {
      this.projectConfigs.push(config);
      this._midiConfig = config;
    },
    getMidiConfig() {
      return this._midiConfig || null;
    },
    ...lemmings
  };
  const controller = createMidiUiController({
    window: win,
    document: doc,
    getLemmings: () => view,
    getWebMidi: () => webMidi,
    downloadTextFile(document, text, filename, mimeType) {
      view.downloads = view.downloads || [];
      view.downloads.push({ text, filename, mimeType });
    },
    readTextFile(file) {
      return Promise.resolve(file?.text ?? '');
    }
  });
  return { controller, doc, win, view, webMidi };
};

describe('midiUiController sequencer', function() {
  it('loads a factory project, removes legacy storage, and exposes the project hook', function() {
    const { controller, win, view } = createControllerHarness();
    win.localStorage.setItem('lemmings.midi.overrides', '{"sfx":{"1":{"note":99}}}');

    controller.bindMidiUi();

    const project = win.__LEMMINGS_MIDI_UI__.getProject();
    expect(project.sources[0]).to.include({
      kind: 'sfx',
      sourceKey: '1',
      label: 'skill-select'
    });
    expect(win.localStorage.getItem('lemmings.midi.overrides')).to.equal(null);
    expect(win.localStorage.getItem(PROJECT_STORAGE_KEY)).to.be.a('string');
    expect(view.projectConfigs.at(-1).sfx['1']).to.include({ note: 60, durationTicks: 4 });
    expect(win.__LEMMINGS_MIDI_UI__).to.include.keys([
      'getProject',
      'dispatchProjectIntent',
      'setProject',
      'resetProject',
      'exportProject',
      'importProject',
      'saveProjectTemplate',
      'getProjectTemplates',
      'audition',
      'panic'
    ]);
  });

  it('dispatches project intents and writes only the project storage key', function() {
    const { controller, win, view } = createControllerHarness();
    controller.bindMidiUi();

    controller.dispatchProjectIntent({ type: 'enabled.set', enabled: true });
    controller.dispatchProjectIntent({ type: 'track.add', track: { id: 'lead', name: 'Lead', channel: 3 } });
    controller.dispatchProjectIntent({ type: 'source.assignTrack', sourceId: 'sfx-1', trackId: 'lead' });
    controller.dispatchProjectIntent({ type: 'source.mapping.update', sourceId: 'sfx-1', patch: { note: 72, velocity: 100 } });

    const stored = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(stored.enabled).to.equal(true);
    expect(stored.tracks.map(track => track.id)).to.include('lead');
    expect(stored.sources[0]).to.include({ trackId: 'lead' });
    expect(stored.sources[0].mapping).to.include({ note: 72, velocity: 100 });
    expect(win.localStorage.getItem('lemmings.midi.intent')).to.equal(null);
    expect(win.localStorage.getItem('lemmings.midi.overrides')).to.equal(null);
    expect(view.projectConfigs.at(-1).sfx['1']).to.include({ note: 72, velocity: 100, channel: 3 });
  });

  it('edits direct chord inversions and auditions chord notes', function() {
    const sent = [];
    const { controller, doc } = createControllerHarness({
      lemmings: {
        midiRouter: {
          scheduler: {
            sendNote(spec, meta) {
              sent.push({ spec, meta });
              return true;
            },
            allNotesOff() {},
            clearQueue() {}
          }
        }
      }
    });
    controller.bindMidiUi();

    const chord = doc.getElementById('midiMappingChord');
    chord.value = 'triad';
    chord.dispatchEvent({ type: 'change', target: chord });
    const inversion = doc.getElementById('midiMappingChordInversion');
    inversion.value = '1';
    inversion.dispatchEvent({ type: 'change', target: inversion });

    const mapping = controller.getProject().sources[0].mapping;
    expect(mapping.note).to.equal(null);
    expect(mapping.degree).to.equal(0);
    expect(mapping.chord).to.deep.equal({ type: 'triad', inversion: 1 });
    expect(inversion.disabled).to.equal(false);

    expect(controller.audition()).to.equal(true);
    expect(sent.map(entry => entry.spec.note)).to.deep.equal([50, 52, 60]);
    expect(sent.every(entry => entry.meta.eventType === 'audition')).to.equal(true);
  });

  it('edits direct arp mode and exports it to runtime config', function() {
    const { controller, doc, view } = createControllerHarness();
    controller.bindMidiUi();

    const arp = doc.getElementById('midiMappingArp');
    arp.value = 'down';
    arp.dispatchEvent({ type: 'change', target: arp });

    let mapping = controller.getProject().sources[0].mapping;
    expect(mapping.arp).to.include({ enabled: true, mode: 'down' });
    expect(view.projectConfigs.at(-1).sfx['1'].arp).to.include({ enabled: true, mode: 'down' });

    arp.value = '';
    arp.dispatchEvent({ type: 'change', target: arp });
    mapping = controller.getProject().sources[0].mapping;
    expect(mapping.arp).to.equal(null);
    expect(view.projectConfigs.at(-1).sfx['1'].arp).to.equal(undefined);
  });

  it('edits direct expression controls and exports them to runtime config', function() {
    const { controller, doc, view } = createControllerHarness();
    controller.bindMidiUi();

    const pan = doc.getElementById('midiMappingPan');
    pan.value = '-32';
    pan.dispatchEvent({ type: 'change', target: pan });
    const timbre = doc.getElementById('midiMappingTimbre');
    timbre.value = '91';
    timbre.dispatchEvent({ type: 'change', target: timbre });
    const bend = doc.getElementById('midiMappingPitchBend');
    bend.value = '0.5';
    bend.dispatchEvent({ type: 'change', target: bend });

    const mapping = controller.getProject().sources[0].mapping;
    expect(mapping).to.include({ pan: -32, timbre: 91, pitchBend: 0.5 });
    expect(view.projectConfigs.at(-1).sfx['1']).to.include({ pan: -32, timbre: 91, pitchBend: 0.5 });
  });

  it('edits transport time signature controls', function() {
    const { controller, doc, win, view } = createControllerHarness();
    controller.bindMidiUi();

    const beats = doc.getElementById('midiTimeSignatureBeats');
    beats.value = '7';
    beats.dispatchEvent({ type: 'change', target: beats });
    const unit = doc.getElementById('midiTimeSignatureUnit');
    unit.value = '8';
    unit.dispatchEvent({ type: 'change', target: unit });
    const quantize = doc.getElementById('midiQuantize');
    quantize.value = '1/8';
    quantize.dispatchEvent({ type: 'change', target: quantize });
    const swing = doc.getElementById('midiSwing');
    swing.value = '0.25';
    swing.dispatchEvent({ type: 'change', target: swing });

    const stored = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(stored.transport.timeSignature).to.deep.equal({ beats: 7, unit: 8 });
    expect(stored.transport).to.include({ quantize: '1/8', swing: 0.25 });
    expect(view.projectConfigs.at(-1).timing.timeSignature).to.deep.equal({ beats: 7, unit: 8 });
    expect(view.projectConfigs.at(-1).timing).to.include({ quantize: '1/8', swing: 0.25 });

    controller.applyRuntimePatch({ timing: { timeSignature: { beats: 5, unit: 16 }, quantize: '1/32', swing: 0.5 } });
    const patched = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(patched.transport.timeSignature).to.deep.equal({ beats: 5, unit: 16 });
    expect(patched.transport).to.include({ quantize: '1/32', swing: 0.5 });
    expect(view.projectConfigs.at(-1).timing.timeSignature).to.deep.equal({ beats: 5, unit: 16 });
    expect(view.projectConfigs.at(-1).timing).to.include({ quantize: '1/32', swing: 0.5 });
  });

  it('edits arp clip mode and lowers it into runtime config', function() {
    const { controller, doc, view } = createControllerHarness();
    controller.bindMidiUi();
    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'riff', name: 'Riff', type: 'arp', lengthSteps: 2 } });
    controller.dispatchProjectIntent({ type: 'clip.step.update', clipId: 'riff', stepIndex: 0, patch: { note: 64 } });
    controller.dispatchProjectIntent({ type: 'clip.step.update', clipId: 'riff', stepIndex: 1, patch: { note: 67 } });
    controller.dispatchProjectIntent({ type: 'source.clip.assign', sourceId: 'sfx-1', clipId: 'riff' });

    const arpField = doc.getElementById('midiClipArpModeField');
    const arpMode = doc.getElementById('midiClipArpMode');
    const arpPatternField = doc.getElementById('midiClipArpPatternField');
    const arpPattern = doc.getElementById('midiClipArpPattern');
    expect(arpField.style.display).to.equal('');
    expect(arpMode.disabled).to.equal(false);
    expect(arpPatternField.style.display).to.equal('');
    expect(arpPattern.disabled).to.equal(false);
    expect(arpMode.value).to.equal('up');
    expect(arpPattern.value).to.equal('up');

    arpMode.value = 'updown';
    arpMode.dispatchEvent({ type: 'change', target: arpMode });

    const clip = controller.getProject().clips.find(entry => entry.id === 'riff');
    expect(clip.arp).to.include({ mode: 'updown' });
    expect(clip.arp.pattern.preset).to.equal('updown');
    expect(view.projectConfigs.at(-1).sfx['1'].arp).to.include({ enabled: true, mode: 'updown', length: 2 });

    arpPattern.value = 'custom';
    arpPattern.dispatchEvent({ type: 'change', target: arpPattern });
    const customClip = controller.getProject().clips.find(entry => entry.id === 'riff');
    expect(customClip.arp.pattern.preset).to.equal('custom');
    expect(customClip.arp.pattern.steps).to.deep.equal(['up', 'hold', 'down', 'hold', 'up', 'hold', 'down', 'hold']);
    expect(view.projectConfigs.at(-1).sfx['1'].arp.pattern.preset).to.equal('custom');

    controller.dispatchProjectIntent({ type: 'clip.update', clipId: 'riff', patch: { type: 'stepPattern' } });
    expect(arpField.style.display).to.equal('none');
    expect(arpMode.disabled).to.equal(true);
    expect(arpPatternField.style.display).to.equal('none');
    expect(arpPattern.disabled).to.equal(true);
  });

  it('edits modulation controls and exports runtime automation config', function() {
    const { controller, doc, win, view } = createControllerHarness({
      factoryConfig: {
        enabled: false,
        input: { channel: 'omni' },
        position: { mappings: [] },
        sfx: { '1': { name: 'skill-select', note: 60, durationTicks: 4 } },
        triggers: {}
      }
    });
    controller.bindMidiUi();

    const velocityScale = doc.getElementById('midiTrackVelocityScale');
    velocityScale.value = '0.5';
    velocityScale.dispatchEvent({ type: 'change', target: velocityScale });
    const intensity = doc.getElementById('midiGlobalIntensity');
    intensity.value = '96';
    intensity.dispatchEvent({ type: 'change', target: intensity });
    const accent = doc.getElementById('midiGlobalAccent');
    accent.value = '0.8';
    accent.dispatchEvent({ type: 'change', target: accent });
    const viewPan = doc.getElementById('midiGlobalViewPan');
    viewPan.checked = true;
    viewPan.dispatchEvent({ type: 'change', target: viewPan });
    const envelopeToggle = doc.getElementById('midiEnvelopeOverrideToggle');
    envelopeToggle.checked = true;
    envelopeToggle.dispatchEvent({ type: 'change', target: envelopeToggle });

    doc.getElementById('midiAutomationAddButton').dispatchEvent({ type: 'click', target: doc.getElementById('midiAutomationAddButton') });
    const automationRow = doc.getElementById('midiAutomationList').children[0];
    const axisOp = automationRow.children
      .flatMap(child => child.children || [])
      .find(child => child.className === 'midi-automation-axis-op');
    axisOp.value = 'mul';
    axisOp.dispatchEvent({ type: 'change', target: axisOp });

    const stored = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(stored.tracks[0].velocityScale).to.equal(0.5);
    expect(stored.global.velocityRange.default).to.equal(96);
    expect(stored.global.density.velocityBoost).to.equal(0.8);
    expect(stored.global.position.viewPan).to.equal(true);
    expect(stored.sources[0].mapping.envelope).to.deep.equal({ attack: 1, decay: 0, sustain: 1, release: 1 });
    expect(stored.automation).to.have.lengthOf(1);
    expect(stored.automation[0].axisOp).to.equal('mul');
    expect(automationRow.className).to.equal('midi-automation-row');

    const runtime = view.projectConfigs.at(-1);
    expect(runtime.velocityRange.default).to.equal(96);
    expect(runtime.density.velocityBoost).to.equal(0.8);
    expect(runtime.position.viewPan).to.equal(true);
    expect(runtime.position.mappings[0]).to.include({ target: 'note', axis: 'x', axisOp: 'mul', enabled: true });
    expect(runtime.sfx['1'].velocity).to.equal(48);

    const removeButton = doc.getElementById('midiAutomationList').children[0].children.find(child => child.className === 'midi-automation-remove');
    removeButton.dispatchEvent({ type: 'click', target: removeButton });
    const afterRemove = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(afterRemove.automation).to.have.lengthOf(0);
    expect(view.projectConfigs.at(-1).position.mappings).to.have.lengthOf(0);
    expect(doc.getElementById('midiAutomationList').children[0].textContent).to.equal('No modulation lanes');
  });

  it('exports, imports, saves templates, and resets from a user template', async function() {
    const { controller, doc, win, view } = createControllerHarness();
    controller.bindMidiUi();

    controller.dispatchProjectIntent({ type: 'source.mapping.update', sourceId: 'sfx-1', patch: { note: 76 } });
    const exported = controller.exportProject();
    expect(exported.project.sources[0].mapping.note).to.equal(76);
    expect(view.downloads[0]).to.include({
      filename: 'factory-midi-project.lemmings-midi-project.json',
      mimeType: 'application/json'
    });
    expect(JSON.parse(view.downloads[0].text).project.sources[0].mapping.note).to.equal(76);

    const template = controller.saveProjectTemplate({ id: 'lead-template', name: 'Lead Template', now: 10 });
    expect(template).to.include({ id: 'lead-template', name: 'Lead Template' });
    expect(controller.getProjectTemplates().map(entry => entry.id)).to.deep.equal(['lead-template']);
    expect(doc.getElementById('midiTemplateSelect').children.map(option => option.value)).to.include('lead-template');

    const importedPayload = JSON.stringify({
      kind: 'lemmings.midi.project',
      version: 1,
      project: {
        ...controller.getProject(),
        name: 'Imported Project',
        sources: [
          {
            ...controller.getProject().sources[0],
            mapping: { ...controller.getProject().sources[0].mapping, note: 81 }
          }
        ]
      }
    });
    const imported = controller.importProject(importedPayload);
    expect(imported).to.include({ name: 'Imported Project' });
    expect(imported.sources[0].mapping.note).to.equal(81);
    expect(JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY)).sources[0].mapping.note).to.equal(81);

    doc.getElementById('midiTemplateSelect').value = 'lead-template';
    const reset = controller.resetProject('lead-template');
    expect(reset).to.include({ name: 'Lead Template', templateId: 'lead-template' });
    expect(reset.sources[0].mapping.note).to.equal(76);

    await controller.importProjectFile({ text: '{"bad":' });
    expect(doc.getElementById('errorDisplay').textContent).to.contain('not valid JSON');
  });

  it('learns a direct source note through the MIDI input capture hook', function() {
    const captureCalls = [];
    const fakeInputController = {
      handler: null,
      setNoteCapture(handler) {
        captureCalls.push(handler);
        this.handler = handler;
      },
      attach() {},
      detach() {}
    };
    const { controller, doc, win } = createControllerHarness();
    controller.setMidiInputController(fakeInputController);
    controller.bindMidiUi();
    controller.dispatchProjectIntent({ type: 'track.update', trackId: 'track-1', patch: { arm: true } });

    expect(controller.startLearn()).to.equal(true);
    expect(fakeInputController.handler).to.be.a('function');
    expect(fakeInputController.handler(82, 101, 5)).to.equal(true);
    expect(doc.getElementById('midiLearnStatus').textContent).to.contain('Pending note 82');
    expect(controller.confirmLearn()).to.equal(true);

    const stored = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(stored.sources[0].mapping).to.include({ note: 82, velocity: 101, degree: null, chord: null });
    expect(stored.tracks[0]).to.include({ channel: 5, arm: true });
    expect(captureCalls.at(-1)).to.equal(null);
  });

  it('cancels learn capture and clears it on dispose', function() {
    const captureCalls = [];
    const fakeInputController = {
      setNoteCapture(handler) {
        captureCalls.push(handler);
      },
      attach() {},
      detach() {}
    };
    const { controller } = createControllerHarness();
    controller.setMidiInputController(fakeInputController);
    controller.bindMidiUi();

    expect(controller.startLearn()).to.equal(true);
    expect(captureCalls.at(-1)).to.be.a('function');
    expect(controller.cancelLearn()).to.equal(true);
    expect(captureCalls.at(-1)).to.equal(null);

    controller.startLearn();
    controller.dispose();
    expect(captureCalls.at(-1)).to.equal(null);
  });

  it('records mocked MIDI notes into selected clip steps', function() {
    const messageCaptureCalls = [];
    const fakeInputController = {
      setNoteCapture() {},
      setMessageCapture(handler) {
        messageCaptureCalls.push(handler);
        this.handler = handler;
      },
      attach() {},
      detach() {}
    };
    const { controller, win } = createControllerHarness();
    controller.setMidiInputController(fakeInputController);
    controller.bindMidiUi();
    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'recorded', name: 'Recorded', lengthSteps: 4 } });

    expect(controller.startRecording()).to.equal(true);
    expect(fakeInputController.handler).to.be.a('function');
    expect(fakeInputController.handler({ type: 0x90, note: 64, velocity: 90, channel: 1, timestamp: 0 })).to.equal(true);
    expect(fakeInputController.handler({ type: 0x80, note: 64, velocity: 0, channel: 1, timestamp: 240 })).to.equal(true);
    expect(fakeInputController.handler({ type: 0x90, note: 67, velocity: 88, channel: 1, timestamp: 260 })).to.equal(true);
    expect(controller.commitRecording()).to.equal(true);

    const stored = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    const clip = stored.clips.find(entry => entry.id === 'recorded');
    expect(clip.steps[0]).to.include({ note: 64, velocity: 90, durationTicks: 2 });
    expect(clip.steps[1]).to.include({ note: 67, velocity: 88 });
    expect(messageCaptureCalls.at(-1)).to.equal(null);
  });

  it('cancels recording and clears message capture on dispose', function() {
    const messageCaptureCalls = [];
    const fakeInputController = {
      setNoteCapture() {},
      setMessageCapture(handler) {
        messageCaptureCalls.push(handler);
      },
      attach() {},
      detach() {}
    };
    const { controller } = createControllerHarness();
    controller.setMidiInputController(fakeInputController);
    controller.bindMidiUi();
    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'recorded', name: 'Recorded', lengthSteps: 4 } });

    expect(controller.startRecording()).to.equal(true);
    expect(messageCaptureCalls.at(-1)).to.be.a('function');
    expect(controller.cancelRecording()).to.equal(true);
    expect(messageCaptureCalls.at(-1)).to.equal(null);

    controller.startRecording();
    controller.dispose();
    expect(messageCaptureCalls.at(-1)).to.equal(null);
  });

  it('creates clips, assigns a source to clip mode, persists steps, and auditions clip notes', function() {
    const sent = [];
    const { controller, doc, win, view } = createControllerHarness({
      lemmings: {
        midiRouter: {
          scheduler: {
            sendNote(spec, meta) {
              sent.push({ spec, meta });
              return true;
            }
          }
        }
      }
    });
    controller.bindMidiUi();

    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'riff', name: 'Riff', lengthSteps: 4 } });
    controller.dispatchProjectIntent({ type: 'clip.step.update', clipId: 'riff', stepIndex: 0, patch: { note: 65, velocity: 90, durationTicks: 7 } });
    controller.dispatchProjectIntent({ type: 'clip.step.update', clipId: 'riff', stepIndex: 1, patch: { note: 69 } });
    controller.dispatchProjectIntent({ type: 'source.clip.assign', sourceId: 'sfx-1', clipId: 'riff' });

    const stored = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(stored.ui.selectedClipId).to.equal('riff');
    expect(stored.clips[0].steps[0]).to.include({ note: 65, velocity: 90, durationTicks: 7 });
    expect(stored.sources[0]).to.include({ mode: 'clip', clipId: 'riff', mapping: null });
    expect(view.projectConfigs.at(-1).sfx['1']).to.include({ note: 65, velocity: 90, durationTicks: 7, clipId: 'riff' });
    expect(view.projectConfigs.at(-1).sfx['1'].notes).to.deep.equal([65, 69]);
    const stepGrid = doc.getElementById('midiStepPatternGrid');
    expect(stepGrid.children).to.have.lengthOf(4);
    expect(stepGrid.getAttribute('aria-rowcount')).to.equal('1');
    expect(stepGrid.getAttribute('aria-colcount')).to.equal('4');
    expect(stepGrid.children[0].getAttribute('aria-rowindex')).to.equal('1');
    expect(stepGrid.children[0].getAttribute('aria-colindex')).to.equal('1');
    expect(stepGrid.children[0].children[1].children[0].getAttribute('aria-label')).to.equal('Step 1 note');

    expect(controller.audition({ sourceId: 'sfx-1' })).to.equal(true);
    expect(sent.map(entry => entry.spec.note)).to.deep.equal([65, 69]);
    expect(sent[0].meta).to.include({ eventType: 'clip-audition', sourceId: 'sfx-1', trackId: 'track-1', clipId: 'riff' });
  });

  it('renders source conflict badges, conflict filters, and inspector warnings', function() {
    const { controller, doc } = createControllerHarness({
      factoryConfig: {
        enabled: false,
        input: { channel: 'omni' },
        sfx: {
          '1': { name: 'skill-select', note: 60, durationTicks: 4 },
          '2': { name: 'builder', note: 60, durationTicks: 4 }
        },
        triggers: {}
      }
    });
    controller.bindMidiUi();
    const project = controller.getProject();
    controller.setProject({
      ...project,
      sources: [
        project.sources[0],
        {
          ...project.sources[1],
          id: 'sfx-1-copy',
          sourceKey: '1',
          label: 'Duplicate Select'
        }
      ],
      ui: { ...project.ui, selectedSourceId: 'sfx-1' }
    });

    const sourceRows = doc.getElementById('midiSourceList').children;
    const conflictedRows = sourceRows.filter(row => row.classList?.contains('has-conflict'));
    expect(conflictedRows).to.have.lengthOf(2);
    expect(conflictedRows[0].children.some(child => child.className === 'midi-conflict-badge')).to.equal(true);
    expect(conflictedRows[0].children.find(child => child.className === 'midi-conflict-badge')?.getAttribute('aria-hidden')).to.equal('true');
    expect(doc.getElementById('midiConflictSummary').children[0].textContent).to.contain('Duplicate runtime key');

    const filter = doc.getElementById('midiSourceAssignFilter');
    filter.value = 'clean';
    filter.dispatchEvent({ type: 'change', target: filter });
    const empty = doc.getElementById('midiSourceList').children[0];
    expect(empty.textContent).to.contain('No sources match');
    expect(empty.getAttribute('role')).to.equal('option');
    expect(empty.getAttribute('aria-disabled')).to.equal('true');
    filter.value = 'conflicts';
    filter.dispatchEvent({ type: 'change', target: filter });
    expect(doc.getElementById('midiSourceList').children.filter(row => row.classList?.contains('has-conflict'))).to.have.lengthOf(2);
  });

  it('filters sources changed from the factory template', function() {
    const { controller, doc } = createControllerHarness({
      factoryConfig: {
        enabled: false,
        input: { channel: 'omni' },
        sfx: {
          '1': { name: 'skill-select', note: 60, durationTicks: 4 },
          '2': { name: 'builder', note: 62, durationTicks: 4 }
        },
        triggers: {}
      }
    });
    controller.bindMidiUi();
    const filter = doc.getElementById('midiSourceAssignFilter');

    filter.value = 'changed';
    filter.dispatchEvent({ type: 'change', target: filter });
    expect(doc.getElementById('midiSourceList').children[0].textContent).to.contain('No sources match');

    controller.dispatchProjectIntent({ type: 'source.select', sourceId: 'sfx-2' });
    controller.dispatchProjectIntent({ type: 'source.mapping.update', sourceId: 'sfx-2', patch: { note: 70 } });
    const changedRows = doc.getElementById('midiSourceList').children.filter(row => row.classList?.contains('is-changed'));
    expect(changedRows).to.have.lengthOf(1);
    expect(changedRows[0].children[0].textContent).to.equal('builder');
    expect(changedRows[0].children.some(child => child.textContent === 'Changed')).to.equal(true);
    expect(changedRows[0].getAttribute('aria-label')).to.contain('changed');

    const revert = doc.getElementById('midiSourceRevertButton');
    expect(revert.disabled).to.equal(false);
    revert.dispatchEvent({ type: 'click', target: revert });
    expect(controller.getProject().sources.find(source => source.id === 'sfx-2').mapping.note).to.equal(62);
    expect(doc.getElementById('midiSourceList').children[0].textContent).to.contain('No sources match');
  });

  it('filters sources available in the current level', function() {
    const flagTrigger = toMidiFlagTriggerType(3);
    const { controller, doc } = createControllerHarness({
      factoryConfig: {
        enabled: false,
        input: { channel: 'omni' },
        sfx: {
          [SoundEffectIds.EXIT]: { name: 'exit', note: 60, durationTicks: 4 },
          [SoundEffectIds.BUILDER_STEP]: { name: 'builder-step', note: 62, durationTicks: 4 }
        },
        triggers: {
          [TriggerTypes.EXIT_LEVEL]: { name: 'exit-trigger', note: 64, durationTicks: 4 },
          [TriggerTypes.TRAP]: { name: 'trap-trigger', note: 65, durationTicks: 4 }
        }
      },
      lemmings: {
        game: {
          level: {
            triggers: [{ type: TriggerTypes.EXIT_LEVEL }],
            midiFlags: [{ id: 3, triggerType: flagTrigger }],
            skills: []
          },
          getGameSkills() {
            return { getSkill: () => 0 };
          }
        }
      }
    });
    controller.bindMidiUi();

    const filter = doc.getElementById('midiSourceAssignFilter');
    filter.value = 'available';
    filter.dispatchEvent({ type: 'change', target: filter });

    const sourceIds = doc.getElementById('midiSourceList')
      .children
      .map(row => row.dataset?.sourceId)
      .filter(Boolean);
    expect(sourceIds).to.include(`sfx-${SoundEffectIds.EXIT}`);
    expect(sourceIds).to.not.include(`sfx-${SoundEffectIds.BUILDER_STEP}`);
    expect(sourceIds).to.include(`trigger-${TriggerTypes.EXIT_LEVEL}`);
    expect(sourceIds).to.not.include(`trigger-${TriggerTypes.TRAP}`);
    expect(sourceIds).to.include(`midiFlag-${flagTrigger}`);
    expect(sourceIds).to.not.include(`trigger-${flagTrigger}`);
  });

  it('moves source, track, and clip listbox selections from the keyboard', function() {
    const { controller, doc } = createControllerHarness({
      factoryConfig: {
        enabled: false,
        input: { channel: 'omni' },
        sfx: {
          '1': { name: 'skill-select', note: 60, durationTicks: 4 },
          '2': { name: 'builder', note: 62, durationTicks: 4 }
        },
        triggers: {}
      }
    });
    controller.bindMidiUi();
    let prevented = 0;
    const keydown = (element, key) => element.dispatchEvent({
      type: 'keydown',
      key,
      preventDefault() {
        prevented += 1;
      }
    });

    const sourceList = doc.getElementById('midiSourceList');
    expect(sourceList.getAttribute('aria-activedescendant')).to.equal('midi-source-option-sfx-1');
    keydown(sourceList, 'ArrowDown');
    expect(controller.getProject().ui.selectedSourceId).to.equal('sfx-2');
    expect(sourceList.getAttribute('aria-activedescendant')).to.equal('midi-source-option-sfx-2');
    expect(sourceList.children[1].getAttribute('aria-selected')).to.equal('true');
    expect(sourceList.children[1].tabIndex).to.equal(0);

    controller.dispatchProjectIntent({ type: 'track.add', track: { id: 'bass', name: 'Bass', channel: 2 } });
    controller.dispatchProjectIntent({ type: 'track.select', trackId: 'track-1' });
    const trackList = doc.getElementById('midiTrackList');
    keydown(trackList, 'End');
    expect(controller.getProject().ui.selectedTrackId).to.equal('bass');
    expect(trackList.getAttribute('aria-activedescendant')).to.equal('midi-track-option-bass');

    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'riff', name: 'Riff', lengthSteps: 4 } });
    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'fill', name: 'Fill', lengthSteps: 4 } });
    controller.dispatchProjectIntent({ type: 'clip.select', clipId: 'riff' });
    const clipList = doc.getElementById('midiClipList');
    keydown(clipList, 'End');
    expect(controller.getProject().ui.selectedClipId).to.equal('fill');
    expect(clipList.getAttribute('aria-activedescendant')).to.equal('midi-clip-option-fill');
    keydown(clipList, 'Home');
    expect(controller.getProject().ui.selectedClipId).to.equal('riff');
    expect(clipList.getAttribute('aria-activedescendant')).to.equal('midi-clip-option-riff');
    expect(prevented).to.equal(4);
  });

  it('refreshes mocked devices, auditions through the selected track, and panics', function() {
    const sent = [];
    let registeredOutputs = [];
    const webMidi = {
      enabled: true,
      inputs: [{ id: 'in-1', name: 'Input 1', addListener() {}, removeListener() {} }],
      outputs: [{ id: 'out-1', name: 'Output 1' }],
      getInputById(id) { return this.inputs.find(input => input.id === id) || null; },
      getOutputById(id) { return this.outputs.find(output => output.id === id) || null; },
      addListener() {},
      removeListener() {}
    };
    const { controller, doc, view } = createControllerHarness({
      webMidi,
      lemmings: {
        midiRouter: {
          scheduler: {
            setOutputs(outputs) {
              registeredOutputs = outputs;
            },
            sendNote(spec, meta) {
              sent.push({ spec, meta });
              return true;
            },
            allNotesOff() {
              sent.push({ panic: true });
            },
            clearQueue() {}
          }
        }
      }
    });

    controller.bindMidiUi();
    controller.dispatchProjectIntent({ type: 'enabled.set', enabled: true });
    controller.dispatchProjectIntent({ type: 'track.update', trackId: 'track-1', patch: { channel: 4 } });
    controller.onEnabled();

    expect(doc.getElementById('midiInSelect').value).to.equal('in-1');
    expect(doc.getElementById('midiOutSelect').value).to.equal('out-1');
    expect(doc.getElementById('midiTrackOutputSelect').children.map(option => option.value)).to.include('out-1');
    expect(view.midiOut).to.equal(webMidi.outputs[0]);
    expect(registeredOutputs).to.deep.equal(webMidi.outputs);

    const trackOutput = doc.getElementById('midiTrackOutputSelect');
    trackOutput.value = 'out-1';
    trackOutput.dispatchEvent({ type: 'change', target: trackOutput });
    expect(controller.getProject().tracks[0].outputId).to.equal('out-1');
    expect(controller.getMidiConfig().sfx['1'].outputId).to.equal('out-1');

    expect(controller.audition()).to.equal(true);
    const note = sent.find(entry => entry.spec);
    expect(note.spec).to.include({ note: 60, velocity: 80, durationTicks: 4, channel: 4, outputId: 'out-1' });
    expect(note.meta).to.include({ eventType: 'audition', sourceId: 'sfx-1', trackId: 'track-1' });

    expect(controller.panic()).to.equal(true);
    expect(sent.some(entry => entry.panic)).to.equal(true);
  });
});
