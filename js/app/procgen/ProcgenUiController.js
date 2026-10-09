import { createProcgenMidiSpanOverlay } from './ProcgenMidiSpanOverlay.js';
import { createProcgenMidiSpanControls } from './ProcgenMidiSpanControls.js';
import { createMidiEditHistory } from '../midi-ui/midiEditHistory.js';
import { loadProcgenAutomation, saveProcgenAutomation } from './ProcgenAutomationStorage.js';
import { createMidiTensionControls } from '../midi-ui/midiTensionControls.js';
import { createMidiMusicDirectionControls } from '../midi-ui/midiMusicDirectionControls.js';
import { createMidiOutputCapture } from '../../midi/capture/MidiOutputCapture.js';
import { createMidiCaptureControls } from '../midi-ui/midiCaptureControls.js';
import { DECORATION_CHOICES } from '../../decorations/ProcgenDecorationPacks.js';
import { createCharacterUiController, mountCharacterControls } from '../characterUiController.js';
import { createProcgenMidiOutput } from './ProcgenMidiOutput.js';
import { createLocalGamePreview } from '../midi-ui/localGamePreview.js';
import { createMidiProjectFromMidiConfig, projectToMidiConfig, reduceMidiProject, sanitizeMidiProject } from '../../midi/project/MidiProject.js';
import { PROCGEN_GAME_EVENT_MIDI_PRESETS, applyProcgenGameEventMidiPreset, getProcgenSpawnPriority, setProcgenSpawnPriority, getProcgenMusicBeatTicks } from '../../midi/project/ProcgenMidiDefaults.js';
import { normalizeLaneCount, normalizeLaneHeight, DEFAULT_LANE_HEIGHT, normalizePopulationPolicy } from './ProcgenLaneWorld.js';
import { normalizeWorkerLimits } from './ProcgenWorkerLimits.js';
import { KeybindingRegistry, DEFAULT_KEYBINDINGS } from '../../input/KeybindingRegistry.js';
import { normalizeProcgenSpeed, changeProcgenSpeed, renderProcgenSpeedControl } from './ProcgenSpeedControl.js';
import { normalizeSeed } from '../../core/seededRandom.js';
import { readProcgenUrlConfig, createProcgenShareUrl } from './ProcgenUrlConfig.js';

