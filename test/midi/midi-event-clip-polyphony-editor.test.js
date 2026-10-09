import { expect } from 'chai';
import { TestDocument } from '../helpers/test-dom.js';
import { registerElement } from '../support/dom-fixtures.js';
import { createMidiEventClipEditor } from '../../js/app/midi-ui/midiEventClipEditor.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
import { makeOutput } from '../support/midi-output.js';
import { createMidiProjectFromMidiConfig, reduceMidiProject, sanitizeMidiProject, projectToMidiConfig } from '../../js/midi/project/MidiProject.js';

const createEditorFixture = (clip = {}) => {
  const doc = new TestDocument(), create = doc.createElement.bind(doc);
  doc.createElement = tag => { const el = create(tag); el.replaceChildren = (...children) => { while (el.firstChild) el.removeChild(el.firstChild); el.append(...children); }; el.style.setProperty = () => {}; el.setSelectionRange = (start, end, direction) => { el.selectionStart = start; el.selectionEnd = end; el.selectionDirection = direction; }; return el; };
  for (const id of ['midiClipCreate', 'midiClipControls', 'midiEventClipGrid', 'midiEventClipLength', 'midiEventClipAdvance', 'midiEventClipSpacing', 'midiClipSpacingField',
    'midiEventClipNote', 'midiEventClipVelocity', 'midiEventClipDuration', 'midiEventClipProbability', 'midiEventClipPassCounter', 'midiClipPassField', 'midiEventClipPhase',
    'midiEventClipTranspose', 'midiEventClipOctave', 'midiEventClipInterval', 'midiEventClipSpan', 'midiEventClipTransformUnit', 'midiEventClipCondition', 'midiEventClipEvery',
    'midiEventClipHold', 'midiEventClipTie', 'midiEventClipHint', 'midiEventClipVoices', 'midiEventClipVoiceAdd', 'midiEventClipLayers', 'midiEventClipLayerAdd']) registerElement(doc, 'div', id);
  let project = createMidiProjectFromMidiConfig({ enabled: false, mpe: { enabled: false }, durationTicks: { min: 1, max: 960, default: 4 }, scale: { name: 'chromatic', root: 0 }, density: { velocityBoost: 0, durationScale: 0 }, sfx: { 20: { note: 60, channel: 1 } } });
  project = reduceMidiProject(project, { type: 'clip.add', clip: { id: 'poly', lengthSteps: 8, playback: { advance: 'event', spacingTicks: 2 },
    steps: [{ voices: [{ note: 60, velocity: 40, durationTicks: 8 }, { note: 67, velocity: 90, durationTicks: 2 }] }], ...clip } });
  project = reduceMidiProject(project, { type: 'source.clip.assign', sourceId: project.sources[0].id, clipId: 'poly' });
  let editor; const step = () => project.clips.find(clip => clip.id === 'poly').steps[0];
  editor = createMidiEventClipEditor({ document: doc, bind: (id, type, action) => doc.getElementById(id)?.addEventListener(type, action),
    getProject: () => project, getSource: () => project.sources[0], commitProject: next => { project = next; }, history: { beginGesture() {}, endGesture() {} }, setStatus() {},
    dispatch: intent => { project = reduceMidiProject(project, intent); editor.render(); } });
  editor.initialize(); editor.render();
  return { doc, editor, step, getProject: () => project, dispatch: intent => { project = reduceMidiProject(project, intent); editor.render(); } };
};

