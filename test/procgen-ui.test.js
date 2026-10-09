import { expect } from 'chai';
import fs from 'node:fs';
import * as cheerio from 'cheerio';
import { PROCGEN_GAME_EVENT_MIDI_PRESETS } from '../js/midi/project/ProcgenMidiDefaults.js';
import { createMidiProjectFromMidiConfig, sanitizeMidiProject, projectToMidiConfig } from '../js/midi/project/MidiProject.js';
import { createMidiSpan } from '../js/app/midi-ui/midiAutomationSpanEditor.js';
import { normalizeSeed } from '../js/core/seededRandom.js';
import { createProcgenUiController } from '../js/app/procgen/ProcgenUiController.js';
import { TestDocument, createTestWindow } from './helpers/test-dom.js';
import { registerElement } from './support/dom-fixtures.js';
const fixture = (search = '', storedLanes = null, preferences = {}, restartResult = null) => {
  const document = new TestDocument(), window = createTestWindow(document);
  if (storedLanes != null) window.localStorage.setItem('lemmings.procgen.lanes.v1', JSON.stringify(storedLanes));
  for (const [key, value] of Object.entries(preferences)) window.localStorage.setItem(key, JSON.stringify(value));
  window.location = { search, href: `https://example.test/procgen.html${search}` };
  for (const target of [document, window]) {
    const events = new Map();
    target.addEventListener = (name, callback) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); };
    target.removeEventListener = (name, callback) => events.get(name)?.delete(callback);
    target.dispatchEvent = event => { for (const callback of events.get(event.type) || []) callback(event); };
  }
  for (const [tag, ids] of [['div', ['procgenDrawer', 'procgenPanel', 'procgenSpanList']], ['details', ['procgenHelpFields']], ['canvas', ['gameCanvas']], ['button', ['procgenTab', 'procgenHelp', 'procgenRestart', 'procgenListen', 'procgenSpeedDown', 'procgenSpeedUp', 'procgenShare', 'procgenNewSeed', 'procgenPause', 'procgenStep', 'procgenFollow', 'procgenZoomIn', 'procgenZoomOut', 'procgenPanic', 'procgenCctvPin', 'procgenCctvClear', 'procgenSpanAdd', 'procgenSpanPresetApply', 'procgenSpanUndo', 'procgenSpanRedo']],
    ['select', ['procgenPreset', 'procgenPack', 'procgenSpeed', 'procgenCctvMode', 'procgenSpanDomain', 'procgenSpanTarget', 'procgenSpanPreset']], ['input', ['procgenLanes', 'procgenPhrases', 'procgenSeed', 'procgenMasterVolume', 'procgenCctvLane', 'procgenWorkerBashers', 'procgenWorkerDiggers', 'procgenWorkerBuilders', 'procgenLaneHeight', 'procgenCctvEnabled', 'procgenScoutsEvery', 'procgenScoutDelay', 'procgenSpawnSpread', 'procgenSpawnPriority', 'procgenSpanEdit', 'procgenSpanVisible']],
    ['p', ['procgenMasterVolumeValue', 'procgenPresetDescription', 'procgenAudioStatus', 'procgenRunStatus', 'procgenMetrics', 'procgenStallStatus', 'procgenAliveCount', 'procgenDistance', 'procgenBest', 'procgenCctvStatus', 'procgenNukeStatus', 'procgenOutputPressure', 'procgenSpanPresetStatus', 'procgenSpanHistoryStatus']]]) {
    for (const id of ids) { const el = registerElement(document, tag, id); el.removeEventListener = (event, callback) => el.listeners.set(event, (el.listeners.get(event) || []).filter(fn => fn !== callback)); }
  }
  let restarts = 0;
  const timer = { speedFactor: 3 }, runtime = { view: {}, game: { getGameTimer: () => timer } };
  const ui = createProcgenUiController({ document, window, getRuntime: () => runtime, restart: async () => { restarts++; if (restartResult) return restartResult(); } });
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
  it('starts eight lanes and preserves explicit saved and URL choices', () => {
    for (const [search, stored, expected] of [['', null, 8], ['', { version: 1, value: 24 }, 24], ['?lanes=3', { version: 1, value: 24 }, 3], ['', { version: 1, value: -5 }, 8]]) {
      const f = fixture(search, stored); expect(f.ui.settings.laneCount).to.equal(expected); f.ui.dispose();
    }
    const f = fixture(); f.el('procgenLanes').value = '12'; f.el('procgenLanes').dispatchEvent({ type: 'change' });
    expect(JSON.parse(f.window.localStorage.getItem('lemmings.procgen.lanes.v1')).value).to.equal(12);
    f.el('procgenLanes').value = ''; f.el('procgenLanes').dispatchEvent({ type: 'change' });
    expect(f.ui.settings.laneCount).to.equal(12); expect(f.restarts).to.equal(1); f.ui.dispose();
  });
  it('normalizes counts and restarts, while speed changes in place', () => {
    const f = fixture(); f.el('procgenLanes').value = '2048'; f.el('procgenLanes').dispatchEvent({ type: 'change' });
    expect(f.ui.settings.laneCount).to.equal(1024); expect(f.restarts).to.equal(1);
    f.el('procgenSpeed').value = '8'; f.el('procgenSpeed').dispatchEvent({ type: 'change' });
    expect(f.timer.speedFactor).to.equal(8); expect(f.restarts).to.equal(1); f.ui.dispose();
  });
  it('retains Director mode and pins when a replacement renderer reports its initial empty state', () => {
    const f = fixture();
    const createCctv = () => ({ mode: 'leaders', pins: [], enabled: false,
      getState() { return { mode: this.mode, pins: [...this.pins], enabled: this.enabled, slots: [] }; },
      setEnabled(enabled) { this.enabled = enabled; this.onChange?.(this.getState()); },
      setMode(mode) { this.mode = mode; this.onChange?.(this.getState()); },
      setPins(pins) { this.pins = [...pins]; this.onChange?.(this.getState()); },
      togglePin(lane) { this.pins = this.pins.includes(lane) ? this.pins.filter(value => value !== lane) : [...this.pins, lane]; this.onChange?.(this.getState()); return true; }
    });
    f.runtime.lanes = { renderer: { cctv: createCctv() } }; f.ui.sync();
    f.el('procgenCctvMode').value = 'director'; f.el('procgenCctvMode').dispatchEvent({ type: 'change' });
    f.el('procgenCctvLane').value = '9'; f.el('procgenCctvPin').dispatchEvent({ type: 'click' });
    expect(f.ui.settings.cctvPins).to.deep.equal([8]);
    f.el('procgenCctvEnabled').checked = true; f.el('procgenCctvEnabled').dispatchEvent({ type: 'change', target: f.el('procgenCctvEnabled') });
    f.runtime.lanes.renderer.cctv = createCctv(); f.ui.sync();
    expect(f.runtime.lanes.renderer.cctv.enabled).to.equal(true); expect(f.runtime.lanes.renderer.cctv.mode).to.equal('director'); expect(f.runtime.lanes.renderer.cctv.pins).to.deep.equal([8]);
    f.el('procgenCctvClear').dispatchEvent({ type: 'click' }); expect(f.ui.settings.cctvPins).to.deep.equal([]); f.ui.dispose();
  });
  it('applies and saves bounded crew limits in place and preserves the last choice on invalid edits', () => {
    const f = fixture(), calls = [], stored = new Map();
    f.window.localStorage = { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) };
    f.runtime.world = { actors: [], setWorkerLimits: limits => calls.push({ ...limits }) }; f.ui.sync();
    f.el('procgenWorkerBashers').value = '4'; f.el('procgenWorkerBashers').dispatchEvent({ type: 'change', target: f.el('procgenWorkerBashers') });
    f.el('procgenWorkerDiggers').value = '19'; f.el('procgenWorkerDiggers').dispatchEvent({ type: 'change', target: f.el('procgenWorkerDiggers') });
    expect(calls.at(-1)).to.deep.equal({ bashers: 4, diggers: 16, builders: 8 }); expect(f.restarts).to.equal(0);
    f.el('procgenWorkerBashers').value = ''; f.el('procgenWorkerBashers').dispatchEvent({ type: 'change', target: f.el('procgenWorkerBashers') });
    expect(f.el('procgenWorkerBashers').value).to.equal('4'); expect(JSON.parse(stored.get('lemmings.procgen.workerLimits.v1')).value.bashers).to.equal(4); f.ui.dispose();
  });
  it('applies scout cadence and birth priority live, preserving saved preferences and invalid edits', () => {
    const f = fixture('', null, { 'lemmings.procgen.population.v1': { version: 1, value: { scoutsEvery: 0, scoutDelayTicks: 60, spawnSpreadTicks: 0 } }, 'lemmings.procgen.spawnPriority.v1': { version: 1, value: 7 } });
    const calls = []; f.runtime.world = { actors: [], setPopulationPolicy: policy => calls.push({ ...policy }) }; f.ui.sync();
    expect(f.ui.settings.populationPolicy).to.include({ scoutsEvery: 0, scoutDelayTicks: 60, spawnSpreadTicks: 0 });
    expect(f.el('procgenSpawnPriority').value).to.equal(7);
    f.el('procgenScoutsEvery').value = '12'; f.el('procgenScoutsEvery').dispatchEvent({ type: 'change', target: f.el('procgenScoutsEvery') });
    expect(calls.at(-1).scoutsEvery).to.equal(12); expect(calls.at(-1).spawnBeatTicks).to.be.greaterThan(0);
    f.el('procgenSpawnPriority').value = '150'; f.el('procgenSpawnPriority').dispatchEvent({ type: 'change', target: f.el('procgenSpawnPriority') });
    expect(f.el('procgenSpawnPriority').value).to.equal(100);
    f.el('procgenPreset').value = 'procgen-airy-arrivals'; f.el('procgenPreset').dispatchEvent({ type: 'change' }); expect(f.el('procgenSpawnPriority').value).to.equal(100);
    f.el('procgenScoutsEvery').value = ''; f.el('procgenScoutsEvery').dispatchEvent({ type: 'change', target: f.el('procgenScoutsEvery') }); expect(f.el('procgenScoutsEvery').value).to.equal(12);
    expect(f.restarts).to.equal(0); expect(f.ui.local.getState().enabled).to.equal(false);
    expect(JSON.parse(f.window.localStorage.getItem('lemmings.procgen.population.v1')).value.scoutsEvery).to.equal(12); f.ui.dispose();
  });
  it('restores deliberate physical height and favorite music while URL choices take precedence', () => {
    const preferences = { 'lemmings.procgen.laneHeight.v1': { version: 1, value: 96 }, 'lemmings.procgen.music.v1': { version: 1, preset: 'game-lydian-lanterns', mode: 'phrase' } };
    const f = fixture('', null, preferences); expect(f.ui.settings).to.include({ laneHeight: 96, preset: 'game-lydian-lanterns', mode: 'phrase' });
    f.el('procgenLaneHeight').value = '200'; f.el('procgenLaneHeight').dispatchEvent({ type: 'change', target: f.el('procgenLaneHeight') });
    expect(f.restarts).to.equal(1); expect(JSON.parse(f.window.localStorage.getItem('lemmings.procgen.laneHeight.v1')).value).to.equal(200);
    f.el('procgenLaneHeight').value = ''; f.el('procgenLaneHeight').dispatchEvent({ type: 'change', target: f.el('procgenLaneHeight') }); expect(f.restarts).to.equal(1); expect(f.ui.settings.laneHeight).to.equal(200); f.ui.dispose();
    const explicit = fixture('?laneHeight=144&preset=procgen-clockwork-crowd&musicMode=steps', null, preferences);
    expect(explicit.ui.settings).to.include({ laneHeight: 144, preset: 'procgen-clockwork-crowd', mode: 'steps' }); explicit.ui.dispose();
  });
  it('keeps game shortcuts reachable after a range/button click while preserving native editing keys', () => {
    const f = fixture(), pans = []; f.runtime.lanes = { renderer: { camera: { pan: (...args) => pans.push(args) } } };
    const press = (key, target) => f.window.dispatchEvent({ type: 'keydown', key, code: key === '+' ? 'NumpadAdd' : key === '-' ? 'Minus' : key, target, preventDefault() {} });
    press('ArrowLeft', { tagName: 'INPUT', type: 'range' }); expect(pans).to.have.length(0);
    press('+', { tagName: 'INPUT', type: 'range' }); expect(f.timer.speedFactor).to.equal(4);
    press('+', { tagName: 'INPUT', type: 'number' }); expect(f.timer.speedFactor).to.equal(4);
    press('-', { tagName: 'BUTTON' }); expect(f.timer.speedFactor).to.equal(3); f.ui.dispose();
  });
  it('opens visible Help after range focus and preserves native checkbox/radio activation', () => {
    const f = fixture(), calls = []; f.runtime.lanes = { pause: () => calls.push('pause'), renderer: { camera: { pan: () => calls.push('pan') } } };
    f.el('procgenHelpFields').offsetTop = 420;
    const press = (code, target, extra = {}) => f.window.dispatchEvent({ type: 'keydown', code, key: code === 'Space' ? ' ' : code, target, preventDefault() {}, ...extra });
    press('Space', { tagName: 'INPUT', type: 'checkbox' }); press('Space', { tagName: 'INPUT', type: 'radio' }); press('ArrowRight', { tagName: 'INPUT', type: 'radio' });
    expect(calls).to.deep.equal([]);
    press('F1', { tagName: 'INPUT', type: 'text' }); expect(f.el('procgenDrawer').inert).to.equal(true);
    press('F1', { tagName: 'INPUT', type: 'range' }); expect(f.el('procgenHelpFields').open).to.equal(true); expect(f.el('procgenDrawer').scrollTop).to.equal(420);
    f.document.dispatchEvent({ type: 'keydown', key: 'Escape' }); press('Slash', null, { shiftKey: true }); expect(f.el('procgenDrawer').inert).to.equal(false);
    f.ui.dispose();
  });
  it('keeps listening intent across restart through the existing audio lifecycle hooks', async () => {
    const f = fixture(), calls = []; f.ui.local.suspendGame = () => { calls.push('suspend'); return true; }; f.ui.local.resumeGame = async () => calls.push('resume');
    f.el('procgenRestart').dispatchEvent({ type: 'click' }); await Promise.resolve();
    expect(calls).to.deep.equal(['suspend', 'resume']); expect(f.restarts).to.equal(1); f.ui.dispose();
  });
  it('retains the newer run status and listening owner when an earlier restart fails late', async () => {
    const pending = [], f = fixture('', null, {}, () => new Promise((resolve, reject) => pending.push({ resolve, reject }))), resumed = [];
    f.ui.local.suspendGame = () => true; f.ui.local.resumeGame = async () => resumed.push('current');
    try {
      f.el('procgenRestart').dispatchEvent({ type: 'click' }); f.el('procgenRestart').dispatchEvent({ type: 'click' }); expect(pending).to.have.length(2);
      pending[1].resolve(); await new Promise(resolve => setImmediate(resolve)); f.ui.sync(); const currentStatus = f.el('procgenRunStatus').textContent;
      expect(resumed).to.deep.equal(['current']); pending[0].reject(new Error('obsolete restart A')); await new Promise(resolve => setImmediate(resolve));
      expect(f.el('procgenRunStatus').textContent).to.equal(currentStatus); expect(resumed).to.deep.equal(['current']); expect(f.restarts).to.equal(2);
    } finally { f.ui.dispose(); }
  });

  it('cancels a captured musical draft before asynchronous regeneration resumes', async () => {
    const f = fixture(), canvas = f.el('gameCanvas'); let captured = null;
    canvas.width = 240; canvas.height = 192; canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
    canvas.setPointerCapture = id => { captured = id; }; canvas.hasPointerCapture = id => captured === id; canvas.releasePointerCapture = () => { captured = null; };
    const context = { save() {}, restore() {}, scale() {}, fillRect() {}, strokeRect() {}, setLineDash() {}, fillText() {} };
    const renderer = { canvas, window: { devicePixelRatio: 1 }, world: { laneCount: 2, tickIndex: 0 }, originX: 0, originY: 0, viewWidth: 240, viewHeight: 192,
      render() { this.midiSpanOverlay?.draw(context, this, 1); } };
    f.runtime.lanes = { renderer };
    const pointer = (type, x) => canvas.dispatchEvent({ type, clientX: x, clientY: 40, pointerId: 7, preventDefault() {}, stopImmediatePropagation() {} });
    try {
      f.ui.sync(); renderer.midiSpanOverlay.setEditing(true);
      pointer('pointerdown', 20); pointer('pointermove', 40); expect(captured).to.equal(7);
      f.el('procgenRestart').dispatchEvent({ type: 'click' }); expect(captured).to.equal(null);
      pointer('pointerup', 40); await Promise.resolve();
      expect(f.window.localStorage.getItem('lemmings.procgen.automationSpans.v1')).to.equal(null); expect(f.restarts).to.equal(1);
    } finally { f.ui.dispose(); }
  });
  it('migrates present legacy spatial curves into canonical v2, exposes bypass/removal and reloads Undo edits', () => {
    const legacy = { id: 'converted', name: 'Saved spatial brightness', target: 'timbre', axis: 'x', min: 20, max: 91, points: [{ beat: 0, value: 20 }, { beat: 1, value: 91 }] };
    const f = fixture('', null, { 'lemmings.procgen.automationSpans.v1': { version: 1, value: [legacy] } });
    const saved = () => JSON.parse(f.window.localStorage.getItem('lemmings.procgen.automation.v2'));
    const row = () => f.el('procgenSpanList').children.find(entry => entry.dataset.spanId === legacy.id);
    const find = (host, key) => host.dataset?.spanProperty === key ? host : host.children.map(child => find(child, key)).find(Boolean);
    try {
      const before = saved(); expect(before.version).to.equal(2); expect(before.value.find(entry => entry.id === legacy.id)).to.include({ name: legacy.name, enabled: true });
      expect(projectToMidiConfig(sanitizeMidiProject({ automation: before.value })).position.mappings.some(mapping => mapping.target === 'timbre')).to.equal(true);
      expect(row()).to.exist; find(row(), 'open').dispatchEvent({ type: 'click' });
      const name = find(row(), 'name'); name.value = 'Kept spatial curve'; name.dispatchEvent({ type: 'change', target: name });
      const edited = saved(); expect(edited.value.filter(entry => entry.id !== legacy.id)).to.deep.equal(before.value.filter(entry => entry.id !== legacy.id));
      expect(edited.value.find(entry => entry.id === legacy.id).points).to.deep.equal(legacy.points);
      const enabled = find(row(), 'enabled'); enabled.checked = false; enabled.dispatchEvent({ type: 'change', target: enabled });
      expect(saved().value.find(entry => entry.id === legacy.id).enabled).to.equal(false);
      f.el('procgenSpanUndo').dispatchEvent({ type: 'click' }); expect(saved().value.find(entry => entry.id === legacy.id).enabled).to.equal(true);
      f.el('procgenSpanRedo').dispatchEvent({ type: 'click' }); expect(saved().value.find(entry => entry.id === legacy.id).enabled).to.equal(false);
      const reloaded = fixture('', null, { 'lemmings.procgen.automation.v2': saved(), 'lemmings.procgen.automationSpans.v1': before });
      try { expect(reloaded.el('procgenSpanList').children.some(entry => entry.dataset.spanId === legacy.id)).to.equal(true); } finally { reloaded.ui.dispose(); }
      find(row(), 'remove').dispatchEvent({ type: 'click' }); expect(saved().value.some(entry => entry.id === legacy.id)).to.equal(false);
      expect(f.ui.local.getState().enabled).to.equal(false); expect(f.restarts).to.equal(0);
    } finally { f.ui.dispose(); }
  });

  it('retains saved overflow automation with at most64 visible rows and edits the later page without dropping curves', () => {
    const spans = Array.from({ length: 65 }, (_, index) => ({ id: 'saved-' + index, name: 'Saved ' + index, enabled: false, target: 'pan', min: -20, max: 20, span: createMidiSpan() }));
    const spatial = { id: 'curve', name: 'Legacy curve', target: 'pan', axis: 'x', min: -35, max: 35, points: [{ beat: 0, value: -35 }, { beat: 1, value: 35 }] };
    const f = fixture('', null, { 'lemmings.procgen.automationSpans.v1': { version: 1, value: [...spans, spatial] } });
    const read = () => JSON.parse(f.window.localStorage.getItem('lemmings.procgen.automation.v2')).value;
    const find = (host, test) => test(host) ? host : host.children.map(child => find(child, test)).find(Boolean);
    try {
      const before = read(), list = f.el('procgenSpanList'); expect(before.filter(entry => entry.span)).to.have.length(65);
      expect(list.children.filter(row => row.dataset.spanId)).to.have.length(64);
      find(list, element => element.textContent === 'Next spans').dispatchEvent({ type: 'click' });
      const row = list.children.find(entry => entry.dataset.spanId === 'saved-64'); expect(row).to.exist;
      find(row, element => element.dataset.spanProperty === 'open').dispatchEvent({ type: 'click' });
      const name = find(row, element => element.dataset.spanProperty === 'name') || find(list, element => element.dataset.spanProperty === 'name');
      name.value = 'Accessible later span'; name.dispatchEvent({ type: 'change', target: name });
      expect(read().find(entry => entry.id === 'saved-64').name).to.equal('Accessible later span');
      expect(read().filter(entry => entry.id !== 'saved-64')).to.deep.equal(before.filter(entry => entry.id !== 'saved-64'));
      expect(read().find(entry => entry.id === 'curve').points).to.deep.equal(spatial.points);
    } finally { f.ui.dispose(); }
  });

  it('moves and resizes selected same-domain spans in one Undo while preserving curves, unrelated music and listening state', () => {
    const base = createMidiProjectFromMidiConfig({ sfx: {}, triggers: {} });
    const entries = sanitizeMidiProject({ ...base, automation: [...base.automation,
      { id: 'a', name: 'First', target: 'velocity', min: 40, max: 80, span: { ...createMidiSpan(), start: 2, duration: 2, loop: false, laneScope: 'lane', laneStart: 1, laneEnd: 1 } },
      { id: 'b', name: 'Second', target: 'pan', min: -20, max: 20, span: { ...createMidiSpan(), start: 6, duration: 3, loop: false, laneScope: 'group', laneStart: 2, laneEnd: 3 } },
      { id: 'other', name: 'Distance', target: 'duration', span: { ...createMidiSpan('distance'), start: 200, duration: 60, loop: false, laneScope: 'lane', laneStart: 0, laneEnd: 0 } }
    ] }).automation;
    const f = fixture('', null, { 'lemmings.procgen.automation.v2': { version: 2, value: entries } }), canvas = f.el('gameCanvas');
    canvas.width = 160; canvas.height = 576; canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
    const context = { save() {}, restore() {}, scale() {}, fillRect() {}, strokeRect() {}, setLineDash() {}, fillText() {} };
    const renderer = { canvas, world: { laneCount: 6, laneHeight: 96, generation: 1, tickIndex: 0 }, window: { devicePixelRatio: 1 }, originX: 0, originY: 0, viewWidth: 160, viewHeight: 576,
      render() { this.midiSpanOverlay?.draw(context, this, 1); } };
    f.runtime.lanes = { renderer }; f.ui.sync();
    const pointer = (type, x, y = 130, extra = {}) => canvas.dispatchEvent({ type, button: 0, clientX: x, clientY: y, pointerId: 7, preventDefault() {}, stopImmediatePropagation() {}, ...extra });
    const read = () => JSON.parse(f.window.localStorage.getItem('lemmings.procgen.automation.v2')).value;
    const header = id => f.el('procgenSpanList').children.find(row => row.dataset.spanId === id).children[0].children.find(control => control.dataset.spanProperty === 'open');
    try {
      header('a').dispatchEvent({ type: 'click' }); header('b').dispatchEvent({ type: 'click', ctrlKey: true }); renderer.midiSpanOverlay.setEditing(true); renderer.render();
      pointer('pointerdown', 27); pointer('pointermove', 47, 226); expect(read()).to.deep.equal(entries); pointer('pointerup', 47, 226);
      const moved = read(); expect(moved.find(entry => entry.id === 'a').span).to.include({ start: 4, laneStart: 2, laneEnd: 2 });
      expect(moved.find(entry => entry.id === 'b').span).to.include({ start: 8, laneStart: 3, laneEnd: 4 });
      expect(moved.filter(entry => !['a', 'b'].includes(entry.id))).to.deep.equal(entries.filter(entry => !['a', 'b'].includes(entry.id)));
      f.el('procgenSpawnPriority').value = '7'; f.el('procgenSpawnPriority').dispatchEvent({ type: 'change', target: f.el('procgenSpawnPriority') });
      f.el('procgenSpanUndo').dispatchEvent({ type: 'click' }); expect(read()).to.deep.equal(entries); expect(f.el('procgenSpawnPriority').value).to.equal(7);
      f.el('procgenSpanRedo').dispatchEvent({ type: 'click' }); expect(read()).to.deep.equal(moved);
      pointer('pointerdown', 59, 226); pointer('pointermove', 79, 226); pointer('pointerup', 79, 226);
      expect(read().find(entry => entry.id === 'a').span.duration).to.equal(4); expect(read().find(entry => entry.id === 'b').span.duration).to.equal(5);
      f.el('procgenSpanUndo').dispatchEvent({ type: 'click' }); expect(read()).to.deep.equal(moved);
      header('other').dispatchEvent({ type: 'click', ctrlKey: true }); pointer('pointerdown', 47, 226); pointer('pointermove', 67, 226); pointer('pointerup', 67, 226);
      expect(read()).to.deep.equal(moved); expect(f.el('procgenSpanHistoryStatus').textContent).to.include('one domain');
      expect(f.ui.local.getState().enabled).to.equal(false); expect(f.restarts).to.equal(0);
    } finally { f.ui.dispose(); }
  });

  it('resets volume and speed through their existing owners on right click', () => {
    const f = fixture(); let prevented = 0;
    f.el('procgenMasterVolume').dispatchEvent({ type: 'contextmenu', preventDefault: () => prevented++ });
    f.el('procgenSpeed').dispatchEvent({ type: 'contextmenu', preventDefault: () => prevented++ });
    expect(f.ui.local.audio.getState().masterVolume).to.equal(1); expect(f.timer.speedFactor).to.equal(1); expect(prevented).to.equal(2); f.ui.dispose();
  });
  it('gives nuke and span drawing exclusive gestures, releasing drafts and both indicators on Escape', () => {
    const f = fixture(), canvas = f.el('gameCanvas'), calls = []; let captured = null;
    canvas.width = 240; canvas.height = 192; canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
    canvas.setPointerCapture = id => { captured = id; }; canvas.hasPointerCapture = id => captured === id; canvas.releasePointerCapture = () => { captured = null; };
    const context = { save() {}, restore() {}, scale() {}, fillRect() {}, strokeRect() {}, setLineDash() {}, fillText() {} };
    const world = { actors: [], laneCount: 2, laneHeight: 96, generation: 1, tickIndex: 0, nukeLane: lane => { calls.push(lane); return true; } };
    const renderer = { canvas, world, window: { devicePixelRatio: 1 }, originX: 0, originY: 0, viewWidth: 240, viewHeight: 192, cameraY: 0, scale: 1, camera: { viewport: () => ({ height: 192 }), applyState() {}, getState: () => ({ scale: 1 }) },
      render() { this.midiSpanOverlay?.draw(context, this, 1); } };
    f.runtime.world = world; f.runtime.lanes = { renderer }; f.ui.sync();
    const press = extra => f.window.dispatchEvent({ type: 'keydown', key: 't', code: 'KeyT', preventDefault() {}, ...extra });
    const pointer = (type, x, y = 40) => canvas.dispatchEvent({ type, button: 0, clientX: x, clientY: y, pointerId: 7, preventDefault() {}, stopImmediatePropagation() {} });
    const draw = () => { f.el('procgenSpanEdit').checked = true; f.el('procgenSpanEdit').dispatchEvent({ type: 'change', target: f.el('procgenSpanEdit') }); };
    try {
      draw(); pointer('pointerdown', 20); pointer('pointermove', 40); expect(captured).to.equal(7);
      press(); expect(captured).to.equal(null); expect(renderer.midiSpanOverlay.snapshot().editing).to.equal(false); expect(f.el('procgenSpanEdit').checked).to.equal(false); expect(canvas.classList.contains('nuke-armed')).to.equal(true);
      pointer('pointerdown', 40, 130); expect(calls).to.deep.equal([1]); expect(f.window.localStorage.getItem('lemmings.procgen.automationSpans.v1')).to.equal(null);
      press(); draw(); expect(canvas.classList.contains('nuke-armed')).to.equal(false); expect(renderer.midiSpanOverlay.snapshot().editing).to.equal(true);
      pointer('pointerdown', 20); pointer('pointermove', 40); expect(captured).to.equal(7);
      f.window.dispatchEvent({ type: 'keydown', key: 'Escape' }); pointer('pointerup', 40);
      expect(captured).to.equal(null); expect(f.el('procgenSpanEdit').checked).to.equal(false); expect(canvas.classList.contains('nuke-armed')).to.equal(false); expect(f.el('procgenNukeStatus').textContent).to.equal('');
      expect(f.window.localStorage.getItem('lemmings.procgen.automationSpans.v1')).to.equal(null); press({ repeat: true }); expect(calls).to.deep.equal([1]);
    } finally { f.ui.dispose(); }
  });

  it('arms a lane nuke, ignores repeats/forms and cancels or nukes all explicitly', () => {
    const f = fixture(), calls = [], canvas = f.el('gameCanvas'); canvas.getBoundingClientRect = () => ({ top: 40 });
    f.runtime.world = { laneHeight: 144, nukeLane: lane => { calls.push(lane); return true; }, nukeAll: () => calls.push('all') };
    f.runtime.lanes = { renderer: { cameraY: 144, scale: 2, camera: { viewport: () => ({ height: 432 }) } } };
    const press = extra => f.window.dispatchEvent({ type: 'keydown', key: 't', code: 'KeyT', preventDefault() {}, ...extra });
    press({ repeat: true }); expect(canvas.classList.contains('nuke-armed')).to.equal(false);
    press({ target: { tagName: 'INPUT' } }); expect(canvas.classList.contains('nuke-armed')).to.equal(false);
    press({ target: { tagName: 'BUTTON' } }); canvas.dispatchEvent({ type: 'pointerdown', button: 0, clientY: 380, preventDefault() {}, stopImmediatePropagation() {} });
    expect(calls).to.deep.equal([2]); expect(canvas.classList.contains('nuke-armed')).to.equal(false);
    press({ target: { tagName: 'INPUT', type: 'range' } }); f.window.dispatchEvent({ type: 'keydown', key: 'Escape' }); expect(canvas.classList.contains('nuke-armed')).to.equal(false);
    press({ shiftKey: true }); expect(calls).to.deep.equal([2, 'all']); f.ui.dispose();
  });
  it('offers the shared catalog and never mounts hardware routing/studio controls', () => {
    const f = fixture(); expect(f.el('procgenPreset').children.length).to.equal(PROCGEN_GAME_EVENT_MIDI_PRESETS.length);
    expect(f.ui.local.getState().enabled).to.equal(false);
    const html = fs.readFileSync('procgen.html', 'utf8'); expect(html).not.to.match(/midiOutput|midiInput|midiStudio|requestMIDIAccess/);
    expect(html).to.include('max="1024"'); f.ui.dispose();
  });
  it('updates compact metrics and removes its handlers on disposal', () => {
    const f = fixture(); f.ui.syncMetrics({ alive: 1024, spawnedTotal: 2048, distance: { max: 3400 }, generation: 2, admissionPaused: true });
    expect(f.el('procgenAliveCount').textContent).to.equal('1,024 alive');
    expect(f.el('procgenDistance').textContent).to.equal('3,400 px');
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
    for (const id of ['procgenRestart', 'procgenSeed', 'procgenLanes', 'procgenPack', 'procgenSpeed', 'procgenPause', 'procgenStep', 'procgenFollow', 'procgenListen', 'procgenMasterVolume', 'procgenPanic']) {
      expect($('#' + id).length, id).to.equal(1); expect($('#' + id).closest('#procgenTopbar').length, id).to.equal(1);
      expect($('#' + id).closest('#procgenDrawer').length, id).to.equal(0);
    }
    expect($('#procgenSeedControls').attr('open')).to.equal(undefined);
    expect($('#procgenSeed').closest('#procgenSeedControls').length).to.equal(1);
    expect($('#procgenAliveCount').closest('#procgenTopbar').length).to.equal(1);
    expect($('#procgenDistance').closest('#procgenTopbar').length).to.equal(1);
    expect($('#procgenTab').closest('#procgenTopbar').length).to.equal(0);
    expect($('#procgenTab').attr('aria-label')).to.equal('Show details');
    expect($('#procgenCharacters').closest('#procgenDrawer').length).to.equal(1);
    expect($('#procgenTab').parent().attr('id')).to.equal('procgenPanel');
    expect($('#procgenAdvanced').next().hasClass('procgen-cctv-controls')).to.equal(true);
    expect($('#procgenCctvEnabled').attr('checked')).to.equal(undefined);
    expect($('#procgenShare').closest('#procgenDrawer').length).to.equal(1);
    expect($('#procgenOutputPressure').prev().attr('id')).to.equal('procgenAudioControls');
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
  it('ignores query appearance while accepting independent music and synth defaults without starting audio', () => {
    const f = fixture('?shape=classic&bodyColor=%23ffd447&accessory=crown&eyewear=monocle&speed=150&preset=game-lydian-lanterns&musicMode=phrase');
    expect(f.ui.settings).to.include({ speed: 150, preset: 'game-lydian-lanterns', mode: 'phrase' });
    expect(f.el('procgenPhrases').checked).to.equal(true); expect(f.ui.local.getState().enabled).to.equal(false);
    expect(new URL(f.ui.getShareUrl()).searchParams.get('shape')).to.equal(null); expect(f.ui.settings).to.include({ output: 'synth', sound: true, laneHeight: 144, pack: 1 }); f.ui.dispose();
  });
});