const createProcgenUiController = ({ document, window, getRuntime, restart, initial = {} }) => {
  const byId = id => document.getElementById(id);
  const listeners = [];
  const listen = (target, event, handler, options) => { target?.addEventListener(event, handler, options); listeners.push([target, event, handler, options]); };
  const urlConfig = readProcgenUrlConfig(window?.location?.search);
  const laneStorageKey = 'lemmings.procgen.lanes.v1';
  let preferredLanes = 8;
  try {
    const stored = JSON.parse(window.localStorage?.getItem(laneStorageKey) || 'null');
    if (stored?.version === 1 && Number.isInteger(stored.value) && stored.value >= 1 && stored.value <= 1024) preferredLanes = stored.value;
  } catch { /* Start with eight lanes. */ }
  const heightKey = 'lemmings.procgen.laneHeight.v1';
  let preferredHeight = DEFAULT_LANE_HEIGHT;
  try { const stored = JSON.parse(window.localStorage?.getItem(heightKey) || 'null'); if (stored?.version === 1) preferredHeight = normalizeLaneHeight(stored.value, DEFAULT_LANE_HEIGHT); } catch { /* Keep physical default. */ }
  const musicKey = 'lemmings.procgen.music.v1';
  let musicPreference = {};
  try { const stored = JSON.parse(window.localStorage?.getItem(musicKey) || 'null'); if (stored?.version === 1 && PROCGEN_GAME_EVENT_MIDI_PRESETS.some(p => p.id === stored.preset)) musicPreference = { preset: stored.preset, mode: stored.mode === 'phrase' ? 'phrase' : 'steps' }; } catch { /* Keep original favorite default. */ }
  const initialLanes = String(initial.laneCount ?? '').trim();
  const settings = { laneCount: initialLanes && Number.isFinite(Number(initialLanes)) ? normalizeLaneCount(initialLanes) : preferredLanes, speed: normalizeProcgenSpeed(initial.speed), pack: [1, 2, 3, 4, 5, 6].includes(Number(initial.pack)) ? Number(initial.pack) : 1,
    laneHeight: preferredHeight,
    preset: 'game-iron-ensemble', mode: 'steps', decoration: 'none', ...musicPreference, ...urlConfig.settings, ...(urlConfig.seed != null ? { seed: urlConfig.seed } : {}) };
  const tensionStorageKey = 'lemmings.procgen.ensembleTension.v1';
  let tensionPreferences = null;
  try { const stored = JSON.parse(window.localStorage?.getItem(tensionStorageKey) || 'null'); if (stored?.version === 1 && stored.value && typeof stored.value === 'object') tensionPreferences = stored.value; } catch { /* Keep the preset defaults. */ }
  let project = applyProcgenGameEventMidiPreset(createMidiProjectFromMidiConfig({ enabled: false, sfx: {}, triggers: {} }), settings.preset);
  const workerStorageKey = 'lemmings.procgen.workerLimits.v1';
  settings.workerLimits = normalizeWorkerLimits();
  const populationKey = 'lemmings.procgen.population.v1', priorityKey = 'lemmings.procgen.spawnPriority.v1';
  settings.populationPolicy = normalizePopulationPolicy();
  let savedPriority;
  try { const stored = JSON.parse(window.localStorage?.getItem(populationKey) || 'null'); if (stored?.version === 1) settings.populationPolicy = normalizePopulationPolicy(stored.value); } catch { /* Keep defaults. */ }
  try { const stored = JSON.parse(window.localStorage?.getItem(priorityKey) || 'null'); if (stored?.version === 1 && Number.isFinite(stored.value)) savedPriority = stored.value; } catch { /* Keep defaults. */ }
  if (savedPriority !== undefined) project = setProcgenSpawnPriority(project, savedPriority);
  const automationStorage = () => { try { return window.localStorage; } catch { return null; } };
  project = loadProcgenAutomation(automationStorage(), project);
  try { const stored = JSON.parse(window.localStorage?.getItem(workerStorageKey) || 'null'); if (stored?.version === 1) settings.workerLimits = normalizeWorkerLimits(stored.value); } catch { /* Keep session defaults. */ }
  let config = projectToMidiConfig(project), disposed = false;
  let syncTargetHelp = () => {};
  const renderOutput = state => {
    syncTargetHelp();
    const button = byId('procgenListen'), midi = state.selectedBackend === 'midi';
    if (button) { button.textContent = state.enabled || state.status === 'starting' ? 'Stop output' : midi ? 'Connect MIDI' : 'Listen locally'; button.setAttribute('aria-pressed', String(state.enabled)); }
    if (byId('procgenAudioStatus')) byId('procgenAudioStatus').textContent = state.message + (!midi && settings.soundFont ? ' Requested sample bank is unavailable; using the browser synth.' : '');
    if (byId('procgenMasterVolume')) byId('procgenMasterVolume').disabled = midi;
    if (byId('procgenMidiDevice')) byId('procgenMidiDevice').hidden = !midi;
  };
  let local;
  const preview = createLocalGamePreview({ getLemmings: () => getRuntime()?.view, getConfig: () => config, immutableConfig: true,
    onStateChange: () => local?.localStateChanged() });
  local = createProcgenMidiOutput({ local: preview, getView: () => getRuntime()?.view, getConfig: () => config, getWebMidi: () => window.WebMidi,
    backend: settings.output, onStateChange: renderOutput, onDevicesChange: (ports, selectedId) => {
      const select = byId('procgenMidiDevice'); if (!select) return;
      select.replaceChildren(); const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = ports.length ? 'Choose MIDI output' : 'Connect to find MIDI outputs'; select.append(placeholder);
      for (const port of ports) { const option = document.createElement('option'); option.value = port.id; option.textContent = port.name || port.id; select.append(option); }
      select.value = selectedId || '';
    } });
  if (byId('procgenOutput')) byId('procgenOutput').value = settings.output || 'synth';
  listen(byId('procgenOutput'), 'change', event => { settings.output = event.target.value; local.setBackend(settings.output); });
  listen(byId('procgenMidiDevice'), 'change', event => local.setOutputId(event.target.value));
  renderOutput(local.getState());
  const outputCapture = createMidiOutputCapture();
  const captureControls = createMidiCaptureControls({ document, window, capture: outputCapture, prefix: 'procgenCapture', inspect: () => local.getState().backend === 'local-browser-audio' ? local.audio.inspectRender?.() : null,
    attach: capture => local.setCapture(capture),
    getMetadata: () => {
      const runtime = getRuntime(), timer = runtime?.game?.getGameTimer?.();
      return { backend: local.getState().backend, outputId: local.getState().outputId, outputName: local.getState().outputName, seed: runtime?.world?.seed ?? settings.seed, generation: runtime?.world?.generation,
        tempoBpm: project.transport.bpmBase, speed: timer?.speedFactor, frameMs: timer?.frameTime, scale: project.global.scale,
        settingsReference: { localMasterGain: local.audio.getState().masterVolume, preset: settings.preset, mode: settings.mode, laneCount: settings.laneCount, pack: settings.pack,
          tracks: project.tracks.slice(0, 16).map(track => ({ id: track.id, channel: track.channel, program: track.program })), ensemble: project.ensemble },
        limits: { capacity: outputCapture.capacity, maxDurationMs: outputCapture.maxDurationMs } };
    } });
  const tensionControls = createMidiTensionControls({ document, prefix: 'procgenTension', getProject: () => project,
    getRouter: () => getRuntime()?.view?.midiPreviewRouter, getLaneCount: () => settings.laneCount,
    update: patch => {
      project = reduceMidiProject(project, { type: 'ensemble.tension.update', patch });
      tensionPreferences = project.ensemble?.tension; config = projectToMidiConfig(project); local.syncConfig();
      try { window.localStorage?.setItem(tensionStorageKey, JSON.stringify({ version: 1, value: tensionPreferences })); } catch { /* Keep the session choice. */ }
    } });
  const automationHistory = createMidiEditHistory();
  let automationStatus = '', musicDirection = null;
  const syncAutomationHistory = () => {
    const state = automationHistory.state();
    if (byId('procgenSpanUndo')) byId('procgenSpanUndo').disabled = !state.canUndo;
    if (byId('procgenSpanRedo')) byId('procgenSpanRedo').disabled = !state.canRedo;
    if (byId('procgenSpanHistoryStatus')) byId('procgenSpanHistoryStatus').textContent = automationStatus;
  };
  const commitAutomation = (next, record = true) => {
    next = sanitizeMidiProject({ ...project, automation: next.automation, global: { ...project.global, musicDirector: next.global.musicDirector } });
    if (record) automationHistory.record(project, next);
    project = next; config = projectToMidiConfig(project); local.syncConfig(); spanControls.render(); spanOverlay.changed(); musicDirection?.sync();
    automationStatus = saveProcgenAutomation(automationStorage(), project) ? '' : 'Music edits kept for this session; browser storage is unavailable.';
    syncAutomationHistory();
  };
  const dispatchAutomation = intent => commitAutomation(reduceMidiProject(project, intent));
  const spanControls = createProcgenMidiSpanControls({ document, getProject: () => project, getLaneCount: () => settings.laneCount,
    getRouter: () => getRuntime()?.view?.midiPreviewRouter,
    getBackend: () => local.getState().selectedBackend === 'midi' ? 'midi' : 'synth',
    onSelect: (id, ids) => spanOverlay.select(id, ids), onIntent: dispatchAutomation });
  const spanOverlay = createProcgenMidiSpanOverlay({ document, getRuntime, getProject: () => project,
    getDomain: () => byId('procgenSpanDomain')?.value || 'beats', getTarget: () => byId('procgenSpanTarget')?.value || 'velocity',
    onUpdate: (automationId, patch) => dispatchAutomation({ type: 'automation.update', automationId, patch }),
    onBatchUpdate: updates => dispatchAutomation({ type: 'automation.batch.update', updates }),
    onStatus: message => { automationStatus = message; syncAutomationHistory(); },
    onAdd: (span, target) => spanControls.addSpan(span, target), onSelect: (id, options) => { spanControls.select(id, options); setOpen(true); } });
  const restoreAutomation = action => {
    spanOverlay.cancelDraft();
    automationHistory[action](project, next => commitAutomation(next, false)); syncAutomationHistory();
  };
  listen(byId('procgenSpanUndo'), 'click', () => restoreAutomation('undo'));
  listen(byId('procgenSpanRedo'), 'click', () => restoreAutomation('redo')); syncAutomationHistory();
  musicDirection = createMidiMusicDirectionControls({ document, prefix: 'procgenMusic', getProject: () => project,
    getRouter: () => getRuntime()?.view?.midiPreviewRouter,
    update: musicDirector => dispatchAutomation({ type: 'global.update', patch: { musicDirector } }) });
  syncTargetHelp = () => spanControls.syncTargetHelp();
  const setSpanEditing = enabled => {
    if (enabled) setNukeArmed(false);
    spanOverlay.setEditing(enabled);
    if (byId('procgenSpanEdit')) byId('procgenSpanEdit').checked = enabled;
    if (enabled && byId('procgenSpanVisible')) byId('procgenSpanVisible').checked = true;
  };
  listen(byId('procgenSpanEdit'), 'change', event => setSpanEditing(event.target.checked));
  listen(byId('procgenSpanVisible'), 'change', event => { spanOverlay.setVisible(event.target.checked); if (!event.target.checked && byId('procgenSpanEdit')) byId('procgenSpanEdit').checked = false; });
  const syncWorkerLimits = () => {
    getRuntime()?.world?.setWorkerLimits?.(settings.workerLimits);
    for (const [key, suffix] of [['bashers', 'Bashers'], ['diggers', 'Diggers'], ['builders', 'Builders']]) if (byId('procgenWorker' + suffix)) byId('procgenWorker' + suffix).value = String(settings.workerLimits[key]);
  };
  for (const [key, suffix] of [['bashers', 'Bashers'], ['diggers', 'Diggers'], ['builders', 'Builders']]) listen(byId('procgenWorker' + suffix), 'change', event => {
    if (!String(event.target.value).trim() || !Number.isFinite(Number(event.target.value))) { syncWorkerLimits(); return; }
    settings.workerLimits = normalizeWorkerLimits({ ...settings.workerLimits, [key]: event.target.value }); syncWorkerLimits();
    try { window.localStorage?.setItem(workerStorageKey, JSON.stringify({ version: 1, value: settings.workerLimits })); } catch { /* Keep the session choice. */ }
  });
  const syncPopulation = () => {
    settings.populationPolicy = normalizePopulationPolicy({ spawnBeatTicks: getProcgenMusicBeatTicks(project, getRuntime()?.world?.getGameTimer?.().TIME_PER_FRAME_MS || 60) }, settings.populationPolicy);
    getRuntime()?.world?.setPopulationPolicy?.(settings.populationPolicy);
    for (const [key, id] of [['scoutsEvery', 'procgenScoutsEvery'], ['scoutDelayTicks', 'procgenScoutDelay'], ['spawnSpreadTicks', 'procgenSpawnSpread']]) if (byId(id)) byId(id).value = settings.populationPolicy[key];
    if (byId('procgenSpawnPriority')) byId('procgenSpawnPriority').value = getProcgenSpawnPriority(project);
  };
  for (const [key, id] of [['scoutsEvery', 'procgenScoutsEvery'], ['scoutDelayTicks', 'procgenScoutDelay'], ['spawnSpreadTicks', 'procgenSpawnSpread']]) listen(byId(id), 'change', event => {
    if (!String(event.target.value).trim() || !Number.isFinite(Number(event.target.value))) { syncPopulation(); return; }
    settings.populationPolicy = normalizePopulationPolicy({ [key]: event.target.value }, settings.populationPolicy); syncPopulation();
    try { window.localStorage?.setItem(populationKey, JSON.stringify({ version: 1, value: settings.populationPolicy })); } catch { /* Keep live settings. */ }
  });
  listen(byId('procgenSpawnPriority'), 'change', event => {
    if (!String(event.target.value).trim() || !Number.isFinite(Number(event.target.value))) { syncPopulation(); return; }
    project = setProcgenSpawnPriority(project, Number(event.target.value)); savedPriority = getProcgenSpawnPriority(project); config = projectToMidiConfig(project); local.syncConfig(); syncPopulation();
    try { window.localStorage?.setItem(priorityKey, JSON.stringify({ version: 1, value: savedPriority })); } catch { /* Keep live setting. */ }
  });
  const panel = byId('procgenDrawer'), tab = byId('procgenTab');
  const setOpen = open => {
    if (!panel || !tab) return;
    panel.classList.toggle('is-open', open); byId('procgenPanel')?.classList.toggle('is-open', open); panel.inert = !open;
    tab.setAttribute('aria-expanded', String(open)); tab.textContent = open ? '▴' : '▾';
    tab.setAttribute('aria-label', open ? 'Hide details' : 'Show details'); tab.title = open ? 'Hide details' : 'Show details';
    if (!open && panel.contains(document.activeElement)) tab.focus();
  };
  let dragStart = null, pulledOpen = false;
  listen(tab, 'pointerdown', event => { dragStart = event.clientY; });
  listen(tab, 'pointerup', event => { if (dragStart != null && event.clientY - dragStart > 15) { setOpen(true); pulledOpen = true; } dragStart = null; });
  listen(tab, 'click', () => { if (pulledOpen) { pulledOpen = false; return; } setOpen(tab.getAttribute('aria-expanded') !== 'true'); });
  const isEditing = event => event.target?.isContentEditable || ['TEXTAREA', 'SELECT'].includes(event.target?.tagName) || (event.target?.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(event.target.type || 'text'));
  listen(document, 'keydown', event => { if (event.key === 'Escape' && !isEditing(event)) { setOpen(false); setSpanEditing(false); setNukeArmed(false); } });
  setOpen(false);
  const showHelp = () => {
    setOpen(true); const help = byId('procgenHelpFields');
    if (help) { help.open = true; if (panel) panel.scrollTop = help.offsetTop || 0; }
  };
  listen(byId('procgenHelp'), 'click', showHelp);
  const charactersHost = byId('procgenCharacters');
  if (charactersHost) mountCharacterControls(document, charactersHost);
  const characters = createCharacterUiController({ document, window, getView: () => getRuntime()?.view,
    defaults: { shape: 'mixed', bodyColor: 'random' }, initial: urlConfig.appearance });
  characters.bind();
  const fill = (id, choices, value) => {
    const select = byId(id); if (!select) return;
    for (const [value, label] of choices) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option); }
    select.value = String(value);
  };
  fill('procgenDecoration', DECORATION_CHOICES.map(choice => [choice.id, choice.label]), settings.decoration);
  fill('procgenPreset', PROCGEN_GAME_EVENT_MIDI_PRESETS.map(preset => [preset.id, preset.label]), settings.preset);
  fill('procgenPack', [[1, 'Lemmings'], [2, 'Oh No! More Lemmings'], [3, 'Xmas 1991'], [4, 'Xmas 1992'], [5, 'Holiday 1993'], [6, 'Holiday 1994']], settings.pack);
  if (byId('procgenSpeed')) byId('procgenSpeed').value = settings.speed;
  if (byId('procgenPhrases')) byId('procgenPhrases').checked = settings.mode === 'phrase';
  if (byId('procgenLanes')) byId('procgenLanes').value = settings.laneCount;
  const refreshPreset = ({ replaceRollingDefaults = false } = {}) => {
    settings.preset = byId('procgenPreset').value; settings.mode = byId('procgenPhrases')?.checked ? 'phrase' : 'steps';
    project = applyProcgenGameEventMidiPreset(project, settings.preset, { mode: settings.mode, replaceRollingDefaults });
    if (savedPriority !== undefined) project = setProcgenSpawnPriority(project, savedPriority);
    if (project.ensemble && tensionPreferences) project = reduceMidiProject(project, { type: 'ensemble.tension.update', patch: tensionPreferences });
    config = projectToMidiConfig(project); local.syncConfig(); tensionControls.sync(); spanControls.render(); syncPopulation();
    try { window.localStorage?.setItem(musicKey, JSON.stringify({ version: 1, preset: settings.preset, mode: settings.mode })); } catch { /* Keep session palette. */ }
    if (byId('procgenPresetDescription')) byId('procgenPresetDescription').textContent = PROCGEN_GAME_EVENT_MIDI_PRESETS.find(p => p.id === settings.preset).description;
  };
  listen(byId('procgenPreset'), 'change', () => refreshPreset({ replaceRollingDefaults: true })); listen(byId('procgenPhrases'), 'change', () => refreshPreset()); refreshPreset();
  listen(byId('procgenListen'), 'click', () => { if (local.getState().enabled || local.getState().status === 'starting') local.stop(); else local.start(); });
  let restartId = 0;
  const doRestart = async () => {
    const id = ++restartId;
    spanOverlay.cancelDraft();
    const seed = byId('procgenSeed')?.value?.trim();
    if (seed) settings.seed = normalizeSeed(seed);
    settings.camera = camera()?.getState?.();
    const listening = local.suspendGame();
    if (byId('procgenRunStatus')) byId('procgenRunStatus').textContent = 'Loading…';
    try { await restart(); if (listening && !disposed && id === restartId) await local.resumeGame(); } catch (error) { if (!disposed && id === restartId && byId('procgenRunStatus')) byId('procgenRunStatus').textContent = `Could not start: ${error.message}`; }
  };
  listen(byId('procgenRestart'), 'click', doRestart);
  listen(byId('procgenNewSeed'), 'click', () => {
    const bytes = new Uint32Array(1); window.crypto?.getRandomValues?.(bytes);
    settings.seed = normalizeSeed(bytes[0] || Date.now());
    if (byId('procgenSeed')) byId('procgenSeed').value = String(settings.seed);
    doRestart();
  });
  listen(byId('procgenSeed'), 'keydown', event => { if (event.key === 'Enter') { event.preventDefault?.(); doRestart(); } });
  const volumeKey = 'lemmings.midi.masterVolume';
  let storedVolume; try { storedVolume = JSON.parse(window.localStorage?.getItem(volumeKey) || 'null'); } catch { /* Use the quiet default. */ }
  const setVolume = (value, persist = true) => {
    const master = local.audio.setMasterVolume(value);
    if (byId('procgenMasterVolume')) byId('procgenMasterVolume').value = String(Math.round(master * 100));
    if (byId('procgenMasterVolumeValue')) byId('procgenMasterVolumeValue').textContent = Math.round(master * 100) + '%';
    if (persist) try { window.localStorage?.setItem(volumeKey, JSON.stringify({ version: 2, value: master })); } catch { /* Keep session gain. */ }
  };
  setVolume(typeof storedVolume === 'number' ? Math.max(0, Math.min(1, storedVolume)) : storedVolume?.version === 2 ? storedVolume.value : 0.7, false);
  listen(byId('procgenMasterVolume'), 'input', event => setVolume(Number(event.target.value) / 100));
  listen(byId('procgenMasterVolume'), 'contextmenu', event => { event.preventDefault?.(); setVolume(1); });
  listen(byId('procgenPanic'), 'click', () => local.panic());
  listen(byId('procgenLanes'), 'change', () => {
    const input = byId('procgenLanes'), value = String(input.value).trim();
    if (!value || !Number.isFinite(Number(value))) { input.value = settings.laneCount; return; }
    settings.laneCount = normalizeLaneCount(value); input.value = settings.laneCount;
    try { window.localStorage?.setItem(laneStorageKey, JSON.stringify({ version: 1, value: settings.laneCount })); } catch { /* Keep the session choice. */ }
    doRestart();
  });
  if (byId('procgenLaneHeight')) byId('procgenLaneHeight').value = settings.laneHeight;
  listen(byId('procgenLaneHeight'), 'change', event => {
    if (!String(event.target.value).trim() || !Number.isFinite(Number(event.target.value))) { event.target.value = settings.laneHeight; return; }
    settings.laneHeight = normalizeLaneHeight(event.target.value, settings.laneHeight); event.target.value = settings.laneHeight;
    try { window.localStorage?.setItem(heightKey, JSON.stringify({ version: 1, value: settings.laneHeight })); } catch { /* Keep session height. */ }
    doRestart();
  });
  listen(byId('procgenDecoration'), 'change', () => { settings.decoration = byId('procgenDecoration').value; doRestart(); });
  listen(byId('procgenPack'), 'change', () => { settings.pack = Number(byId('procgenPack').value); doRestart(); });
  const camera = () => getRuntime()?.lanes?.renderer?.camera;
  const panelSprites = () => getRuntime()?.lanes?.renderer?.hud?.sprites;
  const cctv = () => getRuntime()?.lanes?.renderer?.cctv;
  settings.cctvMode = 'leaders'; settings.cctvPins = []; settings.cctvEnabled = false;
  const syncCctv = state => {
    if (!state) return;
    settings.cctvMode = state.mode; settings.cctvPins = state.pins;
    if (typeof state.enabled === 'boolean') settings.cctvEnabled = state.enabled;
    if (byId('procgenCctvEnabled')) byId('procgenCctvEnabled').checked = settings.cctvEnabled;
    if (byId('procgenCctvMode')) byId('procgenCctvMode').value = state.mode;
    for (let index = 0; index < 8; index++) {
      const button = byId('procgenCctvSlot' + index), slot = state.slots[index]; if (!button) continue;
      button.hidden = state.enabled === false || !slot; if (!slot) continue;
      button.dataset.lane = slot.lane; button.disabled = state.mode !== 'director'; button.setAttribute('aria-pressed', String(slot.pinned));
      button.textContent = 'Lane ' + (slot.lane + 1) + ' / #' + slot.rank + ' / ' + slot.reason;
      button.title = slot.pinned ? 'Unpin this lane' : 'Pin this lane in Director mode';
    }
    const message = state.mode === 'director' ? state.pins.length + '/4 pinned; other views follow actual activity, with one fair rotation slot.'
      : 'Eight distance leaders. Pins are retained for Director mode.';
    if (byId('procgenCctvStatus') && byId('procgenCctvStatus').textContent !== message) byId('procgenCctvStatus').textContent = message;
  };
  listen(byId('procgenCctvEnabled'), 'change', event => { settings.cctvEnabled = event.target.checked; cctv()?.setEnabled?.(settings.cctvEnabled); syncCctv(cctv()?.getState()); });
  listen(byId('procgenCctvMode'), 'change', () => { cctv()?.setMode(byId('procgenCctvMode').value); syncCctv(cctv()?.getState()); });
  const toggleCctvPin = lane => {
    if (!cctv()?.togglePin(lane)) { if (byId('procgenCctvStatus')) byId('procgenCctvStatus').textContent = 'Choose a valid lane; unpin a lane before adding a fifth pin.'; return; }
    syncCctv(cctv().getState());
  };
  listen(byId('procgenCctvPin'), 'click', () => toggleCctvPin(Number(byId('procgenCctvLane')?.value) - 1));
  listen(byId('procgenCctvClear'), 'click', () => { cctv()?.setPins([]); syncCctv(cctv()?.getState()); });
  for (let index = 0; index < 8; index++) listen(byId('procgenCctvSlot' + index), 'click', event => toggleCctvPin(Number(event.currentTarget?.dataset.lane ?? byId('procgenCctvSlot' + index)?.dataset.lane)));

  const setSpeed = value => {
    settings.speed = normalizeProcgenSpeed(value, settings.speed);
    if (byId('procgenSpeed')) byId('procgenSpeed').value = settings.speed;
    const runtime = getRuntime(); if (runtime?.view) runtime.view.gameSpeedFactor = settings.speed;
    const timer = runtime?.game?.getGameTimer?.(); if (timer) timer.speedFactor = settings.speed;
    renderProcgenSpeedControl({ document, sprites: panelSprites(), speed: settings.speed });
  };
  for (const id of ['procgenSpeed', 'procgenSpeedReadout', 'procgenSpeedDown', 'procgenSpeedUp']) listen(byId(id), 'contextmenu', event => { event.preventDefault?.(); setSpeed(1); });
  listen(byId('procgenSpeed'), 'change', () => setSpeed(byId('procgenSpeed').value));
  for (const [id, direction] of [['procgenSpeedDown', -1], ['procgenSpeedUp', 1]]) {
    listen(byId(id), 'click', event => setSpeed(changeProcgenSpeed(settings.speed, direction, { panel: true, fast: event.shiftKey })));
  }
  const supportedKeys = new Set(['panLeft', 'panRight', 'panUp', 'panDown', 'zoomIn', 'zoomOut', 'zoomReset', 'speedDown', 'speedDownFast', 'speedUp', 'speedUpFast', 'togglePause', 'stepForward', 'restartLevel']);
  const keyConfig = config => ({ bindings: { ...Object.fromEntries(Object.entries(DEFAULT_KEYBINDINGS.bindings).map(([action, bindings]) =>
    [action, supportedKeys.has(action) ? config?.bindings?.[action] ?? bindings : []])), followFrontier: config?.bindings?.followFrontier || ['KeyF'], toggleShortcutOverlay: config?.bindings?.toggleShortcutOverlay || ['F1', 'Shift+Slash'] } });
  const keybindings = new KeybindingRegistry(keyConfig());
  window?.fetch?.('keybindings.json').then(response => response.ok ? response.json() : null).then(config => {
    if (config && !disposed) keybindings.setConfig(keyConfig(config));
  }).catch(() => {});
  let paused = false;
  const setPaused = next => {
    paused = !!next; getRuntime()?.lanes?.[paused ? 'pause' : 'resume']();
    if (byId('procgenPause')) { byId('procgenPause').textContent = paused ? 'Play' : 'Pause'; byId('procgenPause').setAttribute('aria-pressed', String(paused)); }
  };
  listen(byId('procgenPause'), 'click', () => setPaused(!paused));
  listen(byId('procgenStep'), 'click', () => { setPaused(true); getRuntime()?.lanes?.step(); });
  listen(byId('procgenFollow'), 'click', () => { camera()?.followFrontier(); byId('gameCanvas')?.focus?.(); });
  for (const [id, factor] of [['procgenZoomOut', 1 / 1.1], ['procgenZoomIn', 1.1]]) listen(byId(id), 'click', () => camera()?.setZoom(camera().getState().scale * factor));
  let nukeArmed = false;
  const setNukeArmed = armed => {
    if (armed) setSpanEditing(false);
    nukeArmed = armed; byId('gameCanvas')?.classList.toggle('nuke-armed', armed);
    if (byId('procgenNukeStatus')) byId('procgenNukeStatus').textContent = armed ? 'Click a lane to start its nuke; Escape cancels.' : '';
  };
  const canvas = byId('gameCanvas');
  listen(canvas, 'pointerdown', event => {
    if (!nukeArmed || event.button !== 0) return;
    const runtime = getRuntime(), renderer = runtime?.lanes?.renderer, world = runtime?.world, rect = canvas.getBoundingClientRect?.();
    if (!renderer || !world || !rect) return;
    const height = renderer.camera.viewport().height, cssY = event.clientY - rect.top;
    if (cssY < 0 || cssY >= height * renderer.scale) return;
    const lane = Math.floor((renderer.cameraY + cssY / renderer.scale) / world.laneHeight);
    if (world.nukeLane(lane)) { event.preventDefault?.(); event.stopImmediatePropagation?.(); setNukeArmed(false); }
  }, { capture: true });
  const handleKey = event => {
    if (event.defaultPrevented || isEditing(event)) return;
    if (!event.ctrlKey && !event.altKey && !event.metaKey && (event.code === 'KeyT' || event.key?.toLowerCase() === 't')) {
      if (!event.repeat) { if (event.shiftKey) { setSpanEditing(false); getRuntime()?.world?.nukeAll?.(); setNukeArmed(false); } else setNukeArmed(!nukeArmed); }
      event.preventDefault?.(); return;
    }
    if (event.key === 'Escape') { setNukeArmed(false); setSpanEditing(false); return; }
    if (event.repeat) return;
    if (event.target?.type === 'range' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
    const activationKey = [' ', 'Enter'].includes(event.key) || ['Space', 'Enter', 'NumpadEnter'].includes(event.code);
    if (activationKey && (['BUTTON', 'SUMMARY'].includes(event.target?.tagName) || event.target?.tagName === 'INPUT' && ['checkbox', 'radio', 'button', 'submit'].includes(event.target.type))) return;
    if (event.target?.type === 'radio' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key || event.code)) return;
    let handled = false;
    for (const action of keybindings.getActionsForEvent(event)) {
      if (action.startsWith('pan') && action !== 'panBoost') {
        const amount = event.shiftKey ? 48 : 24;
        const offset = { panLeft: [-amount, 0], panRight: [amount, 0], panUp: [0, -amount], panDown: [0, amount] }[action];
        if (offset) { camera()?.pan(...offset); handled = true; }
      } else if (action === 'zoomIn' || action === 'zoomOut') {
        camera()?.setZoom(camera().getState().scale * (action === 'zoomIn' ? 1.1 : 1 / 1.1)); handled = true;
      } else if (action === 'zoomReset') { camera()?.setZoom(3); handled = true; }
      else if (action === 'followFrontier') { camera()?.followFrontier(); handled = true; }
      else if (action.startsWith('speed')) { setSpeed(changeProcgenSpeed(settings.speed, action.startsWith('speedUp') ? 1 : -1, { fast: action.endsWith('Fast') })); handled = true; }
      else if (action === 'togglePause' && !event.repeat) { setPaused(!paused); handled = true; }
      else if (action === 'stepForward') { if (paused) getRuntime()?.lanes?.step(); handled = true; }
      else if (action === 'toggleShortcutOverlay') { showHelp(); handled = true; }
      else if (action === 'restartLevel' && !event.repeat) { doRestart(); handled = true; }
    }
    if (handled) event.preventDefault?.();
  };
  listen(window, 'keydown', handleKey);
  const getShareUrl = () => createProcgenShareUrl({ url: window.location.href, seed: window.procgenSeed,
    settings, camera: camera()?.getState() || { cameraX: 0, cameraY: 0, scale: 3, follow: true } });
  listen(byId('procgenShare'), 'click', () => {
    const input = byId('procgenShareUrl'); if (!input) return;
    input.value = getShareUrl(); input.hidden = false; input.focus?.(); input.select?.();
  });
  listen(window, 'blur', () => local.suspendGame());
  listen(window, 'focus', () => { if (!document.hidden) local.resumeGame(); });
  listen(document, 'visibilitychange', () => { if (document.hidden) local.suspendGame(); else local.resumeGame(); });
  const syncProgress = state => {
    const lanes = getRuntime()?.world?.stall?.lanes;
    const distance = lanes ? lanes.reduce((max, lane) => Math.max(max, lane.maxX - 36), 0) : state?.distance?.max || 0;
    const best = lanes ? lanes.reduce((max, lane) => Math.max(max, lane.previousDistance || 0), 0) : 0;
    if (byId('procgenDistance')) byId('procgenDistance').textContent = Math.max(0, Math.round(distance)).toLocaleString() + ' px';
    if (byId('procgenBest')) byId('procgenBest').textContent = 'Best ' + Math.max(0, Math.round(best)).toLocaleString();
  };
  const syncActiveCount = count => { if (byId('procgenAliveCount')) byId('procgenAliveCount').textContent = Math.max(0, count).toLocaleString() + ' alive'; };
  return { settings, local, outputCapture, captureControls, getShareUrl, syncActiveCount,
    syncMetrics(state) {
      local.syncStatus?.();
      syncActiveCount(state.alive); syncProgress(state); tensionControls.syncStatus(); spanControls.syncStatus(); musicDirection.syncStatus();
      const pressure = getRuntime()?.view?.midiPreviewRouter?.getOutputPressure?.();
      const outputPressure = byId('procgenOutputPressure');
      if (outputPressure) { outputPressure.hidden = false; outputPressure.textContent = pressure?.throttled ? 'Thinned ' + pressure.dropped : '';  outputPressure.title = pressure?.throttled ? 'Shared sound budget: ' + pressure.reason : ''; }
      const label = byId('procgenMetrics');
      if (label) label.textContent = `${state.alive.toLocaleString()} alive · ${state.spawnedTotal.toLocaleString()} spawned · ${Math.round(state.distance.max).toLocaleString()} px forward · run ${state.generation}${state.admissionPaused ? ' · spawn admission paused at actor cap' : ''}`;
      if (label && Number.isFinite(state.achievedTicksPerSecond)) label.textContent += ` · ${settings.speed}× requested / ${(state.achievedTicksPerSecond * 0.06).toFixed(1)}× measured`;
      const policy = byId('procgenStallStatus');
      if (policy) policy.textContent = state.stall?.phase === 'cascade' ? 'Stalled cohort: staggered OHNO; restart follows the last actor.' : 'Progressing and working lanes stay protected. Reset follows all-lane probe/transit grace or a sustained growing pile.';
    },
    sync() {
      characters.sync(); syncProgress(); musicDirection.sync(); tensionControls.sync(); spanControls.render(); spanOverlay.sync(); syncWorkerLimits(); syncPopulation();
      paused = false; setNukeArmed(false);
      if (byId('procgenPause')) { byId('procgenPause').textContent = 'Pause'; byId('procgenPause').setAttribute('aria-pressed', 'false'); }
      if (byId('procgenSeed')) byId('procgenSeed').value = String(settings.seed ?? window.procgenSeed ?? '');
      camera()?.applyState(settings.camera || urlConfig.camera);
      const overview = cctv();
      if (overview) { const mode = settings.cctvMode, pins = [...settings.cctvPins], enabled = settings.cctvEnabled; overview.onChange = syncCctv; overview.setMode(mode); overview.setPins(pins); overview.setEnabled?.(enabled); syncCctv(overview.getState()); }
      setSpeed(settings.speed);
      const runtime = getRuntime();
      if (byId('procgenAliveCount') && runtime?.world) byId('procgenAliveCount').textContent = runtime.world.actors.reduce((count, actor) => count + (actor.failureReason ? 0 : 1), 0).toLocaleString() + ' alive';
      if (byId('procgenRunStatus')) byId('procgenRunStatus').textContent = `${settings.laneCount.toLocaleString()} ${settings.laneCount === 1 ? 'lane' : 'lanes'} · ${runtime?.world ? 'Wheel or Z/X zoom; arrows or drag pan; F follows the leader.' : 'Left-to-right generation'}`;
    },
    dispose() { disposed = true; local.dispose(); captureControls.dispose(); musicDirection.dispose(); tensionControls.dispose(); spanControls.dispose(); spanOverlay.dispose(); characters.dispose?.(); for (const [target, event, handler, options] of listeners) target?.removeEventListener(event, handler, options); }
  };
};
export { createProcgenUiController };
