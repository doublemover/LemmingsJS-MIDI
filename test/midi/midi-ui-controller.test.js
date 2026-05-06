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
    midiSequencerWorkspace: 'div',
    midiProjectStatus: 'div',
    errorDisplay: 'div',
    midiEnabledToggle: 'input',
    midiInSelect: 'select',
    midiOutSelect: 'select',
    midiInputChannel: 'select',
    midiBpmBase: 'input',
    midiTimeSignatureBeats: 'input',
    midiTimeSignatureUnit: 'select',
    midiScaleRoot: 'select',
    midiScaleName: 'select',
    midiQuantize: 'select',
    midiSwing: 'input',
    midiTemplateSelect: 'select',
    midiProjectResetButton: 'button',
    midiPanicButton: 'button',
    midiReversePanicToggle: 'input',
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
    midiClipDuplicateButton: 'button',
    midiClipRemoveButton: 'button',
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
    midiGlobalVelocityMin: 'input',
    midiGlobalVelocityMax: 'input',
    midiGlobalNoteMin: 'input',
    midiGlobalNoteMax: 'input',
    midiGlobalAccent: 'input',
    midiGlobalViewPan: 'input',
    midiGlobalPanMin: 'input',
    midiGlobalPanMax: 'input',
    midiGlobalPanDeadZone: 'input',
    midiGlobalTimbreMin: 'input',
    midiGlobalTimbreMax: 'input',
    midiGlobalXNoteMin: 'input',
    midiGlobalXNoteMax: 'input',
    midiGlobalDensityWindow: 'input',
    midiGlobalDurationScale: 'input',
    midiGlobalMaxActiveNotes: 'input',
    midiGlobalMaxEventsPerTick: 'input',
    midiGlobalDurationDefault: 'input',
    midiGlobalDurationMin: 'input',
    midiGlobalDurationMax: 'input',
    midiGlobalEnvAttack: 'input',
    midiGlobalEnvDecay: 'input',
    midiGlobalEnvSustain: 'input',
    midiGlobalEnvRelease: 'input',
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
  doc.getElementById('midiScaleRoot').value = '0';
  doc.getElementById('midiScaleName').value = 'chromatic-minor';
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

  it('skips audition for muted and solo-hidden tracks', function() {
    const sent = [];
    const { controller, doc } = createControllerHarness({
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

    controller.dispatchProjectIntent({
      type: 'track.update',
      trackId: 'track-1',
      patch: { mute: true }
    });
    expect(controller.audition({ sourceId: 'sfx-1' })).to.equal(false);
    expect(sent).to.have.lengthOf(0);
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('Audition skipped: Track 1 muted');

    controller.dispatchProjectIntent({
      type: 'track.update',
      trackId: 'track-1',
      patch: { mute: false }
    });
    controller.dispatchProjectIntent({
      type: 'track.add',
      track: { id: 'lead', name: 'Lead', solo: true }
    });
    expect(controller.audition({ sourceId: 'sfx-1' })).to.equal(false);
    expect(sent).to.have.lengthOf(0);
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('Audition skipped: Track 1 hidden by solo');
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
    const scaleRoot = doc.getElementById('midiScaleRoot');
    scaleRoot.value = '2';
    scaleRoot.dispatchEvent({ type: 'change', target: scaleRoot });
    const scaleName = doc.getElementById('midiScaleName');
    scaleName.value = 'major';
    scaleName.dispatchEvent({ type: 'change', target: scaleName });
    const reversePanic = doc.getElementById('midiReversePanicToggle');
    reversePanic.checked = true;
    reversePanic.dispatchEvent({ type: 'change', target: reversePanic });

    const stored = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(stored.transport.timeSignature).to.deep.equal({ beats: 7, unit: 8 });
    expect(stored.transport).to.include({ quantize: '1/8', swing: 0.25 });
    expect(stored.global.scale).to.include({ name: 'major', root: 2 });
    expect(stored.global.scale.degrees).to.deep.equal([0, 2, 4, 5, 7, 9, 11]);
    expect(stored.global.reverse.allNotesOffOnToggle).to.equal(true);
    expect(view.projectConfigs.at(-1).timing.timeSignature).to.deep.equal({ beats: 7, unit: 8 });
    expect(view.projectConfigs.at(-1).timing).to.include({ quantize: '1/8', swing: 0.25 });
    expect(view.projectConfigs.at(-1).scale).to.include({ name: 'major', root: 2 });
    expect(view.projectConfigs.at(-1).scale.degrees).to.deep.equal([0, 2, 4, 5, 7, 9, 11]);
    expect(view.projectConfigs.at(-1).reverse.allNotesOffOnToggle).to.equal(true);

    controller.applyRuntimePatch({
      timing: { timeSignature: { beats: 5, unit: 16 }, quantize: '1/32', swing: 0.5 },
      scale: { name: 'minor', root: 5 }
    });
    const patched = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(patched.transport.timeSignature).to.deep.equal({ beats: 5, unit: 16 });
    expect(patched.transport).to.include({ quantize: '1/32', swing: 0.5 });
    expect(patched.global.scale).to.include({ name: 'minor', root: 5 });
    expect(patched.global.scale.degrees).to.deep.equal([0, 2, 3, 5, 7, 8, 10]);
    expect(view.projectConfigs.at(-1).timing.timeSignature).to.deep.equal({ beats: 5, unit: 16 });
    expect(view.projectConfigs.at(-1).timing).to.include({ quantize: '1/32', swing: 0.5 });
    expect(view.projectConfigs.at(-1).scale).to.include({ name: 'minor', root: 5 });
    expect(view.projectConfigs.at(-1).scale.degrees).to.deep.equal([0, 2, 3, 5, 7, 8, 10]);
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
    arpPatternField.appendChild(arpPattern);
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

    arpPattern.focus();
    expect(doc.activeElement).to.equal(arpPattern);
    const clipType = doc.getElementById('midiClipType');
    clipType.value = 'stepPattern';
    clipType.dispatchEvent({ type: 'change', target: clipType });
    expect(arpField.style.display).to.equal('none');
    expect(arpMode.disabled).to.equal(true);
    expect(arpPatternField.style.display).to.equal('none');
    expect(arpPattern.disabled).to.equal(true);
    expect(doc.activeElement).to.equal(clipType);
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
    const velocityMin = doc.getElementById('midiGlobalVelocityMin');
    velocityMin.value = '20';
    velocityMin.dispatchEvent({ type: 'change', target: velocityMin });
    const velocityMax = doc.getElementById('midiGlobalVelocityMax');
    velocityMax.value = '110';
    velocityMax.dispatchEvent({ type: 'change', target: velocityMax });
    const noteMin = doc.getElementById('midiGlobalNoteMin');
    noteMin.value = '36';
    noteMin.dispatchEvent({ type: 'change', target: noteMin });
    const noteMax = doc.getElementById('midiGlobalNoteMax');
    noteMax.value = '96';
    noteMax.dispatchEvent({ type: 'change', target: noteMax });
    const accent = doc.getElementById('midiGlobalAccent');
    accent.value = '0.8';
    accent.dispatchEvent({ type: 'change', target: accent });
    const densityWindow = doc.getElementById('midiGlobalDensityWindow');
    densityWindow.value = '12';
    densityWindow.dispatchEvent({ type: 'change', target: densityWindow });
    const durationScale = doc.getElementById('midiGlobalDurationScale');
    durationScale.value = '0.25';
    durationScale.dispatchEvent({ type: 'change', target: durationScale });
    const maxActiveNotes = doc.getElementById('midiGlobalMaxActiveNotes');
    maxActiveNotes.value = '24';
    maxActiveNotes.dispatchEvent({ type: 'change', target: maxActiveNotes });
    const maxEventsPerTick = doc.getElementById('midiGlobalMaxEventsPerTick');
    maxEventsPerTick.value = '16';
    maxEventsPerTick.dispatchEvent({ type: 'change', target: maxEventsPerTick });
    const durationDefault = doc.getElementById('midiGlobalDurationDefault');
    durationDefault.value = '10';
    durationDefault.dispatchEvent({ type: 'change', target: durationDefault });
    const durationMin = doc.getElementById('midiGlobalDurationMin');
    durationMin.value = '2';
    durationMin.dispatchEvent({ type: 'change', target: durationMin });
    const durationMax = doc.getElementById('midiGlobalDurationMax');
    durationMax.value = '32';
    durationMax.dispatchEvent({ type: 'change', target: durationMax });
    const viewPan = doc.getElementById('midiGlobalViewPan');
    viewPan.checked = true;
    viewPan.dispatchEvent({ type: 'change', target: viewPan });
    const panMin = doc.getElementById('midiGlobalPanMin');
    panMin.value = '-48';
    panMin.dispatchEvent({ type: 'change', target: panMin });
    const panMax = doc.getElementById('midiGlobalPanMax');
    panMax.value = '48';
    panMax.dispatchEvent({ type: 'change', target: panMax });
    const panDeadZone = doc.getElementById('midiGlobalPanDeadZone');
    panDeadZone.value = '0.08';
    panDeadZone.dispatchEvent({ type: 'change', target: panDeadZone });
    const timbreMin = doc.getElementById('midiGlobalTimbreMin');
    timbreMin.value = '12';
    timbreMin.dispatchEvent({ type: 'change', target: timbreMin });
    const timbreMax = doc.getElementById('midiGlobalTimbreMax');
    timbreMax.value = '100';
    timbreMax.dispatchEvent({ type: 'change', target: timbreMax });
    const xNoteMin = doc.getElementById('midiGlobalXNoteMin');
    xNoteMin.value = '-18';
    xNoteMin.dispatchEvent({ type: 'change', target: xNoteMin });
    const xNoteMax = doc.getElementById('midiGlobalXNoteMax');
    xNoteMax.value = '18';
    xNoteMax.dispatchEvent({ type: 'change', target: xNoteMax });
    const globalAttack = doc.getElementById('midiGlobalEnvAttack');
    globalAttack.value = '1.25';
    globalAttack.dispatchEvent({ type: 'change', target: globalAttack });
    const globalRelease = doc.getElementById('midiGlobalEnvRelease');
    globalRelease.value = '0.75';
    globalRelease.dispatchEvent({ type: 'change', target: globalRelease });
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
    const pointBeat = automationRow.children
      .flatMap(child => child.children || [])
      .find(child => child.className === 'midi-automation-point-beat');
    const pointValue = automationRow.children
      .flatMap(child => child.children || [])
      .find(child => child.className === 'midi-automation-point-value');
    expect(pointBeat.value).to.equal('0');
    expect(pointValue.value).to.equal('-12');
    pointBeat.value = '2';
    pointBeat.dispatchEvent({ type: 'change', target: pointBeat });
    pointValue.value = '0.7';
    pointValue.dispatchEvent({ type: 'change', target: pointValue });

    const stored = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(stored.tracks[0].velocityScale).to.equal(0.5);
    expect(stored.global.velocityRange).to.include({ default: 96, min: 20, max: 110 });
    expect(stored.global.noteRange).to.include({ min: 36, max: 96 });
    expect(stored.global.density).to.include({ velocityBoost: 0.8, windowTicks: 12, durationScale: 0.25 });
    expect(stored.global.limits).to.include({ maxActiveNotes: 24, maxEventsPerTick: 16 });
    expect(stored.global.durationTicks).to.include({ default: 10, min: 2, max: 32 });
    expect(stored.global.position.viewPan).to.equal(true);
    expect(stored.global.position.panRange).to.deep.equal({ min: -48, max: 48 });
    expect(stored.global.position.panDeadZonePct).to.equal(0.08);
    expect(stored.global.position.timbreRange).to.deep.equal({ min: 12, max: 100 });
    expect(stored.global.position.xNoteRange).to.deep.equal({ min: -18, max: 18 });
    expect(stored.global.envelope).to.include({ attack: 1.25, release: 0.75 });
    expect(stored.sources[0].mapping.envelope).to.deep.equal({ attack: 1, decay: 0, sustain: 1, release: 1 });
    expect(stored.automation).to.have.lengthOf(1);
    expect(stored.automation[0].axisOp).to.equal('mul');
    expect(stored.automation[0].points[0]).to.deep.equal({ beat: 2, value: 0.7 });
    expect(automationRow.className).to.equal('midi-automation-row');

    const runtime = view.projectConfigs.at(-1);
    expect(runtime.velocityRange).to.include({ default: 96, min: 20, max: 110 });
    expect(runtime.noteRange).to.include({ min: 36, max: 96 });
    expect(runtime.density).to.include({ velocityBoost: 0.8, windowTicks: 12, durationScale: 0.25 });
    expect(runtime.limits).to.include({ maxActiveNotes: 24, maxEventsPerTick: 16 });
    expect(runtime.durationTicks).to.include({ default: 10, min: 2, max: 32 });
    expect(runtime.position.viewPan).to.equal(true);
    expect(runtime.position.panRange).to.deep.equal({ min: -48, max: 48 });
    expect(runtime.position.panDeadZonePct).to.equal(0.08);
    expect(runtime.position.timbreRange).to.deep.equal({ min: 12, max: 100 });
    expect(runtime.position.xNoteRange).to.deep.equal({ min: -18, max: 18 });
    expect(runtime.envelope).to.include({ attack: 1.25, release: 0.75 });
    expect(runtime.position.mappings[0]).to.include({ target: 'note', axis: 'x', axisOp: 'mul', enabled: true });
    expect(runtime.position.mappings[0].points).to.deep.equal([{ beat: 2, value: 0.7 }]);
    expect(runtime.sfx['1'].velocity).to.equal(48);

    controller.applyRuntimePatch({
      noteRange: { min: 48, max: 84 },
      velocityRange: { min: 24, max: 112 },
      density: { windowTicks: 18, durationScale: 0.75 },
      durationTicks: { default: 12, min: 3, max: 48 },
      envelope: { sustain: 1.5 },
      position: {
        panRange: { min: -64, max: 64 },
        timbreRange: { min: 10, max: 100 },
        panDeadZonePct: 0.1
      },
      mpe: { enabled: false, masterChannel: 3 },
      limits: { maxActiveNotes: 12, maxEventsPerTick: 8 },
      reverse: { allNotesOffOnToggle: true }
    });
    const afterPatch = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(afterPatch.global.noteRange).to.include({ min: 48, max: 84 });
    expect(afterPatch.global.velocityRange).to.include({ default: 96, min: 24, max: 112 });
    expect(afterPatch.global.density).to.include({ windowTicks: 18, durationScale: 0.75 });
    expect(afterPatch.global.durationTicks).to.include({ default: 12, min: 3, max: 48 });
    expect(afterPatch.global.envelope.sustain).to.equal(1.5);
    expect(afterPatch.global.position.panRange).to.deep.equal({ min: -64, max: 64 });
    expect(afterPatch.global.position.timbreRange).to.deep.equal({ min: 10, max: 100 });
    expect(afterPatch.global.position.panDeadZonePct).to.equal(0.1);
    expect(afterPatch.global.mpe).to.include({ enabled: false, masterChannel: 3 });
    expect(afterPatch.global.limits).to.include({ maxActiveNotes: 12, maxEventsPerTick: 8 });
    expect(afterPatch.global.reverse).to.include({ allNotesOffOnToggle: true });
    expect(view.projectConfigs.at(-1).noteRange).to.include({ min: 48, max: 84 });
    expect(view.projectConfigs.at(-1).velocityRange).to.include({ default: 96, min: 24, max: 112 });
    expect(view.projectConfigs.at(-1).density).to.include({ windowTicks: 18, durationScale: 0.75 });
    expect(view.projectConfigs.at(-1).durationTicks).to.include({ default: 12, min: 3, max: 48 });
    expect(view.projectConfigs.at(-1).envelope.sustain).to.equal(1.5);
    expect(view.projectConfigs.at(-1).position.panRange).to.deep.equal({ min: -64, max: 64 });
    expect(view.projectConfigs.at(-1).position.timbreRange).to.deep.equal({ min: 10, max: 100 });
    expect(view.projectConfigs.at(-1).position.panDeadZonePct).to.equal(0.1);
    expect(view.projectConfigs.at(-1).mpe).to.include({ enabled: false, masterChannel: 3 });
    expect(view.projectConfigs.at(-1).limits).to.include({ maxActiveNotes: 12, maxEventsPerTick: 8 });
    expect(view.projectConfigs.at(-1).reverse).to.include({ allNotesOffOnToggle: true });

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
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Exported project');
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('Exported project');

    const template = controller.saveProjectTemplate({ id: 'lead-template', name: 'Lead Template', now: 10 });
    expect(template).to.include({ id: 'lead-template', name: 'Lead Template' });
    expect(controller.getProjectTemplates().map(entry => entry.id)).to.deep.equal(['lead-template']);
    expect(doc.getElementById('midiTemplateSelect').children.map(option => option.value)).to.include('lead-template');
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Saved template Lead Template');
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('Saved template Lead Template');

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
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Reset project from Lead Template');
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('Reset project from Lead Template');

    await controller.importProjectFile({ text: '{"bad":' });
    expect(doc.getElementById('errorDisplay').textContent).to.contain('not valid JSON');
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('Import failed:');
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('not valid JSON');
  });

  it('runs template operations from keyboard shortcuts', function() {
    const { controller, doc, view } = createControllerHarness();
    controller.bindMidiUi();
    const workspace = doc.getElementById('midiSequencerWorkspace');
    const importInput = doc.getElementById('midiProjectImportInput');
    let importClicks = 0;
    let prevented = 0;
    let stopped = 0;
    importInput.click = () => {
      importClicks += 1;
    };
    const dispatchShortcut = (target, key) => target.dispatchEvent({
      type: 'keydown',
      key,
      ctrlKey: true,
      preventDefault() {
        prevented += 1;
      },
      stopPropagation() {
        stopped += 1;
      }
    });

    dispatchShortcut(workspace, 's');
    const template = controller.getProjectTemplates()[0];
    expect(template.name).to.equal('Factory MIDI Project Template');
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Saved template Factory MIDI Project Template');

    dispatchShortcut(workspace, 'e');
    expect(view.downloads.at(-1).filename).to.equal('factory-midi-project.lemmings-midi-project.json');
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Exported project');

    dispatchShortcut(workspace, 'i');
    expect(importClicks).to.equal(1);

    controller.dispatchProjectIntent({ type: 'source.mapping.update', sourceId: 'sfx-1', patch: { note: 83 } });
    const templateSelect = doc.getElementById('midiTemplateSelect');
    templateSelect.value = template.id;
    dispatchShortcut(templateSelect, 'Enter');
    expect(controller.getProject()).to.include({ name: 'Factory MIDI Project Template', templateId: template.id });
    expect(controller.getProject().sources[0].mapping.note).to.equal(60);
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Reset project from Factory MIDI Project Template');
    expect(prevented).to.equal(4);
    expect(stopped).to.equal(4);
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
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Learned skill-select');
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('Learned skill-select');

    const stored = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(stored.sources[0].mapping).to.include({ note: 82, velocity: 101, degree: null, chord: null });
    expect(stored.tracks[0]).to.include({ channel: 5, arm: true });
    expect(captureCalls.at(-1)).to.equal(null);
  });

  it('surfaces learn conflict warnings without blocking confirmation', function() {
    const fakeInputController = {
      handler: null,
      setNoteCapture(handler) {
        this.handler = handler;
      },
      attach() {},
      detach() {}
    };
    const { controller, doc, win } = createControllerHarness();
    controller.setMidiInputController(fakeInputController);
    controller.bindMidiUi();

    controller.dispatchProjectIntent({
      type: 'global.update',
      patch: { noteRange: { min: 60, max: 70 } }
    });

    expect(controller.startLearn()).to.equal(true);
    expect(fakeInputController.handler(82, 101, 5)).to.equal(true);
    expect(doc.getElementById('midiLearnStatus').textContent).to.contain('Pending note 82');
    expect(doc.getElementById('midiLearnStatus').textContent).to.contain('1 warning');

    expect(controller.confirmLearn()).to.equal(true);
    const stored = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(stored.sources[0].mapping).to.include({ note: 82, velocity: 101 });
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

  it('cancels learn and recording capture flows with Escape', function() {
    const captureCalls = [];
    const messageCaptureCalls = [];
    const fakeInputController = {
      noteHandler: null,
      messageHandler: null,
      setNoteCapture(handler) {
        captureCalls.push(handler);
        this.noteHandler = handler;
      },
      setMessageCapture(handler) {
        messageCaptureCalls.push(handler);
        this.messageHandler = handler;
      },
      attach() {},
      detach() {}
    };
    const { controller, doc } = createControllerHarness();
    controller.setMidiInputController(fakeInputController);
    controller.bindMidiUi();
    const workspace = doc.getElementById('midiSequencerWorkspace');

    expect(controller.startLearn()).to.equal(true);
    expect(fakeInputController.noteHandler(82, 101, 5)).to.equal(true);
    expect(doc.getElementById('midiLearnStatus').textContent).to.contain('Pending note 82');
    workspace.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault() {},
      stopPropagation() {}
    });
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Learn canceled');
    expect(doc.getElementById('midiLearnStatus').textContent).to.equal('Learn waits for the next note-on.');
    expect(controller.getProject().sources[0].mapping.note).to.equal(60);
    expect(captureCalls.at(-1)).to.equal(null);

    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'escape-clip', name: 'Escape Clip', lengthSteps: 4 } });
    expect(controller.startRecording()).to.equal(true);
    expect(fakeInputController.messageHandler({ type: 0x90, note: 64, velocity: 90, channel: 1, timestamp: 0 })).to.equal(true);
    expect(fakeInputController.messageHandler({ type: 0x80, note: 64, velocity: 0, channel: 1, timestamp: 240 })).to.equal(true);
    expect(doc.getElementById('midiRecordStatus').textContent).to.contain('1 notes captured');
    workspace.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault() {},
      stopPropagation() {}
    });
    const clip = controller.getProject().clips.find(entry => entry.id === 'escape-clip');
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Recording canceled');
    expect(doc.getElementById('midiRecordStatus').textContent).to.equal('Record writes captured notes into clip steps.');
    expect(clip.steps[0].note).to.equal(60);
    expect(messageCaptureCalls.at(-1)).to.equal(null);
  });

  it('cancels recording before starting learn capture', function() {
    const captureCalls = [];
    const messageCaptureCalls = [];
    const fakeInputController = {
      setNoteCapture(handler) {
        captureCalls.push(handler);
      },
      setMessageCapture(handler) {
        messageCaptureCalls.push(handler);
      },
      attach() {},
      detach() {}
    };
    const { controller, doc } = createControllerHarness();
    controller.setMidiInputController(fakeInputController);
    controller.bindMidiUi();
    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'recorded', name: 'Recorded', lengthSteps: 4 } });

    expect(controller.startRecording()).to.equal(true);
    expect(messageCaptureCalls.at(-1)).to.be.a('function');
    expect(controller.startLearn()).to.equal(true);

    expect(messageCaptureCalls.at(-1)).to.equal(null);
    expect(captureCalls.at(-1)).to.be.a('function');
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Learning next note');
    expect(doc.getElementById('midiRecordStatus').textContent).to.equal('Record writes captured notes into clip steps.');
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
    const { controller, doc, win } = createControllerHarness();
    controller.setMidiInputController(fakeInputController);
    controller.bindMidiUi();
    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'recorded', name: 'Recorded', lengthSteps: 4 } });

    expect(controller.startRecording()).to.equal(true);
    expect(fakeInputController.handler).to.be.a('function');
    expect(fakeInputController.handler({ type: 0x90, note: 64, velocity: 90, channel: 1, timestamp: 0 })).to.equal(true);
    expect(fakeInputController.handler({ type: 0x80, note: 64, velocity: 0, channel: 1, timestamp: 240 })).to.equal(true);
    expect(fakeInputController.handler({ type: 0x90, note: 67, velocity: 88, channel: 1, timestamp: 260 })).to.equal(true);
    expect(controller.commitRecording()).to.equal(true);
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Recorded 2 notes into Recorded');
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('Recorded 2 notes into Recorded');

    const stored = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    const clip = stored.clips.find(entry => entry.id === 'recorded');
    expect(clip.steps[0]).to.include({ note: 64, velocity: 90, durationTicks: 2 });
    expect(clip.steps[1]).to.include({ note: 67, velocity: 88 });
    expect(messageCaptureCalls.at(-1)).to.equal(null);
  });

  it('records only notes that fit in the selected clip', function() {
    const fakeInputController = {
      setNoteCapture() {},
      setMessageCapture(handler) {
        this.handler = handler;
      },
      attach() {},
      detach() {}
    };
    const { controller, doc, win } = createControllerHarness();
    controller.setMidiInputController(fakeInputController);
    controller.bindMidiUi();
    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'one-step', name: 'One Step', lengthSteps: 1 } });

    expect(controller.startRecording()).to.equal(true);
    expect(fakeInputController.handler({ type: 0x90, note: 64, velocity: 90, channel: 1, timestamp: 0 })).to.equal(true);
    expect(fakeInputController.handler({ type: 0x80, note: 64, velocity: 0, channel: 1, timestamp: 120 })).to.equal(true);
    expect(fakeInputController.handler({ type: 0x90, note: 67, velocity: 88, channel: 1, timestamp: 140 })).to.equal(true);
    expect(fakeInputController.handler({ type: 0x80, note: 67, velocity: 0, channel: 1, timestamp: 260 })).to.equal(true);
    expect(controller.commitRecording()).to.equal(true);

    const stored = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    const clip = stored.clips.find(entry => entry.id === 'one-step');
    expect(clip.steps).to.have.lengthOf(1);
    expect(clip.steps[0]).to.include({ note: 64, velocity: 90 });
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('Recorded 1 note into One Step');
  });

  it('does not create clips when recording without a selected clip', function() {
    const fakeInputController = {
      setNoteCapture() {},
      setMessageCapture() {
        throw new Error('record capture should not start');
      },
      attach() {},
      detach() {}
    };
    const { controller, doc } = createControllerHarness();
    controller.setMidiInputController(fakeInputController);
    controller.bindMidiUi();

    expect(controller.startRecording()).to.equal(false);
    expect(controller.getProject().clips).to.have.lengthOf(0);
    expect(doc.getElementById('midiRecordStatus').textContent).to.equal('Create a clip before recording.');
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
    const duration = stepGrid.children[0].children[3].children[0];
    expect(duration.className).to.equal('midi-step-duration');
    expect(duration.value).to.equal('7');
    duration.value = '9';
    duration.dispatchEvent({ type: 'change', target: duration });
    const afterDurationEdit = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(afterDurationEdit.clips[0].steps[0].durationTicks).to.equal(9);
    expect(view.projectConfigs.at(-1).sfx['1'].durationTicks).to.equal(9);

    const stepControl = (stepIndex, childIndex) => stepGrid.children[stepIndex].children[childIndex].children[0];
    const probability = stepControl(1, 4);
    expect(probability.className).to.equal('midi-step-probability');
    probability.value = '0.35';
    probability.dispatchEvent({ type: 'change', target: probability });
    const hold = stepControl(1, 5);
    expect(hold.className).to.equal('midi-step-hold');
    hold.checked = true;
    hold.dispatchEvent({ type: 'change', target: hold });
    const tie = stepControl(1, 6);
    expect(tie.className).to.equal('midi-step-tie');
    tie.checked = true;
    tie.dispatchEvent({ type: 'change', target: tie });
    const afterStepToggles = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(afterStepToggles.clips[0].steps[1]).to.include({ note: 69, probability: 0.35, hold: true, tie: true });
    expect(view.projectConfigs.at(-1).sfx['1']).to.include({ note: 65 });
    expect(view.projectConfigs.at(-1).sfx['1'].notes).to.equal(undefined);

    const rest = stepGrid.children[1].children[7];
    expect(rest.className).to.equal('midi-step-rest');
    rest.dispatchEvent({ type: 'click', target: rest });
    const afterRest = JSON.parse(win.localStorage.getItem(PROJECT_STORAGE_KEY));
    expect(afterRest.clips[0].steps[1]).to.include({
      note: null,
      velocity: null,
      durationTicks: null,
      probability: 1,
      hold: false,
      tie: false
    });
    expect(view.projectConfigs.at(-1).sfx['1']).to.include({ note: 65 });
    expect(view.projectConfigs.at(-1).sfx['1'].notes).to.equal(undefined);

    expect(controller.audition({ sourceId: 'sfx-1' })).to.equal(true);
    expect(sent.map(entry => entry.spec.note)).to.deep.equal([65]);
    expect(sent[0].meta).to.include({ eventType: 'clip-audition', sourceId: 'sfx-1', trackId: 'track-1', clipId: 'riff' });
  });

  it('removes selected clips and cancels active recording capture', function() {
    const messageCaptureCalls = [];
    const fakeInputController = {
      setNoteCapture() {},
      setMessageCapture(handler) {
        messageCaptureCalls.push(handler);
      },
      attach() {},
      detach() {}
    };
    const { controller, doc } = createControllerHarness();
    controller.setMidiInputController(fakeInputController);
    controller.bindMidiUi();
    const remove = doc.getElementById('midiClipRemoveButton');
    expect(remove.disabled).to.equal(true);

    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'riff', name: 'Riff', lengthSteps: 4 } });
    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'fill', name: 'Fill', lengthSteps: 4 } });
    controller.dispatchProjectIntent({ type: 'source.clip.assign', sourceId: 'sfx-1', clipId: 'riff' });
    controller.dispatchProjectIntent({ type: 'clip.select', clipId: 'riff' });
    expect(remove.disabled).to.equal(false);
    expect(controller.startRecording()).to.equal(true);
    expect(messageCaptureCalls.at(-1)).to.be.a('function');

    remove.dispatchEvent({ type: 'click', target: remove });

    const project = controller.getProject();
    expect(messageCaptureCalls.at(-1)).to.equal(null);
    expect(project.clips.map(clip => clip.id)).to.deep.equal(['fill']);
    expect(project.ui.selectedClipId).to.equal('fill');
    expect(project.sources[0]).to.include({ mode: 'direct', clipId: null });
    expect(project.sources[0].mapping).to.include({ note: null, velocity: null });
    expect(doc.getElementById('midiRecordStatus').textContent).to.equal('Record writes captured notes into clip steps.');
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Removed clip Riff');
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('Removed clip Riff');
  });

  it('duplicates the selected clip from the clip library controls', function() {
    const { controller, doc } = createControllerHarness();
    controller.bindMidiUi();
    const duplicateButton = doc.getElementById('midiClipDuplicateButton');
    expect(duplicateButton.disabled).to.equal(true);

    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'riff', name: 'Riff', lengthSteps: 4 } });
    controller.dispatchProjectIntent({ type: 'clip.step.update', clipId: 'riff', stepIndex: 0, patch: { note: 65, velocity: 90 } });
    controller.dispatchProjectIntent({ type: 'source.clip.assign', sourceId: 'sfx-1', clipId: 'riff' });
    expect(duplicateButton.disabled).to.equal(false);

    duplicateButton.dispatchEvent({ type: 'click', target: duplicateButton });

    const project = controller.getProject();
    expect(project.clips.map(clip => clip.id)).to.deep.equal(['riff', 'riff-copy']);
    expect(project.ui.selectedClipId).to.equal('riff-copy');
    expect(project.clips[1]).to.include({ name: 'Riff Copy', lengthSteps: 4 });
    expect(project.clips[1].steps[0]).to.include({ note: 65, velocity: 90 });
    expect(project.sources[0]).to.include({ mode: 'clip', clipId: 'riff' });
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Duplicated clip Riff Copy');
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('Duplicated clip Riff Copy');
  });

  it('reports responsive step grid aria geometry', function() {
    const { controller, doc, win } = createControllerHarness();
    win.innerWidth = 500;
    controller.bindMidiUi();

    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'phone-grid', name: 'Phone Grid', lengthSteps: 4 } });
    const stepGrid = doc.getElementById('midiStepPatternGrid');
    expect(stepGrid.getAttribute('aria-colcount')).to.equal('1');
    expect(stepGrid.getAttribute('aria-rowcount')).to.equal('4');
    expect(stepGrid.children[1].getAttribute('aria-rowindex')).to.equal('2');
    expect(stepGrid.children[1].getAttribute('aria-colindex')).to.equal('1');
    stepGrid.dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      target: stepGrid.children[0].children[1].children[0],
      preventDefault() {}
    });
    expect(doc.activeElement).to.equal(stepGrid.children[1].children[1].children[0]);

    win.innerWidth = 700;
    controller.refreshMidiUiFromConfig();
    expect(stepGrid.getAttribute('aria-colcount')).to.equal('2');
    expect(stepGrid.getAttribute('aria-rowcount')).to.equal('2');
    expect(stepGrid.children[2].getAttribute('aria-rowindex')).to.equal('2');
    expect(stepGrid.children[2].getAttribute('aria-colindex')).to.equal('1');
    stepGrid.dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      target: stepGrid.children[0].children[1].children[0],
      preventDefault() {}
    });
    expect(doc.activeElement).to.equal(stepGrid.children[2].children[1].children[0]);
  });

  it('disables clip assignment when no clip exists', function() {
    const { controller, doc } = createControllerHarness();
    controller.bindMidiUi();

    const assignClip = doc.getElementById('midiAssignClipButton');
    expect(assignClip.disabled).to.equal(true);
    assignClip.dispatchEvent({ type: 'click', target: assignClip });
    expect(controller.getProject().clips).to.have.lengthOf(0);
    expect(controller.getProject().sources[0]).to.include({ mode: 'direct', clipId: null });
  });

  it('keeps source mode direct when clip mode has no clip', function() {
    const { controller, doc } = createControllerHarness();
    controller.bindMidiUi();

    const mode = doc.getElementById('midiSourceModeSelect');
    mode.value = 'clip';
    mode.dispatchEvent({ type: 'change', target: mode });

    expect(controller.getProject().clips).to.have.lengthOf(0);
    expect(controller.getProject().sources[0]).to.include({ mode: 'direct', clipId: null });
    expect(doc.getElementById('midiSourceModeSelect').value).to.equal('direct');
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Create a clip before using clip mode');
  });

  it('filters silent and tied clip steps from runtime clip mappings', function() {
    const { controller, view } = createControllerHarness();
    controller.bindMidiUi();

    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'filtered', name: 'Filtered', lengthSteps: 4 } });
    controller.dispatchProjectIntent({
      type: 'clip.step.update',
      clipId: 'filtered',
      stepIndex: 0,
      patch: { note: 60, probability: 0 }
    });
    controller.dispatchProjectIntent({
      type: 'clip.step.update',
      clipId: 'filtered',
      stepIndex: 1,
      patch: { note: 62, tie: true }
    });
    controller.dispatchProjectIntent({
      type: 'clip.step.update',
      clipId: 'filtered',
      stepIndex: 2,
      patch: { note: 72, velocity: 85, durationTicks: 6 }
    });
    controller.dispatchProjectIntent({
      type: 'clip.step.update',
      clipId: 'filtered',
      stepIndex: 3,
      patch: { note: 76 }
    });
    controller.dispatchProjectIntent({ type: 'source.clip.assign', sourceId: 'sfx-1', clipId: 'filtered' });

    const runtimeMapping = view.projectConfigs.at(-1).sfx['1'];
    expect(runtimeMapping).to.include({ note: 72, velocity: 85, durationTicks: 6, clipId: 'filtered' });
    expect(runtimeMapping.notes).to.deep.equal([72, 76]);
    expect(runtimeMapping.disabled).to.equal(undefined);
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

  it('keeps direct source conflict summaries scoped away from the selected clip', function() {
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
    controller.dispatchProjectIntent({ type: 'track.add', track: { id: 'lead', name: 'Lead', channel: 2 } });
    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'silent', name: 'Silent Clip', lengthSteps: 4 } });
    controller.dispatchProjectIntent({ type: 'source.assignTrack', sourceId: 'sfx-2', trackId: 'lead' });
    controller.dispatchProjectIntent({ type: 'source.clip.assign', sourceId: 'sfx-2', clipId: 'silent' });
    controller.dispatchProjectIntent({ type: 'source.select', sourceId: 'sfx-1' });
    controller.dispatchProjectIntent({ type: 'track.select', trackId: 'track-1' });
    controller.dispatchProjectIntent({ type: 'clip.select', clipId: 'silent' });

    const summary = doc.getElementById('midiConflictSummary');
    expect(summary.className).to.contain('is-clean');
    expect(summary.textContent).to.equal('No conflicts for the selected source.');
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
    expect(doc.getElementById('midiProjectStatus').textContent).to.equal('Reverted builder');
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('Reverted builder');
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

  it('moves source keyboard navigation from the visible fallback row', function() {
    const { controller, doc } = createControllerHarness({
      factoryConfig: {
        enabled: false,
        input: { channel: 'omni' },
        sfx: {
          '1': { name: 'skill-select', note: 60, durationTicks: 4 },
          '2': { name: 'builder', note: 62, durationTicks: 4 },
          '3': { name: 'digger', note: 64, durationTicks: 4 }
        },
        triggers: {}
      }
    });
    controller.bindMidiUi();
    const filter = doc.getElementById('midiSourceAssignFilter');
    filter.value = 'changed';
    filter.dispatchEvent({ type: 'change', target: filter });

    controller.dispatchProjectIntent({ type: 'source.mapping.update', sourceId: 'sfx-2', patch: { note: 70 } });
    controller.dispatchProjectIntent({ type: 'source.mapping.update', sourceId: 'sfx-3', patch: { note: 71 } });
    const sourceList = doc.getElementById('midiSourceList');
    expect(sourceList.getAttribute('aria-activedescendant')).to.equal('midi-source-option-sfx-2');
    sourceList.dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      preventDefault() {}
    });

    expect(controller.getProject().ui.selectedSourceId).to.equal('sfx-3');
    expect(sourceList.getAttribute('aria-activedescendant')).to.equal('midi-source-option-sfx-3');
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

  it('keeps a clip listbox option active when no clip is selected', function() {
    const { controller, doc } = createControllerHarness();
    controller.bindMidiUi();
    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'riff', name: 'Riff', lengthSteps: 4 } });
    controller.dispatchProjectIntent({ type: 'clip.add', clip: { id: 'fill', name: 'Fill', lengthSteps: 4 } });
    controller.dispatchProjectIntent({
      type: 'project.set',
      project: {
        ...controller.getProject(),
        ui: {
          ...controller.getProject().ui,
          selectedClipId: null
        }
      }
    });

    const clipList = doc.getElementById('midiClipList');
    const activeId = clipList.getAttribute('aria-activedescendant');
    const active = clipList.children.find(row => row.id === activeId);
    expect(activeId).to.equal('midi-clip-option-riff');
    expect(active.tabIndex).to.equal(0);
    expect(active.getAttribute('aria-selected')).to.equal('false');
    expect(controller.getProject().ui.selectedClipId).to.equal(null);

    clipList.dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      preventDefault() {}
    });
    expect(controller.getProject().ui.selectedClipId).to.equal('fill');
    expect(clipList.getAttribute('aria-activedescendant')).to.equal('midi-clip-option-fill');
  });

  it('panics by stopping notes and clearing queued MIDI events', function() {
    let allNotesOffCalls = 0;
    let clearQueueCalls = 0;
    const { controller, doc } = createControllerHarness({
      lemmings: {
        midiRouter: {
          scheduler: {
            allNotesOff() {
              allNotesOffCalls += 1;
            },
            clearQueue() {
              clearQueueCalls += 1;
            }
          }
        }
      }
    });
    controller.bindMidiUi();

    expect(controller.panic()).to.equal(true);
    expect(allNotesOffCalls).to.equal(1);
    expect(clearQueueCalls).to.equal(1);
    expect(doc.getElementById('midiOutputLog').textContent).to.contain('Panic sent');
  });

  it('shows queued scheduler pressure when no rate limit is active', function() {
    const { controller, doc } = createControllerHarness({
      lemmings: {
        midiRouter: {
          getRateReport() {
            return null;
          },
          getRateSnapshot() {
            return {
              past: { count: 0 },
              next: { count: 3 }
            };
          }
        }
      }
    });

    controller.bindMidiUi();
    expect(doc.getElementById('midiSchedulerPressure').textContent).to.equal('Scheduler: queued 3');
  });

  it('shows track output labels in track rows', function() {
    const webMidi = {
      enabled: true,
      inputs: [],
      outputs: [{ id: 'out-1', name: 'Output 1' }]
    };
    const { controller, doc } = createControllerHarness({ webMidi });
    controller.bindMidiUi();

    let row = doc.getElementById('midiTrackList').children[0];
    expect(row.children[1].textContent).to.contain('Project output');
    expect(row.getAttribute('aria-label')).to.contain('Project output');

    controller.dispatchProjectIntent({ type: 'track.update', trackId: 'track-1', patch: { outputId: 'out-1' } });
    row = doc.getElementById('midiTrackList').children[0];
    expect(row.children[1].textContent).to.contain('Output 1');
    expect(row.getAttribute('aria-label')).to.contain('Output 1');

    controller.dispatchProjectIntent({ type: 'track.update', trackId: 'track-1', patch: { outputId: 'missing-out' } });
    row = doc.getElementById('midiTrackList').children[0];
    expect(row.children[1].textContent).to.contain('Unavailable: missing-out');
    expect(row.getAttribute('aria-label')).to.contain('Unavailable: missing-out');
  });

  it('rerenders sanitized track numeric controls after invalid edits', function() {
    const { controller, doc, view } = createControllerHarness();
    controller.bindMidiUi();

    const channel = doc.getElementById('midiTrackChannel');
    channel.value = '99';
    channel.dispatchEvent({ type: 'change', target: channel });
    expect(controller.getProject().tracks[0].channel).to.equal(16);
    expect(channel.value).to.equal('16');
    expect(view.projectConfigs.at(-1).sfx['1'].channel).to.equal(16);

    const voiceBudget = doc.getElementById('midiTrackVoiceBudget');
    voiceBudget.value = '99';
    voiceBudget.dispatchEvent({ type: 'change', target: voiceBudget });
    expect(controller.getProject().tracks[0].voiceBudget).to.equal(32);
    expect(voiceBudget.value).to.equal('32');

    const velocityScale = doc.getElementById('midiTrackVelocityScale');
    velocityScale.value = '9';
    velocityScale.dispatchEvent({ type: 'change', target: velocityScale });
    expect(controller.getProject().tracks[0].velocityScale).to.equal(4);
    expect(velocityScale.value).to.equal('4');
  });

  it('summarizes selected source route channel and output', function() {
    const webMidi = {
      enabled: true,
      inputs: [],
      outputs: [{ id: 'out-1', name: 'Output 1' }]
    };
    const { controller, doc } = createControllerHarness({ webMidi });
    controller.bindMidiUi();
    controller.dispatchProjectIntent({
      type: 'track.update',
      trackId: 'track-1',
      patch: { channel: 4, outputId: 'out-1' }
    });

    const summary = doc.getElementById('midiSelectedSourceSummary').textContent;
    expect(summary).to.contain('routes to Track 1 (ch 4, Output 1)');
    expect(summary).to.contain('direct mode');
  });

  it('shows no-device setup state and clears routed outputs', function() {
    let registeredOutputs = null;
    let allNotesOffCalls = 0;
    let clearQueueCalls = 0;
    const webMidi = {
      enabled: true,
      inputs: [],
      outputs: [],
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
            allNotesOff() {
              allNotesOffCalls += 1;
            },
            clearQueue() {
              clearQueueCalls += 1;
            }
          }
        }
      }
    });

    controller.bindMidiUi();
    controller.onEnabled();

    expect(registeredOutputs).to.deep.equal([]);
    expect(view.midiOut).to.equal(null);
    expect(controller.getProject().devices).to.include({ inputId: null, outputId: null });
    expect(doc.getElementById('midiInSelect').disabled).to.equal(true);
    expect(doc.getElementById('midiOutSelect').disabled).to.equal(true);
    expect(doc.getElementById('errorDisplay').textContent).to.contain('No input device');
    expect(doc.getElementById('errorDisplay').textContent).to.contain('No output device');
    expect(allNotesOffCalls).to.equal(1);
    expect(clearQueueCalls).to.equal(1);
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
          getRateReport() {
            return { reason: 'count-limit' };
          },
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
    expect(doc.getElementById('midiSchedulerPressure').textContent).to.equal('Scheduler: count-limit');
    controller.dispatchProjectIntent({ type: 'enabled.set', enabled: true });
    controller.dispatchProjectIntent({
      type: 'track.update',
      trackId: 'track-1',
      patch: { channel: 4, priority: 4, velocityScale: 0.5, voiceBudget: 5 }
    });
    controller.dispatchProjectIntent({
      type: 'source.mapping.update',
      sourceId: 'sfx-1',
      patch: { velocity: 100, pan: -32, timbre: 91, pitchBend: 0.5 }
    });
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
    expect(note.spec).to.include({
      note: 60,
      velocity: 50,
      durationTicks: 4,
      channel: 4,
      pan: -32,
      timbre: 91,
      pitchBend: 0.5,
      trackId: 'track-1',
      voiceBudget: 5,
      outputId: 'out-1'
    });
    expect(note.meta).to.include({
      eventType: 'audition',
      priority: 4,
      sourceId: 'sfx-1',
      trackId: 'track-1',
      voiceBudget: 5,
      outputId: 'out-1'
    });

    expect(controller.panic()).to.equal(true);
    expect(sent.some(entry => entry.panic)).to.equal(true);
  });

  it('falls back to the next output when the selected MIDI output disappears', function() {
    let registeredOutputs = [];
    let allNotesOffCalls = 0;
    let clearQueueCalls = 0;
    const out1 = { id: 'out-1', name: 'Output 1' };
    const out2 = { id: 'out-2', name: 'Output 2' };
    const webMidi = {
      enabled: true,
      inputs: [{ id: 'in-1', name: 'Input 1', addListener() {}, removeListener() {} }],
      outputs: [out1],
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
            allNotesOff() {
              allNotesOffCalls += 1;
            },
            clearQueue() {
              clearQueueCalls += 1;
            }
          }
        }
      }
    });

    controller.bindMidiUi();
    controller.onEnabled();
    expect(controller.getProject().devices.outputId).to.equal('out-1');

    allNotesOffCalls = 0;
    clearQueueCalls = 0;
    webMidi.outputs = [out2];
    controller.onEnabled();

    expect(controller.getProject().devices.outputId).to.equal('out-2');
    expect(doc.getElementById('midiOutSelect').value).to.equal('out-2');
    expect(view.midiOut).to.equal(out2);
    expect(registeredOutputs).to.deep.equal([out2]);
    expect(allNotesOffCalls).to.equal(1);
    expect(clearQueueCalls).to.equal(1);
  });
});
