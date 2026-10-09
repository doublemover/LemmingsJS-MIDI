import { expect } from 'chai';
import fs from 'node:fs';
import { createMidiProjectFromMidiConfig, sanitizeMidiProject, reduceMidiProject, projectToMidiConfig, stringifyMidiProjectExport, importMidiProjectPayload } from '../../js/midi/project/MidiProject.js';
import { saveMidiProjectWithOutcome, readStoredMidiProject } from '../../js/midi/project/MidiProjectStorage.js';
import { applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';
import { createMidiEditHistory } from '../../js/app/midi-ui/midiEditHistory.js';
import { createMidiMusicDirectionControls, musicDirectionStatus } from '../../js/app/midi-ui/midiMusicDirectionControls.js';
import { createMidiInstrumentWorkbench } from '../../js/app/midi-ui/midiInstrumentWorkbench.js';
import { TestDocument, createTestWindow } from '../helpers/test-dom.js';
import { registerElement } from '../support/dom-fixtures.js';

const initial = () => createMidiProjectFromMidiConfig({ enabled: false, mpe: { enabled: false }, sfx: { 20: { notes: [60, 64], velocity: 109, phrase: { enabled: true, spacingTicks: 3 } } } });
const selectRecipe = (project, recipe) => reduceMidiProject(project, { type: 'global.update', patch: { musicDirector: { recipe } } });
const controlsFixture = (prefix = 'testMusic') => {
  const document = new TestDocument(); document.body = document.createElement('body');
  const select = registerElement(document, 'select', prefix + 'Recipe'), status = registerElement(document, 'output', prefix + 'Status');
  select.removeEventListener = (event, callback) => select.listeners.set(event, (select.listeners.get(event) || []).filter(fn => fn !== callback));
  return { document, select, status };
};

describe('canonical music recipe and shared direction controls', () => {
  it('defaults old and malformed projects to event music and excludes transient director state', () => {
    const old = initial(); delete old.global.musicDirector;
    expect(sanitizeMidiProject(old).global.musicDirector).to.deep.equal({ recipe: 'events' });
    for (const recipe of [undefined, null, 'unknown', true, 4]) expect(createMidiProjectFromMidiConfig({ musicDirector: { recipe } }).global.musicDirector).to.deep.equal({ recipe: 'events' });
    const p = reduceMidiProject(initial(), { type: 'global.update', patch: { musicDirector: { recipe: 'scenes', pending: 'construction', nextBar: 9 } } });
    expect(p.global.musicDirector).to.deep.equal({ recipe: 'scenes' }); expect(p.enabled).to.equal(false);
    expect(projectToMidiConfig(p).musicDirector).to.deep.equal({ recipe: 'scenes' });
  });
  it('round-trips recipe through config, project/template exports and canonical storage without rewriting mappings', () => {
    const base = initial(), p = selectRecipe(base, 'scenes'), config = projectToMidiConfig(p);
    expect(config.sfx).to.deep.equal(projectToMidiConfig(base).sfx); expect(config.triggers).to.deep.equal(projectToMidiConfig(base).triggers);
    expect(p.tracks).to.deep.equal(base.tracks); expect(p.sources).to.deep.equal(base.sources); expect(p.clips).to.deep.equal(base.clips);
    expect(createMidiProjectFromMidiConfig(config).global.musicDirector.recipe).to.equal('scenes');
    for (const asTemplate of [false, true]) expect(importMidiProjectPayload(stringifyMidiProjectExport(p, { asTemplate })).global.musicDirector.recipe).to.equal('scenes');
    const data = new Map(), storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
    expect(saveMidiProjectWithOutcome(storage, p).persisted).to.equal(true); expect(readStoredMidiProject(storage).global.musicDirector.recipe).to.equal('scenes');
    expect(applyGameEventMidiPreset(p, 'game-iron-ensemble').global.musicDirector.recipe).to.equal('scenes');
    expect(projectToMidiConfig(selectRecipe(p, 'events')).sfx).to.deep.equal(config.sfx);
  });
  it('uses existing musical Undo and Redo while preserving device and output state', () => {
    let p = initial(); const history = createMidiEditHistory(), commit = next => { history.record(p, next); p = next; };
    commit(selectRecipe(p, 'scenes')); p = { ...p, enabled: true, devices: { ...p.devices, outputId: 'kept' } };
    expect(history.undo(p, commit)).to.equal(true); expect(p.global.musicDirector.recipe).to.equal('events'); expect(p.enabled).to.equal(true); expect(p.devices.outputId).to.equal('kept');
    expect(history.redo(p, commit)).to.equal(true); expect(p.global.musicDirector.recipe).to.equal('scenes');
  });
  it('shows committed and pending direction separately with actual cue outcomes', () => {
    expect(musicDirectionStatus('scenes', { enabled: true, current: 'exploration', pending: 'construction', nextBar: 7, cue: 'reply-pending' })).to.equal('Exploring · Building next bar 7 · Reply queued');
    expect(musicDirectionStatus('scenes', { enabled: true, current: 'relief', pending: null, cue: 'thinned' })).to.equal('Relief · Cue thinned');
    expect(musicDirectionStatus('scenes', { enabled: true, current: 'construction', cue: 'pending' })).to.equal('Building · Breakthrough queued');
    expect(musicDirectionStatus('scenes', null)).to.equal('Scene replies · waiting for output');
  });
  it('does no director reads by default and keeps focused controls stationary through status updates', () => {
    const f = controlsFixture(); let p = initial(), reads = 0, direction = null;
    const controls = createMidiMusicDirectionControls({ ...f, prefix: 'testMusic', getProject: () => p, update: patch => { p = selectRecipe(p, patch.recipe); }, getRouter: () => ({ getMusicDirection: () => { reads++; return direction; } }) });
    controls.sync(); expect(reads).to.equal(0); expect(f.status.textContent).to.equal('Event music');
    f.document.activeElement = f.select; f.select.value = 'scenes'; f.select.dispatchEvent({ type: 'change', target: f.select });
    expect(p.enabled).to.equal(false); direction = { enabled: true, current: 'exploration', pending: 'construction', nextBar: 2, cue: 'idle' };
    controls.syncStatus(); const statusNode = f.status; expect(statusNode.textContent).to.equal('Exploring · Building next bar 2');
    f.select.value = 'events'; direction = { enabled: true, current: 'construction', pending: null, cue: 'reply-pending' }; controls.sync();
    expect(f.document.activeElement).to.equal(f.select); expect(f.select.value).to.equal('events'); expect(f.status).to.equal(statusNode); expect(f.status.textContent).to.equal('Building · Reply queued');
    expect(f.status.title).to.equal(f.status.textContent); controls.dispose(); const before = p; f.select.dispatchEvent({ type: 'change', target: f.select }); expect(p).to.equal(before);
  });
  it('routes the normal workbench selector through its existing commit/history owner', () => {
    const f = controlsFixture('midiMusic'), window = createTestWindow(f.document); let p = initial(); const history = createMidiEditHistory();
    const commitProject = next => { history.record(p, next); p = next; };
    const workbench = createMidiInstrumentWorkbench({ document: f.document, window, getLemmings: () => null, getProject: () => p, getSource: () => null, updateMapping() {}, updateSource() {}, commitProject, chooseView() {}, bind: (id, event, fn) => f.document.getElementById(id)?.addEventListener(event, fn), panic() {}, history, setStatus() {} });
    workbench.initialize(); f.select.value = 'scenes'; f.select.dispatchEvent({ type: 'change', target: f.select });
    expect(p.global.musicDirector.recipe).to.equal('scenes'); expect(history.state().canUndo).to.equal(true); history.undo(p, commitProject); workbench.render(); expect(f.select.value).to.equal('events'); workbench.dispose();
  });
  it('supports optional controls and stops status polling on disposal', () => {
    const document = new TestDocument(), status = registerElement(document, 'output', 'optionalStatus'), project = selectRecipe(initial(), 'scenes');
    const controls = createMidiMusicDirectionControls({ document, prefix: 'optional', getProject: () => project, update() { throw Error('No edit expected'); } });
    controls.sync(); expect(status.textContent).to.equal('Scene replies · waiting for output'); controls.dispose(); status.textContent = 'retained'; controls.sync(); controls.syncStatus(); expect(status.textContent).to.equal('retained');
    const absent = createMidiMusicDirectionControls({ document: new TestDocument(), prefix: 'absent', getProject: () => ({}) }); absent.sync(); absent.syncStatus(); absent.dispose();
    expect(musicDirectionStatus('scenes', { enabled: true, pending: 'relief', nextBar: NaN, cue: 'idle' })).to.equal('Exploring · Relief next bar');
  });
  it('provides one fixed-height status slot beside existing palette/action controls', () => {
    for (const [page, prefix, css] of [['index.html', 'midiMusic', 'css/midi-instrument.css'], ['procgen.html', 'procgenMusic', 'css/procgen.css']]) {
      const html = fs.readFileSync(new URL('../../' + page, import.meta.url), 'utf8');
      expect((html.match(new RegExp('id="' + prefix + 'Recipe"', 'g')) || []).length).to.equal(1); expect(html).to.include('id="' + prefix + 'Status" class="midi-music-direction-status" role="status" aria-live="off"');
      expect(fs.readFileSync(new URL('../../' + css, import.meta.url), 'utf8')).to.match(/\.midi-music-direction-status[^}]*height: 12px[^}]*white-space: nowrap/);
    }
  });
});