describe('existing cell inspector independent voices and ordered layers', function() {
  it('shows every pitch/dynamic, edits the current model, and adds/removes/reorders bounded layers without changing playback clocks', function() {
    const { doc, editor, step, dispatch, getProject } = createEditorFixture();
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
    dispatch({ type: 'clip.step.update', clipId: 'poly', stepIndex: 0, patch: { probability: 0.4 } });
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
    expect(getProject().enabled).to.equal(false); expect(getProject().clips[0].playback).to.include({ advance: 'event', spacingTicks: 2 });
    editor.dispose();
  });
  it('retains the focused voice pitch/caret and layer field across edits without targeting another cell', function() {
    const f = createEditorFixture({ steps: [{ voices: [{ note: 60 }, { note: 67 }], transformLayers: [{ type: 'repeat', count: 2, spacingTicks: 2 }] }, { note: 72 }] });
    const voices = f.doc.getElementById('midiEventClipVoices'), layers = f.doc.getElementById('midiEventClipLayers');
    const pitch = voices.querySelectorAll('.midi-clip-voice-note')[1]; pitch.focus(); pitch.value = 'A4'; pitch.setSelectionRange(1, 2, 'backward');
    pitch.dispatchEvent({ type: 'change', target: pitch });
    const restored = voices.querySelectorAll('.midi-clip-voice-note')[1];
    expect(f.doc.activeElement).to.equal(restored); expect(restored.value).to.equal('A4');
    expect([restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).to.deep.equal([1, 2, 'backward']);
    const spacing = layers.querySelectorAll('.midi-clip-layer-spacingTicks')[0]; spacing.focus(); spacing.value = '3'; spacing.dispatchEvent({ type: 'change', target: spacing });
    expect(f.doc.activeElement).to.equal(layers.querySelectorAll('.midi-clip-layer-spacingTicks')[0]);
    expect(f.step().transformLayers[0].spacingTicks).to.equal(3); expect(f.step().voices.map(voice => voice.note)).to.deep.equal([60, 69]);
    expect(f.getProject().clips[0].steps[1].note).to.equal(72); expect(f.getProject().enabled).to.equal(false);
    f.editor.dispose();
  });
  it('edits stored compact Hold/Tie with truthful modes and dispatches bounded independent gates through the existing router', function() {
    withFakeClockAndPerformance(clock => {
      const f = createEditorFixture({ lengthSteps: 4, playback: { advance: 'game-tick', spacingTicks: 2 },
        steps: [{ voices: [{ note: 60, durationTicks: 1 }, { note: 64, durationTicks: 1 }] }, { note: 60 }, { note: null }, { note: 67, durationTicks: 1 }] });
      const hold = f.doc.getElementById('midiEventClipHold'), tie = f.doc.getElementById('midiEventClipTie'), grid = f.doc.getElementById('midiEventClipGrid');
      hold.checked = true; hold.dispatchEvent({ type: 'change', target: hold });
      grid.dispatchEvent({ type: 'keydown', key: 'ArrowRight', target: grid, preventDefault() {}, stopPropagation() {} });
      tie.checked = true; tie.dispatchEvent({ type: 'change', target: tie });
      expect(hold.checked).to.equal(false); expect(tie.checked).to.equal(true);
      expect(hold.title).to.include('next played cell'); expect(tie.title).to.include('preceding played voices');
      const clean = sanitizeMidiProject(JSON.parse(JSON.stringify(f.getProject()))), cells = clean.clips[0].steps;
      expect(cells[0].hold).to.equal(true); expect(cells[1].tie).to.equal(true); expect(cells[0].voices).to.have.length(2); expect(cells[2].note).to.equal(null);
      const router = new MidiEventRouter({ ...projectToMidiConfig(clean), enabled: true, density: { velocityBoost: 0, durationScale: 0 } }), calls = [], timer = { tick: 0, frameTime: 60, onGameTick: new EventHandler(), getGameTicks() { return this.tick; } };
      router.setOutput(makeOutput([1], calls)); router.attach({ onEvent: new EventHandler(), gameTimer: timer });
      const advance = () => { clock.tick(60); timer.tick++; timer.onGameTick.trigger(); };
      try {
        router._onEvent({ sfxId: 20, tick: 0, frameMs: 60, lemmingId: 7 });
        expect(calls.filter(call => call.type === 'noteOn').map(call => call.note)).to.deep.equal([60, 64]);
        for (let index = 0; index < 5; index++) advance();
        expect(calls.filter(call => call.type === 'noteOff')).to.have.length(0);
        advance(); expect(calls.filter(call => call.type === 'noteOff').map(call => call.note)).to.deep.equal([60, 64]);
        expect(calls.filter(call => call.type === 'noteOn').map(call => call.note)).to.deep.equal([60, 64, 67]);
        advance(); expect(router.scheduler._activeNotes.size).to.equal(0);
        router._onEvent({ sfxId: 20, tick: timer.tick, frameMs: 60, lemmingId: 7 }); const count = calls.filter(call => call.type === 'noteOn').length;
        router.scheduler.allNotesOff(); for (let index = 0; index < 10; index++) advance();
        expect(calls.filter(call => call.type === 'noteOn')).to.have.length(count); expect(router.scheduler._activeNotes.size).to.equal(0); expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
        for (const playback of [{ advance: 'event', spacingTicks: 2 }, null]) {
          f.dispatch({ type: 'clip.update', clipId: 'poly', patch: { playback } });
          expect(tie.checked).to.equal(true); expect(hold.title).to.include(playback ? 'one-cell-per-event' : 'legacy'); expect(tie.title).to.include(playback ? 'Skips this event cell' : 'legacy');
        }
        expect(f.getProject().clips[0].steps[0].hold).to.equal(true); expect(f.getProject().enabled).to.equal(false);
      } finally { router.dispose(); f.editor.dispose(); }
    });
  });

});
