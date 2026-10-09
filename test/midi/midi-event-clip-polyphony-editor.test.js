import { expect } from 'chai';
import { TestDocument } from '../helpers/test-dom.js';
import { registerElement } from '../support/dom-fixtures.js';
import { createMidiEventClipEditor } from '../../js/app/midi-ui/midiEventClipEditor.js';
import { createMidiProjectFromMidiConfig, reduceMidiProject } from '../../js/midi/project/MidiProject.js';

describe('existing cell inspector independent voices and ordered layers', function() {
  it('shows every pitch/dynamic, edits the current model, and adds/removes/reorders bounded layers without changing playback clocks', function() {
    const doc = new TestDocument(), create = doc.createElement.bind(doc);
    doc.createElement = tag => { const el = create(tag); el.replaceChildren = (...children) => { while (el.firstChild) el.removeChild(el.firstChild); el.append(...children); }; el.style.setProperty = () => {}; return el; };
    for (const id of ['midiClipCreate', 'midiClipControls', 'midiEventClipGrid', 'midiEventClipLength', 'midiEventClipAdvance', 'midiEventClipSpacing', 'midiClipSpacingField',
      'midiEventClipNote', 'midiEventClipVelocity', 'midiEventClipDuration', 'midiEventClipProbability', 'midiEventClipPassCounter', 'midiClipPassField', 'midiEventClipPhase',
      'midiEventClipTranspose', 'midiEventClipOctave', 'midiEventClipInterval', 'midiEventClipSpan', 'midiEventClipTransformUnit', 'midiEventClipCondition', 'midiEventClipEvery',
      'midiEventClipHint', 'midiEventClipVoices', 'midiEventClipVoiceAdd', 'midiEventClipLayers', 'midiEventClipLayerAdd']) registerElement(doc, 'div', id);
    let project = createMidiProjectFromMidiConfig({ enabled: false, sfx: { 20: { note: 60, channel: 1 } } });
    project = reduceMidiProject(project, { type: 'clip.add', clip: { id: 'poly', lengthSteps: 8, playback: { advance: 'event', spacingTicks: 2 },
      steps: [{ voices: [{ note: 60, velocity: 40, durationTicks: 8 }, { note: 67, velocity: 90, durationTicks: 2 }] }] } });
    project = reduceMidiProject(project, { type: 'source.clip.assign', sourceId: project.sources[0].id, clipId: 'poly' });
    let editor; const step = () => project.clips.find(clip => clip.id === 'poly').steps[0];
    editor = createMidiEventClipEditor({ document: doc, bind: (id, type, action) => doc.getElementById(id)?.addEventListener(type, action),
      getProject: () => project, getSource: () => project.sources[0], commitProject: next => { project = next; }, history: { beginGesture() {}, endGesture() {} }, setStatus() {},
      dispatch: intent => { project = reduceMidiProject(project, intent); editor.render(); } });
    editor.initialize(); editor.render();
    const change = (element, value) => { element.value = String(value); element.dispatchEvent({ type: 'change', target: element }); };
    const click = element => element.dispatchEvent({ type: 'click' });
    const voiceRoot = doc.getElementById('midiEventClipVoices'), layerRoot = doc.getElementById('midiEventClipLayers');
    expect(doc.getElementById('midiEventClipGrid').children[0].getAttribute('aria-label')).to.contain('C4, G4');
    expect(doc.getElementById('midiEventClipGrid').children[0].children).to.have.length(3);
    expect(voiceRoot.querySelectorAll('.midi-clip-voice-note').map(input => input.value)).to.deep.equal(['C4', 'G4']);
    change(voiceRoot.querySelectorAll('.midi-clip-voice-durationTicks')[1], '6');
    change(voiceRoot.querySelectorAll('.midi-clip-voice-velocity')[0], '75');
    expect(step().voices).to.deep.equal([{ note: 60, velocity: 75, durationTicks: 8 }, { note: 67, velocity: 90, durationTicks: 6 }]);
    const existingSecondPitch = voiceRoot.querySelectorAll('.midi-clip-voice-note')[1];
    project = reduceMidiProject(project, { type: 'clip.step.update', clipId: 'poly', stepIndex: 0, patch: { probability: 0.4 } });
    change(existingSecondPitch, 'A4'); expect(step().probability).to.equal(0.4); expect(step().voices[1].note).to.equal(69);
    for (let index = 0; index < 8; index++) click(doc.getElementById('midiEventClipVoiceAdd'));
    expect(step().voices).to.have.length(8); expect(doc.getElementById('midiEventClipVoiceAdd').disabled).to.equal(true);
    click(voiceRoot.children[1].children.at(-1)); expect(step().voices).to.have.length(7);
    for (let index = 0; index < 5; index++) click(doc.getElementById('midiEventClipLayerAdd'));
    expect(step().transformLayers).to.have.length(4); expect(doc.getElementById('midiEventClipLayerAdd').disabled).to.equal(true);
    change(layerRoot.querySelectorAll('.midi-clip-layer-type')[0], 'repeat');
    change(layerRoot.querySelectorAll('.midi-clip-layer-spacingTicks')[0], '3');
    expect(step().transformLayers[0]).to.include({ type: 'repeat', spacingTicks: 3 });
    click(layerRoot.children[0].children.at(-2)); expect(step().transformLayers[1].type).to.equal('repeat');
    click(layerRoot.children[1].children.at(-1)); expect(step().transformLayers).to.have.length(3);
    expect(project.enabled).to.equal(false); expect(project.clips[0].playback).to.include({ advance: 'event', spacingTicks: 2 });
    editor.dispose();
  });
});
