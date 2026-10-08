import { expect } from 'chai';
import fs from 'node:fs';
import * as cheerio from 'cheerio';
import { GAME_EVENT_MIDI_PRESETS } from '../js/midi/project/GameEventMidiPresets.js';
import { normalizeSeed } from '../js/core/seededRandom.js';
import { createProcgenUiController } from '../js/app/procgen/ProcgenUiController.js';
import { TestDocument, createTestWindow } from './helpers/test-dom.js';
import { registerElement } from './support/dom-fixtures.js';
const fixture = (search = '') => {
  const document = new TestDocument(), window = createTestWindow(document);
  window.location = { search, href: `https://example.test/procgen.html${search}` };
  for (const target of [document, window]) {
    const events = new Map();
    target.addEventListener = (name, callback) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); };
    target.removeEventListener = (name, callback) => events.get(name)?.delete(callback);
    target.dispatchEvent = event => { for (const callback of events.get(event.type) || []) callback(event); };
  }
  for (const [tag, ids] of [['div', ['procgenDrawer']], ['button', ['procgenTab', 'procgenRestart', 'procgenListen', 'procgenSpeedDown', 'procgenSpeedUp', 'procgenShare', 'procgenNewSeed', 'procgenPause', 'procgenStep', 'procgenFollow', 'procgenZoomIn', 'procgenZoomOut', 'procgenPanic']],
    ['select', ['procgenPreset', 'procgenPack', 'procgenSpeed']], ['input', ['procgenLanes', 'procgenPhrases', 'procgenSeed', 'procgenMasterVolume']],
    ['p', ['procgenMasterVolumeValue', 'procgenPresetDescription', 'procgenAudioStatus', 'procgenRunStatus', 'procgenMetrics', 'procgenStallStatus', 'procgenAliveCount']]]) {
    for (const id of ids) { const el = registerElement(document, tag, id); el.removeEventListener = (event, callback) => el.listeners.set(event, (el.listeners.get(event) || []).filter(fn => fn !== callback)); }
  }
  let restarts = 0;
  const timer = { speedFactor: 3 }, runtime = { view: {}, game: { getGameTimer: () => timer } };
  const ui = createProcgenUiController({ document, window, getRuntime: () => runtime, restart: async () => { restarts++; } });
  return { document, window, ui, timer, runtime, get restarts() { return restarts; }, el: id => document.getElementById(id) };
};
describe('compact procgen drawer', () => {
  it('is hidden and inert initially, opens downward, and Escape closes', () => {
    const f = fixture(); expect(f.el('procgenDrawer').inert).to.equal(true);
    expect(f.el('procgenTab').getAttribute('aria-expanded')).to.equal('false');
    f.el('procgenTab').dispatchEvent({ type: 'click' }); expect(f.el('procgenDrawer').inert).to.equal(false);
    f.document.dispatchEvent({ type: 'keydown', key: 'Escape' }); expect(f.el('procgenDrawer').inert).to.equal(true);
    f.ui.dispose();
  });
  it('does not immediately close a drawer pulled down by the tab', () => {
    const f = fixture(); f.el('procgenTab').dispatchEvent({ type: 'pointerdown', clientY: 1 });
    f.el('procgenTab').dispatchEvent({ type: 'pointerup', clientY: 40 }); f.el('procgenTab').dispatchEvent({ type: 'click' });
    expect(f.el('procgenDrawer').inert).to.equal(false); f.ui.dispose();
  });
  it('normalizes counts and restarts, while speed changes in place', () => {
    const f = fixture(); f.el('procgenLanes').value = '2048'; f.el('procgenLanes').dispatchEvent({ type: 'change' });
    expect(f.ui.settings.laneCount).to.equal(1024); expect(f.restarts).to.equal(1);
    f.el('procgenSpeed').value = '8'; f.el('procgenSpeed').dispatchEvent({ type: 'change' });
    expect(f.timer.speedFactor).to.equal(8); expect(f.restarts).to.equal(1); f.ui.dispose();
  });
  it('offers the shared catalog and never mounts hardware routing/studio controls', () => {
    const f = fixture(); expect(f.el('procgenPreset').children.length).to.equal(GAME_EVENT_MIDI_PRESETS.length);
    expect(f.ui.local.getState().enabled).to.equal(false);
    const html = fs.readFileSync('procgen.html', 'utf8'); expect(html).not.to.match(/midiOutput|midiInput|midiStudio|requestMIDIAccess/);
    expect(html).to.include('max="1024"'); f.ui.dispose();
  });
  it('updates compact metrics and removes its handlers on disposal', () => {
    const f = fixture(); f.ui.syncMetrics({ alive: 1024, spawnedTotal: 2048, distance: { max: 3400 }, generation: 2, admissionPaused: true });
    expect(f.el('procgenAliveCount').textContent).to.equal('1,024 alive');
    expect(f.el('procgenMetrics').textContent).to.include('1,024 alive'); expect(f.el('procgenMetrics').textContent).to.include('admission paused');
    f.ui.dispose(); f.el('procgenRestart').dispatchEvent({ type: 'click' }); expect(f.restarts).to.equal(0);
  });
  it('restores camera, speed, pause, step and restart keys without stealing form input', () => {
    const f = fixture();
    const called = [], camera = { pan: (...offset) => called.push(['pan', ...offset]), setZoom: value => called.push(['zoom', value]),
      getState: () => ({ scale: 3 }), followFrontier: () => called.push(['follow']) };
    f.runtime.lanes = { renderer: { camera }, pause: () => called.push(['pause']), resume: () => called.push(['resume']), step: () => called.push(['step']) };
    const press = (code, extra = {}) => f.window.dispatchEvent({ type: 'keydown', code, preventDefault() {}, ...extra });
    press('ArrowRight', { shiftKey: true }); press('KeyX'); press('KeyV'); press('KeyF');
    expect(called[0]).to.deep.equal(['pan', 48, 0]); expect(called).to.deep.include(['zoom', 3]); expect(called).to.deep.include(['follow']);
    press('Equal', { shiftKey: true }); expect(f.timer.speedFactor).to.equal(8);
    press('Space'); press('BracketRight'); press('Space');
    expect(called.slice(-3)).to.deep.equal([['pause'], ['step'], ['resume']]);
    press('Backspace', { target: { tagName: 'INPUT' } }); expect(f.restarts).to.equal(0);
    press('Backspace'); expect(f.restarts).to.equal(1); f.ui.dispose();
  });
  it('mounts one set of common controls outside the inert drawer', () => {
    const $ = cheerio.load(fs.readFileSync('procgen.html', 'utf8'));
    for (const id of ['procgenRestart', 'procgenSeed', 'procgenLanes', 'procgenPack', 'procgenSpeed', 'procgenPause', 'procgenStep', 'procgenFollow', 'procgenListen', 'procgenMasterVolume', 'procgenPanic', 'procgenTab']) {
      expect($('#' + id).length, id).to.equal(1); expect($('#' + id).closest('#procgenTopbar').length, id).to.equal(1);
      expect($('#' + id).closest('#procgenDrawer').length, id).to.equal(0);
    }
    expect($('#procgenCharacters').closest('#procgenDrawer').length).to.equal(1);
  });
  it('regenerates the chosen seed and reuses pause, step, follow, gain and Panic owners', () => {
    const f = fixture('?seed=42'), calls = [];
    f.runtime.lanes = { pause: () => calls.push('pause'), resume: () => calls.push('resume'), step: () => calls.push('step'), renderer: { camera: { followFrontier: () => calls.push('follow') } } };
    f.el('procgenSeed').value = 'forest'; f.el('procgenRestart').dispatchEvent({ type: 'click' });
    expect(f.ui.settings.seed).to.equal(normalizeSeed('forest')); expect(f.restarts).to.equal(1);
    f.el('procgenPause').dispatchEvent({ type: 'click' }); expect(f.el('procgenPause').textContent).to.equal('Play');
    f.el('procgenStep').dispatchEvent({ type: 'click' }); f.el('procgenFollow').dispatchEvent({ type: 'click' });
    expect(calls).to.deep.equal(['pause', 'pause', 'step', 'follow']);
    f.el('procgenMasterVolume').value = '180'; f.el('procgenMasterVolume').dispatchEvent({ type: 'input', target: f.el('procgenMasterVolume') });
    expect(f.ui.local.audio.getState().masterVolume).to.equal(1.8); expect(f.el('procgenMasterVolumeValue').textContent).to.equal('180%');
    f.ui.local.panic = () => calls.push('panic'); f.el('procgenPanic').dispatchEvent({ type: 'click' }); expect(calls.at(-1)).to.equal('panic');
    f.ui.dispose();
  });
  it('uses validated query appearance and music over stored/default selections without starting audio', () => {
    const f = fixture('?shape=classic&bodyColor=%23ffd447&accessory=crown&eyewear=monocle&speed=150&preset=game-lydian-lanterns&musicMode=phrase');
    expect(f.ui.settings).to.include({ speed: 150, preset: 'game-lydian-lanterns', mode: 'phrase' });
    expect(f.el('procgenPhrases').checked).to.equal(true); expect(f.ui.local.getState().enabled).to.equal(false);
    expect(new URL(f.ui.getShareUrl()).searchParams.get('shape')).to.equal('classic'); f.ui.dispose();
  });
});
