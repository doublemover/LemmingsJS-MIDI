import { expect } from 'chai';
import { TestDocument } from '../helpers/test-dom.js';
import { registerElement } from '../support/dom-fixtures.js';
import { createMidiTensionControls } from '../../js/app/midi-ui/midiTensionControls.js';
import { createMidiProjectFromMidiConfig, reduceMidiProject } from '../../js/midi/project/MidiProject.js';
import { applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';
const fixture = () => {
  const document = new TestDocument();
  for (const suffix of ['Fields', 'Enabled', 'Amount', 'Healthy', 'Fade', 'Establish', 'Collapse', 'Recovery', 'Breakthrough', 'Hold', 'Lane', 'Status']) {
    const element = registerElement(document, 'input', 'test' + suffix);
    element.removeEventListener = (event, callback) => element.listeners.set(event, (element.listeners.get(event) || []).filter(fn => fn !== callback));
  }
  let project = applyGameEventMidiPreset(createMidiProjectFromMidiConfig({ sfx: {} }), 'game-iron-ensemble'), state = null;
  const controls = createMidiTensionControls({ document, prefix: 'test', getProject: () => project, getLaneCount: () => 8,
    getRouter: () => ({ getLaneMusicTension: () => state }), update: patch => { project = reduceMidiProject(project, { type: 'ensemble.tension.update', patch }); } });
  return { document, controls, el: suffix => document.getElementById('test' + suffix), get project() { return project; }, setState: value => { state = value; } };
};
describe('shared musical tension controls', () => {
  it('edits the saved policy with game-time units while retaining all track and clip edits', () => {
    const f = fixture(), tracks = f.project.tracks, clips = f.project.clips; f.controls.sync();
    expect(f.el('Fade').value).to.equal('5.4');
    const input = f.el('Amount'); f.document.activeElement = input; input.value = '190'; input.dispatchEvent({ type: 'change', target: input });
    expect(f.project.ensemble.tension.amount).to.equal(1); expect(input.value).to.equal('100');
    f.el('Fade').value = '3'; f.el('Fade').dispatchEvent({ type: 'change', target: f.el('Fade') });
    expect(f.project.ensemble.tension.fadeTicks).to.equal(50);
    expect(f.project.tracks).to.deep.equal(tracks); expect(f.project.clips).to.deep.equal(clips); f.controls.dispose();
  });
  it('reports actual lane phase and never replaces an active number edit with status refresh', () => {
    const f = fixture(); f.controls.sync(); f.document.activeElement = f.el('Healthy'); f.el('Healthy').value = '12';
    f.setState({ established: true, alive: 2, strength: 0.75, reason: 'population-decline', soloActorId: 9 });
    f.controls.syncStatus(); expect(f.el('Status').textContent).to.include('2 alive · 75% thinned · population decline');
    expect(f.el('Status').textContent).to.include('actor 9'); f.controls.sync(); expect(f.el('Healthy').value).to.equal('12');
    f.el('Enabled').checked = false; f.el('Enabled').dispatchEvent({ type: 'change', target: f.el('Enabled') });
    expect(f.el('Status').textContent).to.equal('Bypassed'); f.controls.dispose();
  });
  it('disposes edit listeners and handles missing optional controls or unsampled crews', () => {
    const f = fixture(); f.controls.sync(); expect(f.el('Status').textContent).to.include('Waiting');
    const before = f.project; f.controls.dispose(); f.el('Amount').value = '0'; f.el('Amount').dispatchEvent({ type: 'change', target: f.el('Amount') }); expect(f.project).to.equal(before);
    const empty = createMidiTensionControls({ document: new TestDocument(), prefix: 'missing', getProject: () => ({}) }); empty.sync(); empty.syncStatus(); empty.dispose();
  });
});
