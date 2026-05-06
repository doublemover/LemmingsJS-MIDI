import { expect } from 'chai';
import { createMidiUiController } from '../../js/app/midiUiController.js';
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
    midiTrackChannel: 'input',
    midiTrackPriority: 'input',
    midiTrackVoiceBudget: 'input',
    midiTrackVelocityScale: 'input',
    midiTrackMute: 'input',
    midiTrackSolo: 'input',
    midiTrackArm: 'input',
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
    midiEnvAttack: 'input',
    midiEnvDecay: 'input',
    midiEnvSustain: 'input',
    midiEnvRelease: 'input',
    midiClipName: 'input',
    midiClipType: 'select',
    midiClipLengthSteps: 'input',
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
  doc.getElementById('midiClipType').value = 'stepPattern';
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
    const stored = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(stored.tracks[0].velocityScale).to.equal(0.5);
    expect(stored.global.velocityRange.default).to.equal(96);
    expect(stored.global.density.velocityBoost).to.equal(0.8);
    expect(stored.global.position.viewPan).to.equal(true);
    expect(stored.sources[0].mapping.envelope).to.deep.equal({ attack: 1, decay: 0, sustain: 1, release: 1 });
    expect(stored.automation).to.have.lengthOf(1);
    expect(doc.getElementById('midiAutomationList').children[0].className).to.equal('midi-automation-row');

    const runtime = view.projectConfigs.at(-1);
    expect(runtime.velocityRange.default).to.equal(96);
    expect(runtime.density.velocityBoost).to.equal(0.8);
    expect(runtime.position.viewPan).to.equal(true);
    expect(runtime.position.mappings[0]).to.include({ target: 'note', axis: 'x', enabled: true });
    expect(runtime.sfx['1'].velocity).to.equal(48);
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
    expect(doc.getElementById('midiStepPatternGrid').children).to.have.lengthOf(4);

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
    expect(doc.getElementById('midiConflictSummary').children[0].textContent).to.contain('Duplicate runtime key');

    const filter = doc.getElementById('midiSourceAssignFilter');
    filter.value = 'clean';
    filter.dispatchEvent({ type: 'change', target: filter });
    expect(doc.getElementById('midiSourceList').children[0].textContent).to.contain('No sources match');
    filter.value = 'conflicts';
    filter.dispatchEvent({ type: 'change', target: filter });
    expect(doc.getElementById('midiSourceList').children.filter(row => row.classList?.contains('has-conflict'))).to.have.lengthOf(2);
  });

  it('refreshes mocked devices, auditions through the selected track, and panics', function() {
    const sent = [];
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
    expect(view.midiOut).to.equal(webMidi.outputs[0]);

    expect(controller.audition()).to.equal(true);
    const note = sent.find(entry => entry.spec);
    expect(note.spec).to.include({ note: 60, velocity: 80, durationTicks: 4, channel: 4 });
    expect(note.meta).to.include({ eventType: 'audition', sourceId: 'sfx-1', trackId: 'track-1' });

    expect(controller.panic()).to.equal(true);
    expect(sent.some(entry => entry.panic)).to.equal(true);
  });
});
